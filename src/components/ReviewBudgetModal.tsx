/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BudgetRequest, RequestStatus, SiteInfo, ItemReviewHistory, ItemStatus } from '../types';
import { parseNumericValue } from '../lib/googleApi';
import { ItemHistoryModal } from './ItemHistoryModal';
import { Shield, Check, X, AlertCircle, Coins, MessageSquare, MapPin, ExternalLink, History } from 'lucide-react';

interface ReviewBudgetModalProps {
  request: BudgetRequest;
  requesterName?: string;
  sites?: SiteInfo[];
  histories?: ItemReviewHistory[];
  onApprove: (approvedAmount: number, comment: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onClose: () => void;
}

export const ReviewBudgetModal: React.FC<ReviewBudgetModalProps> = ({
  request,
  requesterName,
  sites = [],
  histories = [],
  onApprove,
  onReject,
  onClose
}) => {
  const [approvedAmount, setApprovedAmount] = useState(String(request.jumlahPengajuan));
  const [comment, setComment] = useState('');
  const [action, setAction] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Parse Site ID and match database for multi-site vertical list
  const parseSiteList = (rawSiteId: string, sitesList: SiteInfo[]) => {
    if (!rawSiteId || !rawSiteId.trim()) return [];

    // 1. Check if regex matches standard site ID format (e.g. BKS123, JKT456)
    const siteIdRegex = /[A-Za-z]{3}\d{3}/g;
    const regexMatches = rawSiteId.match(siteIdRegex) || [];
    const uniqueRegexMatches = Array.from(new Set(regexMatches.map(m => m.trim().toUpperCase())));

    let tokensToProcess: string[] = [];

    if (uniqueRegexMatches.length > 0) {
      tokensToProcess = uniqueRegexMatches;
    } else {
      // 2. Fallback: split by delimiters (comma, semicolon, slash, newline, pipe, plus)
      const splitTokens = rawSiteId
        .split(/[,;\/\n\r|+]+/)
        .map(s => s.trim())
        .filter(Boolean);

      const tokenSet = new Set<string>();
      splitTokens.forEach(t => tokenSet.add(t.toUpperCase()));
      tokensToProcess = Array.from(tokenSet);
    }

    if (tokensToProcess.length === 0) {
      tokensToProcess = [rawSiteId.trim().toUpperCase()];
    }

    return tokensToProcess.map(id => {
      const cleanId = id.toUpperCase();
      const found = sitesList.find(s => 
        s.siteId.toUpperCase().trim() === cleanId || 
        s.siteId.toUpperCase().replaceAll('-', '').trim() === cleanId.replaceAll('-', '')
      );

      if (found) {
        return { 
          id: found.siteId, 
          name: found.siteName, 
          coordinates: found.coordinates || '', 
          isVerified: true 
        };
      }
      if (cleanId === 'DUREN-SAWIT' || cleanId === 'DURENSAWIT') {
        return { 
          id: 'DUREN-SAWIT', 
          name: 'Depot / Pos Utama', 
          coordinates: '', 
          isVerified: true 
        };
      }
      return { 
        id: id, 
        name: null, 
        coordinates: '', 
        isVerified: false 
      };
    });
  };

  const parsedSites = parseSiteList(request.siteId, sites);

  const formatIDR = (num: any) => {
    const val = parseNumericValue(num);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val);
  };

