/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useBackHandler } from '../hooks/useBackHandler';
import { UsageReportItem, ItemReviewHistory, Role } from '../types';
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

  // Filter histories for this specific item
  const itemHistories = histories
    .filter(h => h.itemUid === item.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); // Newest first

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

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-scale-up">
        {/* Modal Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                Riwayat Approval & Revisi Item
              </h3>
              <p className="text-[11px] text-slate-300 font-mono mt-0.5">
                ID Item: {item.id} | Request: {item.requestId}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer"
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
                onClick={() => {
                  if (onPreviewDocument) {
                    onPreviewDocument({ url: item.buktiUrl, fileId: item.buktiFileId, title: `Nota: ${item.keterangan}` });
                  } else {
                    window.open(item.buktiUrl, '_blank');
                  }
                }}
                className="text-indigo-600 hover:underline flex items-center gap-1 font-semibold"
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
                    <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {getActionBadge(log)}
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-100 px-1.5 py-0.5 rounded">
                            {log.actorRole}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs font-bold text-slate-800 mt-1">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>{log.actorNama || log.actorEmail}</span>
                          <span className="text-[10px] text-slate-400 font-normal">({log.actorEmail})</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0 font-mono">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{log.timestamp}</span>
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
                              if (onPreviewDocument) {
                                onPreviewDocument({ url: log.buktiUrl!, fileId: log.buktiFileId, title: `Nota (Snapshot): ${log.keterangan}` });
                              } else {
                                window.open(log.buktiUrl, '_blank');
                              }
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
    </div>
  );
};
