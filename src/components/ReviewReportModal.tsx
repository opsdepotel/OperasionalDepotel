/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BudgetRequest, UsageReportItem, Role, ItemStatus, RequestStatus } from '../types';
import {
  Shield, Check, X, AlertCircle, Info, ExternalLink,
  MessageSquare, Send, CheckCircle2, AlertTriangle, HelpCircle, Eye
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
}

export const ReviewReportModal: React.FC<ReviewReportModalProps> = ({
  request,
  requesterName,
  items,
  role,
  onSubmitReview,
  onClose,
  onPreviewDocument
}) => {
  // Filter items for this request
  const currentItems = items.filter(item => item.requestId === request.id);

  // Track review decisions locally before submitting
  // Format: { [itemId]: { status: ItemStatus, comment: string } }
  const [decisions, setDecisions] = useState<Record<string, { status: ItemStatus; comment: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

    const isTalangan = request.id.startsWith('OPT-') || request.keterangan.startsWith('[DANA TALANGAN]');
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
        // If Admin approves all, for Dana Talangan go to PENDING_TALANGAN_TRANSFER, otherwise REPORTING
        nextRequestStatus = isTalangan ? RequestStatus.PENDING_TALANGAN_TRANSFER : RequestStatus.REPORTING;
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
    </div>
  );
};
