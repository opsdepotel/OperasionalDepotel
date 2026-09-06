import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllSubscriptions } from '../../src/lib/serverPush.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const all = getAllSubscriptions();
    return res.status(200).json({
      success: true,
      totalCount: all.length,
      users: Array.from(new Set(all.map((s) => s.email))),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Gagal memeriksa daftar subscriptions.',
    });
  }
}
