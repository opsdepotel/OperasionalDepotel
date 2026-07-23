/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BudgetRequest, UsageReportItem, UserProfile, UserActivity } from '../types';
import { Fuel, Calendar, Search, MapPin, FileText, X, Image as ImageIcon, CheckCircle2, ChevronRight, Filter, RefreshCw, Activity, Camera, Clock, User, ExternalLink } from 'lucide-react';

interface BbmListModalProps {
  isOpen: boolean;
  onClose: () => void;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  profiles?: UserProfile[];
  activities?: UserActivity[];
  onOpenBbmRefillModal?: () => void;
  onPreviewDocument?: (url: string) => void;
}

// Helper to extract Google Drive File ID from URL or raw ID
const extractDriveFileId = (url?: string, fileId?: string): string | null => {
  if (fileId && !fileId.startsWith('BBM_NOTA_')) {
    return fileId.trim();
  }
  if (!url) return null;
  const fileDMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileDMatch && fileDMatch[1]) return fileDMatch[1];

  const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch && idParamMatch[1]) return idParamMatch[1];

  return null;
};

// Helper to get printable image src URL for <img> tags
const getImageSrc = (rawUrl?: string, rawFileId?: string): string => {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('data:')) return rawUrl;

  const driveId = extractDriveFileId(rawUrl, rawFileId);
  if (driveId) {
    return `https://drive.google.com/thumbnail?sz=w1000&id=${driveId}`;
  }

  return rawUrl;
};

