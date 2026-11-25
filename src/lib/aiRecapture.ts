import { AiRecaptureResult } from '../components/AiScreenRecaptureModal';
import { UserActivity } from '../types';
import { getAccessToken } from './firebase';
import { apiFetch } from './apiClient';

export interface AiRecapturePayload {
  imageBase64?: string;
  imageUrl?: string;
  fileId?: string;
  googleAccessToken?: string;
  activityInfo?: {
    siteId?: string;
    siteName?: string;
    tanggal?: string;
    userEmail?: string;
    keterangan?: string;
  };
}

/**
 * Detects whether a cached/saved AI Recapture result is actually a legacy transient network error
 * (e.g. confidence 0 + ECONNRESET/Network) that should NOT be treated as a valid audit verdict.
 */
export function isTransientFailedAiResult(result?: AiRecaptureResult | null): boolean {
  if (!result) return false;
  const summaryLower = String(result.summary || '').toLowerCase();
  const indicatorsText = Array.isArray(result.indicators)
    ? result.indicators.join(' ').toLowerCase()
    : '';
  const combined = `${summaryLower} ${indicatorsText}`;

  if (
    combined.includes('econnreset') ||
    combined.includes('koneksi terputus sementara') ||
    combined.includes('network reset')
  ) {
    return true;
  }

  if (
    Number(result.confidence) === 0 &&
    String(result.verdict || '').toUpperCase().includes('SUSPICIOUS')
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts Google Drive file ID from various URL formats or ID string
 */
export function extractDriveFileId(urlOrId?: string | null): string | null {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();
  if (!trimmed.includes('/') && !trimmed.includes('?') && !trimmed.includes(':') && trimmed.length >= 10) {
    return trimmed;
  }
  const match =
    trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match && match[1] ? match[1] : null;
}

/**
 * Attempts to download a Google Drive file directly in the browser using the user's OAuth access token
 */
async function downloadDriveFileAsBase64Client(
  fileId: string,
  token?: string | null
): Promise<string | null> {
  if (!fileId) return null;
  const authToken = token || (await getAccessToken());
  if (!authToken) return null;

  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!res.ok) {
      console.warn(`Drive API fetch via client OAuth returned status ${res.status}`);
      return null;
    }

    const blob = await res.blob();
    return new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result && result.startsWith('data:') ? result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('downloadDriveFileAsBase64Client error:', err);
    return null;
  }
}

/**
 * Compresses large base64 images before sending over network to avoid payload size limits & ECONNRESET
 */
async function compressDataUrlIfNeeded(base64DataUrl: string, maxDim = 1024): Promise<string> {
  if (typeof window === 'undefined' || !base64DataUrl.startsWith('data:')) return base64DataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    // Do NOT set crossOrigin on data: URIs as it causes load failures on some mobile browsers
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim && base64DataUrl.length < 350000) {
        return resolve(base64DataUrl);
      }
      if (width > height) {
        if (width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      } else {
        resolve(base64DataUrl);
      }
    };
    img.onerror = () => resolve(base64DataUrl);
    img.src = base64DataUrl;
  });
}

/**
 * Attempts to load an image URL into a client-side canvas to extract compressed Base64 data URL
 */
