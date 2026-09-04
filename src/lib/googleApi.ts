/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BudgetRequest, UsageReportItem, UserProfile, Role, RequestStatus, ItemStatus, SiteInfo, UserActivity, ResetDeviceLog, ItemReviewHistory, formatTimestamp } from '../types';
import { uploadReceiptViaServiceAccount } from './serviceAccountClient';

const originalFetch = window.fetch;
async function fetchWithTimeout(resource: string | Request, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 15000, ...restOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await originalFetch(resource, {
      ...restOptions,
      signal: controller.signal
    });
    return response;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('Permintaan ke Google API mengalami timeout. Silakan periksa koneksi internet Anda atau gunakan Mode Demo (Offline).');
    }
    if (err.message === 'Failed to fetch' || (err.message && err.message.includes('Failed to fetch'))) {
      throw new Error('Gagal terhubung ke Google API (Koneksi jaringan terputus atau diblokir). Silakan periksa koneksi internet Anda dan coba lagi.');
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}
const fetch = fetchWithTimeout;

const DB_FILE_NAME = 'Operasional Perusahaan DB';
const FOLDER_NAME = 'Operasional Perusahaan Bukti';

const PENGAJUAN_HEADERS = [
  'UID', 'UserEmail', 'ManagerEmail', 'TanggalPemakaian', 'SiteID',
  'JumlahPengajuan', 'Keterangan', 'Status', 'ManagerActionAmount',
  'ManagerComment', 'AdminActionAmount', 'AdminComment', 'CreatedAt', 'BuktiTransferUrl', 'BuktiTransferFileId',
  'AdminActionTime',
  'Timestamp'
];

const LAPORAN_HEADERS = [
  'ItemUID', 'UID', 'TanggalPenggunaan', 'Nominal', 'Keterangan',
  'BuktiUrl', 'BuktiFileId', 'StatusManager', 'ManagerComment',
  'StatusAdmin', 'AdminComment', 'UpdatedAt',
  'Timestamp'
];

const USERS_HEADERS = [
  'UserID', 'Password', 'Nama', 'Email', 'Role', 'ManagerEmail', 'Divisi', 'SubDivisi', 'AksesBBM', 'Mobile', 'DeviceID', 'FotoProfile', 'FotoProfileFileId'
];

const ACTIVITY_HEADERS = [
  'ActivityID', 'UserEmail', 'Tanggal', 'CreatedAt', 'SiteID', 'SiteName', 'CoordinatesDb', 'CoordinatesActual', 'Keterangan', 'BuktiUrl', 'BuktiFileId',
  'IndikasiFake', 'FakeReason',
  'AiRecaptureVerdict', 'AiRecaptureConfidence', 'AiRecaptureSummary', 'AiRecaptureIndicators', 'AiRecaptureCheckedAt',
  'Timestamp'
];

const RESET_DEVICE_LOG_HEADERS = [
  'LogID', 'Timestamp', 'AdminEmail', 'AdminNama', 'TargetUserEmail', 'TargetUserNama', 'OldDeviceId', 'Keterangan'
];

const ITEM_REVIEW_HISTORY_HEADERS = [
  'HistoryID', 'ItemUID', 'RequestUID', 'Timestamp', 'ActorRole', 'ActorEmail', 'ActorNama', 'ActionType', 'Status', 'Catatan', 'TanggalPenggunaan', 'Nominal', 'Keterangan', 'BuktiFileId', 'BuktiUrl'
];

// Helper to convert sheet rows (2D array) to JSON objects
function parseSheetRows<T>(headers: string[], rows: any[][], mapper: (rowMap: Record<string, any>) => T): T[] {
  if (!rows || rows.length <= 1) return [];
  const sheetHeaders = rows[0].map(h => String(h).trim());
  const dataRows = rows.slice(1);

  return dataRows.map((row) => {
    const rowMap: Record<string, any> = {
      _rawRow: row,
      _sheetHeaders: sheetHeaders
    };
    headers.forEach((h, colIndex) => {
      let idx = sheetHeaders.indexOf(h);
      if (idx === -1) {
        const hNorm = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        idx = sheetHeaders.findIndex(sh => sh.toLowerCase().replace(/[^a-z0-9]/g, '') === hNorm);
      }
      if (idx === -1 && colIndex < row.length) {
        const existingColHeader = sheetHeaders[colIndex] ? sheetHeaders[colIndex].toLowerCase().replace(/[^a-z0-9]/g, '') : '';
        if (!existingColHeader) {
          idx = colIndex;
        }
      }
      rowMap[h] = idx !== -1 && row[idx] !== undefined ? row[idx] : '';
    });

    // Also copy all original sheet header key-values into rowMap for flexibility
    sheetHeaders.forEach((sh, idx) => {
      if (sh && row[idx] !== undefined) {
        rowMap[sh] = row[idx];
      }
    });

    return mapper(rowMap);
  });
}

// Helper to parse numeric values from various formats (number, string with dots/commas/Rp, etc.)
export function parseNumericValue(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;

  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }

  let cleaned = str.replace(/Rp\.?/gi, '').trim();
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.split(',')[0].replace(/\./g, '');
    } else {
      cleaned = cleaned.split('.')[0].replace(/,/g, '');
    }
  } else if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    if (parts.length > 1 && parts.every((p, idx) => idx === 0 || p.length === 3)) {
      cleaned = parts.join('');
    } else {
      cleaned = cleaned.replace(/\./g, '');
    }
  } else if (cleaned.includes(',')) {
    const parts = cleaned.split(',');
    if (parts.length > 1 && parts.every((p, idx) => idx === 0 || p.length === 3)) {
      cleaned = parts.join('');
    } else {
      cleaned = parts[0];
    }
  }
  const parsed = parseInt(cleaned.replace(/[^0-9]/g, ''), 10);
  return isNaN(parsed) ? 0 : parsed;
}

// Map row map to BudgetRequest
function mapToBudgetRequest(row: Record<string, any>): BudgetRequest {
  const ts = String(row.Timestamp || row.timestamp || row.CreatedAt || '');
  const rawJumlah = row.JumlahPengajuan ?? row.jumlahPengajuan ?? row['Jumlah Pengajuan'] ?? row.Jumlah ?? row.Nominal;
  const rawMgrAction = row.ManagerActionAmount ?? row.managerActionAmount ?? row['Manager Action Amount'];
  const rawAdminAction = row.AdminActionAmount ?? row.adminActionAmount ?? row['Admin Action Amount'];
  return {
    id: String(row.UID || row.uid || ''),
    userEmail: String(row.UserEmail || row.userEmail || ''),
    managerEmail: String(row.ManagerEmail || row.managerEmail || ''),
    tanggalPemakaian: String(row.TanggalPemakaian || row.tanggalPemakaian || row.Tanggal || ''),
    siteId: String(row.SiteID || row.siteId || ''),
    jumlahPengajuan: parseNumericValue(rawJumlah),
    keterangan: String(row.Keterangan || row.keterangan || ''),
    status: (row.Status as RequestStatus) || (row.status as RequestStatus) || RequestStatus.PENDING_APPROVAL,
    managerActionAmount: parseNumericValue(rawMgrAction),
    managerComment: String(row.ManagerComment || row.managerComment || ''),
    adminActionAmount: parseNumericValue(rawAdminAction),
    adminComment: String(row.AdminComment || row.adminComment || ''),
    createdAt: String(row.CreatedAt || row.createdAt || ''),
    timestamp: ts,
    buktiTransferUrl: String(row.BuktiTransferUrl || row.buktiTransferUrl || ''),
    buktiTransferFileId: String(row.BuktiTransferFileId || row.buktiTransferFileId || ''),
    adminActionTime: String(row.AdminActionTime || row.adminActionTime || row['Admin Action Time'] || '')
  };
}

// Map row map to UsageReportItem
function mapToUsageItem(row: Record<string, any>): UsageReportItem {
  const ts = String(row.Timestamp || row.timestamp || row.UpdatedAt || '');
  const rawNominal = row.Nominal ?? row.nominal ?? row['Nominal (Rp)'] ?? row['Nominal (Rupiah)'] ?? row.Jumlah ?? row.JumlahPengajuan;
  return {
    id: String(row.ItemUID || row.itemUid || row.ItemID || row.id || ''),
    requestId: String(row.UID || row.uid || row.requestId || ''),
    tanggalPenggunaan: String(row.TanggalPenggunaan || row.tanggalPenggunaan || row.Tanggal || ''),
    nominal: parseNumericValue(rawNominal),
    keterangan: String(row.Keterangan || row.keterangan || ''),
    buktiUrl: String(row.BuktiUrl || row.buktiUrl || ''),
    buktiFileId: String(row.BuktiFileId || row.buktiFileId || ''),
    statusManager: (row.StatusManager as ItemStatus) || (row.statusManager as ItemStatus) || ItemStatus.PENDING,
    managerComment: String(row.ManagerComment || row.managerComment || ''),
    statusAdmin: (row.StatusAdmin as ItemStatus) || (row.statusAdmin as ItemStatus) || ItemStatus.PENDING,
    adminComment: String(row.AdminComment || row.adminComment || ''),
    updatedAt: String(row.UpdatedAt || row.updatedAt || ''),
    timestamp: ts
  };
}

// Helper to format Divisi and SubDivisi safely
export function formatDivisiSubDivisi(divisi?: string, subDivisi?: string): string {
  const div = (divisi || '').trim();
  const sub = (subDivisi || '').trim();
  if (!div) return '-';
  const subUpper = sub.toUpperCase();
  const isInvalidSub = !sub || sub === '-' || subUpper === 'TRUE' || subUpper === 'FALSE' || subUpper === 'YA' || subUpper === 'TIDAK' || subUpper === 'NULL' || subUpper === 'UNDEFINED' || sub === '0' || sub === '1';
  return isInvalidSub ? div : `${div} - ${sub}`;
}

