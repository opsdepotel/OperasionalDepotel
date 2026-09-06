import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  sendPushNotification,
  sendNotificationToUser,
} from '../../src/lib/serverPush.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { email, subscription, subscriptions, title, body } = req.body || {};

    const payload = {
      title: title || '🔔 Uji Coba Push Notifikasi Berhasil!',
      body: body || 'Perangkat Anda siap menerima notifikasi instan status UID dan operasional DIOMS.',
      tag: 'dioms-test-notification',
      url: '/?tab=dashboard',
    };

    if (subscription && subscription.endpoint) {
      const result = await sendPushNotification(subscription, payload);
      return res.status(200).json({
        success: result.success,
        error: result.error,
        sent: result.success ? 1 : 0,
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email user atau data subscription wajib disertakan.',
      });
    }

    const fallback = Array.isArray(subscriptions) ? subscriptions : (subscription ? [subscription] : undefined);
    const result = await sendNotificationToUser(email, payload, fallback);
    if (result.sent === 0 && result.failed === 0) {
      return res.status(200).json({
        success: false,
        sent: 0,
        error: 'Belum ada perangkat terdaftar dengan izin notifikasi aktif untuk email ini.',
      });
    }

    return res.status(200).json({
      success: result.sent > 0,
      ...result,
      message: `${result.sent} notifikasi berhasil dikirim ke perangkat.`,
    });
  } catch (error: any) {
    console.error('[WebPush Vercel] Test push error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Gagal mengirim uji coba push notifikasi.',
    });
  }
}
