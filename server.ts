import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { googleAuthRouter } from './src/api/googleRoutes';
import { getServiceAccountAuth } from './src/lib/serverGoogleAuth';

dotenv.config();

let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is missing.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
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

  // 1. If user provided a valid OAuth access token, download directly from Drive API v3
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
    let attempts = 0;
    while (attempts < 2) {
      try {
        attempts++;
        const res = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
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
        if (attempts < 2) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }
  }

  // If public thumbnail URLs failed, try downloading directly using Service Account if available
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

  throw lastFetchErr || new Error('Gagal mengunduh foto bukti dari Google Drive (Izin akses dibatasi). Silakan pastikan akses foto diset ke "Siapa saja yang memiliki link".');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Configure JSON parser with larger limit for images
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Google Service Account & Drive Proxy Endpoints
  app.use('/api/google', googleAuthRouter);

  // AI Screen Recapture & Spoofing Detection Endpoint
  app.post('/api/ai/check-screen-recapture', async (req, res) => {
    try {
      const { imageBase64, imageUrl, fileId, googleAccessToken, activityInfo } = req.body;

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

${activityInfo ? `Informasi Kegiatan yang Dilaporkan: ${JSON.stringify(activityInfo)}` : ''}

Berikan analisis yang objektif, teliti, dan terstruktur dalam format JSON.`;

      // Candidate models for multimodal vision analysis in order of priority & validity
      const candidateModels = [
        'gemini-flash-latest',
        'gemini-3.1-flash-lite',
      ];
      let response: any = null;
      let lastModelError: any = null;

      // Try candidate models with fast retry & fallback
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
                    isRecapture: {
                      type: Type.BOOLEAN,
                      description: 'True jika terindikasi kuat/sedang merupakan foto dari layar digital (recapture/spoofing). False jika foto langsung di objek fisik nyata.',
                    },
                    confidence: {
                      type: Type.NUMBER,
                      description: 'Tingkat keyakinan analisis dalam persentase (0 sampai 100).',
                    },
                    verdict: {
                      type: Type.STRING,
                      description: 'Status kesimpulan singkat: "AUTHENTIC" (Asli Langsung), "SCREEN_RECAPTURE_DETECTED" (Terdeteksi Foto Layar), atau "SUSPICIOUS" (Mencurigakan).',
                    },
                    summary: {
                      type: Type.STRING,
                      description: 'Penjelasan ringkas kesimpulan hasil analisis forensik dalam bahasa Indonesia yang profesional.',
                    },
                    indicators: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                      description: 'Daftar temuan atau bukti spesifik yang teramati (misal: "Terdeteksi pola Moiré pada area tengah", "Terlihat pantulan backlight LCD", dll).',
                    },
                    reasons: {
                      type: Type.STRING,
                      description: 'Ulasan detail kondisi visual dan karakteristik gambar yang mendukung kesimpulan.',
                    },
                    recommendation: {
                      type: Type.STRING,
                      description: 'Rekomendasi tindakan untuk Administrator/Auditor.',
                    },
                  },
                  required: ['isRecapture', 'confidence', 'verdict', 'summary', 'indicators', 'recommendation'],
                },
              },
            });

            if (response && response.text) {
              break; // Success!
            }
          } catch (modelErr: any) {
            lastModelError = modelErr;
            const errMsg = String(modelErr?.message || '') + ' ' + String(modelErr?.cause || '');
            const isTransient = 
              errMsg.includes('503') || 
              errMsg.includes('UNAVAILABLE') || 
              errMsg.includes('high demand') || 
              errMsg.includes('429') || 
              errMsg.includes('RESOURCE_EXHAUSTED') || 
              errMsg.includes('quota') ||
              errMsg.includes('fetch failed') ||
              errMsg.includes('ECONNRESET') ||
              errMsg.includes('ETIMEDOUT') ||
              errMsg.includes('network') ||
              errMsg.includes('socket');
            
            if (isTransient && attempts < maxAttempts) {
              await new Promise((r) => setTimeout(r, 600));
            } else {
              break;
            }
          }
        }

        if (response && response.text) {
          break;
        }
      }

      if (!response || !response.text) {
        const lastErrMsg = String(lastModelError?.message || '') + ' ' + String(lastModelError?.cause || '');
        if (
          lastErrMsg.includes('503') || 
          lastErrMsg.includes('UNAVAILABLE') || 
          lastErrMsg.includes('high demand') ||
          lastErrMsg.includes('fetch failed') ||
          lastErrMsg.includes('ECONNRESET')
        ) {
          // Graceful fallback for 503 high server demand / socket reset so client gets structured info instead of crash
          return res.json({
            success: true,
            data: {
              isRecapture: false,
              confidence: 0,
              verdict: 'SUSPICIOUS',
              summary: 'Koneksi ke server AI terganggu sementara (Network Reset / Busy). Hasil analisis otomatis ditangguhkan. Silakan verifikasi foto secara manual atau klik "Coba Ulang Analisis AI" dalam beberapa detik.',
              indicators: ['Layanan API AI mengalami koneksi terputus sementara (ECONNRESET/Network)'],
              reasons: 'Terjadi gangguan jaringan atau antrean server pada API Google Gemini.',
              recommendation: 'Periksa foto secara manual atau lakukan pengujian ulang.',
            },
          });
        }
        throw lastModelError || new Error('Layanan AI sedang sibuk sementara. Silakan coba sesaat lagi.');
      }

      const resultText = response.text || '{}';
      let parsedResult;
      try {
        parsedResult = JSON.parse(resultText);
      } catch (parseErr) {
        parsedResult = {
          isRecapture: false,
          confidence: 50,
          verdict: 'SUSPICIOUS',
          summary: resultText,
          indicators: ['Format respons AI berupa teks naratif'],
          recommendation: 'Periksa manual foto bukti kegiatan.',
        };
      }

      return res.json({
        success: true,
        data: parsedResult,
      });
    } catch (error: any) {
      console.error('Error in check-screen-recapture:', error);
      let userFacingError = error.message || 'Terjadi kesalahan saat memproses analisis AI Screen Recapture.';
      
      // Parse if error message is a JSON string
      if (typeof userFacingError === 'string' && userFacingError.includes('{')) {
        try {
          const jsonMatch = userFacingError.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed?.error?.message) {
              if (parsed.error.code === 503 || parsed.error.status === 'UNAVAILABLE') {
                userFacingError = 'Layanan AI sedang mengalami lonjakan antrean server sementara (503). Silakan klik "Coba Lagi" dalam beberapa detik.';
              } else {
                userFacingError = parsed.error.message;
              }
            }
          }
        } catch {
          // keep original
        }
      }

      if (
        userFacingError.includes('429') ||
        userFacingError.toLowerCase().includes('quota exceeded') ||
        userFacingError.includes('RESOURCE_EXHAUSTED') ||
        userFacingError.toLowerCase().includes('rate limit')
      ) {
        userFacingError =
          'Batas kuota gratis (Rate Limit 429) API Gemini tercapai. Silakan tunggu sekitar 30–45 detik lalu coba lagi.';
      }

      return res.status(500).json({
        success: false,
        error: userFacingError,
      });
    }
  });

  // AI BBM Duren Sawit Receipt OCR Check Endpoint
  app.post('/api/ai/check-bbm-receipt', async (req, res) => {
    try {
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
      } = req.body;

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

      if (
        userFacingError.includes('429') ||
        userFacingError.toLowerCase().includes('quota exceeded') ||
        userFacingError.includes('RESOURCE_EXHAUSTED') ||
        userFacingError.toLowerCase().includes('rate limit')
      ) {
        userFacingError =
          'Batas kuota gratis (Rate Limit 429) API Gemini tercapai. Silakan tunggu sekitar 30–45 detik lalu coba lagi.';
      }

      return res.status(500).json({
        success: false,
        error: userFacingError,
      });
    }
  });

  // AI Transfer Receipt OCR Endpoint
  app.post('/api/ai/ocr-transfer-receipt', async (req, res) => {
    try {
      const { imageBase64, imageUrl, fileId } = req.body;

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

      // Candidate models ordered from primary to fallback models
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
                    tanggalTransaksi: {
                      type: Type.STRING,
                      description: 'Tanggal transaksi dalam format YYYY-MM-DD (contoh: 2026-08-22)',
                    },
                    waktuTransaksi: {
                      type: Type.STRING,
                      description: 'Jam/waktu transaksi jika tertera pada resi (contoh: 14:30:25 atau 08:15)',
                    },
                    tanggalWaktuFormatted: {
                      type: Type.STRING,
                      description: 'Tanggal dan waktu gabungan sesuai resi (contoh: 22/08/2026, 14.30.25 atau 2026-08-22 14:30:25)',
                    },
                    nominalTransaksi: {
                      type: Type.NUMBER,
                      description: 'Nominal transfer murni dalam angka bulat (contoh: 1500000)',
                    },
                    catatan: {
                      type: Type.STRING,
                      description: 'Catatan, berita, atau keterangan transfer dari resi',
                    },
                    namaTujuan: {
                      type: Type.STRING,
                      description: 'Nama rekening penerima atau tujuan transfer',
                    },
                    bankPenerima: {
                      type: Type.STRING,
                      description: 'Nama bank atau provider e-wallet penerima',
                    },
                    noReferensi: {
                      type: Type.STRING,
                      description: 'Nomor referensi atau ID transaksi bank dari resi',
                    },
                  },
                  required: ['tanggalTransaksi', 'nominalTransaksi', 'catatan', 'namaTujuan'],
                },
              },
            });

            if (response && response.text) {
              break;
            }
          } catch (modelErr: any) {
            lastModelError = modelErr;
            const errMsg = String(modelErr?.message || '');
            const isTransientOrQuota =
              errMsg.includes('503') ||
              errMsg.includes('UNAVAILABLE') ||
              errMsg.includes('high demand') ||
              errMsg.includes('429') ||
              errMsg.includes('RESOURCE_EXHAUSTED') ||
              errMsg.includes('quota');

            if (isTransientOrQuota && attempts < maxAttempts) {
              await new Promise((r) => setTimeout(r, 500));
            } else {
              break; // Try next model candidate
            }
          }
        }

        if (response && response.text) {
          break;
        }
      }

      if (!response || !response.text) {
        throw lastModelError || new Error('Gagal memproses OCR resi dengan AI.');
      }

      const resultText = (response.text || '{}').trim();
      let cleanText = resultText;
      if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }

      let parsedResult;
      try {
        parsedResult = JSON.parse(cleanText);
      } catch {
        parsedResult = {
          tanggalTransaksi: new Date().toISOString().split('T')[0],
          nominalTransaksi: 0,
          catatan: '',
          namaTujuan: '',
          bankPenerima: '',
          noReferensi: '',
        };
      }

      return res.json({
        success: true,
        data: parsedResult,
      });
    } catch (error: any) {
      console.error('Error in ocr-transfer-receipt:', error);
      let userFacingError = error.message || 'Gagal membaca data resi transfer dengan AI.';
      if (typeof userFacingError === 'string' && userFacingError.includes('{')) {
        try {
          const jsonMatch = userFacingError.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed?.error?.message) {
              userFacingError = parsed.error.message;
            }
          }
        } catch {
          // keep original
        }
      }

      // Format quota / rate limit errors into clear user-friendly Indonesian
      if (
        userFacingError.includes('429') ||
        userFacingError.toLowerCase().includes('quota exceeded') ||
        userFacingError.includes('RESOURCE_EXHAUSTED') ||
        userFacingError.toLowerCase().includes('rate limit')
      ) {
        userFacingError =
          'Batas kuota gratis (Rate Limit 429) API Gemini tercapai. Silakan tunggu sekitar 30–45 detik lalu klik tombol "Coba Lagi OCR".';
      }

      return res.status(500).json({
        success: false,
        error: userFacingError,
      });
    }
  });

  // Express JSON Error Handler Middleware for /api routes
  app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('API Error Middleware caught error:', err);
    let message = err?.message || 'Terjadi kesalahan internal pada server.';
    if (err?.type === 'entity.too.large') {
      message = 'Ukuran berkas gambar terlalu besar untuk diproses server.';
    }
    res.status(err?.status || 500).json({
      success: false,
      error: message,
    });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
