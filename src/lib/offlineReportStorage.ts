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
  photoFileName: string;
}

const DB_NAME = 'DIOMS_OFFLINE_REPORTS_DB';
const DB_VERSION = 1;
const STORE_TALANGAN = 'offline_talangan_requests';
const STORE_USAGE = 'offline_usage_items';

const LS_KEY_TALANGAN = 'op_app_offline_talangan_requests';
const LS_KEY_USAGE = 'op_app_offline_usage_items';

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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Gagal membuka IndexedDB offline database.'));
  });
}

/**
 * Compress image file to base64 Data URL (max 1200px width/height, quality 0.75) for efficient offline storage.
 */
export async function compressFileToDataUrl(file: File | Blob): Promise<string> {
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
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        } else {
          resolve(e.target?.result as string || '');
        }
      };
      img.onerror = () => {
        resolve(e.target?.result as string || '');
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

/**
 * Convert Base64 Data URL back to JS File object for uploading to Google Drive
 */
export function dataURLtoFile(dataUrl: string, filename: string): File {
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
  const photoDataUrl = await compressFileToDataUrl(photoFile);
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
    photoFileName
  };

  // 1. Try saving to IndexedDB
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_TALANGAN, 'readwrite');
    const store = tx.objectStore(STORE_TALANGAN);
    store.put(item);
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
  } catch (err) {
    console.warn('Gagal menyimpan Talangan Offline ke IndexedDB, menggunakan LocalStorage:', err);
  }

  // 2. Sync to LocalStorage list
  const existing = safeGetLS<OfflineTalanganRequest[]>(LS_KEY_TALANGAN, []);
  const updated = [item, ...existing.filter(i => i.id !== item.id)];
  safeSetLS(LS_KEY_TALANGAN, updated);

  return item;
}

export async function getOfflineTalanganRequests(): Promise<OfflineTalanganRequest[]> {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_TALANGAN, 'readonly');
    const store = tx.objectStore(STORE_TALANGAN);
    const req = store.getAll();
    const result = await new Promise<OfflineTalanganRequest[]>((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (result && result.length > 0) return result;
  } catch (err) {
    // fallback
  }

  return safeGetLS<OfflineTalanganRequest[]>(LS_KEY_TALANGAN, []);
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
  const photoDataUrl = await compressFileToDataUrl(photoFile);
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
    photoFileName
  };

  // 1. Try saving to IndexedDB
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_USAGE, 'readwrite');
    const store = tx.objectStore(STORE_USAGE);
    store.put(item);
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
  } catch (err) {
    console.warn('Gagal menyimpan Item Laporan Offline ke IndexedDB, menggunakan LocalStorage:', err);
  }

  // 2. Sync to LocalStorage list
  const existing = safeGetLS<OfflineUsageItem[]>(LS_KEY_USAGE, []);
  const updated = [item, ...existing.filter(i => i.id !== item.id)];
  safeSetLS(LS_KEY_USAGE, updated);

  return item;
}

export async function getOfflineUsageItems(): Promise<OfflineUsageItem[]> {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction(STORE_USAGE, 'readonly');
    const store = tx.objectStore(STORE_USAGE);
    const req = store.getAll();
    const result = await new Promise<OfflineUsageItem[]>((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    if (result && result.length > 0) return result;
  } catch (err) {
    // fallback
  }

  return safeGetLS<OfflineUsageItem[]>(LS_KEY_USAGE, []);
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
