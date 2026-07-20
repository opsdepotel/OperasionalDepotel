/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum Role {
  USER = 'USER',
  MANAGER = 'MANAGER',
  ADMIN = 'ADMIN'
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
  PENDING_TALANGAN_TRANSFER = 'PENDING_TALANGAN_TRANSFER' // Added: Waiting for Admin to transfer/reimburse bailout funds
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
  createdAt: string;
  buktiTransferUrl?: string;
  buktiTransferFileId?: string;
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
}

export interface UserProfile {
  userId?: string;
  password?: string;
  nama?: string;
  email: string;
  role: Role;
  managerEmail: string;
  divisi: string;
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
  siteId: string;
  siteName: string;
  coordinatesDb: string; // From database
  coordinatesActual: string; // From real GPS
  keterangan: string;
  buktiUrl: string;
  buktiFileId?: string;
}

