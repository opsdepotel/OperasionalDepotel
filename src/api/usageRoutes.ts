import express from 'express';
import { getServerAccessToken } from '../lib/serverGoogleAuth.js';
import { readServerConfig } from './expressApp.js';
import { requireFirebaseAuth } from './authMiddleware.js';
import { UsageReportItem, ItemStatus } from '../types.js';

export const usageRouter = express.Router();

interface CachedUsageData {
  all: UsageReportItem[];
  byUid: Map<string, UsageReportItem[]>;
  timestamp: number;
  spreadsheetId: string;
}

let cache: CachedUsageData | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes TTL

export function invalidateUsageCache(): void {
  cache = null;
}

const LAPORAN_HEADERS = [
  'itemuid',
  'uid',
  'tanggalpenggunaan',
  'nominal',
  'keterangan',
  'buktiurl',
  'buktifileid',
  'statusmanager',
  'managercomment',
  'statusadmin',
  'admincomment',
  'updatedat',
  'timestamp',
  'isbbm',
  'platnomorkendaraan',
  'isgenset'
];

function parseNumericServer(val: any): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const raw = String(val ?? '').trim();
  if (!raw) return 0;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const cleaned = raw.replace(/[^0-9,.-]/g, '');
  if (!cleaned) return 0;
  if (/^\-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    const num = Number(cleaned.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(num) ? num : 0;
  }
  const fallback = Number(cleaned.replace(/,/g, ''));
  return Number.isFinite(fallback) ? fallback : 0;
}

function extractDriveIdFromUrl(url: string): string {
  if (!url) return '';
  const match =
    url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match && match[1] ? match[1] : '';
}

function normalizeHeaderKey(h: any): string {
  return String(h ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildColumnIndexMap(headerRow?: any[]): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(headerRow)) return map;
  headerRow.forEach((h, idx) => {
    const key = normalizeHeaderKey(h);
    if (key && !map.has(key)) map.set(key, idx);
  });
  return map;
}

function getColCell(row: any[], colMap: Map<string, number>, keys: string[], fallbackIdx: number): any {
  for (const key of keys) {
    const idx = colMap.get(key);
    if (idx !== undefined && idx < row.length) {
      return row[idx];
    }
  }
  return fallbackIdx < row.length ? row[fallbackIdx] : '';
}

function mapRowToUsageItem(row: any[], colMap: Map<string, number>): UsageReportItem | null {
  if (!row || row.length < 2) return null;
  const id = String(getColCell(row, colMap, ['itemuid', 'itemid', 'id'], 0) || '').trim();
  const requestId = String(getColCell(row, colMap, ['uid', 'requestid', 'requestuid'], 1) || '').trim();
  if (!id || !requestId) return null;

  const rawUrlCell = String(getColCell(row, colMap, ['buktiurl', 'drivefileurl', 'urlbukti'], 5) || '').trim();
  const rawFileIdCell = String(getColCell(row, colMap, ['buktifileid', 'drivefileid', 'fileid'], 6) || '').trim();

  // Defensively handle swapped URL / FileId columns
  let buktiUrl = rawUrlCell;
  let buktiFileId = rawFileIdCell;
  const urlIsHttp = /^https?:\/\//i.test(buktiUrl) || /^data:/i.test(buktiUrl);
  const fileIdIsHttp = /^https?:\/\//i.test(buktiFileId) || /^data:/i.test(buktiFileId);
  if (!urlIsHttp && fileIdIsHttp) {
    buktiUrl = rawFileIdCell;
    buktiFileId = rawUrlCell;
  }

  // If buktiFileId still accidentally holds a URL, extract Drive ID or clear it
  if (/^https?:\/\//i.test(buktiFileId)) {
    const extracted = extractDriveIdFromUrl(buktiFileId);
    if (!buktiUrl) buktiUrl = buktiFileId;
    buktiFileId = extracted;
  }

  // If buktiFileId is empty and buktiUrl is a Google Drive URL, extract Drive ID
  if (!buktiFileId && buktiUrl && /drive\.google\.com|googleusercontent\.com/i.test(buktiUrl)) {
    buktiFileId = extractDriveIdFromUrl(buktiUrl);
  }

  // If buktiUrl is empty but buktiFileId looks like a valid Drive ID, synthesize a viewable Drive link
  if (!buktiUrl && buktiFileId && /^[a-zA-Z0-9_-]{15,}$/.test(buktiFileId)) {
    buktiUrl = `https://drive.google.com/file/d/${buktiFileId}/view`;
  }

  const rawIsBbm = String(getColCell(row, colMap, ['isbbm', 'pengisianbbm'], 13) || '').trim().toUpperCase();
  const isBBM = rawIsBbm === 'TRUE' || rawIsBbm === 'YA' || rawIsBbm === 'YES' || rawIsBbm === '1';
  const platNomorKendaraan = String(
    getColCell(row, colMap, ['platnomorkendaraan', 'platnomor'], 14) || ''
  )
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const rawIsGenset = String(getColCell(row, colMap, ['isgenset'], 15) || '').trim().toUpperCase();
  const isGenset: boolean | undefined =
    rawIsGenset === 'TRUE' || rawIsGenset === 'YA' || rawIsGenset === 'YES' || rawIsGenset === '1'
      ? true
      : rawIsGenset === 'FALSE' || rawIsGenset === 'TIDAK' || rawIsGenset === 'NO' || rawIsGenset === '0'
        ? false
        : undefined;

  const updatedAt = String(getColCell(row, colMap, ['updatedat'], 11) || '').trim();
  const timestamp = String(getColCell(row, colMap, ['timestamp', 'createdat'], 12) || updatedAt).trim();

  return {
    id,
    requestId,
    tanggalPenggunaan: String(getColCell(row, colMap, ['tanggalpenggunaan', 'tanggalnota', 'tanggal'], 2) || '').trim(),
    nominal: parseNumericServer(getColCell(row, colMap, ['nominal', 'nominalrp', 'jumlah'], 3)),
    keterangan: String(getColCell(row, colMap, ['keterangan'], 4) || '').trim(),
    buktiUrl,
    buktiFileId,
    statusManager: (String(getColCell(row, colMap, ['statusmanager'], 7) || '').trim() as ItemStatus) || ItemStatus.PENDING,
    managerComment: String(getColCell(row, colMap, ['managercomment', 'catatanmanager'], 8) || '').trim(),
    statusAdmin: (String(getColCell(row, colMap, ['statusadmin'], 9) || '').trim() as ItemStatus) || ItemStatus.PENDING,
    adminComment: String(getColCell(row, colMap, ['admincomment', 'catatanadmin'], 10) || '').trim(),
    updatedAt: updatedAt || timestamp,
    timestamp: timestamp || updatedAt,
    isBBM,
    platNomorKendaraan,
    isGenset
  };
}