async function urlToBase64Client(url: string, maxDim = 1024): Promise<string | null> {
  if (typeof window === 'undefined' || !url || url.startsWith('data:')) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
          return;
        }
      } catch {
        // Ignored canvas/CORS error
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Server-side AI Screen Recapture caller with resilient retry handling
 */
export async function requestAiScreenRecapture(
  activity: UserActivity,
  photoUrl: string | null,
  fileId?: string | null
): Promise<AiRecaptureResult> {
  const token = await getAccessToken();
  const targetFileId = fileId || extractDriveFileId(photoUrl) || extractDriveFileId(activity.buktiUrl);

  let processedPhotoUrl = photoUrl;
  if (photoUrl?.startsWith('data:')) {
    try {
      processedPhotoUrl = await compressDataUrlIfNeeded(photoUrl);
    } catch {
      processedPhotoUrl = photoUrl;
    }
  } else if (targetFileId && token) {
    // 1. Try downloading image directly using user's active Google OAuth session
    try {
      const clientDownloaded = await downloadDriveFileAsBase64Client(targetFileId, token);
      if (clientDownloaded && clientDownloaded.startsWith('data:')) {
        processedPhotoUrl = await compressDataUrlIfNeeded(clientDownloaded);
      }
    } catch (e) {
      console.warn('OAuth direct client fetch failed:', e);
    }
  }

  if (!processedPhotoUrl?.startsWith('data:') && photoUrl && photoUrl.startsWith('http')) {
    try {
      const clientConverted = await urlToBase64Client(photoUrl);
      if (clientConverted) {
        processedPhotoUrl = clientConverted;
      }
    } catch {
      // Keep original URL
    }
  }

  const payload: AiRecapturePayload = {
    imageBase64: processedPhotoUrl?.startsWith('data:') ? processedPhotoUrl : undefined,
    imageUrl: !processedPhotoUrl?.startsWith('data:') ? (processedPhotoUrl || activity.buktiUrl) : undefined,
    fileId: targetFileId || undefined,
    googleAccessToken: token || undefined,
    activityInfo: {
      siteId: activity.siteId,
      siteName: activity.siteName,
      tanggal: activity.tanggal,
      userEmail: activity.userEmail,
      keterangan: activity.keterangan,
    },
  };

  let primaryError: string | null = null;
  let fetchAttempts = 0;
  const maxFetchAttempts = 2;

  while (fetchAttempts < maxFetchAttempts) {
    try {
      fetchAttempts++;
      const res = await apiFetch('/api/ai/check-screen-recapture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let rawText = '';
      try {
        rawText = await res.text();
      } catch {
        throw new Error('Gagal membaca respons dari server AI.');
      }

      let data: any = null;
      let isJson = false;
      try {
        data = JSON.parse(rawText);
        if (data && typeof data === 'object') {
          isJson = true;
        }
      } catch {
        isJson = false;
      }

      if (isJson) {
        if (!res.ok || !data?.success) {
          const errorMsg = data?.error || `Gagal menjalankan analisis AI (Status: ${res.status})`;
          const isRetryable =
            data?.retryable === true ||
            data?.upstreamStatus === 503 ||
            data?.upstreamStatus === 504 ||
            res.status === 503 ||
            res.status === 504 ||
            errorMsg.includes('High Demand') ||
            errorMsg.includes('ECONNRESET') ||
            errorMsg.includes('Network Reset') ||
            errorMsg.includes('Timeout');

          if (isRetryable && fetchAttempts < maxFetchAttempts) {
            primaryError = errorMsg;
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          throw new Error(errorMsg);
        }

        const result: AiRecaptureResult = {
          ...data.data,
          checkedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        };

        if (isTransientFailedAiResult(result)) {
          throw new Error(
            'Koneksi ke server AI terganggu sementara (Network Reset). Silakan klik "Coba Lagi" beberapa detik lagi.'
          );
        }

        return result;
      }

      const isHtmlResponse =
        rawText.trim().startsWith('<') ||
        rawText.includes('<!DOCTYPE html>') ||
        rawText.toLowerCase().includes('<html') ||
        rawText.includes('The page could not be found');

      if (isHtmlResponse) {
        console.warn('Backend API endpoint returned HTML fallback response:', rawText.slice(0, 150));
        const isWarmupPage = rawText.includes('Starting Server');
        primaryError = isWarmupPage
          ? 'Server AI sedang sibuk sementara atau dalam proses muat ulang. Silakan tunggu beberapa detik lalu klik "Coba Lagi".'
          : `Endpoint server /api/ai/check-screen-recapture tidak merespons JSON (Status: ${res.status}). Silakan muat ulang halaman lalu coba lagi.`;
        if (fetchAttempts < maxFetchAttempts) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        break;
      } else {
        throw new Error(`Respons server tidak valid (Bukan format JSON yang diharapkan): ${rawText.slice(0, 80)}`);
      }
    } catch (apiErr: any) {
      console.warn(`API route call attempt ${fetchAttempts} error:`, apiErr);
      primaryError = apiErr?.message || 'Gagal menghubungi server AI.';
      const isNetworkErr =
        primaryError.includes('fetch failed') ||
        primaryError.includes('Failed to fetch') ||
        primaryError.includes('NetworkError') ||
        primaryError.includes('ECONNRESET');
      if (fetchAttempts < maxFetchAttempts && isNetworkErr) {
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        break;
      }
    }
  }

  throw new Error(primaryError || 'Gagal memeriksa keaslian foto dengan AI.');
}
