/**
 * Server-side Web Push Notification Manager (VAPID + web-push)
 * Compatible with local Express server, Docker containers, and Vercel Serverless Functions.
 */

import webpush from 'web-push';
import fs from 'fs';
import path from 'path';

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: PushSubscriptionKeys;
  expirationTime?: number | null;
}

export interface StoredSubscription {
  id: string;
  email: string;
  name?: string;
  role?: string;
  subscription: PushSubscriptionData;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  image?: string;
  tag?: string;
  url?: string;
  requestId?: string;
  extra?: Record<string, any>;
}

// Built-in verified VAPID keys for out-of-the-box readiness (can be overridden via ENV)
const DEFAULT_VAPID_PUBLIC_KEY =
  'BDaE9PDK_zk-N01Z9A8YQJ_CG96fqYXjNauVDSkln--2PghmKH5i8a8cMaywxemknjae9oPuqlknIt-nonGKTnk';
const DEFAULT_VAPID_PRIVATE_KEY =
  'iaI-S4gtd8D0OlnNgnkcm04I1AxJq67FxZ1V6QY_PDM';
const DEFAULT_VAPID_SUBJECT = 'mailto:ops.depotel@gmail.com';

export function getVapidDetails() {
  const publicKey =
    process.env.VAPID_PUBLIC_KEY ||
    process.env.VITE_VAPID_PUBLIC_KEY ||
    DEFAULT_VAPID_PUBLIC_KEY;
  const privateKey =
    process.env.VAPID_PRIVATE_KEY || DEFAULT_VAPID_PRIVATE_KEY;
  const subject =
    process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT;

  return { publicKey, privateKey, subject };
}

let isVapidInitialized = false;

function ensureVapidConfigured() {
  if (isVapidInitialized) return;
  const { publicKey, privateKey, subject } = getVapidDetails();
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    isVapidInitialized = true;
  } catch (err) {
    console.error('[WebPush] Error setting VAPID details:', err);
  }
}

// In-memory subscriptions cache with file backup in /tmp
const STORAGE_FILE_PATH = path.join('/tmp', 'dioms_push_subscriptions.json');
let inMemorySubscriptions: Map<string, StoredSubscription> = new Map();
let isLoadedFromFile = false;

function loadSubscriptionsFromDisk(): void {
  if (isLoadedFromFile) return;
  try {
    if (fs.existsSync(STORAGE_FILE_PATH)) {
      const raw = fs.readFileSync(STORAGE_FILE_PATH, 'utf-8');
      const list: StoredSubscription[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        list.forEach((sub) => {
          if (sub && sub.subscription?.endpoint) {
            inMemorySubscriptions.set(sub.subscription.endpoint, sub);
          }
        });
      }
    }
  } catch (err) {
    console.warn('[WebPush] Could not read subscriptions from disk:', err);
  }
  isLoadedFromFile = true;
}

