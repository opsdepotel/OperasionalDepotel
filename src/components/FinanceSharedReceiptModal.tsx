import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  UploadCloud,
  Coins,
  ShieldCheck,
  TrendingDown
} from 'lucide-react';

interface FinanceSharedReceiptModalProps {
  activeRole: Role;
  sharedRecord: SharedReceiptRecord;
  requests: BudgetRequest[];
  histories?: ItemReviewHistory[];
  usageItems?: UsageReportItem[];
  profiles?: UserProfile[];
  onSelectCandidate: (candidate: BudgetRequest, file: File) => void;
  onSelectAdjustmentUser?: (user: UserProfile, file: File) => void;
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
  onSelectAdjustmentUser,
  onSwitchToFinanceRole,
  onClose,
}) => {
  const isFinance = activeRole === Role.FINANCE;

  const [activeTab, setActiveTab] = useState<'TRANSFER' | 'ADJUSTMENT'>('TRANSFER');
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

  // Helper checks for Operational Balance calculations
  const isBbmRequest = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
  const isBbmUsageItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

  const isTalanganRequest = (r: BudgetRequest) => {
    return (
      r.id.startsWith('OPT-') ||
      r.keterangan?.toUpperCase().includes('[DANA TALANGAN]') ||
      r.keterangan?.toUpperCase().includes('DANA TALANGAN') ||
      r.keterangan?.toUpperCase().includes('TALANGAN') ||
      r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
    );
  };

  // Global user operational balance (including OP-, OPT-, ADJ-, excluding BBM)
  const getUserBalance = (userEmail: string) => {
    const userReqs = requests.filter(r => 
      r.userEmail.toLowerCase() === userEmail.toLowerCase() && 
      !isBbmRequest(r)
    );
    const userReqIds = userReqs.map(r => r.id);
    const userUsage = usageItems.filter(item => userReqIds.includes(item.requestId) && !isBbmUsageItem(item));

    const totalTransferred = userReqs.filter(r => r.siteId !== 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalAdjustments = userReqs.filter(r => r.siteId === 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalReportedApproved = userUsage
      .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
      .reduce((sum, item) => sum + item.nominal, 0);
    
    return totalTransferred + totalAdjustments - totalReportedApproved;
  };

  // Strictly OP- (Operasional Biasa) summary
  const getUserOpSummary = (userEmail: string) => {
    const userReqs = requests.filter(r => 
      r.userEmail.toLowerCase() === userEmail.toLowerCase() && 
      !isBbmRequest(r) && 
      !isTalanganRequest(r)
    );
    const userReqIds = userReqs.map(r => r.id);
    const userUsage = usageItems.filter(item => userReqIds.includes(item.requestId) && !isBbmUsageItem(item));

    const totalTransferred = userReqs.filter(r => r.siteId !== 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalAdjustments = userReqs.filter(r => r.siteId === 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalReportedApproved = userUsage
      .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
      .reduce((sum, item) => sum + item.nominal, 0);

    const balance = totalTransferred + totalAdjustments - totalReportedApproved;
    const requiredNominal = Math.abs(balance);

    return {
      totalTransferred,
      totalAdjustments,
      totalReportedApproved,
      balance,
      requiredNominal
    };
  };

  // Deduplicated unique profiles
  const uniqueProfiles = useMemo(() => {
    const map = new Map<string, UserProfile>();
    profiles.forEach(p => {
      const key = (p.email || '').toLowerCase().trim();
      if (key && !map.has(key)) {
        map.set(key, p);
      }
    });
    return Array.from(map.values());
  }, [profiles]);

  // Users with negative operational balance (Saldo Kurang / Perlu Adjustment)
  const minusBalanceUsers = useMemo(() => {
    return uniqueProfiles.filter(user => {
      const globalBal = getUserBalance(user.email);
      const opSum = getUserOpSummary(user.email);
      return globalBal < -0.01 || opSum.balance < -0.01;
    });
  }, [uniqueProfiles, requests, usageItems]);

  const filteredMinusBalanceUsers = useMemo(() => {
    if (!searchQuery.trim()) return minusBalanceUsers;
    const q = searchQuery.toLowerCase();
    return minusBalanceUsers.filter(user => {
      const name = (user.nama || (user as any).name || '').toLowerCase();
      const email = user.email.toLowerCase();
      const div = formatDivisiSubDivisi(user.divisi, user.subDivisi).toLowerCase();
      return name.includes(q) || email.includes(q) || div.includes(q);
    });
  }, [minusBalanceUsers, searchQuery]);

  const pendingTransferRequests = useMemo(() => {
    return requests.filter((r) => {
      if (r.status === RequestStatus.CANCELLED || r.status === RequestStatus.REJECTED || r.status === RequestStatus.CLOSED) return false;

      // Check canonical isPendingTransferRequest (includes APPROVED, PARTIALLY_APPROVED for OP with Finance approval or Non-OP, PENDING_TALANGAN_TRANSFER, PENDING_PENGAJUAN_TRANSFER, etc.)
      if (isPendingTransferRequest(r, histories, usageItems)) return true;

      // 1. UID berstatus "PENDING_TALANGAN_TRANSFER"
      if (r.status === RequestStatus.PENDING_TALANGAN_TRANSFER) return true;

      // 2. UID berstatus "PENDING_PENGAJUAN_TRANSFER"
      if (r.status === RequestStatus.PENDING_PENGAJUAN_TRANSFER) return true;

      // 3. UID yang berstatus Transfer Bertahap (belum CLOSED) yang semua itemnya telah diapproved Manager dan Finance
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

      return false;
    });
  }, [requests, histories, usageItems]);

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

  const handleSelectAdjustment = (user: UserProfile) => {
    const blobToUse = currentBlob || sharedRecord.blob;
    const fileNameToUse = currentFileName || sharedRecord.fileName;
    const file = new File([blobToUse], fileNameToUse, {
      type: blobToUse.type || sharedRecord.mimeType || 'image/jpeg',
    });
    if (onSelectAdjustmentUser) {
      onSelectAdjustmentUser(user, file);
    }
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

              {/* Tab Navigation: Menunggu Transfer vs Perlu Adjusment */}
              <div className="flex border-b border-slate-200 bg-slate-50/80 rounded-xl p-1 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('TRANSFER');
                    setSearchQuery('');
                  }}
                  className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    activeTab === 'TRANSFER'
                      ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
                  }`}
                >
                  <FileCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>Menunggu Transfer</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                    activeTab === 'TRANSFER' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {pendingTransferRequests.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('ADJUSTMENT');
                    setSearchQuery('');
                  }}
                  className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    activeTab === 'ADJUSTMENT'
                      ? 'bg-white text-rose-700 shadow-xs border border-slate-200/80'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-white/50'
                  }`}
                >
                  <Coins className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Perlu Adjusment</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold ${
                    activeTab === 'ADJUSTMENT' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {minusBalanceUsers.length}
                  </span>
                </button>
              </div>

              {activeTab === 'TRANSFER' ? (
                /* Tab 1: Menunggu Transfer */
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
              ) : (
                /* Tab 2: Perlu Adjusment */
                <div className="space-y-3 pt-1">
                  <div className="space-y-2">
                    <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                      <Coins className="w-4 h-4 text-rose-600" />
                      <span>Daftar User dengan Saldo Operasional Minus</span>
                    </h4>

                    {/* Search input positioned vertically below title */}
                    <div className="relative w-full">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Cari User / Email / Divisi..."
                        className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 transition-all outline-none"
                      />
                    </div>
                  </div>

                  {/* Minus balance users list */}
                  {minusBalanceUsers.length === 0 ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center text-emerald-800 space-y-2">
                      <ShieldCheck className="w-8 h-8 text-emerald-600 mx-auto" />
                      <p className="font-bold text-xs text-emerald-900">Tidak ada User yang saldo operasionalnya minus saat ini.</p>
                      <p className="text-[11px] text-emerald-700">Semua saldo operasional user dalam kondisi balance atau bersaldo lebih.</p>
                    </div>
                  ) : filteredMinusBalanceUsers.length === 0 ? (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-center text-slate-500 text-xs">
                      Pencarian "{searchQuery}" tidak ditemukan pada daftar user yang perlu adjustment.
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                      {filteredMinusBalanceUsers.map((user, idx) => {
                        const userGlobalBalance = getUserBalance(user.email);
                        const summary = getUserOpSummary(user.email);
                        const name = user.nama || (user as any).name || user.email.split('@')[0];
                        const divText = formatDivisiSubDivisi(user.divisi, user.subDivisi);
                        const requiredNominal = summary.requiredNominal > 0 ? summary.requiredNominal : Math.abs(userGlobalBalance);

                        return (
                          <div
                            key={`${user.email}_${user.userId || idx}`}
                            className="p-3.5 rounded-xl border transition-all flex flex-col gap-2.5 bg-white border-slate-200 hover:border-rose-300 hover:bg-rose-50/10 shadow-xs w-full"
                          >
                            {/* Baris 1: Identitas User & Status Minus */}
                            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 w-full">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center shrink-0">
                                  <User className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <h5 className="font-bold text-xs text-slate-900 truncate">{name}</h5>
                                  <p className="text-[9px] text-slate-400 font-mono truncate">{user.email}</p>
                                </div>
                              </div>
                              <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border shrink-0 bg-rose-50 text-rose-700 border-rose-200 flex items-center gap-1">
                                <TrendingDown className="w-3 h-3 text-rose-600" />
                                <span>Saldo Minus</span>
                              </span>
                            </div>

                            {/* Baris 2: Divisi */}
                            <div className="flex items-center justify-between gap-2 text-xs w-full">
                              <span className="text-[10px] text-slate-400 font-semibold">Divisi:</span>
                              <span className="font-bold text-slate-800 text-right">{divText || '-'}</span>
                            </div>

                            {/* Baris 3: Saldo Operasional Saat Ini */}
                            <div className="flex items-center justify-between gap-2 text-xs w-full bg-rose-50/70 p-2.5 rounded-xl border border-rose-200/80">
                              <span className="text-[10px] text-rose-800 font-bold uppercase tracking-wider">Saldo Operasional:</span>
                              <span className="font-black font-mono text-rose-600 text-sm">
                                {formatIDR(userGlobalBalance)}
                              </span>
                            </div>

                            {/* Baris 4: Financial Summary Breakdown */}
                            <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 text-[9px]">
                              <div>
                                <span className="block text-[8px] font-bold text-slate-400 uppercase">Transfer Diterima</span>
                                <span className="text-[10px] font-bold font-mono text-slate-700">{formatIDR(summary.totalTransferred)}</span>
                              </div>
                              <div>
                                <span className="block text-[8px] font-bold text-slate-400 uppercase">Laporan Disetujui</span>
                                <span className="text-[10px] font-bold font-mono text-emerald-600">{formatIDR(summary.totalReportedApproved)}</span>
                              </div>
                              <div>
                                <span className="block text-[8px] font-bold text-indigo-600 uppercase">Butuh Adjustment</span>
                                <span className="text-[10px] font-extrabold font-mono text-indigo-700">{formatIDR(requiredNominal)}</span>
                              </div>
                            </div>

                            {/* Baris 5: Tombol Aksi Proses Adjustment */}
                            <div className="flex items-center justify-end w-full pt-1 border-t border-slate-100">
                              <button
                                type="button"
                                onClick={() => handleSelectAdjustment(user)}
                                className="px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer bg-rose-600 hover:bg-rose-700 text-white shadow-rose-100"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>Proses Adjustment</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
