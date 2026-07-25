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

  // Check specifically for mobile User Agent strings (Android, iPhone, iPad, Mobile, etc.)
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
}

/**
 * Get or generate a persistent Device ID stored in localStorage.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let deviceId = localStorage.getItem('op_app_device_id');
  if (!deviceId) {
    const randomUuid = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    deviceId = randomUuid;
    localStorage.setItem('op_app_device_id', deviceId);
  }
  return deviceId;
}

/**
 * Validates device access based on Mobile (Boolean) flag and Device ID binding.
 * - If user.mobile === true, login is ONLY allowed from mobile devices (Android/iPhone). PC/Windows is rejected.
 * - If user logs in via a mobile device:
 *   - If user.deviceId is empty, binds the current mobile Device ID to user profile and saves it.
 *   - If user.deviceId has a value, compares with current mobile Device ID. Rejects login if different.
 */
export async function validateDeviceAccessAndBind(
  user: UserProfile,
  saveProfileFn?: (updated: UserProfile) => Promise<void>
): Promise<{ success: boolean; errorMessage?: string; updatedUser?: UserProfile }> {
  const isMobile = isMobileDevice();

  const isUserMobileOnly =
    user.mobile === true ||
    String(user.mobile).trim().toUpperCase() === 'TRUE' ||
    String(user.mobile).trim().toUpperCase() === 'YA' ||
    String(user.mobile).trim() === '1';

  // 1. Check Mobile (Boolean) constraint
  // If Mobile is TRUE, user MUST use a mobile device (Android/iPhone). Access from PC/Windows is rejected.
  if (isUserMobileOnly && !isMobile) {
    return {
      success: false,
      errorMessage: 'Akses Ditolak: Akun Anda dikonfigurasi wajib menggunakan perangkat mobile (Android/iPhone). Login melalui PC/Windows tidak diizinkan.'
    };
  }

  // 2. Check Device ID binding when accessing from a mobile device
  if (isMobile) {
    const currentDeviceId = getOrCreateDeviceId();

    if (!user.deviceId || !user.deviceId.trim()) {
      // Device ID in database is empty: First time mobile access => Bind current Device ID!
      const updatedUser: UserProfile = {
        ...user,
        deviceId: currentDeviceId
      };

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
      if (user.deviceId.trim() !== currentDeviceId.trim()) {
        return {
          success: false,
          errorMessage: `Akses Ditolak: Perangkat mobile ini (${currentDeviceId.substring(0, 8)}...) tidak sesuai dengan Device ID terikat di akun Anda (${user.deviceId.substring(0, 8)}...).`
        };
      }
    }
  }

  return {
    success: true,
    updatedUser: user
  };
}
