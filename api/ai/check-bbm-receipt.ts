/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';

function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }
  return new GoogleGenAI({ apiKey });
}

async function fetchImageAsBase64(
  urlOrFileId: string,
  googleAccessToken?: string
): Promise<{ base64: string; mimeType: string }> {
  let fileId = urlOrFileId;
  if (urlOrFileId.startsWith('http://') || urlOrFileId.startsWith('https://')) {
    const match = urlOrFileId.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                  urlOrFileId.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                  urlOrFileId.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      fileId = match[1];
    }
  }

  // 1. Download directly using OAuth Access Token if available
  if (fileId && !fileId.includes('/') && googleAccessToken) {
    try {
      const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
        },
      });
      if (driveRes.ok) {
        const contentType = (driveRes.headers.get('content-type') || '').toLowerCase();
        const arrayBuffer = await driveRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        if (buffer.length > 200) {
          return {
            base64: buffer.toString('base64'),
            mimeType: contentType.split(';')[0].trim() || 'image/jpeg',
          };
        }
      }
    } catch (tokenErr) {
      console.warn('OAuth token fetch in Vercel failed:', tokenErr);
    }
  }

  const candidateUrls: string[] = [];
  if (fileId && !fileId.includes('/')) {
    candidateUrls.push(
      `https://lh3.googleusercontent.com/d/${fileId}=w1200`,
      `https://drive.google.com/thumbnail?sz=w1200&id=${fileId}`,
      `https://drive.google.com/uc?export=download&id=${fileId}`
    );
  } else {
    candidateUrls.push(urlOrFileId);
  }

  for (const targetUrl of candidateUrls) {
    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
        redirect: 'follow',
      });

      if (!response.ok) continue;

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/html') || contentType.includes('text/plain')) {
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length < 200) continue;

      let mimeType = contentType.split(';')[0].trim();
      if (!mimeType || mimeType === '*/*' || mimeType === 'application/octet-stream') {
        mimeType = 'image/jpeg';
      }

      return {
        base64: buffer.toString('base64'),
        mimeType,
      };
    } catch (err) {
      console.warn(`Attempt failed for URL: ${targetUrl}`, err);
    }
  }

  throw new Error('Gagal mengunduh foto nota BBM dari Google Drive (Izin akses dibatasi). Silakan pastikan akses foto diset ke "Siapa saja yang memiliki link".');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow CORS for preview environment
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // ignore
      }
    }

    const {
      imageBase64,
      imageUrl,
      fileId,
      googleAccessToken,
      nominalInput = 0,
      requestId,
      userEmail,
      tanggalPemakaian,
      keterangan
    } = body || {};

    if (!imageBase64 && !imageUrl && !fileId) {
      return res.status(400).json({
        error: 'Parameter gambar (imageBase64, imageUrl, atau fileId) wajib disertakan.',
      });
    }

    let base64Data = '';
    let mimeType = 'image/jpeg';

    if (imageBase64) {
      if (imageBase64.startsWith('data:')) {
        const parts = imageBase64.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        if (mimeMatch) mimeType = mimeMatch[1];
        base64Data = parts[1];
      } else {
        base64Data = imageBase64;
      }
    } else {
      const fetched = await fetchImageAsBase64(imageUrl || fileId, googleAccessToken);
      base64Data = fetched.base64;
      mimeType = fetched.mimeType;
    }

    const ai = getGenAI();
    const nominalInputNumber = parseFloat(String(nominalInput).replace(/[^0-9.]/g, '')) || 0;
    const nominalInputFormatted = new Intl.NumberFormat('id-ID').format(nominalInputNumber);

    const prompt = `Anda adalah seorang auditor keuangan & ahli OCR khusus analisis Nota / Struk Bukti Pembelian BBM (Bahan Bakar Minyak) di SPBU / POM Bensin (termasuk BBM Duren Sawit).

Tugas Utama Anda:
Periksa foto nota/struk BBM terlampir dan bandingkan nominal total rupiah pada nota dengan nominal pengajuan sistem sebesar: Rp ${nominalInputFormatted} (Angka murni: ${nominalInputNumber}).

Detail Pengajuan Sistem:
- ID Transaksi: ${requestId || '-'}
- Pengisi / User: ${userEmail || '-'}
- Tanggal Pemakaian: ${tanggalPemakaian || '-'}
- Nominal Input Sistem: Rp ${nominalInputFormatted}
- Keterangan / Plat Nomor Input: ${keterangan || '-'}

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

    const candidateModels = [
      'gemini-flash-latest',
      'gemini-3.1-flash-lite',
    ];

    let response: any = null;
    let lastModelError: any = null;

    for (const modelName of candidateModels) {
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        try {
          attempts++;
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
                  nominalInput: {
                    type: Type.NUMBER,
                    description: 'Nominal input di sistem (dalam Rupiah)',
                  },
                  nominalNota: {
                    type: Type.NUMBER,
                    description: 'Nominal total yang terbaca pada nota BBM (dalam Rupiah). Isi 0 jika tidak terbaca.',
                  },
                  statusKesesuaian: {
                    type: Type.STRING,
                    enum: ['SESUAI', 'TIDAK_SESUAI', 'NOTA_TIDAK_TERBACA'],
                    description: 'Status kesesuaian antara nominal nota vs input sistem.',
                  },
                  jenisBbm: {
                    type: Type.STRING,
                    description: 'Jenis bahan bakar pada nota (misal: Pertalite, Biosolar, Pertamax, Dexlite, dll).',
                  },
                  jumlahLiter: {
                    type: Type.STRING,
                    description: 'Jumlah liter BBM yang diisi (misal: 15.00 Liter).',
                  },
                  hargaPerLiter: {
                    type: Type.STRING,
                    description: 'Harga BBM per liter pada nota (misal: Rp 10.000).',
                  },
                  tanggalNota: {
                    type: Type.STRING,
                    description: 'Tanggal transaksi pada nota (format YYYY-MM-DD atau sesuai nota).',
                  },
                  waktuNota: {
                    type: Type.STRING,
                    description: 'Waktu/Jam transaksi pada nota jika ada.',
                  },
                  namaSpbu: {
                    type: Type.STRING,
                    description: 'Nama SPBU/POM Bensin yang tertera pada nota.',
                  },
                  platNomorNota: {
                    type: Type.STRING,
                    description: 'Nomor plat kendaraan jika tertera pada nota.',
                  },
                  selisih: {
                    type: Type.NUMBER,
                    description: 'Selisih antara nominalNota - nominalInput (0 jika sesuai).',
                  },
                  ringkasan: {
                    type: Type.STRING,
                    description: 'Ringkasan singkat kesimpulan pemeriksaan nota dalam Bahasa Indonesia.',
                  },
                  catatanAnalisis: {
                    type: Type.STRING,
                    description: 'Penjelasan rinci hasil ekstraksi OCR dan verifikasi nominal.',
                  },
                },
                required: ['nominalInput', 'nominalNota', 'statusKesesuaian', 'ringkasan', 'catatanAnalisis'],
              },
            },
          });

          if (response && response.text) {
            break;
          }
        } catch (err: any) {
          lastModelError = err;
          console.warn(`Model ${modelName} attempt ${attempts} failed:`, err?.message || err);
        }
      }

      if (response && response.text) {
        break;
      }
    }

    if (!response || !response.text) {
      throw lastModelError || new Error('Gagal memproses gambar dengan model Gemini.');
    }

    const jsonText = response.text.trim();
    let resultJson = JSON.parse(jsonText);

    resultJson.checkedAt = new Date().toISOString();
    if (resultJson.nominalInput === undefined) {
      resultJson.nominalInput = nominalInputNumber;
    }
    if (resultJson.selisih === undefined) {
      resultJson.selisih = (resultJson.nominalNota || 0) - resultJson.nominalInput;
    }

    return res.status(200).json({
      success: true,
      data: resultJson,
    });
  } catch (error: any) {
    console.error('Error in check-bbm-receipt API:', error);
    let userFacingError = error?.message || 'Terjadi kesalahan sistem saat analisis OCR nota BBM Duren Sawit.';
    
    if (userFacingError.includes('429') || userFacingError.includes('quota')) {
      userFacingError = 'Sistem Gemini AI sedang mencapai kuota maksimum (*rate limit*). Silakan coba lagi beberapa saat lagi.';
    }

    return res.status(500).json({
      success: false,
      error: userFacingError,
    });
  }
}
