/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum Role {
  USER = 'USER',
  MANAGER = 'MANAGER',
  FINANCE = 'FINANCE',
  DIREKTUR = 'DIREKTUR',
  ADMINISTRATOR = 'ADMINISTRATOR'
}

export enum RequestStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // Waiting for Manager Review
  PARTIALLY_APPROVED = 'PARTIALLY_APPROVED', // Approved partially by Manager, waiting for Admin
  APPROVED = 'APPROVED', // Fully approved by Manager, waiting for Admin transfer
  REJECTED = 'REJECTED', // Rejected by Manager
  TRANSFERRED = 'TRANSFERRED', // Transfer complete by Admin, User can report usage
  REPORTING = 'REPORTING', // User is filling usage reports, or has pending corrections
  REVIEW_MANAGER = 'REVIEW_MANAGER', // Reports submitted, waiting for Manager review
  REVIEW_ADMIN = 'REVIEW_ADMIN', // Reports approved by Manager, waiting for Admin review
  CLOSED = 'CLOSED', // All reports approved by Admin, process closed
  PENDING_TALANGAN_TRANSFER = 'PENDING_TALANGAN_TRANSFER', // Waiting for Admin to transfer/reimburse bailout funds
  PENDING_PENGAJUAN_TRANSFER = 'PENDING_PENGAJUAN_TRANSFER', // Waiting for Finance to transfer operational funds after Finance approval
  TRANSFER_BERTAHAP = 'TRANSFER_BERTAHAP', // Partial transfer made for operational funds, User can start reporting while waiting for next transfer
  CANCELLED = 'CANCELLED' // Cancelled manually or auto-cancelled after 2 days
}

export enum ItemStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export interface BudgetRequest {
  id: string; // Map to UID in Sheet
  userEmail: string;
  managerEmail: string;
  tanggalPemakaian: string;
  siteId: string;
  jumlahPengajuan: number;
  keterangan: string;
  status: RequestStatus;
  managerActionAmount: number;
  managerComment: string;
  adminActionAmount: number;
  adminComment?: string;
  createdAt: string;
  timestamp?: string;
  buktiTransferUrl?: string;
  buktiTransferFileId?: string;
  adminActionTime?: string;
  tipePengajuan?: string;
}

export interface UsageReportItem {
  id: string; // Map to ItemUID in Sheet
  requestId: string; // Map to UID
  tanggalPenggunaan: string;
  nominal: number;
  keterangan: string;
  buktiUrl: string;
  buktiFileId: string;
  statusManager: ItemStatus;
  managerComment: string;
  statusAdmin: ItemStatus;
  adminComment: string;
  updatedAt: string;
  timestamp?: string;
}

export interface UserProfile {
  userId?: string;
  password?: string;
  nama?: string;
  email: string;
  role: Role;
  managerEmail: string;
  divisi: string;
  subDivisi?: string;
  aksesBBM?: boolean;
  mobile?: boolean;
  deviceId?: string;
  fotoProfile?: string;
  fotoProfileFileId?: string;
}

export interface SiteInfo {
  siteId: string;
  siteName: string;
  coordinates: string;
}

export interface UserActivity {
  id: string; // Map to ActivityID
  userEmail: string;
  tanggal: string; // YYYY-MM-DD
  createdAt: string; // Timestamp
  timestamp?: string;
  siteId: string;
  siteName: string;
  coordinatesDb: string; // From database
  coordinatesActual: string; // From real GPS
  keterangan: string;
  buktiUrl: string;
  buktiFileId?: string;
  indikasiFake?: boolean;
  fakeReason?: string;
  // Persistent AI Screen Recapture database fields
  aiRecaptureVerdict?: string; // 'AUTHENTIC' | 'SCREEN_RECAPTURE_DETECTED' | 'SUSPICIOUS' | string
  aiRecaptureConfidence?: number; // 0 - 100
  aiRecaptureSummary?: string;
  aiRecaptureIndicators?: string; // JSON array or comma-separated string
  aiRecaptureCheckedAt?: string;
}

export interface ResetDeviceLog {
  id: string; // Map to LogID
  timestamp: string;
  adminEmail: string;
  adminNama: string;
  targetUserEmail: string;
  targetUserNama: string;
  oldDeviceId: string;
  keterangan: string;
}

export interface ItemReviewHistory {
  id: string; // Map to HistoryID
  itemUid: string; // Map to ItemUID
  requestUid: string; // Map to RequestUID
  timestamp: string; // YYYY-MM-DD HH:mm:ss
  actorRole: Role | string;
  actorEmail: string;
  actorNama: string;
  actionType: 'APPROVAL_MANAGER' | 'APPROVAL_DIREKTUR' | 'REVISI_MANAGER' | 'REVISI_DIREKTUR' | 'APPROVAL_FINANCE' | 'REVISI_FINANCE' | 'PERBAIKAN_USER' | 'ITEM_CREATED' | 'PENGAJUAN_CREATED' | 'PENGAJUAN_REVISED';
  status: string; // 'DISETUJUI' | 'REVISI' | 'SUBMITTED' | 'PERBAIKAN SUBMITTED'
  catatan: string;
  tanggalPenggunaan: string;
  nominal: number;
  keterangan: string;
  buktiFileId?: string;
  buktiUrl?: string;
}

/**
 * Normalizes any date/timestamp string or Date object into uniform YYYY-MM-DD HH:mm:ss format
 */
export function formatTimestamp(tsInput?: string | Date | null): string {
  if (!tsInput) return '';
  if (tsInput instanceof Date) {
    if (isNaN(tsInput.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${tsInput.getFullYear()}-${pad(tsInput.getMonth() + 1)}-${pad(tsInput.getDate())} ${pad(tsInput.getHours())}:${pad(tsInput.getMinutes())}:${pad(tsInput.getSeconds())}`;
  }

  const str = String(tsInput).trim();
  if (!str) return '';

  // 1. If string is already in YYYY-MM-DD HH:mm:ss format
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(str)) {
    return str;
  }

  // 2. Direct Date parsing (e.g. ISO strings)
  const dDirect = new Date(str);
  if (!isNaN(dDirect.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${dDirect.getFullYear()}-${pad(dDirect.getMonth() + 1)}-${pad(dDirect.getDate())} ${pad(dDirect.getHours())}:${pad(dDirect.getMinutes())}:${pad(dDirect.getSeconds())}`;
  }

  // 3. Handle YYYY-MM-DD HH:mm:ss without space or ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str.replace(' ', 'T'));
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }

  // 4. Handle DD/MM/YYYY or D/M/YYYY, HH.mm.ss or HH:mm:ss (id-ID locale strings)
  const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2})[\.:](\d{1,2})(?:[\.:](\d{1,2}))?)?/);
  if (match) {
    const [, day, month, year, hour = '0', min = '0', sec = '0'] = match;
    const d = new Date(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(min, 10),
      parseInt(sec, 10)
    );
    if (!isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }

  return str;
}


