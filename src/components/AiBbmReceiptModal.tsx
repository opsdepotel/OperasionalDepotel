/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from '../hooks/useBackHandler';
import { BudgetRequest, UsageReportItem } from '../types';
import { AiBbmReceiptResult } from '../lib/aiBbmReceipt';
import {
  Sparkles,
  X,
  CheckCircle2,
  AlertTriangle,
  FileQuestion,
  RefreshCw,
  Fuel,
  Receipt,
  Calendar,
  Clock,
  MapPin,
  Car,
  DollarSign,
  ShieldCheck,
  ExternalLink,
  Info
} from 'lucide-react';
import { ZoomableImage } from './ZoomableImage';

interface AiBbmReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: BudgetRequest | null;
  usageItem?: UsageReportItem | null;
  photoUrl: string | null;
  fileId?: string | null;
  result: AiBbmReceiptResult | null;
  isAnalyzing: boolean;
  error: string | null;
  onReanalyze: () => void;
}

export const AiBbmReceiptModal: React.FC<AiBbmReceiptModalProps> = ({
  isOpen,
  onClose,
  request,
  usageItem,
  photoUrl,
  fileId,
  result,
  isAnalyzing,
  error,
  onReanalyze,
}) => {
  useBackHandler(isOpen, onClose, 'aiBbmReceiptModal');

  if (!isOpen || !request) return null;

  const formatIDR = (num?: number | null) => {
    if (num === undefined || num === null || isNaN(num)) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(num);
  };

  const nominalInputVal = usageItem?.nominal || request.jumlahPengajuan || 0;

  return createPortal(
    <div className="fixed inset-0 z-[1000000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div
        className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh] animate-scale-up my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-600 via-amber-700 to-amber-900 text-white flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-amber-200 shrink-0 shadow-inner">
              <Sparkles className="w-5 h-5 text-amber-200" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold text-sm sm:text-base text-white tracking-tight">
                  Cek AI Nota BBM Duren Sawit
                </h3>
                <span className="px-2 py-0.5 bg-amber-400/20 border border-amber-300/40 text-amber-100 rounded-full text-[10px] font-bold tracking-wide uppercase">
                  ADMINISTRATOR ONLY
                </span>
              </div>
              <p className="text-xs text-amber-100/90 mt-0.5 truncate">
                Otomatisasi OCR & Verifikasi Kesesuaian Nominal Nota vs Input Sistem
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all cursor-pointer shrink-0 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info Sub-bar */}
        <div className="bg-amber-50/80 border-b border-amber-100/80 px-4 sm:px-5 py-2.5 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-700 font-medium">
            <span className="font-mono font-bold text-amber-800 px-2 py-0.5 bg-amber-100/80 rounded-md text-[11px]">
              {request.id}
            </span>
            <span>Pengisi: <strong className="text-slate-900">{request.userEmail}</strong></span>
          </div>
          <div className="text-slate-500 text-[11px] font-medium">
            Tanggal: {request.tanggalPemakaian}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 bg-slate-50/50">
          {/* Loading State */}
          {isAnalyzing && (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-8 text-center space-y-4 shadow-sm my-2">
              <div className="relative w-14 h-14 mx-auto flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-amber-100 border-t-amber-500 animate-spin" />
                <Fuel className="w-6 h-6 text-amber-600 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-800 text-sm">
                  Sedang Menganalisis Nota BBM Duren Sawit...
                </h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  AI Gemini sedang melakukan OCR tingkat tinggi pada foto nota untuk mengekstrak nominal rupiah, jenis BBM, dan detail liter.
                </p>
              </div>
            </div>
          )}

          {/* Error State */}
          {!isAnalyzing && error && (
            <div className="bg-rose-50 border border-rose-200/90 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-rose-900 text-xs sm:text-sm">
                    Gagal Menganalisis Nota BBM
                  </h4>
                  <p className="text-xs text-rose-700 leading-relaxed mt-1">
                    {error}
                  </p>
                </div>
              </div>
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onReanalyze}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Coba Lagi Analisis AI</span>
                </button>
              </div>
            </div>
          )}

          {/* Analysis Result State */}
          {!isAnalyzing && result && (
            <div className="space-y-4">
              {/* Top Comparison Header Card */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Hasil Perbandingan Nominal (AI OCR vs System)
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                  {/* System Input */}
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-center">
                    <span className="text-[10px] font-bold text-slate-500 block uppercase">
                      Nominal Input System
                    </span>
                    <span className="text-sm sm:text-base font-black font-display text-slate-900 block mt-0.5">
                      {formatIDR(result.nominalInput || nominalInputVal)}
                    </span>
                  </div>

                  {/* Status Match Indicator */}
                  <div className="text-center py-1">
                    {result.statusKesesuaian === 'SESUAI' ? (
                      <div className="inline-flex flex-col items-center">
                        <span className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-xs">
                          <CheckCircle2 className="w-6 h-6" />
                        </span>
                        <span className="text-[11px] font-extrabold text-emerald-700 mt-1 uppercase tracking-wide">
                          SESUAI 100%
                        </span>
                      </div>
                    ) : result.statusKesesuaian === 'TIDAK_SESUAI' ? (
                      <div className="inline-flex flex-col items-center">
                        <span className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shadow-xs">
                          <AlertTriangle className="w-6 h-6" />
                        </span>
                        <span className="text-[11px] font-extrabold text-rose-700 mt-1 uppercase tracking-wide">
                          BEDA NOMINAL
                        </span>
                        {result.selisih !== 0 && (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md mt-0.5">
                            Selisih: {formatIDR(Math.abs(result.selisih))}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="inline-flex flex-col items-center">
                        <span className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shadow-xs">
                          <FileQuestion className="w-6 h-6" />
                        </span>
                        <span className="text-[11px] font-extrabold text-amber-700 mt-1 uppercase tracking-wide">
                          TIDAK TERBACA
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Receipt OCR Output */}
                  <div className={`border rounded-xl p-3 text-center ${
                    result.statusKesesuaian === 'SESUAI'
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : result.statusKesesuaian === 'TIDAK_SESUAI'
                        ? 'bg-rose-50/70 border-rose-200'
                        : 'bg-amber-50/70 border-amber-200'
                  }`}>
                    <span className="text-[10px] font-bold text-slate-500 block uppercase">
                      Nominal Pada Nota (AI OCR)
                    </span>
                    <span className={`text-sm sm:text-base font-black font-display block mt-0.5 ${
                      result.statusKesesuaian === 'SESUAI'
                        ? 'text-emerald-700'
                        : result.statusKesesuaian === 'TIDAK_SESUAI'
                          ? 'text-rose-700'
                          : 'text-amber-800'
                    }`}>
                      {result.nominalNota > 0 ? formatIDR(result.nominalNota) : 'Tidak Terbaca'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Status Message Banner */}
              <div className={`p-3.5 rounded-2xl border flex items-start gap-2.5 text-xs ${
                result.statusKesesuaian === 'SESUAI'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : result.statusKesesuaian === 'TIDAK_SESUAI'
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5 min-w-0">
                  <p className="font-bold">{result.ringkasan}</p>
                  <p className="text-[11px] leading-relaxed opacity-90">{result.catatanAnalisis}</p>
                </div>
              </div>

              {/* Extracted Details Breakdown Grid */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-2xs">
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                  <Receipt className="w-4 h-4 text-amber-600" />
                  <span>Detail Rincian Nota BBM</span>
                </h4>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Jenis BBM</span>
                    <span className="font-bold text-slate-800 block mt-0.5 truncate">
                      {result.jenisBbm || 'Tidak Tertera'}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Jumlah Liter</span>
                    <span className="font-bold text-slate-800 block mt-0.5 truncate">
                      {result.jumlahLiter || 'Tidak Tertera'}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Harga per Liter</span>
                    <span className="font-bold text-slate-800 block mt-0.5 truncate">
                      {result.hargaPerLiter || 'Tidak Tertera'}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">SPBU / Lokasi</span>
                    <span className="font-bold text-slate-800 block mt-0.5 truncate" title={result.namaSpbu}>
                      {result.namaSpbu || 'BBM Duren Sawit'}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Tanggal & Waktu</span>
                    <span className="font-bold text-slate-800 block mt-0.5 truncate">
                      {result.tanggalNota || '-'} {result.waktuNota ? `(${result.waktuNota})` : ''}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Plat Nomor Nota</span>
                    <span className="font-bold text-slate-800 block mt-0.5 truncate">
                      {result.platNomorNota || 'Tidak Tertera'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Photo Preview Card */}
              {photoUrl && (
                <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-2xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Fuel className="w-3.5 h-3.5 text-amber-600" />
                      <span>Foto Nota yang Diperiksa</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {result.checkedAt ? new Date(result.checkedAt).toLocaleTimeString('id-ID') : ''}
                    </span>
                  </div>
                  <div className="bg-slate-900 rounded-xl overflow-hidden p-2 flex justify-center">
                    <ZoomableImage
                      src={photoUrl}
                      alt="Foto Nota BBM Duren Sawit"
                      darkTheme={true}
                      maxHeightClass="max-h-[35vh]"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/90 flex items-center justify-between flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={onReanalyze}
            disabled={isAnalyzing}
            className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin text-amber-600' : ''}`} />
            <span>Pindai Ulang AI</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-xs transition-all shadow-sm cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
