import { GoogleGenAI, Type } from '@google/genai';
import { AiRecaptureResult } from '../components/AiScreenRecaptureModal';
import { UserActivity } from '../types';
import { getAccessToken } from './firebase';

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
 * Extracts Google Drive file ID from various URL formats or ID string
 */
export function extractDriveFileId(urlOrId?: string | null): string | null {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();
  if (!trimmed.includes('/') && !trimmed.includes('?') && !trimmed.includes(':') && trimmed.length >= 10) {
    return trimmed;
  }
  const match = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match && match[1] ? match[1] : null;
}

/**
 * Attempts to download a Google Drive file directly in the browser using the user's OAuth access token
 */
async function downloadDriveFileAsBase64Client(fileId: string, token?: string | null): Promise<string | null> {
  if (!fileId) return null;
  const authToken = token || await getAccessToken();
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
 * Client-side direct fallback if backend API is unreachable or returns static HTML on Vercel
 */
async function clientSideGeminiAnalysis(
  payload: AiRecapturePayload,
  clientApiKey: string
): Promise<AiRecaptureResult> {
  const ai = new GoogleGenAI({ apiKey: clientApiKey });

  let base64Data = '';
  let mimeType = 'image/jpeg';

  if (payload.imageBase64) {
    if (payload.imageBase64.startsWith('data:')) {
      const parts = payload.imageBase64.split(',');
      const mimeMatch = parts[0].match(/:(.*?);/);
      if (mimeMatch) mimeType = mimeMatch[1];
      base64Data = parts[1];
    } else {
      base64Data = payload.imageBase64;
    }
  } else {
    const targetFileId = payload.fileId || extractDriveFileId(payload.imageUrl);
    if (targetFileId) {
      const clientDownloaded = await downloadDriveFileAsBase64Client(targetFileId, payload.googleAccessToken);
      if (clientDownloaded && clientDownloaded.startsWith('data:')) {
        const parts = clientDownloaded.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        if (mimeMatch) mimeType = mimeMatch[1];
        base64Data = parts[1];
      }
    }

    if (!base64Data && payload.imageUrl) {
      const canvasBase64 = await urlToBase64Client(payload.imageUrl);
      if (canvasBase64 && canvasBase64.startsWith('data:')) {
        const parts = canvasBase64.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        if (mimeMatch) mimeType = mimeMatch[1];
        base64Data = parts[1];
      }
    }
  }

  if (!base64Data) {
    throw new Error('Foto tidak dapat diunduh untuk analisis AI. Pastikan izin akses foto Google Drive terbuka.');
  }

  const prompt = `Anda adalah seorang ahli forensik digital spesialis Deteksi Pemalsuan & Foto Ulang Layar (Screen Recapture / Spoofing Detection) untuk audit kegiatan operasional lapangan.

Tugas Anda:
Periksa secara mendalam foto bukti kegiatan operasional terlampir untuk menentukan apakah:
1. Foto ini adalah FOTO LANGSUNG (AUTHENTIC / DIRECT CAPTURE) dari objek/lokasi fisik nyata di lapangan secara langsung.
2. ATAU Foto ini adalah FOTO DARI LAYAR PERANGKAT (SCREEN RECAPTURE / SPOOFING) di mana pengguna memotret layar monitor komputer, laptop, smartphone lain, tablet, TV, atau layar presentasi.

Indikator forensik yang wajib diperiksa:
- **Pola Moiré**: Garis gelombang/interferensi warna atau bayangan melengkung akibat tabrakan sensor kamera dengan grid pixel layar digital.
- **Bezel / Bingkai Layar**: Tepi monitor, sudut bezel HP/laptop, keyboard, mouse, batas jendela browser/OS, atau tepi layar di pinggir foto.
- **Karakteristik Layar Digital**: Pantulan backlight, pantulan lampu ruangan pada kaca monitor (glare), struktur sub-pixel RGB, garis refresh scanline, teks antarmuka digital sekunder.
- **Perspektif & Depth of Field**: Ketiadaan kedalaman ruang alami, distorsi sudut pemotretan ke layar datar, tekstur warna panel LCD/OLED.

${payload.activityInfo ? `Informasi Kegiatan yang Dilaporkan: ${JSON.stringify(payload.activityInfo)}` : ''}

Berikan analisis yang objektif, teliti, dan terstruktur dalam format JSON.`;

  const candidateModels = [
    'gemini-flash-latest',
    'gemini-3.1-flash-lite',
  ];

  let response: any = null;
  let lastErr: any = null;

  for (const modelName of candidateModels) {
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Data,
                mimeType: mimeType || 'image/jpeg',
              },
            },
            {
              text: prompt,
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isRecapture: { type: Type.BOOLEAN },
              confidence: { type: Type.NUMBER },
              verdict: { type: Type.STRING },
              summary: { type: Type.STRING },
              indicators: { type: Type.ARRAY, items: { type: Type.STRING } },
              reasons: { type: Type.STRING },
              recommendation: { type: Type.STRING },
            },
            required: ['isRecapture', 'confidence', 'verdict', 'summary', 'indicators', 'recommendation'],
          },
        },
      });

      if (response && response.text) {
        break;
      }
    } catch (err: any) {
      lastErr = err;
    }
  }

  if (!response || !response.text) {
    throw lastErr || new Error('Gagal memproses analisis AI dengan model Gemini.');
  }

  const parsed = JSON.parse(response.text);
  return {
    ...parsed,
    checkedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
  };
}

