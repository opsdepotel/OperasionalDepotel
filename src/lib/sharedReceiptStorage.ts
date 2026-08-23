/**
 * IndexedDB storage utility for PWA Web Share Target receipts
 */

const DB_NAME = 'DIOMS_SHARE_DB';
const STORE_NAME = 'shared_receipts';
const DB_VERSION = 1;

export interface SharedReceiptRecord {
  id: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB tidak didukung oleh browser ini.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSharedReceiptBlob(blob: Blob, fileName?: string): Promise<string> {
  const db = await openDB();
  const id = 'share_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const record: SharedReceiptRecord = {
    id,
    blob,
    fileName: fileName || `shared_receipt_${Date.now()}.jpg`,
    mimeType: blob.type || 'image/jpeg',
    timestamp: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.put(record);

    req.onsuccess = () => resolve(id);
    req.onerror = () => reject(req.error);
  });
}

export async function getLatestSharedReceipt(): Promise<SharedReceiptRecord | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const records = (req.result as SharedReceiptRecord[]) || [];
        if (records.length === 0) {
          resolve(null);
          return;
        }
        // Sort descending by timestamp
        records.sort((a, b) => b.timestamp - a.timestamp);
        resolve(records[0]);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Gagal mengambil data shared receipt dari IndexedDB:', err);
    return null;
  }
}

export async function getAllSharedReceipts(): Promise<SharedReceiptRecord[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const records = (req.result as SharedReceiptRecord[]) || [];
        records.sort((a, b) => b.timestamp - a.timestamp);
        resolve(records);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Gagal mengambil daftar shared receipts dari IndexedDB:', err);
    return [];
  }
}

export async function deleteSharedReceipt(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error(`Gagal menghapus shared receipt ${id}:`, err);
  }
}

export async function clearAllSharedReceipts(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Gagal mengosongkan IndexedDB shared receipts:', err);
  }
}
