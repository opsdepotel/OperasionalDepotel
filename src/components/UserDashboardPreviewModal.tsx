/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { UserProfile, BudgetRequest, UsageReportItem, UserActivity, ItemReviewHistory, Role, RequestStatus } from '../types';
import { useBackHandler } from '../hooks/useBackHandler';
import { DashboardStats } from './DashboardStats';
import { parseNumericValue } from '../lib/googleApi';
import { X, Search, User, Smartphone, Fuel, Eye, LayoutDashboard, Filter, UserCheck } from 'lucide-react';

interface UserDashboardPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: UserProfile[];
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  activities: UserActivity[];
  histories?: ItemReviewHistory[];
}

export const UserDashboardPreviewModal: React.FC<UserDashboardPreviewModalProps> = ({
  isOpen,
  onClose,
  profiles = [],
  requests = [],
  usageItems = [],
  activities = [],
  histories = []
}) => {
  useBackHandler(isOpen, onClose, 'isUserDashboardPreviewModalOpen');

  // Search & Selected User State
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string>('');
  const [dashboardFilter, setDashboardFilter] = useState<string>('ALL');
  const [reqSearchQuery, setReqSearchQuery] = useState<string>('');

  // Default to first user profile or staff when opened
  useEffect(() => {
    if (isOpen && profiles.length > 0) {
      if (!selectedEmail || !profiles.some(p => p.email.toLowerCase() === selectedEmail.toLowerCase())) {
        const staff = profiles.find(p => p.role === Role.USER) || profiles[0];
        if (staff) {
          setSelectedEmail(staff.email);
        }
      }
    }
  }, [isOpen, profiles]);

  // Filtered profiles for selector
  const filteredProfiles = useMemo(() => {
    if (!searchTerm.trim()) return profiles;
    const q = searchTerm.toLowerCase().trim();
    return profiles.filter(p => {
      const name = (p.nama || '').toLowerCase();
      const uid = (p.userId || '').toLowerCase();
      const email = (p.email || '').toLowerCase();
      const role = (p.role || '').toLowerCase();
      const divisi = (p.divisi || '').toLowerCase();
      return name.includes(q) || uid.includes(q) || email.includes(q) || role.includes(q) || divisi.includes(q);
    });
  }, [profiles, searchTerm]);

  const selectedProfile = useMemo(() => {
    if (!selectedEmail) return null;
    return profiles.find(p => p.email.toLowerCase() === selectedEmail.toLowerCase()) || null;
  }, [profiles, selectedEmail]);

  // Filter requests belonging to the selected user
  const userRequests = useMemo(() => {
    if (!selectedProfile) return [];
    const emailToMatch = selectedProfile.email.toLowerCase();
    return requests.filter(r => r.userEmail.toLowerCase() === emailToMatch && r.status !== RequestStatus.CANCELLED);
  }, [requests, selectedProfile]);

  // Filtered requests based on dashboard filter card & request search
  const displayedRequests = useMemo(() => {
    let list = userRequests;

    // Apply dashboard filter card key if active
    if (dashboardFilter !== 'ALL') {
      if (dashboardFilter === 'PENDING') {
        list = list.filter(r => r.status === RequestStatus.PENDING_APPROVAL || r.status === RequestStatus.PARTIALLY_APPROVED);
      } else if (dashboardFilter === 'APPROVED') {
        list = list.filter(r => r.status === RequestStatus.APPROVED);
      } else if (dashboardFilter === 'TRANSFERRED') {
        list = list.filter(r => r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.REPORTING);
      } else if (dashboardFilter === 'REPORTING') {
        list = list.filter(r => r.status === RequestStatus.REVIEW_MANAGER || r.status === RequestStatus.REVIEW_ADMIN);
      } else if (dashboardFilter === 'CLOSED') {
        list = list.filter(r => r.status === RequestStatus.CLOSED);
      } else if (dashboardFilter === 'REJECTED') {
        list = list.filter(r => r.status === RequestStatus.REJECTED);
      } else if (dashboardFilter === 'TALANGAN') {
        list = list.filter(r => r.id.startsWith('OPT-') || r.keterangan.startsWith('[DANA TALANGAN]'));
      }
    }

    if (reqSearchQuery.trim()) {
      const q = reqSearchQuery.toLowerCase().trim();
      list = list.filter(r => {
        const reqProfile = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
        return (
          r.id.toLowerCase().includes(q) ||
          r.siteId.toLowerCase().includes(q) ||
          r.keterangan.toLowerCase().includes(q) ||
          r.userEmail.toLowerCase().includes(q) ||
          (reqProfile?.nama && reqProfile.nama.toLowerCase().includes(q)) ||
          (reqProfile?.userId && reqProfile.userId.toLowerCase().includes(q))
        );
      });
    }

    return list.sort((a, b) => b.id.localeCompare(a.id));
  }, [userRequests, dashboardFilter, reqSearchQuery]);

  if (!isOpen) return null;

  const formatIDR = (num: any) => {
    const val = parseNumericValue(num);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
  };

  const getRoleBadgeColor = (role?: Role) => {
    switch (role) {
      case Role.USER: return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case Role.MANAGER: return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case Role.FINANCE: return 'bg-rose-100 text-rose-700 border-rose-200';
      case Role.DIREKTUR: return 'bg-purple-100 text-purple-700 border-purple-200';
      case Role.ADMINISTRATOR: return 'bg-blue-100 text-blue-700 border-blue-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusBadge = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.PENDING_APPROVAL:
      case RequestStatus.PARTIALLY_APPROVED:
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200">Pending Approval</span>;
      case RequestStatus.APPROVED:
        return <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-200">Menunggu Transfer</span>;
      case RequestStatus.TRANSFERRED:
      case RequestStatus.REPORTING:
        return <span className="bg-cyan-100 text-cyan-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-cyan-200">Proses Laporan</span>;
      case RequestStatus.REVIEW_MANAGER:
        return <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-200">Review Manager</span>;
      case RequestStatus.REVIEW_ADMIN:
        return <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-200">Review Admin</span>;
      case RequestStatus.CLOSED:
        return <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200">Selesai (Closed)</span>;
      case RequestStatus.REJECTED:
        return <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-200">Ditolak</span>;
      default:
        return <span className="bg-slate-100 text-slate-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-200">{status}</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-slate-50 w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto">
        
        {/* Header Modal */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 border-b border-indigo-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/80 border border-indigo-400/30 flex items-center justify-center text-white shrink-0 shadow-md">
              <Eye className="w-5 h-5 text-indigo-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-sm sm:text-base text-white">
                  Pratinjau Dashboard Akun Pengguna
                </h2>
                <span className="text-[9px] font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Admin Inspection
                </span>
              </div>
              <p className="text-[11px] text-slate-300 font-medium mt-0.5">
                Monitoring status UID, saldo operasional, task &amp; tampilan dashboard sama persis seperti akun pengguna terpilih.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-2xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0"
            title="Tutup Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">

          {/* User Search Input Panel (Tanpa Banner Pilihan Nama) */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm relative z-30 space-y-2">
            <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between flex-wrap gap-2">
              <span className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-600" />
                Cari &amp; Pilih Akun Pengguna:
              </span>
              {selectedProfile && (
                <span className="text-[10px] text-indigo-700 font-bold bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
                  Terpilih: <strong>{selectedProfile.nama || selectedProfile.email}</strong>
                  {selectedProfile.userId && <span className="text-slate-500 font-mono">({selectedProfile.userId})</span>}
                </span>
              )}
            </label>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="Ketik nama, UID, email, role, atau divisi..."
                value={searchTerm}
                onFocus={() => setIsSearchOpen(true)}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setIsSearchOpen(true);
                }}
                className="w-full pl-10 pr-9 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white font-semibold text-slate-800 transition-all shadow-inner"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setIsSearchOpen(true);
                  }}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full hover:bg-slate-200 transition-colors cursor-pointer"
                  title="Bersihkan pencarian"
                >
                  ×
                </button>
              )}

              {/* Floating Suggestions Dropdown */}
              {isSearchOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setIsSearchOpen(false)} 
                  />
                  <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-xl z-20 max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {filteredProfiles.length === 0 ? (
                      <div className="p-3.5 text-center text-xs text-slate-400 italic">
                        User tidak ditemukan dengan kata kunci "{searchTerm}"
                      </div>
                    ) : (
                      filteredProfiles.map((p) => {
                        const isSelected = selectedProfile?.email.toLowerCase() === p.email.toLowerCase();
                        return (
                          <button
                            key={p.email}
                            type="button"
                            onClick={() => {
                              setSelectedEmail(p.email);
                              setDashboardFilter('ALL');
                              setIsSearchOpen(false);
                              setSearchTerm('');
                            }}
                            className={`w-full p-3 text-left text-xs transition-all flex items-center justify-between gap-3 cursor-pointer ${
                              isSelected 
                                ? 'bg-indigo-50/90 font-bold text-indigo-900' 
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 shadow-xs ${
                                isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200'
                              }`}>
                                {(p.nama || p.email)[0].toUpperCase()}
                              </div>
                              <div className="truncate">
                                <div className="font-bold flex items-center gap-2 truncate text-slate-800">
                                  <span className="truncate">{p.nama || p.email}</span>
                                  {p.userId && (
                                    <span className="text-[9px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200 shrink-0">
                                      UID: {p.userId}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 truncate mt-0.5">
                                  {p.email} {p.divisi ? `• Divisi ${p.divisi}` : ''}
                                </div>
                              </div>
                            </div>

                            <span className={`text-[9px] font-bold px-2.5 py-0.5 rounded-full border shrink-0 ${getRoleBadgeColor(p.role)}`}>
                              {p.role}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Selected User Header Banner */}
          {selectedProfile && (
            <div className="bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white rounded-2xl p-4 sm:p-5 shadow-sm border border-indigo-800/60 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/30 border border-indigo-400/40 text-white flex items-center justify-center font-display font-bold text-lg shrink-0 shadow-inner">
                    {(selectedProfile.nama || selectedProfile.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-bold text-base text-white">
                        {selectedProfile.nama || selectedProfile.email}
                      </h3>
                      {selectedProfile.userId && (
                        <span className="text-[10px] font-mono font-bold bg-white/10 text-indigo-200 px-2 py-0.5 rounded-md border border-white/10">
                          UID: {selectedProfile.userId}
                        </span>
                      )}
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase border ${getRoleBadgeColor(selectedProfile.role)}`}>
                        {selectedProfile.role}
                      </span>
                    </div>
                    <p className="text-[11px] text-indigo-200 mt-1 flex items-center gap-2 flex-wrap">
                      <span>{selectedProfile.email}</span>
                      {selectedProfile.divisi && <span>• Divisi: <strong>{selectedProfile.divisi}</strong></span>}
                      {selectedProfile.managerEmail && <span>• Manager: <strong>{selectedProfile.managerEmail}</strong></span>}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap sm:justify-end text-[10px]">
                  <span className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 ${
                    selectedProfile.deviceId || selectedProfile.mobile 
                      ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30' 
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}>
                    <Smartphone className="w-3 h-3" />
                    {selectedProfile.deviceId || selectedProfile.mobile ? 'Perangkat Terikat' : 'Tanpa Perangkat'}
                  </span>

                  <span className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 ${
                    selectedProfile.aksesBBM 
                      ? 'bg-amber-500/20 text-amber-200 border-amber-500/30' 
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    <Fuel className="w-3 h-3" />
                    {selectedProfile.aksesBBM ? 'Akses BBM Active' : 'Tanpa Akses BBM'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Embedded Dashboard View */}
          {selectedProfile && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <h3 className="font-display font-bold text-xs uppercase text-slate-700 tracking-wider flex items-center gap-2">
                  <LayoutDashboard className="w-4 h-4 text-indigo-600" />
                  Tampilan Dashboard Akun ({selectedProfile.nama || selectedProfile.email})
                </h3>
                <span className="text-[10px] text-slate-500 font-medium">
                  {userRequests.length} Pengajuan / Transaksi Terdaftar
                </span>
              </div>

              {/* Renders DashboardStats for Selected Profile */}
              <DashboardStats
                role={selectedProfile.role}
                email={selectedProfile.email}
                requests={requests}
                usageItems={usageItems}
                activeFilter={dashboardFilter}
                onSelectFilter={setDashboardFilter}
                profiles={profiles}
                activities={activities}
                userProfile={selectedProfile}
                histories={histories}
              />

              {/* Detail List of User Requests / Status UID */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3 mt-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-indigo-600" />
                    <h4 className="font-display font-bold text-xs text-slate-800 uppercase tracking-wider">
                      Daftar Status Pengajuan UID ({selectedProfile.nama || selectedProfile.email})
                    </h4>
                    {dashboardFilter !== 'ALL' && (
                      <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                        Filter: {dashboardFilter}
                      </span>
                    )}
                  </div>

                  <div className="relative w-full sm:w-60">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Cari UID, nama pemohon, site, keterangan..."
                      value={reqSearchQuery}
                      onChange={(e) => setReqSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {displayedRequests.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs italic bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    Tidak ada transaksi / pengajuan UID yang sesuai filter.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                    {displayedRequests.map((req) => {
                      const reqUsage = usageItems.filter(u => u.requestId === req.id);
                      const isTalangan = req.id.startsWith('OPT-') || req.keterangan.startsWith('[DANA TALANGAN]');

                      return (
                        <div
                          key={req.id}
                          className="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200/80 hover:bg-white hover:border-indigo-300 hover:shadow-sm transition-all space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-[11px] font-bold text-indigo-900 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                  {req.id}
                                </span>
                                {isTalangan && (
                                  <span className="text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded">
                                    Dana Talangan
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-500 font-medium">
                                  Site: <strong className="text-slate-800">{req.siteId}</strong>
                                </span>
                                <span className="text-[10px] text-slate-400">• {req.tanggalPemakaian}</span>
                              </div>
                              <p className="text-xs font-semibold text-slate-800 mt-1 whitespace-pre-wrap leading-relaxed">
                                {req.keterangan}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              {getStatusBadge(req.status)}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 text-[10px]">
                            <div>
                              <span className="text-slate-400 font-medium block">JUMLAH DIAJUKAN:</span>
                              <span className="font-bold text-slate-800">{formatIDR(req.jumlahPengajuan)}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 font-medium block">TRANSFER ADMIN:</span>
                              <span className="font-bold text-indigo-700">{formatIDR(req.adminActionAmount || 0)}</span>
                            </div>
                            <div className="col-span-2 sm:col-span-1">
                              <span className="text-slate-400 font-medium block">LAPORAN MASUK:</span>
                              <span className="font-bold text-slate-700">{reqUsage.length} Item Nota</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between shrink-0">
          <p className="text-[10px] text-slate-400 font-medium hidden sm:block">
            Fitur Pintasan Administrator — Hanya dapat diakses oleh role Administrator.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer ml-auto"
          >
            Tutup Pratinjau
          </button>
        </div>

      </div>
    </div>
  );
};