function persistSubscriptionsToDisk(): void {
  try {
    const list = Array.from(inMemorySubscriptions.values());
    fs.writeFileSync(STORAGE_FILE_PATH, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[WebPush] Could not save subscriptions to disk:', err);
  }
}

export function saveSubscription(params: {
  email: string;
  name?: string;
  role?: string;
  subscription: PushSubscriptionData;
  userAgent?: string;
}): StoredSubscription {
  loadSubscriptionsFromDisk();

  const endpoint = params.subscription.endpoint;
  const existing = inMemorySubscriptions.get(endpoint);
  const now = new Date().toISOString();

  const record: StoredSubscription = {
    id: existing ? existing.id : 'sub_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    email: (params.email || '').toLowerCase().trim(),
    name: params.name || existing?.name || '',
    role: params.role || existing?.role || '',
    subscription: params.subscription,
    userAgent: params.userAgent || existing?.userAgent || '',
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };

  inMemorySubscriptions.set(endpoint, record);
  persistSubscriptionsToDisk();

  return record;
}

export function removeSubscriptionByEndpoint(endpoint: string): boolean {
  loadSubscriptionsFromDisk();
  const deleted = inMemorySubscriptions.delete(endpoint);
  if (deleted) {
    persistSubscriptionsToDisk();
  }
  return deleted;
}

export function getAllSubscriptions(): StoredSubscription[] {
  loadSubscriptionsFromDisk();
  return Array.from(inMemorySubscriptions.values());
}

export function getSubscriptionsForUser(email: string): StoredSubscription[] {
  loadSubscriptionsFromDisk();
  const normalized = (email || '').toLowerCase().trim();
  const userSubs = Array.from(inMemorySubscriptions.values()).filter(
    (s) => s.email.toLowerCase() === normalized
  );

  // Sort descending by updatedAt / createdAt (most recent first)
  userSubs.sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  const seenEndpoints = new Set<string>();
  const seenUserAgents = new Set<string>();
  const deduplicated: StoredSubscription[] = [];

  for (const sub of userSubs) {
    const endpoint = sub.subscription?.endpoint;
    if (!endpoint || seenEndpoints.has(endpoint)) continue;
    seenEndpoints.add(endpoint);

    const ua = (sub.userAgent || '').trim().toLowerCase();
    // If we've already included a newer active subscription for the same browser/userAgent, prune the older stale token
    if (ua && seenUserAgents.has(ua)) {
      inMemorySubscriptions.delete(endpoint);
      continue;
    }
    if (ua) {
      seenUserAgents.add(ua);
    }
    deduplicated.push(sub);
  }

  if (deduplicated.length < userSubs.length) {
    persistSubscriptionsToDisk();
  }

  return deduplicated;
}

export function getSubscriptionsForRole(role: string): StoredSubscription[] {
  loadSubscriptionsFromDisk();
  const normalized = (role || '').toUpperCase().trim();
  const roleSubs = Array.from(inMemorySubscriptions.values()).filter(
    (s) => (s.role || '').toUpperCase() === normalized
  );

  // Deduplicate by user email to ensure each distinct user with this role is only targeted once
  const distinctEmails = Array.from(new Set(roleSubs.map((s) => s.email.toLowerCase().trim())));
  const deduplicated: StoredSubscription[] = [];

  for (const userEmail of distinctEmails) {
    const userSubs = getSubscriptionsForUser(userEmail);
    deduplicated.push(...userSubs);
  }

  return deduplicated;
}

/**
 * Sends a push notification to a single PushSubscription with automatic dead subscription removal.
 */
export async function sendPushNotification(
  subscription: PushSubscriptionData,
  payload: NotificationPayload
): Promise<{ success: boolean; error?: string }> {
  ensureVapidConfigured();

  const pushPayload = JSON.stringify({
    title: payload.title || 'DIOMS Notifikasi Status UID',
    body: payload.body || 'Pembaruan kegiatan operasional.',
    icon: payload.icon || '/DIOMS-icon192.png',
    badge: payload.badge || '/DIOMS-icon192.png',
    image: payload.image,
    tag: payload.tag || 'dioms-notification',
    url: payload.url || '/',
    requestId: payload.requestId,
    extra: payload.extra || {},
    timestamp: Date.now(),
  });

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      pushPayload,
      {
        TTL: 60 * 60 * 24, // 24 hours
        urgency: 'high',
      }
    );
    return { success: true };
  } catch (error: any) {
    const statusCode = error?.statusCode;
    // 410 (Gone) or 404 (Not Found) means the push service has unregistered or expired this endpoint
    if (statusCode === 410 || statusCode === 404) {
      removeSubscriptionByEndpoint(subscription.endpoint);
    }
    return {
      success: false,
      error: error?.message || `Push failed with status ${statusCode}`,
    };
  }
}

/**
 * Sends push notification to all subscriptions of a specific user.
 */
export async function sendNotificationToUser(
  email: string,
  payload: NotificationPayload,
  fallbackSubscriptions?: any[]
): Promise<{ sent: number; failed: number }> {
  let subscriptions = getSubscriptionsForUser(email);

  // If none found in local storage, hydrate from fallbackSubscriptions (e.g. from Sheets Column N)
  if (subscriptions.length === 0 && fallbackSubscriptions && fallbackSubscriptions.length > 0) {
    for (const rawSub of fallbackSubscriptions) {
      if (rawSub && (rawSub.endpoint || rawSub.subscription?.endpoint)) {
        const subObj = rawSub.subscription || rawSub;
        if (subObj.endpoint && subObj.keys) {
          saveSubscription({
            email,
            subscription: subObj,
            userAgent: rawSub.userAgent || 'Restored from Column N',
          });
        }
      }
    }
    subscriptions = getSubscriptionsForUser(email);
  }

  let sent = 0;
  let failed = 0;

  for (const item of subscriptions) {
    const result = await sendPushNotification(item.subscription, payload);
    if (result.success) {
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Sends push notification to all users matching a specific role (e.g. FINANCE, MANAGER, DIREKTUR).
 */
export async function sendNotificationToRole(
  role: string,
  payload: NotificationPayload
): Promise<{ sent: number; failed: number }> {
  const subscriptions = getSubscriptionsForRole(role);
  let sent = 0;
  let failed = 0;

  for (const item of subscriptions) {
    const result = await sendPushNotification(item.subscription, payload);
    if (result.success) {
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Broadcast notification to all active devices.
 */
export async function broadcastNotification(
  payload: NotificationPayload
): Promise<{ sent: number; failed: number }> {
  const subscriptions = getAllSubscriptions();
  let sent = 0;
  let failed = 0;

  for (const item of subscriptions) {
    const result = await sendPushNotification(item.subscription, payload);
    if (result.success) {
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed };
}
