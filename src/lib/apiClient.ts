import { getFirebaseIdToken } from './firebase';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Universal authenticated fetch helper.
 * Automatically injects the Firebase ID Token into Authorization: Bearer header.
 * Intercepts HTTP 401 (re-authentication needed) and HTTP 403 (unauthorized role).
 */
export async function apiFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers || {});

  // If Authorization header not explicitly set, fetch and attach Firebase ID Token
  if (!headers.has('Authorization')) {
    try {
      const idToken = await getFirebaseIdToken();
      if (idToken) {
        headers.set('Authorization', `Bearer ${idToken}`);
      }
    } catch (e) {
      console.warn('[apiFetch] Could not retrieve Firebase ID token:', e);
    }
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    console.warn(`[apiFetch] 401 Unauthorized for ${String(input)}`);
    try {
      window.dispatchEvent(
        new CustomEvent('auth_unauthorized', {
          detail: { url: String(input) },
        })
      );
    } catch {}
    const errData = await response.clone().json().catch(() => ({}));
    const message =
      errData?.error || 'Sesi login Anda telah kedaluwarsa atau tidak valid. Silakan login kembali.';
    throw new ApiError(message, 401, errData);
  }

  if (response.status === 403) {
    console.warn(`[apiFetch] 403 Forbidden for ${String(input)}`);
    let message = 'Anda tidak memiliki akses untuk tindakan ini.';
    let errData: any = null;
    try {
      errData = await response.clone().json();
      if (errData?.error) {
        message = errData.error;
      }
    } catch {}

    try {
      window.dispatchEvent(
        new CustomEvent('auth_forbidden', {
          detail: { message, url: String(input) },
        })
      );
    } catch {}

    throw new ApiError(message, 403, errData);
  }

  return response;
}
