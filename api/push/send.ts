import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  sendNotificationToUser,
  sendNotificationToRole,
  broadcastNotification,
} from '../../src/lib/serverPush.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { email, role, broadcast, title, body, requestId, url, extra, subscriptions, subscription } = req.body || {};

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Title dan Body notifikasi wajib disertakan.',
      });
    }

    const payload = {
      title,
      body,
      tag: requestId ? `uid-${requestId}` : 'dioms-notification',
      url: url || (requestId ? `/?search=${requestId}` : '/'),
      requestId,
      extra,
    };

    let outcome = { sent: 0, failed: 0 };

    if (broadcast) {
      outcome = await broadcastNotification(payload);
    } else if (role) {
      outcome = await sendNotificationToRole(role, payload);
    } else if (email) {
      const fallback = Array.isArray(subscriptions) ? subscriptions : (subscription ? [subscription] : undefined);
      outcome = await sendNotificationToUser(email, payload, fallback);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Target pengiriman (email, role, atau broadcast) wajib ditentukan.',
      });
    }

    return res.status(200).json({
      success: true,
      ...outcome,
    });
  } catch (error: any) {
    console.error('[WebPush Vercel] Send push error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Gagal mengirim push notifikasi.',
    });
  }
}
