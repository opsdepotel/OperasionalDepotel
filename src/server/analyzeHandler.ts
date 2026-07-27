import { GoogleGenAI, Type } from "@google/genai";

export async function processAnalyzeReceipt(body: {
  imageBase64?: string;
  imageUrl?: string;
  fileId?: string;
  googleAccessToken?: string;
  mimeType?: string;
  customPrompt?: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured.");
  }

  let finalBase64 = "";
  let finalMimeType = body.mimeType || "image/jpeg";

  // Option 1: Base64 string directly provided
  if (body.imageBase64) {
    finalBase64 = body.imageBase64.replace(/^data:image\/\w+;base64,/, "").trim();
  } 
  // Option 2: File ID or URL from Google Drive / Web
  else if (body.fileId || body.imageUrl) {
    let targetUrl = body.imageUrl || "";
    let extractedFileId = body.fileId || "";

    if (!extractedFileId && targetUrl) {
      const match = targetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || targetUrl.match(/id=([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        extractedFileId = match[1];
      }
    }

    // Attempt download using Google Drive API or direct thumbnail
    let fetchedBuffer: Buffer | null = null;

    if (extractedFileId && body.googleAccessToken) {
      try {
        const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${extractedFileId}?alt=media`, {
          headers: { Authorization: `Bearer ${body.googleAccessToken}` }
        });
        if (driveRes.ok) {
          const arrayBuf = await driveRes.arrayBuffer();
          fetchedBuffer = Buffer.from(arrayBuf);
          const contentType = driveRes.headers.get("content-type");
          if (contentType && contentType.includes("image")) {
            finalMimeType = contentType.split(";")[0];
          }
        }
      } catch (err) {
        console.warn("Failed to fetch image via Drive API, trying thumbnail public link fallback...", err);
      }
    }

    if (!fetchedBuffer && (extractedFileId || targetUrl)) {
      const thumbUrl = extractedFileId 
        ? `https://drive.google.com/thumbnail?sz=w1000&id=${extractedFileId}`
        : targetUrl;
      
      const res = await fetch(thumbUrl);
      if (!res.ok) {
        throw new Error(`Gagal mengunduh foto nota dari link (HTTP ${res.status}).`);
      }
      const arrayBuf = await res.arrayBuffer();
      fetchedBuffer = Buffer.from(arrayBuf);
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("image")) {
        finalMimeType = contentType.split(";")[0];
      }
    }

    if (!fetchedBuffer) {
      throw new Error("Tidak dapat mengambil data gambar dari nota.");
    }

    finalBase64 = fetchedBuffer.toString("base64");
  } else {
    throw new Error("Data gambar (imageBase64, fileId, atau imageUrl) wajib diberikan.");
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const promptText = body.customPrompt || `
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

  const imagePart = {
    inlineData: {
      mimeType: finalMimeType,
      data: finalBase64,
    },
  };

  let responseText = "";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: {
        parts: [imagePart, { text: promptText }],
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
    responseText = response.text || "";
  } catch (proErr: any) {
    console.warn("gemini-3.1-pro-preview error, trying gemini-3.6-flash fallback:", proErr?.message || proErr);
    const fallbackResponse = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: {
        parts: [imagePart, { text: promptText }],
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
    responseText = fallbackResponse.text || "";
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { rawText: responseText };
  }
}
