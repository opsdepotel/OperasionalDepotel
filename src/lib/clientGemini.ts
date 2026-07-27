import { GoogleGenAI, Type } from "@google/genai";

export async function analyzeReceiptClientSide(params: {
  imageBase64?: string;
  imageUrl?: string;
  fileId?: string;
  googleAccessToken?: string;
  mimeType?: string;
  customPrompt?: string;
}) {
  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || (typeof process !== "undefined" ? process.env?.GEMINI_API_KEY : "") || "";

  if (!apiKey) {
    throw new Error("API server /api/analyze-receipt tidak dapat dijangkau (404) dan VITE_GEMINI_API_KEY belum dikonfigurasi di client.");
  }

  let finalBase64 = "";
  let finalMimeType = params.mimeType || "image/jpeg";

  if (params.imageBase64) {
    finalBase64 = params.imageBase64.replace(/^data:image\/\w+;base64,/, "").trim();
  } else if (params.fileId || params.imageUrl) {
    let targetUrl = params.imageUrl || "";
    let extractedFileId = params.fileId || "";

    if (!extractedFileId && targetUrl) {
      const match = targetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || targetUrl.match(/id=([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        extractedFileId = match[1];
      }
    }

    const thumbUrl = extractedFileId 
      ? `https://drive.google.com/thumbnail?sz=w1000&id=${extractedFileId}`
      : targetUrl;

    const headers: Record<string, string> = {};
    if (params.googleAccessToken) {
      headers['Authorization'] = `Bearer ${params.googleAccessToken}`;
    }

    const res = await fetch(thumbUrl, { headers });
    if (!res.ok) {
      throw new Error(`Gagal mengunduh foto nota (${res.status}).`);
    }
    const blob = await res.blob();
    finalMimeType = blob.type || "image/jpeg";
    
    finalBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const str = reader.result as string;
        resolve(str.replace(/^data:image\/\w+;base64,/, "").trim());
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } else {
    throw new Error("Gambar tidak ditemukan.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const promptText = params.customPrompt || `
Anda adalah AI Auditor & Parser Nota/Bukti Operasional.
Analisis foto/dokumen nota ini dengan cermat dan ekstrak informasi berikut:
1. namaVendor: Nama toko/spbu/vendor/penyedia jasa (contoh: "SPBU Duren Sawit", "Toko Listrik Bersama").
2. tanggal: Tanggal pada nota dalam format YYYY-MM-DD jika terlihat, atau string tanggal jika ada.
3. totalNominal: Total biaya / angka nominal transaksi utama dalam angka murni (tanpa Rp / titik).
4. deskripsi: Rincian barang/jasa yang dibeli atau keterangan utama.
5. kategori: Pilih salah satu dari: ["BBM", "Akses PJS / Perizinan", "Material / Peralatan", "Transportasi / Tol", "Konsumsi", "Operasional Lainnya"].
6. kejelasanBukti: Tingkat kejelasan nota ("Sangat Jelas", "Cukup Jelas", "Buram / Kurang Jelas").
7. ringkasanAnalisis: Penjelasan singkat hasil analisis keabsahan & kelengkapan bukti nota dalam Bahasa Indonesia.
  `.trim();

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: {
      parts: [
        { inlineData: { mimeType: finalMimeType, data: finalBase64 } },
        { text: promptText }
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          namaVendor: { type: Type.STRING, description: "Nama toko/vendor/tempat transaksi" },
          tanggal: { type: Type.STRING, description: "Tanggal transaksi jika ada" },
          totalNominal: { type: Type.NUMBER, description: "Jumlah nominal transaksi dalam angka murni" },
          deskripsi: { type: Type.STRING, description: "Rincian barang/layanan yang dibeli" },
          kategori: { type: Type.STRING, description: "Kategori pengeluaran" },
          kejelasanBukti: { type: Type.STRING, description: "Sangat Jelas / Cukup Jelas / Buram" },
          ringkasanAnalisis: { type: Type.STRING, description: "Catatan hasil analisis AI terhadap nota" }
        },
        required: ["namaVendor", "totalNominal", "deskripsi", "ringkasanAnalisis"]
      }
    }
  });

  const text = response.text || "";
  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text };
  }
}