// Map row map to UserProfile
function mapToUserProfile(row: Record<string, any>): UserProfile {
  const rawBbm = row.AksesBBM ?? row['Akses BBM'] ?? row.aksesBBM ?? '';
  const bbmStr = String(rawBbm).trim().toUpperCase();
  const isAksesBBM = bbmStr === 'TRUE' || bbmStr === 'YA' || bbmStr === '1' || rawBbm === true;

  const rawMobile = row.Mobile ?? row['Mobile(Boolean)'] ?? row['Mobile'] ?? row['Mobile Device'] ?? row.mobile ?? '';
  const mobileStr = String(rawMobile).trim().toUpperCase();
  const isMobile = mobileStr === 'TRUE' || mobileStr === 'YA' || mobileStr === '1' || rawMobile === true;

  const rawDeviceId = row.DeviceID ?? row['Device ID'] ?? row['DeviceId'] ?? row.deviceId ?? row.Deviceid ?? '';
  const deviceIdVal = String(rawDeviceId).trim();

  const rawRole = String(row.Role || row.role || '').trim().toUpperCase();
  let roleVal = Role.USER;
  if (rawRole === 'ADMINISTRATOR' || rawRole === 'ADMIN') {
    roleVal = Role.ADMINISTRATOR;
  } else if (rawRole === 'FINANCE') {
    roleVal = Role.FINANCE;
  } else if (rawRole === 'MANAGER') {
    roleVal = Role.MANAGER;
  } else if (rawRole === 'DIREKTUR' || rawRole === 'DIRECTOR') {
    roleVal = Role.DIREKTUR;
  }
  let rawSubDiv = String(row.SubDivisi || row.subDivisi || row.Subdivisi || row.subdivisi || '').trim();
  const subUpper = rawSubDiv.toUpperCase();
  if (subUpper === 'TRUE' || subUpper === 'FALSE' || subUpper === 'YA' || subUpper === 'TIDAK' || subUpper === '1' || subUpper === '0' || subUpper === 'NULL' || subUpper === 'UNDEFINED' || subUpper === '-') {
    rawSubDiv = '';
  }

  const rawFotoProfile = row.FotoProfile ?? row.fotoProfile ?? row.FotoProfileUrl ?? row.fotoProfileUrl ?? '';
  const rawFotoProfileFileId = row.FotoProfileFileId ?? row.fotoProfileFileId ?? '';

  const rawEmail = String(row.Email || row.email || '').trim();
  const rawUserId = String(row.UserID || row.userId || row['User ID'] || row.User_ID || rawEmail || '').trim();
  const rawPassword = String(row.Password || row.password || row.Pass || row.KataSandi || '').trim();
  const rawNama = String(row.Nama || row.nama || row.Name || '').trim();
  const rawManagerEmail = String(row.ManagerEmail || row.managerEmail || row['Manager Email'] || '').trim();
  const rawDivisi = String(row.Divisi || row.divisi || '').trim();

  const finalEmail = rawEmail;
  const finalUserId = rawUserId || (finalEmail ? finalEmail.split('@')[0] : '');
  const finalPassword = rawPassword || '123456';

  return {
    userId: finalUserId,
    password: finalPassword,
    nama: rawNama,
    email: finalEmail,
    role: roleVal,
    managerEmail: rawManagerEmail,
    divisi: rawDivisi,
    subDivisi: rawSubDiv,
    aksesBBM: isAksesBBM,
    mobile: isMobile,
    deviceId: deviceIdVal,
    fotoProfile: String(rawFotoProfile).trim(),
    fotoProfileFileId: String(rawFotoProfileFileId).trim()
  };
}

// Map row map to UserActivity
function mapToUserActivity(row: Record<string, any>): UserActivity {
  const getVal = (...keys: string[]): string => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
        return String(row[k]).trim();
      }
      const kNorm = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const rowKey of Object.keys(row)) {
        if (rowKey.startsWith('_')) continue;
        if (rowKey.toLowerCase().replace(/[^a-z0-9]/g, '') === kNorm) {
          if (row[rowKey] !== undefined && row[rowKey] !== null && String(row[rowKey]).trim() !== '') {
            return String(row[rowKey]).trim();
          }
        }
      }
    }
    return '';
  };

  const rawRow = Array.isArray(row._rawRow) ? row._rawRow : [];
  const rawFake = getVal('IndikasiFake', 'indikasiFake', 'Indikasi Fake', 'FakeGPS', 'Fake GPS', 'Fake');
  const isFake = rawFake === 'true' || rawFake.toUpperCase() === 'TRUE' || rawFake === '1' || rawFake.toUpperCase() === 'YA' || rawFake.toUpperCase() === 'YES';

  // Extract AI Recapture fields from named columns or positional fallback
  let rawVerdict = getVal('AiRecaptureVerdict', 'aiRecaptureVerdict', 'AI Recapture Verdict', 'AiVerdict', 'aiVerdict', 'Status Keaslian Foto', 'Keaslian Foto', 'Verdict', 'verdict', 'Status AI', 'StatusFoto');
  let rawConfidenceStr = getVal('AiRecaptureConfidence', 'aiRecaptureConfidence', 'AI Recapture Confidence', 'AiConfidence', 'Confidence', 'Tingkat Keyakinan', 'Keyakinan', 'Akurasi');
  let rawSummary = getVal('AiRecaptureSummary', 'aiRecaptureSummary', 'AI Recapture Summary', 'AiSummary', 'Summary', 'Ringkasan AI', 'Ringkasan');
  let rawIndicators = getVal('AiRecaptureIndicators', 'aiRecaptureIndicators', 'AI Recapture Indicators', 'AiIndicators', 'Indicators', 'Indikator AI', 'Indikator');
  let rawCheckedAt = getVal('AiRecaptureCheckedAt', 'aiRecaptureCheckedAt', 'AI Recapture Checked At', 'AiCheckedAt', 'CheckedAt', 'Waktu Cek AI', 'Tanggal Cek');

  // If rawVerdict is placeholder or empty, clear it
  if (
    rawVerdict === '-' ||
    rawVerdict.toLowerCase() === 'null' ||
    rawVerdict.toLowerCase() === 'undefined' ||
    rawVerdict.toLowerCase() === 'n/a' ||
    rawVerdict.toLowerCase() === 'none' ||
    rawVerdict.toLowerCase() === 'belum diperiksa' ||
    rawVerdict.toLowerCase() === 'belum cek' ||
    rawVerdict.toLowerCase() === 'not_checked' ||
    rawVerdict.toLowerCase() === 'unchecked'
  ) {
    rawVerdict = '';
  }

  // Positional fallback if row has extra columns from the expanded 19-column schema (indexes 13..17)
  if (!rawVerdict && rawRow.length >= 14 && rawRow[13]) {
    const val13 = String(rawRow[13]).trim();
    const val13Upper = val13.toUpperCase();
    if (
      val13Upper.includes('AUTHENTIC') ||
      val13Upper.includes('RECAPTURE') ||
      val13Upper.includes('LAYAR') ||
      val13Upper.includes('ASLI') ||
      val13Upper.includes('SUSPICIOUS') ||
      val13Upper.includes('MENCURIGAKAN') ||
      val13Upper === 'TRUE' ||
      val13Upper === 'FALSE'
    ) {
      rawVerdict = val13;
      if (!rawConfidenceStr && rawRow[14]) rawConfidenceStr = String(rawRow[14]).trim();
      if (!rawSummary && rawRow[15]) rawSummary = String(rawRow[15]).trim();
      if (!rawIndicators && rawRow[16]) rawIndicators = String(rawRow[16]).trim();
      if (!rawCheckedAt && rawRow[17]) rawCheckedAt = String(rawRow[17]).trim();
    }
  }

  // Parse confidence number safely (handles '95%', 95, 0.95, etc.)
  let confidenceVal: number | undefined = undefined;
  if (rawConfidenceStr) {
    const cleanedNum = parseFloat(rawConfidenceStr.replace(/[^0-9.]/g, ''));
    if (!isNaN(cleanedNum)) {
      confidenceVal = cleanedNum <= 1 && cleanedNum > 0 ? Math.round(cleanedNum * 100) : Math.round(cleanedNum);
    }
  }

  let ts = getVal('Timestamp', 'timestamp');
  const createdAtVal = getVal('CreatedAt', 'createdAt');
  if (!ts || ts.toUpperCase().includes('AUTHENTIC') || ts.toUpperCase().includes('RECAPTURE')) {
    ts = createdAtVal || (rawRow.length >= 19 && rawRow[18] ? String(rawRow[18]).trim() : '');
  }

  return {
    id: getVal('ActivityID', 'activityId', 'id', 'Activity ID'),
    userEmail: getVal('UserEmail', 'userEmail', 'Email', 'User Email'),
    tanggal: getVal('Tanggal', 'tanggal', 'Date'),
    createdAt: createdAtVal,
    timestamp: ts,
    siteId: getVal('SiteID', 'siteId', 'Site ID'),
    siteName: getVal('SiteName', 'siteName', 'Site Name', 'Lokasi'),
    coordinatesDb: getVal('CoordinatesDb', 'coordinatesDb', 'Coordinates Db'),
    coordinatesActual: getVal('CoordinatesActual', 'coordinatesActual', 'Coordinates Actual'),
    keterangan: getVal('Keterangan', 'keterangan', 'Deskripsi'),
    buktiUrl: getVal('BuktiUrl', 'buktiUrl', 'Foto Bukti', 'Bukti URL'),
    buktiFileId: getVal('BuktiFileId', 'buktiFileId', 'Bukti File ID'),
    indikasiFake: isFake,
    fakeReason: getVal('FakeReason', 'fakeReason', 'Fake Reason', 'Alasan Fake'),
    aiRecaptureVerdict: rawVerdict || undefined,
    aiRecaptureConfidence: confidenceVal,
    aiRecaptureSummary: rawSummary || undefined,
    aiRecaptureIndicators: rawIndicators || undefined,
    aiRecaptureCheckedAt: rawCheckedAt || undefined
  };
}

