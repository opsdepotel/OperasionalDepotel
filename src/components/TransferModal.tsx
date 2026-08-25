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
  Sparkles,
  Eye
} from 'lucide-react';
import { uploadReceiptFile } from '../lib/googleApi';

interface TransferModalProps {
  request: BudgetRequest;
  requesterName?: string;
  profiles?: UserProfile[];
  onTransfer: (transferredAmount: number, buktiUrl: string, buktiFileId: string, adminComment?: string, customAdminActionTime?: string) => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  histories?: ItemReviewHistory[];
  onPreviewDocument?: (doc: { url: string; fileId?: string; title?: string }) => void;
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
  onPreviewDocument,
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

  // Target total amount approved for this request
  const targetTotal = isTalangan
    ? (approvedUsageAmount > 0 ? approvedUsageAmount : request.managerActionAmount)
    : request.managerActionAmount;
  // Accumulated amount already transferred previously
  const previousTransferredAmount = request.adminActionAmount || 0;
  // Remaining amount left to be transferred
  const remainingAmount = Math.max(0, targetTotal - previousTransferredAmount);

  const initialAmountValue = initialOcrAmount > 0
    ? String(initialOcrAmount)
    : (isTalangan 
        ? (remainingAmount > 0 ? String(remainingAmount) : String(targetTotal))
        : String(request.managerActionAmount || 0));

  const [transferredAmount, setTransferredAmount] = useState(initialAmountValue);
  const [ocrDate, setOcrDate] = useState<string>(initialOcrDate || '');
  const [adminComment, setAdminComment] = useState('');
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

