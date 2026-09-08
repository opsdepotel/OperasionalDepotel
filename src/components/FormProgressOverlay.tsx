/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

export interface FormProgressOverlayProps {
  isOpen: boolean;
  title?: string;
  step?: string;
  isSuccess?: boolean;
  activeStage?: 'upload' | 'save' | 'sync' | 'done';
  error?: string | null;
  className?: string;
  isFixed?: boolean;
}

/**
 * Helper to produce a very concise single-word or two-word status label
 */
function getShortStatus(step?: string, title?: string, isSuccess?: boolean): string {
  if (isSuccess) return 'Selesai';
  const text = (step || title || '').toLowerCase();
  if (!text) return 'Memproses...';

  if (text.includes('berhasil') || text.includes('selesai')) return 'Selesai';
  if (text.includes('unggah') || text.includes('upload') || text.includes('foto') || text.includes('kamera')) return 'Mengunggah...';
  if (text.includes('sinkron') || text.includes('sync')) return 'Sinkronisasi...';
  if (text.includes('perbarui') || text.includes('refresh') || text.includes('memperbarui')) return 'Memperbarui...';
  if (text.includes('kredensial') || text.includes('menghubungkan') || text.includes('koneksi')) return 'Menghubungkan...';
  if (text.includes('database') || text.includes('mencari') || text.includes('membuat') || text.includes('menyiapkan') || text.includes('aplikasi') || text.includes('folder')) return 'Menyiapkan...';
  if (text.includes('transfer')) return 'Mentransfer...';
  if (text.includes('revisi')) return 'Mengirim...';
  if (text.includes('hapus')) return 'Menghapus...';
  if (text.includes('batal')) return 'Membatalkan...';
  if (text.includes('simpan') || text.includes('review')) return 'Menyimpan...';

  const clean = (step || title || '').replace(/\.{2,}$/, '').trim();
  if (clean.length > 0 && clean.length <= 16) {
    return `${clean}...`;
  }

  return 'Memproses...';
}

export const FormProgressOverlay: React.FC<FormProgressOverlayProps> = ({
  isOpen,
  title = 'Memproses Data',
  step = 'Menyimpan data...',
  isSuccess = false,
  className = '',
  isFixed = false
}) => {
  if (!isOpen) return null;

  const shortStatus = getShortStatus(step, title, isSuccess);

  const basePosition = isFixed
    ? 'fixed inset-0 z-[9999]'
    : 'absolute inset-0 z-50 rounded-2xl sm:rounded-3xl';

  return (
    <div
      id="unified-form-progress-overlay"
      className={`${basePosition} bg-slate-900/10 backdrop-blur-[1px] flex flex-col items-center justify-center p-4 text-center animate-in fade-in duration-100 pointer-events-auto ${className}`}
    >
      {/* Floating Card Hampir Full Transparan di Tengah */}
      <div className="bg-white/40 backdrop-blur-xs border border-white/60 shadow-xs rounded-2xl px-5 py-3.5 flex flex-col items-center justify-center gap-2 animate-in zoom-in-95 duration-100 min-w-[120px]">
        {/* Komponen 1: Spinner / Check Icon */}
        {isSuccess ? (
          <CheckCircle2 className="w-7 h-7 text-emerald-600 animate-in zoom-in-75 duration-150" />
        ) : (
          <Loader2 className="w-7 h-7 animate-spin text-indigo-600" />
        )}

        {/* Komponen 2: Label Status Tahapan Singkat */}
        <span className="text-xs font-semibold text-slate-800 tracking-tight select-none whitespace-nowrap">
          {shortStatus}
        </span>
      </div>
    </div>
  );
};

