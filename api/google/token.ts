import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServerAccessToken, getGoogleAuthStatus } from '../../src/lib/serverGoogleAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const tokenResult = await getServerAccessToken();
    if (!tokenResult.token) {
      return res.status(503).json({
        success: false,
        isConfigured: false,
        error: 'Google Auth belum dikonfigurasi di Vercel Environment Variables.'
      });
    }

    const status = getGoogleAuthStatus();
    return res.status(200).json({
      success: true,
      accessToken: tokenResult.token,
      authMode: tokenResult.type,
      serviceAccountEmail: status.serviceAccountEmail
    });
  } catch (error: any) {
    console.error('Error generating Google token:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal menghasilkan token dari Google Auth.'
    });
  }
}