// Map row map to ResetDeviceLog
function mapToResetDeviceLog(row: Record<string, any>): ResetDeviceLog {
  const ts = String(row.Timestamp || row.timestamp || '');
  return {
    id: String(row.LogID || row.logId || row.id || ''),
    timestamp: ts,
    adminEmail: String(row.AdminEmail || row.adminEmail || ''),
    adminNama: String(row.AdminNama || row.adminNama || ''),
    targetUserEmail: String(row.TargetUserEmail || row.targetUserEmail || ''),
    targetUserNama: String(row.TargetUserNama || row.targetUserNama || ''),
    oldDeviceId: String(row.OldDeviceId || row.oldDeviceId || ''),
    keterangan: String(row.Keterangan || row.keterangan || '')
  };
}

// Map row map to ItemReviewHistory
function mapToItemReviewHistory(row: Record<string, any>): ItemReviewHistory {
  const ts = String(row.Timestamp || row.timestamp || '');
  return {
    id: String(row.HistoryID || row.historyId || row.id || ''),
    itemUid: String(row.ItemUID || row.itemUid || ''),
    requestUid: String(row.RequestUID || row.requestUid || ''),
    timestamp: formatTimestamp(ts),
    actorRole: String(row.ActorRole || row.actorRole || ''),
    actorEmail: String(row.ActorEmail || row.actorEmail || ''),
    actorNama: String(row.ActorNama || row.actorNama || ''),
    actionType: String(row.ActionType || row.actionType || 'APPROVAL_MANAGER') as any,
    status: String(row.Status || row.status || ''),
    catatan: String(row.Catatan || row.catatan || ''),
    tanggalPenggunaan: String(row.TanggalPenggunaan || row.tanggalPenggunaan || ''),
    nominal: parseNumericValue(row.Nominal || row.nominal || 0),
    keterangan: String(row.Keterangan || row.keterangan || ''),
    buktiFileId: String(row.BuktiFileId || row.buktiFileId || ''),
    buktiUrl: String(row.BuktiUrl || row.buktiUrl || '')
  };
}

// Dynamic Database and Folder names
export const SPREADSHEET_ID_KEY = 'op_company_sheet_id';
export const DRIVE_FOLDER_ID_KEY = 'op_company_folder_id';

export const SPREADSHEET_ID = '1H39tuO0E_WLJUtl6ebzH4w3kd76XZa9rMLadwDuxwQs';
export const DRIVE_FOLDER_ID = '1RZHDhcGEdrEu1S1OJh24Za1qkxfU-1kE';

