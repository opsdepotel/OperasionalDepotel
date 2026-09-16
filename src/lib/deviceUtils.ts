/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserProfile } from '../types';

export type DeviceType = 'Mobile' | 'Tablet' | 'Desktop';

export interface BrowserInfo {
  name: string;
  version: string;
}

export interface OperatingSystemInfo {
  name: string;
  version: string;
}

export interface DeviceEnvironmentInfo {
  browser: BrowserInfo;
  os: OperatingSystemInfo;
  deviceType: DeviceType;
  userAgent: string;
}

/**
 * Detects detailed browser information (Name and Version).
 */
export function getBrowserInfo(customUa?: string): BrowserInfo {
  if (typeof window === 'undefined' && !customUa) {
    return { name: 'Unknown', version: '' };
  }

  const ua = customUa || (typeof navigator !== 'undefined' ? (navigator.userAgent || navigator.vendor || (window as any).opera || '') : '');

  if (!ua) return { name: 'Unknown', version: '' };

  const matchVersion = (regex: RegExp): string => {
    const m = ua.match(regex);
    return m && m[1] ? m[1].replace(/_/g, '.') : '';
  };

  // 1. In-App Browsers
  if (/WhatsApp/i.test(ua)) {
    return { name: 'WhatsApp', version: matchVersion(/WhatsApp\/([\d.]+)/i) };
  }
  if (/Instagram/i.test(ua)) {
    return { name: 'Instagram', version: matchVersion(/Instagram[\s\/]([\d.]+)/i) };
  }
  if (/FBAN|FBAV|Facebook/i.test(ua)) {
    return { name: 'Facebook', version: matchVersion(/FBAV\/([\d.]+)/i) };
  }
  if (/Telegram/i.test(ua)) {
    return { name: 'Telegram', version: matchVersion(/Telegram[\s\/]([\d.]+)/i) };
  }
  if (/Line\//i.test(ua)) {
    return { name: 'LINE', version: matchVersion(/Line\/([\d.]+)/i) };
  }
  if (/MicroMessenger/i.test(ua)) {
    return { name: 'WeChat', version: matchVersion(/MicroMessenger\/([\d.]+)/i) };
  }
  if (/TikTok/i.test(ua)) {
    return { name: 'TikTok', version: matchVersion(/TikTok[\s\/]([\d.]+)/i) };
  }
  if (/GSA\//i.test(ua)) {
    return { name: 'Google App', version: matchVersion(/GSA\/([\d.]+)/i) };
  }

  // 2. Samsung Internet
  if (/SamsungBrowser/i.test(ua)) {
    return { name: 'Samsung Internet', version: matchVersion(/SamsungBrowser\/([\d.]+)/i) };
  }

  // 3. Microsoft Edge variants (EdgA, EdgiOS, Edg, Edge)
  if (/EdgA/i.test(ua)) {
    return { name: 'Edge', version: matchVersion(/EdgA\/([\d.]+)/i) };
  }
  if (/EdgiOS/i.test(ua)) {
    return { name: 'Edge', version: matchVersion(/EdgiOS\/([\d.]+)/i) };
  }
  if (/Edg\/|Edge\//i.test(ua)) {
    return { name: 'Edge', version: matchVersion(/(?:Edg|Edge)\/([\d.]+)/i) };
  }

  // 4. Opera variants (OPR, OPT, Opera Mini, Opera)
  if (/OPR\/|OPT\/|Opera/i.test(ua)) {
    return { name: 'Opera', version: matchVersion(/(?:OPR|OPT|Opera Mini|Opera)\/([\d.]+)/i) };
  }

  // 5. Firefox & Firefox iOS (FxiOS)
  if (/FxiOS/i.test(ua)) {
    return { name: 'Firefox', version: matchVersion(/FxiOS\/([\d.]+)/i) };
  }
  if (/Firefox/i.test(ua)) {
    return { name: 'Firefox', version: matchVersion(/Firefox\/([\d.]+)/i) };
  }

  // 6. Chrome & Chrome iOS (CriOS)
  if (/CriOS/i.test(ua)) {
    return { name: 'Chrome', version: matchVersion(/CriOS\/([\d.]+)/i) };
  }
  if (/Chrome\/|HeadlessChrome\//i.test(ua)) {
    return { name: 'Chrome', version: matchVersion(/(?:Chrome|HeadlessChrome)\/([\d.]+)/i) };
  }

  // 7. Safari (standalone)
  if (/Safari/i.test(ua) && !/Chrome|CriOS|Android/i.test(ua)) {
    const ver = matchVersion(/Version\/([\d.]+)/i) || matchVersion(/Safari\/([\d.]+)/i);
    return { name: 'Safari', version: ver };
  }

  return { name: 'Browser', version: '' };
}

