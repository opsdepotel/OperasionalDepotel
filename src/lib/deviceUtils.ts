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
 * Computes a stable, deterministic hardware & browser fingerprint seed.
 * This remains constant for the same device hardware even if local storage / site data is cleared.
 */
export function generateHardwareFingerprint(): string {
  if (typeof window === 'undefined') return 'DEV-FPRT-UNKNOWN';

  const nav = navigator as any;
  const screen = window.screen;

  const components = [
    nav.userAgent || '',
    nav.language || '',
    screen.width || 0,
    screen.height || 0,
    screen.colorDepth || 0,
    window.devicePixelRatio || 1,
    nav.hardwareConcurrency || 2,
    nav.maxTouchPoints || 0,
    Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  ];

  const rawString = components.join('|');
  let hash = 0;
  for (let i = 0; i < rawString.length; i++) {
    const char = rawString.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }

  const positiveHash = Math.abs(hash).toString(36).toUpperCase();
  const screenPart = `${screen.width || 0}x${screen.height || 0}`;
  return `DEV-FPRT-${screenPart}-${positiveHash}`;
}

/**
 * Syncs and locks the Device ID across all available persistence layers:
 * 1. localStorage ('op_app_device_id')
 * 2. localStorage backup ('op_app_device_id_backup')
 * 3. sessionStorage
 * 4. Document Cookie (10-year expiry)
 */
export function syncDeviceIdToAllStores(deviceId: string): void {
  if (typeof window === 'undefined' || !deviceId || !deviceId.trim()) return;
  const KEY = 'op_app_device_id';
  const BACKUP_KEY = 'op_app_device_id_backup';

  try {
    localStorage.setItem(KEY, deviceId);
    localStorage.setItem(BACKUP_KEY, deviceId);
    sessionStorage.setItem(KEY, deviceId);
    setCookie(KEY, deviceId, 3650);
  } catch (e) {
    console.warn('Storage sync error:', e);
  }
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

  // 3. Check Device ID binding when accessing from a mobile device for Mobile-only user
  let currentDeviceId = getOrCreateDeviceId();
  const emailKey = `op_app_user_bound_device_${user.email.toLowerCase().trim()}`;
  const localSavedBoundDevId = typeof localStorage !== 'undefined' ? localStorage.getItem(emailKey) : null;

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

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(emailKey, currentDeviceId);
    }

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
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(emailKey, dbDeviceId);
      }
      return {
        success: true,
        updatedUser: user
      };
    }

    // Check Auto-Recovery:
    // If localSavedBoundDevId matches dbDeviceId, restore dbDeviceId to current device stores
    if (localSavedBoundDevId && localSavedBoundDevId.trim().toLowerCase() === dbDeviceId.toLowerCase()) {
      syncDeviceIdToAllStores(dbDeviceId);
      return {
        success: true,
        updatedUser: user
      };
    }

    // If local device ID differs because storage was cleared or browser updated:
    // Since user successfully passed password authentication on a mobile device,
    // check if dbDeviceId is NOT bound to any OTHER active user in allProfiles
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

    // Auto-heal / Auto-update Device ID for this authenticated user on their mobile phone!
    console.info(`Auto-binding updated Device ID (${currentDevId}) for mobile user ${user.email}`);
    const updatedUser: UserProfile = {
      ...user,
      deviceId: currentDevId
    };

    syncDeviceIdToAllStores(currentDevId);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(emailKey, currentDevId);
    }

    if (saveProfileFn) {
      try {
        await saveProfileFn(updatedUser);
      } catch (err) {
        console.warn('Failed to auto-heal deviceId in sheet:', err);
      }
    }

    return {
      success: true,
      updatedUser
    };
  }
}

