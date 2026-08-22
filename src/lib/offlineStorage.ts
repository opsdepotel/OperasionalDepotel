import { UserActivity, UsageReportItem } from '../types';

const DB_NAME = 'dioms_offline_db';
const DB_VERSION = 1;
const STORE_ACTIVITIES = 'pending_activities';
const STORE_BBM = 'pending_bbm';

const LOCAL_STORAGE_OFFLINE_ACTIVITIES_KEY = 'op_app_offline_pending_activities';
const LOCAL_STORAGE_OFFLINE_BBM_KEY = 'op_app_offline_pending_bbm';
const LOCAL_STORAGE_CACHED_ACTIVITIES_KEY = 'op_app_cached_activities';

/**
 * Initialize IndexedDB instance
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_ACTIVITIES)) {
        db.createObjectStore(STORE_ACTIVITIES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BBM)) {
        db.createObjectStore(STORE_BBM, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Save pending activities to IndexedDB with localStorage fallback
 */
export async function savePendingActivities(activities: UserActivity[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_ACTIVITIES, 'readwrite');
    const store = tx.objectStore(STORE_ACTIVITIES);
    await new Promise<void>((resolve, reject) => {
      const clearReq = store.clear();
      clearReq.onerror = () => reject(clearReq.error);
      clearReq.onsuccess = () => {
        let count = activities.length;
        if (count === 0) {
          resolve();
          return;
        }
        let completed = 0;
        activities.forEach((act) => {
          const req = store.put(act);
          req.onsuccess = () => {
            completed++;
            if (completed === count) resolve();
          };
          req.onerror = () => reject(req.error);
        });
      };
    });
  } catch (err) {
    console.warn('IndexedDB write failed, falling back to localStorage:', err);
  }

  // Backup to localStorage with safe exception handling
  try {
    localStorage.setItem(LOCAL_STORAGE_OFFLINE_ACTIVITIES_KEY, JSON.stringify(activities));
  } catch (e) {
    console.warn('localStorage setItem failed (quota exceeded):', e);
  }
}

/**
 * Load pending activities from IndexedDB or localStorage
 */
export async function getPendingActivities(): Promise<UserActivity[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_ACTIVITIES, 'readonly');
    const store = tx.objectStore(STORE_ACTIVITIES);
    const result = await new Promise<UserActivity[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as UserActivity[]);
      req.onerror = () => reject(req.error);
    });
    if (result && result.length > 0) {
      return result;
    }
  } catch (err) {
    console.warn('IndexedDB read failed, falling back to localStorage:', err);
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_OFFLINE_ACTIVITIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

/**
 * Save pending BBM items
 */
export async function savePendingBbm(bbmList: UsageReportItem[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_BBM, 'readwrite');
    const store = tx.objectStore(STORE_BBM);
    await new Promise<void>((resolve, reject) => {
      const clearReq = store.clear();
      clearReq.onerror = () => reject(clearReq.error);
      clearReq.onsuccess = () => {
        let count = bbmList.length;
        if (count === 0) {
          resolve();
          return;
        }
        let completed = 0;
        bbmList.forEach((item) => {
          const req = store.put(item);
          req.onsuccess = () => {
            completed++;
            if (completed === count) resolve();
          };
          req.onerror = () => reject(req.error);
        });
      };
    });
  } catch (err) {
    console.warn('IndexedDB write BBM failed, falling back to localStorage:', err);
  }

  try {
    localStorage.setItem(LOCAL_STORAGE_OFFLINE_BBM_KEY, JSON.stringify(bbmList));
  } catch (e) {
    console.warn('localStorage setItem BBM failed:', e);
  }
}

/**
 * Get pending BBM items
 */
export async function getPendingBbm(): Promise<UsageReportItem[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_BBM, 'readonly');
    const store = tx.objectStore(STORE_BBM);
    const result = await new Promise<UsageReportItem[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as UsageReportItem[]);
      req.onerror = () => reject(req.error);
    });
    if (result && result.length > 0) {
      return result;
    }
  } catch (err) {
    console.warn('IndexedDB read BBM failed, falling back to localStorage:', err);
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_OFFLINE_BBM_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

/**
 * Safely cache display activities to localStorage without quota errors.
 * Large base64 photo strings are stripped or truncated for display cache.
 */
export function safelyCacheActivities(activities: UserActivity[]): void {
  if (!activities || activities.length === 0) return;

  try {
    const lightweightActivities = activities.slice(0, 40).map((act) => {
      if (act.buktiUrl && act.buktiUrl.startsWith('data:') && act.buktiUrl.length > 20000) {
        return {
          ...act,
          buktiUrl: act.isOfflinePending ? act.buktiUrl.slice(0, 15000) : ''
        };
      }
      return act;
    });

    localStorage.setItem(LOCAL_STORAGE_CACHED_ACTIVITIES_KEY, JSON.stringify(lightweightActivities));
  } catch (e) {
    console.warn('Failed to save to op_app_cached_activities quota, clearing cache:', e);
    try {
      localStorage.removeItem(LOCAL_STORAGE_CACHED_ACTIVITIES_KEY);
    } catch (_) {}
  }
}