/**
 * Detects Operating System information (Name and Version).
 */
export function getOperatingSystemInfo(customUa?: string): OperatingSystemInfo {
  if (typeof window === 'undefined' && !customUa) {
    return { name: 'Unknown', version: '' };
  }

  const ua = customUa || (typeof navigator !== 'undefined' ? (navigator.userAgent || navigator.vendor || (window as any).opera || '') : '');
  const platform = typeof navigator !== 'undefined' ? (navigator.platform || '') : '';
  const maxTouchPoints = typeof navigator !== 'undefined' ? (navigator.maxTouchPoints || 0) : 0;

  if (!ua && !platform) return { name: 'Unknown', version: '' };

  const matchVersion = (regex: RegExp): string => {
    const m = ua.match(regex);
    return m && m[1] ? m[1].replace(/_/g, '.') : '';
  };

  // 1. Android
  if (/Android/i.test(ua)) {
    return {
      name: 'Android',
      version: matchVersion(/Android\s+([\d.]+)/i)
    };
  }

  // 2. iPadOS (check explicit iPad or MacIntel with touch points)
  const isIpadUA = /iPad/i.test(ua);
  const isMacIntelTouch = /MacIntel|Macintosh/i.test(platform) && maxTouchPoints > 1;

  if (isIpadUA || isMacIntelTouch) {
    const ver = matchVersion(/CPU(?: iPad)? OS ([\d_]+)/i) || matchVersion(/Mac OS X ([\d_.]+)/i);
    return {
      name: 'iPadOS',
      version: ver
    };
  }

  // 3. iOS (iPhone / iPod)
  if (/iPhone|iPod/i.test(ua) || (/CPU OS \d+/i.test(ua) && !/Android/i.test(ua))) {
    return {
      name: 'iOS',
      version: matchVersion(/CPU(?: iPhone)? OS ([\d_]+)/i)
    };
  }

  // 4. Windows
  if (/Windows NT|Windows/i.test(ua) || /Win32|Win64|WOW64/i.test(platform)) {
    const winVer = matchVersion(/Windows NT\s+([\d.]+)/i);
    return {
      name: 'Windows',
      version: winVer
    };
  }

  // 5. ChromeOS
  if (/CrOS/i.test(ua)) {
    return {
      name: 'ChromeOS',
      version: matchVersion(/CrOS\s+[\w_]+\s+([\d.]+)/i)
    };
  }

  // 6. macOS (desktop Mac)
  if (/Macintosh|Mac OS X/i.test(ua) || /MacIntel|MacPPC|Mac68K/i.test(platform)) {
    return {
      name: 'macOS',
      version: matchVersion(/Mac OS X\s+([\d_.]+)/i)
    };
  }

  // 7. Linux
  if (/Linux|X11/i.test(ua) || /Linux/i.test(platform)) {
    return {
      name: 'Linux',
      version: ''
    };
  }

  return { name: 'Unknown', version: '' };
}

/**
 * Categorizes the device into 'Mobile', 'Tablet', or 'Desktop'.
 */
