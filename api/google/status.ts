import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGoogleAuthStatus } from '../../src/lib/serverGoogleAuth.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const status = getGoogleAuthStatus();
    return res.status(200).json({
      success: true,
      ...status
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal memeriksa status Google Auth server.'
    });
  }
}