// Helper to ensure sheets exist and set headers/seeds
async function ensureSheetsAndHeaders(token: string, sheetId: string): Promise<void> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }
  if (!res.ok) {
    let errorDetails = '';
    try {
      const errJson = await res.json();
      errorDetails = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      try {
        errorDetails = await res.text();
      } catch {}
    }
    throw new Error(`Gagal memuat Google Sheet database: [HTTP ${res.status}] ${res.statusText || ''} - ${errorDetails}`);
  }
  const meta = await res.json();
  const sheetTitles = meta.sheets ? meta.sheets.map((s: any) => s.properties.title) : [];

  const requiredSheets = ['Pengajuan', 'Laporan', 'Users', 'Activity', 'ResetDeviceLog', 'ItemReviewHistory'];
  const sheetsToAdd = requiredSheets.filter(title => !sheetTitles.includes(title));

  if (sheetsToAdd.length > 0) {
    // Add missing sheets
    const requests = sheetsToAdd.map(title => ({
      addSheet: { properties: { title } }
    }));
    const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requests })
    });
    if (!updateRes.ok) {
      throw new Error(`Gagal membuat tabel baru di spreadsheet: ${updateRes.statusText}`);
    }
  }

  // Always ensure headers are set
  const headersRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: 'Pengajuan!A1:Q1', values: [PENGAJUAN_HEADERS] },
        { range: 'Laporan!A1:M1', values: [LAPORAN_HEADERS] },
        { range: 'Users!A1:M1', values: [USERS_HEADERS] },
        { range: 'Activity!A1:S1', values: [ACTIVITY_HEADERS] },
        { range: 'ResetDeviceLog!A1:H1', values: [RESET_DEVICE_LOG_HEADERS] },
        { range: 'ItemReviewHistory!A1:O1', values: [ITEM_REVIEW_HISTORY_HEADERS] }
      ]
    })
  });

  if (!headersRes.ok) {
    let errDetail = '';
    try {
      const errJson = await headersRes.json();
      errDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      try { errDetail = await headersRes.text(); } catch {}
    }
    throw new Error(`Gagal menginisialisasi header kolom: [HTTP ${headersRes.status}] ${headersRes.statusText || ''} - ${errDetail}`);
  }

  // Check if Users sheet has any data (besides headers). If not, seed default users
  const usersRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Users!A1:H10`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (usersRes.ok) {
    const usersData = await usersRes.json();
    if (!usersData.values || usersData.values.length <= 1) {
      // Seed default users
      const defaultUsers = [
        ['finance', 'finance123', 'Finance Depotel', 'ops.depotel@gmail.com', 'FINANCE', '', 'HQ-CENTRAL', 'TRUE'],
        ['manager', 'manager123', 'Manager Keuangan', 'manager@company.com', 'MANAGER', '', 'JKT-SOUTH-02', 'FALSE'],
        ['staff', 'staff123', 'Staff Lapangan', 'staff@company.com', 'USER', 'manager@company.com', 'JKT-SOUTH-02', 'TRUE']
      ];
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Users!A2:H4?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: defaultUsers })
      });
    }
  }
}

// --- Mock Data Store Helpers for Demo Mode ---
const getMockData = <T>(key: string, defaultVal: T): T => {
  try {
    const val = localStorage.getItem(key);
    if (!val) {
      try {
        localStorage.setItem(key, JSON.stringify(defaultVal));
      } catch (e) {}
      return defaultVal;
    }
    return JSON.parse(val);
  } catch {
    return defaultVal;
  }
};

const setMockData = <T>(key: string, data: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn(`[MockData] Failed to save ${key} to localStorage:`, e);
  }
};

export const defaultUsers: UserProfile[] = [
  { userId: 'admin', password: 'admin123', nama: 'Administrator System', email: 'admin@company.com', role: Role.ADMINISTRATOR, managerEmail: '', divisi: 'HQ-ADMIN', aksesBBM: false },
  { userId: 'direktur', password: 'direktur123', nama: 'Margono (Direktur Utama)', email: 'margono@depotel.com', role: Role.DIREKTUR, managerEmail: '', divisi: 'HQ-EXECUTIVE', aksesBBM: false },
  { userId: 'finance', password: 'finance123', nama: 'Finance Depotel', email: 'ops.depotel@gmail.com', role: Role.FINANCE, managerEmail: 'margono@depotel.com', divisi: 'HQ-CENTRAL', aksesBBM: true },
  { userId: 'manager', password: 'manager123', nama: 'Manager Keuangan', email: 'manager@company.com', role: Role.MANAGER, managerEmail: 'margono@depotel.com', divisi: 'JKT-SOUTH-02', aksesBBM: false },
  { userId: 'staff', password: 'staff123', nama: 'Staff Lapangan', email: 'staff@company.com', role: Role.USER, managerEmail: 'manager@company.com', divisi: 'JKT-SOUTH-02', aksesBBM: true }
];

/**
 * Safely merges multiple sources of UserProfile arrays.
 * Deduplicates by email (or userId) so no valid user profile is lost during partial syncs or network glitches.
 */
export function mergeUserProfiles(...sources: (UserProfile[] | null | undefined)[]): UserProfile[] {
  const merged: UserProfile[] = [];
  const seenKeys = new Set<string>();

  for (const list of sources) {
    if (!list || !Array.isArray(list)) continue;
    for (const u of list) {
      if (!u) continue;
      const cleanEmail = (u.email || '').trim().toLowerCase();
      const cleanUserId = (u.userId || '').trim().toLowerCase();
      const primaryKey = cleanEmail || cleanUserId;

      if (!primaryKey) continue;

      if (!seenKeys.has(primaryKey)) {
        seenKeys.add(primaryKey);
        if (cleanUserId && cleanUserId !== primaryKey) {
          seenKeys.add(cleanUserId);
        }
        if (cleanEmail && cleanEmail !== primaryKey) {
          seenKeys.add(cleanEmail);
        }

        const normalizedProfile: UserProfile = {
          ...u,
          userId: (u.userId || '').trim() || (cleanEmail ? cleanEmail.split('@')[0] : ''),
          password: (u.password || '').trim() || '123456',
          email: (u.email || '').trim(),
          nama: (u.nama || '').trim(),
          managerEmail: (u.managerEmail || '').trim(),
          divisi: (u.divisi || '').trim(),
          subDivisi: (u.subDivisi || '').trim(),
          deviceId: (u.deviceId || '').trim()
        };
        merged.push(normalizedProfile);
      }
    }
  }

  return merged;
}

/**
 * Robust user credential matcher comparing input userId/email & password against candidate profiles.
 */
export function findMatchingUser(
  candidateProfiles: UserProfile[],
  inputId: string,
  inputPassword: string
): UserProfile | undefined {
  const cleanId = (inputId || '').trim().toLowerCase();
  const cleanPassword = (inputPassword || '').trim();

  if (!cleanId) return undefined;

  return candidateProfiles.find(p => {
    const pUserId = (p.userId || '').trim().toLowerCase();
    const pEmail = (p.email || '').trim().toLowerCase();
    const pPassword = (p.password || '').trim() || '123456';

    const idMatches = (pUserId && pUserId === cleanId) || (pEmail && pEmail === cleanId);
    const pwdMatches = pPassword === cleanPassword;

    return idMatches && pwdMatches;
  });
}

export const defaultRequests: BudgetRequest[] = [
  {
    id: 'OP-20260712-4321',
    userEmail: 'staff@company.com',
    managerEmail: 'manager@company.com',
    tanggalPemakaian: '2026-07-12',
    siteId: 'JKT-SOUTH-02',
    jumlahPengajuan: 2500000,
    keterangan: 'Pembelian Kabel FO dan Konektor RJ45',
    status: RequestStatus.PENDING_APPROVAL,
    managerActionAmount: 0,
    managerComment: '',
    adminActionAmount: 0,
    createdAt: '12/07/2026, 10:00:00',
    buktiTransferUrl: '',
    buktiTransferFileId: ''
  },
  {
    id: 'OPT-20260711-8899',
    userEmail: 'staff@company.com',
    managerEmail: 'manager@company.com',
    tanggalPemakaian: '2026-07-11',
    siteId: 'JKT-SOUTH-02',
    jumlahPengajuan: 1500000,
    keterangan: '[DANA TALANGAN] Sewa Genset Tambahan',
    status: RequestStatus.REPORTING,
    managerActionAmount: 1500000,
    managerComment: 'Disetujui untuk operasional darurat.',
    adminActionAmount: 1500000,
    createdAt: '11/07/2026, 14:30:00',
    buktiTransferUrl: '',
    buktiTransferFileId: ''
  },
  {
    id: 'OPT-20260812-9827',
    userEmail: 'staff@company.com',
    managerEmail: 'manager@company.com',
    tanggalPemakaian: '2026-08-12',
    siteId: 'JKT-SOUTH-02',
    jumlahPengajuan: 3500000,
    keterangan: '[DANA TALANGAN] Perbaikan & Operasional Darurat Lapangan',
    status: RequestStatus.REVIEW_MANAGER,
    managerActionAmount: 3500000,
    managerComment: 'Disetujui penuh oleh Manager untuk operasional lapangan.',
    adminActionAmount: 3500000,
    createdAt: '12/08/2026, 09:15:00',
    buktiTransferUrl: '',
    buktiTransferFileId: ''
  }
];

export const defaultUsageItems: UsageReportItem[] = [
  {
    id: 'ITEM-1',
    requestId: 'OPT-20260711-8899',
    tanggalPenggunaan: '2026-07-11',
    nominal: 1200000,
    keterangan: 'Kuitansi Sewa Genset CV Utama',
    buktiUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=300',
    buktiFileId: 'mock_file_genset',
    statusManager: ItemStatus.APPROVED,
    managerComment: 'Sesuai bukti.',
    statusAdmin: ItemStatus.PENDING,
    adminComment: '',
    updatedAt: '11/07/2026, 16:00:00'
  },
  {
    id: 'ITEM-2',
    requestId: 'OPT-20260812-9827',
    tanggalPenggunaan: '2026-08-12',
    nominal: 3500000,
    keterangan: 'Nota Pembelian & Perbaikan Darurat Lapangan',
    buktiUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=300',
    buktiFileId: 'mock_file_perbaikan',
    statusManager: ItemStatus.APPROVED,
    managerComment: 'Laporan dan bukti nota sesuai.',
    statusAdmin: ItemStatus.PENDING,
    adminComment: '',
    updatedAt: '12/08/2026, 10:30:00'
  }
];

// Initialize fixed spreadsheet or verify its sheets
export async function findOrCreateDatabase(token: string): Promise<string> {
  if (token === 'mock_demo_token') {
    return 'mock_spreadsheet_id';
  }

  console.log('Menggunakan ID spreadsheet operasional yang ditetapkan:', SPREADSHEET_ID);
  await ensureSheetsAndHeaders(token, SPREADSHEET_ID);
  localStorage.setItem(SPREADSHEET_ID_KEY, SPREADSHEET_ID);
  return SPREADSHEET_ID;
}

// Find Folder in Drive
export async function findOrCreateFolder(token: string): Promise<string> {
  if (token === 'mock_demo_token') {
    return 'mock_folder_id';
  }

  console.log('Menggunakan ID folder Google Drive yang ditetapkan:', DRIVE_FOLDER_ID);
  localStorage.setItem(DRIVE_FOLDER_ID_KEY, DRIVE_FOLDER_ID);
  return DRIVE_FOLDER_ID;
}

// Helper to compress image or data URL so it strictly fits within Google Sheets cell limit (< 50,000 chars)
export async function compressDataUrlForGoogleSheetsCell(input: string | File): Promise<string> {
  const MAX_CELL_CHARS = 40000; // Target safe max length

  let rawDataUrl = '';
  if (typeof input !== 'string') {
    rawDataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(input);
    });
  } else {
    rawDataUrl = input;
  }

  if (!rawDataUrl || rawDataUrl.length <= MAX_CELL_CHARS) {
    return rawDataUrl;
  }

  // Non-browser or missing canvas check
  if (typeof window === 'undefined' || typeof Image === 'undefined') {
    return rawDataUrl.substring(0, MAX_CELL_CHARS);
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const attemptCompress = (dim: number, q: number): string => {
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > dim) {
              height = Math.round((height * dim) / width);
              width = dim;
            }
          } else {
            if (height > dim) {
              width = Math.round((width * dim) / height);
              height = dim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(width, 1);
          canvas.height = Math.max(height, 1);
          const ctx = canvas.getContext('2d');
          if (!ctx) return '';
          ctx.drawImage(img, 0, 0, width, height);
          return canvas.toDataURL('image/jpeg', q);
        };

        let result = attemptCompress(500, 0.45);
        if (result.length > MAX_CELL_CHARS) {
          result = attemptCompress(380, 0.35);
        }
        if (result.length > MAX_CELL_CHARS) {
          result = attemptCompress(280, 0.25);
        }
        if (result.length > MAX_CELL_CHARS) {
          result = result.substring(0, MAX_CELL_CHARS);
        }
        resolve(result || rawDataUrl.substring(0, MAX_CELL_CHARS));
      } catch (err) {
        resolve(rawDataUrl.substring(0, MAX_CELL_CHARS));
      }
    };
    img.onerror = () => {
      resolve(rawDataUrl.substring(0, MAX_CELL_CHARS));
    };
    img.src = rawDataUrl;
  });
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) || '');
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}

/**
 * Ensures any photo URL/data is converted to a Google Drive link before saving to Google Sheets.
 * If input is a base64 Data URL ('data:image/...'), uploads it to Google Drive and returns the webViewLink.
 */
export async function ensureDriveUrl(
  token: string,
  inputUrl?: string,
  defaultFileName?: string
): Promise<{ url: string; fileId?: string }> {
  if (!inputUrl) return { url: '' };

  // If it's already a Google Drive link or standard URL, return it directly
  if (!inputUrl.startsWith('data:')) {
    return { url: inputUrl };
  }

  // Upload base64 Data URL to Google Drive
  try {
    const activeToken = token && token !== 'mock_demo_token' ? token : '';
    const uploadRes = await uploadBase64Image(
      activeToken,
      DRIVE_FOLDER_ID,
      inputUrl,
      defaultFileName || `photo_${Date.now()}.jpg`
    );

    if (uploadRes.viewUrl && !uploadRes.viewUrl.startsWith('data:')) {
      return { url: uploadRes.viewUrl, fileId: uploadRes.fileId };
    }
  } catch (err) {
    console.warn('Could not convert base64 image to Google Drive link:', err);
  }

  return { url: inputUrl };
}

// Upload file & set view permission to "anyone"
export async function uploadReceiptFile(
  token: string,
  folderId: string,
  file: File
): Promise<{ fileId: string; viewUrl: string }> {
  const targetFolderId = folderId || DRIVE_FOLDER_ID;

  if (token === 'mock_demo_token') {
    const fileId = `mock_file_${Date.now()}`;
    const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;
    return { fileId, viewUrl };
  }

  // Extract file extension cleanly if present (e.g. .jpg, .png, .pdf)
  let ext = '';
  if (file.name && file.name.includes('.')) {
    const rawExt = file.name.split('.').pop() || '';
    if (rawExt && rawExt.length <= 5) {
      ext = `.${rawExt.toLowerCase()}`;
    }
  } else if (file.type) {
    if (file.type.includes('png')) ext = '.png';
    else if (file.type.includes('jpeg') || file.type.includes('jpg')) ext = '.jpg';
    else if (file.type.includes('pdf')) ext = '.pdf';
  }

  if (ext === '.jpeg') ext = '.jpg';

  const metadata = {
    name: `bukti_${Date.now()}${ext}`,
    parents: [targetFolderId]
  };

  try {
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', file);

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    if (uploadRes.ok) {
      const uploadData = await uploadRes.json();
      const fileId = uploadData.id;

      // Set reader permissions so anyone can view (Manager and Admin can review)
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            role: 'reader',
            type: 'anyone'
          })
        });
      } catch (permErr) {
        console.warn('Could not set public permission on Drive file:', permErr);
      }

      // Fetch file metadata to get webViewLink
      const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true&fields=webViewLink`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const metaData = await metaRes.json().catch(() => ({}));

      return {
        fileId,
        viewUrl: metaData.webViewLink || `https://drive.google.com/file/d/${fileId}/view`
      };
    } else {
      const errText = await uploadRes.text();
      console.warn('Google Drive user token upload failed, attempting backend Service Account upload:', errText);
    }
  } catch (driveErr: any) {
    console.warn('Google Drive direct upload failed with user token, attempting backend Service Account upload:', driveErr.message || driveErr);
  }

  // Upload via backend Service Account to Google Drive
  try {
    const base64Data = await fileToBase64(file);
    const saResult = await uploadReceiptViaServiceAccount(targetFolderId, base64Data, file.name);
    return saResult;
  } catch (saErr: any) {
    console.warn('Service Account upload also failed, using compressed Data URL fallback:', saErr);
    const base64Data = await fileToBase64(file);
    return {
      fileId: `img_b64_${Date.now()}`,
      viewUrl: base64Data
    };
  }
}