  const isTalangan = request.id.startsWith('OPT-') || request.keterangan.startsWith('[DANA TALANGAN]');

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!comment.trim()) {
      setError('Catatan / komentar Manager wajib diisi.');
      return;
    }

    const amt = isTalangan ? 0 : parseNumericValue(approvedAmount);
    if (!isTalangan) {
      if (amt <= 0) {
        setError('Nominal persetujuan harus lebih besar dari Rp 0.');
        return;
      }
      if (amt > request.jumlahPengajuan) {
        setError(`Nominal persetujuan tidak boleh melebihi jumlah pengajuan (${formatIDR(request.jumlahPengajuan)}).`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await onApprove(amt, comment.trim());
    } catch (err: any) {
      setError(err.message || 'Gagal menyetujui pengajuan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!comment.trim()) {
      setError('Alasan penolakan wajib dicantumkan.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onReject(comment.trim());
    } catch (err: any) {
      setError(err.message || 'Gagal menolak pengajuan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-5 animate-slide-up space-y-4">
      {/* Title */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-sm">Tinjau Pengajuan Anggaran</h2>
          <p className="text-[10px] text-slate-400">Reviewer: Manager</p>
        </div>
        <button
          onClick={onClose}
          className="text-xs font-semibold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50"
        >
          Tutup
        </button>
      </div>

      {/* Details Card */}
      <div className="bg-slate-50 rounded-xl p-3.5 space-y-2 text-xs text-slate-600">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">UID Pengajuan</span>
            <span className="font-mono font-bold text-slate-800">{request.id}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">Diajukan Oleh</span>
            <span className="font-semibold text-slate-800">{requesterName || request.userEmail}</span>
          </div>
          <div className="col-span-2">
            <span className="text-[10px] text-slate-400 block font-semibold mb-1">
              Lokasi / Site {parsedSites.length > 1 ? `(${parsedSites.length} Multi-Site)` : ''}
            </span>
            {parsedSites.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {parsedSites.map((siteItem, idx) => {
                  const gmapsUrl = siteItem.coordinates
                    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteItem.coordinates.trim())}`
                    : '';

                  return (
                    <div 
                      key={idx} 
                      className="flex flex-col gap-1 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-2xs"
                    >
                      {/* Top Row: Site ID & Site Name */}
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span className="font-mono font-bold text-indigo-600 text-xs shrink-0">{siteItem.id}</span>
                        {siteItem.name && (
                          <span className="text-xs font-semibold text-slate-700 border-l border-slate-200 pl-2">
                            {siteItem.name}
                          </span>
                        )}
                      </div>

                      {/* Bottom Row: Clickable Coordinates */}
                      {siteItem.coordinates && (
                        <div className="pt-0.5">
                          <a
                            href={gmapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-mono font-medium text-indigo-600 hover:text-indigo-800 hover:underline transition-colors"
                            title="Buka lokasi koordinat di Google Maps"
                          >
                            <MapPin className="w-3 h-3 text-indigo-500" />
                            <span>{siteItem.coordinates}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="font-bold text-slate-800">{request.siteId || '-'}</span>
            )}
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">Tanggal Pemakaian</span>
            <span className="font-semibold text-slate-800">{request.tanggalPemakaian}</span>
          </div>
        </div>
        <div className="pt-2 border-t border-slate-200">
          <span className="text-[10px] text-slate-400 block font-semibold">Tujuan / Keterangan</span>
          <p className="text-slate-700 font-medium">{request.keterangan}</p>
        </div>
        <div className="pt-2 border-t border-slate-200 flex justify-between items-center bg-white px-3 py-2 rounded-lg border border-slate-150">
          <span className="text-[10px] text-slate-500 font-bold">JUMLAH DIAJUKAN:</span>
          <span className="text-sm font-bold text-slate-800">{formatIDR(request.jumlahPengajuan)}</span>
        </div>
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
              <span>Lihat History ({reqHistories.length})</span>
            </button>
          </div>
        );
      })()}

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Decision Selection */}
      {!action && (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setAction('APPROVE')}
            className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm shadow-emerald-50"
          >
            <Check className="w-4 h-4" />
            <span>Setujui Pengajuan</span>
          </button>
          <button
            onClick={() => setAction('REJECT')}
            className="py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm shadow-amber-50"
          >
            <X className="w-4 h-4" />
            <span>Revisi Pengajuan</span>
          </button>
        </div>
      )}

      {/* Approve Form */}
      {action === 'APPROVE' && (
        <form onSubmit={handleApproveSubmit} className="space-y-3 pt-2 border-t border-slate-50">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 mb-1">
            <Check className="w-4 h-4" />
            <span>Persetujuan Anggaran (Penuh / Sebagian)</span>
          </div>

          {!isTalangan ? (
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nominal Disetujui (Rupiah)</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={approvedAmount}
                  onChange={(e) => setApprovedAmount(e.target.value)}
                  placeholder="contoh: 1500000"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                  required
                />
                <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
              {approvedAmount && parseNumericValue(approvedAmount) > 0 && (
                <p className="text-[10px] text-indigo-600 font-semibold mt-1">
                  Format: {formatIDR(approvedAmount)}
                </p>
              )}
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl p-3 text-xs space-y-1">
              <p className="font-semibold flex items-center gap-1.5 text-emerald-700">
                <Coins className="w-3.5 h-3.5" />
                <span>Persetujuan Dana Talangan Pribadi</span>
              </p>
              <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                Persetujuan aktivitas ini bernilai <strong>Rp 0</strong> di awal karena menggunakan dana mandiri pemohon. Rincian pengeluaran riil akan dimasukkan oleh pemohon dan diperiksa kemudian.
              </p>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
              Catatan / Komentar Manager <span className="text-red-500">*</span> (Wajib)
            </label>
            <div className="relative">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Misal: Disetujui penuh untuk pembelian sparepart"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                required
              />
              <MessageSquare className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAction(null)}
              className="w-1/3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Kembali
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-2/3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 disabled:bg-slate-300 transition-all cursor-pointer"
            >
              {isSubmitting ? 'Memproses...' : 'Kirim Persetujuan'}
            </button>
          </div>
        </form>
      )}

      {/* Reject/Revision Form */}
      {action === 'REJECT' && (
        <form onSubmit={handleRejectSubmit} className="space-y-3 pt-2 border-t border-slate-50">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-700 mb-1">
            <X className="w-4 h-4" />
            <span>Permintaan Revisi Pengajuan</span>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Catatan / Alasan Revisi (Wajib)</label>
            <div className="relative">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tuliskan catatan revisi secara rinci agar dipahami oleh pemohon..."
                rows={3}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                required
              />
              <MessageSquare className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAction(null)}
              className="w-1/3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Kembali
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-2/3 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 disabled:bg-slate-300 transition-all cursor-pointer"
            >
              {isSubmitting ? 'Memproses...' : 'Kirim Permintaan Revisi'}
            </button>
          </div>
        </form>
      )}

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
