import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { BudgetRequest, UserProfile, UsageReportItem, ItemReviewHistory, RequestStatus, ItemStatus, Role } from '../types';
import { useBackHandler } from '../hooks/useBackHandler';
import { OP_TimeLine } from './OP_TimeLine';
import { getFinanceApprovedAmount, getTransferBertahap } from '../App';
import {
  RotateCcw, X, Search, User, MapPin, Calendar, AlertCircle,
  CheckCircle2, Loader2, Copy, Check, Clock, ChevronDown, ChevronUp,
  Paperclip, Eye, ExternalLink, UserCheck, AlertTriangle
} from 'lucide-react';

interface ReopenUidModalProps {
  isOpen: boolean;
  onClose: () => void;
  requests: BudgetRequest[];
  profiles?: UserProfile[];
  usageItems?: UsageReportItem[];
  histories?: ItemReviewHistory[];
  onReopenRequest: (req: BudgetRequest) => Promise<boolean>;
}

export const ReopenUidModal: React.FC<ReopenUidModalProps> = ({
  isOpen,
  onClose,
  requests,
  profiles = [],
  usageItems = [],
  histories = [],
  onReopenRequest
}) => {
  // Input filter User Pemohon starts empty per mandate:
  // "saat pertama kali muncul form Daftar UID CLOSED dengan input text User kosong. Daftar Kartu UID CLOSED baru muncul setelah input text User diisi."
  const [userFilterInput, setUserFilterInput] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [confirmingReq, setConfirmingReq] = useState<BudgetRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedUid, setCopiedUid] = useState<string | null>(null);
  const [expandedTimelineReqIds, setExpandedTimelineReqIds] = useState<Record<string, boolean>>({});
  const [expandedReportReqIds, setExpandedReportReqIds] = useState<Record<string, boolean>>({});
  const [previewDocument, setPreviewDocument] = useState<{ url: string; fileId?: string; title: string } | null>(null);

  // Back button handling
  useBackHandler(
    isOpen,
    () => {
      if (previewDocument) {
        setPreviewDocument(null);
      } else if (confirmingReq) {
        setConfirmingReq(null);
      } else {
        onClose();
      }
    },
    'reopenUidModal'
  );

  const formatIDR = (num: any) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(Number(num) || 0);
  };

  const parseIndonesianDate = (dateStr?: string): Date | null => {
    if (!dateStr) return null;
    const months: { [key: string]: number } = {
      januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5,
      juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, agu: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, des: 11
    };

    const parts = dateStr.replace(/,/g, '').split(/[\s/.-]+/);
    if (parts.length >= 3) {
      const day = parseInt(parts[0], 10);
      const monthStr = parts[1].toLowerCase();
      const year = parseInt(parts[2], 10);

      if (!isNaN(day) && !isNaN(year)) {
        if (months[monthStr] !== undefined) {
          return new Date(year, months[monthStr], day);
        }
        const monthNum = parseInt(monthStr, 10);
        if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
          return new Date(year, monthNum - 1, day);
        }
      }
    }

    const parsed = Date.parse(dateStr);
    return isNaN(parsed) ? null : new Date(parsed);
  };

  const getClosingDateStr = (req: BudgetRequest): string => {
    const reqItems = usageItems.filter(i => i.requestId === req.id);
    if (reqItems.length > 0) {
      const dates = reqItems
        .map(i => i.updatedAt)
        .filter(Boolean)
        .map(d => parseIndonesianDate(d))
        .filter((d): d is Date => d !== null);
      if (dates.length > 0) {
        const latest = new Date(Math.max(...dates.map(d => d.getTime())));
        return latest.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    const parsedCreated = parseIndonesianDate(req.createdAt);
    if (parsedCreated) {
      return parsedCreated.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return req.createdAt ? req.createdAt.split(',')[0] : '-';
  };

  // Filter only CLOSED requests with prefix OP- (UID Pengajuan)
  const closedRequests = useMemo(() => {
    return requests.filter(r => r.status === RequestStatus.CLOSED && r.id.startsWith('OP-'));
  }, [requests]);

  // Extract unique users who have CLOSED requests for suggestions & quick selection
  const usersWithClosedRequests = useMemo(() => {
    const userMap = new Map<string, { email: string; name: string; count: number; divisi?: string }>();
    closedRequests.forEach(r => {
      const email = (r.userEmail || '').trim().toLowerCase();
      if (!email) return;
      const existing = userMap.get(email);
      if (existing) {
        existing.count += 1;
      } else {
        const prof = profiles.find(p => (p.email || '').trim().toLowerCase() === email);
        userMap.set(email, {
          email: r.userEmail,
          name: prof?.nama || r.userEmail.split('@')[0],
          count: 1,
          divisi: prof?.divisi || prof?.subDivisi
        });
      }
    });
    return Array.from(userMap.values()).sort((a, b) => b.count - a.count);
  }, [closedRequests, profiles]);

  // Check if user input is filled
  const isUserFilterFilled = userFilterInput.trim().length > 0;

  // Filter requests ONLY when userFilterInput is filled (per mandate to keep system lightweight)
  const filteredClosedRequests = useMemo(() => {
    if (!isUserFilterFilled) {
      return [];
    }

    const cleanUserFilter = userFilterInput.trim().toLowerCase();
    const cleanQuery = searchQuery.trim().toLowerCase();

    return closedRequests.filter(r => {
      const email = (r.userEmail || '').toLowerCase();
      const prof = profiles.find(p => (p.email || '').toLowerCase() === email);
      const name = (prof?.nama || '').toLowerCase();
      const userId = (prof?.userId || '').toLowerCase();
      const divisi = (prof?.divisi || '').toLowerCase();

      // Check User filter
      const matchesUser =
        email.includes(cleanUserFilter) ||
        name.includes(cleanUserFilter) ||
        userId.includes(cleanUserFilter) ||
        divisi.includes(cleanUserFilter);

      if (!matchesUser) return false;

      // Check secondary search query (UID, Site, Keterangan) if provided
      if (cleanQuery) {
        const matchesQuery =
          r.id.toLowerCase().includes(cleanQuery) ||
          (r.siteId || '').toLowerCase().includes(cleanQuery) ||
          (r.siteName || '').toLowerCase().includes(cleanQuery) ||
          (r.keterangan || '').toLowerCase().includes(cleanQuery);
        if (!matchesQuery) return false;
      }

      return true;
    });
  }, [closedRequests, isUserFilterFilled, userFilterInput, searchQuery, profiles]);

  const handleCopyUid = (uid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(uid);
    setCopiedUid(uid);
    setTimeout(() => setCopiedUid(null), 1800);
  };

  const handleConfirmReopen = async (req: BudgetRequest) => {
    setIsProcessing(true);
    try {
      const success = await onReopenRequest(req);
      if (success) {
        setSuccessMessage(`UID ${req.id} berhasil diaktifkan kembali menjadi status REPORTING.`);
        setConfirmingReq(null);
        setTimeout(() => {
          setSuccessMessage(null);
        }, 5000);
      }
    } catch (err) {
      console.error('Error reopening UID:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fade-in">
      <div 
        id="modal-reopen-uid"
        className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto animate-in fade-in zoom-in-95 duration-150"
      >
        
        {/* Header Modal with colorful gradient */}
        <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 border-b border-amber-500/30 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-white/20 border border-white/30 backdrop-blur-xs flex items-center justify-center text-white shrink-0 shadow-md">
              <RotateCcw className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-sm sm:text-base text-white tracking-wide truncate">
                Reopen UID (Daftar UID Pengajuan CLOSED)
              </h3>
              <p className="text-[11px] text-amber-100/90 truncate mt-0.5">
                Buka kembali UID Pengajuan (prefix OP-) CLOSED menjadi REPORTING
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 ml-2"
            title="Tutup Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Banner */}
        {successMessage && (
          <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 flex items-center justify-between animate-fadeIn shrink-0">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-semibold">{successMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setSuccessMessage(null)}
              className="text-emerald-700 hover:text-emerald-900 font-bold text-xs cursor-pointer"
            >
              &times;
            </button>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            
            {/* Input Text User */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-amber-600 mr-0.5" />
                <span>Pilih / Cari User</span>
                <span className="text-red-500 font-bold text-sm leading-none">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  list="closed-users-datalist"
                  value={userFilterInput}
                  onChange={(e) => setUserFilterInput(e.target.value)}
                  placeholder="Ketik nama, email, atau divisi pemohon..."
                  className="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all shadow-2xs"
                  id="input-filter-user-closed"
                  autoFocus
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                {userFilterInput && (
                  <button
                    type="button"
                    onClick={() => setUserFilterInput('')}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                    title="Hapus filter user"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <datalist id="closed-users-datalist">
                  {usersWithClosedRequests.map(u => (
                    <option key={u.email} value={u.name}>
                      {u.email}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>

            {/* Input Cari Nomor UID */}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-amber-600" />
                <span>Nomor UID</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={!isUserFilterFilled}
                  placeholder={isUserFilterFilled ? "Ketik nomor UID (contoh: OP-12345)..." : "Isi nama user di sebelah kiri dahulu"}
                  className="w-full pl-9 pr-8 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 font-medium placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all shadow-2xs disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                  id="input-search-closed-uid"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                    title="Hapus pencarian"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Body Modal: List of CLOSED UID Cards */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
          {/* CONDITION 1: User filter is empty (Mandate requirement: system stays lightweight on initial open) */}
          {!isUserFilterFilled ? (
            <div className="py-12 px-4 text-center space-y-3 bg-slate-50/70 rounded-2xl border border-dashed border-slate-200 my-2">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200 shadow-xs">
                <User className="w-6 h-6 text-amber-600" />
              </div>
              <div className="space-y-1.5 max-w-md mx-auto">
                <h4 className="text-sm font-bold text-slate-800">
                  Masukkan User Terlebih Dahulu
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Silakan masukkan nama atau email user pemohon pada kolom pencarian di atas untuk memuat daftar kartu UID CLOSED.
                </p>
              </div>
            </div>
          ) : filteredClosedRequests.length === 0 ? (
            /* CONDITION 2: User filter filled, but no matching requests */
            <div className="py-12 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto border border-slate-200 shadow-xs">
                <RotateCcw className="w-7 h-7 text-slate-400" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-800">
                  Tidak Ada UID CLOSED Ditemukan
                </h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Tidak ditemukan kartu UID berstatus CLOSED untuk user pemohon &ldquo;{userFilterInput}&rdquo;
                  {searchQuery ? ` dengan kata kunci "${searchQuery}"` : ''}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setUserFilterInput('');
                  setSearchQuery('');
                }}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-all"
              >
                Ganti User Pemohon
              </button>
            </div>
          ) : (
            /* CONDITION 3: User filter filled and cards found -> Render reused ROLE USER Kartu CLOSED */
            <>
              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>
                  Menampilkan <strong>{filteredClosedRequests.length}</strong> kartu UID CLOSED untuk: <strong className="text-slate-800">{userFilterInput}</strong>
                </span>
                {searchQuery && (
                  <span className="text-[11px] text-amber-700 font-medium">
                    Filter: &ldquo;{searchQuery}&rdquo;
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {filteredClosedRequests.map(req => {
                  const reqItems = usageItems.filter(i => i.requestId === req.id);
                  const isReqTalangan = req.id.startsWith('OPT-') || (req.keterangan || '').startsWith('[DANA TALANGAN]');

                  const ditransferAmount = [
                    RequestStatus.PENDING_APPROVAL,
                    RequestStatus.APPROVED,
                    RequestStatus.PARTIALLY_APPROVED,
                    RequestStatus.PENDING_TALANGAN_TRANSFER,
                    RequestStatus.PENDING_PENGAJUAN_TRANSFER,
                    RequestStatus.REJECTED
                  ].includes(req.status)
                    ? 0
                    : req.adminActionAmount || 0;

                  const approvedUsageAmount = reqItems
                    .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
                    .reduce((sum, item) => sum + (item.nominal || 0), 0);

                  const requesterProfile = profiles.find(p => (p.email || '').toLowerCase() === (req.userEmail || '').toLowerCase());
                  const requesterName = requesterProfile?.nama || requesterProfile?.userId || req.userEmail;
                  const finApproved = getFinanceApprovedAmount(req, histories, usageItems);
                  const closingDateStr = getClosingDateStr(req);

                  return (
                    <div
                      key={req.id}
                      className="bg-white border-l-4 border-l-slate-400 border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 hover:border-slate-300 hover:shadow-md transition-all relative"
                      id={`card-closed-uid-${req.id}`}
                    >
                      {/* Header card info (exact layout from ROLE USER Kartu CLOSED) */}
                      <div>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9px] font-mono text-slate-400 font-bold">{req.id}</span>
                            <button
                              type="button"
                              onClick={(e) => handleCopyUid(req.id, e)}
                              className="text-slate-400 hover:text-slate-600 transition-colors p-0.5 cursor-pointer"
                              title="Salin UID"
                            >
                              {copiedUid === req.id ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <span className="text-[9px] font-mono font-bold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded text-slate-500">
                            Closing
                          </span>
                        </div>

                        <h4 className="text-xs font-bold text-slate-800 mt-1 whitespace-pre-wrap">{req.keterangan}</h4>
                        
                        <div className="text-[10px] text-slate-500 font-medium space-y-1 mt-1">
                          {/* SiteID & Tanggal Penggunaan: sejajar vertikal rata kiri */}
                          <div className="flex flex-col items-start gap-0.5">
                            <span>Site: <strong>{req.siteId}</strong>{req.siteName && req.siteName !== req.siteId ? ` (${req.siteName})` : ''}</span>
                            <span>Tgl Penggunaan: <strong className="text-indigo-600">{req.tanggalPemakaian}</strong></span>
                          </div>

                          {/* Pemohon & Divisi: sejajar horisontal di bawah Tanggal Penggunaan */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>Pemohon: <strong>{requesterName}</strong></span>
                            {requesterProfile?.divisi && (
                              <>
                                <span>&bull;</span>
                                <span>Divisi: <strong>{requesterProfile.divisi}</strong></span>
                              </>
                            )}
                            <span>&bull;</span>
                            <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100 text-[9px] font-bold">
                              Closed: {closingDateStr}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Middle info with budget values (Diajukan, Disetujui, Ditransfer) */}
                      <div className="bg-slate-50 p-2.5 rounded-xl text-[10px] text-slate-500 grid grid-cols-3 gap-2 border border-slate-100">
                        <div>
                          <span className="block text-[8px] font-bold text-slate-400 uppercase">Diajukan</span>
                          <span className="font-semibold text-slate-700">
                            {formatIDR(req.jumlahPengajuan)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[8px] font-bold text-slate-400 uppercase">Disetujui</span>
                          <span className="font-semibold text-emerald-600">
                            {formatIDR(finApproved)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[8px] font-bold text-slate-400 uppercase">Ditransfer</span>
                          <span className="font-semibold text-indigo-600">
                            {(req.adminActionAmount && req.adminActionAmount > 0)
                              ? formatIDR(req.adminActionAmount)
                              : '-'}
                          </span>
                        </div>
                      </div>

                      {/* Transfer Bertahap Pill */}
                      {(req.status === RequestStatus.TRANSFER_BERTAHAP || (getTransferBertahap(req, histories, usageItems) && (req.adminActionAmount || 0) > 0)) && (
                        <div className="text-left">
                          <span className="text-[9px] font-bold text-cyan-700 bg-cyan-50 px-2.5 py-1 rounded-md uppercase tracking-wider border border-cyan-200/60 inline-block">
                            Transfer Bertahap
                          </span>
                        </div>
                      )}

                      {/* Bukti Transfer */}
                      {req.buktiTransferUrl && (() => {
                        const urls = req.buktiTransferUrl.split('||').map(u => u.trim()).filter(Boolean);
                        const fileIds = (req.buktiTransferFileId || '').split('||').map(f => f.trim()).filter(Boolean);
                        if (urls.length === 0) return null;

                        if (urls.length === 1) {
                          return (
                            <button 
                              type="button"
                              onClick={() => setPreviewDocument({
                                url: urls[0],
                                fileId: fileIds[0] || undefined,
                                title: `Bukti Transfer (UID: ${req.id})`
                              })}
                              className="w-full flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 bg-indigo-50/50 hover:bg-indigo-100/70 p-2 rounded-xl border border-indigo-100/80 transition-colors cursor-pointer text-left"
                            >
                              <Paperclip className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                              <span>Bukti Transfer</span>
                            </button>
                          );
                        }

                        return (
                          <div className="space-y-1">
                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">
                              Bukti Transfer ({urls.length} Resi):
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {urls.map((url, idx) => (
                                <button 
                                  key={idx}
                                  type="button"
                                  onClick={() => setPreviewDocument({
                                    url: url,
                                    fileId: fileIds[idx] || undefined,
                                    title: `Bukti Transfer #${idx + 1} (UID: ${req.id})`
                                  })}
                                  className="flex items-center justify-between text-[10px] font-bold text-indigo-600 bg-indigo-50/50 hover:bg-indigo-100/70 p-2 rounded-xl border border-indigo-100/80 transition-colors cursor-pointer text-left truncate"
                                >
                                  <div className="flex items-center gap-1.5 truncate">
                                    <Paperclip className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                                    <span className="truncate">Resi #{idx + 1}</span>
                                  </div>
                                  <Eye className="w-3 h-3 text-indigo-500 shrink-0 ml-1" />
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Clickable Timeline Pengajuan rata kiri vertikal */}
                      <div className="space-y-1.5 text-left">
                        <button
                          type="button"
                          onClick={() => setExpandedTimelineReqIds(prev => ({ ...prev, [req.id]: !prev[req.id] }))}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-[10px] transition-all cursor-pointer border border-indigo-200/80 shrink-0 shadow-2xs"
                          title="Lihat Timeline Pengajuan"
                        >
                          <Clock className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Timeline Pengajuan</span>
                          {expandedTimelineReqIds[req.id] ? (
                            <ChevronUp className="w-3.5 h-3.5 text-indigo-600" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-indigo-600" />
                          )}
                        </button>

                        {expandedTimelineReqIds[req.id] && (
                          <OP_TimeLine
                            request={req}
                            histories={histories}
                            usageItems={usageItems}
                            profiles={profiles}
                            theme="light"
                            className="animate-fade-in my-1.5"
                          />
                        )}
                      </div>

                      {/* Catatan Manager & Finance */}
                      {((req.managerComment && req.status !== RequestStatus.REJECTED) || req.adminComment) && (
                        <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 space-y-1.5 text-[10px] text-slate-600">
                          {req.managerComment && req.status !== RequestStatus.REJECTED && (
                            <div className="flex items-start gap-1.5">
                              <span className="font-semibold text-slate-500 shrink-0">
                                {(() => {
                                  const p = profiles.find(prof => (prof.email || '').trim().toLowerCase() === (req.userEmail || '').trim().toLowerCase());
                                  return (p?.role === Role.MANAGER || p?.role === Role.FINANCE) ? 'Catatan Direktur:' : 'Catatan Manager:';
                                })()}
                              </span>
                              <span className="italic text-slate-700">{req.managerComment}</span>
                            </div>
                          )}
                          {req.adminComment && (
                            <div className="flex items-start gap-1.5">
                              <span className="font-semibold text-slate-500 shrink-0">Catatan Finance:</span>
                              <span className="italic text-slate-700">{req.adminComment}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Expandable Report Items List for Realisasi */}
                      {reqItems.length > 0 && (
                        <div className="space-y-1.5 text-left">
                          <button
                            type="button"
                            onClick={() => setExpandedReportReqIds(prev => ({ ...prev, [req.id]: !prev[req.id] }))}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all cursor-pointer"
                          >
                            <span>Rincian Realisasi ({reqItems.length} Nota &bull; {formatIDR(approvedUsageAmount)})</span>
                            {expandedReportReqIds[req.id] ? (
                              <ChevronUp className="w-3 h-3 text-slate-500" />
                            ) : (
                              <ChevronDown className="w-3 h-3 text-slate-500" />
                            )}
                          </button>

                          {expandedReportReqIds[req.id] && (
                            <div className="bg-indigo-50/30 rounded-xl p-3 border border-indigo-100/80 space-y-2 animate-slide-up mt-1">
                              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                                {reqItems.map((item, idx) => (
                                  <div key={item.id} className="bg-white border border-slate-100 rounded-xl p-2.5 space-y-1.5 shadow-xs text-[10px]">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="space-y-0.5 min-w-0">
                                        <span className="text-[8px] text-slate-400 font-bold block">NOTA #{idx + 1}</span>
                                        <h5 className="text-[11px] font-bold text-slate-800 leading-tight">{item.keterangan}</h5>
                                        <p className="text-[9px] text-slate-500 font-medium">
                                          Tgl: {item.tanggalPenggunaan} &bull; Nominal: <strong className="text-slate-800">{formatIDR(item.nominal)}</strong>
                                        </p>
                                      </div>
                                      {item.buktiUrl && (
                                        <button
                                          type="button"
                                          onClick={() => setPreviewDocument({
                                            url: item.buktiUrl,
                                            fileId: item.buktiFileId || undefined,
                                            title: `Bukti Nota: ${item.keterangan}`
                                          })}
                                          className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-[9px] font-bold shrink-0 flex items-center gap-1 transition-all cursor-pointer"
                                        >
                                          <Paperclip className="w-3 h-3" />
                                          <span>Nota</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Card Footer: Summary & "Open UID" button on the bottom right */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-[10px] text-slate-500 font-medium">
                          Total Realisasi: <strong className="text-slate-800">{formatIDR(approvedUsageAmount)}</strong> ({reqItems.length} Nota)
                        </div>

                        {/* Button "Open UID" located in the bottom right corner */}
                        <button
                          type="button"
                          onClick={() => setConfirmingReq(req)}
                          className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer ml-auto"
                          id={`btn-open-uid-${req.id}`}
                          title={`Buka kembali ${req.id} menjadi status REPORTING`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Open UID</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-center text-[11px] text-slate-500 shrink-0">
          <span>Menampilkan data closed terarsip khusus UID Pengajuan (prefix OP-) &bull; Aksi Open UID hanya dapat dilakukan oleh peran <strong>Administrator</strong>.</span>
        </div>
      </div>

      {/* Confirmation Notification Modal */}
      {confirmingReq && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 p-5 sm:p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150 my-auto">
            
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 shadow-2xs">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1 min-w-0">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                  Konfirmasi Reopen UID
                </span>
                <h4 className="text-sm font-bold text-slate-900 leading-snug">
                  Apakah Anda yakin akan membuat UID ini menjadi aktif kembali?
                </h4>
              </div>
            </div>

            {/* Preview details of UID being reopened */}
            <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200 text-xs space-y-2">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="text-slate-500">Nomor UID:</span>
                <span className="font-mono font-bold text-slate-900 text-xs bg-white px-2 py-0.5 rounded-md border border-slate-200">
                  {confirmingReq.id}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Pemohon:</span>
                <span className="font-bold text-slate-800 truncate max-w-[200px]">
                  {confirmingReq.userEmail}
                </span>
              </div>
              {confirmingReq.siteId && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Site:</span>
                  <span className="font-semibold text-slate-700">
                    {confirmingReq.siteId} {confirmingReq.siteName ? `(${confirmingReq.siteName})` : ''}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Nominal:</span>
                <span className="font-bold text-slate-900">
                  {formatIDR(confirmingReq.jumlahPengajuan)}
                </span>
              </div>
              {confirmingReq.keterangan && (
                <div className="pt-1 text-[11px] text-slate-600 border-t border-slate-200">
                  <span className="text-slate-400 font-medium">Keterangan:</span> {confirmingReq.keterangan}
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Status UID akan diubah dari <strong>CLOSED</strong> menjadi <strong>REPORTING</strong> di database. Pengguna pemohon dapat kembali memasukkan atau melengkapi detail laporan pemakaian dana.
            </p>

            {/* Action Buttons: "Batal" & "Yakin lanjutkan" */}
            <div className="flex items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmingReq(null)}
                disabled={isProcessing}
                className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer disabled:opacity-50 text-center"
                id="btn-batal-reopen-uid"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => handleConfirmReopen(confirmingReq)}
                disabled={isProcessing}
                className="flex-1 py-2.5 px-4 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-amber-200 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                id="btn-yakin-reopen-uid"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Mengubah Status...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Yakin lanjutkan</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Viewer Modal */}
      {previewDocument && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5 bg-slate-900/80 backdrop-blur-xs animate-fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Preview Dokumen</span>
                <h4 className="text-xs font-bold text-slate-800 truncate">{previewDocument.title}</h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDocument(null)}
                className="w-8 h-8 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 flex items-center justify-center bg-slate-100/50 min-h-[300px]">
              {previewDocument.fileId ? (
                <img
                  src={`https://drive.google.com/thumbnail?sz=w1000&id=${previewDocument.fileId}`}
                  alt={previewDocument.title}
                  className="max-h-[60vh] max-w-full rounded-xl object-contain shadow-sm"
                  referrerPolicy="no-referrer"
                />
              ) : previewDocument.url ? (
                <img
                  src={previewDocument.url}
                  alt={previewDocument.title}
                  className="max-h-[60vh] max-w-full rounded-xl object-contain shadow-sm"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <p className="text-xs text-slate-400">Dokumen tidak dapat dimuat</p>
              )}
            </div>
            {previewDocument.url && (
              <div className="p-3 bg-white border-t border-slate-200 flex justify-end">
                <a
                  href={previewDocument.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Buka di Tab Baru</span>
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};