// Upload base64 image data URL to Google Drive
export async function uploadBase64Image(token: string, folderId: string, base64DataUrl: string, fileName?: string): Promise<{ fileId: string; viewUrl: string }> {
  const parts = base64DataUrl.split(',');
  if (parts.length < 2) {
    throw new Error('Format Data URL base64 tidak valid.');
  }
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  const blob = new Blob([u8arr], { type: mime });
  const file = new File([blob], fileName || `bukti_${Date.now()}.jpg`, { type: mime });
  return await uploadReceiptFile(token, folderId, file);
}

// Fetch Budget Requests
export async function fetchBudgetRequests(token: string, spreadsheetId: string): Promise<BudgetRequest[]> {
  if (token === 'mock_demo_token') {
    return getMockData<BudgetRequest[]>('mock_db_pengajuan', defaultRequests);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }
  if (!res.ok) return [];
  const data = await res.json();
  try {
    const firstRow = (data.values && data.values[0]) || [];
    if (firstRow.length > 0) {
      const hasAdminActionTime = firstRow.some((col: any) => String(col).toLowerCase().includes('adminactiontime') || String(col).toLowerCase().includes('admin action time'));
      if (!hasAdminActionTime || firstRow.length < PENGAJUAN_HEADERS.length) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A1:Q1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ values: [PENGAJUAN_HEADERS] })
        });
      }
    }
  } catch (hdrErr) {
    console.warn('Could not auto-verify Pengajuan headers:', hdrErr);
  }
  return parseSheetRows<BudgetRequest>(PENGAJUAN_HEADERS, data.values, mapToBudgetRequest);
}

// Fetch Usage Report Items
export async function fetchUsageItems(token: string, spreadsheetId: string): Promise<UsageReportItem[]> {
  if (token === 'mock_demo_token') {
    return getMockData<UsageReportItem[]>('mock_db_laporan', defaultUsageItems);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<UsageReportItem>(LAPORAN_HEADERS, data.values, mapToUsageItem);
}

// Fetch Profiles
export async function fetchProfiles(token: string, spreadsheetId: string): Promise<UserProfile[]> {
  if (token === 'mock_demo_token') {
    return getMockData<UserProfile[]>('mock_db_users', defaultUsers);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<UserProfile>(USERS_HEADERS, data.values, mapToUserProfile);
}

// Fetch User Activities
export async function fetchUserActivities(token: string, spreadsheetId: string): Promise<UserActivity[]> {
  if (token === 'mock_demo_token') {
    return getMockData<UserActivity[]>('mock_db_kegiatan', []);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Activity!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<UserActivity>(ACTIVITY_HEADERS, data.values, mapToUserActivity);
}

// Fetch Reset Device Logs
export async function fetchResetDeviceLogs(token: string, spreadsheetId: string): Promise<ResetDeviceLog[]> {
  if (token === 'mock_demo_token') {
    return getMockData<ResetDeviceLog[]>('mock_db_reset_device_log', []);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ResetDeviceLog!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<ResetDeviceLog>(RESET_DEVICE_LOG_HEADERS, data.values, mapToResetDeviceLog);
}

// Fetch Item Review Histories
export async function fetchItemReviewHistories(token: string, spreadsheetId: string): Promise<ItemReviewHistory[]> {
  if (token === 'mock_demo_token') {
    return getMockData<ItemReviewHistory[]>('mock_db_item_review_history', []);
  }
  let res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ItemReviewHistory!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }
  if (!res.ok) {
    // Try ApprovalHistory as sheet name fallback
    res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ApprovalHistory!A1:Z`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return [];
  }
  const data = await res.json();
  return parseSheetRows<ItemReviewHistory>(ITEM_REVIEW_HISTORY_HEADERS, data.values, mapToItemReviewHistory);
}

// Helper to convert object to spreadsheet row according to header list
function objectToRow(headers: string[], obj: Record<string, any>): any[] {
  return headers.map(h => {
    let val = obj[h] !== undefined ? obj[h] : '';
    if (typeof val === 'string' && val.length > 48000) {
      console.warn(`Cell value for column "${h}" exceeded 48,000 characters (${val.length}). Truncating to safe limit.`);
      val = val.substring(0, 48000);
    }
    return val;
  });
}

// Acquire distributed lock helper on Google Sheets to avoid race conditions under concurrency
async function acquireLock(token: string, spreadsheetId: string, lockId: string): Promise<void> {
  const maxRetries = 5; // 5 retries is enough
  const retryInterval = 300; // ms
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!Z1`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      let currentLockValue = '';
      if (res.ok) {
        const data = await res.json();
        if (data.values && data.values[0] && data.values[0][0]) {
          currentLockValue = String(data.values[0][0]);
        }
      }
      
      const now = Date.now();
      let isExpired = false;
      let isFree = currentLockValue === '';
      
      if (currentLockValue) {
        const parts = currentLockValue.split(':');
        if (parts.length === 2) {
          const ts = parseInt(parts[1], 10);
          if (!isNaN(ts) && now - ts > 10000) { // Lock expires after 10 seconds
            isExpired = true;
          }
        } else {
          isExpired = true;
        }
      }
      
      if (isFree || isExpired) {
        const myLockVal = `${lockId}:${now}`;
        const writeRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!Z1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ values: [[myLockVal]] })
        });
        
        if (writeRes.ok) {
          // Read back to verify we won the race
          const verifyRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!Z1`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (verifyRes.ok) {
            const verifyData = await verifyRes.json();
            if (verifyData.values && verifyData.values[0] && verifyData.values[0][0]) {
              const confirmedVal = String(verifyData.values[0][0]);
              if (confirmedVal === myLockVal) {
                return; // Successfully acquired lock!
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error during lock acquisition, retrying...', e);
    }
    
    await new Promise(resolve => setTimeout(resolve, retryInterval));
  }
  
  // Fallback: If lock acquisition fails due to Sheet API latency/issues, we log and proceed to prevent blocking the user
  console.warn('Lock timeout or latency detected. Proceeding with fallback safe UID generation.');
}

// Release lock helper
async function releaseLock(token: string, spreadsheetId: string): Promise<void> {
  try {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!Z1?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [['']] })
    });
  } catch (err) {
    console.error('Error releasing lock:', err);
  }
}

// Create Budget Request
export async function createBudgetRequest(token: string, spreadsheetId: string, req: BudgetRequest): Promise<void> {
  if (token === 'mock_demo_token') {
    const list = getMockData<BudgetRequest[]>('mock_db_pengajuan', []);
    const todayStr = req.tanggalPemakaian.replace(/-/g, '');
    let finalUid = req.id;
    const prefix = req.id.startsWith('BBMDS') ? 'BBMDS' : req.id.startsWith('BBM_DurenSawit') ? 'BBM_DurenSawit' : req.id.startsWith('OPT') ? 'OPT' : 'OP';
    let isUnique = !list.some(r => r.id.toUpperCase() === finalUid.toUpperCase());
    while (!isUnique) {
      const randomDigits = Math.floor(1000 + Math.random() * 9000);
      finalUid = `${prefix}-${todayStr}-${randomDigits}`;
      isUnique = !list.some(r => r.id.toUpperCase() === finalUid.toUpperCase());
    }
    req.id = finalUid;
    const newList = [req, ...list];
    setMockData('mock_db_pengajuan', newList);
    return;
  }

  const tempLockId = Math.random().toString(36).substring(2, 9);
  
  // Acquire transactional lock
  await acquireLock(token, spreadsheetId, tempLockId);
  
  try {
    // 1. Fetch all existing UIDs to ensure absolute uniqueness under lock
    const checkRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A1:A1000`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    let existingUIDs: string[] = [];
    if (checkRes.ok) {
      const data = await checkRes.json();
      if (data.values) {
        existingUIDs = data.values.map((v: any[]) => String(v[0]).trim().toUpperCase());
      }
    }
    
    const todayStr = req.tanggalPemakaian.replace(/-/g, '');
    let finalUid = req.id;
    let isUnique = !existingUIDs.includes(finalUid.toUpperCase());
    const prefix = req.id.startsWith('BBMDS') ? 'BBMDS' : req.id.startsWith('BBM_DurenSawit') ? 'BBM_DurenSawit' : req.id.startsWith('OPT') ? 'OPT' : req.id.startsWith('ADJ') ? 'ADJ' : 'OP';
    
    // Regenerate until we find a completely unused ID
    while (!isUnique) {
      const randomDigits = Math.floor(1000 + Math.random() * 9000); // 4-digit code
      finalUid = `${prefix}-${todayStr}-${randomDigits}`;
      isUnique = !existingUIDs.includes(finalUid.toUpperCase());
    }
    
    req.id = finalUid; // Save back to the request object so caller knows the final unique UID

    // Convert base64 data URL to Google Drive link if needed
    if (req.buktiTransferUrl && req.buktiTransferUrl.startsWith('data:')) {
      const driveRes = await ensureDriveUrl(token, req.buktiTransferUrl, `BUKTI_TF_${req.id}.jpg`);
      if (driveRes.url && !driveRes.url.startsWith('data:')) {
        req.buktiTransferUrl = driveRes.url;
        if (driveRes.fileId) req.buktiTransferFileId = driveRes.fileId;
      }
    }

    const nowTimestamp = req.timestamp ? formatTimestamp(req.timestamp) : formatTimestamp(new Date());
    req.timestamp = nowTimestamp;

    const rowData = objectToRow(PENGAJUAN_HEADERS, {
      UID: req.id,
      UserEmail: req.userEmail,
      ManagerEmail: req.managerEmail,
      TanggalPemakaian: req.tanggalPemakaian,
      SiteID: req.siteId,
      JumlahPengajuan: req.jumlahPengajuan,
      Keterangan: req.keterangan,
      Status: req.status,
      ManagerActionAmount: req.managerActionAmount,
      ManagerComment: req.managerComment,
      AdminActionAmount: req.adminActionAmount,
      AdminComment: req.adminComment || '',
      CreatedAt: req.createdAt || nowTimestamp,
      BuktiTransferUrl: req.buktiTransferUrl || '',
      BuktiTransferFileId: req.buktiTransferFileId || '',
      AdminActionTime: req.adminActionTime || '',
      Timestamp: nowTimestamp
    });

    const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A1:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [rowData]
      })
    });

    if (!appendRes.ok) {
      const txt = await appendRes.text();
      throw new Error(`Gagal menyimpan pengajuan: ${txt}`);
    }
  } finally {
    // Always release lock
    await releaseLock(token, spreadsheetId);
  }
}

