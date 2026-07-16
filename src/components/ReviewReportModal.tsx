/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BudgetRequest, UsageReportItem, Role, ItemStatus, RequestStatus } from '../types';
import {
  Shield, Check, X, AlertCircle, Info, ExternalLink,
  MessageSquare, Send, CheckCircle2, AlertTriangle, HelpCircle, Eye, Sparkles, Loader2
} from 'lucide-react';

interface ReviewReportModalProps {
  request: BudgetRequest;
  requesterName?: string;
  items: UsageReportItem[];
  role: Role; // MANAGER or ADMIN
  onSubmitReview: (
    updatedItems: { itemId: string; status: ItemStatus; comment: string }[],
    nextRequestStatus: RequestStatus
  ) => Promise<void>;
  onClose: () => void;
  onPreviewDocument?: (doc: { url: string; fileId?: string; title?: string }) => void;
  googleToken?: string;
}

export const ReviewReportModal: React.FC<ReviewReportModalProps> = ({
  request,
  requesterName,
  items,
  role,
  onSubmitReview,
  onClose,
  onPreviewDocument,
  googleToken
}) => {
  // Filter items for this request
  const currentItems = items.filter(item => item.requestId === request.id);

  // Track review decisions locally before submitting
  // Format: { [itemId]: { status: ItemStatus, comment: string } }
  const [decisions, setDecisions] = useState<Record<string, { status: ItemStatus; comment: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // AI Receipt Validation States
  const [scanningItemIds, setScanningItemIds] = useState<Record<string, boolean>>({});
  const [scanResults, setScanResults] = useState<Record<string, { nominal: number; keterangan: string; tanggal: string }>>({});
  const [scanErrors, setScanErrors] = useState<Record<string, string | null>>({});
  const [mismatchModal, setMismatchModal] = useState<{
    isOpen: boolean;
    itemKeterangan: string;
    userNominal: number;
    extNominal: number;
    userTanggal: string;
    extTanggal: string;
    extKeterangan: string;
  } | null>(null);

  const handleValidateItemWithAi = async (item: UsageReportItem) => {
    setScanningItemIds(prev => ({ ...prev, [item.id]: true }));
    setScanErrors(prev => ({ ...prev, [item.id]: null }));

    try {
      const response = await window.fetch('/api/gemini/analyze-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: item.buktiUrl,
          googleToken: googleToken,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Terjadi kesalahan saat memproses gambar dengan AI.');
      }

      const extData = result.data;
      setScanResults(prev => ({ ...prev, [item.id]: extData }));

      // Compare original report data vs extracted data
      const nominalMismatch = Math.abs((extData.nominal || 0) - item.nominal) > 10;
      const dateMismatch = extData.tanggal && item.tanggalPenggunaan && extData.tanggal !== item.tanggalPenggunaan;

      if (nominalMismatch || dateMismatch) {
        // Trigger Pop up Warning/Notifikasi
        setMismatchModal({
          isOpen: true,
          itemKeterangan: item.keterangan,
          userNominal: item.nominal,
          extNominal: extData.nominal || 0,
          userTanggal: item.tanggalPenggunaan,
          extTanggal: extData.tanggal || '-',
          extKeterangan: extData.keterangan || '-',
        });
      }
    } catch (err: any) {
      console.error('Error in handleValidateItemWithAi:', err);
      setScanErrors(prev => ({ ...prev, [item.id]: err.message || 'Gagal menjalankan validasi AI.' }));
    } finally {
      setScanningItemIds(prev => ({ ...prev, [item.id]: false }));
    }
  };

  // Pre-fill local decisions with current values
  useEffect(() => {
    const initialDecisions: Record<string, { status: ItemStatus; comment: string }> = {};
    currentItems.forEach((item) => {
      if (role === Role.MANAGER) {
        initialDecisions[item.id] = {
          status: item.statusManager,
          comment: item.managerComment
        };
      } else if (role === Role.ADMIN) {
        initialDecisions[item.id] = {
          status: item.statusAdmin,
          comment: item.adminComment
        };
      }
    });
    setDecisions(initialDecisions);
  }, [items, request, role]);

  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(num);
  };

  const handleDecisionChange = (itemId: string, status: ItemStatus) => {
    setDecisions(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        status,
        // Reset comment if approving
        comment: status === ItemStatus.APPROVED ? '' : prev[itemId]?.comment || ''
      }
    }));
  };

  const handleCommentChange = (itemId: string, comment: string) => {
    setDecisions(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        comment
      }
    }));
  };

  const handleSubmit = async () => {
    setError(null);

    // Validate that all items have a decision (cannot be PENDING)
    const pendingCount = currentItems.filter(item => {
      const dec = decisions[item.id];
      return !dec || dec.status === ItemStatus.PENDING;
    }).length;

    if (pendingCount > 0) {
      setError(`Harap berikan keputusan (Setujui / Revisi) untuk seluruh ${pendingCount} item pengeluaran.`);
      return;
    }

    // Validate that all rejected items have comments
    const missingCommentCount = currentItems.filter(item => {
      const dec = decisions[item.id];
      return dec?.status === ItemStatus.REJECTED && !dec.comment.trim();
    }).length;

    if (missingCommentCount > 0) {
      setError('Setiap item yang butuh revisi wajib mencantumkan alasan revisi.');
      return;
    }

    // Determine the next status of the BudgetRequest UID based on decisions
    const hasRejections = currentItems.some(item => {
      const dec = decisions[item.id];
      return dec?.status === ItemStatus.REJECTED;
    });

    let nextRequestStatus: RequestStatus;

    if (role === Role.MANAGER) {
      if (hasRejections) {
        // If the manager rejects any item, it goes back to User for reporting/correction
        nextRequestStatus = RequestStatus.REPORTING;
      } else {
        // If the manager approves all, it moves to Admin review
        nextRequestStatus = RequestStatus.REVIEW_ADMIN;
      }
    } else {
      // Role is ADMIN
      if (hasRejections) {
        // If Admin rejects any item, it goes back to User for reporting/correction
        nextRequestStatus = RequestStatus.REPORTING;
      } else {
        // If Admin approves all, next status is REPORTING so Admin can close later or User can add more items
        nextRequestStatus = RequestStatus.REPORTING;
      }
    }

    const payload = currentItems.map(item => ({
      itemId: item.id,
      status: decisions[item.id].status,
      comment: decisions[item.id].comment.trim()
    }));

    setIsSubmitting(true);
    try {
      await onSubmitReview(payload, nextRequestStatus);
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan hasil review.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalReported = currentItems.reduce((sum, i) => sum + i.nominal, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-5 animate-slide-up space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-sm">Review Laporan Penggunaan</h2>
          <p className="text-[10px] text-indigo-600 font-semibold">Tingkat Review: {role === Role.MANAGER ? 'Manager' : 'Admin / Finansial'}</p>
        </div>
        <button
          onClick={onClose}
          className="text-xs font-semibold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50"
        >
          Tutup
        </button>
      </div>

      {/* Request details */}
      <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 space-y-1">
        <p><strong>UID:</strong> <span className="font-mono">{request.id}</span> | <strong>Pemohon:</strong> {requesterName || request.userEmail}</p>
        <p><strong>Dana Ditransfer:</strong> <span className="text-blue-600 font-bold">{formatIDR(request.adminActionAmount)}</span> | <strong>Total Laporan:</strong> <span className="text-slate-800 font-bold">{formatIDR(totalReported)}</span></p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Item List with Review Actions */}
      <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
        {currentItems.map((item, idx) => {
          const decision = decisions[item.id] || { status: ItemStatus.PENDING, comment: '' };

          return (
            <div key={item.id} className="border border-slate-100 bg-white rounded-xl p-3 space-y-3 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">ITEM #{idx + 1}</span>
                  <h4 className="text-xs font-bold text-slate-800">{item.keterangan}</h4>
                  <p className="text-[10px] text-slate-500 font-medium">Tanggal: {item.tanggalPenggunaan} | Nominal: <strong>{formatIDR(item.nominal)}</strong></p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (onPreviewDocument) {
                      onPreviewDocument({
                        url: item.buktiUrl,
                        fileId: item.buktiFileId,
                        title: `Bukti Nota: ${item.keterangan}`
                      });
                    } else {
                      window.open(item.buktiUrl, '_blank');
                    }
                  }}
                  className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <span>Bukti</span>
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* AI Validation Area */}
              <div className="bg-indigo-50/40 rounded-xl p-2.5 border border-indigo-100/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-indigo-700 font-bold flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-indigo-500 animate-pulse" />
                    <span>AI Receipt & Invoice Validator</span>
                  </span>
                  
                  <button
                    type="button"
                    onClick={() => handleValidateItemWithAi(item)}
                    disabled={scanningItemIds[item.id]}
                    className="py-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-extrabold text-[9px] rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    {scanningItemIds[item.id] ? (
                      <>
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        <span>Menganalisis...</span>
                      </>
                    ) : scanResults[item.id] ? (
                      <span>Ulangi Validasi AI</span>
                    ) : (
                      <span>Validasi Bukti via AI</span>
                    )}
                  </button>
                </div>

                {scanErrors[item.id] && (
                  <p className="text-[9px] text-red-600 font-semibold bg-red-50 p-1.5 rounded-md">
                    {scanErrors[item.id]}
                  </p>
                )}

                {scanResults[item.id] && (
                  <div className="text-[10px] bg-white border border-slate-150 rounded-lg p-2.5 space-y-2 text-slate-600 shadow-sm animate-fade-in">
                    <div className="flex items-center gap-1 pb-1.5 border-b border-slate-100 font-bold text-indigo-700">
                      <Sparkles className="w-3 h-3 text-indigo-500 animate-pulse" />
                      <span>Hasil Pengecekan AI (Tanggal & Nominal)</span>
                    </div>
                    
                    {/* Perbandingan Nominal */}
                    <div className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                      <span className="text-[10px] text-slate-500 font-medium">Nominal Transaksi:</span>
                      <div className="flex flex-col items-end text-right font-mono text-[10px]">
                        <span>Input: <strong className="text-slate-800 font-bold">{formatIDR(item.nominal)}</strong></span>
                        <span>AI: <strong className="text-indigo-800 font-bold">{formatIDR(scanResults[item.id].nominal)}</strong></span>
                      </div>
                    </div>
                    {Math.abs(scanResults[item.id].nominal - item.nominal) > 10 ? (
                      <div className="text-red-600 font-bold flex items-center gap-1 bg-red-50/50 p-1 rounded border border-red-100 text-[9px]">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                        <span>Nominal berbeda! Selisih {formatIDR(Math.abs(scanResults[item.id].nominal - item.nominal))}</span>
                      </div>
                    ) : (
                      <div className="text-emerald-700 font-bold flex items-center gap-1 bg-emerald-50/50 p-1 rounded border border-emerald-100 text-[9px]">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                        <span>Nominal Sesuai</span>
                      </div>
                    )}

                    {/* Perbandingan Tanggal */}
                    <div className="flex items-center justify-between gap-2 py-0.5 border-t border-slate-50 pt-1.5 text-[11px]">
                      <span className="text-[10px] text-slate-500 font-medium">Tanggal Transaksi:</span>
                      <div className="flex flex-col items-end text-right font-mono text-[10px]">
                        <span>Input: <strong className="text-slate-800 font-bold">{item.tanggalPenggunaan}</strong></span>
                        <span>AI: <strong className="text-indigo-800 font-bold">{scanResults[item.id].tanggal}</strong></span>
                      </div>
                    </div>
                    {scanResults[item.id].tanggal && item.tanggalPenggunaan && scanResults[item.id].tanggal !== item.tanggalPenggunaan ? (
                      <div className="text-red-600 font-bold flex items-center gap-1 bg-red-50/50 p-1 rounded border border-red-100 text-[9px]">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                        <span>Tanggal berbeda!</span>
                      </div>
                    ) : (
                      <div className="text-emerald-700 font-bold flex items-center gap-1 bg-emerald-50/50 p-1 rounded border border-emerald-100 text-[9px]">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                        <span>Tanggal Sesuai</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Display partner's status for context */}
              {role === Role.ADMIN && (
                <div className="text-[10px] bg-slate-50 p-2 rounded-lg text-slate-600">
                  <span>Status Persetujuan Manager: </span>
                  <span className={`font-bold ${item.statusManager === ItemStatus.APPROVED ? 'text-emerald-600' : 'text-red-600'}`}>
                    {item.statusManager === ItemStatus.APPROVED ? 'DISETUJUI' : 'REVISI'}
                  </span>
                  {item.managerComment && <p className="italic text-slate-400 mt-0.5">"{item.managerComment}"</p>}
                </div>
              )}

              {/* Reviewer Action selectors */}
              <div className="space-y-2 pt-2 border-t border-slate-50">
                <span className="block text-[10px] font-bold text-slate-400 uppercase">Keputusan Anda</span>
                {role === Role.ADMIN && item.statusAdmin === ItemStatus.APPROVED ? (
                  <div className="text-xs font-bold text-emerald-600 bg-emerald-50/50 border border-emerald-100 rounded-lg py-1.5 px-3 flex items-center gap-1.5 w-fit">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Disetujui</span>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleDecisionChange(item.id, ItemStatus.APPROVED)}
                        className={`py-1.5 px-3 text-xs font-semibold rounded-lg border text-center flex items-center justify-center gap-1.5 transition-all ${
                          decision.status === ItemStatus.APPROVED
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold'
                            : 'border-slate-150 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Setujui</span>
                      </button>
                      <button
                        onClick={() => handleDecisionChange(item.id, ItemStatus.REJECTED)}
                        className={`py-1.5 px-3 text-xs font-semibold rounded-lg border text-center flex items-center justify-center gap-1.5 transition-all ${
                          decision.status === ItemStatus.REJECTED
                            ? 'border-red-500 bg-red-50 text-red-700 font-bold'
                            : 'border-slate-150 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Revisi</span>
                      </button>
                    </div>

                    {/* If rejected, reason is required */}
                    {decision.status === ItemStatus.REJECTED && (
                      <div className="space-y-1">
                        <label className="block text-[9px] font-bold text-red-500 uppercase">Alasan Revisi (Wajib)</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={decision.comment}
                            onChange={(e) => handleCommentChange(item.id, e.target.value)}
                            placeholder="Contoh: Bukti buram, Nominal tidak sesuai nota"
                            className="w-full pl-8 pr-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                            required
                          />
                          <MessageSquare className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit Decision Button */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
      >
        <Send className="w-4 h-4" />
        <span>{isSubmitting ? 'Mengirim Keputusan...' : 'Kirim Seluruh Keputusan Review'}</span>
      </button>

      {/* Pop Up Notifikasi Mismatch / Warning */}
      {mismatchModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 space-y-4 animate-scale-up border border-red-100 text-left">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shadow-inner">
              <AlertTriangle className="w-6 h-6 animate-pulse" />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-black text-slate-800 font-display">Peringatan: Bukti Ditengarai Tidak Sesuai!</h3>
              <p className="text-[11px] text-slate-500 leading-relaxed font-semibold">
                Hasil ekstraksi kecerdasan buatan (AI) menunjukkan ketidakcocokan antara data laporan yang diinput pengguna dengan bukti nota terlampir:
              </p>
              
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 text-xs space-y-2.5">
                <div>
                  <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">Item Laporan Pengguna:</span>
                  <p className="font-bold text-slate-700 text-xs">"{mismatchModal.itemKeterangan}"</p>
                  <div className="flex gap-4 mt-1 font-mono text-[10px] text-slate-600">
                    <span>Nominal: <strong className="text-slate-800 font-bold">{formatIDR(mismatchModal.userNominal)}</strong></span>
                    <span>Tanggal: <strong className="text-slate-800 font-bold">{mismatchModal.userTanggal}</strong></span>
                  </div>
                </div>
                <div className="border-t border-slate-200 pt-2.5">
                  <span className="text-[9px] text-indigo-500 font-bold block uppercase tracking-wider">Hasil Ekstraksi AI:</span>
                  <p className="font-bold text-indigo-900 text-xs">"{mismatchModal.extKeterangan}"</p>
                  <div className="flex gap-4 mt-1 font-mono text-[10px] text-indigo-900">
                    <span>Nominal: <strong className="font-bold text-red-600">{formatIDR(mismatchModal.extNominal)}</strong></span>
                    <span>Tanggal: <strong className="font-bold text-indigo-800">{mismatchModal.extTanggal}</strong></span>
                  </div>
                </div>
              </div>
              
              <p className="text-[10px] text-red-600 bg-red-50/50 p-2.5 rounded-xl font-medium border border-red-100 leading-normal">
                ⚠️ <strong>Saran Sistem:</strong> Disarankan bagi Manager atau Admin untuk mem-verifikasi laporan ini dengan lebih teliti karena bukti transaksi ditengarai tidak cocok.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setMismatchModal(null)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm text-center"
              >
                Saya Mengerti, Lanjutkan Review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
