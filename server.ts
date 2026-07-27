import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { processAnalyzeReceipt } from "./src/server/analyzeHandler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit for Base64 image upload analysis
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ limit: "25mb", extended: true }));

  // API Health Check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // AI Receipt & Image Analysis Endpoint using Gemini API
  app.post("/api/analyze-receipt", async (req, res) => {
    try {
      const result = await processAnalyzeReceipt(req.body);
      return res.json({
        success: true,
        data: result
      });
    } catch (err: any) {
      console.error("Error in /api/analyze-receipt:", err);
      return res.status(500).json({
        success: false,
        error: err?.message || "Gagal menganalisis nota/foto.",
      });
    }
  });

  // Vite development middleware or static production serving
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
