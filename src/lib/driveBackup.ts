/**
 * Google Drive Database & Photo Backup Service
 * 
 * Target Google Drive Cadangan: 1_XLMT5VIqctS1EyPlhHs0JzggzT39RZ2
 * Master Spreadsheet ID: 1H39tuO0E_WLJUtl6ebzH4w3kd76XZa9rMLadwDuxwQs
 * Master Photos Folder ID: 1RZHDhcGEdrEu1S1OJh24Za1qkxfU-1kE
 */

import { SPREADSHEET_ID, DRIVE_FOLDER_ID } from './googleApi';

export const BACKUP_TARGET_FOLDER_ID = '1_XLMT5VIqctS1EyPlhHs0JzggzT39RZ2';
export const BACKUP_HISTORY_STORAGE_KEY = 'dioms_backup_history_v1';

export interface BackupScanResult {
  success: boolean;
  targetFolderId: string;
  targetFolderName?: string;
  spreadsheetId: string;
  spreadsheetName?: string;
  totalSourcePhotos: number;
  alreadyInBackupPhotos: number;
  newPhotosToCopy: number;
  sourceFilesList?: Array<{ id: string; name: string; size?: string }>;
  error?: string;
}

export interface BackupExecutionResult {
  success: boolean;
  timestamp: string;
  backupFolderId: string;
  backupFolderName?: string;
  copiedSheet?: {
    id: string;
    name: string;
    webViewLink?: string;
  };
  photosSummary: {
    totalSource: number;
    copied: number;
    alreadyPresent: number;
    failed: number;
    remaining?: number;
  };
  details: string[];
  error?: string;
}

export interface BackupHistoryItem {
  id: string;
  timestamp: string;
  adminEmail: string;
  backupFolderId: string;
  backupFolderName?: string;
  copiedSheetId?: string;
  copiedSheetName?: string;
  copiedSheetLink?: string;
  totalPhotosSource: number;
  copiedPhotosCount: number;
  skippedPhotosCount: number;
  failedPhotosCount: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  errorMessage?: string;
}

/**
 * Load backup history from localStorage
 */
export function getBackupHistory(): BackupHistoryItem[] {
  try {
    const raw = localStorage.getItem(BACKUP_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to parse backup history from localStorage:', err);
    return [];
  }
}

/**
 * Save new backup item to history in localStorage
 */
export function saveBackupHistoryItem(item: BackupHistoryItem): BackupHistoryItem[] {
  try {
    const history = getBackupHistory();
    const updated = [item, ...history].slice(0, 20); // Keep last 20 records
    localStorage.setItem(BACKUP_HISTORY_STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.warn('Failed to save backup history to localStorage:', err);
    return [];
  }
}

/**
 * Helper to format timestamp to Indonesian date string
 */
export function formatBackupTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }) + ' WIB';
  } catch {
    return isoString;
  }
}

/**
 * Scans Google Drive source vs target backup folder
 */
