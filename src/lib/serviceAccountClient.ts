/**
 * Google Service Account Client Helper
 * 
 * Secure implementation:
 * - Server never exposes Google access tokens, service account credentials, or refresh tokens to browser.
 * - Uploads and operations requiring server Google credentials are proxy-routed through authenticated backend endpoints.
 */

import { apiFetch } from './apiClient';
import { getFirebaseIdToken } from './firebase';

export interface ServiceAccountStatus {
  isConfigured: boolean;
  serviceAccountEmail: string | null;
}

let cachedClientToken: { token: string; email: string; expiresAt: number } | null = null;

/**
 * Checks if the backend server has Google Auth / Service Account configured.
 */
export async function checkServiceAccountStatus(): Promise<ServiceAccountStatus> {
  try {
    const res = await fetch('/api/google/status', {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) {
      return { isConfigured: false, serviceAccountEmail: null };
    }
    const data = await res.json();
    return {
      isConfigured: Boolean(data.isConfigured),
      serviceAccountEmail: data.serviceAccountEmail || null
    };
  } catch {
    return { isConfigured: false, serviceAccountEmail: null };
  }
}

/**
 * Invalidates client-side cached Service Account token.
 */
export function invalidateServiceAccountToken(): void {
  cachedClientToken = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('g_access_token');
    localStorage.removeItem('g_is_service_account');
    localStorage.removeItem('op_service_account_email');
    localStorage.removeItem('g_token_timestamp');
  }
}

/**
 * Fetches short-lived Google Access Token from the backend server (/api/google/token).
 * Caches token in-memory and in localStorage to avoid redundant server requests.
 */
export async function fetchServiceAccountToken(forceRefresh = false): Promise<{ token: string; email: string } | null> {
  const now = Date.now();

  // Return cached token if valid for at least 2 more minutes
  if (!forceRefresh && cachedClientToken && cachedClientToken.expiresAt > now + 120000) {
    return { token: cachedClientToken.token, email: cachedClientToken.email };
  }

  // Check localStorage if memory cache is empty
  if (!forceRefresh && typeof localStorage !== 'undefined') {
    const storedToken = localStorage.getItem('g_access_token');
    const isSa = localStorage.getItem('g_is_service_account') === 'true';
    const tsStr = localStorage.getItem('g_token_timestamp');
    const email = localStorage.getItem('op_service_account_email') || 'service-account@google.com';
    if (storedToken && isSa && tsStr) {
      const ts = parseInt(tsStr, 10);
      if (!isNaN(ts) && (now - ts) < 3300 * 1000) {
        cachedClientToken = {
          token: storedToken,
          email,
          expiresAt: ts + 3500 * 1000
        };
        return { token: storedToken, email };
      }
    }
  }

  try {
    const url = `/api/google/token${forceRefresh ? '?force=true' : ''}`;
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };

    // Attach Firebase ID token if active
    try {
      const idToken = await getFirebaseIdToken();
      if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
      }
    } catch {}

    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`[fetchServiceAccountToken] Server returned HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data && data.success && data.token) {
      const token = data.token;
      const email = data.email || 'service-account@google.com';

      cachedClientToken = {
        token,
        email,
        expiresAt: now + 3500 * 1000
      };

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('g_access_token', token);
        localStorage.setItem('g_is_service_account', 'true');
        localStorage.setItem('op_service_account_email', email);
        localStorage.setItem('g_token_timestamp', now.toString());

        if (!localStorage.getItem('g_google_user')) {
          localStorage.setItem('g_google_user', JSON.stringify({
            uid: 'service-account-user',
            email: email,
            displayName: 'DIOMS System'
          }));
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('google_token_refreshed', {
            detail: { token, email }
          })
        );
      }

      return { token, email };
    }

    return null;
  } catch (err) {
    console.warn('[fetchServiceAccountToken] Gagal mengambil token server:', err);
    return null;
  }
}

/**
 * Uploads a base64 receipt/photo directly through the authenticated backend proxy.
 * Transmits the Firebase ID Token to the server; the server uploads to Google Drive using server credentials.
 */
export async function uploadReceiptViaServiceAccount(
  folderId: string,
  base64Data: string,
  fileName?: string
): Promise<{ fileId: string; viewUrl: string }> {
  const res = await apiFetch('/api/google/upload-receipt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      folderId,
      base64Data,
      fileName
    })
  });

  const result = await res.json().catch(() => ({}));

  if (!res.ok || !result.success) {
    throw new Error(result.error || `Gagal mengunggah foto ke Google Drive (HTTP ${res.status}).`);
  }

  const fileId = result.fileId || '';
  const viewUrl = result.viewUrl || (fileId ? `https://drive.google.com/file/d/${fileId}/view` : '');

  if (!fileId || !viewUrl) {
    throw new Error('Servis Google Drive tidak mengembalikan URL berkas yang valid.');
  }

  return {
    fileId,
    viewUrl
  };
}
