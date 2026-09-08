/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserProfile } from '../types';

/**
 * Utility function to check if the app is currently running on a mobile device (Android, iPhone, iPad, etc.)
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || !navigator) return false;
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || '';

  // Check specifically for mobile User Agent strings or mobile touch viewport
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Touch/i.test(ua);
  const isTouchScreen = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
  const isSmallScreen = typeof window !== 'undefined' && window.innerWidth <= 768;

  return isMobileUA || (isTouchScreen && isSmallScreen);
}

/**
 * Helper to get a cookie value
 */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Helper to set a cookie with long expiration (10 years)
 */
function setCookie(name: string, value: string, days = 3650) {
  if (typeof document === 'undefined') return;
  try {
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch (e) {
    console.warn('Failed to write cookie:', e);
  }
}

/**
 * Computes a unique, persistent hardware & device fingerprint seed.
 * Includes unique random entropy (UUID) combined with screen specs to ensure 
 * identical phone models (e.g. 2 Samsung A14 devices) do NOT get collision Device IDs.
 */
export function generateHardwareFingerprint(): string {
  if (typeof window === 'undefined') return 'DEV-FPRT-UNKNOWN';

  const screen = window.screen;
  const screenPart = `${screen.width || 0}x${screen.height || 0}`;
  
  // Use crypto.randomUUID if available, or timestamp + random seed
  let randomSeed = '';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    randomSeed = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  } else {
    randomSeed = (Date.now().toString(36) + Math.random().toString(36).substring(2, 6)).toUpperCase();
  }

  return `DEV-MOB-${screenPart}-${randomSeed}`;
}

/**
 * Automatically requests persistent storage from the browser via StorageManager API.
 * Ensures the browser marks the origin storage as 'persisted', preventing eviction under low-memory conditions.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.storage) {
    return false;
  }
  try {
    if (typeof navigator.storage.persisted === 'function') {
      const isAlreadyPersisted = await navigator.storage.persisted();
      if (isAlreadyPersisted) {
        return true;
      }
    }
    if (typeof navigator.storage.persist === 'function') {
      const persisted = await navigator.storage.persist();
      console.log('[StorageManager] Persistent storage status:', persisted ? 'PERSISTED' : 'BEST-EFFORT');
      return persisted;
    }
  } catch (err) {
    console.warn('[StorageManager] Unable to request persistent storage:', err);
  }
  return false;
}

/**
 * Syncs and locks the Device ID across all available persistence layers:
 * 1. localStorage ('op_app_device_id')
 * 2. localStorage backup ('op_app_device_id_backup')
 * 3. sessionStorage
 * 4. Document Cookie (10-year expiry)
 * 5. IndexedDB ('DIOMS_DEVICE_DB') for extreme durability against Safari/iOS ITP resets
 * 6. StorageManager Persistent Storage lock via navigator.storage.persist()
 */
export function syncDeviceIdToAllStores(deviceId: string, userEmail?: string): void {
  if (typeof window === 'undefined' || !deviceId || !deviceId.trim()) return;
  const KEY = 'op_app_device_id';
  const BACKUP_KEY = 'op_app_device_id_backup';

  try {
    localStorage.setItem(KEY, deviceId);
    localStorage.setItem(BACKUP_KEY, deviceId);
    sessionStorage.setItem(KEY, deviceId);
    setCookie(KEY, deviceId, 3650);
    if (userEmail && userEmail.trim()) {
      localStorage.setItem(`op_app_user_bound_device_${userEmail.toLowerCase().trim()}`, deviceId);
    }
  } catch (e) {
    console.warn('Storage sync error:', e);
  }

  // Non-blocking asynchronous sync to IndexedDB for Safari/iOS persistence
  saveDeviceIdToIndexedDB(deviceId, userEmail).catch(() => {});

  // Lock storage to persistent mode via StorageManager API
  requestPersistentStorage().catch(() => {});
}

/**
 * Opens or initializes the persistent IndexedDB for Device ID metadata.
 */
function openDeviceDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB not supported in this browser'));
      return;
    }
    try {
      const request = indexedDB.open('DIOMS_DEVICE_DB', 1);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('device_meta')) {
          db.createObjectStore('device_meta', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Reads persistent Device ID from IndexedDB.
 */
export async function getDeviceIdFromIndexedDB(): Promise<string | null> {
  try {
    const db = await openDeviceDB();
    return new Promise((resolve) => {
      const tx = db.transaction(['device_meta'], 'readonly');
      const store = tx.objectStore('device_meta');
      const req = store.get('op_device_id');
      req.onsuccess = () => {
        const res = req.result;
        if (res && res.value && typeof res.value === 'string' && res.value.trim()) {
          resolve(res.value.trim());
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Reads user-specific bound Device ID from IndexedDB.
 */
export async function getUserBoundDeviceIdFromIndexedDB(email: string): Promise<string | null> {
  if (!email || !email.trim()) return null;
  try {
    const db = await openDeviceDB();
    return new Promise((resolve) => {
      const tx = db.transaction(['device_meta'], 'readonly');
      const store = tx.objectStore('device_meta');
      const req = store.get(`bound_device_${email.toLowerCase().trim()}`);
      req.onsuccess = () => {
        const res = req.result;
        if (res && res.value && typeof res.value === 'string' && res.value.trim()) {
          resolve(res.value.trim());
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Saves persistent Device ID to IndexedDB.
 */
export async function saveDeviceIdToIndexedDB(deviceId: string, userEmail?: string): Promise<void> {
  if (!deviceId || !deviceId.trim()) return;
  try {
    const db = await openDeviceDB();
    return new Promise((resolve) => {
      const tx = db.transaction(['device_meta'], 'readwrite');
      const store = tx.objectStore('device_meta');
      store.put({ key: 'op_device_id', value: deviceId.trim(), updatedAt: Date.now() });
      if (userEmail && userEmail.trim()) {
        store.put({
          key: `bound_device_${userEmail.toLowerCase().trim()}`,
          value: deviceId.trim(),
          updatedAt: Date.now()
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore storage quota or disabled errors silently
  }
}

/**
 * Asynchronously gets or generates a persistent Device ID with IndexedDB multi-layer fallback.
 * Essential for Safari/iPhone where localStorage is often wiped by ITP or session changes.
 */
export async function getOrCreateDeviceIdAsync(userEmail?: string): Promise<string> {
  if (typeof window === 'undefined') return '';

  const KEY = 'op_app_device_id';
  const BACKUP_KEY = 'op_app_device_id_backup';

  // 1. Read from multi-layer synchronous storage
  let deviceId =
    localStorage.getItem(KEY) ||
    getCookie(KEY) ||
    sessionStorage.getItem(KEY) ||
    localStorage.getItem(BACKUP_KEY);

  // 2. If missing from synchronous storage, attempt recovery from persistent IndexedDB
  if (!deviceId || !deviceId.trim()) {
    const idbDeviceId = await getDeviceIdFromIndexedDB();
    if (idbDeviceId) {
      deviceId = idbDeviceId;
    } else if (userEmail) {
      const userBoundIdb = await getUserBoundDeviceIdFromIndexedDB(userEmail);
      if (userBoundIdb) {
        deviceId = userBoundIdb;
      }
    }
  }

  // 3. If completely missing from all storage, generate new hardware fingerprint
  if (!deviceId || !deviceId.trim()) {
    deviceId = generateHardwareFingerprint();
  }

  // 4. Re-sync to all storage layers (localStorage, cookie, sessionStorage, IndexedDB)
  syncDeviceIdToAllStores(deviceId, userEmail);

  return deviceId;
}

/**
 * Get or generate a persistent Device ID multi-stored across localStorage, cookies, and hardware fingerprint fallback.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return '';

  const KEY = 'op_app_device_id';
  const BACKUP_KEY = 'op_app_device_id_backup';

  // 1. Read from multi-layer storage
  let deviceId =
    localStorage.getItem(KEY) ||
    getCookie(KEY) ||
    sessionStorage.getItem(KEY) ||
    localStorage.getItem(BACKUP_KEY);

  // 2. If completely missing from all storage, fall back to stable hardware fingerprint
  if (!deviceId || !deviceId.trim()) {
    deviceId = generateHardwareFingerprint();
  }

  // 3. Re-sync to all storage layers so future reads hit high-speed storage
  syncDeviceIdToAllStores(deviceId);

  return deviceId;
}

export interface InAppBrowserInfo {
  isInApp: boolean;
  name: string;
  isIos: boolean;
}

/**
 * Detects if the current user is accessing the app from an In-App Browser (e.g. WhatsApp, Instagram, Telegram, LINE).
 * In-app browsers have isolated/volatile storage that wipes Device ID when closed.
 */
export function getInAppBrowserInfo(): InAppBrowserInfo {
  if (typeof window === 'undefined' || !navigator) {
    return { isInApp: false, name: '', isIos: false };
  }

  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || '';
  const isIos = /iPhone|iPad|iPod/i.test(ua);

  let name = '';
  if (/WhatsApp/i.test(ua)) {
    name = 'WhatsApp';
  } else if (/Instagram/i.test(ua)) {
    name = 'Instagram';
  } else if (/FBAN|FBAV|Facebook/i.test(ua)) {
    name = 'Facebook';
  } else if (/Telegram/i.test(ua)) {
    name = 'Telegram';
  } else if (/Line\//i.test(ua)) {
    name = 'LINE';
  } else if (/MicroMessenger/i.test(ua)) {
    name = 'WeChat';
  } else if (/TikTok/i.test(ua)) {
    name = 'TikTok';
  } else if (/GSA\//i.test(ua)) {
    name = 'Google App';
  } else if (isIos && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua)) {
    name = 'In-App Webview';
  }

  return {
    isInApp: Boolean(name),
    name: name || 'In-App Browser',
    isIos,
  };
}

/**
 * Detects if Safari / browser is currently operating in Private Browsing / Incognito mode.
 */
export async function detectPrivateBrowsing(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const isSafari = /Safari/i.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS|EdgiOS|Android/i.test(navigator.userAgent);

    // Method 1: Storage estimate quota check (Safari Private Mode in modern iOS severely limits quota, usually < 120MB)
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const quota = estimate.quota || 0;
      if (isSafari && quota > 0 && quota < 130 * 1024 * 1024) {
        return true;
      }
    }

    // Method 2: Test IndexedDB transaction in private browsing
    return new Promise((resolve) => {
      try {
        if (!('indexedDB' in window)) {
          resolve(false);
          return;
        }
        const testReq = indexedDB.open('__pvt_test_db');
        testReq.onsuccess = () => {
          try {
            testReq.result.close();
            indexedDB.deleteDatabase('__pvt_test_db');
          } catch {}
          resolve(false);
        };
        testReq.onerror = () => {
          resolve(true);
        };
      } catch {
        resolve(true);
      }
    });
  } catch {
    return false;
  }
}

/**
 * Validates device access based on Mobile (Boolean) flag and Device ID binding.
 * Includes auto-recovery if user's local storage was wiped on the same bound mobile device.
 */
export async function validateDeviceAccessAndBind(
  user: UserProfile,
  saveProfileFn?: (updated: UserProfile) => Promise<void>,
  allProfiles?: UserProfile[]
): Promise<{ success: boolean; errorMessage?: string; updatedUser?: UserProfile }> {
  const isUserMobileOnly =
    user.mobile === true ||
    String(user.mobile).trim().toUpperCase() === 'TRUE' ||
    String(user.mobile).trim().toUpperCase() === 'YA' ||
    String(user.mobile).trim() === '1';

  // 1. If Mobile is NOT set to TRUE, user can access from any device without Device ID check/binding
  if (!isUserMobileOnly) {
    return {
      success: true,
      updatedUser: user
    };
  }

  // 2. If Mobile IS set to TRUE, user MUST use a mobile device (Android/iPhone). PC/Windows is rejected.
  const isMobile = isMobileDevice();

  if (!isMobile) {
    return {
      success: false,
      errorMessage: 'Akses Ditolak: Akun Anda dikonfigurasi wajib menggunakan perangkat mobile (Android/iPhone). Login melalui PC/Windows tidak diizinkan.'
    };
  }

  // 3. Check Device ID binding using async multi-layer IndexedDB recovery
  let currentDeviceId = await getOrCreateDeviceIdAsync(user.email);
  const emailKey = `op_app_user_bound_device_${user.email.toLowerCase().trim()}`;
  const localSavedBoundDevId = typeof localStorage !== 'undefined' ? localStorage.getItem(emailKey) : null;
  const idbSavedBoundDevId = await getUserBoundDeviceIdFromIndexedDB(user.email);
  const idbGeneralDeviceId = await getDeviceIdFromIndexedDB();

  // Check if DB already has a deviceId for this user
  if (!user.deviceId || !user.deviceId.trim()) {
    // Device ID in database is empty:
    // Check if currentDeviceId is already bound/registered to another user profile that has Mobile = TRUE
    if (allProfiles && allProfiles.length > 0) {
      const boundOtherUser = allProfiles.find((p) => {
        const otherIsMobile =
          p.mobile === true ||
          String(p.mobile).trim().toUpperCase() === 'TRUE' ||
          String(p.mobile).trim().toUpperCase() === 'YA' ||
          String(p.mobile).trim() === '1';

        return (
          otherIsMobile &&
          p.deviceId &&
          p.deviceId.trim().toLowerCase() === currentDeviceId.trim().toLowerCase() &&
          (p.userId ? p.userId.toLowerCase() !== user.userId?.toLowerCase() : p.email.toLowerCase() !== user.email?.toLowerCase())
        );
      });

      if (boundOtherUser) {
        const otherName = boundOtherUser.nama || boundOtherUser.userId || boundOtherUser.email;
        return {
          success: false,
          errorMessage: `Akses Ditolak: Perangkat mobile ini (${currentDeviceId}) sudah terdaftar/terikat dengan akun User lain (${otherName}).`
        };
      }
    }

    // First time mobile access for this mobile user => Bind current Device ID!
    const updatedUser: UserProfile = {
      ...user,
      deviceId: currentDeviceId
    };

    syncDeviceIdToAllStores(currentDeviceId, user.email);

    if (saveProfileFn) {
      try {
        await saveProfileFn(updatedUser);
      } catch (err) {
        console.error('Gagal menyimpan Device ID ke database:', err);
      }
    }

    return {
      success: true,
      updatedUser
    };
  } else {
    // Device ID exists in database: Compare with current mobile device's ID
    const dbDeviceId = user.deviceId.trim();
    const currentDevId = currentDeviceId.trim();

    if (dbDeviceId.toLowerCase() === currentDevId.toLowerCase()) {
      // Direct match!
      syncDeviceIdToAllStores(dbDeviceId, user.email);
      return {
        success: true,
        updatedUser: user
      };
    }

    // Check Multi-Layer Auto-Recovery for Safari/iOS:
    // 1. From localStorage email key
    // 2. From IndexedDB user-bound key
    // 3. From IndexedDB general device_id
    const matchLocal = localSavedBoundDevId && localSavedBoundDevId.trim().toLowerCase() === dbDeviceId.toLowerCase();
    const matchIdbUser = idbSavedBoundDevId && idbSavedBoundDevId.trim().toLowerCase() === dbDeviceId.toLowerCase();
    const matchIdbGeneral = idbGeneralDeviceId && idbGeneralDeviceId.trim().toLowerCase() === dbDeviceId.toLowerCase();

    if (matchLocal || matchIdbUser || matchIdbGeneral) {
      console.log(`[DeviceUtils] Auto-Recovery berhasil me-restore Device ID (${dbDeviceId}) untuk ${user.email}`);
      syncDeviceIdToAllStores(dbDeviceId, user.email);
      return {
        success: true,
        updatedUser: user
      };
    }

    // If local device ID differs because storage was cleared or browser updated:
    // Check if currentDevId is already bound to another user
    const conflictUser = allProfiles?.find(p =>
      p.email.toLowerCase() !== user.email.toLowerCase() &&
      p.deviceId?.trim().toLowerCase() === currentDevId.toLowerCase()
    );

    if (conflictUser) {
      const otherName = conflictUser.nama || conflictUser.userId || conflictUser.email;
      return {
        success: false,
        errorMessage: `Akses Ditolak: Perangkat ini (${currentDevId}) sudah terikat dengan akun ${otherName}.`
      };
    }

    // If device ID differs and does not match bound device:
    // Reject access and require Admin to Reset Device ID
    console.warn(`Device mismatch for mobile user ${user.email}. Bound: ${dbDeviceId}, Current: ${currentDevId}`);
    return {
      success: false,
      errorMessage: `Akses Ditolak: Akun Anda telah terikat dengan perangkat lain (${dbDeviceId}). Untuk menggunakan HP ini (${currentDevId}), silakan hubungi Administrator untuk melakukan Reset Device ID.`
    };
  }
}

