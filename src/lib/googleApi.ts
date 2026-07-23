/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BudgetRequest, UsageReportItem, UserProfile, Role, RequestStatus, ItemStatus, SiteInfo, UserActivity } from '../types';

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
  'ManagerComment', 'AdminActionAmount', 'CreatedAt', 'BuktiTransferUrl', 'BuktiTransferFileId'
];

const LAPORAN_HEADERS = [
  'ItemUID', 'UID', 'TanggalPenggunaan', 'Nominal', 'Keterangan',
  'BuktiUrl', 'BuktiFileId', 'StatusManager', 'ManagerComment',
  'StatusAdmin', 'AdminComment', 'UpdatedAt'
];

const USERS_HEADERS = [
  'UserID', 'Password', 'Nama', 'Email', 'Role', 'ManagerEmail', 'Divisi', 'AksesBBM'
];

const ACTIVITY_HEADERS = [
  'ActivityID', 'UserEmail', 'Tanggal', 'CreatedAt', 'SiteID', 'SiteName', 'CoordinatesDb', 'CoordinatesActual', 'Keterangan', 'BuktiUrl', 'BuktiFileId'
];

// Helper to convert sheet rows (2D array) to JSON objects
function parseSheetRows<T>(headers: string[], rows: any[][], mapper: (rowMap: Record<string, any>) => T): T[] {
  if (!rows || rows.length <= 1) return [];
  const sheetHeaders = rows[0].map(h => String(h).trim());
  const dataRows = rows.slice(1);

  return dataRows.map((row) => {
    const rowMap: Record<string, any> = {};
    headers.forEach((h) => {
      const idx = sheetHeaders.indexOf(h);
      rowMap[h] = idx !== -1 && row[idx] !== undefined ? row[idx] : '';
    });
    return mapper(rowMap);
  });
}

// Map row map to BudgetRequest
function mapToBudgetRequest(row: Record<string, any>): BudgetRequest {
  return {
    id: String(row.UID),
    userEmail: String(row.UserEmail),
    managerEmail: String(row.ManagerEmail),
    tanggalPemakaian: String(row.TanggalPemakaian),
    siteId: String(row.SiteID),
    jumlahPengajuan: Number(row.JumlahPengajuan) || 0,
    keterangan: String(row.Keterangan),
    status: (row.Status as RequestStatus) || RequestStatus.PENDING_APPROVAL,
    managerActionAmount: Number(row.ManagerActionAmount) || 0,
    managerComment: String(row.ManagerComment),
    adminActionAmount: Number(row.AdminActionAmount) || 0,
    createdAt: String(row.CreatedAt),
    buktiTransferUrl: String(row.BuktiTransferUrl || ''),
    buktiTransferFileId: String(row.BuktiTransferFileId || '')
  };
}

// Map row map to UsageReportItem
function mapToUsageItem(row: Record<string, any>): UsageReportItem {
  return {
    id: String(row.ItemUID),
    requestId: String(row.UID),
    tanggalPenggunaan: String(row.TanggalPenggunaan),
    nominal: Number(row.Nominal) || 0,
    keterangan: String(row.Keterangan),
    buktiUrl: String(row.BuktiUrl),
    buktiFileId: String(row.BuktiFileId),
    statusManager: (row.StatusManager as ItemStatus) || ItemStatus.PENDING,
    managerComment: String(row.ManagerComment),
    statusAdmin: (row.StatusAdmin as ItemStatus) || ItemStatus.PENDING,
    adminComment: String(row.AdminComment),
    updatedAt: String(row.UpdatedAt)
  };
}

// Map row map to UserProfile
function mapToUserProfile(row: Record<string, any>): UserProfile {
  const bbmVal = row.AksesBBM !== undefined ? String(row.AksesBBM).trim().toUpperCase() : '';
  return {
    userId: String(row.UserID),
    password: String(row.Password),
    nama: String(row.Nama || ''),
    email: String(row.Email),
    role: (row.Role as Role) || Role.USER,
    managerEmail: String(row.ManagerEmail),
    divisi: String(row.Divisi),
    aksesBBM: bbmVal === 'TRUE' || bbmVal === 'YA' || bbmVal === '1' || row.AksesBBM === true
  };
}

