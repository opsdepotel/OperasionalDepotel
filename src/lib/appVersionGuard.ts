/**
 * Automatic Safe Force-Reload Manager (Option 2: Auto-Reload Langsung)
 *
 * Detects new deployed builds via static CDN `/version.json` (0% serverless/CPU cost),
 * safely waits if a form submission or camera capture is currently in progress,
 * prevents infinite reload loops, and preserves all user sessions, Device ID vaults,
 * Push subscriptions, and offline IndexedDB queues.
 */

declare const __APP_BUILD_VERSION__: string;

const CURRENT_BUILD_VERSION: string =
  typeof __APP_BUILD_VERSION__ !== 'undefined' && __APP_BUILD_VERSION__
    ? __APP_BUILD_VERSION__
    : 'dev';

const RELOAD_GUARD_KEY = 'dioms_force_reload_guard';
const RELOAD_LOOP_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes anti-loop protection
const MIN_CHECK_INTERVAL_MS = 30 * 1000; // At most once every 30s on focus/resume
const PERIODIC_CHECK_INTERVAL_MS = 10 * 60 * 1000; // Gentle 10-minute check on static CDN file while tab visible
const BUSY_RETRY_DELAY_MS = 3000;

let isInitialized = false;
let isChecking = false;
let isReloading = false;
let lastCheckTimestamp = 0;
let pendingTargetVersion: string | null = null;
let busyRetryTimer: number | null = null;

interface ReloadGuardRecord {
  targetVersion: string;
  timestamp: number;
}

function readReloadGuard(): ReloadGuardRecord | null {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.targetVersion === 'string' &&
      typeof parsed.timestamp === 'number'
    ) {
      return parsed;
    }
  } catch {
    // Ignore storage errors on restricted webviews
  }
  return null;
}

function writeReloadGuard(targetVersion: string): void {
  try {
    const payload: ReloadGuardRecord = {
      targetVersion,
      timestamp: Date.now()
    };
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors
  }
}

function wasRecentlyReloadedFor(targetVersion: string): boolean {
  const prev = readReloadGuard();
  if (!prev) return false;
  return (
    prev.targetVersion === targetVersion &&
    Date.now() - prev.timestamp < RELOAD_LOOP_COOLDOWN_MS
  );
}

/**
 * Checks whether the user is in the middle of a sensitive operation
 * (active form submission/upload, active live camera capture, or incoming shared receipt)
 * so auto-reload never corrupts or interrupts an active save.
 */
function isBusyWithSensitiveOperation(): boolean {
  if (typeof document === 'undefined') return false;

  // 1. Active form submit button disabled (saving/uploading in progress)
  const activeDisabledSubmit = document.querySelector('form button[type="submit"]:disabled');
  if (activeDisabledSubmit) {
    const btnText = (activeDisabledSubmit.textContent || '').toLowerCase();
    // Ignore GPS-locked disabled submit buttons ("Simpan Kegiatan Harian" when GPS not ready);
    // only defer if actively saving/uploading/loading
    if (
      btnText.includes('menyimpan') ||
      btnText.includes('mengunggah') ||
      btnText.includes('mengirim') ||
      btnText.includes('memproses') ||
      btnText.includes('loading') ||
      Boolean(activeDisabledSubmit.querySelector('.animate-spin'))
    ) {
      return true;
    }
  }

  // 2. Active in-app live camera stream open
  const videos = document.querySelectorAll('video');
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i] as HTMLVideoElement;
    if (v && v.srcObject) {
      return true;
    }
  }

  // 3. Incoming PWA share target receipt currently being imported
  try {
    if (window.location.search.includes('shared_receipt=1')) {
      return true;
    }
  } catch {
    // Ignore
  }

  return false;
}

function showUpdatingToast(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dioms-auto-update-toast')) return;

  try {
    const toast = document.createElement('div');
    toast.id = 'dioms-auto-update-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = [
      'position:fixed',
      'top:16px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'background:#0f172a',
      'color:#ffffff',
      'padding:10px 16px',
      'border-radius:12px',
      'font-family:system-ui,-apple-system,sans-serif',
      'font-size:12px',
      'font-weight:700',
      'box-shadow:0 10px 25px rgba(15,23,42,0.35)',
      'border:1px solid rgba(99,102,241,0.5)',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'max-width:92vw',
      'pointer-events:none'
    ].join(';');
    toast.textContent = 'Memperbarui aplikasi ke versi terbaru...';
    document.body.appendChild(toast);
  } catch {
    // Non-blocking visual indicator
  }
}

