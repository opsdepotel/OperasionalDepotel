/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from '../hooks/useBackHandler';
import { UsageReportItem, ItemReviewHistory, Role } from '../types';
import { ZoomableImage } from './ZoomableImage';
import {
  X, History, CheckCircle2, AlertTriangle, Edit3, PlusCircle,
  FileText, Calendar, Coins, User, ArrowLeft, ExternalLink, Clock, MessageSquare, ShieldCheck
} from 'lucide-react';

interface ItemHistoryModalProps {
  item: UsageReportItem;
  histories: ItemReviewHistory[];
  onClose: () => void;
  onPreviewDocument?: (doc: { url: string; fileId?: string; title?: string }) => void;
}

export const ItemHistoryModal: React.FC<ItemHistoryModalProps> = ({
  item,
  histories,
  onClose,
  onPreviewDocument
}) => {
  useBackHandler(true, onClose, 'itemHistoryModal');

  const [previewDoc, setPreviewDoc] = useState<{ url: string; fileId?: string; title: string } | null>(null);
  useBackHandler(!!previewDoc, () => setPreviewDoc(null), 'itemHistory_previewDoc');

  // Helper to robustly parse various date formats into milliseconds
  const parseTimestampToMs = (tsStr?: string): number => {
    if (!tsStr) return 0;

    // 1. If standard ISO or valid date string
    const directDate = new Date(tsStr).getTime();
    if (!isNaN(directDate)) return directDate;

    // 2. Handle YYYY-MM-DD HH:mm:ss
    if (/^\d{4}-\d{2}-\d{2}/.test(tsStr)) {
      const formatted = tsStr.replace(' ', 'T');
      const d = new Date(formatted).getTime();
      if (!isNaN(d)) return d;
    }

    // 3. Handle DD/MM/YYYY or D/M/YYYY, HH.mm.ss or HH:mm:ss (id-ID locale string)
    const match = tsStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2})[\.:](\d{1,2})(?:[\.:](\d{1,2}))?)?/);
    if (match) {
      const [, day, month, year, hour = '0', min = '0', sec = '0'] = match;
      const d = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        parseInt(day, 10),
        parseInt(hour, 10),
        parseInt(min, 10),
        parseInt(sec, 10)
      ).getTime();
      if (!isNaN(d)) return d;
    }

    return 0;
  };

  // Filter histories for this specific item or request and sort by newest timestamp first
  const itemHistories = histories
    .filter(h => h.itemUid === item.id || h.requestUid === item.id)
    .sort((a, b) => {
      const timeA = parseTimestampToMs(a.timestamp);
      const timeB = parseTimestampToMs(b.timestamp);
      if (timeB !== timeA) {
        return timeB - timeA; // Newest first
      }
      return (b.id || '').localeCompare(a.id || '');
    });

  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(num || 0);
  };

  const getActionBadge = (history: ItemReviewHistory) => {
    switch (history.actionType) {
      case 'APPROVAL_MANAGER':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Disetujui Manager</span>
          </span>
        );
      case 'APPROVAL_FINANCE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            <span>Disetujui Finance</span>
          </span>
        );
      case 'REVISI_MANAGER':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <AlertTriangle className="w-3 h-3 text-amber-600" />
            <span>Minta Revisi Manager</span>
          </span>
        );
      case 'REVISI_FINANCE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-200">
            <AlertTriangle className="w-3 h-3 text-red-600" />
            <span>Minta Revisi Finance</span>
          </span>
        );
      case 'PERBAIKAN_USER':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <Edit3 className="w-3 h-3 text-blue-600" />
            <span>Perbaikan oleh User</span>
          </span>
        );
      case 'PENGAJUAN_CREATED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
            <PlusCircle className="w-3 h-3 text-indigo-600" />
            <span>Pengajuan Anggaran Dibuat</span>
          </span>
        );
      case 'PENGAJUAN_REVISED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <Edit3 className="w-3 h-3 text-blue-600" />
            <span>Revisi Pengajuan Dikirim</span>
          </span>
        );
      case 'ITEM_CREATED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
            <PlusCircle className="w-3 h-3 text-indigo-600" />
            <span>Item Laporan Dibuat</span>
          </span>
        );
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] my-auto flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-scale-up">
        {/* Modal Header */}
        <div className="p-4 bg-gradient-to-r from-indigo-700 via-indigo-800 to-indigo-900 text-white flex items-center justify-between shrink-0 shadow-sm border-b border-indigo-600/30">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/15 text-white rounded-xl border border-white/20 shadow-xs">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                Riwayat Approval & Revisi Item
              </h3>
              <p className="text-[11px] text-indigo-100 font-mono mt-0.5">
                ID Item: {item.id} | Request: {item.requestId}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/15 text-indigo-100 hover:text-white rounded-xl transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Item Summary Box */}
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 text-xs space-y-1.5 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-800 text-xs truncate">{item.keterangan || 'Tanpa keterangan'}</span>
            <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 font-mono text-xs shrink-0">
              {formatIDR(item.nominal)}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3 text-slate-400" />
              <span>Tanggal: {item.tanggalPenggunaan}</span>
            </span>
            {item.buktiUrl && (
              <button
                type="button"
                onClick={() => {
                  const doc = { url: item.buktiUrl, fileId: item.buktiFileId, title: `Nota: ${item.keterangan || 'Terkini'}` };
                  setPreviewDoc(doc);
                }}
                className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
              >
                <FileText className="w-3 h-3" />
                <span>Lihat Nota Terkini</span>
              </button>
            )}
          </div>
        </div>

        {/* Timeline Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {itemHistories.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs space-y-2">
              <History className="w-8 h-8 mx-auto text-slate-300" />
              <p className="font-semibold text-slate-600">Belum ada riwayat approval/revisi yang tercatat untuk item ini.</p>
              <p className="text-[11px]">Riwayat keputusan Manager, Finance, maupun perbaikan User akan muncul di sini berdasarkan urutan waktu.</p>
            </div>
          ) : (
            <div className="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {itemHistories.map((log, index) => (
                <div key={log.id || index} className="relative group">
                  {/* Timeline bullet dot */}
                  <div className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full border-2 bg-white ${
                    log.actionType.includes('APPROVAL')
                      ? 'border-emerald-500 bg-emerald-500'
                      : log.actionType.includes('REVISI')
                      ? 'border-amber-500 bg-amber-500'
                      : log.actionType === 'PERBAIKAN_USER'
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-indigo-500 bg-indigo-500'
                  }`} />

                  {/* Card item history */}
                  <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs hover:border-slate-300 transition-all space-y-2">
                    {/* Header line */}
                    <div className="border-b border-slate-100 pb-2.5 space-y-2">
                      {/* ActionType */}
                      <div>
                        {getActionBadge(log)}
                      </div>

                      {/* Timestamp & ActorNama (Sejajar Vertical, Rata Kiri) */}
                      <div className="flex flex-col items-start gap-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{log.timestamp}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{log.actorNama || log.actorEmail}</span>
                        </div>
                      </div>
                    </div>

                    {/* Catatan / Comments */}
                    {log.catatan && (
                      <div className="bg-slate-50 border border-slate-150 p-2 rounded-lg text-xs space-y-0.5">
                        <div className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-indigo-500" />
                          <span>Catatan / Alasan:</span>
                        </div>
                        <p className="text-slate-700 font-medium leading-relaxed italic">
                          "{log.catatan}"
                        </p>
                      </div>
                    )}

                    {/* Snapshot values for user repair or creation */}
                    <div className="bg-slate-50/60 p-2.5 rounded-lg border border-slate-100 text-[11px] space-y-1">
                      <div className="font-bold text-slate-500 uppercase text-[9px] tracking-wider mb-1">
                        Snapshot Data Item pada Waktu Ini:
                      </div>
                      <div className="grid grid-cols-2 gap-2 font-medium">
                        <div>
                          <span className="text-slate-400 block text-[10px]">Tanggal Penggunaan:</span>
                          <span className="text-slate-700 font-semibold">{log.tanggalPenggunaan || '-'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block text-[10px]">Nominal Item:</span>
                          <span className="text-indigo-700 font-bold font-mono">{formatIDR(log.nominal)}</span>
                        </div>
                      </div>

                      {log.keterangan && (
                        <div className="pt-1">
                          <span className="text-slate-400 block text-[10px]">Keterangan Item:</span>
                          <span className="text-slate-700 block">{log.keterangan}</span>
                        </div>
                      )}

                      {log.buktiUrl && (
                        <div className="pt-1 flex items-center justify-between">
                          <span className="text-slate-400 text-[10px]">Bukti Nota Attachment:</span>
                          <button
                            type="button"
                            onClick={() => {
                              const doc = { url: log.buktiUrl!, fileId: log.buktiFileId, title: `Nota (Snapshot): ${log.keterangan || 'Bukti'}` };
                              setPreviewDoc(doc);
                            }}
                            className="text-indigo-600 hover:text-indigo-800 font-bold text-[10px] flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs transition-all cursor-pointer"
                          >
                            <FileText className="w-3 h-3" />
                            <span>Lihat Nota Snapshot</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="py-1.5 px-4 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Internal Nota Preview Popup Modal (Layered on top of ItemHistoryModal) */}
      {previewDoc && createPortal(
        <div
          className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-[100000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewDoc(null);
          }}
        >
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-5 space-y-4 animate-scale-up relative border border-slate-100 flex flex-col max-h-[90vh] my-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-widest">PREVIEW NOTA / ATTACHMENT</h3>
                <h4 className="text-sm font-bold text-slate-800 mt-0.5">{previewDoc.title}</h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-all cursor-pointer border border-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Document/Image display area */}
            <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden flex flex-col items-center justify-center min-h-[350px] relative p-2">
              {previewDoc.fileId ? (
                <ZoomableImage
                  src={`https://drive.google.com/thumbnail?sz=w1000&id=${previewDoc.fileId}`}
                  alt="Pratinjau Nota"
                  maxHeightClass="max-h-[50vh]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = document.getElementById('history-preview-fallback');
                    if (fallback) fallback.classList.remove('hidden');
                  }}
                />
              ) : previewDoc.url ? (
                <ZoomableImage
                  src={previewDoc.url}
                  alt="Pratinjau Nota"
                  maxHeightClass="max-h-[50vh]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = document.getElementById('history-preview-fallback');
                    if (fallback) fallback.classList.remove('hidden');
                  }}
                />
              ) : null}

              {/* Fallback block */}
              <div
                id="history-preview-fallback"
                className={`flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-3 ${previewDoc.fileId || previewDoc.url ? 'hidden absolute inset-0 bg-slate-50 flex' : ''}`}
              >
                <FileText className="w-12 h-12 text-slate-300" />
                <p className="text-xs font-bold text-slate-700">Dokumen Nota Terbuka</p>
                <p className="text-[10px] text-slate-400 max-w-[280px]">Pratinjau langsung tidak dapat ditampilkan. Silakan klik tombol di bawah untuk membuka dokumen asli.</p>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-100 flex gap-3">
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all cursor-pointer text-center"
              >
                Tutup Preview
              </button>
              {previewDoc.url && (
                <a
                  href={previewDoc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-indigo-100 text-center"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Buka Dokumen Asli</span>
                </a>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>,
    document.body
  );
};
