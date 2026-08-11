/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { UserProfile, BudgetRequest, UsageReportItem, RequestStatus, ItemStatus } from '../types';
import { ArrowLeft, User, Search, CreditCard, Camera, Upload, CheckCircle2, AlertCircle, Loader2, Paperclip, ShieldCheck, Eye, Calendar } from 'lucide-react';
import { parseNumericValue, formatDivisiSubDivisi } from '../lib/googleApi';

interface TransferListPanelProps {
  profiles: UserProfile[];
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  googleToken: string;
  driveFolderId: string;
  onClose: () => void;
  onPreviewDocument?: (doc: { url: string; fileId?: string; title: string }) => void;
  onUpdateTransfer?: (requestId: string, adminComment: string, file: File | null) => Promise<void>;
  onAuthError?: () => void;
}

export const TransferListPanel: React.FC<TransferListPanelProps> = ({
  profiles,
  requests,
  usageItems,
  googleToken,
  driveFolderId,
  onClose,
  onPreviewDocument,
  onUpdateTransfer,
  onAuthError
}) => {
  const getTodayDateStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateStr());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<BudgetRequest | null>(null);
  const [adminComment, setAdminComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const parseDateToYYYYMMDD = (dateInput: string | Date | undefined): string => {
    if (!dateInput) return '';
    const str = String(dateInput).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.substring(0, 10);
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
      const parts = str.split('/');
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      const y = parts[2].substring(0, 4);
      return `${y}-${m}-${d}`;
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return '';
  };

  // File Upload / Camera State for editing proof
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showCameraStream, setShowCameraStream] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Format Currency
  const formatIDR = (num: any) => {
    const val = parseNumericValue(num);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
  };

  const isBbmRequest = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
  const isBbmUsageItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

  // Filter transferred requests (only UID requests with adminActionAmount > 0)
  const transferredRequests = useMemo(() => {
    return requests.filter(r => {
      if (isBbmRequest(r) || r.status === RequestStatus.CANCELLED) return false;
      return (r.adminActionAmount || 0) > 0;
    }).sort((a, b) => {
      const timeA = new Date(a.createdAt || a.timestamp || 0).getTime();
      const timeB = new Date(b.createdAt || b.timestamp || 0).getTime();
      return timeB - timeA;
    });
  }, [requests]);

  // Filter by date & search query
  const filteredRequests = useMemo(() => {
    let result = transferredRequests;

    if (selectedDate) {
      result = result.filter(r => {
        const datePemakaian = parseDateToYYYYMMDD(r.tanggalPemakaian);
        const dateCreatedAt = parseDateToYYYYMMDD(r.createdAt);
        const dateTimestamp = parseDateToYYYYMMDD(r.timestamp);
        return datePemakaian === selectedDate || dateCreatedAt === selectedDate || dateTimestamp === selectedDate;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(r => {
        const p = profiles.find(prof => prof.email.toLowerCase() === r.userEmail.toLowerCase());
        const matchId = r.id.toLowerCase().includes(q);
        const matchUser = r.userEmail.toLowerCase().includes(q);
        const matchName = p?.nama ? p.nama.toLowerCase().includes(q) : false;
        const matchSite = r.siteId ? r.siteId.toLowerCase().includes(q) : false;
        const matchKeterangan = r.keterangan ? r.keterangan.toLowerCase().includes(q) : false;
        const matchDivisi = p?.divisi ? p.divisi.toLowerCase().includes(q) : false;
        return matchId || matchUser || matchName || matchSite || matchKeterangan || matchDivisi;
      });
    }

    return result;
  }, [transferredRequests, selectedDate, searchQuery, profiles]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const startCameraStream = async () => {
    setError(null);
    try {
      setShowCameraStream(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error('Failed to get camera stream:', err);
      setError('Gagal mengakses kamera in-app. Silakan gunakan opsi file upload.');
      setShowCameraStream(false);
    }
  };

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCameraStream(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (blob) {
              const file = new File([blob], `bukti_transfer_kamera_${Date.now()}.png`, { type: 'image/png' });
              setSelectedFile(file);
            }
          }, 'image/png');
        }
        stopCameraStream();
      } catch (err: any) {
        setError('Gagal mengambil foto dari kamera.');
      }
    }
  };

  const handleSubmitUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;
    setError(null);

    if (!onUpdateTransfer) {
      setSelectedRequest(null);
      return;
    }

    setIsSubmitting(true);
    try {
      await onUpdateTransfer(selectedRequest.id, adminComment, selectedFile);
      setSelectedRequest(null);
      setSelectedFile(null);
    } catch (err: any) {
      const isAuthError = err.message && (
        err.message.includes('401') ||
        err.message.toLowerCase().includes('authentication credentials') ||
        err.message.toLowerCase().includes('invalid_grant') ||
        err.message.toLowerCase().includes('unauthorized') ||
        err.message.toLowerCase().includes('token')
      );
      if (isAuthError && onAuthError) {
        onAuthError();
      } else {
        setError(err.message || 'Gagal memperbarui data transfer.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadgeClass = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.CLOSED:
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case RequestStatus.REVIEW_ADMIN:
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case RequestStatus.REVIEW_MANAGER:
        return 'bg-cyan-50 text-cyan-700 border-cyan-200';
      case RequestStatus.REPORTING:
        return 'bg-purple-50 text-purple-700 border-purple-200';
      default:
        return 'bg-blue-50 text-blue-700 border-blue-200';
    }
  };

  const getStatusText = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.CLOSED:
        return 'SELESAI (CLOSED)';
      case RequestStatus.REVIEW_ADMIN:
        return 'REVIEW FINANCE';
      case RequestStatus.REVIEW_MANAGER:
        return 'REVIEW MANAGER';
      case RequestStatus.REPORTING:
        return 'PROSES LAPORAN';
      default:
        return 'DITRANSFER';
    }
  };

  // If a request is selected, render the Detail / Form view
  if (selectedRequest) {
    const requesterProfile = profiles.find(p => p.email.toLowerCase() === selectedRequest.userEmail.toLowerCase());
    const reqUsage = usageItems.filter(i => i.requestId === selectedRequest.id && !isBbmUsageItem(i));
    const approvedUsage = reqUsage
      .filter(i => i.statusManager === ItemStatus.APPROVED && i.statusAdmin === ItemStatus.APPROVED)
      .reduce((sum, i) => sum + i.nominal, 0);
    const sisaSaldo = (selectedRequest.adminActionAmount || 0) - approvedUsage;

    return (
      <div className="space-y-4">
        {/* Back Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSelectedRequest(null);
              setAdminComment('');
              setSelectedFile(null);
              setError(null);
            }}
            className="p-2 hover:bg-slate-100 text-slate-600 rounded-xl transition-all cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-sm font-black text-slate-800 font-display">Form List Transfer UID</h2>
            <p className="text-[10px] text-slate-400 font-medium">Detail rincian transfer dana &amp; rekonsiliasi laporan UID</p>
          </div>
        </div>

        {/* Request Card Info Header */}
        <div className="bg-slate-900 text-white rounded-2xl p-4 border border-slate-800 space-y-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-slate-300 border border-slate-700">
              {requesterProfile?.nama?.charAt(0).toUpperCase() || selectedRequest.userEmail.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-bold text-xs">{requesterProfile?.nama || requesterProfile?.userId || selectedRequest.userEmail}</h3>
              <p className="text-[10px] text-slate-400 font-mono">{selectedRequest.userEmail}</p>
              <p className="text-[9px] text-slate-300 font-medium mt-0.5">
                UID: <strong className="text-indigo-400 font-mono">{selectedRequest.id}</strong> | Site: <strong className="text-slate-200">{selectedRequest.siteId}</strong> | Divisi: {formatDivisiSubDivisi(requesterProfile?.divisi, requesterProfile?.subDivisi)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-800 text-left">
            <div>
              <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Jumlah Pengajuan</span>
              <span className="text-[11px] font-bold font-mono font-display text-slate-300">
                {formatIDR(selectedRequest.jumlahPengajuan)}
              </span>
            </div>
            <div>
              <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Nominal Ditransfer</span>
              <span className="text-[11px] font-bold font-mono font-display text-emerald-400">
                {formatIDR(selectedRequest.adminActionAmount)}
              </span>
            </div>
            <div>
              <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wider">Laporan Disetujui</span>
              <span className="text-[11px] font-bold font-mono font-display text-blue-400">
                {formatIDR(approvedUsage)}
              </span>
            </div>
          </div>
          <div className="text-[9px] text-slate-400 leading-relaxed bg-slate-950 p-2 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <span className="truncate max-w-[280px]">Keterangan Pengajuan: <strong>{selectedRequest.keterangan}</strong></span>
            <span className={`font-mono font-bold shrink-0 ${sisaSaldo === 0 ? 'text-emerald-400' : sisaSaldo > 0 ? 'text-blue-400' : 'text-rose-400'}`}>
              Sisa: {formatIDR(sisaSaldo)}
            </span>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmitUpdate} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-[11px] flex items-start gap-2 text-left">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Bukti Transfer Viewer */}
          <div className="space-y-1.5 text-left">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Bukti Transfer Finance
            </label>
            {selectedRequest.buktiTransferUrl ? (
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-xl p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 truncate">
                  <Paperclip className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="text-xs font-bold text-indigo-900 truncate">Bukti Transfer Terlampir</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (onPreviewDocument && selectedRequest.buktiTransferUrl) {
                      onPreviewDocument({
                        url: selectedRequest.buktiTransferUrl,
                        fileId: selectedRequest.buktiTransferFileId,
                        title: `Bukti Transfer UID ${selectedRequest.id}`
                      });
                    } else if (selectedRequest.buktiTransferUrl) {
                      window.open(selectedRequest.buktiTransferUrl, '_blank');
                    }
                  }}
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Lihat Bukti</span>
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                Belum ada lampiran bukti transfer tersimpan.
              </p>
            )}
          </div>

          {/* Catatan Finance */}
          <div className="space-y-1.5 text-left">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Catatan Finance
            </label>
            <textarea
              value={adminComment}
              onChange={(e) => setAdminComment(e.target.value)}
              placeholder="Catatan dari Finance (Nomor Ref, Bank, dll)..."
              className="w-full text-xs p-3 border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none min-h-[70px] resize-none"
            />
          </div>

          {/* Upload / Perbarui Bukti Transfer File */}
          <div className="space-y-2 text-left">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Upload / Perbarui Bukti Transfer (Opsional)
            </label>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*,application/pdf"
              className="hidden"
            />
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleFileChange}
              accept="image/*"
              capture="environment"
              className="hidden"
            />

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-[11px] rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Upload className="w-4 h-4 text-slate-500" />
                <span>Upload File / Foto</span>
              </button>

              <button
                type="button"
                onClick={startCameraStream}
                className="py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-[11px] rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Camera className="w-4 h-4 text-slate-500" />
                <span>Ambil Foto Kamera</span>
              </button>
            </div>

            {/* Camera stream view */}
            {showCameraStream && (
              <div className="relative border border-slate-300 rounded-xl overflow-hidden bg-slate-900 flex flex-col items-center">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full max-h-[220px] object-cover"
                />
                <div className="p-2 w-full bg-slate-950 flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={stopCameraStream}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white font-bold text-[10px] rounded-lg cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] rounded-lg cursor-pointer flex items-center gap-1"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Ambil Foto</span>
                  </button>
                </div>
              </div>
            )}

            {/* Selected File Badge */}
            {selectedFile && (
              <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl p-2.5 text-[10px] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 truncate">
                  <Paperclip className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-bold truncate">{selectedFile.name}</span>
                  <span className="text-[9px] text-emerald-600 bg-emerald-100/50 px-1.5 py-0.5 rounded-md font-mono">
                    {(selectedFile.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="text-emerald-800 hover:text-red-500 font-bold px-1 text-xs cursor-pointer"
                >
                  Hapus
                </button>
              </div>
            )}
          </div>

          {/* Usage Items Breakdown */}
          <div className="space-y-2 pt-2 border-t border-slate-100 text-left">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Laporan Penggunaan Nota ({reqUsage.length} Item)
            </label>
            {reqUsage.length > 0 ? (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {reqUsage.map((u) => (
                  <div key={u.id} className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <span className="font-bold text-slate-800 block">{u.keterangan}</span>
                      <span className="text-[10px] text-slate-400 font-mono">{u.tanggalPenggunaan}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-slate-800 font-mono block">{formatIDR(u.nominal)}</span>
                      <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border ${u.statusAdmin === ItemStatus.APPROVED ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : u.statusAdmin === ItemStatus.REJECTED ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                        {u.statusAdmin}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                Belum ada nota laporan penggunaan diunggah oleh user untuk UID ini.
              </p>
            )}
          </div>

          {/* Form Actions */}
          <div className="pt-2 flex justify-end gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setSelectedRequest(null);
                setAdminComment('');
                setSelectedFile(null);
                setError(null);
              }}
              disabled={isSubmitting}
              className="px-4 py-2.5 text-slate-500 hover:bg-slate-50 font-bold text-xs rounded-xl border border-transparent hover:border-slate-200 transition-all cursor-pointer disabled:opacity-50"
            >
              Kembali
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Memproses...</span>
                </>
              ) : (
                <span>Simpan Perubahan Transfer</span>
              )}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // List View when no request is selected
  return (
    <div className="space-y-4">
      {/* Back to Dashboard Header */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-sm gap-2">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-all cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Dashboard</span>
        </button>
        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>List Transfer Mode</span>
        </span>
      </div>

      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-display font-black text-slate-800 text-xs tracking-wide uppercase">Daftar Transfer UID Operasional</h3>
          <span className="text-[10px] font-bold text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
            Total: {filteredRequests.length} UID
          </span>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
          Daftar seluruh pengajuan UID yang telah ditransfer oleh Finance. Klik pada kartu UID untuk melihat rincian transfer, bukti transfer, dan laporan penggunaan.
        </p>

        {/* Date Filter & Search Input */}
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            {/* Datepicker */}
            <div className="sm:col-span-6 relative">
              <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full pl-10 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-medium text-slate-700"
              />
            </div>

            {/* Quick Action Buttons */}
            <div className="sm:col-span-6 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedDate(getTodayDateStr())}
                className={`flex-1 py-2 text-[10px] font-bold rounded-xl border transition-all cursor-pointer ${
                  selectedDate === getTodayDateStr()
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Hari Ini
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate('')}
                className={`flex-1 py-2 text-[10px] font-bold rounded-xl border transition-all cursor-pointer ${
                  selectedDate === ''
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Semua Tanggal
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Cari UID, nama pemohon, email, site, atau keterangan..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Transferred Requests Grid */}
      {filteredRequests.length > 0 ? (
        <div className="grid grid-cols-1 gap-3.5">
          {filteredRequests.map((req) => {
            const requesterProfile = profiles.find(p => p.email.toLowerCase() === req.userEmail.toLowerCase());
            const reqUsage = usageItems.filter(i => i.requestId === req.id && !isBbmUsageItem(i));
            const approvedUsage = reqUsage
              .filter(i => i.statusManager === ItemStatus.APPROVED && i.statusAdmin === ItemStatus.APPROVED)
              .reduce((sum, i) => sum + i.nominal, 0);

            return (
              <div
                key={req.id}
                className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm relative overflow-hidden flex flex-col justify-between space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-slate-800">
                          {requesterProfile?.nama || req.userEmail}
                        </span>
                        <span className="text-[9px] font-bold font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                          {req.id}
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5">{req.userEmail}</p>
                      <p className="text-[9px] text-slate-500 font-medium mt-1">
                        Site: <strong className="text-slate-700">{req.siteId || '-'}</strong> | Divisi: <strong className="text-slate-700">{formatDivisiSubDivisi(requesterProfile?.divisi, requesterProfile?.subDivisi)}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[8px] font-bold text-slate-400 block uppercase tracking-wider">Nominal Ditransfer</span>
                    <span className="text-sm font-bold font-mono font-display text-emerald-600 block mt-0.5">
                      {formatIDR(req.adminActionAmount)}
                    </span>
                    <span className={`inline-block text-[8px] font-bold mt-1 px-1.5 py-0.5 rounded-md border ${getStatusBadgeClass(req.status)}`}>
                      {getStatusText(req.status)}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap text-[10px] text-slate-500 font-medium">
                  <div className="truncate max-w-[260px] sm:max-w-[360px]">
                    <span className="truncate block">Keterangan: <strong className="text-slate-700">{req.keterangan}</strong></span>
                    <span className="text-slate-400 text-[9px] font-mono mt-0.5 block">
                      Disetujui Manager: <strong className="text-blue-600">{formatIDR(req.managerActionAmount)}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {req.buktiTransferUrl ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (onPreviewDocument) {
                            onPreviewDocument({
                              url: req.buktiTransferUrl,
                              fileId: req.buktiTransferFileId,
                              title: `Bukti Transfer UID ${req.id}`
                            });
                          } else {
                            window.open(req.buktiTransferUrl, '_blank');
                          }
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm rounded-xl text-[10px] font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Lihat Bukti Transfer</span>
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-medium italic bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl">
                        Belum ada bukti transfer
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center space-y-2">
          <CreditCard className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-xs font-bold text-slate-700 uppercase">Tidak Ada Data Transfer</h3>
          <p className="text-[10px] text-slate-500 max-w-sm mx-auto">
            {searchQuery ? 'Tidak ditemukan pengajuan transfer yang sesuai dengan kata kunci pencarian.' : 'Belum ada pengajuan UID yang ditransfer oleh Finance.'}
          </p>
        </div>
      )}
    </div>
  );
};