export function getDeviceType(customUa?: string): DeviceType {
  if (typeof window === 'undefined' && !customUa) {
    return 'Desktop';
  }

  const ua = customUa || (typeof navigator !== 'undefined' ? (navigator.userAgent || navigator.vendor || (window as any).opera || '') : '');
  const platform = typeof navigator !== 'undefined' ? (navigator.platform || '') : '';
  const maxTouchPoints = typeof navigator !== 'undefined' ? (navigator.maxTouchPoints || 0) : 0;

  // 1. iPhone / iPod -> Mobile
  if (/iPhone|iPod/i.test(ua)) {
    return 'Mobile';
  }

  // 2. iPad -> Tablet (including iPadOS modern reporting MacIntel with touch)
  if (/iPad/i.test(ua)) {
    return 'Tablet';
  }
  if (/MacIntel|Macintosh/i.test(platform) && maxTouchPoints > 1) {
    return 'Tablet';
  }

  // 3. Android:
  // - if User Agent contains "Mobile" -> Mobile
  // - if Android but does NOT contain "Mobile" -> Tablet
  if (/Android/i.test(ua)) {
    if (/Mobile/i.test(ua)) {
      return 'Mobile';
    }
    return 'Tablet';
  }

  // 4. Windows desktop/laptop -> Desktop
  if (/Windows NT|Windows/i.test(ua) || /Win32|Win64|WOW64/i.test(platform)) {
    return 'Desktop';
  }

  // 5. macOS desktop/laptop -> Desktop
  if (/Macintosh|Mac OS X/i.test(ua) || (/MacIntel/i.test(platform) && maxTouchPoints <= 1)) {
    return 'Desktop';
  }

  // 6. Linux desktop -> Desktop
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) {
    return 'Desktop';
  }

  // 7. ChromeOS -> Desktop or Tablet
  if (/CrOS/i.test(ua)) {
    if (/Mobile/i.test(ua)) {
      return 'Mobile';
    }
    if (/Tablet/i.test(ua)) {
      return 'Tablet';
    }
    return 'Desktop';
  }

  // 8. Other Mobile / Tablet UA keywords
  if (/webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return 'Mobile';
  }
  if (/Tablet|PlayBook|Silk/i.test(ua)) {
    return 'Tablet';
  }

  // 9. Fallback ONLY if OS/UA is completely unrecognized:
  const isTouchScreen = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0));
  const isSmallScreen = typeof window !== 'undefined' && window.innerWidth <= 768;

  if (isTouchScreen && isSmallScreen) {
    return 'Mobile';
  }

  return 'Desktop';
}

/**
 * Aggregates complete device environment information (browser, OS, deviceType, userAgent).
 */
export function getDeviceEnvironmentInfo(customUa?: string): DeviceEnvironmentInfo {
  const ua = customUa || (typeof navigator !== 'undefined' ? (navigator.userAgent || navigator.vendor || (window as any).opera || '') : '');
  const browser = getBrowserInfo(ua);
  const os = getOperatingSystemInfo(ua);
  const deviceType = getDeviceType(ua);

  return {
    browser,
    os,
    deviceType,
    userAgent: ua
  };
}

/**
 * Utility function to check if the app is currently running on a mobile or tablet device.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || !navigator) return false;
  const env = getDeviceEnvironmentInfo();
  return env.deviceType === 'Mobile' || env.deviceType === 'Tablet';
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
 * Fast, deterministic 8-character hex hash function.
 */
function hashString8(str: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hashVal = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return Math.abs(hashVal).toString(16).padStart(8, '0').slice(0, 8).toUpperCase();
}

/**
 * Computes a browser-agnostic hardware signature based on physical device characteristics
 * (screen resolution, pixel ratio, CPU cores, GPU WebGL renderer, timezone, language).
 * Remains identical across Chrome, Samsung Internet, Edge, Firefox, or PWA on the same phone.
 */
export function getBrowserAgnosticHardwareSignature(): string {
  if (typeof window === 'undefined') return 'HW-UNKNOWN';

  const screen = window.screen;
  const screenPart = `${screen.width || 0}x${screen.height || 0}x${screen.colorDepth || 24}`;
  const dpr = (window.devicePixelRatio || 1).toFixed(2);
  const cpuCores = navigator.hardwareConcurrency || 4;
  const tzOffset = new Date().getTimezoneOffset();
  const lang = (navigator.language || '').toLowerCase();

  // Extract WebGL GPU Unmasked Renderer String
  let gpuRenderer = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = (gl as any).getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        gpuRenderer = (gl as any).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
      }
    }
  } catch {}

  const rawHardwareString = `${screenPart}_DPR${dpr}_CPU${cpuCores}_GPU[${gpuRenderer}]_TZ${tzOffset}_LANG${lang}`;
  return hashString8(rawHardwareString);
}

/**
 * Computes a unique, persistent hardware & device fingerprint.
 * Combines browser-agnostic hardware signature with user email to ensure
 * identical phone models (e.g. 2 Samsung A14 devices) do NOT get collision Device IDs,
 * while ensuring switching browsers on the SAME phone produces the same Device ID.
 */
