import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getVapidDetails } from '../../src/lib/serverPush.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { publicKey } = getVapidDetails();
    return res.status(200).json({
      success: true,
      publicKey,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Gagal mengambil VAPID Public Key.',
    });
  }
}
