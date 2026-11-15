import express from 'express';
import http from 'http';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ override: true });

const PORT = Number(process.env.PORT) || 3000;
const bootstrapApp = express();

let activeExpressApp: express.Express | null = null;
let initError: Error | null = null;

// Quick health-check endpoint so container readiness probes succeed immediately
bootstrapApp.get('/api/health', (req, res, next) => {
  if (activeExpressApp) return next();
  res.status(200).json({ status: 'ok', initializing: true, timestamp: new Date().toISOString() });
});

const readyPromise = (async () => {
  try {
    const { expressApp } = await import('./src/api/expressApp.js');

    if (process.env.NODE_ENV !== 'production') {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      expressApp.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      expressApp.use(express.static(distPath));
      expressApp.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    activeExpressApp = expressApp;
    console.log('Application routes and Vite middleware initialized.');
  } catch (err: any) {
    initError = err instanceof Error ? err : new Error(String(err));
    console.error('Failed to initialize application middleware:', err);
  }
})();

// Hold non-health requests until initialization completes so initial page loads never fail
bootstrapApp.use(async (req, res, next) => {
  if (!activeExpressApp) {
    await readyPromise;
  }
  if (initError || !activeExpressApp) {
    res.status(500).send(`Server initialization error: ${initError?.message || 'Unknown error'}`);
    return;
  }
  activeExpressApp(req, res, next);
});

const server = http.createServer(bootstrapApp);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening immediately on http://0.0.0.0:${PORT}`);
});