export function generateHardwareFingerprint(userEmail?: string): string {
  if (typeof window === 'undefined') return 'DEV-MOB-0x0-UNKNOWN';

  const screen = window.screen;
  const screenPart = `${screen.width || 0}x${screen.height || 0}`;
  const hwSig = getBrowserAgnosticHardwareSignature();

  let seedInput = hwSig;
  if (userEmail && userEmail.trim()) {
    seedInput = `${hwSig}_${userEmail.toLowerCase().trim()}`;
  }

  const seed = hashString8(seedInput);
  return `DEV-MOB-${screenPart}-${seed}`;
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

  const env = getDeviceEnvironmentInfo();
  const isIos = env.os.name === 'iOS' || env.os.name === 'iPadOS';

  let name = '';
  if (env.browser.name !== 'Browser' && env.browser.name !== 'Chrome' && env.browser.name !== 'Firefox' && env.browser.name !== 'Safari' && env.browser.name !== 'Edge' && env.browser.name !== 'Samsung Internet' && env.browser.name !== 'Opera') {
    name = env.browser.name;
  } else if (isIos && typeof navigator !== 'undefined' && /AppleWebKit/i.test(navigator.userAgent) && !/Safari/i.test(navigator.userAgent)) {
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

  // 2. If Mobile IS set to TRUE, user MUST use a mobile device (Android/iPhone/iPad). Desktop is rejected.
  const isMobile = isMobileDevice();

  if (!isMobile) {
    return {
      success: false,
      errorMessage: 'Akses Ditolak: Akun Anda dikonfigurasi wajib menggunakan perangkat mobile (Android/iPhone/iPad). Perangkat desktop tidak diizinkan.'
    };
  }

  // 3. Check Device ID binding using async multi-layer IndexedDB recovery and Option A hardware signature
  const stableHardwareDevId = generateHardwareFingerprint(user.email);
  let currentDeviceId = await getOrCreateDeviceIdAsync(user.email);
  const emailKey = `op_app_user_bound_device_${user.email.toLowerCase().trim()}`;
  const localSavedBoundDevId = typeof localStorage !== 'undefined' ? localStorage.getItem(emailKey) : null;
  const idbSavedBoundDevId = await getUserBoundDeviceIdFromIndexedDB(user.email);
  const idbGeneralDeviceId = await getDeviceIdFromIndexedDB();

  // Check if DB already has a deviceId for this user
  if (!user.deviceId || !user.deviceId.trim()) {
    // Device ID in database is empty:
    // Check if stableHardwareDevId is already bound/registered to another user profile that has Mobile = TRUE
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
          p.deviceId.trim().toLowerCase() === stableHardwareDevId.trim().toLowerCase() &&
          (p.userId ? p.userId.toLowerCase() !== user.userId?.toLowerCase() : p.email.toLowerCase() !== user.email?.toLowerCase())
        );
      });

      if (boundOtherUser) {
        const otherName = boundOtherUser.nama || boundOtherUser.userId || boundOtherUser.email;
        return {
          success: false,
          errorMessage: `Akses Ditolak: Perangkat mobile ini (${stableHardwareDevId}) sudah terdaftar/terikat dengan akun User lain (${otherName}).`
        };
      }
    }

    // First time mobile access for this mobile user => Bind stableHardwareDevId!
    const updatedUser: UserProfile = {
      ...user,
      deviceId: stableHardwareDevId
    };

    syncDeviceIdToAllStores(stableHardwareDevId, user.email);

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

    // Check 1: Direct match with currentDeviceId or stableHardwareDevId
    const isDirectMatch =
      dbDeviceId.toLowerCase() === currentDevId.toLowerCase() ||
      dbDeviceId.toLowerCase() === stableHardwareDevId.toLowerCase();

    if (isDirectMatch) {
      syncDeviceIdToAllStores(dbDeviceId, user.email);
      return {
        success: true,
        updatedUser: user
      };
    }

    // Check 2: Multi-Layer Auto-Recovery for Safari/iOS
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

    // Check 3: Multi-browser switching on same physical HP (Option A Hardware Signature Auto-Match)
    // If user opens Browser B (Samsung Internet, Edge, etc.) on the SAME physical HP:
    const conflictUser = allProfiles?.find(p =>
      (p.userId ? p.userId.toLowerCase() !== user.userId?.toLowerCase() : p.email.toLowerCase() !== user.email?.toLowerCase()) &&
      p.deviceId?.trim().toLowerCase() === stableHardwareDevId.toLowerCase()
    );

    if (!conflictUser) {
      // User is on their physical phone switching browsers or migrating!
      // Restore DB's registered deviceId into this browser's multi-vault storage
      console.log(`[DeviceUtils] Multi-Browser Hardware Match! Registering Device ID (${dbDeviceId}) in this browser for ${user.email}`);
      syncDeviceIdToAllStores(dbDeviceId, user.email);
      return {
        success: true,
        updatedUser: user
      };
    } else {
      const otherName = conflictUser.nama || conflictUser.userId || conflictUser.email;
      return {
        success: false,
        errorMessage: `Akses Ditolak: Perangkat ini sudah terikat dengan akun ${otherName}.`
      };
    }
  }
}


