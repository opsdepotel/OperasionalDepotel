/**
 * IndexedDB + LocalStorage Offline Storage Utility for Reports and Talangan Requests
 * Ensures photos and report items are safely queued on device when offline or network is weak.
 */

export interface OfflineTalanganRequest {
  id: string; // Temp ID e.g. OFFLINE-TALANGAN-1700000000000
  timestamp: string;
  userEmail: string;
  managerEmail: string;
  tanggalPemakaian: string;
  siteId: string;
  jumlahPengajuan: number;
  keterangan: string;
  
  // First report item details for Dana Talangan
  itemTanggal: string;
  itemNominal: number;
  itemKeterangan: string;
  photoDataUrl: string;
  photoBlob?: Blob; // Memory-safe binary blob for IndexedDB
  photoFileName: string;
}

export interface OfflineUsageItem {
  id: string; // Temp ID e.g. OFFLINE-USAGE-1700000000000
  timestamp: string;
  requestId: string;
  tanggalPenggunaan: string;
  nominal: number;
  keterangan: string;
  userEmail: string;
  
  photoDataUrl: string;
  photoBlob?: Blob; // Memory-safe binary blob for IndexedDB
  photoFileName: string;
}

export interface OfflineActivityItem {
  id: string; // Temp ID e.g. OFFLINE-ACT-1700000000000
  timestamp: string;
  tanggal: string;
  siteId: string;
  siteName: string;
  coordinatesDb: string;
  coordinatesActual: string;
  keterangan: string;
  indikasiFake?: boolean;
  fakeReason?: string;
  userEmail: string;
  userName?: string;
  photoDataUrl: string;
  photoBlob?: Blob; // Memory-safe binary blob for IndexedDB
  photoFileName: string;
}

export interface OfflineBbmRefill {
  id: string; // Temp ID e.g. OFFLINE-BBM-1700000000000
  timestamp: string;
  userEmail: string;
  managerEmail: string;
  tanggal: string;
  siteId: string;
  siteName: string;
  nominal: number;
  keterangan: string;
  photoDataUrl: string;
  photoBlob?: Blob; // Memory-safe binary blob for IndexedDB
  photoFileName: string;
  reqPayload: any;
  reportItemPayload: any;
}

const DB_NAME = 'DIOMS_OFFLINE_REPORTS_DB';
const DB_VERSION = 2;
const STORE_TALANGAN = 'offline_talangan_requests';
const STORE_USAGE = 'offline_usage_items';
const STORE_ACTIVITIES = 'offline_activities';
const STORE_BBM = 'offline_bbm_refills';

const LS_KEY_TALANGAN = 'op_app_offline_talangan_requests';
const LS_KEY_USAGE = 'op_app_offline_usage_items';
const LS_KEY_ACTIVITIES = 'op_app_offline_activities';
const LS_KEY_BBM = 'op_app_offline_bbm';

// Utility to open or initialize IndexedDB safely
function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB tidak didukung oleh browser ini.'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_TALANGAN)) {
        db.createObjectStore(STORE_TALANGAN, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_USAGE)) {
        db.createObjectStore(STORE_USAGE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ACTIVITIES)) {
        db.createObjectStore(STORE_ACTIVITIES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BBM)) {
        db.createObjectStore(STORE_BBM, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Gagal membuka IndexedDB offline database.'));
  });
}

/**
 * Clean up Canvas and Image elements from GPU memory
 */
function cleanUpMemory(canvas: HTMLCanvasElement | null, img: HTMLImageElement | null) {
  if (img) {
    img.onload = null;
    img.onerror = null;
    img.src = '';
  }
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Compress image file to both Blob and base64 Data URL (max 1200px width/height, quality 0.75) for memory-safe storage.
 */
export async function compressFileToBlobAndDataUrl(file: File | Blob): Promise<{ dataUrl: string; blob: Blob }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1200;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
              const finalBlob = blob || new Blob([file], { type: 'image/jpeg' });
              cleanUpMemory(canvas, img);
              resolve({ dataUrl, blob: finalBlob });
            },
            'image/jpeg',
            0.75
          );
        } else {
          const fallbackUrl = (e.target?.result as string) || '';
          cleanUpMemory(canvas, img);
          resolve({ dataUrl: fallbackUrl, blob: new Blob([file], { type: 'image/jpeg' }) });
        }
      };
      img.onerror = () => {
        const fallbackUrl = (e.target?.result as string) || '';
        cleanUpMemory(null, img);
        resolve({ dataUrl: fallbackUrl, blob: new Blob([file], { type: 'image/jpeg' }) });
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve({ dataUrl: '', blob: new Blob() });
    reader.readAsDataURL(file);
  });
}