// Map row map to UserActivity
function mapToUserActivity(row: Record<string, any>): UserActivity {
  return {
    id: String(row.ActivityID),
    userEmail: String(row.UserEmail),
    tanggal: String(row.Tanggal),
    createdAt: String(row.CreatedAt),
    siteId: String(row.SiteID),
    siteName: String(row.SiteName),
    coordinatesDb: String(row.CoordinatesDb || ''),
    coordinatesActual: String(row.CoordinatesActual || ''),
    keterangan: String(row.Keterangan),
    buktiUrl: String(row.BuktiUrl),
    buktiFileId: String(row.BuktiFileId || '')
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

  const requiredSheets = ['Pengajuan', 'Laporan', 'Users', 'Activity'];
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
        { range: 'Pengajuan!A1:N1', values: [PENGAJUAN_HEADERS] },
        { range: 'Laporan!A1:L1', values: [LAPORAN_HEADERS] },
        { range: 'Users!A1:H1', values: [USERS_HEADERS] },
        { range: 'Activity!A1:K1', values: [ACTIVITY_HEADERS] }
      ]
    })
  });
  if (!headersRes.ok) {
    throw new Error(`Gagal menginisialisasi header kolom: ${headersRes.statusText}`);
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
        ['admin', 'admin123', 'Administrator Depotel', 'ops.depotel@gmail.com', 'ADMIN', '', 'HQ-CENTRAL', 'TRUE'],
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

const defaultUsers: UserProfile[] = [
  { userId: 'admin', password: 'admin123', nama: 'Administrator Depotel', email: 'ops.depotel@gmail.com', role: Role.ADMIN, managerEmail: '', divisi: 'HQ-CENTRAL', aksesBBM: true },
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

  const metadata = {
    name: `bukti_${Date.now()}_${file.name}`,
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

// Fetch Budget Requests
export async function fetchBudgetRequests(token: string, spreadsheetId: string): Promise<BudgetRequest[]> {
  if (token === 'mock_demo_token') {
    return getMockData<BudgetRequest[]>('mock_db_pengajuan', defaultRequests);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A1:N1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<BudgetRequest>(PENGAJUAN_HEADERS, data.values, mapToBudgetRequest);
}

// Fetch Usage Report Items
export async function fetchUsageItems(token: string, spreadsheetId: string): Promise<UsageReportItem[]> {
  if (token === 'mock_demo_token') {
    return getMockData<UsageReportItem[]>('mock_db_laporan', defaultUsageItems);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A1:L1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<UsageReportItem>(LAPORAN_HEADERS, data.values, mapToUsageItem);
}

// Fetch Profiles
export async function fetchProfiles(token: string, spreadsheetId: string): Promise<UserProfile[]> {
  if (token === 'mock_demo_token') {
    return getMockData<UserProfile[]>('mock_db_users', defaultUsers);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A1:H1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<UserProfile>(USERS_HEADERS, data.values, mapToUserProfile);
}

// Fetch User Activities
export async function fetchUserActivities(token: string, spreadsheetId: string): Promise<UserActivity[]> {
  if (token === 'mock_demo_token') {
    return getMockData<UserActivity[]>('mock_db_kegiatan', []);
  }
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Activity!A1:K1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return parseSheetRows<UserActivity>(ACTIVITY_HEADERS, data.values, mapToUserActivity);
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
    const prefix = req.id.startsWith('BBM_DurenSawit') ? 'BBM_DurenSawit' : req.id.startsWith('OPT') ? 'OPT' : 'OP';
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
    const prefix = req.id.startsWith('BBM_DurenSawit') ? 'BBM_DurenSawit' : req.id.startsWith('OPT') ? 'OPT' : req.id.startsWith('ADJ') ? 'ADJ' : 'OP';
    
    // Regenerate until we find a completely unused ID
    while (!isUnique) {
      const randomDigits = Math.floor(1000 + Math.random() * 9000); // 4-digit code
      finalUid = `${prefix}-${todayStr}-${randomDigits}`;
      isUnique = !existingUIDs.includes(finalUid.toUpperCase());
    }
    
    req.id = finalUid; // Save back to the request object so caller knows the final unique UID

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
      CreatedAt: req.createdAt,
      BuktiTransferUrl: req.buktiTransferUrl || '',
      BuktiTransferFileId: req.buktiTransferFileId || ''
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
    CreatedAt: req.createdAt,
    BuktiTransferUrl: req.buktiTransferUrl || '',
    BuktiTransferFileId: req.buktiTransferFileId || ''
  });

  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pengajuan!A${sheetRowIdx}:N${sheetRowIdx}?valueInputOption=USER_ENTERED`, {
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
    UpdatedAt: item.updatedAt
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
    UpdatedAt: item.updatedAt
  });

  const updateRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A${sheetRowIdx}:L${sheetRowIdx}?valueInputOption=USER_ENTERED`, {
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
  const clearRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Laporan!A${sheetRowIdx}:L${sheetRowIdx}:clear`, {
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

  const rowData = objectToRow(ACTIVITY_HEADERS, {
    ActivityID: activity.id,
    UserEmail: activity.userEmail,
    Tanggal: activity.tanggal,
    CreatedAt: activity.createdAt,
    SiteID: activity.siteId,
    SiteName: activity.siteName,
    CoordinatesDb: activity.coordinatesDb,
    CoordinatesActual: activity.coordinatesActual,
    Keterangan: activity.keterangan,
    BuktiUrl: activity.buktiUrl,
    BuktiFileId: activity.buktiFileId || ''
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
      aksesBBM: !!profile.aksesBBM
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
    AksesBBM: profile.aksesBBM ? 'TRUE' : 'FALSE'
  });

  if (existingIdx !== -1) {
    // Row is at existingIdx + 2 (since header is row 1, and index is 0-based index of slice(1))
    const sheetRowIdx = existingIdx + 2;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Users!A${sheetRowIdx}:H${sheetRowIdx}?valueInputOption=USER_ENTERED`, {
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

