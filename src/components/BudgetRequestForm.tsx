/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BudgetRequest, RequestStatus, SiteInfo } from '../types';
import { Plus, Calendar, MapPin, Coins, FileText, AlertCircle, Sparkles, ExternalLink } from 'lucide-react';

interface BudgetRequestFormProps {
  userEmail: string;
  managerEmail: string;
  defaultSiteId: string;
  onSubmit: (req: BudgetRequest) => Promise<void>;
  onClose: () => void;
  initialIsTalangan?: boolean;
  sites?: SiteInfo[];
}

export const BudgetRequestForm: React.FC<BudgetRequestFormProps> = ({
  userEmail,
  managerEmail,
  defaultSiteId,
  onSubmit,
  onClose,
  initialIsTalangan = false,
  sites = []
}) => {
  const [isTalangan, setIsTalangan] = useState(initialIsTalangan);
  const [tanggalPemakaian, setTanggalPemakaian] = useState(() => {
    // Default to today
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [siteId, setSiteId] = useState(defaultSiteId || '');
  const [jumlahPengajuan, setJumlahPengajuan] = useState<string>('');
  const [keterangan, setKeterangan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Extract and match site IDs. Format is "XXXNNN" (3 letters, 3 digits)
  const siteIdRegex = /[A-Za-z]{3}\d{3}/g;
  const regexMatches = siteId.match(siteIdRegex) || [];
  const uniqueMatches = Array.from(new Set(regexMatches.map(m => m.toUpperCase())));
  
  // If user typed something but it doesn't match the format yet, fall back to single string
  const parsedIds = uniqueMatches.length > 0 ? uniqueMatches : (siteId.trim() ? [siteId.trim().toUpperCase()] : []);
  const isMultiple = parsedIds.length > 1;

  // Map each parsed ID to its matching site in the database
  const siteResults = parsedIds.map(id => {
    const found = sites.find(s => s.siteId.toUpperCase().trim() === id);
    return {
      id,
      found: !!found,
      siteName: found ? found.siteName : null,
      coordinates: found ? found.coordinates : null
    };
  });

  const someFound = siteResults.some(r => r.found);

  // Helper to generate a clean UID
  const generateUID = () => {
    const todayStr = tanggalPemakaian.replace(/-/g, '');
    const randomHex = Math.floor(1000 + Math.random() * 9000); // 4-digit numeric code
    const prefix = isTalangan ? 'OPT' : 'OP';
    return `${prefix}-${todayStr}-${randomHex}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let amount = 0;
    if (!isTalangan) {
      amount = Number(jumlahPengajuan);
      if (isNaN(amount) || amount <= 0) {
        setError('Jumlah Pengajuan anggaran harus lebih besar dari Rp 0.');
        return;
      }
    }

    if (!siteId.trim()) {
      setError('Site ID / Lokasi wajib diisi.');
      return;
    }
    if (!keterangan.trim()) {
      setError(isTalangan ? 'Keterangan Pelaporan wajib diisi.' : 'Keterangan Pengajuan wajib diisi.');
      return;
    }

    setIsSubmitting(true);
    try {
      const uid = generateUID();
      const newRequest: BudgetRequest = {
        id: uid,
        userEmail,
        managerEmail,
        tanggalPemakaian,
        siteId: siteId.toUpperCase().trim(),
        jumlahPengajuan: amount,
        keterangan: isTalangan ? `[DANA TALANGAN] ${keterangan.trim()}` : keterangan.trim(),
        status: isTalangan ? RequestStatus.TRANSFERRED : RequestStatus.PENDING_APPROVAL,
        managerActionAmount: 0,
        managerComment: '',
        adminActionAmount: 0,
        createdAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      };
      await onSubmit(newRequest);
    } catch (err: any) {
      setError(err.message || 'Gagal mengirimkan pengajuan anggaran.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-lg p-5 animate-slide-up">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-50">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-sm">
            {isTalangan ? 'Lapor Dana Talangan Pribadi' : 'Ajukan Anggaran Baru'}
          </h2>
          <p className="text-[10px] text-slate-400">
            {isTalangan ? 'Pelaporan penggunaan dana taktis talangan pribadi' : 'Pengajuan dana taktis / operasional'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50"
        >
          Batal
        </button>
      </div>

      {/* Segmented Control for Request Type */}
      <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl mb-4">
        <button
          type="button"
          onClick={() => {
            setIsTalangan(false);
            setError(null);
          }}
          className={`py-1.5 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${
            !isTalangan
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Pengajuan Anggaran
        </button>
        <button
          type="button"
          onClick={() => {
            setIsTalangan(true);
            setError(null);
          }}
          className={`py-1.5 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${
            isTalangan
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Dana Talangan Pribadi
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Manager target info */}
        <div className="bg-blue-50/50 border border-blue-100 text-blue-700 rounded-xl p-3 text-xs">
          <p className="font-semibold">Reviewer Persetujuan Laporan:</p>
          <p className="font-medium text-[10px] text-slate-500 mt-1">
            Laporan/Pengajuan ini otomatis dialokasikan ke manager Anda: <span className="font-bold text-blue-600">{managerEmail}</span>
          </p>
        </div>

        {/* Date Field */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            {isTalangan ? 'Tanggal Penggunaan Dana' : 'Tanggal Pemakaian'}
          </label>
          <div className="relative">
            <input
              type="date"
              value={tanggalPemakaian}
              onChange={(e) => setTanggalPemakaian(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
              required
            />
            <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>
        </div>

        {/* Site ID / Lokasi */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Site ID / Lokasi Pemakaian</label>
          <div className="relative">
            <input
              type="text"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value.toUpperCase())}
              placeholder="SITE-A"
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
              required
            />
            <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          {/* Site ID Detail Match Info */}
          {parsedIds.length > 0 && (
            isMultiple ? (
              someFound ? (
                <div className="mt-1.5 p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl space-y-1.5 animate-slide-up">
                  <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-800">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                    <span>Site Terverifikasi (Multiple)</span>
                  </div>
                  <div className="space-y-1 ml-2.5">
                    {siteResults.map((res, idx) => (
                      <div key={idx} className="text-[10px] flex flex-wrap gap-x-1 items-baseline">
                        <span className="font-mono font-bold text-slate-600">{res.id}:</span>
                        {res.found ? (
                          <span className="text-emerald-700 font-medium">{res.siteName}</span>
                        ) : (
                          <span className="text-rose-500 italic text-[9px] font-semibold">Tidak ditemukan/tidak terdaftar</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-rose-500 font-semibold mt-1.5 ml-1 animate-pulse">
                  * Site ID tidak ditemukan/tidak terdaftar
                </p>
              )
            ) : (
              siteResults[0]?.found ? (
                <div className="mt-1.5 p-2 bg-emerald-50 border border-emerald-100 rounded-xl space-y-0.5 animate-slide-up">
                  <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-800">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                    <span>Site Terverifikasi</span>
                  </div>
                  <p className="text-[10px] font-semibold text-slate-700 ml-2.5">
                    Nama: <span className="text-emerald-700">{siteResults[0].siteName}</span>
                  </p>
                  {siteResults[0].coordinates && (
                    <p className="text-[9px] text-slate-500 font-mono ml-2.5 flex items-center gap-1">
                      Koord:{" "}
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(siteResults[0].coordinates.trim())}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline inline-flex items-center gap-0.5 transition-colors"
                        title="Buka di Google Maps"
                      >
                        <span>{siteResults[0].coordinates}</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </p>
                  )}
                </div>
              ) : (
                siteId.trim() && (
                  <p className="text-[10px] text-rose-500 font-semibold mt-1.5 ml-1 animate-pulse">
                    * Site ID tidak ditemukan/tidak terdaftar
                  </p>
                )
              )
            )
          )}
        </div>

        {/* Jumlah Pengajuan atau Info Dana Talangan */}
        {!isTalangan ? (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Jumlah Pengajuan (Rupiah)</label>
            <div className="relative">
              <input
                type="number"
                value={jumlahPengajuan}
                onChange={(e) => setJumlahPengajuan(e.target.value)}
                placeholder="contoh: 1500000"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                required
              />
              <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
            {jumlahPengajuan && !isNaN(Number(jumlahPengajuan)) && (
              <p className="text-[10px] text-indigo-600 font-semibold mt-1">
                Setara dengan: {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(jumlahPengajuan))}
              </p>
            )}
          </div>
        ) : (
          <div className="bg-indigo-50/50 border border-indigo-100 text-indigo-700 rounded-xl p-3.5 text-xs space-y-1">
            <p className="font-semibold flex items-center gap-1.5 text-[11px]">
              <Coins className="w-4 h-4 text-indigo-500" />
              <span>Sistem Dana Talangan Pribadi</span>
            </p>
            <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
              Sistem ini untuk melaporkan pengeluaran tanpa mengajukan dana di awal. Nilai pengeluaran aktual dihitung dari nota-nota bukti pemakaian yang Anda tambahkan setelah form laporan ini dibuat, yang nantinya dihitung sebagai pengurang saldo operasional Anda.
            </p>
          </div>
        )}

        {/* Keterangan */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            {isTalangan ? 'Keterangan Kegiatan / Tujuan' : 'Keterangan / Tujuan Pemakaian'}
          </label>
          <div className="relative">
            <textarea
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder={isTalangan ? "Sebutkan rincian kegiatan / peruntukan talangan dana (misal: Pembelian genset darurat di lapangan)" : "Sebutkan rincian kebutuhan dana (misal: Pembelian solar generator site, akomodasi tim lapangan)"}
              rows={3}
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
              required
            />
            <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          <span>
            {isSubmitting 
              ? (isTalangan ? 'Membuat Laporan...' : 'Mengirim Pengajuan...') 
              : (isTalangan ? 'Buat Laporan Dana Talangan' : 'Kirim Pengajuan Anggaran')}
          </span>
        </button>
      </form>
    </div>
  );
};
