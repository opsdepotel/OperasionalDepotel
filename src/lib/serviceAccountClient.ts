/**
 * Google Service Account Client Helper
 * Fetches auto-renewing access tokens from the server-side Service Account
 */

export interface ServiceAccountStatus {
  isConfigured: boolean;
  serviceAccountEmail: string | null;
}

let cachedServiceToken: string | null = null;
let cachedTokenExpiry = 0;
let inFlightTokenPromise: Promise<{ token: string; email: string } | null> | null = null;

/**
 * Checks if the backend server has a Google Service Account configured.
 */
export async function checkServiceAccountStatus(): Promise<ServiceAccountStatus> {
  try {
    const res = await fetch('/api/google/status');
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
 * Invalidates the cached token, forcing the next call to fetch a fresh token.
 */
export function invalidateServiceAccountToken(): void {
  cachedServiceToken = null;
  cachedTokenExpiry = 0;
}

/**
 * Retrieves a valid OAuth token from the Service Account backend.
 * Automatically caches for up to 50 minutes before requesting a fresh one.
 * Deduplicates simultaneous calls to prevent duplicate token requests.
 */
export async function fetchServiceAccountToken(forceRefresh = false): Promise<{ token: string; email: string } | null> {
  const now = Date.now();
  if (forceRefresh) {
    invalidateServiceAccountToken();
  } else if (cachedServiceToken && cachedTokenExpiry > now + 120000) {
    const email = localStorage.getItem('op_service_account_email') || 'service-account@google.iam.gserviceaccount.com';
    return { token: cachedServiceToken, email };
  }

  if (inFlightTokenPromise) {
    return inFlightTokenPromise;
  }

  inFlightTokenPromise = (async () => {
    try {
      const res = await fetch('/api/google/token');
      if (!res.ok) return null;
      const data = await res.json();
      const validToken = data.accessToken || data.token;
      if (data.success && validToken) {
        cachedServiceToken = validToken;
        cachedTokenExpiry = Date.now() + 3000 * 1000; // ~50 minutes
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('g_access_token', validToken);
          localStorage.setItem('g_token_timestamp', String(Date.now()));
          localStorage.setItem('g_is_service_account', 'true');
          if (data.serviceAccountEmail) {
            localStorage.setItem('op_service_account_email', data.serviceAccountEmail);
          }
          // Dispatch custom event to notify App.tsx to update its active token state
          try {
            window.dispatchEvent(new CustomEvent('google_token_refreshed', { detail: { token: validToken } }));
          } catch {}
        }
        return {
          token: validToken,
          email: data.serviceAccountEmail || 'service-account@google.iam.gserviceaccount.com'
        };
      }
    } catch (err) {
      console.warn('Failed to fetch token from Service Account endpoint:', err);
    } finally {
      inFlightTokenPromise = null;
    }
    return null;
  })();

  return inFlightTokenPromise;
}

/**
 * Uploads a base64 receipt/photo directly through the backend Service Account proxy.
 */
export async function uploadReceiptViaServiceAccount(
  folderId: string,
  base64Data: string,
  fileName?: string
): Promise<{ fileId: string; viewUrl: string }> {
  const res = await fetch('/api/google/upload-receipt', {
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
