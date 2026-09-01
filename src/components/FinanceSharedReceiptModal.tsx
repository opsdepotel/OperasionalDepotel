import React, { useState, useEffect, useRef } from 'react';
import { BudgetRequest, RequestStatus, Role, UserProfile, ItemReviewHistory, UsageReportItem, ItemStatus } from '../types';
import { SharedReceiptRecord, deleteSharedReceipt, clearAllSharedReceipts } from '../lib/sharedReceiptStorage';
import { ZoomableImage } from './ZoomableImage';
import { formatDivisiSubDivisi } from '../lib/googleApi';
import { getTransferBertahap, isPendingTransferRequest, getFinanceApprovedAmount, isFinanceApprovedOpRequest } from '../App';
import {
  Share2,
  FileCheck,
  AlertCircle,
  Search,
  ArrowRight,
  ShieldAlert,
  X,
  User,
  UploadCloud
} from 'lucide-react';

interface FinanceSharedReceiptModalProps {
  activeRole: Role;
  sharedRecord: SharedReceiptRecord;
  requests: BudgetRequest[];
  histories?: ItemReviewHistory[];
  usageItems?: UsageReportItem[];
  profiles?: UserProfile[];
  onSelectCandidate: (candidate: BudgetRequest, file: File) => void;
  onSwitchToFinanceRole?: () => void;
  onClose: () => void;
}

