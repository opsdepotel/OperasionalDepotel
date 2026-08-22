/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserActivity, BudgetRequest, UsageReportItem } from '../types';
import { createUserActivity, createBudgetRequest, createUsageItem, uploadBase64Image } from './googleApi';

const PENDING_ACTIVITIES_KEY = 'op_app_pending_offline_activities';
const PENDING_BBM_KEY = 'op_app_pending_offline_bbm';

export interface PendingOfflineActivity {
  id: string;
  activityData: {
    tanggal: string;
    siteId: string;
    siteName: string;
    coordinatesDb: string;
    coordinatesActual: string;
    keterangan: string;
    indikasiFake?: boolean;
    fakeReason?: string;
  };
  photoBase64Url?: string;
  userEmail: string;
  createdAt: string;
}

export interface PendingOfflineBbmRefill {
  id: string;
  request: BudgetRequest;
  reportItem: UsageReportItem;
  createdAt: string;
}

/** Check if browser network is online */
export const isOnline = (): boolean => {
  return typeof navigator !== 'undefined' && navigator.onLine;
};

// --- Pending Activities Helpers ---

export const getPendingOfflineActivities = (): PendingOfflineActivity[] => {
  try {
    const raw = localStorage.getItem(PENDING_ACTIVITIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to read pending offline activities:', err);
    return [];
  }
};

export const savePendingOfflineActivity = (
  pendingItem: PendingOfflineActivity
): void => {
  try {
    const current = getPendingOfflineActivities();
    current.push(pendingItem);
    localStorage.setItem(PENDING_ACTIVITIES_KEY, JSON.stringify(current));
  } catch (err) {
    console.warn('Failed to save pending offline activity to localStorage (Quota exceeded):', err);
    // If quota exceeded, try stripping heavy base64 strings or keeping the latest 10 items
    try {
      const current = getPendingOfflineActivities().slice(-10);
      const lightweightItem = {
        ...pendingItem,
        photoBase64Url: pendingItem.photoBase64Url ? pendingItem.photoBase64Url.slice(0, 15000) : ''
      };
      current.push(lightweightItem);
      localStorage.setItem(PENDING_ACTIVITIES_KEY, JSON.stringify(current));
    } catch (_) {
      console.error('Critical quota error saving offline activity');
    }
  }
};

export const removePendingOfflineActivity = (id: string): void => {
  try {
    const current = getPendingOfflineActivities().filter(a => a.id !== id);
    localStorage.setItem(PENDING_ACTIVITIES_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to remove pending offline activity:', err);
  }
};

// --- Pending BBM Refill Helpers ---

export const getPendingOfflineBbmRefills = (): PendingOfflineBbmRefill[] => {
  try {
    const raw = localStorage.getItem(PENDING_BBM_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to read pending offline BBM refills:', err);
    return [];
  }
};

export const savePendingOfflineBbmRefill = (
  pendingItem: PendingOfflineBbmRefill
): void => {
  try {
    const current = getPendingOfflineBbmRefills();
    current.push(pendingItem);
    localStorage.setItem(PENDING_BBM_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to save pending offline BBM refill:', err);
  }
};

export const removePendingOfflineBbmRefill = (id: string): void => {
  try {
    const current = getPendingOfflineBbmRefills().filter(b => b.id !== id);
    localStorage.setItem(PENDING_BBM_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to remove pending offline BBM refill:', err);
  }
};

/**
 * Synchronize all pending offline activities and BBM refills to Google Sheets & Drive
 */
export const syncPendingOfflineData = async (
  token: string,
  spreadsheetId: string,
  driveFolderId: string
): Promise<{
  activitiesSynced: number;
  bbmSynced: number;
  errors: string[];
}> => {
  let activitiesSynced = 0;
  let bbmSynced = 0;
  const errors: string[] = [];

  if (!token || !spreadsheetId) {
    return { activitiesSynced: 0, bbmSynced: 0, errors: ['Token atau Spreadsheet ID tidak valid.'] };
  }

  // 1. Sync Pending Activities
  const pendingActivities = getPendingOfflineActivities();
  for (const item of pendingActivities) {
    try {
      let finalBuktiUrl = '';
      let finalBuktiFileId = '';

      if (item.photoBase64Url && item.photoBase64Url.startsWith('data:')) {
        if (token !== 'mock_demo_token' && driveFolderId) {
          try {
            const uploadRes = await uploadBase64Image(
              token,
              driveFolderId,
              item.photoBase64Url,
              `KEGIATAN_${item.id}.jpg`
            );
            finalBuktiUrl = uploadRes.viewUrl;
            finalBuktiFileId = uploadRes.fileId;
          } catch (uploadErr) {
            console.warn('Fallback: Upload foto kegiatan offline gagal:', uploadErr);
            finalBuktiUrl = item.photoBase64Url;
          }
        } else {
          finalBuktiUrl = item.photoBase64Url;
        }
      }

      const activityToUpload: UserActivity = {
        id: item.id,
        userEmail: item.userEmail,
        tanggal: item.activityData.tanggal,
        createdAt: item.createdAt,
        siteId: item.activityData.siteId,
        siteName: item.activityData.siteName,
        coordinatesDb: item.activityData.coordinatesDb,
        coordinatesActual: item.activityData.coordinatesActual,
        keterangan: item.activityData.keterangan,
        buktiUrl: finalBuktiUrl,
        buktiFileId: finalBuktiFileId || undefined,
        indikasiFake: item.activityData.indikasiFake ?? false,
        fakeReason: item.activityData.fakeReason || ''
      };

      await createUserActivity(token, spreadsheetId, activityToUpload);
      removePendingOfflineActivity(item.id);
      activitiesSynced++;
    } catch (err: any) {
      console.error(`Sync activity ${item.id} failed:`, err);
      errors.push(`Gagal sync kegiatan ${item.id}: ${err.message || ''}`);
    }
  }

  // 2. Sync Pending BBM Refills
  const pendingBbm = getPendingOfflineBbmRefills();
  for (const item of pendingBbm) {
    try {
      let finalReportItem = { ...item.reportItem };

      if (finalReportItem.buktiUrl && finalReportItem.buktiUrl.startsWith('data:')) {
        if (token !== 'mock_demo_token' && driveFolderId) {
          try {
            const uploadRes = await uploadBase64Image(
              token,
              driveFolderId,
              finalReportItem.buktiUrl,
              `NOTA_BBM_${item.request.id}.jpg`
            );
            finalReportItem.buktiUrl = uploadRes.viewUrl;
            finalReportItem.buktiFileId = uploadRes.fileId;
          } catch (uploadErr) {
            console.warn('Fallback: Upload foto nota BBM offline gagal:', uploadErr);
          }
        }
      }

      await createBudgetRequest(token, spreadsheetId, item.request);
      await createUsageItem(token, spreadsheetId, finalReportItem);
      removePendingOfflineBbmRefill(item.id);
      bbmSynced++;
    } catch (err: any) {
      console.error(`Sync BBM ${item.id} failed:`, err);
      errors.push(`Gagal sync BBM Duren Sawit ${item.id}: ${err.message || ''}`);
    }
  }

  return {
    activitiesSynced,
    bbmSynced,
    errors
  };
};