// Helper to find 0-indexed row position in a 2D sheet array by header name and target value
function findRowIndexByHeaderAndValue(
  rows: any[][],
  primaryHeader: string,
  targetValue: string,
  fallbackHeaders: string[] = []
): number {
  if (!rows || rows.length <= 1) return -1;
  const sheetHeaders = rows[0].map(h => String(h || '').trim());
  const searchHeaders = [primaryHeader, ...fallbackHeaders].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  let colIdx = -1;
  for (const sh of sheetHeaders) {
    const shNorm = sh.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (searchHeaders.includes(shNorm)) {
      colIdx = sheetHeaders.indexOf(sh);
      break;
    }
  }

  const normalizedTarget = String(targetValue || '').trim().toLowerCase();

  // 1. Search in target header column first if found
  if (colIdx !== -1) {
    for (let i = 1; i < rows.length; i++) {
      const cellVal = String(rows[i][colIdx] || '').trim().toLowerCase();
      if (cellVal === normalizedTarget) {
        return i;
      }
    }
  }

  // 2. Fallback: Search column 0
  for (let i = 1; i < rows.length; i++) {
    const cellVal = String(rows[i][0] || '').trim().toLowerCase();
    if (cellVal === normalizedTarget) {
      return i;
    }
  }

  // 3. Fallback: Search all cells across all rows
  for (let i = 1; i < rows.length; i++) {
    for (let j = 0; j < rows[i].length; j++) {
      if (String(rows[i][j] || '').trim().toLowerCase() === normalizedTarget) {
        return i;
      }
    }
  }

  return -1;
}

// Update Budget Request
export async function updateBudgetRequest(token: string, spreadsheetId: string, req: BudgetRequest): Promise<void> {
  if (token === 'mock_demo_token') {
    const list = getMockData<BudgetRequest[]>('mock_db_pengajuan', []);
    const idx = list.findIndex(r => r.id === req.id);
    if (idx !== -1) {
      list[idx] = req;
      setMockData('mock_db_pengajuan', list);
    }
    return;
  }

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Gagal membaca data untuk update.');

  const data = await res.json();
  const rows: any[][] = data.values || [];
  const rowIdx = findRowIndexByHeaderAndValue(rows, 'UID', req.id, ['id', 'pengajuanuid']);

  if (rowIdx === -1) {
    throw new Error(`Data pengajuan dengan UID ${req.id} tidak ditemukan.`);
  }

  const nowTimestamp = req.timestamp ? formatTimestamp(req.timestamp) : formatTimestamp(new Date());
  req.timestamp = nowTimestamp;

  const sheetRowIdx = rowIdx + 1; // 1-indexed for spreadsheet
  const rowData = objectToRow(PENGAJUAN_HEADERS, {
    UID: req.id,
    UserEmail: req.userEmail,
    ManagerEmail: req.managerEmail,
    TanggalPemakaian: req.tanggalPemakaian,
    SiteID: req.siteId,
    JumlahPengajuan: req.jumlahPengajuan,
    Keterangan: req.keterangan,
    Status: req.status,
    ManagerActionAmount: req.managerActionAmount,
    ManagerComment: req.managerComment,
    AdminActionAmount: req.adminActionAmount,
    AdminComment: req.adminComment || '',
    CreatedAt: req.createdAt,
    BuktiTransferUrl: req.buktiTransferUrl || '',
    BuktiTransferFileId: req.buktiTransferFileId || '',
    AdminActionTime: req.adminActionTime || '',
    Timestamp: nowTimestamp
  });

  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A${sheetRowIdx}:Q${sheetRowIdx}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [rowData]
    })
  });

  if (!updateRes.ok) {
    throw new Error(`Gagal mengupdate pengajuan: ${await updateRes.text()}`);
  }
}

// Create Laporan Item
export async function createUsageItem(token: string, spreadsheetId: string, item: UsageReportItem): Promise<void> {
  if (token === 'mock_demo_token') {
    const list = getMockData<UsageReportItem[]>('mock_db_laporan', []);
    const newList = [...list, item];
    setMockData('mock_db_laporan', newList);
    return;
  }

  // Convert base64 data URL to Google Drive link if needed
  if (item.buktiUrl && item.buktiUrl.startsWith('data:')) {
    const driveRes = await ensureDriveUrl(token, item.buktiUrl, `NOTA_${item.id}.jpg`);
    if (driveRes.url && !driveRes.url.startsWith('data:')) {
      item.buktiUrl = driveRes.url;
      if (driveRes.fileId) item.buktiFileId = driveRes.fileId;
    }
  }

  const nowTimestamp = item.timestamp ? formatTimestamp(item.timestamp) : formatTimestamp(new Date());
  item.timestamp = nowTimestamp;

  const rowData = objectToRow(LAPORAN_HEADERS, {
    ItemUID: item.id,
    UID: item.requestId,
    TanggalPenggunaan: item.tanggalPenggunaan,
    Nominal: item.nominal,
    Keterangan: item.keterangan,
    BuktiUrl: item.buktiUrl,
    BuktiFileId: item.buktiFileId,
    StatusManager: item.statusManager,
    ManagerComment: item.managerComment,
    StatusAdmin: item.statusAdmin,
    AdminComment: item.adminComment,
    UpdatedAt: item.updatedAt || nowTimestamp,
    Timestamp: nowTimestamp
  });

  const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [rowData]
    })
  });

  if (!appendRes.ok) {
    throw new Error('Gagal menyimpan item laporan.');
  }
}

// Update Laporan Item
export async function updateUsageItem(token: string, spreadsheetId: string, item: UsageReportItem): Promise<void> {
  if (token === 'mock_demo_token') {
    const list = getMockData<UsageReportItem[]>('mock_db_laporan', []);
    const idx = list.findIndex(i => i.id === item.id);
    if (idx !== -1) {
      list[idx] = item;
      setMockData('mock_db_laporan', list);
    }
    return;
  }

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Gagal membaca data laporan untuk update.');

  const data = await res.json();
  const rows: any[][] = data.values || [];
  const rowIdx = findRowIndexByHeaderAndValue(rows, 'ItemUID', item.id, ['id', 'item_uid']);

  if (rowIdx === -1) {
    throw new Error(`Data item laporan dengan ItemUID ${item.id} tidak ditemukan.`);
  }

  const nowTimestamp = item.timestamp ? formatTimestamp(item.timestamp) : formatTimestamp(new Date());
  item.timestamp = nowTimestamp;

  const sheetRowIdx = rowIdx + 1;
  const rowData = objectToRow(LAPORAN_HEADERS, {
    ItemUID: item.id,
    UID: item.requestId,
    TanggalPenggunaan: item.tanggalPenggunaan,
    Nominal: item.nominal,
    Keterangan: item.keterangan,
    BuktiUrl: item.buktiUrl,
    BuktiFileId: item.buktiFileId,
    StatusManager: item.statusManager,
    ManagerComment: item.managerComment,
    StatusAdmin: item.statusAdmin,
    AdminComment: item.adminComment,
    UpdatedAt: item.updatedAt || nowTimestamp,
    Timestamp: nowTimestamp
  });

  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A${sheetRowIdx}:M${sheetRowIdx}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [rowData]
    })
  });

  if (!updateRes.ok) {
    throw new Error('Gagal mengupdate item laporan.');
  }
}