export async function scanDriveBackup({
  targetFolderId = BACKUP_TARGET_FOLDER_ID,
  spreadsheetId = SPREADSHEET_ID,
  sourceFolderId = DRIVE_FOLDER_ID,
  token
}: {
  targetFolderId?: string;
  spreadsheetId?: string;
  sourceFolderId?: string;
  token?: string | null;
}): Promise<BackupScanResult> {
  // 1. Try server backend endpoint first
  try {
    const res = await fetch('/api/google/backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'scan',
        targetBackupFolderId: targetFolderId,
        spreadsheetId,
        sourceFolderId,
        userToken: token || undefined
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        return data;
      }
    }
  } catch (backendErr) {
    console.warn('Backend /api/google/backup scan failed, trying client Google Drive API fallback:', backendErr);
  }

  // 2. Client-side fallback if user has OAuth token
  if (!token || token === 'mock_demo_token') {
    throw new Error('Token otorisasi Google tidak tersedia atau belum terhubung. Pastikan Anda telah login dengan akun Google.');
  }

  try {
    // Check target folder
    const targetFolderRes = await fetch(`https://www.googleapis.com/drive/v3/files/${targetFolderId}?supportsAllDrives=true&fields=id,name`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    let targetFolderName = 'Google Drive Cadangan';
    if (targetFolderRes.ok) {
      const folderData = await targetFolderRes.json();
      targetFolderName = folderData.name || targetFolderName;
    }

    // Check spreadsheet
    let spreadsheetName = 'Operasional Perusahaan DB';
    const sheetRes = await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}?supportsAllDrives=true&fields=id,name`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (sheetRes.ok) {
      const sheetData = await sheetRes.json();
      spreadsheetName = sheetData.name || spreadsheetName;
    }

    // List source folder photos with pagination
    let sourceFiles: Array<{ id: string; name: string; size?: string }> = [];
    let sourcePageToken: string | null = null;
    do {
      const pageUrl: string = `https://www.googleapis.com/drive/v3/files?q='${sourceFolderId}'+in+parents+and+trashed=false&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name,size)${sourcePageToken ? `&pageToken=${encodeURIComponent(sourcePageToken)}` : ''}`;
      const sourceFilesRes: Response = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (sourceFilesRes.ok) {
        const pageData: any = await sourceFilesRes.json();
        if (Array.isArray(pageData.files)) {
          sourceFiles.push(...pageData.files);
        }
        sourcePageToken = pageData.nextPageToken || null;
      } else {
        sourcePageToken = null;
      }
    } while (sourcePageToken);

    // List target folder existing files with pagination
    const targetFileNames = new Set<string>();
    let targetPageToken: string | null = null;
    do {
      const pageUrl: string = `https://www.googleapis.com/drive/v3/files?q='${targetFolderId}'+in+parents+and+trashed=false&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name)${targetPageToken ? `&pageToken=${encodeURIComponent(targetPageToken)}` : ''}`;
      const targetFilesRes: Response = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (targetFilesRes.ok) {
        const pageData: any = await targetFilesRes.json();
        if (Array.isArray(pageData.files)) {
          pageData.files.forEach((f: any) => targetFileNames.add(f.name));
        }
        targetPageToken = pageData.nextPageToken || null;
      } else {
        targetPageToken = null;
      }
    } while (targetPageToken);

    const alreadyInBackupPhotos = sourceFiles.filter((f: any) => targetFileNames.has(f.name)).length;
    const newPhotosToCopy = sourceFiles.length - alreadyInBackupPhotos;

    return {
      success: true,
      targetFolderId,
      targetFolderName,
      spreadsheetId,
      spreadsheetName,
      totalSourcePhotos: sourceFiles.length,
      alreadyInBackupPhotos,
      newPhotosToCopy,
      sourceFilesList: sourceFiles
    };
  } catch (err: any) {
    throw new Error(err.message || 'Gagal memindai folder Google Drive cadangan.');
  }
}

/**
 * Runs the database and photo backup to the target Google Drive folder
 */
