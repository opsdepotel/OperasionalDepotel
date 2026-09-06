/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface DevicePermissionsStatus {
  notification: PermissionState;
  geolocation: PermissionState;
  camera: PermissionState;
  allGranted: boolean;
  hasAnyDenied: boolean;
  hasAnyPrompt: boolean;
}

/**
 * Check browser notification permission status
 */
export async function checkNotificationPermission(): Promise<PermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const perm = Notification.permission;
    if (perm === 'granted') return 'granted';
    if (perm === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

/**
 * Check geolocation permission status
 */
export async function checkGeolocationPermission(): Promise<PermissionState> {
  if (typeof window === 'undefined' || !('geolocation' in navigator)) {
    return 'unsupported';
  }
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      return status.state;
    } catch {
      // Fall through if permissions.query throws in older browsers
    }
  }
  return 'prompt';
}

/**
 * Check camera permission status safely across all browsers (including Safari and Firefox)
 */
export async function checkCameraPermission(): Promise<PermissionState> {
  if (typeof window === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'unsupported';
  }

  // 1. Try permissions.query if supported
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      if (status && status.state) {
        return status.state;
      }
    } catch {
      // Browsers like Firefox and Safari throw TypeError because 'camera' is not in their PermissionName enum
    }
  }

  // 2. Fallback check: inspect device labels from enumerateDevices
  try {
    if (navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === 'videoinput');
      // If permission is already granted, video devices will have non-empty labels
      if (videoDevices.length > 0 && videoDevices.some((d) => d.label && d.label.trim().length > 0)) {
        return 'granted';
      }
    }
  } catch {
    // Ignore error
  }

  return 'prompt';
}

/**
 * Check all device permissions simultaneously
 */
export async function checkAllDevicePermissions(): Promise<DevicePermissionsStatus> {
  const [notification, geolocation, camera] = await Promise.all([
    checkNotificationPermission(),
    checkGeolocationPermission(),
    checkCameraPermission(),
  ]);

  const allGranted =
    (notification === 'granted' || notification === 'unsupported') &&
    (geolocation === 'granted' || geolocation === 'unsupported') &&
    (camera === 'granted' || camera === 'unsupported');

  const hasAnyDenied = notification === 'denied' || geolocation === 'denied' || camera === 'denied';
  const hasAnyPrompt = notification === 'prompt' || geolocation === 'prompt' || camera === 'prompt';

  return {
    notification,
    geolocation,
    camera,
    allGranted,
    hasAnyDenied,
    hasAnyPrompt,
  };
}

/**
 * Request notification permission from the user
 */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') return 'granted';
    if (result === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'denied';
  }
}

/**
 * Request geolocation permission from the user
 */
export async function requestGeolocationPermission(): Promise<PermissionState> {
  if (typeof window === 'undefined' || !('geolocation' in navigator)) {
    return 'unsupported';
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => {
        resolve('granted');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          resolve('denied');
        } else {
          // If error is timeout or position unavailable, permission was still technically prompt or granted
          resolve('prompt');
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  });
}

/**
 * Request camera permission from the user (and immediately release camera stream)
 */
export async function requestCameraPermission(): Promise<PermissionState> {
  if (typeof window === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'unsupported';
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    // Immediately stop all tracks to ensure camera light turns off right away
    stream.getTracks().forEach((track) => track.stop());
    return 'granted';
  } catch (err: any) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      return 'denied';
    }
    return 'prompt';
  }
}
