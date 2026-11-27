/**
 * Google Service Account Client Helper
 * Fetches auto-renewing access tokens from the server-side Service Account
 */

import { UserActivity } from '../types';
import { getStoredSessionToken } from './sessionClient';
import { getFirebaseIdToken } from './firebase';

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
 * Returns true if no Service Account token is cached or it is within 2 minutes of expiry.
 */
export function isServiceAccountTokenExpired(): boolean {
  return !cachedServiceToken || cachedTokenExpiry <= Date.now() + 120000;
}

/**
 * Returns true only if a Service Account token WAS previously fetched and is now within 2 minutes of expiry.
 * Safe to use before Google API calls without interfering with personal OAuth tokens.
 */
export function isServiceAccountTokenStale(): boolean {
  return Boolean(cachedServiceToken) && cachedTokenExpiry <= Date.now() + 120000;
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
      const data = await res.json().catch(() => ({}));
      const validToken = data.accessToken || data.token;
      if (res.ok && data.success && validToken) {
        cachedServiceToken = validToken;
        cachedTokenExpiry = Date.now() + 3000 * 1000; // ~50 minutes
        if (typeof localStorage !== 'undefined') {
          // In-Memory Token Model: purge any legacy access tokens from storage
          try {
            localStorage.removeItem('g_access_token');
            localStorage.removeItem('g_token_timestamp');
            localStorage.removeItem('g_is_service_account');
            localStorage.removeItem('op_service_account_error');
          } catch {}
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
      } else {
        const errMsg = data.error || `Server API /api/google/token mengembalikan HTTP ${res.status}`;
        console.warn('Failed to fetch Service Account token:', errMsg);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('op_service_account_error', errMsg);
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.warn('Failed to fetch token from Service Account endpoint:', errMsg);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('op_service_account_error', errMsg);
      }
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

export interface ServerActivitySubmitPayload {
  tanggal: string;
  siteId: string;
  siteName: string;
  coordinatesDb: string;
  coordinatesActual: string;
  keterangan: string;
  jenisKendaraan?: string;
  platNomor?: string;
  isBackup?: boolean;
  indikasiFake?: boolean;
  fakeReason?: string;
  spreadsheetId?: string;
  driveFolderId?: string;
  clientSubmissionId?: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca berkas foto di perangkat.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Submits a Daily Activity Log (photo + Google Sheet row) atomically through the server (/api/activities).
 * Ensures Drive upload and Activity sheet append succeed together or cleanly roll back with zero orphan files.
 */
export async function submitActivityViaServer(
  payload: ServerActivitySubmitPayload,
  photoFile?: File
): Promise<UserActivity> {
  const sessionToken = getStoredSessionToken();
  let authToken = sessionToken;
  if (!authToken) {
    try {
      authToken = await getFirebaseIdToken();
    } catch {
      authToken = null;
    }
  }

  if (!authToken) {
    throw new Error('Sesi login tidak ditemukan (HTTP 401). Silakan login kembali.');
  }

  let photoBase64: string | undefined;
  let photoFileName: string | undefined;
  if (photoFile) {
    photoBase64 = await readFileAsDataUrl(photoFile);
    photoFileName = photoFile.name || `ACT_${Date.now()}.jpg`;
  }

  const res = await fetch('/api/activities', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({
      ...payload,
      photoBase64,
      photoFileName
    })
  });

  const result = await res.json().catch(() => ({}));

  if (!res.ok || !result.success || !result.activity) {
    const fallbackMsg =
      res.status === 401
        ? 'Sesi autentikasi kedaluwarsa (HTTP 401).'
        : `Gagal menyimpan Laporan Kegiatan ke server (HTTP ${res.status}, koneksi terganggu).`;
    throw new Error(result.error || fallbackMsg);
  }

  return result.activity as UserActivity;
}
