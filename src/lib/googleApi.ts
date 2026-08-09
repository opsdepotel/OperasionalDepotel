/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BudgetRequest, UsageReportItem, UserProfile, Role, RequestStatus, ItemStatus, SiteInfo, UserActivity, ResetDeviceLog, ItemReviewHistory } from '../types';

const originalFetch = window.fetch;
async function fetchWithTimeout(resource: string | Request, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 30000, ...restOptions } = options;
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
      throw new Error('Permintaan ke Google API mengalami timeout (melebihi batas 30 detik). Silakan periksa koneksi internet Anda atau gunakan Mode Demo (Offline).');
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
  'Timestamp'
];

const LAPORAN_HEADERS = [
  'ItemUID', 'UID', 'TanggalPenggunaan', 'Nominal', 'Keterangan',
  'BuktiUrl', 'BuktiFileId', 'StatusManager', 'ManagerComment',
  'StatusAdmin', 'AdminComment', 'UpdatedAt',
  'Timestamp'
];

const USERS_HEADERS = [
  'UserID', 'Password', 'Nama', 'Email', 'Role', 'ManagerEmail', 'Divisi', 'SubDivisi', 'AksesBBM', 'Mobile', 'DeviceID'
];

const ACTIVITY_HEADERS = [
  'ActivityID', 'UserEmail', 'Tanggal', 'CreatedAt', 'SiteID', 'SiteName', 'CoordinatesDb', 'CoordinatesActual', 'Keterangan', 'BuktiUrl', 'BuktiFileId',
  'IndikasiFake', 'FakeReason',
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
    const rowMap: Record<string, any> = {};
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
    buktiTransferFileId: String(row.BuktiTransferFileId || row.buktiTransferFileId || '')
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
  return isInvalidSub ? div : `${div}-${sub}`;
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

  return {
    userId: String(row.UserID || row.userId || row.Email || ''),
    password: String(row.Password || row.password || ''),
    nama: String(row.Nama || row.nama || ''),
    email: String(row.Email || row.email || ''),
    role: roleVal,
    managerEmail: String(row.ManagerEmail || row.managerEmail || ''),
    divisi: String(row.Divisi || row.divisi || ''),
    subDivisi: rawSubDiv,
    aksesBBM: isAksesBBM,
    mobile: isMobile,
    deviceId: deviceIdVal
  };
}

// Map row map to UserActivity
function mapToUserActivity(row: Record<string, any>): UserActivity {
  const ts = String(row.Timestamp || row.timestamp || row.CreatedAt || '');
  const rawFake = row.IndikasiFake ?? row.indikasiFake;
  const isFake = rawFake === true || String(rawFake).toUpperCase() === 'TRUE' || String(rawFake) === '1';
  return {
    id: String(row.ActivityID),
    userEmail: String(row.UserEmail),
    tanggal: String(row.Tanggal),
    createdAt: String(row.CreatedAt),
    timestamp: ts,
    siteId: String(row.SiteID),
    siteName: String(row.SiteName),
    coordinatesDb: String(row.CoordinatesDb || ''),
    coordinatesActual: String(row.CoordinatesActual || ''),
    keterangan: String(row.Keterangan),
    buktiUrl: String(row.BuktiUrl),
    buktiFileId: String(row.BuktiFileId || ''),
    indikasiFake: isFake,
    fakeReason: String(row.FakeReason || row.fakeReason || '')
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
    timestamp: ts,
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
        { range: 'Pengajuan!A1:P1', values: [PENGAJUAN_HEADERS] },
        { range: 'Laporan!A1:M1', values: [LAPORAN_HEADERS] },
        { range: 'Users!A1:K1', values: [USERS_HEADERS] },
        { range: 'Activity!A1:N1', values: [ACTIVITY_HEADERS] },
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
  const val = localStorage.getItem(key);
  if (!val) {
    localStorage.setItem(key, JSON.stringify(defaultVal));
    return defaultVal;
  }
  try {
    return JSON.parse(val);
  } catch {
    return defaultVal;
  }
};

const setMockData = <T>(key: string, data: T): void => {
  localStorage.setItem(key, JSON.stringify(data));
};

export const defaultUsers: UserProfile[] = [
  { userId: 'admin', password: 'admin123', nama: 'Administrator System', email: 'admin@company.com', role: Role.ADMINISTRATOR, managerEmail: '', divisi: 'HQ-ADMIN', aksesBBM: false },
  { userId: 'direktur', password: 'direktur123', nama: 'Direktur Utama', email: 'direktur@company.com', role: Role.DIREKTUR, managerEmail: '', divisi: 'HQ-EXECUTIVE', aksesBBM: false },
  { userId: 'finance', password: 'finance123', nama: 'Finance Depotel', email: 'ops.depotel@gmail.com', role: Role.FINANCE, managerEmail: '', divisi: 'HQ-CENTRAL', aksesBBM: true },
  { userId: 'manager', password: 'manager123', nama: 'Manager Keuangan', email: 'manager@company.com', role: Role.MANAGER, managerEmail: '', divisi: 'JKT-SOUTH-02', aksesBBM: false },
  { userId: 'staff', password: 'staff123', nama: 'Staff Lapangan', email: 'staff@company.com', role: Role.USER, managerEmail: 'manager@company.com', divisi: 'JKT-SOUTH-02', aksesBBM: true }
];

const defaultRequests: BudgetRequest[] = [
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
  }
];