export async function executeDriveBackup({
  targetFolderId = BACKUP_TARGET_FOLDER_ID,
  spreadsheetId = SPREADSHEET_ID,
  sourceFolderId = DRIVE_FOLDER_ID,
  copySpreadsheet = true,
  copyPhotos = true,
  token,
  adminEmail = 'admin@depotel.co.id',
  maxPhotos = 50,
  onProgress
}: {
  targetFolderId?: string;
  spreadsheetId?: string;
  sourceFolderId?: string;
  copySpreadsheet?: boolean;
  copyPhotos?: boolean;
  token?: string | null;
  adminEmail?: string;
  maxPhotos?: number;
  onProgress?: (progress: { step: string; percent: number; detail: string }) => void;
}): Promise<BackupExecutionResult> {
  onProgress?.({ step: 'STARTING', percent: 5, detail: 'Menghubungkan ke layanan Google Drive...' });

  // 1. Attempt backend API first
  try {
    onProgress?.({ step: 'PROCESSING', percent: 15, detail: 'Mengirim perintah backup ke backend server...' });
    const res = await fetch('/api/google/backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'run',
        targetBackupFolderId: targetFolderId,
        spreadsheetId,
        sourceFolderId,
        copySpreadsheet,
        copyPhotos,
        maxPhotos,
        userToken: token || undefined
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        onProgress?.({ step: 'COMPLETED', percent: 100, detail: 'Backup selesai via Backend Service.' });
        
        // Record to history
        const historyItem: BackupHistoryItem = {
          id: `backup_${Date.now()}`,
          timestamp: data.timestamp || new Date().toISOString(),
          adminEmail,
          backupFolderId: targetFolderId,
          backupFolderName: data.backupFolderName || 'Google Drive Cadangan',
          copiedSheetId: data.copiedSheet?.id,
          copiedSheetName: data.copiedSheet?.name,
          copiedSheetLink: data.copiedSheet?.webViewLink,
          totalPhotosSource: data.photosSummary?.totalSource || 0,
          copiedPhotosCount: data.photosSummary?.copied || 0,
          skippedPhotosCount: data.photosSummary?.alreadyPresent || 0,
          failedPhotosCount: data.photosSummary?.failed || 0,
          status: data.photosSummary?.failed > 0 ? 'PARTIAL' : 'SUCCESS'
        };
        saveBackupHistoryItem(historyItem);

        return data;
      } else {
        throw new Error(data?.error || 'Gagal menjalankan proses backup di server.');
      }
    }
  } catch (backendErr: any) {
    console.warn('Backend backup failed, trying direct browser Google Drive API fallback:', backendErr.message);
  }

  // 2. Client-side execution fallback
  if (!token || token === 'mock_demo_token') {
    throw new Error('Gagal terhubung ke Google Drive. Pastikan kredensial Google aktif dan folder cadangan telah diberi izin akses.');
  }

  const details: string[] = [];
  let copiedSheetInfo: { id: string; name: string; webViewLink?: string } | undefined = undefined;

  try {
    // Check target folder
    onProgress?.({ step: 'VERIFY_FOLDER', percent: 20, detail: 'Memverifikasi akses folder Google Drive cadangan...' });
    const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files/${targetFolderId}?supportsAllDrives=true&fields=id,name`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!folderRes.ok) {
      throw new Error(`Folder Google Drive cadangan (ID: ${targetFolderId}) tidak dapat diakses (HTTP ${folderRes.status}). Pastikan akun Anda memiliki hak akses Editor ke folder tersebut.`);
    }
    const folderData = await folderRes.json();
    const backupFolderName = folderData.name || 'Google Drive Cadangan';

    // Step A: Copy Google Sheet
    if (copySpreadsheet) {
      onProgress?.({ step: 'COPY_SHEET', percent: 35, detail: 'Menyalin Google Sheet master database...' });
      
      // Fetch original sheet name
      const originalSheetRes = await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}?supportsAllDrives=true&fields=id,name`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      let baseName = 'Operasional Perusahaan DB';
      if (originalSheetRes.ok) {
        const d = await originalSheetRes.json();
        baseName = d.name || baseName;
      }

      const now = new Date();
      const dateTag = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
      const backupSheetTitle = `[BACKUP] ${baseName} (${dateTag})`;

      const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/copy?supportsAllDrives=true&fields=id,name,webViewLink`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: backupSheetTitle,
          parents: [targetFolderId]
        })
      });

      if (!copyRes.ok) {
        const errText = await copyRes.text();
        throw new Error(`Gagal menyalin Google Sheet master: ${errText}`);
      }

      const copyData = await copyRes.json();
      copiedSheetInfo = {
        id: copyData.id,
        name: copyData.name,
        webViewLink: copyData.webViewLink || `https://docs.google.com/spreadsheets/d/${copyData.id}/edit`
      };
      details.push(`Google Sheet berhasil disalin: ${copyData.name}`);
    }

    // Step B: Copy Photos
    let totalSource = 0;
    let copiedCount = 0;
    let alreadyPresentCount = 0;
    let failedCount = 0;

    if (copyPhotos) {
      onProgress?.({ step: 'LIST_PHOTOS', percent: 50, detail: 'Mengambil daftar foto bukti dari folder master...' });
      
      const sourceFiles: Array<{ id: string; name: string }> = [];
      let sourcePageToken: string | null = null;
      do {
        const pageUrl: string = `https://www.googleapis.com/drive/v3/files?q='${sourceFolderId}'+in+parents+and+trashed=false&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name)${sourcePageToken ? `&pageToken=${encodeURIComponent(sourcePageToken)}` : ''}`;
        const res: Response = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data: any = await res.json();
          if (Array.isArray(data.files)) {
            sourceFiles.push(...data.files);
          }
          sourcePageToken = data.nextPageToken || null;
        } else {
          sourcePageToken = null;
        }
      } while (sourcePageToken);

      totalSource = sourceFiles.length;

      // Existing files in backup folder
      const targetFileMap = new Map<string, string>();
      let targetPageToken: string | null = null;
      do {
        const pageUrl: string = `https://www.googleapis.com/drive/v3/files?q='${targetFolderId}'+in+parents+and+trashed=false&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name)${targetPageToken ? `&pageToken=${encodeURIComponent(targetPageToken)}` : ''}`;
        const res: Response = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data: any = await res.json();
          if (Array.isArray(data.files)) {
            data.files.forEach((f: any) => {
              if (f.name && f.id && !targetFileMap.has(f.name)) {
                targetFileMap.set(f.name, f.id);
              }
            });
          }
          targetPageToken = data.nextPageToken || null;
        } else {
          targetPageToken = null;
        }
      } while (targetPageToken);

      const filesToCopy = sourceFiles.filter((f: any) => !targetFileMap.has(f.name));
      alreadyPresentCount = sourceFiles.length - filesToCopy.length;

      details.push(`Total foto di folder master: ${totalSource} berkas (${alreadyPresentCount} sudah ada di folder cadangan).`);

      for (let i = 0; i < filesToCopy.length; i++) {
        const file = filesToCopy[i];
        const progressPct = 50 + Math.round(((i + 1) / filesToCopy.length) * 45);
        onProgress?.({
          step: 'COPY_PHOTOS',
          percent: progressPct,
          detail: `Menyalin foto ${i + 1} dari ${filesToCopy.length}: ${file.name}...`
        });

        try {
          const fileCopyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/copy?supportsAllDrives=true&fields=id,name`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: file.name,
              parents: [targetFolderId]
            })
          });

          if (fileCopyRes.ok) {
            const copiedData = await fileCopyRes.json();
            copiedCount++;
            if (copiedData.id && file.name) {
              targetFileMap.set(file.name, copiedData.id);
            }
          } else {
            failedCount++;
            console.warn(`Failed to copy photo ${file.name}:`, await fileCopyRes.text());
          }
        } catch (copyErr) {
          failedCount++;
          console.warn(`Error copying photo ${file.name}:`, copyErr);
        }
      }

      details.push(`Selesai menyalin foto: ${copiedCount} berhasil, ${alreadyPresentCount} dilewati (sudah ada), ${failedCount} gagal.`);

      // If a spreadsheet was copied, update its photo links to point to files in the backup folder
      if (copiedSheetInfo && copiedSheetInfo.id) {
        onProgress?.({
          step: 'UPDATE_LINKS',
          percent: 96,
          detail: 'Menyelaraskan tautan foto di Google Sheet cadangan ke Google Drive cadangan...'
        });

        try {
          const replacements: Array<{ masterId: string; backupId: string }> = [];
          for (const sf of sourceFiles) {
            if (sf.name && sf.id) {
              const bId = targetFileMap.get(sf.name);
              if (bId && bId !== sf.id) {
                replacements.push({ masterId: sf.id, backupId: bId });
              }
            }
          }

          if (replacements.length > 0) {
            const CHUNK_SIZE = 100;
            let replacedOccurrences = 0;

            for (let i = 0; i < replacements.length; i += CHUNK_SIZE) {
              const chunk = replacements.slice(i, i + CHUNK_SIZE);
              const currentMasterId = chunk[0]?.masterId;
              const currentFileName = sourceFiles.find(sf => sf.id === currentMasterId)?.name || 'berkas_foto';

              onProgress?.({
                step: 'UPDATE_LINKS',
                percent: 96 + Math.round((i / replacements.length) * 3),
                detail: `Menyelaraskan tautan foto ${i + 1}-${Math.min(i + CHUNK_SIZE, replacements.length)} dari ${replacements.length}: ${currentFileName}...`
              });

              const requests = chunk.map(r => ({
                findReplace: {
                  find: r.masterId,
                  replacement: r.backupId,
                  allSheets: true,
                  matchCase: true,
                  matchEntireCell: false,
                  includeFormulas: true
                }
              }));

              const batchRes = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${copiedSheetInfo.id}:batchUpdate`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({ requests })
                }
              );

              if (batchRes.ok) {
                const batchData = await batchRes.json();
                const replies = batchData.replies || [];
                for (const reply of replies) {
                  if (reply.findReplace?.occurrencesChanged) {
                    replacedOccurrences += reply.findReplace.occurrencesChanged;
                  }
                }
              }
            }

            if (replacedOccurrences > 0) {
              details.push(`Sinkronisasi link foto: ${replacedOccurrences} link foto di Google Sheet cadangan telah dialihkan ke Google Drive cadangan.`);
            } else {
              details.push(`Sinkronisasi link foto: ${replacements.length} pola file dicocokkan ke sheet cadangan.`);
            }
          }
        } catch (linkErr) {
          console.warn('Gagal menyelaraskan link foto di sheet cadangan:', linkErr);
          details.push('Peringatan: Sinkronisasi link foto cadangan dilewati.');
        }
      }
    }

    onProgress?.({ step: 'COMPLETED', percent: 100, detail: 'Proses backup selesai!' });

    const result: BackupExecutionResult = {
      success: true,
      timestamp: new Date().toISOString(),
      backupFolderId: targetFolderId,
      backupFolderName,
      copiedSheet: copiedSheetInfo,
      photosSummary: {
        totalSource,
        copied: copiedCount,
        alreadyPresent: alreadyPresentCount,
        failed: failedCount
      },
      details
    };

    // Save to localStorage
    const historyItem: BackupHistoryItem = {
      id: `backup_${Date.now()}`,
      timestamp: result.timestamp,
      adminEmail,
      backupFolderId: targetFolderId,
      backupFolderName,
      copiedSheetId: copiedSheetInfo?.id,
      copiedSheetName: copiedSheetInfo?.name,
      copiedSheetLink: copiedSheetInfo?.webViewLink,
      totalPhotosSource: totalSource,
      copiedPhotosCount: copiedCount,
      skippedPhotosCount: alreadyPresentCount,
      failedPhotosCount: failedCount,
      status: failedCount > 0 ? 'PARTIAL' : 'SUCCESS'
    };
    saveBackupHistoryItem(historyItem);

    return result;
  } catch (err: any) {
    onProgress?.({ step: 'FAILED', percent: 100, detail: `Gagal: ${err.message}` });
    
    const historyItem: BackupHistoryItem = {
      id: `backup_${Date.now()}`,
      timestamp: new Date().toISOString(),
      adminEmail,
      backupFolderId: targetFolderId,
      totalPhotosSource: 0,
      copiedPhotosCount: 0,
      skippedPhotosCount: 0,
      failedPhotosCount: 0,
      status: 'FAILED',
      errorMessage: err.message
    };
    saveBackupHistoryItem(historyItem);

    throw err;
  }
}
