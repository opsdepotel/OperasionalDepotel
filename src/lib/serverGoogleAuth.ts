import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

let cachedAuthClient: any = null;
let cachedTokenInfo: { token: string; expiresAt: number } | null = null;

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