/**
 * Compress image file to base64 Data URL (max 1200px width/height, quality 0.75) for efficient offline storage.
 */
export async function compressFileToDataUrl(file: File | Blob): Promise<string> {
  const result = await compressFileToBlobAndDataUrl(file);
  return result.dataUrl;
}

/**
 * Convert Blob to Base64 Data URL sequentially (Batched Sequential Hydration - Opsi 1)
 */
export async function blobToDataUrlSequentially(blob: Blob): Promise<string> {
  if (!blob || !(blob instanceof Blob)) return '';
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      reader.onloadend = null;
      reader.onerror = null;
      resolve(result);
    };
    reader.onerror = () => {
      reader.onloadend = null;
      reader.onerror = null;
      resolve('');
    };
    try {
      reader.readAsDataURL(blob);
    } catch {
      resolve('');
    }
  });
}

/**
 * Lazy Object URL generator (Opsi 2) for instant, low-RAM UI previews
 */
export function createLazyReportObjectUrl(item: { photoBlob?: Blob; photoDataUrl?: string }): string {
  if (item.photoBlob && typeof window !== 'undefined' && window.URL && window.URL.createObjectURL) {
    try {
      return window.URL.createObjectURL(item.photoBlob);
    } catch {
      // fallback to data url
    }
  }
  return item.photoDataUrl || '';
}

/**
 * Revoke Lazy Object URL to free browser memory
 */
export function revokeLazyReportObjectUrl(url: string) {
  if (url && url.startsWith('blob:') && typeof window !== 'undefined' && window.URL && window.URL.revokeObjectURL) {
    try {
      window.URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}

/**
 * Convert Base64 Data URL or direct Blob back to JS File object for uploading to Google Drive
 */
export function dataURLtoFile(dataUrl: string, filename: string, fallbackBlob?: Blob): File {
  // Fast path: if binary Blob is already present, instantiate File directly to save CPU and RAM
  if (fallbackBlob && fallbackBlob instanceof Blob && fallbackBlob.size > 0) {
    try {
      return new File([fallbackBlob], filename || 'nota.jpg', {
        type: fallbackBlob.type || 'image/jpeg'
      });
    } catch {
      // If File constructor fails in older webviews, fall through to base64 parser
    }
  }

  if (!dataUrl || !dataUrl.includes(',')) {
    if (fallbackBlob && fallbackBlob instanceof Blob) {
      return new File([fallbackBlob], filename || 'nota.jpg', { type: 'image/jpeg' });
    }
    return new File([new Blob()], filename || 'nota.jpg', { type: 'image/jpeg' });
  }

  try {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  } catch (err) {
    console.warn('Error converting Data URL to File, returning fallback empty file:', err);
    if (fallbackBlob && fallbackBlob instanceof Blob) {
      return new File([fallbackBlob], filename || 'nota.jpg', { type: 'image/jpeg' });
    }
    return new File([new Blob()], filename || 'nota.jpg', { type: 'image/jpeg' });
  }
}

// LocalStorage helpers with safe JSON
function safeSetLS<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn(`LocalStorage quota warning for key ${key}:`, e);
  }
}

function safeGetLS<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch (e) {
    return fallback;
  }
}

/* =========================================================================
   OFFLINE DANA TALANGAN REQUESTS (OPT-...)
   ========================================================================= */