// Delete Laporan Item
export async function deleteUsageItem(token: string, spreadsheetId: string, itemId: string): Promise<void> {
  if (token === 'mock_demo_token') {
    const list = getMockData<UsageReportItem[]>('mock_db_laporan', []);
    const newList = list.filter(i => i.id !== itemId);
    setMockData('mock_db_laporan', newList);
    return;
  }

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Gagal membaca data laporan untuk menghapus.');

  const data = await res.json();
  const rows: any[][] = data.values || [];
  const rowIdx = findRowIndexByHeaderAndValue(rows, 'ItemUID', itemId, ['id', 'item_uid']);

  if (rowIdx === -1) {
    throw new Error(`Data item laporan dengan ItemUID ${itemId} tidak ditemukan.`);
  }

  const sheetRowIdx = rowIdx + 1;

  // Since Google Sheets values API doesn't support deleting row cleanly without shifting, we clear the values of this row
  const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A${sheetRowIdx}:M${sheetRowIdx}:clear`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!clearRes.ok) {
    throw new Error('Gagal menghapus item laporan.');
  }
}

// Create User Activity
export async function createUserActivity(token: string, spreadsheetId: string, activity: UserActivity): Promise<void> {
  if (token === 'mock_demo_token') {
    const list = getMockData<UserActivity[]>('mock_db_kegiatan', []);
    const todayStr = activity.tanggal.replace(/-/g, '');
    let finalId = activity.id;
    let isUnique = !list.some(a => a.id.toUpperCase() === finalId.toUpperCase());
    while (!isUnique) {
      const randomDigits = Math.floor(1000 + Math.random() * 9000);
      finalId = `ACT-${todayStr}-${randomDigits}`;
      isUnique = !list.some(a => a.id.toUpperCase() === finalId.toUpperCase());
    }
    activity.id = finalId;
    const newList = [activity, ...list];
    setMockData('mock_db_kegiatan', newList);
    return;
  }

  // Real sync
  const checkRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Activity!A1:A1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  let existingIDs: string[] = [];
  if (checkRes.ok) {
    const data = await checkRes.json();
    if (data.values) {
      existingIDs = data.values.map((v: any[]) => String(v[0]).trim().toUpperCase());
    }
  }
  
  const todayStr = activity.tanggal.replace(/-/g, '');
  let finalId = activity.id;
  let isUnique = !existingIDs.includes(finalId.toUpperCase());
  while (!isUnique) {
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    finalId = `ACT-${todayStr}-${randomDigits}`;
    isUnique = !existingIDs.includes(finalId.toUpperCase());
  }
  activity.id = finalId;

  // Convert base64 data URL to Google Drive link if needed
  if (activity.buktiUrl && activity.buktiUrl.startsWith('data:')) {
    const driveRes = await ensureDriveUrl(token, activity.buktiUrl, `KEGIATAN_${activity.id}.jpg`);
    if (driveRes.url && !driveRes.url.startsWith('data:')) {
      activity.buktiUrl = driveRes.url;
      if (driveRes.fileId) activity.buktiFileId = driveRes.fileId;
    }
  }

  const nowTimestamp = activity.timestamp || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  activity.timestamp = nowTimestamp;

  const rowData = objectToRow(ACTIVITY_HEADERS, {
    ActivityID: activity.id,
    UserEmail: activity.userEmail,
    Tanggal: activity.tanggal,
    CreatedAt: activity.createdAt || nowTimestamp,
    SiteID: activity.siteId,
    SiteName: activity.siteName,
    CoordinatesDb: activity.coordinatesDb,
    CoordinatesActual: activity.coordinatesActual,
    Keterangan: activity.keterangan,
    BuktiUrl: activity.buktiUrl,
    BuktiFileId: activity.buktiFileId || '',
    IndikasiFake: activity.indikasiFake ? 'TRUE' : 'FALSE',
    FakeReason: activity.fakeReason || '',
    AiRecaptureVerdict: activity.aiRecaptureVerdict || '',
    AiRecaptureConfidence: activity.aiRecaptureConfidence !== undefined ? activity.aiRecaptureConfidence : '',
    AiRecaptureSummary: activity.aiRecaptureSummary || '',
    AiRecaptureIndicators: activity.aiRecaptureIndicators || '',
    AiRecaptureCheckedAt: activity.aiRecaptureCheckedAt || '',
    Timestamp: nowTimestamp
  });

  const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Activity!A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [rowData]
    })
  });

  if (!appendRes.ok) {
    const txt = await appendRes.text();
    throw new Error(`Gagal menyimpan kegiatan: ${txt}`);
  }
}

// Update User Activity (e.g. AI Screen Recapture results, corrections, etc.)
export async function updateUserActivity(token: string, spreadsheetId: string, activity: UserActivity): Promise<void> {
  if (token === 'mock_demo_token') {
    const list = getMockData<UserActivity[]>('mock_db_kegiatan', []);
    const idx = list.findIndex(a => a.id.toUpperCase() === activity.id.toUpperCase());
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...activity };
      setMockData('mock_db_kegiatan', list);
    }
    return;
  }

  // Ensure headers if row 1 does not have the 19 columns
  try {
    const headerCheckRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Activity!A1:S1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (headerCheckRes.ok) {
      const headerData = await headerCheckRes.json();
      const existingHeaders = headerData.values?.[0] || [];
      const hasVerdictHeader = existingHeaders.some((h: any) => String(h).toLowerCase().includes('recapture') || String(h).toLowerCase().includes('verdict'));
      if (!hasVerdictHeader || existingHeaders.length < ACTIVITY_HEADERS.length) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Activity!A1:S1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ values: [ACTIVITY_HEADERS] })
        });
      }
    }
  } catch (headerErr) {
    console.warn('Could not auto-verify Activity headers:', headerErr);
  }

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Activity!A1:Z`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Gagal membaca data kegiatan untuk update.');

  const data = await res.json();
  const rows: any[][] = data.values || [];
  const rowIdx = findRowIndexByHeaderAndValue(rows, 'ActivityID', activity.id, ['id', 'activity_id']);

  if (rowIdx === -1) {
    throw new Error(`Data kegiatan dengan ActivityID ${activity.id} tidak ditemukan di Google Sheets.`);
  }

  const nowTimestamp = activity.timestamp || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  activity.timestamp = nowTimestamp;

  const sheetRowIdx = rowIdx + 1;
  const rowData = objectToRow(ACTIVITY_HEADERS, {
    ActivityID: activity.id,
    UserEmail: activity.userEmail,
    Tanggal: activity.tanggal,
    CreatedAt: activity.createdAt || nowTimestamp,
    SiteID: activity.siteId,
    SiteName: activity.siteName,
    CoordinatesDb: activity.coordinatesDb,
    CoordinatesActual: activity.coordinatesActual,
    Keterangan: activity.keterangan,
    BuktiUrl: activity.buktiUrl,
    BuktiFileId: activity.buktiFileId || '',
    IndikasiFake: activity.indikasiFake ? 'TRUE' : 'FALSE',
    FakeReason: activity.fakeReason || '',
    AiRecaptureVerdict: activity.aiRecaptureVerdict || '',
    AiRecaptureConfidence: activity.aiRecaptureConfidence !== undefined ? activity.aiRecaptureConfidence : '',
    AiRecaptureSummary: activity.aiRecaptureSummary || '',
    AiRecaptureIndicators: activity.aiRecaptureIndicators || '',
    AiRecaptureCheckedAt: activity.aiRecaptureCheckedAt || '',
    Timestamp: nowTimestamp
  });

  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Activity!A${sheetRowIdx}:S${sheetRowIdx}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [rowData]
    })
  });

  if (!updateRes.ok) {
    const txt = await updateRes.text();
    throw new Error(`Gagal mengupdate hasil analisis kegiatan di database: ${txt}`);
  }
}

// Create Reset Device Log
export async function createResetDeviceLog(token: string, spreadsheetId: string, log: ResetDeviceLog): Promise<void> {
  if (token === 'mock_demo_token') {
    const existing = getMockData<ResetDeviceLog[]>('mock_db_reset_device_log', []);
    setMockData('mock_db_reset_device_log', [log, ...existing]);
    return;
  }
  const rowData = objectToRow(RESET_DEVICE_LOG_HEADERS, {
    LogID: log.id,
    Timestamp: log.timestamp,
    AdminEmail: log.adminEmail,
    AdminNama: log.adminNama,
    TargetUserEmail: log.targetUserEmail,
    TargetUserNama: log.targetUserNama,
    OldDeviceId: log.oldDeviceId,
    Keterangan: log.keterangan
  });

  const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ResetDeviceLog!A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: [rowData]
    })
  });

  if (appendRes.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }

  if (!appendRes.ok) {
    const txt = await appendRes.text();
    throw new Error(`Gagal menyimpan Riwayat Reset Device ID: ${txt}`);
  }
}

// Create single Item Review History
export async function createItemReviewHistory(token: string, spreadsheetId: string, log: ItemReviewHistory): Promise<void> {
  return createBatchItemReviewHistories(token, spreadsheetId, [log]);
}

// Create batch Item Review Histories
export async function createBatchItemReviewHistories(token: string, spreadsheetId: string, logs: ItemReviewHistory[]): Promise<void> {
  if (logs.length === 0) return;
  if (token === 'mock_demo_token') {
    const existing = getMockData<ItemReviewHistory[]>('mock_db_item_review_history', []);
    setMockData('mock_db_item_review_history', [...logs, ...existing]);
    return;
  }

  for (const log of logs) {
    if (log.buktiUrl && log.buktiUrl.startsWith('data:')) {
      const driveRes = await ensureDriveUrl(token, log.buktiUrl, `SNAPSHOT_${log.id}.jpg`);
      if (driveRes.url && !driveRes.url.startsWith('data:')) {
        log.buktiUrl = driveRes.url;
        if (driveRes.fileId) log.buktiFileId = driveRes.fileId;
      }
    }
  }

  const rowsData = logs.map(log => objectToRow(ITEM_REVIEW_HISTORY_HEADERS, {
    HistoryID: log.id,
    ItemUID: log.itemUid,
    RequestUID: log.requestUid,
    Timestamp: log.timestamp,
    ActorRole: log.actorRole,
    ActorEmail: log.actorEmail,
    ActorNama: log.actorNama,
    ActionType: log.actionType,
    Status: log.status,
    Catatan: log.catatan,
    TanggalPenggunaan: log.tanggalPenggunaan,
    Nominal: log.nominal,
    Keterangan: log.keterangan,
    BuktiFileId: log.buktiFileId || '',
    BuktiUrl: log.buktiUrl || ''
  }));

  let appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ItemReviewHistory!A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      values: rowsData
    })
  });

  if (appendRes.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }

  if (!appendRes.ok) {
    // Try ApprovalHistory fallback
    appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ApprovalHistory!A1:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: rowsData
      })
    });
  }

  if (!appendRes.ok) {
    const txt = await appendRes.text();
    throw new Error(`Gagal menyimpan Riwayat Review Item: ${txt}`);
  }
}

