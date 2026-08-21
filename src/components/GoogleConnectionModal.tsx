/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  AlertTriangle, 
  RefreshCw, 
  CheckCircle2, 
  X, 
  Link2Off, 
  ShieldCheck,
  Zap
} from 'lucide-react';

interface GoogleConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRenewToken: () => Promise<void> | void;
  isLoading: boolean;
  errorMessage?: string | null;
  userEmail?: string | null;
}

export const GoogleConnectionModal: React.FC<GoogleConnectionModalProps> = ({
  isOpen,
  onClose,
  onRenewToken,
  isLoading,
  errorMessage,
  userEmail
}) => {
  const [isSuccess, setIsSuccess] = useState(false);

  const handleConnectClick = async () => {
    try {
      await onRenewToken();
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        onClose();
      }, 1200);
    } catch (e) {
      setIsSuccess(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      id="google-connection-status-modal"
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[10000] flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div 
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-amber-200/80 overflow-hidden animate-scale-up relative flex flex-col max-h-[92vh]"
      >
        {/* Top Highlight Accent Bar */}
        <div className="h-2 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 w-full shrink-0" />

        {/* Modal Header */}
        <div className="p-5 sm:p-6 pb-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shadow-sm shrink-0">
              <Link2Off className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-display font-black text-slate-900 leading-tight">
                  Status Koneksi Google
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-300">
                  Terputus / Expired
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Pemberitahuan Otentikasi Akun & Layanan Google
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
            title="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
          {/* Success Notification Alert */}
          {isSuccess && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl p-4 text-xs flex items-center gap-3 animate-slide-up shadow-sm">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-emerald-950 text-xs sm:text-sm">Koneksi Google Berhasil Terhubung!</p>
                <p className="text-[11px] text-emerald-700 mt-0.5">Sesi telah diperbarui. Melanjutkan aplikasi...</p>
              </div>
            </div>
          )}

          {/* Warning Card */}
          <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 text-xs space-y-2.5">
            <div className="flex items-start gap-2.5 text-amber-900">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-amber-950 text-xs sm:text-sm">
                  Sesi Autentikasi Google Telah Berakhir
                </p>
                <p className="text-[11.5px] text-amber-800 leading-relaxed font-normal">
                  Kebijakan keamanan token Google berlaku selama 60 menit.
                </p>
              </div>
            </div>

            {/* Safe Data Guarantee Pill */}
            <div className="bg-white/90 border border-amber-200/80 rounded-xl p-2.5 flex items-center gap-2 text-slate-700">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <p className="text-[11px] text-slate-600 leading-tight">
                Formulir, input, dan layar kerja yang sedang Anda buka <strong>tidak akan hilang</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer / 1-Click Action */}
        <div className="p-5 sm:p-6 pt-3 bg-slate-50 border-t border-slate-100 flex flex-col gap-2.5">
          <button
            type="button"
            id="btn-one-click-google-connect"
            onClick={handleConnectClick}
            disabled={isLoading || isSuccess}
            className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-600 via-orange-600 to-amber-600 hover:from-amber-700 hover:to-orange-700 active:scale-[0.99] disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm rounded-2xl flex items-center justify-center gap-2.5 shadow-lg shadow-orange-500/20 transition-all cursor-pointer"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Menghubungkan Sesi Google...</span>
              </>
            ) : isSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>Tersambung!</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-amber-200 text-amber-200" />
                <span>Perbarui Sesi Google</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
