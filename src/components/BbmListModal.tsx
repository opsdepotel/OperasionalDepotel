/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BudgetRequest, UsageReportItem, UserProfile } from '../types';
import { Fuel, Calendar, Search, MapPin, FileText, X, Image as ImageIcon, CheckCircle2, ChevronRight, Filter, ExternalLink, RefreshCw } from 'lucide-react';

interface BbmListModalProps {
  isOpen: boolean;
  onClose: () => void;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  profiles?: UserProfile[];
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
                        <span>Tanggal Pengisian: {formatDateDisplay(req.tanggalPemakaian)}</span>
                        {req.createdAt && (
                          <span className="text-slate-400 font-normal">
                            • {req.createdAt}
                          </span>
                        )}
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

                  {/* Nota Photo Preview Section */}
                  {rawBuktiPhoto && (
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-slate-800 flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-amber-600" />
                          <span>Foto Nota BBM</span>
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Tersimpan di Google Drive / Cloud
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedPhotoUrl(displayImgUrl || rawBuktiPhoto)}
                          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                        >
                          <ImageIcon className="w-3.5 h-3.5 text-amber-600" />
                          <span>Lihat Nota</span>
                        </button>

                        {onPreviewDocument && (
                          <button
                            onClick={() => onPreviewDocument(displayImgUrl || rawBuktiPhoto)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                            title="Buka Dokumen"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
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
          className="fixed inset-0 z-60 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSelectedPhotoUrl(null)}
        >
          <div 
            className="relative bg-slate-900 rounded-2xl max-w-2xl max-h-[85vh] overflow-hidden p-2 shadow-2xl border border-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedPhotoUrl(null)}
              className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-slate-800/80 text-white hover:bg-slate-700 flex items-center justify-center transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={selectedPhotoUrl}
              alt="Foto Nota BBM Terbesar"
              className="max-h-[80vh] w-auto object-contain rounded-xl mx-auto"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}
    </div>
  );
};