export async function saveOfflineTalanganRequest(
  data: {
    userEmail: string;
    managerEmail: string;
    tanggalPemakaian: string;
    siteId: string;
    jumlahPengajuan: number;
    keterangan: string;
    itemTanggal: string;
    itemNominal: number;
    itemKeterangan: string;
  },
  photoFile: File | Blob
): Promise<OfflineTalanganRequest> {
  const { dataUrl: photoDataUrl, blob: photoBlob } = await compressFileToBlobAndDataUrl(photoFile);
  const photoFileName = (photoFile as File).name || `nota_talangan_${Date.now()}.jpg`;

  const item: OfflineTalanganRequest = {
    id: `OFFLINE-TALANGAN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    userEmail: data.userEmail,
    managerEmail: data.managerEmail,
    tanggalPemakaian: data.tanggalPemakaian,
    siteId: data.siteId,
    jumlahPengajuan: data.jumlahPengajuan,
    keterangan: data.keterangan,
    itemTanggal: data.itemTanggal,
    itemNominal: data.itemNominal,
    itemKeterangan: data.itemKeterangan,
    photoDataUrl,
    photoBlob,
    photoFileName
  };

  // 1. Try saving to IndexedDB (Opsi 1 optimized: store photoBlob directly, avoid keeping heavy base64 in store to minimize RAM footprint)
  let savedToIndexedDb = false;
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_TALANGAN, 'readwrite');
    const store = tx.objectStore(STORE_TALANGAN);
    const idbRecord: OfflineTalanganRequest = {
      ...item,
      photoDataUrl: '' // Cleared in DB record so only binary photoBlob is persisted
    };
    store.put(idbRecord);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    savedToIndexedDb = true;
  } catch (err) {
    console.warn('Gagal menyimpan Talangan Offline ke IndexedDB, menggunakan LocalStorage:', err);
  }

  // 2. Sync to LocalStorage list (mirror metadata)
  // If IndexedDB succeeded, strip photoDataUrl to prevent 5MB LocalStorage QuotaExceededError.
  // If IndexedDB failed, retain photoDataUrl as emergency rescue fallback.
  const existing = safeGetLS<OfflineTalanganRequest[]>(LS_KEY_TALANGAN, []);
  const lsItem = {
    ...item,
    photoBlob: undefined,
    photoDataUrl: savedToIndexedDb ? '' : item.photoDataUrl
  };
  const updated = [lsItem, ...existing.filter(i => i.id !== item.id)];
  safeSetLS(LS_KEY_TALANGAN, updated);

  return item;
}

export async function getOfflineTalanganRequests(): Promise<OfflineTalanganRequest[]> {
  let rawList: OfflineTalanganRequest[] = [];
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_TALANGAN, 'readonly');
    const store = tx.objectStore(STORE_TALANGAN);
    const req = store.getAll();
    rawList = await new Promise<OfflineTalanganRequest[]>((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    // fallback
  }

  if (!rawList || rawList.length === 0) {
    rawList = safeGetLS<OfflineTalanganRequest[]>(LS_KEY_TALANGAN, []);
  }

  // Batched Sequential Hydration (Opsi 1): Process Blob to DataUrl sequentially to avoid RAM overload
  const hydratedList: OfflineTalanganRequest[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item.photoDataUrl && item.photoBlob) {
      try {
        const dataUrl = await blobToDataUrlSequentially(item.photoBlob);
        hydratedList.push({ ...item, photoDataUrl: dataUrl });
      } catch {
        hydratedList.push(item);
      }
    } else {
      hydratedList.push(item);
    }

    // Yield control to the browser event loop every 3 items to guarantee smooth UI and avoid blocking the main thread
    if (i % 3 === 2 && i < rawList.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return hydratedList;
}

export async function removeOfflineTalanganRequest(id: string): Promise<void> {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_TALANGAN, 'readwrite');
    const store = tx.objectStore(STORE_TALANGAN);
    store.delete(id);
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
  } catch (err) {
    console.warn('Gagal menghapus Talangan Offline dari IndexedDB:', err);
  }

  const existing = safeGetLS<OfflineTalanganRequest[]>(LS_KEY_TALANGAN, []);
  const updated = existing.filter(i => i.id !== id);
  safeSetLS(LS_KEY_TALANGAN, updated);
}

/* =========================================================================
   OFFLINE USAGE REPORT ITEMS (Laporan Pemakaian Dana)
   ========================================================================= */

export async function saveOfflineUsageItem(
  data: {
    requestId: string;
    tanggalPenggunaan: string;
    nominal: number;
    keterangan: string;
    userEmail: string;
  },
  photoFile: File | Blob
): Promise<OfflineUsageItem> {
  const { dataUrl: photoDataUrl, blob: photoBlob } = await compressFileToBlobAndDataUrl(photoFile);
  const photoFileName = (photoFile as File).name || `nota_pemakaian_${Date.now()}.jpg`;

  const item: OfflineUsageItem = {
    id: `OFFLINE-USAGE-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    requestId: data.requestId,
    tanggalPenggunaan: data.tanggalPenggunaan,
    nominal: data.nominal,
    keterangan: data.keterangan,
    userEmail: data.userEmail,
    photoDataUrl,
    photoBlob,
    photoFileName
  };

  // 1. Try saving to IndexedDB (Opsi 1 optimized: store photoBlob directly, avoid keeping heavy base64 in store to minimize RAM footprint)
  let savedToIndexedDb = false;
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_USAGE, 'readwrite');
    const store = tx.objectStore(STORE_USAGE);
    const idbRecord: OfflineUsageItem = {
      ...item,
      photoDataUrl: '' // Cleared in DB record so only binary photoBlob is persisted
    };
    store.put(idbRecord);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    savedToIndexedDb = true;
  } catch (err) {
    console.warn('Gagal menyimpan Item Laporan Offline ke IndexedDB, menggunakan LocalStorage:', err);
  }

  // 2. Sync to LocalStorage list (mirror metadata)
  // If IndexedDB succeeded, strip photoDataUrl to prevent 5MB LocalStorage QuotaExceededError.
  // If IndexedDB failed, retain photoDataUrl as emergency rescue fallback.
  const existing = safeGetLS<OfflineUsageItem[]>(LS_KEY_USAGE, []);
  const lsItem = {
    ...item,
    photoBlob: undefined,
    photoDataUrl: savedToIndexedDb ? '' : item.photoDataUrl
  };
  const updated = [lsItem, ...existing.filter(i => i.id !== item.id)];
  safeSetLS(LS_KEY_USAGE, updated);

  return item;
}

