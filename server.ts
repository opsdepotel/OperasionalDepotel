import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

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

async function fetchImageAsBase64(urlOrFileId: string): Promise<{ base64: string; mimeType: string }> {
  let targetUrl = urlOrFileId;
  // If it's a file ID or drive link
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = `https://drive.google.com/thumbnail?sz=w1200&id=${urlOrFileId}`;
  } else if (targetUrl.includes('drive.google.com')) {
    const match = targetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                  targetUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                  targetUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      targetUrl = `https://drive.google.com/thumbnail?sz=w1200&id=${match[1]}`;
    }
  }

  const res = await fetch(targetUrl);
  if (!res.ok) {
    throw new Error(`Gagal mengunduh foto untuk analisis AI (status: ${res.status}).`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return {
    base64: buffer.toString('base64'),
    mimeType: contentType.split(';')[0].trim() || 'image/jpeg',
  };
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

  // AI Screen Recapture & Spoofing Detection Endpoint
  app.post('/api/ai/check-screen-recapture', async (req, res) => {
    try {
      const { imageBase64, imageUrl, fileId, activityInfo } = req.body;

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

      // Candidate models for multimodal vision analysis in order of priority & high rate limits
      const candidateModels = [
        'gemini-flash-latest',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
        'gemini-3.7-flash',
        'gemini-2.5-pro',
      ];
      let response: any = null;
      let lastModelError: any = null;

      // Try candidate models with automatic retry & fallback
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
            const errMsg = String(modelErr?.message || '');
            const isTransient = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand') || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
            
            if (isTransient && attempts < maxAttempts) {
              // Wait 1.5s before retry
              await new Promise((r) => setTimeout(r, 1500));
            } else {
              // Move to next candidate model
              break;
            }
          }
        }

        if (response && response.text) {
          break;
        }
      }

      if (!response || !response.text) {
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

      return res.status(500).json({
        success: false,
        error: userFacingError,
      });
    }
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