  const handleExecuteClosingOnly = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onTransfer(0, '', '', adminComment.trim() || 'Closing UID Talangan oleh Finance');
    } catch (err: any) {
      setError(err.message || 'Gagal melakukan closing UID Talangan.');
    } finally {
      setIsSubmitting(false);
    }
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
    const amt = parseNumericValue(transferredAmount);

    if (!isTalangan) {
      // Logic & Validation Khusus Pengajuan Biasa (OP) - Single Transfer
      if (request.status === RequestStatus.TRANSFERRED) {
        setError(`Finance tidak bisa melakukan transfer pada UID Pengajuan biasa (${request.id}) yang telah berstatus TRANSFERRED.`);
        return;
      }

      if (amt <= 0) {
        setError('Nominal transfer harus lebih besar dari Rp 0.');
        return;
      }

      if (request.managerActionAmount > 0 && amt > request.managerActionAmount) {
        setError(
          `Nominal transfer (${formatIDR(amt)}) tidak boleh melebihi nominal yang disetujui Manager (${formatIDR(request.managerActionAmount)}).`
        );
        return;
      }

      if (request.managerActionAmount > 0 && amt < request.managerActionAmount && !adminComment.trim()) {
        setError(
          `Karena nominal transfer (${formatIDR(amt)}) kurang dari nominal yang disetujui Manager (${formatIDR(request.managerActionAmount)}), Catatan Finance wajib diisi (misal: penjelasan alasan transfer sebagian/kurang).`
        );
        return;
      }

      if (!selectedFile) {
        setError('Bukti Transfer wajib dilampirkan.');
        return;
      }
    } else {
      // Logic & Validation Khusus Dana Talangan (OPT / BBMDS) - Multi Transfer & Reimbursement
      const projectedTotal = previousTransferredAmount + amt;

      if (isFinalTalanganTransfer) {
        if (remainingAmount > 0 && amt <= 0 && previousTransferredAmount < targetTotal) {
          setError('Nominal transfer harus lebih besar dari Rp 0.');
          return;
        }
      } else {
        if (amt <= 0 && previousTransferredAmount < targetTotal) {
          setError('Nominal transfer harus lebih besar dari Rp 0.');
          return;
        }
      }

      if (targetTotal > 0 && projectedTotal > targetTotal) {
        setError(
          `Gagal Transfer: Total akumulasi transfer (${formatIDR(previousTransferredAmount)} + ${formatIDR(amt)} = ${formatIDR(projectedTotal)}) MELEBIHI total nominal disetujui (${formatIDR(targetTotal)}). Sisa maksimal yang dapat ditransfer: ${formatIDR(remainingAmount)}.`
        );
        return;
      }

      if (!selectedFile && remainingAmount > 0 && amt > 0) {
        setError('Bukti Transfer wajib dilampirkan.');
        return;
      }
    }

    setIsSubmitting(true);
    let finalBuktiUrl = '';
    let finalBuktiFileId = '';

    try {
      const shouldUpload = selectedFile && (!isTalangan || isFinalTalanganTransfer || amt > 0);
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
      <div className="bg-slate-50 rounded-xl p-3.5 space-y-2.5 text-xs text-slate-600 border border-slate-100">
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
              {formatIDR(targetTotal)}
            </span>
          </div>
        </div>

        {/* Transfer Progress Breakdown (Only for Dana Talangan OPT) */}
        {isTalangan && (
          <div className="pt-2 border-t border-slate-200/80 grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-white p-2 rounded-lg border border-slate-200/80">
              <span className="text-[9px] font-bold text-slate-400 uppercase block">Sudah Ditransfer</span>
              <span className="font-bold text-indigo-600">{formatIDR(previousTransferredAmount)}</span>
            </div>
            <div className="bg-white p-2 rounded-lg border border-slate-200/80">
              <span className="text-[9px] font-bold text-slate-400 uppercase block">Sisa Belum Ditransfer</span>
              <span className={`font-bold ${remainingAmount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {formatIDR(remainingAmount)}
              </span>
            </div>
          </div>
        )}

        {request.managerComment && (
          <div className="pt-2 border-t border-slate-200">
            <span className="text-[10px] text-slate-400 block font-semibold">
              {isRequesterManagerOrFinance ? 'Catatan Direktur' : 'Catatan Manager'}
            </span>
            <p className="text-slate-700 italic">"{request.managerComment}"</p>
          </div>
        )}
      </div>

      {/* Previous Transfers List Card (Only for Dana Talangan OPT) */}
      {isTalangan && previousTransferredAmount > 0 && (
        <div className="bg-indigo-50/40 border border-indigo-100 rounded-xl p-3.5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
            <span className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
              <CreditCard className="w-4 h-4 text-emerald-600" />
              <span>Riwayat Transfer Sebelumnya</span>
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${remainingAmount <= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {remainingAmount <= 0 ? '100% Lunas' : `Sisa ${formatIDR(remainingAmount)}`}
            </span>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
              <div 
                className="bg-emerald-500 h-full transition-all duration-300" 
                style={{ width: `${Math.min(100, Math.round((previousTransferredAmount / Math.max(1, targetTotal)) * 100))}%` }}
              />
            </div>
          </div>

          {/* List of uploaded receipts / transfer logs */}
          {(() => {
            const urls = (request.buktiTransferUrl || '').split('||').map(u => u.trim()).filter(Boolean);
            const fileIds = (request.buktiTransferFileId || '').split('||').map(f => f.trim()).filter(Boolean);
            const reqId = request.id.trim().toLowerCase();
            const financeHistories = histories
              .filter(h => {
                const hReqId = (h.requestUid || h.itemUid || '').trim().toLowerCase();
                const reqMatch = hReqId === reqId || (hReqId && (reqId.includes(hReqId) || hReqId.includes(reqId)));
                if (!reqMatch) return false;

                const roleMatch = (h.actorRole || '').trim().toUpperCase() === 'FINANCE' || h.actionType === 'APPROVAL_FINANCE';
                const statusMatch = (h.status || '').trim().toUpperCase() === 'TRANSFERRED';

                return roleMatch && statusMatch;
              })
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            // Determine transfer item entries directly from ItemReviewHistory
            const transferItems = (() => {
              if (financeHistories.length > 0) {
                return financeHistories.map((hist, idx) => {
                  const currentUrl = urls[idx];
                  const url = hist.buktiUrl || currentUrl || '';
                  const fileId = hist.buktiFileId || fileIds[idx];

                  // 1. Nominal langsung dari kolom Nominal pada tabel database ItemReviewHistory
                  let amount = hist.nominal ? parseNumericValue(hist.nominal) : 0;

                  // 2. Jika nominal di histori bernilai 0 (data lama), ekstrak dari catatan
                  if (!amount && hist.catatan) {
                    const m = hist.catatan.match(/Rp\s*([\d.,]+)/i) || hist.catatan.match(/sebesar\s*([\d.,]+)/i);
                    if (m && m[1]) {
                      amount = parseNumericValue(m[1]);
                    } else {
                      const digits = hist.catatan.replace(/[^0-9]/g, '');
                      if (digits && digits.length >= 3) {
                        amount = parseNumericValue(digits);
                      }
                    }
                  }

                  // 3. Fallback jika nominal masih 0: distribusikan total agar data tidak kosong
                  const totalAvailable: number = parseNumericValue(request.adminActionAmount) || 
                                                 parseNumericValue(request.totalDisetujuiAdmin) || 
                                                 parseNumericValue(request.managerActionAmount) || 0;

                  if (!amount && totalAvailable > 0) {
                    if (financeHistories.length === 1) {
                      amount = totalAvailable;
                    } else {
                      const knownSum = financeHistories.reduce<number>((sum, h, i) => {
                        if (i === idx) return sum;
                        return sum + (h.nominal ? parseNumericValue(h.nominal) : 0);
                      }, 0);

                      if (knownSum > 0 && totalAvailable > knownSum) {
                        amount = totalAvailable - knownSum;
                      } else {
                        amount = Math.round(totalAvailable / financeHistories.length);
                      }
                    }
                  }

                  return {
                    historyId: hist.id || '-',
                    date: hist.timestamp || request.adminActionTime || '-',
                    amount,
                    url,
                    fileId
                  };
                });
              } else {
                // Fallback jika belum ada log di ItemReviewHistory tetapi URL resi sudah terupload
                const totalAvailable: number = parseNumericValue(request.adminActionAmount) || 
                                               parseNumericValue(request.totalDisetujuiAdmin) || 
                                               parseNumericValue(request.managerActionAmount) || 0;

                return urls.map((url, idx) => ({
                  historyId: '-',
                  date: request.adminActionTime || '-',
                  amount: urls.length > 0 ? Math.round(totalAvailable / urls.length) : totalAvailable,
                  url,
                  fileId: fileIds[idx]
                }));
              }
            })();

            if (transferItems.length === 0) return null;

            return (
              <div className="space-y-2 pt-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Daftar Bukti Transfer ({transferItems.length}):
                </span>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  {/* Table Header Columns */}
                  <div className="grid grid-cols-12 bg-slate-100/80 border-b border-slate-200 px-3 py-2 text-[9.5px] font-bold text-slate-500 uppercase tracking-wider items-center gap-1">
                    <div className="col-span-1 text-center">NO</div>
                    <div className="col-span-3">ID</div>
                    <div className="col-span-3 pl-3">Tanggal Transfer</div>
                    <div className="col-span-3 text-right pr-1">Nominal</div>
                    <div className="col-span-2 text-center">Bukti Transfer</div>
                  </div>

                  {/* Table Rows */}
                  <div className="divide-y divide-slate-100 max-h-[180px] overflow-y-auto">
                    {transferItems.map((item, idx) => {
                      return (
                        <div key={idx} className="grid grid-cols-12 px-3 py-2 text-xs items-center hover:bg-slate-50/70 transition-colors gap-1">
                          {/* No */}
                          <div className="col-span-1 text-center font-bold text-slate-500 text-[11px]">
                            {idx + 1}
                          </div>

                          {/* ID */}
                          <div className="col-span-3 font-mono text-[10px] text-slate-600 truncate font-semibold" title={item.historyId}>
                            {item.historyId}
                          </div>

                          {/* Tanggal Transfer */}
                          <div className="col-span-3 pl-3 font-medium text-slate-700 text-[10px] truncate" title={item.date}>
                            {item.date}
                          </div>

                          {/* Nominal Transfer */}
                          <div className="col-span-3 text-right pr-1 font-extrabold text-emerald-600 text-[11px]">
                            {item.amount && item.amount > 0 ? formatIDR(item.amount) : '-'}
                          </div>

                          {/* Lihat Bukti Transfer */}
                          <div className="col-span-2 flex justify-center">
                            {item.url ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (onPreviewDocument) {
                                    onPreviewDocument({
                                      url: item.url,
                                      fileId: item.fileId || undefined,
                                      title: `Bukti Transfer #${idx + 1} (UID: ${request.id})`
                                    });
                                  } else {
                                    window.open(item.url, '_blank');
                                  }
                                }}
                                className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-[10px] flex items-center justify-center gap-1 cursor-pointer transition-colors border border-indigo-100 shadow-2xs whitespace-nowrap"
                              >
                                <Eye className="w-3 h-3 text-indigo-600 shrink-0" />
                                <span>Lihat Resi #{idx + 1}</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 italic">-</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

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

            {!isTalangan ? (
              /* FORM PENGAJUAN BIASA (OP) - SINGLE TRANSFER */
              <div className="space-y-4">
                {request.status === RequestStatus.TRANSFERRED && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3.5 text-xs space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-amber-800">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span>Status Transferred</span>
                    </p>
                    <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
                      UID Pengajuan biasa (<strong>{request.id}</strong>) telah berstatus <strong>TRANSFERRED</strong>. Finance tidak bisa melakukan transfer ulang.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">
                    Nominal Dana Ditransfer (Rupiah) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={transferredAmount}
                      onChange={(e) => setTransferredAmount(e.target.value.replace(/\D/g, ''))}
                      placeholder="Nominal transfer"
                      disabled={request.status === RequestStatus.TRANSFERRED}
                      className={`w-full pl-9 pr-3 py-2 text-xs bg-white border rounded-xl focus:ring-1 transition-all outline-none ${
                        transferredAmount && parseNumericValue(transferredAmount) > request.managerActionAmount && request.managerActionAmount > 0
                          ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30'
                          : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/30'
                      }`}
                      required
                    />
                    <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  </div>

                  {transferredAmount && parseNumericValue(transferredAmount) > 0 && (
                    parseNumericValue(transferredAmount) > request.managerActionAmount && request.managerActionAmount > 0 ? (
                      <div className="mt-2 p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-[11px] font-semibold flex items-start gap-2 shadow-2xs">
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-red-800">Transfer Melebihi Nominal Disetujui Manager!</p>
                          <p className="text-[10px] text-red-700 mt-0.5 leading-snug">
                            Nominal transfer (<strong>{formatIDR(transferredAmount)}</strong>) tidak boleh melebihi nominal yang disetujui Manager (<strong>{formatIDR(request.managerActionAmount)}</strong>).
                          </p>
                        </div>
                      </div>
                    ) : parseNumericValue(transferredAmount) < request.managerActionAmount && request.managerActionAmount > 0 ? (
                      <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-[11px] font-semibold flex items-start gap-2 shadow-2xs">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-amber-900">Transfer Kurang Dari Nominal Disetujui Manager</p>
                          <p className="text-[10px] text-amber-800 mt-0.5 leading-snug">
                            Nominal transfer (<strong>{formatIDR(transferredAmount)}</strong>) kurang dari disetujui Manager (<strong>{formatIDR(request.managerActionAmount)}</strong>). <strong>Catatan Finance WAJIB diisi</strong>.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[10px] text-indigo-600 font-semibold mt-1">
                        Format: {formatIDR(transferredAmount)}
                      </p>
                    )
                  )}
                </div>

                {/* Bukti Transfer Upload */}
                <div className="space-y-2 pt-1">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Bukti / Nota Transfer Bank (Wajib)
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
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={request.status === RequestStatus.TRANSFERRED}
                      className="p-3 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-xl text-center flex flex-col items-center justify-center gap-1.5 transition-all text-[10px] font-bold text-slate-600 cursor-pointer disabled:opacity-50"
                    >
                      <Camera className="w-5 h-5 text-indigo-500" />
                      <span>Kamera HP</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={request.status === RequestStatus.TRANSFERRED}
                      className="p-3 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-xl text-center flex flex-col items-center justify-center gap-1.5 transition-all text-[10px] font-bold text-slate-600 cursor-pointer disabled:opacity-50"
                    >
                      <UploadCloud className="w-5 h-5 text-indigo-500" />
                      <span>File / Galeri</span>
                    </button>
                  </div>
                </div>

                {/* Catatan Finance */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-500">
                    Catatan Finance{' '}
                    {parseNumericValue(transferredAmount) < request.managerActionAmount && request.managerActionAmount > 0 ? (
                      <span className="text-red-500 font-bold">(Wajib - Transfer Kurang dari Disetujui) *</span>
                    ) : (
                      <span className="text-slate-400 font-normal">(Opsional)</span>
                    )}
                  </label>
                  <textarea
                    rows={2}
                    value={adminComment}
                    onChange={(e) => setAdminComment(e.target.value)}
                    disabled={request.status === RequestStatus.TRANSFERRED}
                    placeholder={
                      parseNumericValue(transferredAmount) < request.managerActionAmount && request.managerActionAmount > 0
                        ? "Jelaskan alasan nominal transfer kurang dari nominal yang disetujui Manager..."
                        : "Tambahkan catatan dari Finance (misal: No. Ref Transfer, Nama Bank, dll)..."
                    }
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none resize-none disabled:bg-slate-50"
                  />
                </div>

                {/* Single Transfer Submit Button for OP */}
                <button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    request.status === RequestStatus.TRANSFERRED ||
                    (request.managerActionAmount > 0 && parseNumericValue(transferredAmount) > request.managerActionAmount) ||
                    (request.managerActionAmount > 0 && parseNumericValue(transferredAmount) < request.managerActionAmount && !adminComment.trim())
                  }
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 disabled:shadow-none transition-all cursor-pointer"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>{isSubmitting ? 'Memproses & Mengunggah...' : 'Simpan data dan bukti transfer'}</span>
                </button>
              </div>
            ) : isFinalTalanganTransfer ? (
              /* FORM FINAL REIMBURSEMENT DANA TALANGAN (OPT) */
              <div className="space-y-3">
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl p-3.5 text-xs space-y-1">
                  <p className="font-semibold flex items-center gap-1.5 text-emerald-700">
                    <Coins className="w-4 h-4 text-emerald-600" />
                    <span>Reimbursement Dana Talangan Pribadi</span>
                  </p>
                  <p className="text-[10px] text-slate-600 leading-relaxed font-medium">
                    Total reimbursement disetujui: <strong>{formatIDR(approvedUsageAmount || targetTotal)}</strong>. Sisa belum ditransfer: <strong>{formatIDR(remainingAmount)}</strong>. Anda dapat mentransfer seluruhnya atau secara bertahap.
                  </p>
                </div>

                {remainingAmount <= 0 && targetTotal > 0 ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        <div>
                          <h4 className="font-bold text-emerald-950 text-xs">Total Transfer Sesuai Nominal Disetujui (100% Lunas)</h4>
                          <p className="text-[11px] text-emerald-800">Total Ditransfer: {formatIDR(previousTransferredAmount)} / Total Disetujui: {formatIDR(targetTotal)}</p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 text-[10px] font-black bg-emerald-700 text-white rounded-lg uppercase tracking-wider">
                        Siap Closing
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-900 leading-relaxed">
                      Seluruh dana yang disetujui telah 100% ditransfer. Klik tombol di bawah ini untuk melakukan <strong>CLOSING UID TALANGAN</strong> dan mengarsipkan transaksi ini.
                    </p>
                    <button
                      type="button"
                      onClick={handleExecuteClosingOnly}
                      disabled={isSubmitting}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-emerald-200 transition-all cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isSubmitting ? 'Memproses Closing...' : 'LAKUKAN CLOSING UID TALANGAN'}</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">
                        Nominal Dana Ditransfer (Rupiah) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={transferredAmount}
                          onChange={(e) => setTransferredAmount(e.target.value.replace(/\D/g, ''))}
                          placeholder="Nominal transfer"
                          className={`w-full pl-9 pr-3 py-2 text-xs bg-white border rounded-xl focus:ring-1 transition-all outline-none ${
                            transferredAmount && previousTransferredAmount + parseNumericValue(transferredAmount) > targetTotal && targetTotal > 0
                              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/30'
                              : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-500/30'
                          }`}
                          required
                        />
                        <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      </div>
                      {transferredAmount && parseNumericValue(transferredAmount) > 0 && (
                        previousTransferredAmount + parseNumericValue(transferredAmount) > targetTotal && targetTotal > 0 ? (
                          <div className="mt-2 p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-[11px] font-semibold flex items-start gap-2 shadow-2xs">
                            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold text-red-800">Transfer Melebihi Total Disetujui!</p>
                              <p className="text-[10px] text-red-700 mt-0.5 leading-snug">
                                Total transfer akan menjadi <strong>{formatIDR(previousTransferredAmount + parseNumericValue(transferredAmount))}</strong> (Lalu: {formatIDR(previousTransferredAmount)} + Sekarang: {formatIDR(parseNumericValue(transferredAmount))}), padahal total nominal disetujui adalah <strong>{formatIDR(targetTotal)}</strong>. Sisa maksimal: <strong>{formatIDR(remainingAmount)}</strong>.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[10px] text-indigo-600 font-semibold mt-1">
                            Format: {formatIDR(transferredAmount)}
                          </p>
                        )
                      )}
                    </div>

                    {/* Notification Banner when total transfer equals total approved nominal */}
                    {targetTotal > 0 && previousTransferredAmount + parseNumericValue(transferredAmount) === targetTotal && parseNumericValue(transferredAmount) > 0 && (
                      <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl p-3.5 text-xs space-y-1.5 animate-fade-in">
                        <div className="flex items-center justify-between">
                          <p className="font-bold flex items-center gap-1.5 text-emerald-800">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>OPSI CLOSING DIAKTIFKAN</span>
                          </p>
                          <span className="px-2 py-0.5 text-[9.5px] font-black bg-emerald-600 text-white rounded-full uppercase tracking-wider">
                            CLOSING READY
                          </span>
                        </div>
                        <p className="text-[11px] text-emerald-800 leading-relaxed font-medium">
                          Total akumulasi transfer (<strong>{formatIDR(targetTotal)}</strong>) sudah <strong>SAMA DENGAN</strong> total nominal disetujui. Mengonfirmasi transfer ini akan melakukan <strong>CLOSING UID TALANGAN</strong> (Status: CLOSED).
                        </p>
                      </div>
                    )}

                    {/* Bukti Transfer Upload */}
                    <div className="space-y-2 pt-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Bukti / Nota Transfer Pengembalian Dana (Wajib)
                      </label>
                      
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

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => cameraInputRef.current?.click()}
                          className="p-3 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 rounded-xl text-center flex flex-col items-center justify-center gap-1.5 transition-all text-[10px] font-bold text-slate-600 cursor-pointer"
                        >
                          <Camera className="w-5 h-5 text-indigo-500" />
                          <span>Kamera HP</span>
                        </button>

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

                    {/* Catatan Finance */}
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

                    {/* Submit Button for Final Reimbursement */}
                    <button
                      type="submit"
                      disabled={isSubmitting || (targetTotal > 0 && previousTransferredAmount + parseNumericValue(transferredAmount) > targetTotal)}
                      className={`w-full py-2.5 font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer ${
                        targetTotal > 0 && previousTransferredAmount + parseNumericValue(transferredAmount) === targetTotal
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-100'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100'
                      } disabled:bg-slate-300 disabled:shadow-none`}
                    >
                      {targetTotal > 0 && previousTransferredAmount + parseNumericValue(transferredAmount) === targetTotal ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <CreditCard className="w-4 h-4" />
                      )}
                      <span>
                        {isSubmitting 
                          ? 'Memproses & Mengunggah...' 
                          : (targetTotal > 0 && previousTransferredAmount + parseNumericValue(transferredAmount) === targetTotal
                              ? 'Kirim Bukti & Closing UID Talangan (Lunas 100%)' 
                              : 'Kirim Bukti & Selesaikan Reimbursement')}
                      </span>
                    </button>
                  </>
                )}
              </div>
            ) : (
              /* FORM INITIAL DANA TALANGAN (OPT Awal) */
              <div className="space-y-4">
                <div className="bg-indigo-50 border border-indigo-100 text-indigo-800 rounded-xl p-3.5 text-xs space-y-1">
                  <p className="font-semibold flex items-center gap-1.5 text-indigo-700">
                    <Coins className="w-4 h-4 text-indigo-600" />
                    <span>Konfirmasi Dana Talangan Pribadi</span>
                  </p>
                  <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                    Sistem mencatat transfer sebesar <strong>Rp 0</strong> untuk UID ini karena merupakan Dana Talangan Pribadi. Mengonfirmasi akan mengubah status menjadi <strong>TRANSFERRED</strong> agar pemohon dapat mulai mengunggah nota/bukti pemakaian dana secara bertahap.
                  </p>
                </div>

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

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>{isSubmitting ? 'Memproses...' : 'Konfirmasi & Aktifkan UID'}</span>
                </button>
              </div>
            )}
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