async function getOrRefreshUsageCache(spreadsheetId: string, force = false): Promise<CachedUsageData> {
  const now = Date.now();
  if (!force && cache && cache.spreadsheetId === spreadsheetId && (now - cache.timestamp < CACHE_TTL_MS)) {
    return cache;
  }

  const tokenRes = await getServerAccessToken();
  const token = tokenRes.token;

  if (!token) {
    throw new Error('Google Auth token tidak tersedia di server.');
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A1:Z`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
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

  const data = await res.json();
  const rows: any[][] = data.values || [];
  const colMap = buildColumnIndexMap(rows[0]);
  const items: UsageReportItem[] = [];
  const byUid = new Map<string, UsageReportItem[]>();

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const item = mapRowToUsageItem(rows[i], colMap);
    if (item) {
      items.push(item);
      const uidKey = item.requestId.toUpperCase().trim();
      const list = byUid.get(uidKey) || [];
      list.push(item);
      byUid.set(uidKey, list);
    }
  }

  cache = {
    all: items,
    byUid,
    timestamp: now,
    spreadsheetId
  };

  return cache;
}

/**
 * GET /api/laporan?uid=OP-... OR /api/laporan?plat=B1234ABC OR /api/laporan?allBbm=true&excludeGenset=true
 * Returns usage report items for a specific UID, all BBM usage items for a specific plate, or all BBM usage items across all plates.
 */
usageRouter.get('/', requireFirebaseAuth, async (req, res) => {
  try {
    const spreadsheetId = (req.query.spreadsheetId as string) || readServerConfig().spreadsheetId;
    const forceRefresh = req.query.forceRefresh === 'true' || req.headers['cache-control'] === 'no-cache';
    const targetUid = typeof req.query.uid === 'string' ? req.query.uid.trim() : '';
    const targetPlatRaw = typeof req.query.plat === 'string' ? req.query.plat.trim() : '';
    const targetPlat = targetPlatRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const allBbm = String(req.query.allBbm || '').trim().toLowerCase() === 'true';
    const excludeGenset = String(req.query.excludeGenset || '').trim().toLowerCase() === 'true';
    const rawIsGensetParam = typeof req.query.isGenset === 'string' ? req.query.isGenset.trim().toLowerCase() : '';
    const filterIsGenset: boolean | undefined =
      rawIsGensetParam === 'true' ? true : rawIsGensetParam === 'false' ? false : undefined;

    if (!targetUid && !targetPlat && !allBbm) {
      return res.status(400).json({
        success: false,
        error: 'Parameter "uid", "plat", atau "allBbm=true" diperlukan untuk pemuatan on-demand.'
      });
    }

    if (!forceRefresh) {
      res.setHeader('Cache-Control', 'private, max-age=180, stale-while-revalidate=300');
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    const usageCache = await getOrRefreshUsageCache(spreadsheetId, forceRefresh);

    if (allBbm) {
      const bbmRecords = usageCache.all.filter(item => {
        if (!item.isBBM) return false;
        if (excludeGenset && item.isGenset === true) return false;
        if (filterIsGenset !== undefined && Boolean(item.isGenset) !== filterIsGenset) return false;
        return true;
      });
      return res.json({
        success: true,
        allBbm: true,
        excludeGenset,
        count: bbmRecords.length,
        data: bbmRecords
      });
    }

    if (targetPlat) {
      const bbmRecords = usageCache.all.filter(item => {
        if (!item.isBBM) return false;
        const itemPlat = String(item.platNomorKendaraan || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (itemPlat !== targetPlat) return false;
        if (filterIsGenset !== undefined && Boolean(item.isGenset) !== filterIsGenset) return false;
        return true;
      });
      return res.json({
        success: true,
        plat: targetPlat,
        isGenset: filterIsGenset,
        count: bbmRecords.length,
        data: bbmRecords
      });
    }

    const records = usageCache.byUid.get(targetUid.toUpperCase()) || [];

    return res.json({
      success: true,
      uid: targetUid,
      count: records.length,
      data: records
    });
  } catch (error: any) {
    console.error('[UsageRouter] Error in /api/laporan:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Gagal memuat item laporan on-demand dari server.'
    });
  }
});
