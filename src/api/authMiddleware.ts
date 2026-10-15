import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, Auth, DecodedIdToken } from 'firebase-admin/auth';
import { Request, Response, NextFunction } from 'express';
import { Role } from '../types.js';
import { parseServiceAccountCredentials, getServerAccessToken } from '../lib/serverGoogleAuth.js';
import { readServerConfig } from './expressApp.js';
import fs from 'fs';
import path from 'path';

let adminApp: App | null = null;
let adminAuth: Auth | null = null;

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role?: Role;
  name?: string;
  picture?: string;
  decodedToken: DecodedIdToken;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Initializes and returns the Firebase Admin Auth instance on the server.
 * Uses environment variable credentials or project ID without exposing secrets.
 */
export function getFirebaseAuth(): Auth {
  if (adminAuth) {
    return adminAuth;
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    adminApp = existingApps[0];
    adminAuth = getAuth(adminApp);
    return adminAuth;
  }

  // 1. Resolve Project ID
  let projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
  if (!projectId) {
    try {
      const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        projectId = parsed.projectId || '';
      }
    } catch (e) {
      console.warn('[FirebaseAdmin] Failed to read firebase-applet-config.json:', e);
    }
  }

  if (!projectId) {
    projectId = 'gen-lang-client-0520605273';
  }

  // 2. Check for Service Account Credentials
  let credentials = parseServiceAccountCredentials();
  if ((credentials as any)?.project_id) {
    projectId = (credentials as any).project_id;
  }

  // Also check specific FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_JSON env var if available
  const fbSaJson = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (fbSaJson && !credentials) {
    try {
      let rawJson = fbSaJson.trim();
      if (!rawJson.startsWith('{')) {
        try {
          rawJson = Buffer.from(rawJson, 'base64').toString('utf-8');
        } catch {}
      }
      const parsed = JSON.parse(rawJson);
      if (parsed.client_email && parsed.private_key) {
        let pKey = parsed.private_key;
        if (pKey.includes('\\n')) pKey = pKey.replace(/\\n/g, '\n');
        credentials = {
          client_email: parsed.client_email,
          private_key: pKey
        };
      }
    } catch (e) {
      console.warn('[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', e);
    }
  }

  try {
    if (credentials && credentials.client_email && credentials.private_key) {
      adminApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail: credentials.client_email,
          privateKey: credentials.private_key
        }),
        projectId
      });
      console.log(`[FirebaseAdmin] Initialized with Service Account cert (${credentials.client_email}) for project: ${projectId}`);
    } else {
      adminApp = initializeApp({ projectId });
      console.log(`[FirebaseAdmin] Initialized with project ID: ${projectId} (Public cert token validation mode)`);
    }
  } catch (initErr) {
    console.error('[FirebaseAdmin] Initialization error:', initErr);
    // If already initialized in parallel
    const apps = getApps();
    if (apps.length > 0) {
      adminApp = apps[0];
    } else {
      throw initErr;
    }
  }

  adminAuth = getAuth(adminApp);
  return adminAuth;
}

// In-memory role cache to avoid querying Google Sheets on every API request
interface CachedRole {
  role: Role;
  cachedAt: number;
}
const roleCache = new Map<string, CachedRole>();
const ROLE_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

export function invalidateServerRoleCache(email?: string) {
  if (email) {
    roleCache.delete(email.toLowerCase().trim());
  } else {
    roleCache.clear();
  }
}

/**
 * Looks up the user's role from a trusted server-side source:
 * 1. Checks memory cache
 * 2. Checks default system administrators
 * 3. Queries Google Sheets Users!A1:N securely via server credentials
 */
