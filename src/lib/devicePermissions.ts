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

export interface DeviceEnvironmentInfo {
  tipePerangkat: string;
  infoBrowser: string;
  userAgent: string;
}

/**
 * Extracts concise, stable device, OS, browser, and PWA display-mode details
 * entirely in the browser (0 server overhead).
 */
export function getDeviceEnvironmentInfo(): DeviceEnvironmentInfo {
  if (typeof navigator === 'undefined') {
    return {
      tipePerangkat: 'Unknown',
      infoBrowser: 'Unknown',
      userAgent: '',
    };
  }

  const ua = String(navigator.userAgent || '').trim();
  const uaLower = ua.toLowerCase();

  // Detect OS and major version
  let osLabel = 'Unknown OS';
  const androidMatch = ua.match(/Android\s+([\d.]+)/i);
  const iosMatch = ua.match(/(?:iPhone|iPad|iPod).*?OS\s+(\d+)[_\d]*/i);
  const macMatch = ua.match(/Mac OS X\s+(\d+)[_.](\d+)/i);
  const winMatch = ua.match(/Windows NT\s+([\d.]+)/i);

  const isIPadDesktopMode =
    typeof navigator !== 'undefined' &&
    navigator.platform === 'MacIntel' &&
    (navigator.maxTouchPoints || 0) > 1;

  if (androidMatch) {
    osLabel = `Android ${androidMatch[1].split('.')[0]}`;
  } else if (iosMatch) {
    osLabel = `iOS ${iosMatch[1]}`;
  } else if (isIPadDesktopMode) {
    osLabel = 'iPadOS';
  } else if (winMatch) {
    osLabel = winMatch[1] === '10.0' ? 'Windows 10/11' : `Windows NT ${winMatch[1]}`;
  } else if (macMatch) {
    osLabel = `macOS ${macMatch[1]}.${macMatch[2]}`;
  } else if (uaLower.includes('cros')) {
    osLabel = 'ChromeOS';
  } else if (uaLower.includes('linux')) {
    osLabel = 'Linux';
  }

  // Detect Device Type
  let tipePerangkat = `Desktop (${osLabel})`;
  const isTablet =
    /iPad|Tablet|PlayBook|Silk/i.test(ua) ||
    isIPadDesktopMode ||
    (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile =
    !isTablet && /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);

  if (isTablet) {
    tipePerangkat = `Tablet (${osLabel})`;
  } else if (isMobile) {
    tipePerangkat = `Mobile (${osLabel})`;
  }

  // Detect Browser and major version
  let browserLabel = 'Browser Lainnya';
  const samsungMatch = ua.match(/SamsungBrowser\/(\d+)/i);
  const edgeMatch = ua.match(/Edg(?:A|iOS)?\/(\d+)/i);
  const operaMatch = ua.match(/(?:OPR|Opera)\/(\d+)/i);
  const firefoxMatch = ua.match(/(?:Firefox|FxiOS)\/(\d+)/i);
  const chromeIosMatch = ua.match(/CriOS\/(\d+)/i);
  const chromeMatch = ua.match(/Chrome\/(\d+)/i);
  const safariVersionMatch = ua.match(/Version\/(\d+)/i);
  const isWebView =
    /\bwv\b/i.test(ua) ||
    /FBAN|FBAV|Instagram|Line\/|MicroMessenger/i.test(ua);

  if (samsungMatch) {
    browserLabel = `Samsung Internet ${samsungMatch[1]}`;
  } else if (edgeMatch) {
    browserLabel = `Edge ${edgeMatch[1]}`;
  } else if (operaMatch) {
    browserLabel = `Opera ${operaMatch[1]}`;
  } else if (firefoxMatch) {
    browserLabel = `Firefox ${firefoxMatch[1]}`;
  } else if (chromeIosMatch) {
    browserLabel = `Chrome iOS ${chromeIosMatch[1]}`;
  } else if (chromeMatch && !uaLower.includes('edg')) {
    browserLabel = isWebView ? `Chrome WebView ${chromeMatch[1]}` : `Chrome ${chromeMatch[1]}`;
  } else if (uaLower.includes('safari') && !uaLower.includes('chrome')) {
    browserLabel = safariVersionMatch ? `Safari ${safariVersionMatch[1]}` : 'Safari';
  }

  // Detect PWA Standalone vs Regular Browser
  let isStandalone = false;
  try {
    isStandalone =
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      Boolean((navigator as any).standalone);
  } catch {
    isStandalone = false;
  }

  const modeLabel = isStandalone ? 'PWA Standalone' : 'Browser';
  const infoBrowser = `${browserLabel} | ${osLabel} | ${modeLabel}`;

  return {
    tipePerangkat,
    infoBrowser,
    userAgent: ua.slice(0, 250),
  };
}

/**
 * Builds a deterministic comparison key so permission logs are only sent
 * when one of the 3 permissions or device/browser environment actually changes.
 */
export function buildPermissionLogSignature(
  status: Pick<DevicePermissionsStatus, 'camera' | 'geolocation' | 'notification'>,
  env: Pick<DeviceEnvironmentInfo, 'tipePerangkat' | 'infoBrowser'>
): string {
  return [
    String(status.camera || 'prompt').trim().toLowerCase(),
    String(status.geolocation || 'prompt').trim().toLowerCase(),
    String(status.notification || 'prompt').trim().toLowerCase(),
    String(env.tipePerangkat || '').trim().toLowerCase(),
    String(env.infoBrowser || '').trim().toLowerCase(),
  ].join('|');
}

