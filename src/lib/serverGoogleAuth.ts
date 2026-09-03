import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

let cachedAuthClient: any = null;
let cachedTokenInfo: { token: string; expiresAt: number } | null = null;

let cachedOAuthClient: any = null;
let cachedOAuthTokenInfo: { token: string; expiresAt: number } | null = null;

function cleanEnvVal(val?: string): string {
  if (!val) return '';
  let cleaned = val.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

/**
 * Returns Server-Side OAuth2 Client configured with a Refresh Token.
 * Refresh tokens do NOT expire every 60 minutes and automatically issue fresh Access Tokens.
 */
export function getServerOAuthClient() {
  const refreshToken = cleanEnvVal(process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  const clientId = cleanEnvVal(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID);
  const clientSecret = cleanEnvVal(process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET);

  if (refreshToken && clientId && clientSecret) {
    if (!cachedOAuthClient) {
      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        'https://developers.google.com/oauthplayground'
      );

      oauth2Client.setCredentials({
        refresh_token: refreshToken
      });

      cachedOAuthClient = oauth2Client;
    }
    return cachedOAuthClient;
  }

  return null;
}

/**
 * Returns Google Auth Client using Service Account credentials.
 * Supports:
 * 1. GOOGLE_SERVICE_ACCOUNT_JSON (full JSON content / stringified)
 * 2. GOOGLE_SERVICE_ACCOUNT_EMAIL & GOOGLE_PRIVATE_KEY
 */
export function getServiceAccountAuth() {
  if (cachedAuthClient) {
    return cachedAuthClient;
  }

  const scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file'
  ];

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      const credentials = typeof serviceAccountJson === 'string' 
        ? JSON.parse(serviceAccountJson) 
        : serviceAccountJson;
      
      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes
      });
      cachedAuthClient = auth;
      return auth;
    } catch (err) {
      console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', err);
    }
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (clientEmail && privateKey) {
    // Handle escaped newlines in private key string if present
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes
    });
    cachedAuthClient = auth;
    return auth;
  }

  return null;
}

/**
 * Returns the active Google Auth client for backend operations.
 * Priority:
 * 1. Server OAuth2 Client (with Refresh Token)
 * 2. Service Account JWT Client
 */
export async function getServerGoogleAuth(): Promise<{ auth: any; type: 'oauth' | 'service_account' } | null> {
  const tokenResult = await getServerAccessToken();
  if (!tokenResult.token) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: tokenResult.token });

  return {
    auth: oauth2Client,
    type: tokenResult.type === 'service_account' ? 'service_account' : 'oauth'
  };
}

/**
 * Gets a fresh access token using either Server OAuth Refresh Token or Service Account.
 */
export async function getServerAccessToken(): Promise<{
  token: string | null;
  type: 'oauth' | 'service_account' | 'none';
  error?: string;
}> {
  // 1. Primary: Try OAuth Refresh Token Auto-Renew
  const oauthClient = getServerOAuthClient();
  if (oauthClient) {
    const now = Date.now();
    if (cachedOAuthTokenInfo && cachedOAuthTokenInfo.expiresAt > now + 120000) {
      return { token: cachedOAuthTokenInfo.token, type: 'oauth' };
    }

    try {
      const res = await oauthClient.getAccessToken();
      const token = typeof res === 'string' ? res : res?.token;
      if (token) {
        cachedOAuthTokenInfo = {
          token,
          expiresAt: now + 3500 * 1000
        };
        return { token, type: 'oauth' };
      }
    } catch (error: any) {
      const errMsg = error?.response?.data?.error_description || error?.message || String(error);
      console.warn('Google OAuth Refresh Token token fetch failed:', errMsg);
      // Invalidate cachedOAuthClient so we don't hold on to a broken client
      cachedOAuthClient = null;
      cachedOAuthTokenInfo = null;
    }
  }

  // 2. Secondary: Try Service Account
  const saToken = await getServiceAccountAccessToken();
  if (saToken) {
    return { token: saToken, type: 'service_account' };
  }

  return {
    token: null,
    type: 'none',
    error: 'GOOGLE_REFRESH_TOKEN tidak valid atau telah kedaluwarsa (invalid_grant). Pastikan OAuth Client ID, Client Secret, dan Refresh Token yang dimasukkan dari Google OAuth Playground sudah cocok.'
  };
}

/**
 * Gets a fresh access token using the Service Account credentials.
 */
export async function getServiceAccountAccessToken(): Promise<string | null> {
  const auth = getServiceAccountAuth();
  if (!auth) return null;

  const now = Date.now();
  // Return cached token if valid for at least 2 more minutes
  if (cachedTokenInfo && cachedTokenInfo.expiresAt > now + 120000) {
    return cachedTokenInfo.token;
  }

  try {
    const res = await auth.getAccessToken();
    const token = typeof res === 'string' ? res : res?.token;
    if (token) {
      // Tokens are generally valid for 3600 seconds (1 hour)
      cachedTokenInfo = {
        token,
        expiresAt: now + 3500 * 1000
      };
      return token;
    }
  } catch (error) {
    console.error('Error fetching Service Account access token:', error);
  }
  return null;
}

/**
 * Returns overall Google auth status (Server OAuth + Service Account).
 */
export function getGoogleAuthStatus() {
  const oauthClient = getServerOAuthClient();
  const saStatus = getServiceAccountStatus();

  const isOAuthConfigured = Boolean(oauthClient);
  const isServiceAccountConfigured = saStatus.isConfigured;

  return {
    isConfigured: isOAuthConfigured || isServiceAccountConfigured,
    authMode: isOAuthConfigured ? 'oauth' : (isServiceAccountConfigured ? 'service_account' : 'none'),
    isOAuthConfigured,
    isServiceAccountConfigured,
    serviceAccountEmail: saStatus.serviceAccountEmail
  };
}

/**
 * Returns service account status and connected email (without private key).
 */
export function getServiceAccountStatus() {
  const auth = getServiceAccountAuth();
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 
    (() => {
      try {
        if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
          const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
          return parsed.client_email;
        }
      } catch (e) {}
      return null;
    })();

  return {
    isConfigured: Boolean(auth),
    serviceAccountEmail: email || null
  };
}