const defaultUsageItems: UsageReportItem[] = [
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

// Upload file & set view permission to "anyone"
export async function uploadReceiptFile(
  token: string,
  folderId: string,
  file: File
): Promise<{ fileId: string; viewUrl: string }> {
  if (token === 'mock_demo_token') {
    const fileId = `mock_file_${Date.now()}`;
    const reader = new FileReader();
    const viewUrl = await new Promise<string>((resolve) => {
      reader.onload = (e) => resolve(e.target?.result as string || 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&q=80&w=300');
      reader.readAsDataURL(file);
    });
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
    parents: [folderId]
  };

  const formData = new FormData();
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  formData.append('file', file);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Gagal upload file bukti: ${text}`);
  }

  const uploadData = await uploadRes.json();
  const fileId = uploadData.id;

  // Set reader permissions so anyone can view (Manager and Admin can review)
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
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

  // Fetch file metadata to get webViewLink
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const metaData = await metaRes.json();

  return {
    fileId,
    viewUrl: metaData.webViewLink || `https://drive.google.com/file/d/${fileId}/view`
  };
}

// Upload base64 image data URL to Google Drive
export async function uploadBase64Image(token: string, folderId: string, base64DataUrl: string, fileName?: string): Promise<{ fileId: string; viewUrl: string }> {
  try {
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
  } catch (err: any) {
    console.error('Error uploading base64 image to Google Drive:', err);
    throw new Error(`Gagal mengunggah foto nota ke Google Drive: ${err.message || err}`);
  }
}

// Fetch Budget Requests
export async function fetchBudgetRequests(token: string, spreadsheetId: string): Promise<BudgetRequest[]> {
  if (token === 'mock_demo_token') {
    return getMockData<BudgetRequest[]>('mock_db_pengajuan', defaultRequests);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A1:Z1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<BudgetRequest>(PENGAJUAN_HEADERS, data.values, mapToBudgetRequest);
}

// Fetch Usage Report Items
export async function fetchUsageItems(token: string, spreadsheetId: string): Promise<UsageReportItem[]> {
  if (token === 'mock_demo_token') {
    return getMockData<UsageReportItem[]>('mock_db_laporan', defaultUsageItems);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A1:Z1000`, {
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
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A1:Z1000`, {
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
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Activity!A1:Z1000`, {
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
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ResetDeviceLog!A1:H1000`, {
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
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ItemReviewHistory!A1:O2000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) {
    throw new Error('[HTTP 401] Request had invalid authentication credentials.');
  }
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<ItemReviewHistory>(ITEM_REVIEW_HISTORY_HEADERS, data.values, mapToItemReviewHistory);
}

// Helper to convert object to spreadsheet row according to header list
function objectToRow(headers: string[], obj: Record<string, any>): any[] {
  return headers.map(h => obj[h] !== undefined ? obj[h] : '');
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

    const nowTimestamp = req.timestamp || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
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

  // First we need to find the row index by reading column A (UIDs)
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A1:A1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Gagal membaca data untuk update.');

  const data = await res.json();
  const uids = data.values ? data.values.map((v: any[]) => v[0]) : [];
  const rowIdx = uids.indexOf(req.id); // 0-indexed

  if (rowIdx === -1) {
    throw new Error(`Data pengajuan dengan UID ${req.id} tidak ditemukan.`);
  }

  const nowTimestamp = req.timestamp || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
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
    Timestamp: nowTimestamp
  });

  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A${sheetRowIdx}:P${sheetRowIdx}?valueInputOption=USER_ENTERED`, {
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

  const nowTimestamp = item.timestamp || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
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

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A1:A1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Gagal membaca data laporan untuk update.');

  const data = await res.json();
  const itemUids = data.values ? data.values.map((v: any[]) => v[0]) : [];
  const rowIdx = itemUids.indexOf(item.id);

  if (rowIdx === -1) {
    throw new Error(`Data item laporan dengan ItemUID ${item.id} tidak ditemukan.`);
  }

  const nowTimestamp = item.timestamp || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
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

  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A1:A1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Gagal membaca data laporan untuk menghapus.');

  const data = await res.json();
  const itemUids = data.values ? data.values.map((v: any[]) => v[0]) : [];
  const rowIdx = itemUids.indexOf(itemId);

  if (rowIdx === -1) {
    throw new Error(`Data item laporan dengan ItemUID ${itemId} tidak ditemukan.`);
  }

  const sheetRowIdx = rowIdx + 1;

  // Since Google Sheets values API doesn't support deleting row cleanly without shifting, we can clear the values of this row or delete the row with batchUpdate (requires gridId).
  // Clearing the row values is much simpler and safer for basic spreadsheets. Or we can clear it:
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

  const appendRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/ItemReviewHistory!A1:append?valueInputOption=USER_ENTERED`, {
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
    const txt = await appendRes.text();
    throw new Error(`Gagal menyimpan Riwayat Review Item: ${txt}`);
  }
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
    DeviceID: profile.deviceId || ''
  });

  if (existingIdx !== -1) {
    // Row is at existingIdx + 2 (since header is row 1, and index is 0-based index of slice(1))
    const sheetRowIdx = existingIdx + 2;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A${sheetRowIdx}:K${sheetRowIdx}?valueInputOption=USER_ENTERED`, {
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
  } catch (err) {
    console.error('Error fetching SiteID sheet:', err);
    return [];
  }
}

