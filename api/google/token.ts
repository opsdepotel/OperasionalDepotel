import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getServiceAccountAccessToken, getServiceAccountStatus } from '../../src/lib/serverGoogleAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const token = await getServiceAccountAccessToken();
    if (!token) {
      return res.status(503).json({
        success: false,
        isConfigured: false,
        error: 'Google Service Account belum dikonfigurasi di Vercel Environment Variables.'
      });
    }

    const status = getServiceAccountStatus();
    return res.status(200).json({
      success: true,
      accessToken: token,
      serviceAccountEmail: status.serviceAccountEmail
    });
  } catch (error: any) {
    console.error('Error generating Google token from service account:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal menghasilkan token dari Service Account.'
    });
  }
}
