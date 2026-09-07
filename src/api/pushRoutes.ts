import express from 'express';
import {
  getVapidDetails,
  saveSubscription,
  removeSubscriptionByEndpoint,
  getAllSubscriptions,
  sendNotificationToUser,
  sendNotificationToRole,
  broadcastNotification,
  sendPushNotification,
} from '../lib/serverPush.js';
import { syncSubscriptionToGoogleSheets } from '../lib/serverPushToSheets.js';

export const pushRouter = express.Router();

/**
 * Returns the VAPID Public Key for client-side subscription.
 */
pushRouter.get('/vapid-public-key', (req, res) => {
  try {
    const { publicKey } = getVapidDetails();
    res.json({
      success: true,
      publicKey,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message || 'Gagal mengambil VAPID Public Key.',
    });
  }
});

/**
 * Registers a new PushSubscription from the client PWA.
 */
pushRouter.post('/subscribe', (req, res) => {
  try {
    const { subscription, email, name, role } = req.body;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({
        success: false,
        error: 'Data subscription tidak valid (endpoint & keys wajib ada).',
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email user wajib disertakan untuk mengaitkan perangkat.',
      });
    }

    const userAgent = req.headers['user-agent'] || '';
    const record = saveSubscription({
      email,
      name,
      role,
      subscription,
      userAgent,
    });

    const clientToken = req.body?.clientToken || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : undefined);
    syncSubscriptionToGoogleSheets(email, subscription, {
      userAgent,
      clientToken,
    }).catch((err) => {
      console.warn('[WebPush Express] Sync to Google Sheets failed:', err);
    });

    res.json({
      success: true,
      subscriptionId: record.id,
      message: 'Perangkat berhasil didaftarkan untuk menerima push notifikasi.',
    });
  } catch (error: any) {
    console.error('[WebPush Router] Subscribe error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Gagal menyimpan data subscription perangkat.',
    });
  }
});

/**
 * Unsubscribes a device endpoint.
 */
pushRouter.post('/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        error: 'Endpoint subscription wajib disertakan.',
      });
    }

    const removed = removeSubscriptionByEndpoint(endpoint);
    res.json({
      success: true,
      removed,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message || 'Gagal menghapus subscription perangkat.',
    });
  }
});

/**
 * Sends a test push notification to a user's registered devices.
 */
pushRouter.post('/test', async (req, res) => {
  try {
    const { email, subscription, subscriptions, title, body } = req.body;

    const payload = {
      title: title || '🔔 Uji Coba Push Notifikasi Berhasil!',
      body: body || 'Perangkat Anda siap menerima notifikasi instan status UID dan operasional DIOMS.',
      tag: 'dioms-test-notification',
      url: '/?tab=dashboard',
    };

    if (subscription && subscription.endpoint) {
      // Direct test to provided subscription
      const result = await sendPushNotification(subscription, payload);
      return res.json({
        success: result.success,
        error: result.error,
        sent: result.success ? 1 : 0,
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email user atau subscription wajib disertakan untuk uji coba notifikasi.',
      });
    }

    const fallback = Array.isArray(subscriptions) ? subscriptions : (subscription ? [subscription] : undefined);
    const result = await sendNotificationToUser(email, payload, fallback);
    if (result.sent === 0 && result.failed === 0) {
      return res.json({
        success: false,
        sent: 0,
        error: 'Belum ada perangkat yang terdaftar dengan push notifikasi aktif untuk email ini. Silakan aktifkan izin notifikasi terlebih dahulu.',
      });
    }

    res.json({
      success: result.sent > 0,
      ...result,
      message: `${result.sent} notifikasi berhasil dikirim ke perangkat.`,
    });
  } catch (error: any) {
    console.error('[WebPush Router] Test push error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Gagal mengirim uji coba push notifikasi.',
    });
  }
});

// In-memory sliding window cache for push deduplication (prevents duplicate triggers within 8 seconds)
const recentPushes = new Map<string, number>();

function isDuplicatePush(key: string, windowMs = 8000): boolean {
  const now = Date.now();
  // Cleanup old entries (> 60s)
  for (const [k, timestamp] of recentPushes.entries()) {
    if (now - timestamp > 60000) {
      recentPushes.delete(k);
    }
  }
  const lastSent = recentPushes.get(key);
  if (lastSent && now - lastSent < windowMs) {
    return true;
  }
  recentPushes.set(key, now);
  return false;
}

/**
 * Sends push notification to a specific email, role, or broadcast.
 */
pushRouter.post('/send', async (req, res) => {
  try {
    const { email, role, broadcast, title, body, requestId, url, extra, subscriptions, subscription } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Title dan Body notifikasi wajib diisi.',
      });
    }

    // Exclude BBM Duren Sawit transactions from push notifications per business rules
    const isBbmDurenSawit =
      extra?.isBbmDurenSawit === true ||
      extra?.type === 'BBM_DUREN_SAWIT' ||
      (requestId && (requestId.toUpperCase().startsWith('BBMDS') || requestId.toUpperCase().includes('DUREN'))) ||
      (`${title} ${body}`.toUpperCase().includes('DUREN SAWIT') || `${title} ${body}`.toUpperCase().includes('BBMDS'));

    if (isBbmDurenSawit) {
      console.log('[WebPush Router] Push notification skipped for BBM Duren Sawit:', requestId || title);
      return res.json({
        success: true,
        sent: 0,
        failed: 0,
        skipped: true,
        message: 'Push notifikasi dikecualikan untuk transaksi BBM Duren Sawit.'
      });
    }

    // Deduplication key to prevent duplicate notifications fired within 8s for the same target + request + content
    const targetKey = email ? `email:${(email || '').toLowerCase().trim()}` : role ? `role:${role}` : 'broadcast';
    const dedupeKey = `${targetKey}:${requestId || 'noreq'}:${(title || '').trim()}:${(body || '').trim()}`;
    if (isDuplicatePush(dedupeKey, 8000)) {
      console.log('[WebPush Router] Duplicate push suppressed (dedupe cache hit):', dedupeKey);
      return res.json({
        success: true,
        sent: 1,
        failed: 0,
        duplicateSuppressed: true,
        message: 'Push notifikasi duplikat diabaikan (sudah dikirim dalam jendela waktu).'
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

    res.json({
      success: true,
      ...outcome,
    });
  } catch (error: any) {
    console.error('[WebPush Router] Send push error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Gagal mengirim push notifikasi.',
    });
  }
});

/**
 * Returns summary count of registered push subscriptions.
 */
pushRouter.get('/subscriptions', (req, res) => {
  try {
    const all = getAllSubscriptions();
    res.json({
      success: true,
      totalCount: all.length,
      users: Array.from(new Set(all.map((s) => s.email))),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message || 'Gagal memeriksa daftar subscription.',
    });
  }
});
