/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { BudgetRequest, RequestStatus, ItemReviewHistory, ItemStatus, UserProfile, Role } from '../types';
import { parseNumericValue } from '../lib/googleApi';
import { ItemHistoryModal } from './ItemHistoryModal';
import { 
  CreditCard, 
  AlertCircle, 
  Coins, 
  Camera, 
  UploadCloud, 
  CheckCircle2,
  AlertTriangle,
  History,
  RotateCcw,
  Calendar,
  Sparkles
} from 'lucide-react';
import { uploadReceiptFile } from '../lib/googleApi';

interface TransferModalProps {
  request: BudgetRequest;
  requesterName?: string;
  profiles?: UserProfile[];
  onTransfer: (transferredAmount: number, buktiUrl: string, buktiFileId: string, adminComment?: string, customAdminActionTime?: string) => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  histories?: ItemReviewHistory[];
  onClose: () => void;
  googleToken: string;
  driveFolderId: string | null;
  onAuthError?: () => void;
  approvedUsageAmount?: number;
  initialFile?: File | null;
  initialOcrDate?: string;
  initialOcrAmount?: number;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  request,
  requesterName,
  profiles = [],
  onTransfer,
  onReject,
  histories = [],
  onClose,
  googleToken,
  driveFolderId,
  onAuthError,
  approvedUsageAmount = 0,
  initialFile = null,
  initialOcrDate = '',
  initialOcrAmount = 0
}) => {
  const requesterProfile = profiles.find(p => p.email.toLowerCase() === request.userEmail.toLowerCase());
  const isRequesterManagerOrFinance = requesterProfile?.role === Role.MANAGER || requesterProfile?.role === Role.FINANCE;

  const isTalangan = request.id.startsWith('OPT-') || request.id.startsWith('BBMDS') || request.id.startsWith('BBM_DurenSawit') || request.tipePengajuan === 'DANA_TALANGAN' || request.keterangan.startsWith('[DANA TALANGAN]');
  const isFinalTalanganTransfer = isTalangan && request.status === RequestStatus.PENDING_TALANGAN_TRANSFER;

  // Active Mode: 'TRANSFER' or 'REVISE'
  const [activeMode, setActiveMode] = useState<'TRANSFER' | 'REVISE'>('TRANSFER');
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const initialAmountValue = initialOcrAmount > 0
    ? String(initialOcrAmount)
    : (isFinalTalanganTransfer ? String(approvedUsageAmount) : String(request.managerActionAmount));

  const [transferredAmount, setTransferredAmount] = useState(initialAmountValue);
  const [ocrDate, setOcrDate] = useState<string>(initialOcrDate || '');
  const [adminComment, setAdminComment] = useState(request.adminComment || '');
  const [revisionReason, setRevisionReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(initialFile || null);
  const [showCameraStream, setShowCameraStream] = useState(false);

  // Refs for upload/capture
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

  const formatIDR = (num: any) => {
    const val = parseNumericValue(num);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setShowCameraStream(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (activeMode === 'REVISE') {
      if (!revisionReason.trim()) {
        setError('Catatan revisi wajib diisi agar pemohon dapat memperbaiki pengajuannya.');
        return;
      }
      if (!onReject) {
        setError('Fungsi revisi tidak tersedia.');
        return;
      }
      setIsSubmitting(true);
      try {
        await onReject(revisionReason.trim());
      } catch (err: any) {
        setError(err.message || 'Gagal mengirimkan revisi pengajuan.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Mode TRANSFER
    const amt = isFinalTalanganTransfer ? approvedUsageAmount : (isTalangan ? 0 : parseNumericValue(transferredAmount));
    if (!isTalangan || isFinalTalanganTransfer) {
      if (amt <= 0) {
        setError('Nominal transfer harus lebih besar dari Rp 0.');
        return;
      }
      if (!isTalangan && amt > request.managerActionAmount) {
        setError(`Nominal transfer tidak boleh melebihi jumlah yang disetujui manager (${formatIDR(request.managerActionAmount)}).`);
        return;
      }
      if (!selectedFile) {
        setError('Bukti Transfer wajib dilampirkan.');
        return;
      }
    }

    setIsSubmitting(true);
    let finalBuktiUrl = '';
    let finalBuktiFileId = '';

    try {
      const shouldUpload = (!isTalangan || isFinalTalanganTransfer) && selectedFile;
      if (shouldUpload) {
        if (!driveFolderId) {
          throw new Error('ID Folder Google Drive belum terinisialisasi.');
        }
        const uploadResult = await uploadReceiptFile(googleToken, driveFolderId, selectedFile);
        finalBuktiUrl = uploadResult.viewUrl;
        finalBuktiFileId = uploadResult.fileId;
      }

      await onTransfer(amt, finalBuktiUrl, finalBuktiFileId, adminComment.trim(), ocrDate || undefined);
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
        setError(err.message || 'Gagal memproses transfer dana.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[92vh] sm:max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto">
        {/* Title / Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 pb-3 border-b border-slate-100 shrink-0 bg-white">
          <div>
            <h2 className="font-display font-bold text-slate-800 text-sm sm:text-base">
              {isFinalTalanganTransfer ? 'Proses Transfer Dana Talangan (Reimbursement)' : 'Proses Transfer Anggaran'}
            </h2>
            <p className="text-[10px] sm:text-[11px] text-slate-400 font-semibold">Role: Finance</p>
          </div>
          <button
            onClick={onClose}
            className="text-xs font-bold text-slate-400 hover:text-slate-600 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">

      {/* Info card */}
      <div className="bg-slate-50 rounded-xl p-3.5 space-y-2 text-xs text-slate-600">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">UID Proses</span>
            <span className="font-mono font-bold text-slate-800">{request.id}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">Lokasi Site</span>
            <span className="font-bold text-slate-800">{request.siteId}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">Pemohon</span>
            <span className="font-semibold text-slate-800">{requesterName || request.userEmail}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">
              {isFinalTalanganTransfer ? 'Total Reimbursement' : (isRequesterManagerOrFinance ? 'Disetujui Direktur' : 'Disetujui Manager')}
            </span>
            <span className="font-bold text-emerald-600">
              {formatIDR(isFinalTalanganTransfer ? approvedUsageAmount : request.managerActionAmount)}
            </span>
          </div>
        </div>
        {request.managerComment && (
          <div className="pt-2 border-t border-slate-200">
            <span className="text-[10px] text-slate-400 block font-semibold">
              {isRequesterManagerOrFinance ? 'Catatan Direktur' : 'Catatan Manager'}
            </span>
            <p className="text-slate-700 italic">"{request.managerComment}"</p>
          </div>
        )}
      </div>

      {/* Previous Review History Clickable Label */}
      {(() => {
        const reqHistories = histories
          .filter(h => h.requestUid === request.id || h.itemUid === request.id)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        if (reqHistories.length === 0) return null;

        return (
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 text-xs">
            <span className="font-bold text-slate-700 flex items-center gap-1.5 text-[11px]">
              <History className="w-3.5 h-3.5 text-indigo-500" />
              <span>Riwayat Approval & Revisi</span>
            </span>
            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="px-2.5 py-1 bg-white hover:bg-indigo-50 text-indigo-700 font-bold rounded-lg text-[10px] transition-all flex items-center gap-1 cursor-pointer border border-indigo-200 shadow-2xs"
            >
              <History className="w-3 h-3 text-indigo-600" />
              <span>Riwayat</span>
            </button>
          </div>
        );
      })()}

      {/* Option Selector: Transfer vs Revisi */}
      {onReject && !isFinalTalanganTransfer && (
        <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => { setActiveMode('TRANSFER'); setError(null); }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMode === 'TRANSFER'
                ? 'bg-white text-indigo-700 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Konfirmasi Transfer</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveMode('REVISE'); setError(null); }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMode === 'REVISE'
                ? 'bg-white text-amber-700 shadow-xs border border-amber-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Revisi Pengajuan</span>
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Mode: REVISE */}
        {activeMode === 'REVISE' && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3.5 text-xs space-y-1">
              <p className="font-semibold flex items-center gap-1.5 text-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Minta Revisi Pengajuan Anggaran</span>
              </p>
              <p className="text-[10px] text-amber-700 leading-relaxed">
                Pengajuan anggaran akan dikembalikan ke status <strong>REVISI</strong> agar dapat diperbaiki dan dikirim ulang oleh pemohon (User).
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">
                Catatan / Alasan Revisi dari Finance <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={revisionReason}
                onChange={(e) => setRevisionReason(e.target.value)}
                placeholder="Tuliskan catatan revisi dengan jelas (misal: mohon perbaiki nominal / lampiran / rincian keterangan)..."
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all outline-none resize-none"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-amber-100 disabled:bg-slate-300 transition-all cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{isSubmitting ? 'Memproses Revisi...' : 'Kirim Revisi ke Pemohon'}</span>
            </button>
          </div>
        )}

        {/* Mode: TRANSFER */}
        {activeMode === 'TRANSFER' && (
          <>
            {(initialFile || initialOcrAmount > 0 || initialOcrDate) && (
              <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-xl p-3 text-xs flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold text-indigo-950">Data Terisi Otomatis dari Share Nota (Brimo)</p>
                  <p className="text-[11px] text-indigo-800 leading-relaxed">
                    Nominal (<strong>{formatIDR(transferredAmount)}</strong>) dan bukti transfer telah terisi otomatis hasil pembacaan OCR AI.
                  </p>
                </div>
              </div>
            )}

            {(!isTalangan || isFinalTalanganTransfer) ? (
              <div className="space-y-3">
                {isFinalTalanganTransfer ? (
                  <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl p-3.5 text-xs space-y-1">
                    <p className="font-semibold flex items-center gap-1.5 text-emerald-700">
                      <Coins className="w-4 h-4 text-emerald-600" />
                      <span>Reimbursement Dana Talangan Pribadi</span>
                    </p>
                    <p className="text-[10px] text-slate-600 leading-relaxed font-medium">
                      Total dana talangan yang disetujui untuk di-reimburse adalah <strong>{formatIDR(approvedUsageAmount)}</strong>. Silakan transfer nominal tersebut ke pemohon, lalu unggah bukti transfer di bawah ini untuk menutup (closing) UID ini secara permanen.
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Nominal Dana Ditransfer (Rupiah)</label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={transferredAmount}
                        onChange={(e) => setTransferredAmount(e.target.value.replace(/\D/g, ''))}
                        placeholder="Nominal transfer"
                        className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                        required
                      />
                      <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    </div>
                    {transferredAmount && parseNumericValue(transferredAmount) > 0 && (
                      <p className="text-[10px] text-indigo-600 font-semibold mt-1">
                        Format: {formatIDR(transferredAmount)}
                      </p>
                    )}
                  </div>
                )}

                {/* Bukti Transfer Upload */}
                <div className="space-y-2 pt-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    {isFinalTalanganTransfer ? 'Bukti / Nota Transfer Pengembalian Dana (Wajib)' : 'Bukti / Nota Transfer Bank (Wajib)'}
                  </label>
                  
                  {/* File Status Indicator */}
                  {selectedFile && (
                    <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 p-3 rounded-xl text-xs flex items-center justify-between">
                      <div className="flex items-center gap-2 truncate">
                        <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
                        <div className="truncate">
                          <p className="font-bold truncate">{selectedFile.name}</p>
                          <p className="text-[9px] text-emerald-500 font-mono">{(selectedFile.size / 1024).toFixed(0)} KB</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedFile(null)}
                        className="text-[10px] font-bold text-red-500 hover:text-red-700 hover:underline px-2 py-1 bg-red-50 rounded-lg shrink-0 cursor-pointer"
                      >
                        Hapus
                      </button>
                    </div>
                  )}

                  {/* Hidden Input Selectors */}
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
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedFile(e.target.files[0]);
                      }
                    }}
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                  />

                  {/* Capture/Upload Options Panel */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Native device camera */}
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="p-3 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-xl text-center flex flex-col items-center justify-center gap-1.5 transition-all text-[10px] font-bold text-slate-600 cursor-pointer"
                    >
                      <Camera className="w-5 h-5 text-indigo-500" />
                      <span>Kamera HP</span>
                    </button>

                    {/* Choose file / gallery */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-3 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-xl text-center flex flex-col items-center justify-center gap-1.5 transition-all text-[10px] font-bold text-slate-600 cursor-pointer"
                    >
                      <UploadCloud className="w-5 h-5 text-indigo-500" />
                      <span>File / Galeri</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-indigo-50 border border-indigo-100 text-indigo-800 rounded-xl p-3.5 text-xs space-y-1">
                <p className="font-semibold flex items-center gap-1.5 text-indigo-700">
                  <Coins className="w-4 h-4 text-indigo-600" />
                  <span>Konfirmasi Dana Talangan Pribadi</span>
                </p>
                <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                  Sistem mencatat transfer sebesar <strong>Rp 0</strong> untuk UID ini karena merupakan Dana Talangan Pribadi. Mengonfirmasi akan mengubah status menjadi <strong>TRANSFERRED</strong> agar pemohon dapat mulai mengunggah nota/bukti pemakaian dana secara bertahap.
                </p>
              </div>
            )}

            {/* Catatan Finance (Opsional) */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-500">
                Catatan Finance <span className="text-slate-400 font-normal">(Opsional)</span>
              </label>
              <textarea
                rows={2}
                value={adminComment}
                onChange={(e) => setAdminComment(e.target.value)}
                placeholder="Tambahkan catatan dari Finance (misal: No. Ref Transfer, Nama Bank, dll)..."
                className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none resize-none"
              />
            </div>

            {/* Transfer Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
            >
              <CreditCard className="w-4 h-4" />
              <span>
                {isSubmitting 
                  ? 'Memproses & Mengunggah...' 
                  : (isFinalTalanganTransfer 
                      ? 'Kirim Bukti & Selesaikan Reimbursement' 
                      : (isTalangan ? 'Konfirmasi & Aktifkan UID' : 'Kirim Bukti & Konfirmasi Transfer'))}
              </span>
            </button>
          </>
        )}
      </form>
        </div>
      </div>

      {/* History Approval Popup Modal */}
      {showHistoryModal && (
        <ItemHistoryModal
          item={{
            id: request.id,
            requestId: request.id,
            tanggalPenggunaan: request.tanggalPemakaian,
            nominal: request.jumlahPengajuan,
            keterangan: request.keterangan,
            buktiUrl: request.buktiTransferUrl || '',
            buktiFileId: request.buktiTransferFileId || '',
            statusManager: request.status === RequestStatus.APPROVED ? ItemStatus.APPROVED : request.status === RequestStatus.REJECTED ? ItemStatus.REJECTED : ItemStatus.PENDING,
            managerComment: request.managerComment || '',
            statusAdmin: request.adminActionAmount > 0 ? ItemStatus.APPROVED : ItemStatus.PENDING,
            adminComment: request.adminComment || '',
            updatedAt: request.createdAt
          }}
          histories={histories}
          onClose={() => setShowHistoryModal(false)}
        />
      )}
    </div>
  );
};

