import type { VercelRequest, VercelResponse } from '@vercel/node';
import { saveSubscription } from '../../src/lib/serverPush.js';
import { syncSubscriptionToGoogleSheets } from '../../src/lib/serverPushToSheets.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { subscription, email, name, role, clientToken } = req.body || {};

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({
        success: false,
        error: 'Data subscription tidak valid (endpoint & keys wajib ada).',
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email user wajib disertakan.',
      });
    }

    const userAgent = (req.headers['user-agent'] as string) || '';
    const record = saveSubscription({
      email,
      name,
      role,
      subscription,
      userAgent,
    });

    // Asynchronously synchronize subscription to Google Sheets Column N
    syncSubscriptionToGoogleSheets(email, subscription, {
      userAgent,
      clientToken: clientToken || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : undefined),
    }).catch((err) => {
      console.warn('[Vercel WebPush] Sync to Google Sheets failed:', err);
    });

    return res.status(200).json({
      success: true,
      subscriptionId: record.id,
      message: 'Perangkat berhasil didaftarkan untuk menerima push notifikasi.',
    });
  } catch (error: any) {
    console.error('[WebPush Vercel] Subscribe error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Gagal mendaftarkan perangkat.',
    });
  }
}
