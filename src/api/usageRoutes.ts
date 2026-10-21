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
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL

export function invalidateUsageCache(): void {
  cache = null;
}

const LAPORAN_HEADERS = [
  'id',
  'requestid',
  'tanggalnota',
  'nominal',
  'keterangan',
  'drivefileid',
  'drivefileurl',
  'statusmanager',
  'catatanmanager',
  'statusadmin',
  'catatanadmin',
  'createdat',
  'updatedat'
];

function mapRowToUsageItem(row: any[]): UsageReportItem | null {
  if (!row || row.length < 2) return null;
  const id = String(row[0] || '').trim();
  const requestId = String(row[1] || '').trim();
  if (!id || !requestId) return null;

  return {
    id,
    requestId,
    tanggalPenggunaan: String(row[2] || '').trim(),
    nominal: Number(row[3]) || 0,
    keterangan: String(row[4] || '').trim(),
    buktiFileId: String(row[5] || '').trim(),
    buktiUrl: String(row[6] || '').trim(),
    statusManager: (row[7] as ItemStatus) || ItemStatus.PENDING,
    managerComment: String(row[8] || '').trim(),
    statusAdmin: (row[9] as ItemStatus) || ItemStatus.PENDING,
    adminComment: String(row[10] || '').trim(),
    updatedAt: String(row[12] || String(row[11] || '')).trim()
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
  const items: UsageReportItem[] = [];
  const byUid = new Map<string, UsageReportItem[]>();

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const item = mapRowToUsageItem(rows[i]);
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
 * GET /api/laporan?uid=OP-...
 * Returns all usage report items for a specific UID on demand.
 */
usageRouter.get('/', requireFirebaseAuth, async (req, res) => {
  try {
    const spreadsheetId = (req.query.spreadsheetId as string) || readServerConfig().spreadsheetId;
    const forceRefresh = req.query.forceRefresh === 'true';
    const targetUid = typeof req.query.uid === 'string' ? req.query.uid.trim() : '';

    if (!targetUid) {
      return res.status(400).json({
        success: false,
        error: 'Parameter "uid" diperlukan untuk pemuatan on-demand.'
      });
    }

    const usageCache = await getOrRefreshUsageCache(spreadsheetId, forceRefresh);
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