// Purge orphan ItemReviewHistory entries that do not correspond to any valid BudgetRequest or UsageReportItem
export async function purgeOrphanItemReviewHistories(
  token: string,
  spreadsheetId: string,
  validRequestIds: Set<string>,
  validUsageItemIds: Set<string>
): Promise<{ purgedCount: number; remainingCount: number }> {
  if (token === 'mock_demo_token') {
    const existing = getMockData<ItemReviewHistory[]>('mock_db_item_review_history', []);
    const valid = existing.filter(h => 
      (h.requestUid && validRequestIds.has(h.requestUid)) ||
      (h.itemUid && (validUsageItemIds.has(h.itemUid) || validRequestIds.has(h.itemUid)))
    );
    const purgedCount = existing.length - valid.length;
    setMockData('mock_db_item_review_history', valid);
    return { purgedCount, remainingCount: valid.length };
  }

  // Fetch current histories directly from Google Sheets
  const currentHistories = await fetchItemReviewHistories(token, spreadsheetId);
  const validHistories = currentHistories.filter(h => 
    (h.requestUid && validRequestIds.has(h.requestUid)) ||
    (h.itemUid && (validUsageItemIds.has(h.itemUid) || validRequestIds.has(h.itemUid)))
  );

  const purgedCount = currentHistories.length - validHistories.length;
  if (purgedCount === 0) {
    return { purgedCount: 0, remainingCount: currentHistories.length };
  }

  // Clear range ItemReviewHistory!A2:Z
  const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ItemReviewHistory!A2:Z:clear`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!clearRes.ok) {
    const txt = await clearRes.text();
    throw new Error(`Gagal mengosongkan tabel ItemReviewHistory saat pembersihan orphan data: ${txt}`);
  }

  // Re-insert valid histories if any remain
  if (validHistories.length > 0) {
    await createBatchItemReviewHistories(token, spreadsheetId, validHistories);
  }

  return { purgedCount, remainingCount: validHistories.length };
}

// Fetch single profile
export async function fetchUserProfile(token: string, spreadsheetId: string, email: string): Promise<UserProfile | null> {
  const profiles = await fetchProfiles(token, spreadsheetId);
  const found = profiles.find(p => p.email.toLowerCase() === email.toLowerCase());
  return found || null;
}

// Save profile
export async function saveUserProfile(token: string, spreadsheetId: string, profile: UserProfile): Promise<void> {
  if (token === 'mock_demo_token') {
    const list = getMockData<UserProfile[]>('mock_db_users', []);
    const idx = list.findIndex(p => p.email.toLowerCase() === profile.email.toLowerCase());
    const updatedProfile = {
      ...profile,
      userId: profile.userId || (profile.email ? profile.email.split('@')[0] : `user_${Date.now()}`),
      password: profile.password || '123456',
      aksesBBM: !!profile.aksesBBM,
      mobile: !!profile.mobile,
      deviceId: profile.deviceId || ''
    };
    if (idx !== -1) {
      list[idx] = updatedProfile;
    } else {
      list.push(updatedProfile);
    }
    setMockData('mock_db_users', list);
    return;
  }

  const profiles = await fetchProfiles(token, spreadsheetId);
  const existingIdx = profiles.findIndex(p => p.email.toLowerCase() === profile.email.toLowerCase());

  const rowData = objectToRow(USERS_HEADERS, {
    UserID: profile.userId || (profile.email ? profile.email.split('@')[0] : `user_${Date.now()}`),
    Password: profile.password || '123456',
    Nama: profile.nama || '',
    Email: profile.email,
    Role: profile.role,
    ManagerEmail: profile.managerEmail,
    Divisi: profile.divisi,
    SubDivisi: profile.subDivisi || '',
    AksesBBM: profile.aksesBBM ? 'TRUE' : 'FALSE',
    Mobile: profile.mobile ? 'TRUE' : 'FALSE',
    DeviceID: profile.deviceId || '',
    FotoProfile: profile.fotoProfile || '',
    FotoProfileFileId: profile.fotoProfileFileId || ''
  });

  if (existingIdx !== -1) {
    // Row is at existingIdx + 2 (since header is row 1, and index is 0-based index of slice(1))
    const sheetRowIdx = existingIdx + 2;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A${sheetRowIdx}:M${sheetRowIdx}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [rowData]
      })
    });
  } else {
    // Append
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A1:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [rowData]
      })
    });
  }
}

// Fetch Sites from SiteID Sheet
export async function fetchSites(token: string, spreadsheetId: string): Promise<SiteInfo[]> {
  if (token === 'mock_demo_token') {
    return getMockData<SiteInfo[]>('mock_db_sites', [
      { siteId: 'JKT-SOUTH-02', siteName: 'Depotel JKT South 02', coordinates: '-6.2088, 106.8456' },
      { siteId: 'SITE-A', siteName: 'Site Alfa Jakarta', coordinates: '-6.1751, 106.8272' },
      { siteId: 'SITE-B', siteName: 'Site Bravo Surabaya', coordinates: '-7.2575, 112.7521' },
      { siteId: 'SITE-C', siteName: 'Site Charlie Medan', coordinates: '3.5952, 98.6722' }
    ]);
  }

  try {
    // 1. Lightly fetch all spreadsheet sheet titles to find matches case-insensitively
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (metaRes.status === 401) {
      throw new Error('[HTTP 401] Request had invalid authentication credentials.');
    }

    let resolvedTitle = 'SiteID'; // default fallback
    if (metaRes.ok) {
      const meta = await metaRes.json();
      const titles: string[] = meta.sheets ? meta.sheets.map((s: any) => s.properties.title) : [];
      console.log('Available sheets in spreadsheet:', titles);
      
      const found = titles.find(t => {
        const clean = t.trim().toLowerCase().replace(/[\s_-]/g, '');
        return clean === 'siteid' || clean === 'site';
      });
      if (found) {
        resolvedTitle = found;
        console.log(`Resolved SiteID sheet title to: "${resolvedTitle}"`);
      }
    }

    // 2. Fetch all sheet values without the A1:G2000 row limit
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(resolvedTitle)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (res.status === 401) {
      throw new Error('[HTTP 401] Request had invalid authentication credentials.');
    }
    
    if (!res.ok) {
      console.warn(`Gagal membaca sheet "${resolvedTitle}". Pastikan sheet tersebut ada di Google Sheet.`);
      return [];
    }
    
    const data = await res.json();
    if (!data.values || data.values.length === 0) {
      console.log(`Sheet "${resolvedTitle}" kosong atau tidak memiliki baris data.`);
      return [];
    }

    const rows = data.values;
    
    // 3. Determine if the first row is a header row
    const firstRowHasHeaders = rows[0].some((val: any) => {
      const s = String(val).toLowerCase();
      return s.includes('id') || s.includes('nama') || s.includes('name') || s.includes('lat') || s.includes('lon') || s.includes('koordinat');
    });

    let dataRows = rows;
    let idIdx = 0;
    let nameIdx = 1;
    let latIdx = 2;
    let lonIdx = 3;

    if (firstRowHasHeaders) {
      const headers = rows[0].map((h: any) => String(h).trim().toLowerCase());
      console.log(`Header kolom ditemukan pada sheet "${resolvedTitle}":`, headers);
      
      const foundIdIdx = headers.findIndex((h: string) => h === 'siteid' || h === 'id' || h.includes('siteid') || h.includes('site id') || h.includes('id'));
      if (foundIdIdx !== -1) idIdx = foundIdIdx;

      const foundNameIdx = headers.findIndex((h: string) => h === 'sitename' || h === 'name' || h.includes('sitename') || h.includes('site name') || h.includes('nama') || h.includes('name'));
      if (foundNameIdx !== -1) nameIdx = foundNameIdx;

      const foundLatIdx = headers.findIndex((h: string) => h === 'lat' || h === 'latitude' || h.includes('lat'));
      if (foundLatIdx !== -1) latIdx = foundLatIdx;

      const foundLonIdx = headers.findIndex((h: string) => h === 'lon' || h === 'longitude' || h.includes('lon') || h.includes('lng') || h.includes('long'));
      if (foundLonIdx !== -1) lonIdx = foundLonIdx;

      console.log(`Mapping indeks kolom -> ID: ${idIdx}, Nama: ${nameIdx}, Lat: ${latIdx}, Lon: ${lonIdx}`);
      dataRows = rows.slice(1);
    } else {
      console.log(`Baris pertama tidak dideteksi sebagai header. Menggunakan pemetaan kolom bawaan (0, 1, 2, 3)`);
    }

    const sitesList = dataRows.map((row: any[]) => {
      const siteId = String(row[idIdx] !== undefined ? row[idIdx] : '').trim();
      const siteName = String(row[nameIdx] !== undefined ? row[nameIdx] : '').trim();
      
      const latVal = String(row[latIdx] !== undefined ? row[latIdx] : '').trim();
      const lonVal = String(row[lonIdx] !== undefined ? row[lonIdx] : '').trim();
      
      let coordinates = '';
      if (latVal && lonVal) {
        coordinates = `${latVal}, ${lonVal}`;
      } else {
        coordinates = latVal || lonVal;
      }

      return {
        siteId,
        siteName,
        coordinates
      };
    }).filter(s => s.siteId !== '');

    console.log(`Berhasil memuat ${sitesList.length} site dari Google Sheet.`);
    return sitesList;
  } catch (err: any) {
    console.warn('Kendala membaca sheet SiteID dari Google Sheet, mencoba menggunakan data cache lokal:', err?.message || err);
    try {
      if (typeof window !== 'undefined') {
        const cached = localStorage.getItem('op_app_cached_sites');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`Fallback: Memuat ${parsed.length} SiteID dari cache lokal.`);
            return parsed;
          }
        }
      }
    } catch (cacheErr) {
      // Ignore cache parse error
    }
    return [];
  }
}