export const BbmListModal: React.FC<BbmListModalProps> = ({
  isOpen,
  onClose,
  requests,
  usageItems,
  profiles = [],
  activities = [],
  onOpenBbmRefillModal,
  onPreviewDocument
}) => {
  if (!isOpen) return null;

  // Format local date string YYYY-MM-DD
  const getTodayDateStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getYesterdayDateStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayStr = getTodayDateStr();

  // Selected date filter (default: today's date)
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [imageErrorMap, setImageErrorMap] = useState<Record<string, boolean>>({});

  // Selected User Activity popup modal
  const [selectedUserActivityModal, setSelectedUserActivityModal] = useState<{
    userEmail: string;
    userName: string;
    tanggal: string;
  } | null>(null);

  // Helper date normalizer
  const getNormalizedYmd = (dateStr?: string): string => {
    if (!dateStr) return '';
    if (dateStr.includes('T')) return dateStr.split('T')[0];
    if (dateStr.length >= 10) return dateStr.substring(0, 10);
    return dateStr;
  };

  // User activities matching target user and date
  const userActivitiesForDate = (activities || []).filter(act => {
    if (!selectedUserActivityModal) return false;
    const matchesUser = act.userEmail.toLowerCase() === selectedUserActivityModal.userEmail.toLowerCase();
    const actDate = getNormalizedYmd(act.tanggal);
    const targetDate = getNormalizedYmd(selectedUserActivityModal.tanggal);
    return matchesUser && actDate === targetDate;
  });

  // Format Currency
  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(num);
  };

  // Helper date display e.g. "Rabu, 22 Juli 2026"
  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return 'Semua Tanggal';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return new Intl.DateTimeFormat('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(d);
    } catch {
      return dateStr;
    }
  };

  // Helper short date display e.g. "23 Jul 2026"
  const formatShortDateDisplay = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr.substring(0, 10);
      const d = new Date(cleanDate + 'T00:00:00');
      return new Intl.DateTimeFormat('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }).format(d);
    } catch {
      return dateStr;
    }
  };

  // Filter all BBM Duren Sawit requests
  const isBbmRequest = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
  const bbmRequests = requests.filter(isBbmRequest);

  // Filter by selected date
  const filteredByDate = selectedDate
    ? bbmRequests.filter(r => r.tanggalPemakaian === selectedDate)
    : bbmRequests;

  // Filter by search query
  const filteredRequests = filteredByDate.filter(r => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const user = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
    const userName = user?.nama || r.userEmail;
    return (
      r.id.toLowerCase().includes(query) ||
      r.userEmail.toLowerCase().includes(query) ||
      userName.toLowerCase().includes(query) ||
      r.siteId.toLowerCase().includes(query) ||
      r.keterangan.toLowerCase().includes(query)
    );
  });

  // Calculate total statistics for selected date / filtered
  const totalCount = filteredRequests.length;
  const totalNominal = filteredRequests.reduce((sum, r) => sum + r.jumlahPengajuan, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden animate-scale-up">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-200 shrink-0">
              <Fuel className="w-5.5 h-5.5" />
            </div>
            <div>
              <h2 className="font-display font-extrabold text-slate-800 text-sm sm:text-base">
                Daftar Pengisian BBM Duren Sawit
              </h2>
              <p className="text-[11px] text-slate-500 font-medium">
                Log Histori Transaksi Refill BBM Operasional Pos Duren Sawit
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-200/60 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-all cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filters & Control Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-white space-y-3 shrink-0">
          
          {/* Top Control Row: Date Filter & Search */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            
            {/* Date Input */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-amber-500" />
                <span>Pilih Tanggal Pengisian</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all cursor-pointer"
                />
                {selectedDate && (
                  <button
                    onClick={() => setSelectedDate('')}
                    title="Tampilkan Semua Tanggal"
                    className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[11px] font-bold transition-all shrink-0 cursor-pointer"
                  >
                    Semua
                  </button>
                )}
              </div>
            </div>

            {/* Search Input */}
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Search className="w-3 h-3 text-indigo-500" />
                <span>Cari Pengisi / Plat Nomor / UID</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Ketik plat nomor, pengisi, site..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              </div>
            </div>
          </div>

          {/* Quick Date Selectors & Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setSelectedDate(todayStr)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  selectedDate === todayStr
                    ? 'bg-amber-500 text-white shadow-sm shadow-amber-200'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                Hari Ini
              </button>
              <button
                onClick={() => setSelectedDate(getYesterdayDateStr())}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  selectedDate === getYesterdayDateStr()
                    ? 'bg-amber-500 text-white shadow-sm shadow-amber-200'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                Kemarin
              </button>
              <button
                onClick={() => setSelectedDate('')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  selectedDate === ''
                    ? 'bg-amber-500 text-white shadow-sm shadow-amber-200'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                Semua Tanggal
              </button>
            </div>

            {onOpenBbmRefillModal && (
              <button
                onClick={() => {
                  onClose();
                  onOpenBbmRefillModal();
                }}
                className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200/80 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <Fuel className="w-3.5 h-3.5 text-amber-600" />
                <span>+ Input BBM Baru</span>
              </button>
            )}
          </div>

          {/* Summary Banner for Selected Filter */}
          <div className="bg-amber-50/70 border border-amber-200/60 rounded-2xl p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-bold text-amber-900">
                {formatDateDisplay(selectedDate)}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-600 font-medium">
                Total Transaksi: <strong className="text-slate-900 font-bold">{totalCount}</strong>
              </span>
              <span className="text-slate-600 font-medium">
                Total Nominal: <strong className="text-amber-700 font-extrabold">{formatIDR(totalNominal)}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Content Body / Scrollable List */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 flex-1 bg-slate-50/50">
          {filteredRequests.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3 my-4">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 mx-auto flex items-center justify-center">
                <Fuel className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-bold text-slate-800 text-sm">
                  Tidak Ada Transaksi BBM
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 font-medium">
                  {selectedDate
                    ? `Belum ada pengisian BBM Duren Sawit tercatat pada tanggal ${formatDateDisplay(selectedDate)}.`
                    : 'Tidak ada transaksi pengisian BBM Duren Sawit yang cocok dengan kriteria pencarian.'}
                </p>
              </div>
              {selectedDate && (
                <button
                  onClick={() => setSelectedDate('')}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Tampilkan Semua Tanggal</span>
                </button>
              )}
            </div>
          ) : (
            filteredRequests.map((req) => {
              const user = profiles.find(p => p.email.toLowerCase() === req.userEmail.toLowerCase());
              const userName = user?.nama || req.userEmail;
              const usageItem = usageItems.find(item => item.requestId === req.id || item.id.startsWith(req.id) || (item.requestId && req.id.includes(item.requestId)));
              const rawBuktiPhoto = usageItem?.buktiUrl || req.buktiTransferUrl;
              const rawBuktiFileId = usageItem?.buktiFileId || req.buktiTransferFileId;
              const displayImgUrl = getImageSrc(rawBuktiPhoto, rawBuktiFileId);
              const isImgFailed = imageErrorMap[req.id];

              return (
                <div
                  key={req.id}
                  className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm hover:border-amber-300 hover:shadow-md transition-all space-y-3"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md text-[10px] font-mono font-bold">
                          {req.id}
                        </span>
                        <span className="text-xs font-bold text-slate-800">
                          {userName}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          ({req.userEmail})
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium flex items-center gap-1 pt-0.5">
                        <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>Tanggal Pengisian : {formatShortDateDisplay(req.tanggalPemakaian)}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/60 rounded-lg text-[10px] font-bold">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Selesai</span>
                      </span>
                    </div>
                  </div>

                  {/* Card Details Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        Lokasi / Pos
                      </span>
                      <p className="text-xs font-bold text-slate-800 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>{req.siteId}</span>
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        Nominal BBM
                      </span>
                      <p className="text-sm font-extrabold font-display text-amber-600 mt-0.5">
                        {formatIDR(req.jumlahPengajuan)}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        Keterangan / Plat Nomor
                      </span>
                      <p className="text-xs font-medium text-slate-700 mt-0.5 line-clamp-2">
                        {req.keterangan || '-'}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2 flex-wrap">
                    {rawBuktiPhoto && (
                      <button
                        type="button"
                        onClick={() => setSelectedPhotoUrl(displayImgUrl || rawBuktiPhoto)}
                        className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-amber-600" />
                        <span>Lihat Nota</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const targetDate = req.tanggalPemakaian ? req.tanggalPemakaian.substring(0, 10) : '';
                        setSelectedUserActivityModal({
                          userEmail: req.userEmail,
                          userName,
                          tanggal: targetDate
                        });
                      }}
                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200/80 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    >
                      <Activity className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Aktivitas</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-slate-500 font-medium">
            Menampilkan <strong className="text-slate-800">{filteredRequests.length}</strong> dari {bbmRequests.length} total rekaman BBM.
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
          >
            Tutup
          </button>
        </div>

      </div>

      {/* Expanded Image Viewer Modal */}
      {selectedPhotoUrl && (
        <div 
          className="fixed inset-0 z-[100] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSelectedPhotoUrl(null)}
        >
          <div 
            className="relative bg-slate-900 rounded-2xl max-w-2xl max-h-[85vh] overflow-hidden p-2 shadow-2xl border border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-2 pb-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 px-2">Pratinjau Foto Kegiatan</span>
              <button
                type="button"
                onClick={() => setSelectedPhotoUrl(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-white hover:bg-slate-700 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 flex items-center justify-center">
              <img
                src={selectedPhotoUrl}
                alt="Foto Bukti Kegiatan"
                className="max-h-[75vh] w-auto object-contain rounded-xl mx-auto shadow-md"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      )}

      {/* User Activity List Popup Modal */}
      {selectedUserActivityModal && (
        <div 
          className="fixed inset-0 z-70 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fade-in"
          onClick={() => setSelectedUserActivityModal(null)}
        >
          <div 
            className="bg-white w-full max-w-xl rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[85vh] animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0 font-bold">
                  <Activity className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-sm text-white">
                    Daftar Aktivitas User
                  </h3>
                  <p className="text-xs text-indigo-200/90 mt-0.5">
                    {selectedUserActivityModal.userName} • <span className="font-mono text-[11px] opacity-80">{selectedUserActivityModal.userEmail}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserActivityModal(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Date Info Bar */}
            <div className="bg-indigo-50/80 border-b border-indigo-100/60 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                <Calendar className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Tanggal Transaksi: {formatDateDisplay(selectedUserActivityModal.tanggal)}</span>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-0.5 bg-indigo-200/60 text-indigo-800 rounded-full font-mono">
                {userActivitiesForDate.length} Kegiatan
              </span>
            </div>

            {/* Activity List */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 flex-1 bg-slate-50/50">
              {userActivitiesForDate.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-2 my-2">
                  <Activity className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-700">Tidak Ada Data Aktivitas</p>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                    Belum ada pencatatan aktivitas/kegiatan untuk <strong>{selectedUserActivityModal.userName}</strong> pada tanggal {formatDateDisplay(selectedUserActivityModal.tanggal)}.
                  </p>
                </div>
              ) : (
                userActivitiesForDate.map((act) => {
                  const displayPhoto = act.buktiFileId?.trim()
                    ? `https://drive.google.com/thumbnail?sz=w1000&id=${act.buktiFileId.trim()}`
                    : act.buktiUrl;

                  const gmapsUrl = act.coordinatesDb && act.coordinatesActual
                    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(act.coordinatesDb.trim())}&destination=${encodeURIComponent(act.coordinatesActual.trim())}`
                    : act.coordinatesActual
                      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.coordinatesActual.trim())}`
                      : act.coordinatesDb
                        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.coordinatesDb.trim())}`
                        : '';

                  return (
                    <div key={act.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-indigo-100">
                          SITE: {act.siteId}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 font-semibold">
                          {act.createdAt || ''}
                        </span>
                      </div>

                      <h4 className="text-xs font-bold text-slate-900">{act.siteName}</h4>
                      <p className="text-xs text-slate-600 font-normal leading-relaxed whitespace-pre-wrap">
                        {act.keterangan}
                      </p>

                      {/* Coordinates Detail Block */}
                      {(act.coordinatesActual || act.coordinatesDb) && (
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 space-y-1 text-[11px] font-mono">
                          {act.coordinatesActual && (
                            <div className="flex items-center justify-between text-slate-700">
                              <span className="font-sans font-semibold text-slate-500">Titik GPS Aktual:</span>
                              <a
                                href={gmapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-bold text-indigo-600 hover:underline flex items-center gap-1"
                              >
                                <span>{act.coordinatesActual}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}
                          {act.coordinatesDb && (
                            <div className="flex items-center justify-between text-slate-700">
                              <span className="font-sans font-semibold text-slate-500">Titik DB ({act.siteId}):</span>
                              <a
                                href={gmapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-bold text-indigo-600 hover:underline flex items-center gap-1"
                              >
                                <span>{act.coordinatesDb}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Photo & GPS Action Buttons */}
                      {(act.buktiUrl || gmapsUrl) && (
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                          {act.buktiUrl ? (
                            <button
                              type="button"
                              onClick={() => setSelectedPhotoUrl(displayPhoto)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 rounded-xl text-xs font-bold transition-all cursor-pointer border border-indigo-200/60 shadow-2xs"
                            >
                              <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Foto Bukti Kegiatan</span>
                            </button>
                          ) : <div />}

                          {gmapsUrl && (
                            <a
                              href={gmapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold transition-all cursor-pointer border border-emerald-200/60 shadow-2xs"
                            >
                              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                              <span>GPS Terdeteksi (Lihat Peta)</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-white border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedUserActivityModal(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