export async function getOfflineUsageItems(): Promise<OfflineUsageItem[]> {
  let rawList: OfflineUsageItem[] = [];
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_USAGE, 'readonly');
    const store = tx.objectStore(STORE_USAGE);
    const req = store.getAll();
    rawList = await new Promise<OfflineUsageItem[]>((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    // fallback
  }

  if (!rawList || rawList.length === 0) {
    rawList = safeGetLS<OfflineUsageItem[]>(LS_KEY_USAGE, []);
  }

  // Batched Sequential Hydration (Opsi 1): Process Blob to DataUrl sequentially to avoid RAM overload
  const hydratedList: OfflineUsageItem[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item.photoDataUrl && item.photoBlob) {
      try {
        const dataUrl = await blobToDataUrlSequentially(item.photoBlob);
        hydratedList.push({ ...item, photoDataUrl: dataUrl });
      } catch {
        hydratedList.push(item);
      }
    } else {
      hydratedList.push(item);
    }

    // Yield control to the browser event loop every 3 items to guarantee smooth UI and avoid blocking the main thread
    if (i % 3 === 2 && i < rawList.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return hydratedList;
}

export async function removeOfflineUsageItem(id: string): Promise<void> {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_USAGE, 'readwrite');
    const store = tx.objectStore(STORE_USAGE);
    store.delete(id);
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
  } catch (err) {
    console.warn('Gagal menghapus Item Laporan Offline dari IndexedDB:', err);
  }

  const existing = safeGetLS<OfflineUsageItem[]>(LS_KEY_USAGE, []);
  const updated = existing.filter(i => i.id !== id);
  safeSetLS(LS_KEY_USAGE, updated);
}

/**
 * Helper to convert Base64 Data URL to Blob
 */
