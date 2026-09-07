/**
 * Client-side Web Push Notification Manager
 * Handles Service Worker PushManager subscription, VAPID key conversion,
 * and communication with DIOMS Push API.
 */

import { UserProfile } from '../types';
import { saveUserPushSubscriptionToSheet, SPREADSHEET_ID, SPREADSHEET_ID_KEY } from './googleApi';

const FALLBACK_VAPID_PUBLIC_KEY =
  'BDaE9PDK_zk-N01Z9A8YQJ_CG96fqYXjNauVDSkln--2PghmKH5i8a8cMaywxemknjae9oPuqlknIt-nonGKTnk';

/**
 * Converts a Base64 URL-safe string to a Uint8Array required by pushManager.subscribe.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Checks whether Web Push Notifications and Service Workers are supported by the browser.
 */
export function isPushNotificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Fetches the active VAPID Public Key from the server API.
 */
export async function getVapidPublicKey(): Promise<string> {
  const envKey = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY;
  if (envKey && envKey.trim().length > 20) {
    return envKey.trim();
  }

  try {
    const res = await fetch('/api/push/vapid-public-key');
    if (res.ok) {
      const data = await res.json();
      if (data && data.publicKey) {
        return data.publicKey;
      }
    }
  } catch (err) {
    console.warn('[WebPush Client] Failed to fetch VAPID key from server, using built-in key:', err);
  }

  return FALLBACK_VAPID_PUBLIC_KEY;
}

/**
 * Gets the current active PushSubscription if already registered in the browser.
 */
export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushNotificationSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch (err) {
    console.warn('[WebPush Client] Error getting current subscription:', err);
    return null;
  }
}

/**
 * Subscribes the current device/browser to Web Push Notifications and registers it with the backend.
 */
export async function subscribeToPushNotifications(
  user: UserProfile | { email: string; nama?: string; name?: string; role?: string }
): Promise<{ success: boolean; subscription?: PushSubscription; error?: string }> {
  if (!isPushNotificationSupported()) {
    return {
      success: false,
      error: 'Browser atau perangkat ini tidak mendukung fitur Web Push Notifications.',
    };
  }

  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        success: false,
        error: 'Izin notifikasi belum diberikan atau diblokir oleh browser.',
      };
    }
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const publicKey = await getVapidPublicKey();
    const convertedKey = urlBase64ToUint8Array(publicKey);

    // Retrieve existing or create new subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey,
      });
    }

    // Register subscription on backend
    const subJson = subscription.toJSON();
    const userName = (user as any).nama || (user as any).name || '';
    const userRole = (user as any).role || '';
    const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('g_access_token') || '' : '';
    const storedSheetId = typeof localStorage !== 'undefined' ? localStorage.getItem(SPREADSHEET_ID_KEY) || SPREADSHEET_ID : SPREADSHEET_ID;

    const payload = {
      subscription: subJson,
      email: user.email,
      name: userName,
      role: userRole,
      clientToken: storedToken,
    };

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server returned status ${res.status}`);
    }

    try {
      localStorage.setItem('dioms_push_subscribed', 'true');
      localStorage.setItem('dioms_push_email', user.email);
    } catch {}

    // Persist directly to Google Sheets Column N (PushSubscriptions) in Users sheet
    if (storedToken && storedSheetId && user.email) {
      saveUserPushSubscriptionToSheet(storedToken, storedSheetId, user.email, subJson, {
        deviceId: (user as any).deviceId || (typeof localStorage !== 'undefined' ? localStorage.getItem('op_device_id') || '' : '')
      }).catch((sheetErr) => {
        console.warn('[WebPush] Notice: Direct sync of push subscription to Google Sheets Column N deferred:', sheetErr);
      });
    }

    return {
      success: true,
      subscription,
    };
  } catch (error: any) {
    console.error('[WebPush Client] Subscription error:', error);
    return {
      success: false,
      error: error?.message || 'Gagal mengaktifkan push notifikasi pada perangkat.',
    };
  }
}

/**
 * Unsubscribes the current device from Web Push Notifications.
 */
export async function unsubscribeFromPushNotifications(): Promise<boolean> {
  if (!isPushNotificationSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      // Notify backend
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});

      try {
        localStorage.removeItem('dioms_push_subscribed');
      } catch {}

      return true;
    }
    return false;
  } catch (err) {
    console.warn('[WebPush Client] Unsubscribe failed:', err);
    return false;
  }
}

/**
 * Sends a test push notification to the current user or subscription.
 */
export async function sendTestPushNotification(
  userEmail: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const subscription = await getCurrentPushSubscription();
    const res = await fetch('/api/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userEmail,
        subscription: subscription ? subscription.toJSON() : undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Gagal mengirim pesan uji coba.',
      };
    }

    return {
      success: true,
      message: data.message || 'Notifikasi uji coba berhasil dikirim ke perangkat Anda.',
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Terjadi kesalahan saat memicu uji coba notifikasi.',
    };
  }
}

/**
 * Helper to check if a request or notification is for BBM Duren Sawit.
 * In accordance with business rules, BBM Duren Sawit transactions are excluded from push notifications.
 */
export function isBbmDurenSawitNotification(params: {
  requestId?: string;
  title?: string;
  body?: string;
  extra?: Record<string, any>;
}): boolean {
  if (params.extra?.isBbmDurenSawit || params.extra?.type === 'BBM_DUREN_SAWIT') return true;
  const reqId = (params.requestId || '').toUpperCase();
  if (reqId.startsWith('BBMDS') || reqId.includes('DUREN') || reqId.includes('BBM-DS')) return true;
  const text = `${params.title || ''} ${params.body || ''}`.toUpperCase();
  if (text.includes('DUREN SAWIT') || text.includes('BBMDS')) return true;
  return false;
}

/**
 * Triggers a push notification to a recipient user, role, or broadcast.
 */
export async function triggerPushNotification(params: {
  email?: string;
  role?: string;
  broadcast?: boolean;
  title: string;
  body: string;
  requestId?: string;
  url?: string;
  extra?: Record<string, any>;
}): Promise<{ success: boolean; sent?: number; failed?: number; error?: string }> {
  // Exclude BBM Duren Sawit from sending push notifications
  if (isBbmDurenSawitNotification(params)) {
    console.log('[WebPush Client] Push notifikasi dikecualikan untuk BBM Duren Sawit.');
    return { success: true, sent: 0, failed: 0 };
  }

  try {
    const res = await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'Gagal mengirim notifikasi.',
      };
    }

    return {
      success: true,
      sent: data.sent,
      failed: data.failed,
    };
  } catch (err: any) {
    console.warn('[WebPush Client] triggerPushNotification error:', err);
    return {
      success: false,
      error: err?.message || 'Jaringan gagal saat mengirim push notifikasi.',
    };
  }
}