/**
 * Clears only the cached HTML entry shell ('/' and '/index.html') from Cache API
 * so the reloaded page fetches the newest JS chunks.
 * Strictly preserves localStorage, sessionStorage, cookies, IndexedDB, and Push registrations.
 */
async function clearHtmlShellCacheOnly(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames.map(async (name) => {
        try {
          const cache = await window.caches.open(name);
          await Promise.all([
            cache.delete('/'),
            cache.delete('/index.html'),
            cache.delete(window.location.origin + '/'),
            cache.delete(window.location.origin + '/index.html')
          ]);
        } catch {
          // Ignore individual cache errors
        }
      })
    );
  } catch {
    // Ignore Cache API errors on unsupported browsers
  }
}

async function performSafeForceReload(targetVersion: string): Promise<void> {
  if (isReloading) return;
  if (wasRecentlyReloadedFor(targetVersion)) {
    return;
  }

  if (isBusyWithSensitiveOperation()) {
    pendingTargetVersion = targetVersion;
    scheduleBusyRetry();
    return;
  }

  isReloading = true;
  pendingTargetVersion = null;
  if (busyRetryTimer !== null) {
    window.clearTimeout(busyRetryTimer);
    busyRetryTimer = null;
  }

  writeReloadGuard(targetVersion);
  showUpdatingToast();

  await clearHtmlShellCacheOnly();

  window.setTimeout(() => {
    try {
      window.location.reload();
    } catch {
      window.location.href = window.location.href;
    }
  }, 350);
}

function scheduleBusyRetry(): void {
  if (busyRetryTimer !== null || !pendingTargetVersion || isReloading) return;
  busyRetryTimer = window.setTimeout(() => {
    busyRetryTimer = null;
    if (!pendingTargetVersion || isReloading) return;
    if (isBusyWithSensitiveOperation()) {
      scheduleBusyRetry();
    } else {
      void performSafeForceReload(pendingTargetVersion);
    }
  }, BUSY_RETRY_DELAY_MS);
}

export async function checkForAppUpdate(force = false): Promise<void> {
  if (typeof window === 'undefined' || isReloading || isChecking) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const now = Date.now();
  if (!force && now - lastCheckTimestamp < MIN_CHECK_INTERVAL_MS) {
    return;
  }

  isChecking = true;
  lastCheckTimestamp = now;

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`/version.json?t=${now}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache'
      },
      signal: controller.signal
    });

    window.clearTimeout(timeoutId);

    if (!res.ok) return;

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
      return;
    }

    const data = await res.json();
    const serverVersion =
      data && typeof data.version === 'string' ? data.version.trim() : '';

    if (!serverVersion || serverVersion === 'dev' || CURRENT_BUILD_VERSION === 'dev') {
      return;
    }

    if (serverVersion !== CURRENT_BUILD_VERSION) {
      await performSafeForceReload(serverVersion);
    }
  } catch {
    // Silent fail on network hiccup or offline transition — never disrupt the user
  } finally {
    isChecking = false;
  }
}

export function initAppVersionGuard(): void {
  if (typeof window === 'undefined' || isInitialized) return;
  isInitialized = true;

  // 1. Check shortly after initial mount (non-blocking)
  window.setTimeout(() => {
    void checkForAppUpdate(true);
  }, 2000);

  // 2. Check when user returns to app from background / another app
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (pendingTargetVersion) {
        void performSafeForceReload(pendingTargetVersion);
      } else {
        void checkForAppUpdate(false);
      }
    }
  });

  window.addEventListener('focus', () => {
    if (pendingTargetVersion) {
      void performSafeForceReload(pendingTargetVersion);
    } else {
      void checkForAppUpdate(false);
    }
  });

  // 3. Check when network reconnects (after brief delay so offline state settles cleanly)
  window.addEventListener('online', () => {
    window.setTimeout(() => {
      void checkForAppUpdate(false);
    }, 3000);
  });

  // 4. Instant recovery if a lazy-loaded Vite chunk fails due to a newly deployed build
  window.addEventListener('vite:preloadError', (event: Event) => {
    event.preventDefault();
    void checkForAppUpdate(true);
  });

  // 5. Gentle 10-minute check only while tab is visible & online (hits static CDN only)
  window.setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void checkForAppUpdate(false);
    }
  }, PERIODIC_CHECK_INTERVAL_MS);
}
