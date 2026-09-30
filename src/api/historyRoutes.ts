import express from 'express';
import { google } from 'googleapis';
import { getServerGoogleAuth, getServerAccessToken } from '../lib/serverGoogleAuth.js';
import { readServerConfig } from './expressApp.js';

export const historyRouter = express.Router();

interface CachedHistoryData {
  all: any[];
  active: any[];
  byUid: Map<string, any[]>;
  timestamp: number;
  spreadsheetId: string;
}

let cache: CachedHistoryData | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

export function invalidateHistoryCache(): void {
  cache = null;
}

async function getOrRefreshHistoryCache(spreadsheetId: string, force = false, clientToken?: string): Promise<CachedHistoryData> {
  const now = Date.now();
  if (!force && cache && cache.spreadsheetId === spreadsheetId && (now - cache.timestamp < CACHE_TTL_MS)) {
    return cache;
  }

  let token = clientToken;
  if (!token) {
    const tokenRes = await getServerAccessToken();
    token = tokenRes.token || undefined;
  }

  if (!token) {
    throw new Error('Google Auth token tidak tersedia di server environment variables.');
  }

  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?ranges=Pengajuan!A1:Z&ranges=ItemReviewHistory!A1:Z`;
  const res = await fetch(batchUrl, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    let errText = '';
    try {
      const errJson = await res.json();
      errText = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errText = await res.text();
    }
    throw new Error(`Google Sheets API error [${res.status}]: ${errText}`);
  }

  const batchData = await res.json();
  const valueRanges = batchData.valueRanges || [];
  const pengajuanRows = valueRanges[0]?.values || [];
  const historyRows = valueRanges[1]?.values || [];

  // 1. Identify active (non-closed) UIDs
  const activeUids = new Set<string>();
  if (pengajuanRows.length > 1) {
    const headers = pengajuanRows[0].map(h => String(h).trim().toLowerCase());
    const uidIdx = headers.findIndex(h => h === 'uid' || h === 'id');
    const statusIdx = headers.findIndex(h => h === 'status');

    for (let i = 1; i < pengajuanRows.length; i++) {
      const row = pengajuanRows[i];
      const uid = String(uidIdx >= 0 ? row[uidIdx] || '' : '').trim().toUpperCase();
      const st = String(statusIdx >= 0 ? row[statusIdx] || '' : '').trim().toUpperCase();
      if (uid && st !== 'CLOSED') {
        activeUids.add(uid);
      }
    }
  }

  // 2. Parse ItemReviewHistory rows
  const all: any[] = [];
  const active: any[] = [];
  const byUid = new Map<string, any[]>();

  if (historyRows.length > 1) {
    const headers = historyRows[0].map(h => String(h).trim().toLowerCase());
    const idIdx = headers.findIndex(h => h === 'historyid' || h === 'id');
    const itemUidIdx = headers.findIndex(h => h === 'itemuid');
    const reqUidIdx = headers.findIndex(h => h === 'requestuid');
    const timeIdx = headers.findIndex(h => h === 'timestamp');
    const roleIdx = headers.findIndex(h => h === 'actorrole');
    const emailIdx = headers.findIndex(h => h === 'actoremail');
    const namaIdx = headers.findIndex(h => h === 'actornama');
    const typeIdx = headers.findIndex(h => h === 'actiontype');
    const statusIdx = headers.findIndex(h => h === 'status');
    const catatanIdx = headers.findIndex(h => h === 'catatan');
    const tglIdx = headers.findIndex(h => h === 'tanggalpenggunaan');
    const nominalIdx = headers.findIndex(h => h === 'nominal');
    const ketIdx = headers.findIndex(h => h === 'keterangan');
    const fileIdIdx = headers.findIndex(h => h === 'buktifileid');
    const urlIdx = headers.findIndex(h => h === 'buktiurl');

    for (let i = 1; i < historyRows.length; i++) {
      const row = historyRows[i];
      const rUid = String(reqUidIdx >= 0 ? row[reqUidIdx] || '' : '').trim();
      const iUid = String(itemUidIdx >= 0 ? row[itemUidIdx] || '' : '').trim();
      const rawNom = String(nominalIdx >= 0 ? row[nominalIdx] || 0 : 0);
      const cleanNom = Number(rawNom.replace(/[^0-9.-]+/g, '')) || 0;

      const record = {
        id: String(idIdx >= 0 ? row[idIdx] || '' : `hist_${i}`),
        itemUid: iUid,
        requestUid: rUid,
        timestamp: String(timeIdx >= 0 ? row[timeIdx] || '' : ''),
        actorRole: String(roleIdx >= 0 ? row[roleIdx] || '' : ''),
        actorEmail: String(emailIdx >= 0 ? row[emailIdx] || '' : ''),
        actorNama: String(namaIdx >= 0 ? row[namaIdx] || '' : ''),
        actionType: String(typeIdx >= 0 ? row[typeIdx] || 'APPROVAL_MANAGER' : 'APPROVAL_MANAGER'),
        status: String(statusIdx >= 0 ? row[statusIdx] || '' : ''),
        catatan: String(catatanIdx >= 0 ? row[catatanIdx] || '' : ''),
        tanggalPenggunaan: String(tglIdx >= 0 ? row[tglIdx] || '' : ''),
        nominal: cleanNom,
        keterangan: String(ketIdx >= 0 ? row[ketIdx] || '' : ''),
        buktiFileId: String(fileIdIdx >= 0 ? row[fileIdIdx] || '' : ''),
        buktiUrl: String(urlIdx >= 0 ? row[urlIdx] || '' : '')
      };

      all.push(record);

      // Add to byUid map for both requestUid and itemUid
      if (rUid) {
        const k = rUid.toUpperCase();
        if (!byUid.has(k)) byUid.set(k, []);
        byUid.get(k)!.push(record);
      }
      if (iUid && iUid.toUpperCase() !== rUid.toUpperCase()) {
        const k = iUid.toUpperCase();
        if (!byUid.has(k)) byUid.set(k, []);
        byUid.get(k)!.push(record);
      }

      // Check if this record belongs to an active request
      if (rUid && activeUids.has(rUid.toUpperCase())) {
        active.push(record);
      } else if (!rUid) {
        active.push(record);
      }
    }
  }

  cache = {
    all,
    active,
    byUid,
    timestamp: now,
    spreadsheetId
  };

  return cache;
}

/**
 * GET /api/history
 * Query params:
 *   - uid: (string) Returns history records for this specific UID.
 *   - activeOnly: (boolean) If true or default when no uid is passed, returns history for active UIDs only.
 *   - all: (boolean) If true, returns all records.
 *   - forceRefresh: (boolean) Forces cache reload.
 */
historyRouter.get('/', async (req, res) => {
  try {
    const spreadsheetId = (req.query.spreadsheetId as string) || readServerConfig().spreadsheetId;
    const forceRefresh = req.query.forceRefresh === 'true';
    const targetUid = typeof req.query.uid === 'string' ? req.query.uid.trim() : '';
    const isAll = req.query.all === 'true';
    const clientToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.query.token as string);

    const historyCache = await getOrRefreshHistoryCache(spreadsheetId, forceRefresh, clientToken);

    if (targetUid) {
      const records = historyCache.byUid.get(targetUid.toUpperCase()) || [];
      return res.json({
        success: true,
        uid: targetUid,
        count: records.length,
        data: records
      });
    }

    if (isAll) {
      return res.json({
        success: true,
        count: historyCache.all.length,
        all: true,
        data: historyCache.all
      });
    }

    // Default: Return active UIDs history only (~741 records instead of 12,382)
    return res.json({
      success: true,
      count: historyCache.active.length,
      activeOnly: true,
      data: historyCache.active
    });
  } catch (error: any) {
    console.error('Error in /api/history:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal memuat data ItemReviewHistory dari server.',
      data: []
    });
  }
});

/**
 * POST /api/history/invalidate
 * Invalidates the in-memory cache so subsequent calls re-fetch the latest data.
 */
historyRouter.post('/invalidate', (req, res) => {
  invalidateHistoryCache();
  return res.json({
    success: true,
    message: 'History cache invalidated successfully.'
  });
});
