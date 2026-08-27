import { GoogleGenAI, Type } from '@google/genai';

let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is missing. Silakan tambahkan GEMINI_API_KEY di dashboard Vercel (Project Settings > Environment Variables).');
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

async function fetchImageAsBase64(urlOrFileId: string): Promise<{ base64: string; mimeType: string }> {
  let fileId = urlOrFileId;
  if (urlOrFileId.startsWith('http://') || urlOrFileId.startsWith('https://')) {
    const match = urlOrFileId.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                  urlOrFileId.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                  urlOrFileId.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      fileId = match[1];
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

  throw lastFetchErr || new Error('Gagal mengunduh foto bukti dari Google Drive (Izin akses dibatasi). Silakan pastikan akses foto diset ke "Siapa saja yang memiliki link".');
}

export default async function handler(req: any, res: any) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // Keep as is
      }
    }

    const { imageBase64, imageUrl, fileId, activityInfo } = body || {};

    if (!imageBase64 && !imageUrl && !fileId) {
      return res.status(400).json({
        success: false,
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
            break;
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
        return res.status(200).json({
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
    } catch {
      parsedResult = {
        isRecapture: false,
        confidence: 50,
        verdict: 'SUSPICIOUS',
        summary: resultText,
        indicators: ['Format respons AI berupa teks naratif'],
        recommendation: 'Periksa manual foto bukti kegiatan.',
      };
    }

    return res.status(200).json({
      success: true,
      data: parsedResult,
    });
  } catch (error: any) {
    console.error('Error in Vercel check-screen-recapture:', error);
    let userFacingError = error.message || 'Terjadi kesalahan saat memproses analisis AI Screen Recapture.';
    
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
        // Keep as is
      }
    }

    return res.status(500).json({
      success: false,
      error: userFacingError,
    });
  }
}
