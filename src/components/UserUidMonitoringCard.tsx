/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  BudgetRequest,
  UsageReportItem,
  UserProfile,
  Role,
  RequestStatus
} from '../types';
import {
  Users,
  AlertCircle,
  CheckCircle2,
  Search,
  X,
  FileText,
  AlertOctagon,
  ShieldAlert,
  Eye,
  Lock,
  ArrowLeft
} from 'lucide-react';
import { useBackHandler } from '../hooks/useBackHandler';

interface UserUidMonitoringCardProps {
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  profiles: UserProfile[];
}

export interface UserMonitoringDetail {
  userEmail: string;
  userName: string;
  userRole: Role;
  managerEmail?: string;
  managerName?: string;
  divisi?: string;
  unreportedReqs: BudgetRequest[];
  unclosedReportedReqs: BudgetRequest[];
  unreportedCount: number;
  unclosedReportedCount: number;
  isRestricted: boolean; // unreportedCount > 2
}

const isBbmRequest = (r: BudgetRequest) =>
  r.id.startsWith('BBMDS') ||
  r.id.startsWith('BBM_DurenSawit') ||
  r.id.startsWith('TFDS') ||
  r.siteId === 'OPT-DUREN SAWIT' ||
  r.siteId === 'BBM DUREN SAWIT' ||
  (r.keterangan && r.keterangan.toUpperCase().includes('DUREN SAWIT'));