export function dataURLtoBlob(dataUrl: string): Blob {
  if (!dataUrl || !dataUrl.includes(',')) {
    return new Blob([], { type: 'image/jpeg' });
  }
  try {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch {
    return new Blob([], { type: 'image/jpeg' });
  }
}

/* =========================================================================
   OFFLINE ACTIVITY LOGS (Laporan Kegiatan Harian)
   ========================================================================= */

export async function saveOfflineActivityLog(
  data: {
    tanggal: string;
    siteId: string;
    siteName: string;
    coordinatesDb: string;
    coordinatesActual: string;
    keterangan: string;
    indikasiFake?: boolean;
    fakeReason?: string;
    userEmail: string;
    userName?: string;
  },
  photoFileOrDataUrl: File | Blob | string
): Promise<OfflineActivityItem> {
  let photoFile: File | Blob;
  let fileName = `kegiatan_offline_${Date.now()}.jpg`;

  if (typeof photoFileOrDataUrl === 'string') {
    photoFile = dataURLtoBlob(photoFileOrDataUrl);
  } else {
    photoFile = photoFileOrDataUrl;
    fileName = (photoFile as File).name || fileName;
  }

  const { dataUrl: photoDataUrl, blob: photoBlob } = await compressFileToBlobAndDataUrl(photoFile);

  const item: OfflineActivityItem = {
    id: `OFFLINE-ACT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    tanggal: data.tanggal,
    siteId: data.siteId,
    siteName: data.siteName,
    coordinatesDb: data.coordinatesDb,
    coordinatesActual: data.coordinatesActual,
    keterangan: data.keterangan,
    indikasiFake: data.indikasiFake,
    fakeReason: data.fakeReason,
    userEmail: data.userEmail,
    userName: data.userName || data.userEmail,
    photoDataUrl,
    photoBlob,
    photoFileName: fileName
  };

  let savedToIndexedDb = false;
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_ACTIVITIES, 'readwrite');
    const store = tx.objectStore(STORE_ACTIVITIES);
    const idbRecord: OfflineActivityItem = {
      ...item,
      photoDataUrl: '' // Binary photoBlob stored in IndexedDB
    };
    store.put(idbRecord);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    savedToIndexedDb = true;
  } catch (err) {
    console.warn('Gagal menyimpan Laporan Kegiatan Offline ke IndexedDB, menggunakan LocalStorage fallback:', err);
  }

  const existing = safeGetLS<OfflineActivityItem[]>(LS_KEY_ACTIVITIES, []);
  const lsItem = {
    ...item,
    photoBlob: undefined,
    photoDataUrl: savedToIndexedDb ? '' : item.photoDataUrl
  };
  const updated = [lsItem, ...existing.filter(i => i.id !== item.id)];
  safeSetLS(LS_KEY_ACTIVITIES, updated);

  return item;
}

export async function getOfflineActivityLogs(): Promise<OfflineActivityItem[]> {
  let rawList: OfflineActivityItem[] = [];
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_ACTIVITIES, 'readonly');
    const store = tx.objectStore(STORE_ACTIVITIES);
    const req = store.getAll();
    rawList = await new Promise<OfflineActivityItem[]>((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    // fallback
  }

  // Legacy localStorage migration fallback
  const lsList = safeGetLS<OfflineActivityItem[]>(LS_KEY_ACTIVITIES, []);
  if (lsList && lsList.length > 0) {
    for (const lsItem of lsList) {
      if (!rawList.some(r => r.id === lsItem.id)) {
        rawList.push(lsItem);
      }
    }
  }

  const hydratedList: OfflineActivityItem[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item.photoDataUrl && item.photoBlob) {
      try {
        const dataUrl = await blobToDataUrlSequentially(item.photoBlob);
        hydratedList.push({ ...item, photoDataUrl: dataUrl });
      } catch {
        hydratedList.push(item);
      }
    } else {
      hydratedList.push(item);
    }

    if (i % 3 === 2 && i < rawList.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return hydratedList;
}

export async function removeOfflineActivityLog(id: string): Promise<void> {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_ACTIVITIES, 'readwrite');
    const store = tx.objectStore(STORE_ACTIVITIES);
    store.delete(id);
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
  } catch (err) {
    console.warn('Gagal menghapus Laporan Kegiatan Offline dari IndexedDB:', err);
  }

  const existing = safeGetLS<OfflineActivityItem[]>(LS_KEY_ACTIVITIES, []);
  const updated = existing.filter(i => i.id !== id);
  safeSetLS(LS_KEY_ACTIVITIES, updated);
}

/* =========================================================================
   OFFLINE BBM REFILLS (Refill BBM Duren Sawit)
   ========================================================================= */

export async function saveOfflineBbmRefill(
  data: {
    userEmail: string;
    managerEmail: string;
    tanggal: string;
    siteId: string;
    siteName: string;
    nominal: number;
    keterangan: string;
    reqPayload: any;
    reportItemPayload: any;
  },
  photoFileOrDataUrl: File | Blob | string
): Promise<OfflineBbmRefill> {
  let photoFile: File | Blob;
  let fileName = `nota_bbm_${Date.now()}.jpg`;

  if (typeof photoFileOrDataUrl === 'string') {
    photoFile = dataURLtoBlob(photoFileOrDataUrl);
  } else {
    photoFile = photoFileOrDataUrl;
    fileName = (photoFile as File).name || fileName;
  }

  const { dataUrl: photoDataUrl, blob: photoBlob } = await compressFileToBlobAndDataUrl(photoFile);

  const item: OfflineBbmRefill = {
    id: `OFFLINE-BBM-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
    userEmail: data.userEmail,
    managerEmail: data.managerEmail,
    tanggal: data.tanggal,
    siteId: data.siteId,
    siteName: data.siteName,
    nominal: data.nominal,
    keterangan: data.keterangan,
    reqPayload: data.reqPayload,
    reportItemPayload: data.reportItemPayload,
    photoDataUrl,
    photoBlob,
    photoFileName: fileName
  };

  let savedToIndexedDb = false;
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_BBM, 'readwrite');
    const store = tx.objectStore(STORE_BBM);
    const idbRecord: OfflineBbmRefill = {
      ...item,
      photoDataUrl: '' // Persisted as binary Blob in IndexedDB
    };
    store.put(idbRecord);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    savedToIndexedDb = true;
  } catch (err) {
    console.warn('Gagal menyimpan BBM Offline ke IndexedDB, menggunakan LocalStorage fallback:', err);
  }

  const existing = safeGetLS<OfflineBbmRefill[]>(LS_KEY_BBM, []);
  const lsItem = {
    ...item,
    photoBlob: undefined,
    photoDataUrl: savedToIndexedDb ? '' : item.photoDataUrl
  };
  const updated = [lsItem, ...existing.filter(i => i.id !== item.id)];
  safeSetLS(LS_KEY_BBM, updated);

  return item;
}

