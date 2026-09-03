/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import { BudgetRequest, UsageReportItem } from '../types';
import { getAccessToken } from './firebase';

export interface AiBbmReceiptResult {
  nominalInput: number;
  nominalNota: number;
  statusKesesuaian: 'SESUAI' | 'TIDAK_SESUAI' | 'NOTA_TIDAK_TERBACA';
  jenisBbm?: string;
  jumlahLiter?: string;
  hargaPerLiter?: string;
  tanggalNota?: string;
  waktuNota?: string;
  namaSpbu?: string;
  platNomorNota?: string;
  selisih: number;
  ringkasan: string;
  catatanAnalisis: string;
  checkedAt: string;
}

export interface AiBbmReceiptPayload {
  imageBase64?: string;
  imageUrl?: string;
  fileId?: string;
  googleAccessToken?: string;
  nominalInput: number;
  requestId?: string;
  userEmail?: string;
  tanggalPemakaian?: string;
  keterangan?: string;
}

/**
  Extracts Google Drive file ID from URL or ID string
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
 * Downloads a Google Drive file via client-side fetch using user's active Google OAuth token
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
 * Converts image URL to Base64 via Canvas
 */
async function urlToBase64Client(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl);
      } catch (err) {
        console.warn('Canvas urlToBase64Client CORS error:', err);
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Client-side Gemini fallback if backend API is unreachable
 */
async function clientSideGeminiBbmCheck(payload: AiBbmReceiptPayload): Promise<AiBbmReceiptResult> {
  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || (process as any).env?.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('API Key Gemini tidak dikonfigurasi.');
  }

  const ai = new GoogleGenAI({ apiKey });
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
    throw new Error('Foto nota BBM tidak dapat diunduh untuk analisis AI. Pastikan izin akses foto Google Drive terbuka.');
  }

  const nominalInputNumber = payload.nominalInput || 0;
  const nominalInputFormatted = new Intl.NumberFormat('id-ID').format(nominalInputNumber);

  const prompt = `Anda adalah seorang auditor keuangan & ahli OCR khusus analisis Nota / Struk Bukti Pembelian BBM (Bahan Bakar Minyak) di SPBU / POM Bensin (termasuk BBM Duren Sawit).

Tugas Utama Anda:
Periksa foto nota/struk BBM terlampir dan bandingkan nominal total rupiah pada nota dengan nominal pengajuan sistem sebesar: Rp ${nominalInputFormatted} (Angka murni: ${nominalInputNumber}).

Detail Pengajuan Sistem:
- ID Transaksi: ${payload.requestId || '-'}
- Pengisi / User: ${payload.userEmail || '-'}
- Tanggal Pemakaian: ${payload.tanggalPemakaian || '-'}
- Nominal Input Sistem: Rp ${nominalInputFormatted}
- Keterangan / Plat Nomor Input: ${payload.keterangan || '-'}

Instruksi Ekstraksi & Verifikasi:
1. Ekstrak Total Nominal Rupiah yang tertera pada nota (nominalNota).
2. Jika nota dapat dibaca dan tertera angka rupiah:
   - Bandingkan nominalNota dengan nominalInput (${nominalInputNumber}).
   - Jika nominalNota SAMA DENGAN nominalInput (selisih = 0): statusKesesuaian = 'SESUAI'.
   - Jika nominalNota BERBEDA DENGAN nominalInput: statusKesesuaian = 'TIDAK_SESUAI'.
3. Jika foto terpotong, buram, bukan nota BBM, atau nominal rupiah tidak terbaca sama sekali:
   - statusKesesuaian = 'NOTA_TIDAK_TERBACA'.
   - Set nominalNota = 0.
4. Ekstrak detail pendukung jika ada pada nota:
   - jenisBbm (misal: Pertalite, Biosolar, Pertamax, Dexlite, Solar, dll)
   - jumlahLiter (misal: "15.00 Liter")
   - hargaPerLiter (misal: "Rp 10.000")
   - tanggalNota (misal: "2026-09-02")
   - waktuNota (misal: "08:15")
   - namaSpbu (nama/nomor SPBU pada nota, misal: "BBM Duren Sawit", "SPBU 34.13401")
   - platNomorNota (plat nomor kendaraan jika tertera di nota, atau "Tidak Tertera")
5. Berikan selisih = nominalNota - nominalInput.
6. Berikan ringkasan singkat dalam Bahasa Indonesia yang menjelaskan apakah nominal sesuai atau tidak, serta sebutkan angka perbandingannya.
7. Berikan catatanAnalisis yang terperinci.`;

  const candidateModels = ['gemini-flash-latest', 'gemini-3.1-flash-lite'];
  let responseText = '';
  let lastErr: any = null;

  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType } },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              nominalInput: { type: Type.NUMBER },
              nominalNota: { type: Type.NUMBER },
              statusKesesuaian: {
                type: Type.STRING,
                enum: ['SESUAI', 'TIDAK_SESUAI', 'NOTA_TIDAK_TERBACA'],
              },
              jenisBbm: { type: Type.STRING },
              jumlahLiter: { type: Type.STRING },
              hargaPerLiter: { type: Type.STRING },
              tanggalNota: { type: Type.STRING },
              waktuNota: { type: Type.STRING },
              namaSpbu: { type: Type.STRING },
              platNomorNota: { type: Type.STRING },
              selisih: { type: Type.NUMBER },
              ringkasan: { type: Type.STRING },
              catatanAnalisis: { type: Type.STRING },
            },
            required: ['nominalInput', 'nominalNota', 'statusKesesuaian', 'ringkasan', 'catatanAnalisis'],
          },
        },
      });

      if (response && response.text) {
        responseText = response.text.trim();
        break;
      }
    } catch (err: any) {
      lastErr = err;
    }
  }

  if (!responseText) {
    throw lastErr || new Error('Gagal memproses gambar nota BBM secara langsung di browser.');
  }

  const parsed = JSON.parse(responseText);
  return {
    nominalInput: parsed.nominalInput ?? nominalInputNumber,
    nominalNota: parsed.nominalNota ?? 0,
    statusKesesuaian: parsed.statusKesesuaian || 'NOTA_TIDAK_TERBACA',
    jenisBbm: parsed.jenisBbm,
    jumlahLiter: parsed.jumlahLiter,
    hargaPerLiter: parsed.hargaPerLiter,
    tanggalNota: parsed.tanggalNota,
    waktuNota: parsed.waktuNota,
    namaSpbu: parsed.namaSpbu,
    platNomorNota: parsed.platNomorNota,
    selisih: parsed.selisih ?? ((parsed.nominalNota || 0) - nominalInputNumber),
    ringkasan: parsed.ringkasan || 'Pemeriksaan nota BBM selesai.',
    catatanAnalisis: parsed.catatanAnalisis || 'Hasil analisis OCR dari foto nota.',
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Main function to request AI BBM Receipt OCR Verification
 */
export async function requestAiBbmReceiptCheck(
  req: BudgetRequest,
  usageItem?: UsageReportItem,
  photoUrlInput?: string,
  fileIdInput?: string
): Promise<AiBbmReceiptResult> {
  const token = await getAccessToken();
  const rawPhotoUrl = photoUrlInput || usageItem?.buktiUrl || req.buktiTransferUrl;
  const rawFileId = fileIdInput || usageItem?.buktiFileId || req.buktiTransferFileId;
  const targetFileId = extractDriveFileId(rawPhotoUrl) || extractDriveFileId(rawFileId);

  let processedPhotoUrl = rawPhotoUrl;
  if (rawPhotoUrl?.startsWith('data:')) {
    processedPhotoUrl = rawPhotoUrl;
  } else if (targetFileId && token) {
    try {
      const clientDownloaded = await downloadDriveFileAsBase64Client(targetFileId, token);
      if (clientDownloaded && clientDownloaded.startsWith('data:')) {
        processedPhotoUrl = clientDownloaded;
      }
    } catch (e) {
      console.warn('OAuth direct client fetch failed:', e);
    }
  }

  if (!processedPhotoUrl?.startsWith('data:') && rawPhotoUrl && rawPhotoUrl.startsWith('http')) {
    try {
      const clientConverted = await urlToBase64Client(rawPhotoUrl);
      if (clientConverted) {
        processedPhotoUrl = clientConverted;
      }
    } catch (e) {
      console.warn('urlToBase64Client failed:', e);
    }
  }

  const nominalInputVal = usageItem?.nominal || req.jumlahPengajuan || 0;

  const payload: AiBbmReceiptPayload = {
    imageBase64: processedPhotoUrl?.startsWith('data:') ? processedPhotoUrl : undefined,
    imageUrl: !processedPhotoUrl?.startsWith('data:') ? (processedPhotoUrl || rawPhotoUrl) : undefined,
    fileId: targetFileId || undefined,
    googleAccessToken: token || undefined,
    nominalInput: nominalInputVal,
    requestId: req.id,
    userEmail: req.userEmail,
    tanggalPemakaian: req.tanggalPemakaian,
    keterangan: req.keterangan,
  };

  let primaryError = '';
  try {
    const res = await fetch('/api/ai/check-bbm-receipt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { error: responseText };
    }

    if (res.ok && data.success && data.data) {
      return data.data as AiBbmReceiptResult;
    }

    primaryError = data.error || `HTTP ${res.status}: ${res.statusText}`;
  } catch (apiErr: any) {
    console.warn('Backend API /api/ai/check-bbm-receipt error:', apiErr);
    primaryError = apiErr.message || 'Gagal terhubung ke API backend.';
  }

  // Fallback to client-side Gemini if backend failed
  console.log('Falling back to client-side Gemini for BBM Receipt OCR...');
  try {
    return await clientSideGeminiBbmCheck(payload);
  } catch (fallbackErr: any) {
    console.error('Client-side Gemini BBM check error:', fallbackErr);
    const cleanFallbackMsg = fallbackErr.message || '';
    if (cleanFallbackMsg.includes('Failed to fetch') || cleanFallbackMsg.includes('NetworkError')) {
      throw new Error(primaryError || 'Gagal menghubungi server API Gemini. Silakan periksa koneksi internet.');
    }
    throw new Error(`Gagal analisis OCR Nota BBM: ${primaryError || cleanFallbackMsg}`);
  }
}
