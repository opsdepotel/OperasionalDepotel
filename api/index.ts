import { expressApp } from '../src/api/expressApp.js';

export default function handler(req: any, res: any) {
  try {
    return expressApp(req, res);
  } catch (err: any) {
    console.error('Unhandled Serverless Function Error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: err?.message || 'Serverless function execution failed'
      });
    }
  }
}