export const FinanceSharedReceiptModal: React.FC<FinanceSharedReceiptModalProps> = ({
  activeRole,
  sharedRecord,
  requests,
  histories = [],
  usageItems = [],
  profiles = [],
  onSelectCandidate,
  onSwitchToFinanceRole,
  onClose,
}) => {
  const isFinance = activeRole === Role.FINANCE;

  const [currentBlob, setCurrentBlob] = useState<Blob | null>(sharedRecord?.blob || null);
  const [currentFileName, setCurrentFileName] = useState<string>(sharedRecord?.fileName || 'bukti_transfer.jpg');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sharedRecord?.blob) {
      setCurrentBlob(sharedRecord.blob);
      setCurrentFileName(sharedRecord.fileName || 'bukti_transfer.jpg');
    }
  }, [sharedRecord]);

  useEffect(() => {
    let url = '';
    if (currentBlob) {
      url = URL.createObjectURL(currentBlob);
      setImageUrl(url);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [currentBlob]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setCurrentBlob(selectedFile);
      setCurrentFileName(selectedFile.name);
    }
  };

  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(num);
  };

  const pendingTransferRequests = requests.filter((r) => {
    if (r.status === RequestStatus.CANCELLED || r.status === RequestStatus.REJECTED) return false;

    // 1. UID berstatus "PENDING_TALANGAN_TRANSFER"
    if (r.status === RequestStatus.PENDING_TALANGAN_TRANSFER) return true;

    // 2. UID berstatus "PENDING_PENGAJUAN_TRANSFER"
    if (r.status === RequestStatus.PENDING_PENGAJUAN_TRANSFER) return true;

    // 3. UID yang berstatus Transfer Bertahap (belum CLOSED) yang semua itemnya telah diapproved Manager dan Finance
    if (r.status !== RequestStatus.CLOSED) {
      const isTransferBertahap = r.status === RequestStatus.TRANSFER_BERTAHAP || getTransferBertahap(r, histories, usageItems);
      if (isTransferBertahap) {
        const reqItems = usageItems.filter(i => i.requestId === r.id);
        if (reqItems.length > 0) {
          const allItemsApproved = reqItems.every(i => {
            const mgrApp = i.statusManager === ItemStatus.APPROVED || (i.statusManager || '').toString().toUpperCase() === 'APPROVED';
            const adminApp = i.statusAdmin === ItemStatus.APPROVED || (i.statusAdmin || '').toString().toUpperCase() === 'APPROVED';
            return mgrApp && adminApp;
          });
          if (allItemsApproved) return true;
        } else {
          // Jika belum ada item laporan yang diinput, pastikan pengajuan telah di-approve oleh Finance
          const finApproved = isFinanceApprovedOpRequest(r, histories) || getFinanceApprovedAmount(r, histories, usageItems) > 0;
          if (finApproved) return true;
        }
      }
    }

    return false;
  });

  const filteredCandidates = pendingTransferRequests.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const reqProfile = profiles.find((p) => p.email.toLowerCase() === r.userEmail.toLowerCase());
    const reqName = (reqProfile?.nama || (reqProfile as any)?.name || r.userEmail).toLowerCase();
    const reqDiv = (formatDivisiSubDivisi(reqProfile?.divisi || r.divisi, reqProfile?.subDivisi || r.subDivisi)).toLowerCase();
    return (
      r.id.toLowerCase().includes(q) ||
      r.siteId.toLowerCase().includes(q) ||
      r.userEmail.toLowerCase().includes(q) ||
      reqName.includes(q) ||
      reqDiv.includes(q) ||
      r.keterangan.toLowerCase().includes(q) ||
      String(r.managerActionAmount).includes(q)
    );
  });

  const handleSelect = (req: BudgetRequest) => {
    const blobToUse = currentBlob || sharedRecord.blob;
    const fileNameToUse = currentFileName || sharedRecord.fileName;
    const file = new File([blobToUse], fileNameToUse, {
      type: blobToUse.type || sharedRecord.mimeType || 'image/jpeg',
    });
    onSelectCandidate(req, file);
  };

  const handleDiscard = async () => {
    await deleteSharedReceipt(sharedRecord.id);
    await clearAllSharedReceipts();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header - Font diperkecil 1 tingkat & dijadikan 1 baris */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-indigo-800 text-white p-3.5 sm:p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shrink-0">
              <Share2 className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-blue-200" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-xs sm:text-sm md:text-base text-white whitespace-nowrap truncate">
                Bukti Transfer Diterima (Share)
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer shrink-0 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
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
              {/* Centered Image Preview Panel */}
              <div className="flex flex-col items-center justify-center bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-center space-y-2.5">
                <div className="w-full max-w-xs sm:max-w-sm flex flex-col items-center justify-center bg-slate-900 rounded-xl p-2.5 overflow-hidden relative shadow-xs">
                  {imageUrl ? (
                    <ZoomableImage
                      src={imageUrl}
                      alt="Bukti Transfer Share"
                      className="max-h-48 sm:max-h-56 object-contain rounded-md"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">Gambar tidak tersedia</span>
                  )}
                  <span className="text-[10px] text-slate-300 font-mono mt-2 bg-black/40 px-2.5 py-0.5 rounded-md truncate max-w-full">
                    {currentFileName}
                  </span>
                  
                  {/* File Upload Selector for PC Simulation */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="image/*,application/pdf"
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3.5 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Ganti / Upload File PC</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleDiscard}
                  className="text-xs text-red-600 hover:text-red-800 font-bold hover:underline cursor-pointer"
                >
                  Hapus File Share Ini
                </button>
              </div>

              {/* Transaction Candidates Section */}
              <div className="space-y-3 pt-1">
                <div className="space-y-2">
                  <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-indigo-600" />
                    <span>Daftar Transaksi Menunggu Transfer</span>
                  </h4>

                  {/* Search input positioned vertically below title */}
                  <div className="relative w-full">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari UID / Site / Pemohon..."
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all outline-none"
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
                  <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                    {filteredCandidates.map((req) => {
                      const reqProfile = profiles.find((p) => p.email.toLowerCase() === req.userEmail.toLowerCase());
                      const reqName = reqProfile?.nama || (reqProfile as any)?.name || req.userEmail.split('@')[0];
                      const divisiText = formatDivisiSubDivisi(reqProfile?.divisi || req.divisi, reqProfile?.subDivisi || req.subDivisi);
                      const isTalangan = req.id.startsWith('OPT-') || req.id.startsWith('BBMDS') || req.id.startsWith('BBM_DurenSawit') || req.tipePengajuan === 'DANA_TALANGAN';
                      
                      const finApprovedAmt = getFinanceApprovedAmount(req, histories, usageItems);
                      const transferredAmt = req.adminActionAmount || 0;
                      const sisaTransfer = finApprovedAmt > 0 ? Math.max(0, finApprovedAmt - transferredAmt) : (req.managerActionAmount || req.jumlahPengajuan || 0);
                      const nominal = isTalangan ? (finApprovedAmt > 0 ? finApprovedAmt : (req.managerActionAmount || req.jumlahPengajuan || 0)) : (sisaTransfer > 0 ? sisaTransfer : (req.managerActionAmount || req.jumlahPengajuan || 0));

                      let statusBadgeLabel = 'Disetujui';
                      let statusBadgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200/80';

                      if (req.status === RequestStatus.PENDING_TALANGAN_TRANSFER) {
                        statusBadgeLabel = 'Pending Reimburse Talangan';
                        statusBadgeStyle = 'bg-pink-50 text-pink-700 border-pink-200';
                      } else if (req.status === RequestStatus.PENDING_PENGAJUAN_TRANSFER) {
                        statusBadgeLabel = 'Pending Transfer Finance';
                        statusBadgeStyle = 'bg-amber-50 text-amber-700 border-amber-200';
                      } else if (req.status === RequestStatus.TRANSFER_BERTAHAP || getTransferBertahap(req, histories, usageItems)) {
                        statusBadgeLabel = 'Transfer Bertahap';
                        statusBadgeStyle = 'bg-purple-50 text-purple-700 border-purple-200';
                      } else if (req.status === RequestStatus.PARTIALLY_APPROVED) {
                        statusBadgeLabel = 'Disetujui Sebagian';
                        statusBadgeStyle = 'bg-blue-50 text-blue-700 border-blue-200';
                      }

                      return (
                        <div
                          key={req.id}
                          className="p-3.5 rounded-xl border transition-all flex flex-col gap-2.5 bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20 shadow-xs w-full"
                        >
                          {/* Baris 1 (Paling atas): Rata kiri UID, Rata kanan Jenis UID */}
                          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 w-full">
                            <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-md border border-slate-200 shrink-0">
                              {req.id}
                            </span>
                            <span
                              className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border shrink-0 ${
                                isTalangan
                                  ? 'bg-pink-50 text-pink-700 border-pink-200'
                                  : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              }`}
                            >
                              {isTalangan ? 'Dana Talangan' : 'Pengajuan Anggaran'}
                            </span>
                          </div>

                          {/* Baris 2: Pemohon (kiri) & Divisi (rata kanan sejajar status UID) */}
                          <div className="flex items-center justify-between gap-2 text-xs w-full">
                            <div className="text-slate-700 truncate min-w-0">
                              <span className="text-[10px] text-slate-400 mr-1.5 font-semibold">Pemohon:</span>
                              <span className="font-bold text-slate-900">{reqName}</span>
                            </div>
                            <div className="text-slate-700 text-right shrink-0">
                              <span className="text-[10px] text-slate-400 mr-1.5 font-semibold">Divisi:</span>
                              <span className="font-bold text-slate-800">{divisiText || '-'}</span>
                            </div>
                          </div>

                          {/* Baris 3 (Di bawah Pemohon): Informasi Status / Finance Approval */}
                          <div className="text-xs flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] text-slate-400 font-semibold">Status Transfer:</span>
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border shrink-0 ${statusBadgeStyle}`}>
                              {statusBadgeLabel}
                            </span>
                            {(req.adminComment || req.managerComment) && (
                              <span className="text-[11px] text-slate-500 italic truncate max-w-[240px]">
                                "{req.adminComment || req.managerComment}"
                              </span>
                            )}
                          </div>

                          {/* Baris 4 (Di bawah Finance Approval): Nominal Menunggu Transfer */}
                          <div className="text-xs flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-400 font-semibold">Menunggu Transfer:</span>
                            <span className="font-extrabold text-emerald-600 text-sm">
                              {formatIDR(nominal)}
                            </span>
                          </div>

                          {/* Baris 5 (Di bawah Nominal): Site ID / Lokasi */}
                          <div className="text-xs flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-400 font-semibold">Site ID:</span>
                            <span className="text-[11px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                              {req.siteId || '-'}
                            </span>
                          </div>

                          {/* Baris 6 (Di bawah Site ID): Badge Keterangan - Lebar mengikuti modal / card */}
                          {req.keterangan && (
                            <div className="w-full pt-0.5">
                              <p className="w-full text-[11px] text-slate-600 italic bg-slate-50/90 p-2.5 rounded-lg border border-slate-200/80 leading-relaxed">
                                "{req.keterangan}"
                              </p>
                            </div>
                          )}

                          {/* Baris 7 (Paling bawah): Tombol Lanjut Transfer Rata Kanan */}
                          <div className="flex items-center justify-end w-full pt-1 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={() => handleSelect(req)}
                              className="px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100"
                            >
                              <span>Lanjut Transfer</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
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
