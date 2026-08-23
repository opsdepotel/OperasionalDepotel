import React, { useState, useEffect } from 'react';
import { BudgetRequest, RequestStatus, Role, UserProfile } from '../types';
import { SharedReceiptRecord, deleteSharedReceipt } from '../lib/sharedReceiptStorage';
import { ZoomableImage } from './ZoomableImage';
import {
  Share2,
  FileCheck,
  AlertCircle,
  Sparkles,
  Search,
  CheckCircle2,
  ArrowRight,
  ShieldAlert,
  Loader2,
  X,
  Calendar,
  Coins,
  Building2,
  User,
  FileText,
  RotateCcw
} from 'lucide-react';

export interface OcrReceiptData {
  tanggalTransaksi: string;
  nominalTransaksi: number;
  catatan: string;
  namaTujuan: string;
  bankPenerima?: string;
  noReferensi?: string;
}

interface FinanceSharedReceiptModalProps {
  activeRole: Role;
  sharedRecord: SharedReceiptRecord;
  requests: BudgetRequest[];
  profiles?: UserProfile[];
  onSelectCandidate: (candidate: BudgetRequest, file: File, ocrData: OcrReceiptData) => void;
  onSwitchToFinanceRole?: () => void;
  onClose: () => void;
}

export const FinanceSharedReceiptModal: React.FC<FinanceSharedReceiptModalProps> = ({
  activeRole,
  sharedRecord,
  requests,
  profiles = [],
  onSelectCandidate,
  onSwitchToFinanceRole,
  onClose,
}) => {
  const isFinance = activeRole === Role.FINANCE;

  // OCR state
  const [isOcrLoading, setIsOcrLoading] = useState<boolean>(true);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrData, setOcrData] = useState<OcrReceiptData | null>(null);

  // Search filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string>('');

  // Convert Blob to Image URL
  useEffect(() => {
    let url = '';
    if (sharedRecord?.blob) {
      url = URL.createObjectURL(sharedRecord.blob);
      setImageUrl(url);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [sharedRecord]);

  // Perform OCR call on mount if role is Finance
  useEffect(() => {
    if (!isFinance || !sharedRecord?.blob) return;

    let isMounted = true;
    const performOcr = async () => {
      setIsOcrLoading(true);
      setOcrError(null);

      try {
        // Convert Blob to Base64
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
        });
        reader.readAsDataURL(sharedRecord.blob);
        const imageBase64 = await base64Promise;

        const response = await fetch('/api/ai/ocr-transfer-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64 }),
        });

        const resData = await response.json();
        if (!isMounted) return;

        if (resData.success && resData.data) {
          setOcrData({
            tanggalTransaksi: resData.data.tanggalTransaksi || new Date().toISOString().split('T')[0],
            nominalTransaksi: Number(resData.data.nominalTransaksi) || 0,
            catatan: String(resData.data.catatan || ''),
            namaTujuan: String(resData.data.namaTujuan || ''),
            bankPenerima: String(resData.data.bankPenerima || ''),
            noReferensi: String(resData.data.noReferensi || ''),
          });
        } else {
          setOcrError(resData.error || 'Gagal mengekstrak data dari resi transfer.');
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Error executing OCR for shared receipt:', err);
        setOcrError(err.message || 'Terjadi kesalahan jaringan/server saat membaca resi dengan AI.');
      } finally {
        if (isMounted) setIsOcrLoading(false);
      }
    };

    performOcr();

    return () => {
      isMounted = false;
    };
  }, [isFinance, sharedRecord]);

  // Format currency helper
  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(num);
  };

  // Helper to calculate match score
  const getCandidateMatchScore = (req: BudgetRequest) => {
    if (!ocrData) return 0;
    let score = 0;

    // 1. Nominal Transaksi Match (Highest Weight)
    const reqAmt = req.id.startsWith('OPT-') || req.tipePengajuan === 'DANA_TALANGAN' ? 0 : req.managerActionAmount;
    if (ocrData.nominalTransaksi > 0 && reqAmt > 0) {
      if (reqAmt === ocrData.nominalTransaksi) {
        score += 100; // Exact match
      } else {
        const diffPercent = Math.abs(reqAmt - ocrData.nominalTransaksi) / reqAmt;
        if (diffPercent <= 0.02) {
          score += 70; // Very close
        } else if (diffPercent <= 0.05) {
          score += 40;
        }
      }
    }

    // 2. Nama Tujuan Match (Second Weight)
    if (ocrData.namaTujuan.trim()) {
      const ocrName = ocrData.namaTujuan.toLowerCase();
      const reqEmail = req.userEmail.toLowerCase();
      const profile = profiles.find((p) => p.email.toLowerCase() === reqEmail);
      const profName = profile?.name?.toLowerCase() || '';

      if (profName && (ocrName.includes(profName) || profName.includes(ocrName))) {
        score += 35;
      } else if (reqEmail && ocrName.includes(reqEmail.split('@')[0])) {
        score += 25;
      }
    }

    // 3. Catatan Match (Third Weight)
    if (ocrData.catatan.trim()) {
      const ocrNote = ocrData.catatan.toLowerCase();
      const reqKet = req.keterangan.toLowerCase();
      const reqId = req.id.toLowerCase();
      const siteId = req.siteId.toLowerCase();

      if (ocrNote.includes(reqId) || reqId.includes(ocrNote)) {
        score += 30;
      } else if (ocrNote.includes(siteId) || siteId.includes(ocrNote)) {
        score += 15;
      } else if (reqKet && (ocrNote.includes(reqKet) || reqKet.includes(ocrNote))) {
        score += 15;
      }
    }

    return score;
  };

  // Filter "Menunggu Transfer" pending requests
  const pendingTransferRequests = requests.filter((r) => {
    const isPendingTransfer =
      r.status === RequestStatus.APPROVED ||
      r.status === RequestStatus.PARTIALLY_APPROVED ||
      r.status === RequestStatus.PENDING_TALANGAN_TRANSFER;
    return isPendingTransfer;
  });

  // Rank candidate requests by match score
  const rankedCandidates = [...pendingTransferRequests].sort((a, b) => {
    const scoreA = getCandidateMatchScore(a);
    const scoreB = getCandidateMatchScore(b);
    return scoreB - scoreA;
  });

  // Apply search query filter
  const filteredCandidates = rankedCandidates.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const reqName = profiles.find((p) => p.email.toLowerCase() === r.userEmail.toLowerCase())?.name?.toLowerCase() || '';
    return (
      r.id.toLowerCase().includes(q) ||
      r.siteId.toLowerCase().includes(q) ||
      r.userEmail.toLowerCase().includes(q) ||
      reqName.includes(q) ||
      r.keterangan.toLowerCase().includes(q) ||
      String(r.managerActionAmount).includes(q)
    );
  });

  const handleSelect = (req: BudgetRequest) => {
    const file = new File([sharedRecord.blob], sharedRecord.fileName, {
      type: sharedRecord.mimeType || 'image/jpeg',
    });
    const finalOcr = ocrData || {
      tanggalTransaksi: new Date().toISOString().split('T')[0],
      nominalTransaksi: req.managerActionAmount || 0,
      catatan: '',
      namaTujuan: '',
    };
    onSelectCandidate(req, file, finalOcr);
  };

  const handleDiscard = async () => {
    await deleteSharedReceipt(sharedRecord.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shrink-0">
              <Share2 className="w-5 h-5 text-blue-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-base sm:text-lg text-white">
                  Bukti Transfer Baru Diterima (Share)
                </h3>
                <span className="bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                  PWA Share Target
                </span>
              </div>
              <p className="text-xs text-blue-100">Khusus Role Finance - Otomasi OCR & Pencocokan Transaksi</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Restricted Role Warning */}
          {!isFinance ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 space-y-3">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-sm text-amber-900">Akses Terbatas untuk Role Finance</h4>
                  <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                    Bukti transfer dari aplikasi perbankan baru saja diterima. Namun, fitur pencocokan dan konfirmasi transfer ini khusus diperuntukkan bagi <strong>Role Finance</strong>.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-200/80">
                {onSwitchToFinanceRole && (
                  <button
                    onClick={onSwitchToFinanceRole}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Beralih ke Role Finance</span>
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="bg-white text-amber-800 border border-amber-300 hover:bg-amber-100/50 text-xs font-bold px-3.5 py-2 rounded-xl transition-colors cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Image Preview & OCR Data Panel */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                {/* Image Preview */}
                <div className="sm:col-span-5 flex flex-col items-center justify-center bg-slate-900 rounded-lg p-2 overflow-hidden relative min-h-[160px]">
                  {imageUrl ? (
                    <ZoomableImage
                      src={imageUrl}
                      alt="Bukti Transfer Share"
                      className="max-h-44 object-contain rounded-md"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">Gambar tidak tersedia</span>
                  )}
                  <span className="text-[10px] text-slate-300 font-mono mt-1.5 bg-black/40 px-2 py-0.5 rounded-md">
                    {sharedRecord.fileName}
                  </span>
                </div>

                {/* OCR Results Panel */}
                <div className="sm:col-span-7 flex flex-col justify-between space-y-2">
                  <div>
                    <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-indigo-600" />
                        <span>Hasil OCR AI Bukti Transfer</span>
                      </span>
                      {isOcrLoading && (
                        <span className="text-[10px] text-indigo-600 font-semibold flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded-full">
                          <Loader2 className="w-3 h-3 animate-spin text-indigo-600" />
                          <span>Proses OCR...</span>
                        </span>
                      )}
                    </div>

                    {isOcrLoading ? (
                      <div className="py-6 text-center space-y-2">
                        <Loader2 className="w-7 h-7 animate-spin text-indigo-600 mx-auto" />
                        <p className="text-xs text-slate-600 font-medium">
                          Menganalisis resi (Nominal, Tanggal, Tujuan, Catatan)...
                        </p>
                      </div>
                    ) : ocrError ? (
                      <div className="bg-red-50 border border-red-100 rounded-lg p-2.5 mt-2 text-xs text-red-700 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">Gagal OCR Otomatis</p>
                          <p className="text-[11px] text-red-600">{ocrError}</p>
                          <p className="text-[10px] text-slate-500 mt-1">
                            Anda tetap dapat memilih transaksi secara manual dari daftar di bawah.
                          </p>
                        </div>
                      </div>
                    ) : ocrData ? (
                      <div className="space-y-1.5 pt-2 text-xs">
                        <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200">
                          <span className="text-slate-500 text-[11px] flex items-center gap-1">
                            <Coins className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Nominal</span>
                          </span>
                          <span className="font-bold text-emerald-600 text-sm">
                            {formatIDR(ocrData.nominalTransaksi)}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="bg-white p-1.5 rounded-lg border border-slate-200">
                            <span className="text-slate-400 text-[10px] block font-semibold flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-indigo-500" />
                              <span>Tanggal</span>
                            </span>
                            <span className="font-semibold text-slate-800 text-[11px]">
                              {ocrData.tanggalTransaksi || '-'}
                            </span>
                          </div>

                          <div className="bg-white p-1.5 rounded-lg border border-slate-200">
                            <span className="text-slate-400 text-[10px] block font-semibold flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-indigo-500" />
                              <span>Bank / Ref</span>
                            </span>
                            <span className="font-semibold text-slate-800 text-[11px] truncate block">
                              {ocrData.bankPenerima || ocrData.noReferensi || 'Bank'}
                            </span>
                          </div>
                        </div>

                        {ocrData.namaTujuan && (
                          <div className="bg-white p-1.5 rounded-lg border border-slate-200">
                            <span className="text-slate-400 text-[10px] block font-semibold">Nama Tujuan / Rekening</span>
                            <span className="font-semibold text-slate-800 text-[11px] block truncate">
                              {ocrData.namaTujuan}
                            </span>
                          </div>
                        )}

                        {ocrData.catatan && (
                          <div className="bg-white p-1.5 rounded-lg border border-slate-200">
                            <span className="text-slate-400 text-[10px] block font-semibold">Catatan Resi</span>
                            <span className="text-slate-700 text-[11px] italic block truncate">
                              "{ocrData.catatan}"
                            </span>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <button
                    onClick={handleDiscard}
                    className="text-[11px] text-red-600 hover:text-red-800 font-bold hover:underline self-end pt-1 cursor-pointer"
                  >
                    Hapus File Share Ini
                  </button>
                </div>
              </div>

              {/* Transaction Candidates Section */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                      <FileCheck className="w-4 h-4 text-indigo-600" />
                      <span>Daftar Transaksi Menunggu Transfer</span>
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Diurutkan berdasarkan tingkat kesesuaian Nominal $\rightarrow$ Nama Tujuan $\rightarrow$ Catatan
                    </p>
                  </div>

                  {/* Search input */}
                  <div className="relative w-full sm:w-56">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari UID / Site / Pemohon..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all outline-none"
                    />
                  </div>
                </div>

                {/* Candidate list */}
                {pendingTransferRequests.length === 0 ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center text-slate-500 space-y-2">
                    <AlertCircle className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="font-bold text-xs text-slate-700">Tidak ada transaksi yang berstatus Menunggu Transfer saat ini.</p>
                    <p className="text-[11px]">Semua transaksi pengajuan dana telah diproses atau belum disetujui Manager.</p>
                  </div>
                ) : filteredCandidates.length === 0 ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-center text-slate-500 text-xs">
                    Pencarian "{searchQuery}" tidak ditemukan pada daftar transaksi menunggu transfer.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1">
                    {filteredCandidates.map((req, idx) => {
                      const matchScore = getCandidateMatchScore(req);
                      const isTopMatch = idx === 0 && matchScore >= 40 && !searchQuery.trim();
                      const reqProfile = profiles.find((p) => p.email.toLowerCase() === req.userEmail.toLowerCase());
                      const reqName = reqProfile?.name || req.userEmail;

                      const isTalangan = req.id.startsWith('OPT-') || req.tipePengajuan === 'DANA_TALANGAN';

                      return (
                        <div
                          key={req.id}
                          className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                            isTopMatch
                              ? 'bg-emerald-50/80 border-emerald-300 shadow-xs ring-1 ring-emerald-400/30'
                              : 'bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20'
                          }`}
                        >
                          <div className="space-y-1.5 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                {req.id}
                              </span>
                              <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                                {req.siteId}
                              </span>
                              {isTopMatch && (
                                <span className="bg-emerald-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-2xs">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Rekomendasi Utama (Cocok)</span>
                                </span>
                              )}
                              {isTalangan && (
                                <span className="bg-pink-100 text-pink-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                  Dana Talangan
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-[10px] text-slate-400 block font-semibold">Pemohon</span>
                                <span className="font-semibold text-slate-800">{reqName}</span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 block font-semibold">Disetujui Manager</span>
                                <span className="font-bold text-emerald-600">
                                  {formatIDR(req.managerActionAmount)}
                                </span>
                              </div>
                            </div>

                            {req.keterangan && (
                              <p className="text-[11px] text-slate-600 line-clamp-1 italic bg-slate-50/80 p-1.5 rounded-md border border-slate-100">
                                "{req.keterangan}"
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleSelect(req)}
                            className={`px-3.5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all shrink-0 cursor-pointer ${
                              isTopMatch
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100'
                            }`}
                          >
                            <span>Pilih & Lanjut Transfer</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
