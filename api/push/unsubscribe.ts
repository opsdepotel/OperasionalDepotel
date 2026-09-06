import type { VercelRequest, VercelResponse } from '@vercel/node';
import { removeSubscriptionByEndpoint } from '../../src/lib/serverPush.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        error: 'Endpoint subscription wajib disertakan.',
      });
    }

    const removed = removeSubscriptionByEndpoint(endpoint);
    return res.status(200).json({
      success: true,
      removed,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Gagal menghapus subscription perangkat.',
    });
  }
}