export async function resolveUserRole(email: string): Promise<Role> {
  const cleanEmail = (email || '').toLowerCase().trim();
  if (!cleanEmail) return Role.USER;

  // 1. In-memory cache check
  const cached = roleCache.get(cleanEmail);
  if (cached && Date.now() - cached.cachedAt < ROLE_CACHE_TTL_MS) {
    return cached.role;
  }

  // 2. Primary Administrator safeguard for system admin email
  if (cleanEmail === 'ops.depotel@gmail.com') {
    roleCache.set(cleanEmail, { role: Role.ADMINISTRATOR, cachedAt: Date.now() });
    return Role.ADMINISTRATOR;
  }

  // 3. Query Google Sheets Users table via Server Token
  try {
    const tokenRes = await getServerAccessToken();
    if (tokenRes.token) {
      const serverConfig = readServerConfig();
      const spreadsheetId = serverConfig.spreadsheetId;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A1:N`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tokenRes.token}` }
      });

      if (res.ok) {
        const data = await res.json();
        const rows = (data.values as any[][]) || [];
        if (rows.length > 1) {
          const headers = rows[0].map((h: any) => String(h || '').trim().toLowerCase());
          const emailIdx = headers.findIndex((h: string) => h === 'email');
          const roleIdx = headers.findIndex((h: string) => h === 'role');
          const targetEmailCol = emailIdx >= 0 ? emailIdx : 3; // Default column D
          const targetRoleCol = roleIdx >= 0 ? roleIdx : 4;   // Default column E

          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rowEmail = String(row[targetEmailCol] || '').trim().toLowerCase();
            if (rowEmail === cleanEmail) {
              const rawRole = String(row[targetRoleCol] || '').trim().toUpperCase();
              let resolvedRole = Role.USER;
              if (rawRole === 'ADMINISTRATOR' || rawRole === 'ADMIN') {
                resolvedRole = Role.ADMINISTRATOR;
              } else if (rawRole === 'FINANCE') {
                resolvedRole = Role.FINANCE;
              } else if (rawRole === 'MANAGER') {
                resolvedRole = Role.MANAGER;
              } else if (rawRole === 'DIREKTUR' || rawRole === 'DIRECTOR') {
                resolvedRole = Role.DIREKTUR;
              }

              roleCache.set(cleanEmail, { role: resolvedRole, cachedAt: Date.now() });
              return resolvedRole;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[AuthMiddleware] Error fetching role from Google Sheets:', err);
  }

  // Fallback default role
  roleCache.set(cleanEmail, { role: Role.USER, cachedAt: Date.now() });
  return Role.USER;
}

/**
 * Middleware: Verifies the Firebase ID Token passed in the Authorization header.
 * Rejects requests without valid tokens with HTTP 401.
 * Stores verified identity on req.user.
 */
export async function requireFirebaseAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Autentikasi Firebase diperlukan. Token tidak ditemukan (HTTP 401).'
    });
  }

  const idToken = authHeader.substring(7).trim();
  if (!idToken) {
    return res.status(401).json({
      success: false,
      error: 'Token otorisasi kosong (HTTP 401).'
    });
  }

  // 1. If token is a 3-part JWT, verify with Firebase Admin SDK
  const isJwt = typeof idToken === 'string' && idToken.split('.').length === 3;
  if (isJwt) {
    try {
      const auth = getFirebaseAuth();
      const decodedToken = await auth.verifyIdToken(idToken);

      const email = (decodedToken.email || '').toLowerCase().trim();
      let role: Role | undefined = undefined;

      // Check custom claims if already set on token
      if (decodedToken.role && Object.values(Role).includes(decodedToken.role as Role)) {
        role = decodedToken.role as Role;
      } else if (decodedToken.admin === true) {
        role = Role.ADMINISTRATOR;
      }

      req.user = {
        uid: decodedToken.uid,
        email,
        role,
        name: decodedToken.name || '',
        picture: decodedToken.picture || '',
        decodedToken
      };

      return next();
    } catch (error: any) {
      console.warn('[AuthMiddleware] Firebase verifyIdToken failed, trying Google OAuth token fallback:', error?.code || error?.message);
    }
  }

  // 2. Fallback: Validate as Google OAuth Access Token via Google OAuth userinfo API
  try {
    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${idToken}` }
    });

    if (googleRes.ok) {
      const userInfo: any = await googleRes.json();
      const email = (userInfo.email || '').toLowerCase().trim();
      if (email) {
        const role = await resolveUserRole(email);
        req.user = {
          uid: userInfo.sub || userInfo.id || email,
          email,
          role,
          name: userInfo.name || '',
          picture: userInfo.picture || '',
          decodedToken: {
            uid: userInfo.sub || userInfo.id || email,
            email,
            auth_time: Math.floor(Date.now() / 1000),
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
            firebase: { identities: {}, sign_in_provider: 'google.com' },
            iss: 'https://accounts.google.com',
            sub: userInfo.sub || userInfo.id || email
          } as DecodedIdToken
        };

        return next();
      }
    }
  } catch (gErr: any) {
    console.warn('[AuthMiddleware] Google OAuth token validation failed:', gErr?.message || gErr);
  }

  return res.status(401).json({
    success: false,
    error: 'Sesi autentikasi tidak valid atau telah kedaluwarsa. Silakan login kembali.'
  });
}

/**
 * Middleware: Enforces server-side role authorization.
 * Role is obtained strictly from trusted server sources (Firebase token claim or Google Sheets via service account),
 * never from request body, query parameters, or client storage.
 */
export function requireRole(...allowedRoles: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Autentikasi Firebase diperlukan (HTTP 401).'
      });
    }

    try {
      if (!req.user.role) {
        req.user.role = await resolveUserRole(req.user.email);
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Anda tidak memiliki akses untuk tindakan ini (HTTP 403 Forbidden).'
        });
      }

      next();
    } catch (err: any) {
      console.error('[AuthMiddleware] Role authorization error:', err);
      return res.status(500).json({
        success: false,
        error: 'Gagal memvalidasi otorisasi peran pengguna.'
      });
    }
  };
}
