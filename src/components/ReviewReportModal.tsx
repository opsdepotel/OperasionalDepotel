/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BudgetRequest, UsageReportItem, Role, ItemStatus, RequestStatus, UserActivity } from '../types';
import {
  Shield, Check, X, AlertCircle, Info, ExternalLink,
  MessageSquare, Send, CheckCircle2, AlertTriangle, HelpCircle, Eye,
  Compass, ClipboardList, MapPin
} from 'lucide-react';

// Helper to parse coordinate string and calculate Haversine distance
function parseCoords(coordStr: string): { lat: number; lng: number } | null {
  if (!coordStr) return null;
  const clean = coordStr.replace(/[()\[\]]/g, '').trim();
  const parts = clean.split(/[\s,]+/);
  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }
  return null;
}

function getDistanceInMeters(coordStr1: string, coordStr2: string): number | null {
  const c1 = parseCoords(coordStr1);
  const c2 = parseCoords(coordStr2);
  if (!c1 || !c2) return null;

  const R = 6371e3; // Earth radius in meters
  const phi1 = (c1.lat * Math.PI) / 180;
  const phi2 = (c2.lat * Math.PI) / 180;
  const deltaPhi = ((c2.lat - c1.lat) * Math.PI) / 180;
  const deltaLambda = ((c2.lng - c1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

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
  activities?: UserActivity[];
}

export const ReviewReportModal: React.FC<ReviewReportModalProps> = ({
  request,
  requesterName,
  items,
  role,
  onSubmitReview,
  onClose,
  onPreviewDocument,
  activities = []
}) => {
  // Filter items for this request
  const currentItems = items.filter(item => item.requestId === request.id);

  // Track review decisions locally before submitting
  // Format: { [itemId]: { status: ItemStatus, comment: string } }
  const [decisions, setDecisions] = useState<Record<string, { status: ItemStatus; comment: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewingActivityItem, setViewingActivityItem] = useState<{ item: UsageReportItem; date: string } | null>(null);

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

              {/* Buttons as a single bar under the status bar for both ADMIN and MANAGER */}
              <div className="flex gap-2">
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
                  className="flex-1 py-1.5 bg-indigo-55/10 hover:bg-indigo-55/20 text-indigo-700 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer border border-indigo-150"
                  style={{ backgroundColor: 'rgba(99, 102, 241, 0.08)', borderColor: 'rgba(99, 102, 241, 0.15)' }}
                >
                  <span>Bukti</span>
                  <Eye className="w-3.5 h-3.5 text-indigo-600" />
                </button>

                <button
                  type="button"
                  onClick={() => setViewingActivityItem({ item, date: item.tanggalPenggunaan })}
                  className="flex-1 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer border border-slate-200"
                  title="Lihat Aktivitas Lapangan User"
                >
                  <span>Aktivitas</span>
                  <Compass className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>

              {/* Reviewer Action selectors */}
              <div className="space-y-2 pt-2 border-t border-slate-50">
                {request.status === RequestStatus.CLOSED ? (
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase">Keputusan Admin (Selesai/Closed)</span>
                    <div className="mt-1 flex flex-col gap-1">
                      <div className={`text-xs font-bold px-3 py-1.5 rounded-lg border w-fit flex items-center gap-1.5 ${
                        item.statusAdmin === ItemStatus.APPROVED 
                          ? 'text-emerald-600 bg-emerald-50/50 border-emerald-100' 
                          : item.statusAdmin === ItemStatus.REJECTED 
                            ? 'text-red-600 bg-red-50/50 border-red-100'
                            : 'text-slate-600 bg-slate-50/50 border-slate-100'
                      }`}>
                        {item.statusAdmin === ItemStatus.APPROVED ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Disetujui</span>
                          </>
                        ) : item.statusAdmin === ItemStatus.REJECTED ? (
                          <>
                            <X className="w-3.5 h-3.5 text-red-500" />
                            <span>Revisi</span>
                          </>
                        ) : (
                          <span>Belum Ditentukan</span>
                        )}
                      </div>
                      {item.adminComment && (
                        <p className="text-[10px] text-slate-500 italic mt-0.5">"{item.adminComment}"</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit Decision Button */}
      {request.status !== RequestStatus.CLOSED && (
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
        >
          <Send className="w-4 h-4" />
          <span>{isSubmitting ? 'Mengirim Keputusan...' : 'Kirim Seluruh Keputusan Review'}</span>
        </button>
      )}

      {/* Activities Popup Modal */}
      {viewingActivityItem && (
        <div className="fixed inset-0 bg-slate-900/75 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-lg w-full shadow-2xl border border-slate-200 flex flex-col max-h-[85vh] animate-scale-up">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-display font-bold text-slate-800 text-sm">Aktivitas Lapangan Pemohon</h3>
                <p className="text-[10px] text-slate-500 font-medium">
                  User: <span className="font-bold text-slate-700">{requesterName || request.userEmail}</span> | Tanggal: <span className="font-semibold text-indigo-600">{viewingActivityItem.date}</span>
                </p>
              </div>
            </div>

            {/* Modal Content - List of Activities */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
              {(() => {
                const matchedActivities = (activities || []).filter(
                  act =>
                    act.userEmail.toLowerCase() === request.userEmail.toLowerCase() &&
                    act.tanggal === viewingActivityItem.date
                );

                if (matchedActivities.length === 0) {
                  return (
                    <div className="text-center py-8 text-slate-400 space-y-2">
                      <ClipboardList className="w-10 h-10 mx-auto text-slate-300" />
                      <p className="text-xs font-medium">Tidak ada aktivitas lapangan yang tercatat untuk tanggal {viewingActivityItem.date}.</p>
                    </div>
                  );
                }

                return matchedActivities.map((act, i) => (
                  <div key={act.id || i} className="border border-slate-150 rounded-2xl p-4 bg-slate-50/50 space-y-3 shadow-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="inline-block bg-indigo-50 text-indigo-700 text-[9px] font-bold px-2 py-0.5 rounded-full mb-1">
                          SITE: {act.siteId}
                        </span>
                        <h4 className="text-xs font-bold text-slate-800 leading-snug">{act.siteName}</h4>
                      </div>

                      {act.buktiUrl && (
                        <button
                          onClick={() => {
                            const displayUrl = act.buktiFileId?.trim()
                              ? `https://drive.google.com/thumbnail?sz=w1000&id=${act.buktiFileId.trim()}`
                              : act.buktiUrl;
                            
                            if (onPreviewDocument) {
                              onPreviewDocument({
                                url: act.buktiUrl,
                                fileId: act.buktiFileId,
                                title: `Foto Kegiatan Site: ${act.siteId}`
                              });
                            } else {
                              window.open(displayUrl, '_blank');
                            }
                          }}
                          className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer shrink-0 shadow-sm"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Lihat Foto</span>
                        </button>
                      )}
                    </div>

                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">KETERANGAN</span>
                      <p className="text-xs text-slate-600 font-normal leading-relaxed whitespace-pre-wrap bg-white p-2.5 rounded-xl border border-slate-100">
                        {act.keterangan || '-'}
                      </p>
                    </div>

                    {(act.coordinatesActual || act.coordinatesDb) && (
                      <div className="space-y-1.5 text-[10px] text-slate-500 font-mono bg-indigo-50/40 p-2.5 rounded-xl border border-indigo-100/30">
                        {(() => {
                          const siteIdLabel = act.siteId || 'SiteID';
                          const gmapsUrl = act.coordinatesDb && act.coordinatesActual
                            ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(act.coordinatesDb.trim())}&destination=${encodeURIComponent(act.coordinatesActual.trim())}`
                            : act.coordinatesActual
                              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.coordinatesActual.trim())}`
                              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.coordinatesDb.trim())}`;

                          return (
                            <>
                              {act.coordinatesActual && (
                                <div className="flex items-center gap-1.5">
                                  <Compass className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                  <span className="font-bold text-slate-700 font-sans">Aktual:</span>
                                  <a
                                    href={gmapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 hover:underline font-bold"
                                  >
                                    {act.coordinatesActual}
                                  </a>
                                </div>
                              )}
                              {act.coordinatesDb && (
                                <div className="flex items-center gap-1.5">
                                  <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                  <span className="font-bold text-slate-700 font-sans">{siteIdLabel}:</span>
                                  <a
                                    href={gmapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 hover:underline font-bold"
                                  >
                                    {act.coordinatesDb}
                                  </a>
                                </div>
                              )}
                            </>
                          );
                        })()}
                        {(() => {
                          const dist = getDistanceInMeters(act.coordinatesDb, act.coordinatesActual);
                          if (dist === null) return null;
                          const isWarning = dist > 500;
                          return (
                            <div className="space-y-1.5 pt-1.5 border-t border-indigo-100/30">
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-block w-2 h-2 rounded-full ${isWarning ? 'bg-rose-500' : 'bg-emerald-500'} animate-pulse`}></span>
                                <span className="font-bold text-slate-700">Jarak ke DB:</span>
                                <span className={`font-bold px-1.5 py-0.5 rounded-md ${isWarning ? 'text-rose-600 bg-rose-50' : 'text-indigo-600 bg-indigo-50/50'}`}>
                                  {Math.round(dist).toLocaleString('id-ID')} meter
                                </span>
                              </div>
                              {isWarning && (
                                <div className="mt-1.5 p-2 bg-rose-50 border border-rose-100 rounded-xl text-[9px] font-bold text-rose-600 flex items-start gap-1 leading-relaxed">
                                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                                  <span>Jarak aktual melebihi 500 meter dari data koordinat site. Ada indikasi aktivitas tidak dilakukan di tempat yang sesuai.</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setViewingActivityItem(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                Kembali
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
