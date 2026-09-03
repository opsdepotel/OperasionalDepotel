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
 * Retrieves a valid OAuth token from the Service Account backend.
 * Automatically caches for up to 50 minutes before requesting a fresh one.
 */
export async function fetchServiceAccountToken(): Promise<{ token: string; email: string } | null> {
  const now = Date.now();
  if (cachedServiceToken && cachedTokenExpiry > now + 120000) {
    const email = localStorage.getItem('op_service_account_email') || 'service-account@google.iam.gserviceaccount.com';
    return { token: cachedServiceToken, email };
  }

  try {
    const res = await fetch('/api/google/token');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.success && data.accessToken) {
      cachedServiceToken = data.accessToken;
      cachedTokenExpiry = now + 3000 * 1000; // ~50 minutes
      if (data.serviceAccountEmail) {
        localStorage.setItem('op_service_account_email', data.serviceAccountEmail);
      }
      return {
        token: data.accessToken,
        email: data.serviceAccountEmail || 'service-account@google.iam.gserviceaccount.com'
      };
    }
  } catch (err) {
    console.warn('Failed to fetch token from Service Account endpoint:', err);
  }
  return null;
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

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Gagal mengunggah foto melalui Service Account: HTTP ${res.status}`);
  }

  const result = await res.json();
  if (!result.success) {
    throw new Error(result.error || 'Gagal mengunggah foto');
  }

  return {
    fileId: result.fileId,
    viewUrl: result.viewUrl
  };
}