/**
 * Compresses large base64 images before sending over network to avoid payload size limits & ECONNRESET
 */
async function compressDataUrlIfNeeded(base64DataUrl: string, maxDim = 1024): Promise<string> {
  if (typeof window === 'undefined' || !base64DataUrl.startsWith('data:')) return base64DataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim && base64DataUrl.length < 400000) {
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
        resolve(canvas.toDataURL('image/jpeg', 0.8));
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
          resolve(canvas.toDataURL('image/jpeg', 0.8));
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
 * Main AI Screen Recapture caller with resilient Vercel error handling and multi-strategy fallbacks
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
      const res = await fetch('/api/ai/check-screen-recapture', {
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

      // Try parsing JSON first directly
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
          throw new Error(errorMsg);
        }

        return {
          ...data.data,
          checkedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        };
      }

      // Check if response is HTML page (typical when a static host returns 404 HTML fallback)
      const isHtmlResponse = rawText.trim().startsWith('<') || 
        rawText.includes('<!DOCTYPE html>') || 
        rawText.toLowerCase().includes('<html') ||
        rawText.includes('The page could not be found');

      if (isHtmlResponse) {
        console.warn('Backend API endpoint returned HTML fallback response:', rawText.slice(0, 150));
        primaryError = `Endpoint server /api/ai/check-screen-recapture belum terhubung (Status: ${res.status}).`;
        break;
      } else {
        throw new Error(`Respons server tidak valid (Bukan format JSON yang diharapkan): ${rawText.slice(0, 80)}`);
      }
    } catch (apiErr: any) {
      console.warn(`API route call attempt ${fetchAttempts} error:`, apiErr);
      primaryError = apiErr?.message || 'Gagal menghubungi server AI.';
      if (fetchAttempts < maxFetchAttempts && (primaryError.includes('fetch failed') || primaryError.includes('Failed to fetch'))) {
        await new Promise((r) => setTimeout(r, 600));
      } else {
        break;
      }
    }
  }

  // Fallback 1: If client-side VITE_GEMINI_API_KEY exists (e.g. configured in Vercel environment variables)
  const clientKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (clientKey) {
    try {
      console.info('Attempting client-side Gemini fallback with VITE_GEMINI_API_KEY...');
      return await clientSideGeminiAnalysis(payload, clientKey);
    } catch (fallbackErr: any) {
      console.error('Client-side fallback error:', fallbackErr);
      const cleanFallbackMsg = fallbackErr?.message || '';
      if (cleanFallbackMsg.includes('Failed to fetch') || cleanFallbackMsg.includes('NetworkError')) {
        throw new Error(primaryError || 'Gagal menghubungi server API Gemini. Silakan periksa koneksi dan coba beberapa saat lagi.');
      }
      throw new Error(`Gagal analisis AI: ${primaryError || cleanFallbackMsg}`);
    }
  }

  // If no client key and API route failed, provide a crystal-clear, step-by-step guidance message for Vercel users
  if (primaryError?.includes('Endpoint Serverless') || primaryError?.includes('Unexpected token') || primaryError?.includes('The page c')) {
    throw new Error(
      'Koneksi API Gemini di Vercel belum aktif. Pastikan:\n1. Tambahkan Environment Variable GEMINI_API_KEY di menu Vercel Project Settings > Environment Variables.\n2. Lakukan Redeploy di dashboard Vercel agar Serverless Function aktif.'
    );
  }

  throw new Error(primaryError || 'Gagal memeriksa keaslian foto dengan AI.');
}
