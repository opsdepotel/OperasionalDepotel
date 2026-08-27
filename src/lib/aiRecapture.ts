import { GoogleGenAI, Type } from '@google/genai';
import { AiRecaptureResult } from '../components/AiScreenRecaptureModal';
import { UserActivity } from '../types';

export interface AiRecapturePayload {
  imageBase64?: string;
  imageUrl?: string;
  fileId?: string;
  activityInfo?: {
    siteId?: string;
    siteName?: string;
    tanggal?: string;
    userEmail?: string;
    keterangan?: string;
  };
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
  } else if (payload.imageUrl || payload.fileId) {
    let targetUrl = payload.imageUrl || payload.fileId || '';
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://lh3.googleusercontent.com/d/${payload.fileId}=w1200`;
    }
    const res = await fetch(targetUrl);
    if (!res.ok) {
      throw new Error(`Gagal mengunduh foto untuk analisis AI (status: ${res.status}).`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
    }
    base64Data = btoa(binary);
    mimeType = res.headers.get('content-type')?.split(';')[0].trim() || 'image/jpeg';
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
  let processedPhotoUrl = photoUrl;
  if (photoUrl?.startsWith('data:')) {
    try {
      processedPhotoUrl = await compressDataUrlIfNeeded(photoUrl);
    } catch {
      processedPhotoUrl = photoUrl;
    }
  } else if (photoUrl && photoUrl.startsWith('http')) {
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
    fileId: fileId || undefined,
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

      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();

      // Check if response is HTML instead of JSON (typical when Vercel or static host returns 404 HTML page)
      const isHtmlResponse = rawText.trim().startsWith('<') || 
        rawText.includes('<!DOCTYPE html>') || 
        rawText.toLowerCase().includes('<html') ||
        rawText.includes('The page c') ||
        rawText.includes('The page could not be found') ||
        !contentType.includes('application/json');

      if (isHtmlResponse) {
        console.warn('Backend API endpoint returned non-JSON / HTML response:', rawText.slice(0, 150));
        primaryError = `Endpoint Serverless Vercel /api/ai/check-screen-recapture belum terhubung (Status: ${res.status}).`;
        break;
      } else {
        let data: any = null;
        try {
          data = JSON.parse(rawText);
        } catch (parseErr) {
          throw new Error(`Respons server tidak valid (Bukan JSON: ${rawText.slice(0, 80)}...)`);
        }

        if (!res.ok || !data?.success) {
          const errorMsg = data?.error || `Gagal menjalankan analisis AI (Status: ${res.status})`;
          throw new Error(errorMsg);
        }

        return {
          ...data.data,
          checkedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        };
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
      throw new Error(`Gagal analisis AI: ${cleanFallbackMsg || primaryError}`);
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
