/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { BudgetRequest, RequestStatus, SiteInfo, UsageReportItem, UserProfile, ItemStatus } from '../types';
import { parseNumericValue } from '../lib/googleApi';
import {
  Plus, Calendar, MapPin, Coins, FileText, AlertCircle, Sparkles,
  Camera, UploadCloud, X, Image as ImageIcon, AlertTriangle, ShieldCheck, CheckCircle2
} from 'lucide-react';

interface BudgetRequestFormProps {
  userEmail: string;
  managerEmail: string;
  defaultSiteId: string;
  onSubmit: (req: BudgetRequest, firstItem?: UsageReportItem, itemFile?: File | null) => Promise<void>;
  onClose: () => void;
  initialIsTalangan?: boolean;
  sites?: SiteInfo[];
  initialRequest?: BudgetRequest;
  userProfile?: UserProfile;
}

export const BudgetRequestForm: React.FC<BudgetRequestFormProps> = ({
  userEmail,
  managerEmail,
  defaultSiteId,
  onSubmit,
  onClose,
  initialIsTalangan = false,
  sites = [],
  initialRequest,
  userProfile
}) => {
  const [isTalangan, setIsTalangan] = useState(() => {
    if (initialRequest) {
      return initialRequest.id.startsWith('OPT-') || initialRequest.keterangan.startsWith('[DANA TALANGAN]');
    }
    return initialIsTalangan;
  });

  const [tanggalPemakaian, setTanggalPemakaian] = useState(() => {
    if (initialRequest?.tanggalPemakaian) return initialRequest.tanggalPemakaian;
    const d = new Date();
    return d.toISOString().split('T')[0];
  });

  const [siteId, setSiteId] = useState(() => initialRequest?.siteId || defaultSiteId || '');
  const [jumlahPengajuan, setJumlahPengajuan] = useState<string>(() => 
    initialRequest?.jumlahPengajuan ? String(initialRequest.jumlahPengajuan) : ''
  );
  const [keterangan, setKeterangan] = useState(() => 
    initialRequest?.keterangan ? initialRequest.keterangan : ''
  );

  // States for Dana Talangan Item Pertama
  const [itemTanggal, setItemTanggal] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [itemNominal, setItemNominal] = useState<string>('');
  const [itemKeterangan, setItemKeterangan] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Popup Modal Alert when User submits without Talangan Item
  const [showItemPromptModal, setShowItemPromptModal] = useState<boolean>(false);
  const [missingItemReason, setMissingItemReason] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const itemSectionRef = useRef<HTMLDivElement>(null);

  const isMobileUser = userProfile?.mobile === true ||
    String(userProfile?.mobile).trim().toUpperCase() === 'TRUE' ||
    String(userProfile?.mobile).trim().toUpperCase() === 'YA' ||
    String(userProfile?.mobile).trim() === '1';

  // Format IDR Currency
  const formatIDR = (num: any) => {
    const val = parseNumericValue(num);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val);
  };

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // Extract and match site IDs. Format is "XXXNNN" (3 letters, 3 digits)
  const siteIdRegex = /[A-Za-z]{3}\d{3}/g;
  const regexMatches = siteId.match(siteIdRegex) || [];
  const uniqueMatches = Array.from(new Set(regexMatches.map(m => m.toUpperCase())));
  
  const parsedIds = uniqueMatches.length > 0 ? uniqueMatches : (siteId.trim() ? [siteId.trim().toUpperCase()] : []);
  const isMultiple = parsedIds.length > 1;

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
    const randomHex = Math.floor(1000 + Math.random() * 9000);
    const prefix = isTalangan ? 'OPT' : 'OP';
    return `${prefix}-${todayStr}-${randomHex}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!siteId.trim()) {
      setError('Site ID / Lokasi wajib diisi.');
      return;
    }
    if (!keterangan.trim()) {
      setError(isTalangan ? 'Keterangan Kegiatan wajib diisi.' : 'Keterangan Pengajuan wajib diisi.');
      return;
    }

    // Validation for Dana Talangan: MUST HAVE FIRST ITEM
    let talanganAmount = 0;
    let firstItem: UsageReportItem | undefined = undefined;

    if (isTalangan && !initialRequest) {
      const parsedItemAmount = parseNumericValue(itemNominal);
      const hasNominal = parsedItemAmount > 0;
      const hasKeterangan = !!itemKeterangan.trim();
      const hasProof = !!selectedFile;

      if (!hasNominal || !hasKeterangan || !hasProof) {
        let reasons: string[] = [];
        if (!hasNominal) reasons.push('Nominal pengeluaran (> Rp 0)');
        if (!hasKeterangan) reasons.push('Keterangan / Uraian nota');
        if (!hasProof) reasons.push('Foto bukti nota / kuitansi pembayaran');

        setMissingItemReason(`Harap lengkapi: ${reasons.join(', ')}.`);
        setShowItemPromptModal(true);
        return;
      }

      talanganAmount = parsedItemAmount;
    }

    let finalAmount = 0;
    if (!isTalangan) {
      finalAmount = parseNumericValue(jumlahPengajuan);
      if (finalAmount <= 0) {
        setError('Jumlah Pengajuan anggaran harus lebih besar dari Rp 0.');
        return;
      }
    } else {
      finalAmount = initialRequest ? parseNumericValue(jumlahPengajuan) : talanganAmount;
    }

    setIsSubmitting(true);
    try {
      const uid = initialRequest ? initialRequest.id : generateUID();
      const newRequest: BudgetRequest = {
        id: uid,
        userEmail: initialRequest ? initialRequest.userEmail : userEmail,
        managerEmail: initialRequest ? initialRequest.managerEmail : managerEmail,
        tanggalPemakaian,
        siteId: siteId.toUpperCase().trim(),
        jumlahPengajuan: finalAmount,
        keterangan: isTalangan 
          ? (keterangan.trim().startsWith('[DANA TALANGAN]') ? keterangan.trim() : `[DANA TALANGAN] ${keterangan.trim()}`)
          : keterangan.trim(),
        status: isTalangan ? RequestStatus.REPORTING : RequestStatus.PENDING_APPROVAL,
        managerActionAmount: 0,
        managerComment: '',
        adminActionAmount: 0,
        createdAt: initialRequest?.createdAt || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      };

      if (isTalangan && !initialRequest && selectedFile) {
        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        firstItem = {
          id: `ITEM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
          requestId: uid,
          tanggalPenggunaan: itemTanggal,
          nominal: talanganAmount,
          keterangan: itemKeterangan.trim(),
          buktiUrl: '',
          buktiFileId: '',
          statusManager: ItemStatus.PENDING,
          managerComment: '',
          statusAdmin: ItemStatus.PENDING,
          adminComment: '',
          updatedAt: timestamp,
          timestamp: timestamp
        };
      }

      await onSubmit(newRequest, firstItem, selectedFile);
    } catch (err: any) {
      setError(err.message || 'Gagal mengirimkan pengajuan anggaran.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-lg p-5 animate-slide-up relative">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-50">
        <div>
          <h2 className="font-display font-bold text-slate-800 text-sm">
            {initialRequest 
              ? 'Revisi Pengajuan Anggaran' 
              : (isTalangan ? 'Lapor Dana Talangan Pribadi' : 'Pengajuan Anggaran Baru')}
          </h2>
          <p className="text-[10px] text-slate-400">
            {initialRequest
              ? `Perbaiki rincian pengajuan untuk UID ${initialRequest.id}`
              : (isTalangan ? 'Pengajuan Dana Talangan disimpan bersama item nota pertama' : 'Pengajuan dana operasional')}
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
      {!initialRequest && (
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
      )}

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
            Laporan/Pengajuan ini otomatis dialokasikan ke atasan langsung Anda: <span className="font-bold text-blue-600">{managerEmail}</span>
          </p>
        </div>

        {/* 1. INFORMASI UMUM PENGAJUAN */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-[10px]">1</span>
            <span>Informasi Kegiatan & Lokasi</span>
          </h3>

          {/* Date Field */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {isTalangan ? 'Tanggal Kegiatan / Talangan' : 'Tanggal Pemakaian'}
            </label>
            <div className="relative">
              <input
                type="date"
                value={tanggalPemakaian}
                onChange={(e) => {
                  setTanggalPemakaian(e.target.value);
                  if (isTalangan && !itemTanggal) {
                    setItemTanggal(e.target.value);
                  }
                }}
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
                placeholder="Site ID / lokasi (contoh: JKT123)"
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
                      {siteResults.filter(r => r.found).map((res, idx) => (
                        <div key={idx} className="text-[10px] flex flex-wrap gap-x-1 items-baseline">
                          <span className="font-mono font-bold text-slate-600">{res.id}:</span>
                          <span className="text-emerald-700 font-medium">{res.siteName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null
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
                  </div>
                ) : null
              )
            )}
          </div>

          {/* Keterangan Umum */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {isTalangan ? 'Keterangan Umum Kegiatan / Tujuan Talangan' : 'Keterangan / Tujuan Pemakaian'}
            </label>
            <div className="relative">
              <textarea
                value={keterangan}
                onChange={(e) => setKeterangan(e.target.value)}
                placeholder="Jelaskan kebutuhan kegiatan atau operasional di lapangan"
                rows={2}
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                required
              />
              <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>
        </div>

        {/* 2. JUMLAH PENGAJUAN (STANDAR) ATAU ITEM PERTAMA (DANA TALANGAN) */}
        {!isTalangan ? (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Jumlah Pengajuan (Rupiah)</label>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={jumlahPengajuan}
                onChange={(e) => setJumlahPengajuan(e.target.value.replace(/\D/g, ''))}
                placeholder="contoh: 1500000"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                required
              />
              <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
            {jumlahPengajuan && parseNumericValue(jumlahPengajuan) > 0 && (
              <p className="text-[10px] text-indigo-600 font-semibold mt-1">
                Setara dengan: {formatIDR(jumlahPengajuan)}
              </p>
            )}
          </div>
        ) : !initialRequest && (
          <div ref={itemSectionRef} className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-[10px]">2</span>
                <span>Rincian Item Pertama Dana Talangan (Wajib)</span>
              </h3>
            </div>

            <div className="bg-emerald-50/50 border border-emerald-100 text-emerald-800 rounded-xl p-3 text-[10px] leading-relaxed">
              <p className="font-bold flex items-center gap-1 text-[11px] text-emerald-900 mb-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Item Dana Talangan</span>
              </p>
              Dana Talangan harus memiliki minimal satu item.  Masukkan item pertama Dana Talangan, untuk item-item selanjutnya dapat ditambahkan melalui Penambahan Item Dana Talangan.
            </div>

            {/* Tanggal Nota */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Tanggal Nota / Kuitansi</label>
              <div className="relative">
                <input
                  type="date"
                  value={itemTanggal}
                  onChange={(e) => setItemTanggal(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                  required
                />
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Nominal Item */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Nominal Item Pengeluaran (Rupiah) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={itemNominal}
                  onChange={(e) => setItemNominal(e.target.value.replace(/\D/g, ''))}
                  placeholder="contoh: 150000"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none font-semibold text-slate-800"
                />
                <Coins className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
              {itemNominal && parseNumericValue(itemNominal) > 0 && (
                <p className="text-[10px] text-emerald-700 font-bold mt-1">
                  Nominal Dana Talangan: {formatIDR(itemNominal)}
                </p>
              )}
            </div>

            {/* Keterangan Rincian Nota */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Keterangan / Rincian Nota <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={itemKeterangan}
                  onChange={(e) => setItemKeterangan(e.target.value)}
                  placeholder="contoh: Pembelian bensin genset 15 liter di SPBU"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                />
                <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Upload Bukti Nota / Foto */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Foto Bukti Nota / Kuitansi <span className="text-rose-500">*</span>
              </label>

              {/* Hidden file inputs */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />
              <input
                type="file"
                ref={cameraInputRef}
                onChange={handleFileChange}
                accept="image/*"
                capture="environment"
                className="hidden"
              />

              {previewUrl && selectedFile ? (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-3 animate-fade-in">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-200 border border-slate-300 shrink-0">
                      <img
                        src={previewUrl}
                        alt="Preview Nota"
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{selectedFile.name}</p>
                      <p className="text-[10px] text-slate-400">{(selectedFile.size / 1024).toFixed(0)} KB • Siap Diunggah</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveFile}
                    className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition-colors"
                    title="Hapus foto"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="py-3 px-3 border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/40 hover:bg-indigo-50 rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all text-indigo-700 cursor-pointer"
                  >
                    <Camera className="w-5 h-5 text-indigo-600" />
                    <span className="text-[11px] font-bold">Kamera HP (Native)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="py-3 px-3 border-2 border-dashed border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all text-slate-600 cursor-pointer"
                  >
                    <UploadCloud className="w-5 h-5 text-slate-500" />
                    <span className="text-[11px] font-bold">Galeri / File</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          <span>
            {isSubmitting 
              ? 'Menyimpan Pengajuan Dana Talangan...' 
              : (initialRequest
                  ? 'Kirim Revisi Pengajuan'
                  : (isTalangan ? 'Simpan Pengajuan Dana Talangan' : 'Kirim Pengajuan Anggaran'))}
          </span>
        </button>
      </form>

      {/* POPUP MODAL: WARNING JIKA ITEM DANA TALANGAN BELUM DITAMBAHKAN */}
      {showItemPromptModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl border border-slate-100 p-6 flex flex-col items-center text-center animate-scale-up space-y-4 my-auto">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 border border-amber-200 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div>
              <h3 className="font-display font-bold text-slate-800 text-base">
                Item Dana Talangan Wajib Diisi
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Pengajuan Dana Talangan tidak dapat disimpan dengan nilai <strong>Rp 0</strong>. Database Pengajuan dan Laporan disimpan bersama item pertama pengeluaran.
              </p>
              {missingItemReason && (
                <div className="mt-2.5 p-2.5 bg-rose-50 border border-rose-100 rounded-xl text-[11px] font-semibold text-rose-700 text-left">
                  {missingItemReason}
                </div>
              )}
            </div>

            <div className="w-full pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowItemPromptModal(false);
                  if (itemSectionRef.current) {
                    itemSectionRef.current.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-100 transition-all cursor-pointer"
              >
                Lengkapi Item Dana Talangan Sekarang
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