export async function getOfflineBbmRefills(): Promise<OfflineBbmRefill[]> {
  let rawList: OfflineBbmRefill[] = [];
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_BBM, 'readonly');
    const store = tx.objectStore(STORE_BBM);
    const req = store.getAll();
    rawList = await new Promise<OfflineBbmRefill[]>((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    // fallback
  }

  const lsList = safeGetLS<OfflineBbmRefill[]>(LS_KEY_BBM, []);
  if (lsList && lsList.length > 0) {
    for (const lsItem of lsList) {
      if (!rawList.some(r => r.id === lsItem.id)) {
        rawList.push(lsItem);
      }
    }
  }

  const hydratedList: OfflineBbmRefill[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item.photoDataUrl && item.photoBlob) {
      try {
        const dataUrl = await blobToDataUrlSequentially(item.photoBlob);
        hydratedList.push({ ...item, photoDataUrl: dataUrl });
      } catch {
        hydratedList.push(item);
      }
    } else {
      hydratedList.push(item);
    }

    if (i % 3 === 2 && i < rawList.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return hydratedList;
}

export async function removeOfflineBbmRefill(id: string): Promise<void> {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_BBM, 'readwrite');
    const store = tx.objectStore(STORE_BBM);
    store.delete(id);
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
  } catch (err) {
    console.warn('Gagal menghapus BBM Offline dari IndexedDB:', err);
  }

  const existing = safeGetLS<OfflineBbmRefill[]>(LS_KEY_BBM, []);
  const updated = existing.filter(i => i.id !== id);
  safeSetLS(LS_KEY_BBM, updated);
}
