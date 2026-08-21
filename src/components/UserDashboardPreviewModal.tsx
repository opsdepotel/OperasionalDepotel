/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { UserProfile, BudgetRequest, UsageReportItem, UserActivity, ItemReviewHistory, Role, RequestStatus, ItemStatus } from '../types';
import { useBackHandler } from '../hooks/useBackHandler';
import { DashboardStats } from './DashboardStats';
import { ZoomableImage } from './ZoomableImage';
import { parseNumericValue, formatDivisiSubDivisi } from '../lib/googleApi';
import { X, Search, User, Smartphone, Fuel, Eye, LayoutDashboard, Filter, UserCheck, FileText, CheckCircle2, AlertTriangle, Clock, MapPin, Camera, ExternalLink, ShieldCheck, Lock, History, Coins, ArrowLeft, Image as ImageIcon } from 'lucide-react';

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

  // State for Read-Only Request Detail Modal & Photo Zoom
  const [selectedDetailRequest, setSelectedDetailRequest] = useState<BudgetRequest | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; title: string } | null>(null);

  useBackHandler(!!selectedDetailRequest, () => setSelectedDetailRequest(null), 'selectedDetailRequestModal');
  useBackHandler(!!previewPhoto, () => setPreviewPhoto(null), 'previewPhotoModal');

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
                      {selectedProfile.divisi && (
                        <span>
                          • Divisi: <strong>{formatDivisiSubDivisi(selectedProfile.divisi, selectedProfile.subDivisi)}</strong>
                        </span>
                      )}
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
                      const totalNota = reqUsage.reduce((sum, item) => sum + (item.totalHarga || 0), 0);
                      const itemsWithPhoto = reqUsage.filter(u => u.buktiFoto);

                      return (
                        <div
                          key={req.id}
                          onClick={() => setSelectedDetailRequest(req)}
                          className="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200/80 hover:bg-white hover:border-indigo-400 hover:shadow-md hover:ring-1 hover:ring-indigo-400/30 transition-all space-y-2 cursor-pointer group"
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
                            <div className="shrink-0 text-right flex flex-col items-end gap-1.5">
                              {getStatusBadge(req.status)}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDetailRequest(req);
                                }}
                                className="text-[10px] font-bold text-indigo-600 group-hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg border border-indigo-200 transition-all flex items-center gap-1 cursor-pointer mt-1 shadow-2xs"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Lihat Detail UID</span>
                              </button>
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
                              <span className="text-slate-400 font-medium block">NOMINAL TOTAL NOTA:</span>
                              <span className="font-bold text-emerald-700">{formatIDR(totalNota)} ({reqUsage.length} Item)</span>
                            </div>
                          </div>

                          {/* Quick Nota Photo Thumbnails */}
                          {itemsWithPhoto.length > 0 && (
                            <div className="flex items-center gap-2 pt-1 border-t border-slate-150 text-[10px] flex-wrap">
                              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Foto Nota ({itemsWithPhoto.length}):</span>
                              <div className="flex items-center gap-1.5">
                                {itemsWithPhoto.slice(0, 5).map((item, pIdx) => (
                                  <img
                                    key={item.id || pIdx}
                                    src={item.buktiFoto}
                                    alt={`Nota ${item.keterangan}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPreviewPhoto({ url: item.buktiFoto!, title: `Bukti Nota: ${item.keterangan}` });
                                    }}
                                    className="w-7 h-7 object-cover rounded-lg border border-slate-300 hover:scale-110 hover:border-indigo-500 transition-all cursor-pointer shadow-2xs"
                                    referrerPolicy="no-referrer"
                                  />
                                ))}
                                {itemsWithPhoto.length > 5 && (
                                  <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                    +{itemsWithPhoto.length - 5} foto
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Read-Only Request Detail Modal Overlay */}
        {selectedDetailRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in-95 duration-150">
              {/* Header Modal Detail */}
              <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 border-b border-indigo-900/50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600 border border-indigo-400/30 flex items-center justify-center text-white shrink-0 shadow-md">
                    <Eye className="w-5 h-5 text-indigo-100" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-extrabold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 px-2.5 py-0.5 rounded-md">
                        {selectedDetailRequest.id}
                      </span>
                      <span className="text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1">
                        <Lock className="w-3 h-3 text-amber-300" /> Mode Read-Only Admin
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 font-medium mt-1 truncate">
                      Detail Pengajuan &amp; Status Laporan UID User (Hanya Baca)
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDetailRequest(null)}
                  className="w-9 h-9 rounded-2xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0"
                  title="Tutup Detail"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body Detail Modal */}
              <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
                {/* Requester Banner */}
                {(() => {
                  const reqProfile = profiles.find(p => p.email.toLowerCase() === selectedDetailRequest.userEmail.toLowerCase());
                  const reqUsage = usageItems.filter(u => u.requestId === selectedDetailRequest.id);
                  const totalNota = reqUsage.reduce((sum, item) => sum + (item.totalHarga || 0), 0);
                  const adminTransfer = selectedDetailRequest.adminActionAmount || 0;
                  const reqHistories = (histories || []).filter(h => h.requestId === selectedDetailRequest.id);

                  return (
                    <>
                      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-indigo-600" />
                            <span className="text-xs font-bold text-slate-800">
                              {reqProfile?.nama || selectedDetailRequest.userEmail}
                            </span>
                            {reqProfile?.userId && (
                              <span className="text-[10px] font-mono bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-semibold">
                                UID: {reqProfile.userId}
                              </span>
                            )}
                          </div>
                          <div>{getStatusBadge(selectedDetailRequest.status)}</div>
                        </div>

                        <div className="text-[11px] text-slate-500 space-y-1 pt-1 border-t border-slate-200/60">
                          <p>• Email: <strong className="text-slate-700">{selectedDetailRequest.userEmail}</strong></p>
                          {reqProfile?.divisi && (
                            <p>• Divisi: <strong className="text-slate-700">{formatDivisiSubDivisi(reqProfile.divisi, reqProfile.subDivisi)}</strong></p>
                          )}
                          {reqProfile?.managerEmail && (
                            <p>• Manager: <strong className="text-slate-700">{reqProfile.managerEmail}</strong></p>
                          )}
                          <p>• Site Pemakaian: <strong className="text-indigo-900 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">{selectedDetailRequest.siteId}</strong></p>
                          <p>• Tanggal Pemakaian: <strong className="text-slate-700">{selectedDetailRequest.tanggalPemakaian}</strong></p>
                        </div>
                      </div>

                      {/* Financial Reconciliation Summary Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-xs">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">NOMINAL DIAJUKAN</span>
                          <span className="text-sm font-bold text-slate-800 mt-0.5 block font-mono">{formatIDR(selectedDetailRequest.jumlahPengajuan)}</span>
                        </div>
                        <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-xs">
                          <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider block">TRANSFER ADMIN</span>
                          <span className="text-sm font-bold text-indigo-700 mt-0.5 block font-mono">{formatIDR(adminTransfer)}</span>
                          {selectedDetailRequest.adminActionTime && (
                            <span className="text-[9px] text-emerald-600 block mt-0.5 font-mono font-medium truncate" title={`Waktu Transfer: ${selectedDetailRequest.adminActionTime}`}>
                              {selectedDetailRequest.adminActionTime}
                            </span>
                          )}
                        </div>
                        <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-xs">
                          <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider block">TOTAL LAPORAN NOTA</span>
                          <span className="text-sm font-bold text-emerald-700 mt-0.5 block font-mono">{formatIDR(totalNota)}</span>
                          <span className="text-[9px] text-slate-400 font-semibold">{reqUsage.length} Item Nota</span>
                        </div>
                        <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-xs">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">SELISIH / SISA SALDO</span>
                          <span className={`text-sm font-bold mt-0.5 block font-mono ${
                            adminTransfer - totalNota < 0 ? 'text-rose-600' : 'text-slate-800'
                          }`}>
                            {formatIDR(adminTransfer - totalNota)}
                          </span>
                        </div>
                      </div>

                      {/* Keterangan Pengajuan */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-1.5">
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-indigo-600" /> Deskripsi / Keterangan Pengajuan
                        </h4>
                        <p className="text-xs font-medium text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-150 leading-relaxed whitespace-pre-wrap">
                          {selectedDetailRequest.keterangan}
                        </p>
                        {selectedDetailRequest.adminNote && (
                          <div className="mt-2 text-xs bg-indigo-50/80 text-indigo-900 p-2.5 rounded-xl border border-indigo-150">
                            <strong>Catatan Transfer / Finance:</strong> {selectedDetailRequest.adminNote}
                          </div>
                        )}
                        {selectedDetailRequest.rejectionReason && (
                          <div className="mt-2 text-xs bg-rose-50 text-rose-900 p-2.5 rounded-xl border border-rose-200">
                            <strong>Alasan Penolakan:</strong> {selectedDetailRequest.rejectionReason}
                          </div>
                        )}
                      </div>

                      {/* Usage Report Items (Rincian Laporan / Nota) */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                            <Coins className="w-3.5 h-3.5 text-indigo-600" /> Rincian Item Laporan / Nota ({reqUsage.length})
                          </h4>
                          <span className="text-[10px] font-bold text-emerald-700 font-mono bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            Total Nominal Nota: {formatIDR(totalNota)}
                          </span>
                        </div>

                        {reqUsage.length === 0 ? (
                          <div className="py-6 text-center text-xs text-slate-400 italic bg-slate-50 rounded-xl border border-dashed border-slate-200">
                            Belum ada rincian item laporan / nota yang diinput oleh pengguna untuk pengajuan ini.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {reqUsage.map((item, idx) => (
                              <div
                                key={item.id || idx}
                                className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5 text-xs"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-3 min-w-0">
                                    {/* Inline Photo Thumbnail if available */}
                                    {item.buktiFoto ? (
                                      <div
                                        onClick={() => setPreviewPhoto({ url: item.buktiFoto!, title: `Bukti Nota: ${item.keterangan}` })}
                                        className="w-14 h-14 rounded-xl border border-slate-300 bg-slate-200 overflow-hidden shrink-0 cursor-pointer relative group hover:ring-2 hover:ring-indigo-500/50 transition-all"
                                        title="Klik untuk memperbesar foto nota"
                                      >
                                        <img
                                          src={item.buktiFoto}
                                          alt={`Nota ${item.keterangan}`}
                                          className="w-full h-full object-cover group-hover:scale-110 transition-all"
                                          referrerPolicy="no-referrer"
                                        />
                                        <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                          <ImageIcon className="w-4 h-4 text-white" />
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="w-14 h-14 rounded-xl border border-dashed border-slate-300 bg-slate-100 flex flex-col items-center justify-center text-[9px] text-slate-400 shrink-0 text-center p-1">
                                        <ImageIcon className="w-4 h-4 mb-0.5 opacity-40" />
                                        Tanpa Nota
                                      </div>
                                    )}

                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-slate-800 text-xs">{item.keterangan}</span>
                                        {item.kategori && (
                                          <span className="text-[9px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded font-mono uppercase font-bold">
                                            {item.kategori}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                                        <span>Rincian: <strong>{item.kuantitas} x {formatIDR(item.hargaSatuan)}</strong></span>
                                        {item.status && (
                                          <span className={`px-1.5 py-0.2 rounded font-bold uppercase text-[9px] ${
                                            item.status === ItemStatus.APPROVED ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                            item.status === ItemStatus.REJECTED ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                                            'bg-amber-100 text-amber-800 border border-amber-200'
                                          }`}>
                                            {item.status}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Nominal Item Total */}
                                  <div className="text-right shrink-0">
                                    <span className="text-[9px] text-slate-400 font-medium uppercase block">Nominal Nota</span>
                                    <span className="font-bold text-emerald-700 font-mono text-sm block">
                                      {formatIDR(item.totalHarga)}
                                    </span>
                                  </div>
                                </div>

                                {/* Persetujuan Manager & Finance per item */}
                                <div className="pt-2 border-t border-slate-200/60 space-y-1 text-[10px]">
                                  <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">
                                    Status Persetujuan Item:
                                  </span>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {/* Manager Approval */}
                                    <div className={`p-1.5 rounded-lg border text-[9.5px] space-y-0.5 ${
                                      item.statusManager === ItemStatus.APPROVED
                                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                                        : item.statusManager === ItemStatus.REJECTED
                                        ? 'bg-rose-50/70 border-rose-200 text-rose-900'
                                        : 'bg-amber-50/70 border-amber-200 text-amber-900'
                                    }`}>
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="font-bold text-slate-700 flex items-center gap-1">
                                          <UserCheck className="w-3 h-3 text-slate-500" />
                                          Manager:
                                        </span>
                                        <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider border ${
                                          item.statusManager === ItemStatus.APPROVED
                                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                            : item.statusManager === ItemStatus.REJECTED
                                            ? 'bg-rose-100 text-rose-800 border-rose-300'
                                            : 'bg-amber-100 text-amber-800 border-amber-300'
                                        }`}>
                                          {item.statusManager === ItemStatus.APPROVED
                                            ? 'Disetujui'
                                            : item.statusManager === ItemStatus.REJECTED
                                            ? 'Ditolak'
                                            : 'Menunggu'}
                                        </span>
                                      </div>
                                      {item.managerComment && (
                                        <p className="text-[9px] italic text-slate-600 bg-white/80 p-1 rounded border border-slate-200/60 leading-tight">
                                          <span className="font-bold not-italic text-slate-500">Catatan:</span> "{item.managerComment}"
                                        </p>
                                      )}
                                    </div>

                                    {/* Finance Approval */}
                                    <div className={`p-1.5 rounded-lg border text-[9.5px] space-y-0.5 ${
                                      item.statusAdmin === ItemStatus.APPROVED
                                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                                        : item.statusAdmin === ItemStatus.REJECTED
                                        ? 'bg-rose-50/70 border-rose-200 text-rose-900'
                                        : 'bg-amber-50/70 border-amber-200 text-amber-900'
                                    }`}>
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="font-bold text-slate-700 flex items-center gap-1">
                                          <ShieldCheck className="w-3 h-3 text-slate-500" />
                                          Finance:
                                        </span>
                                        <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider border ${
                                          item.statusAdmin === ItemStatus.APPROVED
                                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                            : item.statusAdmin === ItemStatus.REJECTED
                                            ? 'bg-rose-100 text-rose-800 border-rose-300'
                                            : 'bg-amber-100 text-amber-800 border-amber-300'
                                        }`}>
                                          {item.statusAdmin === ItemStatus.APPROVED
                                            ? 'Disetujui'
                                            : item.statusAdmin === ItemStatus.REJECTED
                                            ? 'Ditolak'
                                            : 'Menunggu'}
                                        </span>
                                      </div>
                                      {item.adminComment && (
                                        <p className="text-[9px] italic text-slate-600 bg-white/80 p-1 rounded border border-slate-200/60 leading-tight">
                                          <span className="font-bold not-italic text-slate-500">Catatan:</span> "{item.adminComment}"
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {(item.rejectReason || item.comment) && (
                                  <p className="text-[10px] text-slate-600 bg-white p-2 rounded-lg border border-slate-200 italic">
                                    Catatan: {item.rejectReason || item.comment}
                                  </p>
                                )}

                                {/* Attachments & GPS Action Buttons */}
                                <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60 text-[10px] flex-wrap">
                                  {item.buktiFoto && (
                                    <button
                                      type="button"
                                      onClick={() => setPreviewPhoto({ url: item.buktiFoto!, title: `Bukti Nota: ${item.keterangan}` })}
                                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg border border-indigo-200 transition-all flex items-center gap-1 cursor-pointer"
                                    >
                                      <ImageIcon className="w-3 h-3 text-indigo-600" />
                                      <span>Pratinjau Foto Nota</span>
                                    </button>
                                  )}

                                  {item.koordinatGPS && (
                                    <a
                                      href={`https://www.google.com/maps?q=${encodeURIComponent(item.koordinatGPS)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-lg border border-emerald-200 transition-all flex items-center gap-1 cursor-pointer"
                                    >
                                      <MapPin className="w-3 h-3 text-emerald-600" />
                                      <span>GPS ({item.koordinatGPS})</span>
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Audit Review History */}
                      {reqHistories.length > 0 && (
                        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2">
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                            <History className="w-3.5 h-3.5 text-indigo-600" /> Catatan Audit &amp; Review ({reqHistories.length})
                          </h4>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                            {reqHistories.map((h, hIdx) => (
                              <div key={h.id || hIdx} className="p-2 bg-slate-50 rounded-lg border border-slate-150 text-[10px] space-y-0.5">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-slate-700">{h.reviewerName || h.reviewerEmail}</span>
                                  <span className="text-slate-400 font-mono">{h.timestamp}</span>
                                </div>
                                <p className="text-slate-600 font-medium">
                                  Action: <strong className="text-indigo-700">{h.action}</strong> {h.comment ? `— "${h.comment}"` : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Disclaimer Banner Read-Only */}
                      <div className="p-3 bg-amber-50/80 rounded-2xl border border-amber-200 text-amber-900 text-[11px] font-medium flex items-center gap-2.5">
                        <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>
                          <strong>Mode Read-Only Administrator:</strong> Tampilan detail ini disajikan khusus untuk pemeriksaan &amp; monitoring. Administrator tidak memiliki tombol edit, hapus, tambah, atau approval pada modal ini.
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Footer Modal Detail */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
                <span className="text-[10px] text-slate-400 font-medium">UID: {selectedDetailRequest.id}</span>
                <button
                  type="button"
                  onClick={() => setSelectedDetailRequest(null)}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
                >
                  Tutup Detail
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Preview Photo Modal Overlay */}
        {previewPhoto && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white rounded-3xl p-4 max-w-xl w-full space-y-3 shadow-2xl border border-slate-200 my-auto">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h4 className="text-xs font-bold text-slate-800 truncate">{previewPhoto.title}</h4>
                <button
                  type="button"
                  onClick={() => setPreviewPhoto(null)}
                  className="text-slate-400 hover:text-slate-600 w-6 h-6 flex items-center justify-center rounded-full hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-hidden flex flex-col items-center justify-center bg-slate-100 rounded-2xl p-2">
                <ZoomableImage
                  src={previewPhoto.url}
                  alt="Bukti Nota"
                  maxHeightClass="max-h-[55vh]"
                />
              </div>
              <div className="flex items-center justify-between pt-1 text-xs">
                <a
                  href={previewPhoto.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 font-bold hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Buka Foto Asli
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewPhoto(null)}
                  className="px-4 py-1.5 bg-slate-800 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}

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
