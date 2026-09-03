import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { google } from 'googleapis';
import { getServiceAccountAuth } from '../../src/lib/serverGoogleAuth.js';

let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is missing.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build-vercel',
        },
      },
    });
  }
  return aiClient;
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
      console.warn('OAuth token fetch on server failed:', tokenErr);
    }
  }

  const candidateUrls: string[] = [];
  if (fileId && !fileId.includes('/')) {
    candidateUrls.push(
      `https://lh3.googleusercontent.com/d/${fileId}=w1200`,
      `https://drive.google.com/thumbnail?sz=w1200&id=${fileId}`,
      `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`
    );
  }
  if (urlOrFileId.startsWith('http://') || urlOrFileId.startsWith('https://')) {
    if (!candidateUrls.includes(urlOrFileId)) {
      candidateUrls.push(urlOrFileId);
    }
  }

  let lastFetchErr: any = null;
  for (const targetUrl of candidateUrls) {
    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'image/*',
        },
        redirect: 'follow',
      });
      if (res.ok) {
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('image/') && !contentType.includes('text/html')) {
          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          if (buffer.length > 200) {
            return {
              base64: buffer.toString('base64'),
              mimeType: contentType.split(';')[0].trim() || 'image/jpeg',
            };
          }
        }
      }
    } catch (err: any) {
      lastFetchErr = err;
    }
  }

  if (fileId && !fileId.includes('/')) {
    try {
      const auth = getServiceAccountAuth();
      if (auth) {
        const drive = google.drive({ version: 'v3', auth });
        const res = await drive.files.get(
          { fileId, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        if (res.data) {
          const buffer = Buffer.from(res.data as ArrayBuffer);
          if (buffer.length > 200) {
            return {
              base64: buffer.toString('base64'),
              mimeType: (res.headers['content-type'] as string) || 'image/jpeg',
            };
          }
        }
      }
    } catch (saErr) {
      console.warn('Service Account direct file download failed:', saErr);
    }
  }

  throw lastFetchErr || new Error('Gagal mengunduh foto bukti dari Google Drive.');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { imageBase64, imageUrl, fileId } = req.body || {};

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
      const fetched = await fetchImageAsBase64(imageUrl || fileId);
      base64Data = fetched.base64;
      mimeType = fetched.mimeType;
    }

    const ai = getGenAI();
    const currentYear = new Date().getFullYear();
    const prompt = `Anda adalah sistem OCR cerdas khusus analisis resi bukti transfer bank & e-wallet Indonesia (seperti BRImo, BCA Mobile, Mandiri Livin, BNI Mobile, QRIS, Dana, GoPay, OVO, ShopeePay, dll).

Tugas Anda:
Analisis foto/skrinsut resi bukti transfer terlampir, lalu ekstrak informasi berikut secara tepat dan terstruktur:

1. **tanggalTransaksi**: Tanggal terjadinya transaksi transfer dalam format YYYY-MM-DD. Jika tanggal pada resi menggunakan format Indonesia (misal 22/08/2026 atau 22 Ags 2026), ubah ke YYYY-MM-DD. Jika tidak tertera tahun, asumsi tahun ${currentYear}.
2. **waktuTransaksi**: Jam dan menit terjadinya transaksi jika ada pada resi (contoh: "14:30:25" atau "08:15"). Jika tidak ada, isi string kosong "".
3. **tanggalWaktuFormatted**: Tanggal dan waktu lengkap transfer sesuai resi (contoh: "22/08/2026, 14.30.25" atau "2026-08-22 14:30:25"). Jika waktu tidak ada, isi dengan tanggal saja.
4. **nominalTransaksi**: Nominal total jumlah uang yang ditransfer dalam bentuk ANGKA BULAT SAJA (misal: 1500000, tanpa titik/koma/simbol Rp).
5. **catatan**: Catatan, berita transfer, ID transaksi, atau keterangan transaksi jika ada pada resi (contoh: "Operasional Site A", "Ref 123", dll). Jika tidak ada, isi string kosong "".
6. **namaTujuan**: Nama lengkap pemilik rekening penerima / nama tujuan transfer (contoh: "BUDI SANTOSO", "PT DEPOTEL"). Jika tidak ada, isi string kosong "".
7. **bankPenerima**: Nama bank atau e-wallet penerima/tujuan (contoh: "BRI", "BCA", "MANDIRI", "BNI", "DANA"). Jika tidak ada, isi string kosong "".
8. **noReferensi**: Nomor referensi unik, No. Ref, ID Transaksi bank dari resi jika ada.

Berikan analisis dalam format JSON murni.`;

    const candidateModels = ['gemini-flash-latest', 'gemini-3.1-flash-lite'];
    let response: any = null;
    let lastModelError: any = null;

    for (const modelName of candidateModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [
              { inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } },
              { text: prompt },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                tanggalTransaksi: { type: Type.STRING },
                waktuTransaksi: { type: Type.STRING },
                tanggalWaktuFormatted: { type: Type.STRING },
                nominalTransaksi: { type: Type.NUMBER },
                catatan: { type: Type.STRING },
                namaTujuan: { type: Type.STRING },
                bankPenerima: { type: Type.STRING },
                noReferensi: { type: Type.STRING },
              },
              required: ['tanggalTransaksi', 'nominalTransaksi', 'catatan', 'namaTujuan'],
            },
          },
        });
        if (response && response.text) break;
      } catch (err: any) {
        lastModelError = err;
      }
    }

    if (!response || !response.text) {
      throw lastModelError || new Error('Gagal memproses OCR resi dengan AI.');
    }

    let cleanText = response.text.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }

    const parsedResult = JSON.parse(cleanText);
    return res.status(200).json({ success: true, data: parsedResult });
  } catch (error: any) {
    console.error('Error in ocr-transfer-receipt handler:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal membaca data resi transfer dengan AI.',
    });
  }
}