export const UserUidMonitoringCard: React.FC<UserUidMonitoringCardProps> = ({
  requests = [],
  usageItems = [],
  profiles = []
}) => {
  const [isDetailListOpen, setIsDetailListOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserDetail, setSelectedUserDetail] = useState<UserMonitoringDetail | null>(null);

  useBackHandler(!!selectedUserDetail, () => setSelectedUserDetail(null), 'userUidMonitoring_subDetailModal');
  useBackHandler(isDetailListOpen, () => setIsDetailListOpen(false), 'userUidMonitoring_mainDetailModal');

  // Filter only USER Murni profiles (role === Role.USER)
  const pureUsersData = useMemo<UserMonitoringDetail[]>(() => {
    // Collect all unique user emails whose profile role is Role.USER
    const pureUserProfilesMap = new Map<string, UserProfile>();

    profiles.forEach(p => {
      if (p.email && p.role === Role.USER) {
        pureUserProfilesMap.set(p.email.trim().toLowerCase(), p);
      }
    });

    // Also include emails from requests if they belong to Role.USER
    requests.forEach(r => {
      const emailLower = (r.userEmail || '').trim().toLowerCase();
      if (emailLower && !pureUserProfilesMap.has(emailLower)) {
        const foundProf = profiles.find(p => p.email.trim().toLowerCase() === emailLower);
        // If not found in profiles or found as USER, treat as USER murni
        if (!foundProf || foundProf.role === Role.USER) {
          pureUserProfilesMap.set(emailLower, {
            email: emailLower,
            nama: emailLower.split('@')[0],
            role: Role.USER,
            managerEmail: r.managerEmail || '',
            divisi: 'USER'
          });
        }
      }
    });

    const results: UserMonitoringDetail[] = [];

    pureUserProfilesMap.forEach((prof, emailLower) => {
      // Find supervisor display name
      const managerProf = profiles.find(p => p.email.trim().toLowerCase() === (prof.managerEmail || '').trim().toLowerCase());
      const managerName = managerProf?.nama || prof.managerEmail || 'Manager';

      // All requests for this user excluding BBM, Adjustment, and Cancelled
      const userReqs = requests.filter(r =>
        (r.userEmail || '').trim().toLowerCase() === emailLower &&
        r.status !== RequestStatus.CANCELLED &&
        r.siteId !== 'ADJUSTMENT' &&
        !isBbmRequest(r)
      );

      // 1. UID Belum Dilaporkan: Status TRANSFERRED & 0 report items
      const unreportedReqs = userReqs.filter(r =>
        r.status === RequestStatus.TRANSFERRED &&
        usageItems.filter(item => item.requestId === r.id).length === 0
      );

      // 2. UID Dilaporkan Belum CLOSED: >= 1 report items & Status !== CLOSED
      const unclosedReportedReqs = userReqs.filter(r =>
        r.status !== RequestStatus.CLOSED &&
        usageItems.filter(item => item.requestId === r.id).length > 0
      );

      const unreportedCount = unreportedReqs.length;
      const unclosedReportedCount = unclosedReportedReqs.length;
      const isRestricted = unreportedCount > 2;

      results.push({
        userEmail: prof.email,
        userName: prof.nama || prof.email.split('@')[0],
        userRole: prof.role,
        managerEmail: prof.managerEmail,
        managerName,
        divisi: prof.divisi || 'User Murni',
        unreportedReqs,
        unclosedReportedReqs,
        unreportedCount,
        unclosedReportedCount,
        isRestricted
      });
    });

    // Sort: Restricted users first, then by unreportedCount desc, then by name
    return results.sort((a, b) => {
      if (a.isRestricted && !b.isRestricted) return -1;
      if (!a.isRestricted && b.isRestricted) return 1;
      if (b.unreportedCount !== a.unreportedCount) return b.unreportedCount - a.unreportedCount;
      return a.userName.localeCompare(b.userName);
    });
  }, [profiles, requests, usageItems]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return pureUsersData;
    const q = searchQuery.toLowerCase();
    return pureUsersData.filter(u =>
      u.userName.toLowerCase().includes(q) ||
      u.userEmail.toLowerCase().includes(q) ||
      (u.divisi && u.divisi.toLowerCase().includes(q)) ||
      (u.managerName && u.managerName.toLowerCase().includes(q))
    );
  }, [pureUsersData, searchQuery]);

  const totalRestrictedCount = useMemo(() => {
    return pureUsersData.filter(u => u.isRestricted).length;
  }, [pureUsersData]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  };

  return (
    <>
      {/* 1. KARTU DASHBOARD UTAMA (HANYA SECTION 1) - CLICKABLE */}
      <div
        onClick={() => setIsDetailListOpen(true)}
        className="p-5 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/90 via-white to-blue-50/60 shadow-md hover:shadow-lg hover:border-indigo-400 transition-all cursor-pointer group flex flex-col justify-between gap-3"
        id="admin-user-uid-monitoring-card"
        title="Klik untuk membuka form rincian monitoring USER murni"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-200 group-hover:scale-105 transition-transform">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-indigo-600 transition-colors">
                  Monitoring UID Aktif
                </h3>
              </div>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                Pengawasan UID Belum Dilaporkan (&gt;2 UID dibatasi) &amp; UID Dilaporkan Belum CLOSED
              </p>
            </div>
          </div>
        </div>

        {/* Tombol Buka Rincian di Bagian Kanan Bawah */}
        <div className="flex justify-end items-center pt-2 border-t border-indigo-100/60">
          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-700 group-hover:text-indigo-900 transition-colors">
            <span>Buka Rincian</span>
            <div className="w-7 h-7 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
              &rarr;
            </div>
          </div>
        </div>
      </div>

      {/* 2. FORM RINCIAN MONITORING (MODAL FULL-WIDTH LAYAR DENGAN TOMBOL KEMBALI) */}
      {isDetailListOpen && createPortal(
        <div className="fixed inset-0 z-[110] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-6xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header Form Rincian */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Form Rincian Monitoring Laporan USER
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Monitoring UID Belum Dilaporkan (&gt;2 UID Dibatasi) &amp; UID Dilaporkan Belum CLOSED
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsDetailListOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-all cursor-pointer"
                  title="Tutup Form Rincian"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Metrics Banner */}
            <div className="px-4 sm:px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <span className="px-3 py-1 bg-white text-slate-800 font-bold rounded-xl border border-slate-200 shadow-2xs">
                  Total USER Murni: {pureUsersData.length}
                </span>
                {totalRestrictedCount > 0 ? (
                  <span className="px-3 py-1 bg-rose-100 text-rose-800 font-extrabold rounded-xl border border-rose-200 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{totalRestrictedCount} USER Murni Dibatasi (&gt;2 UID Belum Dilaporkan)</span>
                  </span>
                ) : (
                  <span className="px-3 py-1 bg-emerald-50 text-emerald-700 font-bold rounded-xl border border-emerald-200 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Seluruh USER Murni Bebas Pembatasan</span>
                  </span>
                )}
              </div>

              <div className="text-[11px] text-slate-500 font-medium">
                Menampilkan <strong>{filteredUsers.length}</strong> dari <strong>{pureUsersData.length}</strong> USER Murni
              </div>
            </div>

            {/* Search Bar & Body */}
            <div className="p-4 sm:p-5 flex-1 overflow-y-auto space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari USER murni berdasarkan nama, email, divisi, atau manager..."
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400 font-medium"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Table List View */}
              {filteredUsers.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500 italic bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  Tidak ditemukan data USER murni yang sesuai kata kunci pencarian.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-bold text-[11px]">
                        <th className="py-3 px-3.5 w-10 text-center">No</th>
                        <th className="py-3 px-3.5">Nama &amp; Email USER Murni</th>
                        <th className="py-3 px-3.5">Atasan (Manager)</th>
                        <th className="py-3 px-3.5 text-center">UID Belum Dilaporkan</th>
                        <th className="py-3 px-3.5 text-center">UID Dilaporkan Belum CLOSED</th>
                        <th className="py-3 px-3.5 text-center">Status Akses Pengajuan</th>
                        <th className="py-3 px-3.5 text-center w-24">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[11px]">
                      {filteredUsers.map((user, idx) => (
                        <tr key={user.userEmail} className={`hover:bg-slate-50 transition-colors ${user.isRestricted ? 'bg-rose-50/40' : ''}`}>
                          <td className="py-3 px-3.5 text-center text-slate-400 font-medium">{idx + 1}</td>
                          <td className="py-3 px-3.5">
                            <div className="font-bold text-slate-900">{user.userName}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{user.userEmail}</div>
                          </td>
                          <td className="py-3 px-3.5 text-slate-600 font-semibold">
                            {user.managerName}
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              user.unreportedCount > 2
                                ? 'bg-rose-100 text-rose-800 border border-rose-300 font-black'
                                : user.unreportedCount > 0
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}>
                              {user.unreportedCount} UID
                            </span>
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              user.unclosedReportedCount > 0
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}>
                              {user.unclosedReportedCount} UID
                            </span>
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            {user.isRestricted ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black bg-rose-600 text-white shadow-xs">
                                <Lock className="w-3 h-3" />
                                <span>DIBATASI (&gt;2 UID)</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                <span>AKTIF</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            <button
                              type="button"
                              onClick={() => setSelectedUserDetail(user)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 rounded-lg font-bold text-[10px] transition-all flex items-center justify-center gap-1 mx-auto cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Rincian</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer dengan Tombol Kembali */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
              <span className="text-xs text-slate-500">
                Total USER Murni terdaftar: <strong>{pureUsersData.length}</strong> user
              </span>
              <button
                type="button"
                onClick={() => setIsDetailListOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Kembali ke Dashboard</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 3. SUB-MODAL RINCIAN PER USER SPECIFIC */}
      {selectedUserDetail && createPortal(
        <div className="fixed inset-0 z-[120] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header Sub-Modal */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedUserDetail(null)}
                  className="p-2 bg-white hover:bg-slate-200/80 text-slate-700 rounded-2xl border border-slate-200 shadow-2xs transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold"
                  title="Kembali ke Daftar Monitoring User"
                >
                  <ArrowLeft className="w-4 h-4 text-slate-600" />
                  <span className="hidden sm:inline">Daftar</span>
                </button>

                <div className={`p-2.5 rounded-2xl ${selectedUserDetail.isRestricted ? 'bg-rose-100 text-rose-700' : 'bg-indigo-100 text-indigo-700'}`}>
                  {selectedUserDetail.isRestricted ? <ShieldAlert className="w-5 h-5" /> : <Users className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Rincian Status UID - {selectedUserDetail.userName}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {selectedUserDetail.userEmail} | Manager: {selectedUserDetail.managerName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserDetail(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Restriction Alert Status Banner */}
            {selectedUserDetail.isRestricted && (
              <div className="mx-4 sm:mx-5 mt-4 p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-start gap-2.5">
                <AlertOctagon className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block font-bold text-rose-900 text-sm">Status Pengajuan Dibatasi Oleh Sistem!</strong>
                  <span>
                    USER ini saat ini memiliki <strong>{selectedUserDetail.unreportedCount} UID</strong> yang sudah ditransfer oleh Finance tetapi belum mengisi laporan pemakaian sama sekali. Pengajuan baru (Operasional &amp; Dana Talangan) diblokir sampai laporan diisi.
                  </span>
                </div>
              </div>
            )}

            {/* Modal Body */}
            <div className="p-4 sm:p-5 flex-1 overflow-y-auto space-y-5">
              {/* Section 1: UID Belum Dilaporkan */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-amber-800">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <span>1. UID Belum Dilaporkan ({selectedUserDetail.unreportedCount} UID)</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">Sudah Ditransfer, 0 Item Laporan</span>
                </h4>

                {selectedUserDetail.unreportedReqs.length === 0 ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 italic">
                    Tidak ada UID belum dilaporkan.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedUserDetail.unreportedReqs.map(req => (
                      <div key={req.id} className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <div className="font-bold font-mono text-amber-900">{req.id}</div>
                          <div className="text-slate-600 mt-0.5">{req.keterangan}</div>
                        </div>
                        <div className="text-right font-mono">
                          <div className="font-extrabold text-slate-900">{formatCurrency(req.adminActionAmount || req.jumlahPengajuan)}</div>
                          <div className="text-[10px] text-slate-400">{req.tanggalPemakaian}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 2: UID Dilaporkan Belum CLOSED */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-indigo-800">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    <span>2. UID Dilaporkan Belum CLOSED ({selectedUserDetail.unclosedReportedCount} UID)</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">Ada Item Laporan, Belum Closing</span>
                </h4>

                {selectedUserDetail.unclosedReportedReqs.length === 0 ? (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 italic">
                    Tidak ada UID dilaporkan yang belum CLOSED.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedUserDetail.unclosedReportedReqs.map(req => (
                      <div key={req.id} className="p-3 bg-indigo-50/50 border border-indigo-150 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <div className="font-bold font-mono text-indigo-900">{req.id}</div>
                          <div className="text-slate-600 mt-0.5">{req.keterangan}</div>
                        </div>
                        <div className="text-right font-mono">
                          <div className="font-extrabold text-slate-900">{formatCurrency(req.adminActionAmount || req.jumlahPengajuan)}</div>
                          <div className="text-[10px] text-indigo-700 font-sans font-bold mt-0.5">Status: {req.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sub-Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/80">
              <button
                type="button"
                onClick={() => setSelectedUserDetail(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Kembali ke Daftar Monitoring</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedUserDetail(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Tutup Rincian
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
