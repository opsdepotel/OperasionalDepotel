import { UserProfile } from '../types';
import { safeSetItem } from './storage';

export const SESSION_TOKEN_KEY = 'op_app_session_token';
export const LOGGED_IN_USER_KEY = 'op_app_logged_in_user_id';

/**
 * Retrieves the stored Server-Signed Session Token from localStorage or sessionStorage.
 */
export function getStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Persists the Server-Signed Session Token to both localStorage and sessionStorage.
 */
export function storeSessionToken(token: string): void {
  safeSetItem(SESSION_TOKEN_KEY, token);
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {}
}

/**
 * Clears the session token and saved login identifier upon logout or token invalidation.
 */
export function clearStoredSession(): void {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(LOGGED_IN_USER_KEY);
    sessionStorage.removeItem(LOGGED_IN_USER_KEY);
  } catch {}
}

/**
 * Safely decodes token payload on client without executing or trusting unverified data.
 * Used for checking expiration timestamps in offline mode.
 */
export function decodeClientSessionPayload(token: string): {
  userId: string;
  email: string;
  role: string;
  deviceId?: string;
  iat: number;
  exp: number;
} | null {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.trim().split('.');
    if (parts.length !== 2) return null;
    let base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const jsonStr = atob(base64);
    const parsed = JSON.parse(jsonStr);
    if (parsed && parsed.userId && parsed.exp) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Verifies active session token against the backend (/api/auth/verify-session).
 * Automatically updates token when renewed via sliding window.
 */
export async function verifySessionWithServer(
  spreadsheetId?: string
): Promise<{
  success: boolean;
  user?: UserProfile;
  sessionToken?: string;
  error?: string;
  isOffline?: boolean;
}> {
  const token = getStoredSessionToken();
  const legacyUserId = localStorage.getItem(LOGGED_IN_USER_KEY) || sessionStorage.getItem(LOGGED_IN_USER_KEY);

  if (!token && !legacyUserId) {
    return { success: false, error: 'Tidak ada sesi tersimpan.' };
  }

  // Pre-check expiration locally
  if (token) {
    const payload = decodeClientSessionPayload(token);
    if (payload && Date.now() > payload.exp) {
      clearStoredSession();
      return { success: false, error: 'Sesi login telah kedaluwarsa. Silakan login kembali.' };
    }
  }

  try {
    const res = await fetch('/api/auth/verify-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        sessionToken: token || undefined,
        legacyUserId: legacyUserId || undefined,
        spreadsheetId: spreadsheetId || undefined
      }),
      signal: AbortSignal.timeout(8000)
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data?.success && data?.user) {
      if (data.sessionToken) {
        storeSessionToken(data.sessionToken);
      }
      return {
        success: true,
        user: data.user,
        sessionToken: data.sessionToken || token || undefined
      };
    }

    if (res.status === 401) {
      // Signature invalid, expired, or account deactivated -> Clear session
      clearStoredSession();
      return {
        success: false,
        error: data?.error || 'Sesi login tidak valid. Silakan login kembali.'
      };
    }

    return {
      success: false,
      error: data?.error || 'Gagal memverifikasi sesi ke server.'
    };
  } catch (err: any) {
    // Network / timeout error (device is offline)
    console.warn('[SessionClient] Verification network error (offline mode):', err);
    return {
      success: false,
      isOffline: true,
      error: 'Tidak dapat menghubungi server verifikasi (Mode Offline).'
    };
  }
}
