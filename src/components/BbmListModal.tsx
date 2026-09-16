/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from '../hooks/useBackHandler';
import { BudgetRequest, UsageReportItem, UserProfile, UserActivity, Role, RequestStatus } from '../types';
import { parseNumericValue, generateUniqueUID } from '../lib/googleApi';
import { Fuel, Calendar, Search, MapPin, FileText, X, Image as ImageIcon, CheckCircle2, ChevronRight, Filter, RefreshCw, Activity, Camera, Clock, User, ExternalLink, AlertOctagon, Sparkles, ShieldCheck, AlertTriangle, Send, Coins, Lock, AlertCircle, UploadCloud } from 'lucide-react';
import { AiScreenRecaptureModal, AiRecaptureResult } from './AiScreenRecaptureModal';
import { requestAiScreenRecapture } from '../lib/aiRecapture';
import { AiBbmReceiptModal } from './AiBbmReceiptModal';
import { AiBbmReceiptResult, requestAiBbmReceiptCheck } from '../lib/aiBbmReceipt';
import { ZoomableImage } from './ZoomableImage';

interface BbmListModalProps {
  isOpen: boolean;
  onClose: () => void;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  profiles?: UserProfile[];
  activities?: UserActivity[];
  role?: Role;
  userEmail?: string;
  userProfile?: UserProfile | null;
  onUpdateActivity?: (act: UserActivity) => Promise<void> | void;
  onOpenBbmRefillModal?: () => void;
  onPreviewDocument?: (url: string) => void;
  onSubmitTransferBbmDS?: (transferReq: BudgetRequest, photoFile: File | null) => Promise<void>;
}

// Helper to parse coordinate string and calculate distance
function parseCoords(coordStr?: string): { lat: number; lng: number } | null {
  if (!coordStr) return null;
  const clean = coordStr.replace(/[()\[\]]/g, '').trim();
  const parts = clean.split(/[\s,]+/);
  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }
  return null;
}

function getDistanceInMeters(coordStr1?: string, coordStr2?: string): number | null {
  if (!coordStr1 || !coordStr2) return null;
  const c1 = parseCoords(coordStr1);
  const c2 = parseCoords(coordStr2);
  if (!c1 || !c2) return null;

  const R = 6371e3; // Earth radius in meters
  const phi1 = (c1.lat * Math.PI) / 180;
  const phi2 = (c2.lat * Math.PI) / 180;
  const deltaPhi = ((c2.lat - c1.lat) * Math.PI) / 180;
  const deltaLambda = ((c2.lng - c1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

// Helper to extract Google Drive File ID from URL or raw ID
const extractDriveFileId = (url?: string, fileId?: string): string | null => {
  if (fileId && !fileId.startsWith('BBM_NOTA_')) {
    return fileId.trim();
  }
  if (!url) return null;
  const fileDMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileDMatch && fileDMatch[1]) return fileDMatch[1];

  const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch && idParamMatch[1]) return idParamMatch[1];

  return null;
};

// Helper to get printable image src URL for <img> tags
const getImageSrc = (rawUrl?: string, rawFileId?: string): string => {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('data:')) return rawUrl;

  const driveId = extractDriveFileId(rawUrl, rawFileId);
  if (driveId) {
    return `https://drive.google.com/thumbnail?sz=w1000&id=${driveId}`;
  }

  return rawUrl;
};

export const BbmListModal: React.FC<BbmListModalProps> = ({
  isOpen,
  onClose,
  requests,
  usageItems,
  profiles = [],
  activities = [],
  role,
  userEmail,
  userProfile,
  onUpdateActivity,
  onOpenBbmRefillModal,
  onPreviewDocument,
  onSubmitTransferBbmDS
}) => {
  // Format local date string YYYY-MM-DD
  const getTodayDateStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getYesterdayDateStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayStr = getTodayDateStr();

  const userEmailToMatch = (userEmail || '').toLowerCase();
  const todayRefillCount = userEmailToMatch ? requests.filter(r => {
    const isBbmReq = r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
    if (!isBbmReq) return false;
    if (r.status === RequestStatus.CANCELLED) return false;
    const isSameUser = r.userEmail.toLowerCase() === userEmailToMatch;
    const isSameDate = r.tanggalPemakaian === todayStr || (r.createdAt && r.createdAt.substring(0, 10) === todayStr);
    return isSameUser && isSameDate;
  }).length : 0;
  const hasRefilledToday = todayRefillCount > 0;

  // Selected date filter (default: today's date)
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string | null>(null);
  const [imageErrorMap, setImageErrorMap] = useState<Record<string, boolean>>({});

  // Selected User Activity popup modal
  const [selectedUserActivityModal, setSelectedUserActivityModal] = useState<{
    userEmail: string;
    userName: string;
    tanggal: string;
  } | null>(null);

  // AI Screen Recapture State
  const [aiRecaptureResults, setAiRecaptureResults] = useState<Record<string, AiRecaptureResult>>({});
  const [isAiRecaptureModalOpen, setIsAiRecaptureModalOpen] = useState(false);
  const [selectedAiActivity, setSelectedAiActivity] = useState<UserActivity | null>(null);
  const [selectedAiPhotoUrl, setSelectedAiPhotoUrl] = useState<string | null>(null);
  const [selectedAiPhotoFileId, setSelectedAiPhotoFileId] = useState<string | null>(null);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiAnalysisError, setAiAnalysisError] = useState<string | null>(null);

  // AI BBM Receipt Check State (Role Administrator)
  const [aiBbmReceiptResults, setAiBbmReceiptResults] = useState<Record<string, AiBbmReceiptResult>>({});
  const [isAiBbmModalOpen, setIsAiBbmModalOpen] = useState(false);
  const [selectedBbmRequest, setSelectedBbmRequest] = useState<BudgetRequest | null>(null);
  const [selectedBbmUsageItem, setSelectedBbmUsageItem] = useState<UsageReportItem | null>(null);
  const [selectedBbmPhotoUrl, setSelectedBbmPhotoUrl] = useState<string | null>(null);
  const [selectedBbmPhotoFileId, setSelectedBbmPhotoFileId] = useState<string | null>(null);
  const [isAiBbmAnalyzing, setIsAiBbmAnalyzing] = useState(false);
  const [aiBbmAnalysisError, setAiBbmAnalysisError] = useState<string | null>(null);

  // Transfer Pengisian BBM Duren Sawit State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferNominalInput, setTransferNominalInput] = useState<string>('');
  const [transferKeterangan, setTransferKeterangan] = useState('');
  const [transferPhotoFile, setTransferPhotoFile] = useState<File | null>(null);
  const [transferPhotoPreview, setTransferPhotoPreview] = useState<string | null>(null);
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Helper date DD/MMM/YYYY display e.g. "16/Sep/2026"
  const formatDdMmmYyyy = (dateStr: string) => {
    if (!dateStr) return '';
    const clean = dateStr.split('T')[0].trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      const [y, m, d] = clean.split('-');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      const monthIdx = parseInt(m, 10) - 1;
      const monthName = months[monthIdx] || m;
      return `${d}/${monthName}/${y}`;
    }
    return clean;
  };

  // Helper to extract AI Screen Recapture result from database fields or in-memory state
  const getAiRecaptureResult = (act: UserActivity): AiRecaptureResult | null => {
    if (aiRecaptureResults[act.id]) {
      return aiRecaptureResults[act.id];
    }
    const verdictRaw = act.aiRecaptureVerdict ? String(act.aiRecaptureVerdict).trim() : '';
    if (
      !verdictRaw ||
      verdictRaw === '-' ||
      verdictRaw.toLowerCase() === 'null' ||
      verdictRaw.toLowerCase() === 'undefined' ||
      verdictRaw.toLowerCase() === 'n/a' ||
      verdictRaw.toLowerCase() === 'none' ||
      verdictRaw.toLowerCase() === 'belum diperiksa' ||
      verdictRaw.toLowerCase() === 'belum cek' ||
      verdictRaw.toLowerCase() === 'not_checked' ||
      verdictRaw.toLowerCase() === 'unchecked'
    ) {
      return null;
    }

    const vUpper = verdictRaw.toUpperCase().replace(/[\s_-]+/g, '');
    const isRecapture = 
      vUpper.includes('RECAPTURE') ||
      vUpper.includes('FOTOLAYAR') ||
      vUpper.includes('LAYAR') ||
      vUpper.includes('SCREEN') ||
      vUpper.includes('SPOOF') ||
      vUpper.includes('PALSU') ||
      vUpper.includes('FAKE') ||
      vUpper === 'TRUE' ||
      vUpper === '1';

    const isSuspicious = !isRecapture && (
      vUpper.includes('SUSPICIOUS') ||
      vUpper.includes('MENCURIGAKAN') ||
      vUpper.includes('RAGU')
    );

    const isAuthentic = !isRecapture && !isSuspicious && (
      vUpper.includes('AUTHENTIC') ||
      vUpper.includes('ASLI') ||
      vUpper.includes('VALID') ||
      vUpper.includes('DIRECT') ||
      vUpper.includes('ORIGINAL') ||
      vUpper === 'FALSE' ||
      vUpper === '0'
    );

    // If it is none of these valid verdicts, treat as not checked
    if (!isRecapture && !isSuspicious && !isAuthentic) {
      return null;
    }

    const standardVerdict = isRecapture
      ? 'SCREEN_RECAPTURE_DETECTED'
      : isSuspicious
        ? 'SUSPICIOUS'
        : 'AUTHENTIC';

    let indicators: string[] = [];
    if (act.aiRecaptureIndicators) {
      try {
        const parsed = JSON.parse(act.aiRecaptureIndicators);
        indicators = Array.isArray(parsed) ? parsed : [String(parsed)];
      } catch {
        indicators = act.aiRecaptureIndicators.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      }
    }

    let conf = act.aiRecaptureConfidence;
    if (typeof conf === 'string') {
      const parsed = parseFloat(String(conf).replace(/[^0-9.]/g, ''));
      conf = !isNaN(parsed) ? (parsed <= 1 && parsed > 0 ? Math.round(parsed * 100) : Math.round(parsed)) : undefined;
    }
    const finalConfidence = conf ?? (isRecapture ? 95 : isSuspicious ? 70 : 98);

    return {
      isRecapture,
      confidence: finalConfidence,
      verdict: standardVerdict,
      summary: act.aiRecaptureSummary || (
        isRecapture
          ? 'Terdeteksi foto ulang dari layar digital (Tersimpan di Database).'
          : isSuspicious
            ? 'Status foto memerlukan verifikasi manual (Tersimpan di Database).'
            : 'Foto asli teridentifikasi diambil langsung di lokasi fisik (Tersimpan di Database).'
      ),
      indicators: indicators.length > 0 ? indicators : [
        isRecapture ? 'Tercatat indikasi foto layar di database' : isSuspicious ? 'Tercatat status mencurigakan di database' : 'Tercatat foto asli di database'
      ],
      recommendation: isRecapture
        ? 'Periksa keaslian fisik atau hubungi pelapor kegiatan.'
        : isSuspicious
          ? 'Lakukan konfirmasi visual langsung dengan pengguna.'
          : 'Foto bukti terverifikasi valid dan tersimpan di database.',
      checkedAt: act.aiRecaptureCheckedAt
    };
  };

  useBackHandler(!!selectedPhotoUrl, () => setSelectedPhotoUrl(null), 'bbmList_photoUrl');
  useBackHandler(!!selectedUserActivityModal, () => setSelectedUserActivityModal(null), 'bbmList_userActivity');
  useBackHandler(isAiRecaptureModalOpen, () => setIsAiRecaptureModalOpen(false), 'bbmList_aiRecapture');
  useBackHandler(isAiBbmModalOpen, () => setIsAiBbmModalOpen(false), 'bbmList_aiBbmReceipt');

  const handleRunAiBbmReceiptCheck = async (
    req: BudgetRequest,
    usageItem?: UsageReportItem,
    forceReanalyze = false
  ) => {
    // Resolve usageItem if not provided
    const resolvedUsageItem = usageItem || usageItems.find(
      item => item.requestId === req.id || item.id.startsWith(req.id) || (item.requestId && req.id.includes(item.requestId))
    );

    const firstBuktiUrl = req.buktiTransferUrl ? req.buktiTransferUrl.split('||')[0].trim() : '';
    const firstFileId = req.buktiTransferFileId ? req.buktiTransferFileId.split('||')[0].trim() : '';
    const rawBuktiPhoto = resolvedUsageItem?.buktiUrl || firstBuktiUrl;
    const rawBuktiFileId = resolvedUsageItem?.buktiFileId || firstFileId;

    setSelectedBbmRequest(req);
    setSelectedBbmUsageItem(resolvedUsageItem || null);
    setSelectedBbmPhotoUrl(rawBuktiPhoto || null);
    setSelectedBbmPhotoFileId(rawBuktiFileId || null);
    setIsAiBbmModalOpen(true);
    setAiBbmAnalysisError(null);

    if (aiBbmReceiptResults[req.id] && !forceReanalyze) {
      return;
    }

    setIsAiBbmAnalyzing(true);
    try {
      const res = await requestAiBbmReceiptCheck(req, resolvedUsageItem || undefined, rawBuktiPhoto, rawBuktiFileId);
      setAiBbmReceiptResults(prev => ({
        ...prev,
        [req.id]: res
      }));
    } catch (err: any) {
      console.error('AI BBM Receipt OCR check failed:', err);
      setAiBbmAnalysisError(err.message || 'Gagal memeriksa nota BBM Duren Sawit dengan AI.');
    } finally {
      setIsAiBbmAnalyzing(false);
    }
  };

  const handleRunAiRecapture = async (
    act: UserActivity,
    forceReanalyze = false
  ) => {
    let fileId = act.buktiFileId?.trim() || '';
    if (!fileId && act.buktiUrl) {
      const m = act.buktiUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
                act.buktiUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                act.buktiUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (m && m[1]) fileId = m[1];
    }

    const photoUrl = act.buktiUrl?.startsWith('data:')
      ? act.buktiUrl
      : fileId
        ? `https://drive.google.com/thumbnail?sz=w1200&id=${fileId}`
        : act.buktiUrl;

    setSelectedAiActivity(act);
    setSelectedAiPhotoUrl(photoUrl);
    setSelectedAiPhotoFileId(fileId || null);
    setIsAiRecaptureModalOpen(true);
    setAiAnalysisError(null);

    // 1. If result is already saved in database or cached state and not forcing re-analysis, load immediately without calling AI API!
    const existingResult = getAiRecaptureResult(act);
    if (existingResult && !forceReanalyze) {
      if (!aiRecaptureResults[act.id]) {
        setAiRecaptureResults(prev => ({ ...prev, [act.id]: existingResult }));
      }
      return;
    }

    setIsAiAnalyzing(true);
    try {
      const newResult = await requestAiScreenRecapture(act, photoUrl, fileId);

      setAiRecaptureResults(prev => ({
        ...prev,
        [act.id]: newResult,
      }));

      // Automatically persist to Google Sheet Activity database so it won't ever need re-checking
      if (onUpdateActivity) {
        try {
          await onUpdateActivity({
            ...act,
            aiRecaptureVerdict: newResult.verdict,
            aiRecaptureConfidence: newResult.confidence,
            aiRecaptureSummary: newResult.summary,
            aiRecaptureIndicators: JSON.stringify(newResult.indicators || []),
            aiRecaptureCheckedAt: newResult.checkedAt
          });
        } catch (err) {
          console.error('Failed to auto-save AI result to database in BbmListModal:', err);
        }
      }
    } catch (err: any) {
      console.error('AI Screen Recapture failed in BbmListModal:', err);
      setAiAnalysisError(err.message || 'Gagal memeriksa keaslian foto dengan AI.');
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  // Helper date normalizer
  const getNormalizedYmd = (dateStr?: string): string => {
    if (!dateStr) return '';
    if (dateStr.includes('T')) return dateStr.split('T')[0];
    if (dateStr.length >= 10) return dateStr.substring(0, 10);
    return dateStr;
  };

  // User activities matching target user and date
  const userActivitiesForDate = (activities || []).filter(act => {
    if (!selectedUserActivityModal) return false;
    const matchesUser = act.userEmail.toLowerCase() === selectedUserActivityModal.userEmail.toLowerCase();
    const actDate = getNormalizedYmd(act.tanggal);
    const targetDate = getNormalizedYmd(selectedUserActivityModal.tanggal);
    return matchesUser && actDate === targetDate;
  });

  // Format Currency
  const formatIDR = (num: any) => {
    const val = parseNumericValue(num);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
  };

  // Helper date display e.g. "Rabu, 22 Juli 2026"
  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return 'Semua Tanggal';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return new Intl.DateTimeFormat('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(d);
    } catch {
      return dateStr;
    }
  };

  // Helper short date display e.g. "23 Jul 2026"
  const formatShortDateDisplay = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr.substring(0, 10);
      const d = new Date(cleanDate + 'T00:00:00');
      return new Intl.DateTimeFormat('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }).format(d);
    } catch {
      return dateStr;
    }
  };

  // Filter all BBM Duren Sawit requests
  const isBbmRequest = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
  const allBbmRequests = requests.filter(isBbmRequest);

  // For Role USER, filter by own email. For Finance / Manager / Admin, show ALL requests across all UIDs
  const bbmRequests = (userEmailToMatch && role === Role.USER)
    ? allBbmRequests.filter(r => r.userEmail.toLowerCase() === userEmailToMatch)
    : allBbmRequests;

  // Filter by selected date
  const filteredByDate = selectedDate
    ? bbmRequests.filter(r => {
        const reqDate = getNormalizedYmd(r.tanggalPemakaian) || getNormalizedYmd(r.createdAt);
        return reqDate === selectedDate || r.tanggalPemakaian === selectedDate;
      })
    : bbmRequests;

  // Filter by search query
  const filteredRequests = filteredByDate.filter(r => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const user = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
    const userName = user?.nama || r.userEmail;
    return (
      r.id.toLowerCase().includes(query) ||
      r.userEmail.toLowerCase().includes(query) ||
      userName.toLowerCase().includes(query) ||
      r.siteId.toLowerCase().includes(query) ||
      r.keterangan.toLowerCase().includes(query)
    );
  });

  // Calculate total statistics for selected date / filtered
  const totalCount = filteredRequests.length;
  const totalNominal = filteredRequests.reduce((sum, r) => sum + r.jumlahPengajuan, 0);

  // Check role access for Transfer feature
  const isFinanceOrAdmin = role === Role.FINANCE || role === Role.DIREKTUR || role === Role.ADMINISTRATOR || role === Role.MANAGER || userProfile?.role === Role.FINANCE;

  // Find existing TFDS- transfer request for selected date
  const existingTfds = requests.find(r => {
    const isTfdsReq = r.id.startsWith('TFDS-') || (r.siteId && r.siteId.toLowerCase().includes('transfer pengisian bbm duren sawit'));
    if (!isTfdsReq) return false;
    if (r.status === RequestStatus.CANCELLED || r.status === RequestStatus.REJECTED) return false;
    const reqDate = getNormalizedYmd(r.tanggalPemakaian) || getNormalizedYmd(r.createdAt);
    return reqDate === selectedDate || r.tanggalPemakaian === selectedDate;
  });

  const handleExecuteTransferBbm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferPhotoFile) {
      setTransferError('Harap unggah / ambil foto bukti transfer.');
      return;
    }

    const finalNominal = parseNumericValue(transferNominalInput);
    if (isNaN(finalNominal) || finalNominal <= 0) {
      setTransferError('Harap masukkan nominal transfer yang valid (lebih dari Rp 0).');
      return;
    }

    setIsSubmittingTransfer(true);
    setTransferError(null);

    try {
      const activeEmail = userEmail || userProfile?.email || '';
      const activeManagerEmail = userProfile?.managerEmail || activeEmail;
      const uid = generateUniqueUID('TFDS', selectedDate, requests);
      const formattedSiteId = `Transfer Pengisian BBM Duren Sawit Tanggal ${formatDdMmmYyyy(selectedDate)}`;
      const nowTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

      const newTransferReq: BudgetRequest = {
        id: uid,
        userEmail: activeEmail,
        managerEmail: activeManagerEmail,
        tanggalPemakaian: selectedDate,
        siteId: formattedSiteId,
        jumlahPengajuan: finalNominal,
        managerActionAmount: finalNominal,
        adminActionAmount: finalNominal,
        status: RequestStatus.CLOSED,
        keterangan: transferKeterangan.trim() || `Transfer pengisian BBM Duren Sawit tanggal ${formatDateDisplay(selectedDate)}`,
        managerComment: 'Disetujui otomatis oleh Finance',
        adminComment: 'Disetujui otomatis oleh Finance',
        createdAt: nowTime,
        timestamp: nowTime
      };

      if (onSubmitTransferBbmDS) {
        await onSubmitTransferBbmDS(newTransferReq, transferPhotoFile);
      }

      setIsTransferModalOpen(false);
      setTransferPhotoFile(null);
      setTransferPhotoPreview(null);
      setTransferKeterangan('');
      setTransferNominalInput('');
      alert(`Transfer Pengisian BBM Duren Sawit sebesar ${formatIDR(finalNominal)} berhasil disimpan & diset ke CLOSED! (UID: ${uid})`);
    } catch (err: any) {
      console.error('Gagal memproses Transfer BBM Duren Sawit:', err);
      setTransferError(err.message || 'Gagal menyimpan transaksi Transfer BBM Duren Sawit.');
    } finally {
      setIsSubmittingTransfer(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden animate-scale-up my-auto relative">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-200 shrink-0">
              <Fuel className="w-5.5 h-5.5" />
            </div>
            <div>
              <h2 className="font-display font-extrabold text-slate-800 text-sm sm:text-base">
                Daftar Pengisian BBM Duren Sawit
              </h2>
              {role === Role.USER && userEmailToMatch ? (
                <p className="text-[11px] text-slate-500 font-medium">
                  Menampilkan riwayat untuk: <span className="font-bold text-slate-700">{userEmail}</span>
                </p>
              ) : (
                <p className="text-[11px] text-slate-500 font-medium">
                  Menampilkan pengisian BBM <span className="font-bold text-amber-700">seluruh UID / Petugas</span>
                </p>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-200/60 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-all cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filters & Control Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-white space-y-3 shrink-0">
          
          {/* Top Control Row: Date Filter & Search */}
          <div className={`grid grid-cols-1 ${role !== Role.USER ? 'sm:grid-cols-2' : ''} gap-3`}>
            
            {/* Date Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-amber-500" />
                  <span>Pilih Tanggal Pengisian</span>
                </label>
                {selectedDate !== todayStr && (
                  <button
                    type="button"
                    onClick={() => setSelectedDate(todayStr)}
                    className="text-[10px] font-bold text-amber-600 hover:text-amber-800 underline cursor-pointer"
                  >
                    Hari Ini ({todayStr})
                  </button>
                )}
              </div>
              <div>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all cursor-pointer"
                />
              </div>
            </div>

            {/* Search Input (Hidden for Role.USER) */}
            {role !== Role.USER && (
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <Search className="w-3 h-3 text-indigo-500" />
                  <span>Cari Pengisi / Plat Nomor / UID</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Ketik plat nomor, pengisi, site..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                </div>
              </div>
            )}
          </div>

          {/* Action Bar */}
          {onOpenBbmRefillModal && (
            <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
              <button
                onClick={() => {
                  onOpenBbmRefillModal();
                }}
                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white border border-amber-600 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-amber-200 active:scale-[0.98]"
                id="bbm-refill-modal-active-btn"
              >
                <Fuel className="w-4 h-4 text-white shrink-0" />
                <span>+ Tambahkan Aktifitas Pengisian BBM Duren Sawit</span>
              </button>

              {todayRefillCount > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl font-medium shadow-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Tercatat <strong>{todayRefillCount}x</strong> pengisian BBM hari ini</span>
                </div>
              )}
            </div>
          )}

          {/* Summary Banner for Selected Filter */}
          <div className="bg-amber-50/70 border border-amber-200/60 rounded-2xl p-3 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-xs font-bold text-amber-900">
                {formatDateDisplay(selectedDate)}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-600 font-medium">
                Total Transaksi: <strong className="text-slate-900 font-bold">{totalCount}</strong>
              </span>
              <span className="text-slate-600 font-medium">
                Total Nominal: <strong className="text-amber-700 font-extrabold">{formatIDR(totalNominal)}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Content Body / Scrollable List */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 flex-1 bg-slate-50/50">
          {filteredRequests.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-3 my-4">
              <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 mx-auto flex items-center justify-center">
                <Fuel className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-bold text-slate-800 text-sm">
                  Tidak Ada Transaksi BBM
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 font-medium">
                  {selectedDate
                    ? `Belum ada pengisian BBM Duren Sawit tercatat pada tanggal ${formatDateDisplay(selectedDate)}.`
                    : 'Tidak ada transaksi pengisian BBM Duren Sawit yang cocok dengan kriteria pencarian.'}
                </p>
              </div>
              {selectedDate && (
                <button
                  onClick={() => setSelectedDate('')}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Tampilkan Semua Tanggal</span>
                </button>
              )}
            </div>
          ) : (
            filteredRequests.map((req) => {
              const user = profiles.find(p => p.email.toLowerCase() === req.userEmail.toLowerCase());
              const userName = user?.nama || req.userEmail;
              const usageItem = usageItems.find(item => item.requestId === req.id || item.id.startsWith(req.id) || (item.requestId && req.id.includes(item.requestId)));
              const firstBuktiUrl = req.buktiTransferUrl ? req.buktiTransferUrl.split('||')[0].trim() : '';
              const firstFileId = req.buktiTransferFileId ? req.buktiTransferFileId.split('||')[0].trim() : '';
              const rawBuktiPhoto = usageItem?.buktiUrl || firstBuktiUrl;
              const rawBuktiFileId = usageItem?.buktiFileId || firstFileId;
              const displayImgUrl = getImageSrc(rawBuktiPhoto, rawBuktiFileId);
              const isImgFailed = imageErrorMap[req.id];

              return (
                <div
                  key={req.id}
                  className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm hover:border-amber-300 hover:shadow-md transition-all space-y-3"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md text-[10px] font-mono font-bold">
                          {req.id}
                        </span>
                        <span className="text-xs font-bold text-slate-800">
                          {userName}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          ({req.userEmail})
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium flex items-center gap-1 pt-0.5">
                        <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>Tanggal Pengisian : {formatShortDateDisplay(req.tanggalPemakaian)}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/60 rounded-lg text-[10px] font-bold">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Selesai</span>
                      </span>
                    </div>
                  </div>

                  {/* Card Details Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        Lokasi / Pos
                      </span>
                      <p className="text-xs font-bold text-slate-800 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span>{req.siteId}</span>
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        Nominal BBM
                      </span>
                      <p className="text-sm font-extrabold font-display text-amber-600 mt-0.5">
                        {formatIDR(req.jumlahPengajuan)}
                      </p>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                        Keterangan / Plat Nomor
                      </span>
                      <p className="text-xs font-medium text-slate-700 mt-0.5 line-clamp-2">
                        {req.keterangan || '-'}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons Row */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2 flex-wrap">
                    {/* Administrator AI BBM Receipt Check Button */}
                    {role === Role.ADMINISTRATOR && (() => {
                      const aiBbmRes = aiBbmReceiptResults[req.id];
                      let btnStyle = 'bg-gradient-to-r from-amber-500/10 via-amber-600/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20 text-amber-900 border-amber-300/80';
                      let btnText = 'Cek AI Nota BBM';
                      let btnTitle = 'Periksa kesesuaian nominal nota BBM Duren Sawit vs nominal input sistem';

                      if (aiBbmRes) {
                        if (aiBbmRes.statusKesesuaian === 'SESUAI') {
                          btnStyle = 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 ring-1 ring-emerald-200';
                          btnText = '🟢 Nota Sesuai';
                          btnTitle = `Nota Sesuai 100% (${formatIDR(aiBbmRes.nominalNota)})`;
                        } else if (aiBbmRes.statusKesesuaian === 'TIDAK_SESUAI') {
                          btnStyle = 'bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-300 ring-1 ring-rose-200';
                          btnText = `🔴 Beda Nominal (${formatIDR(aiBbmRes.nominalNota)})`;
                          btnTitle = `Terdeteksi Perbedaan Nominal: Nota ${formatIDR(aiBbmRes.nominalNota)} vs Input ${formatIDR(aiBbmRes.nominalInput)}`;
                        } else {
                          btnStyle = 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 ring-1 ring-amber-200';
                          btnText = '🟡 Nota Tidak Terbaca';
                          btnTitle = 'Foto nota buram / tidak terbaca jelas oleh AI';
                        }
                      }

                      return (
                        <button
                          type="button"
                          onClick={() => handleRunAiBbmReceiptCheck(req, usageItem)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs border ${btnStyle}`}
                          title={btnTitle}
                        >
                          <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>{btnText}</span>
                        </button>
                      );
                    })()}

                    {rawBuktiPhoto && (
                      <button
                        type="button"
                        onClick={() => setSelectedPhotoUrl(displayImgUrl || rawBuktiPhoto)}
                        className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-amber-600" />
                        <span>Lihat Nota</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        const targetDate = req.tanggalPemakaian ? req.tanggalPemakaian.substring(0, 10) : '';
                        setSelectedUserActivityModal({
                          userEmail: req.userEmail,
                          userName,
                          tanggal: targetDate
                        });
                      }}
                      className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200/80 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                    >
                      <Activity className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Aktivitas</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Container Badge TRANSFER-BBM Duren Sawit (Role Finance / Management) */}
        {isFinanceOrAdmin && (
          <div className="mx-4 sm:mx-5 my-3 bg-gradient-to-r from-amber-500/10 via-amber-50 to-orange-50/80 border-2 border-amber-300/80 rounded-2xl p-3.5 shadow-xs space-y-2.5 shrink-0">
            <div className="flex items-center justify-between flex-wrap gap-2 border-b border-amber-200/60 pb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold shadow-xs">
                  <Send className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-amber-950 flex items-center gap-1.5">
                    <span>TRANSFER - BBM Duren Sawit</span>
                  </h4>
                  <p className="text-[10px] text-amber-800 font-medium">
                    Rekapitulasi Transfer Harian Pengisian BBM Duren Sawit
                  </p>
                </div>
              </div>

              {existingTfds ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-lg text-[11px] font-bold shadow-2xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>SUDAH DITRANSFER</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-[11px] font-bold shadow-2xs">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span>BELUM DITRANSFER</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs items-center">
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                  Tanggal Transfer
                </span>
                <span className="font-mono font-bold text-slate-800 mt-0.5 block">
                  {selectedDate ? formatDateDisplay(selectedDate) : '-'}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                  Nominal Transfer
                </span>
                <span className="font-display font-extrabold text-amber-700 text-xs sm:text-sm mt-0.5 block">
                  {formatIDR(existingTfds ? (existingTfds.adminActionAmount || existingTfds.jumlahPengajuan) : totalNominal)}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                  Bukti Transfer
                </span>
                {existingTfds && existingTfds.buktiTransferUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (onPreviewDocument) {
                        onPreviewDocument(existingTfds.buktiTransferUrl);
                      } else {
                        setSelectedPhotoUrl(getImageSrc(existingTfds.buktiTransferUrl, existingTfds.buktiTransferFileId));
                      }
                    }}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1 mt-0.5 cursor-pointer"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Lihat Bukti</span>
                  </button>
                ) : (
                  <span className="text-slate-400 font-medium mt-0.5 block">-</span>
                )}
              </div>

              <div className="flex items-center justify-end col-span-2 sm:col-span-1">
                {existingTfds ? (
                  <button
                    type="button"
                    disabled
                    className="w-full sm:w-auto px-3.5 py-1.5 bg-emerald-600/15 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-default opacity-90"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Sudah Ditransfer</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!selectedDate || totalNominal <= 0}
                    onClick={() => {
                      setTransferNominalInput(totalNominal > 0 ? totalNominal.toString() : '');
                      setTransferKeterangan(`Transfer pengisian BBM Duren Sawit tanggal ${formatDateDisplay(selectedDate)}`);
                      setTransferPhotoFile(null);
                      setTransferPhotoPreview(null);
                      setTransferError(null);
                      setIsTransferModalOpen(true);
                    }}
                    className={`w-full sm:w-auto px-4 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 ${
                      !selectedDate || totalNominal <= 0
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed border border-slate-300 shadow-none'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-700 cursor-pointer shadow-emerald-200'
                    }`}
                  >
                    <Send className="w-3.5 h-3.5 text-white" />
                    <span>Transfer</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-slate-500 font-medium">
            Menampilkan <strong className="text-slate-800">{filteredRequests.length}</strong> dari {bbmRequests.length} total rekaman BBM.
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
          >
            Tutup
          </button>
        </div>

      </div>

      {/* Expanded Image Viewer Modal */}
      {selectedPhotoUrl && (
        <div 
          className="fixed inset-0 z-[100] bg-slate-900/15 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
          onClick={() => setSelectedPhotoUrl(null)}
        >
          <div 
            className="relative bg-slate-900 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden p-2 shadow-2xl border border-slate-800 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-2 pb-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 px-2">Pratinjau Foto Kegiatan</span>
              <button
                type="button"
                onClick={() => setSelectedPhotoUrl(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-white hover:bg-slate-700 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 flex flex-col items-center justify-center">
              <ZoomableImage
                src={selectedPhotoUrl}
                alt="Foto Bukti Kegiatan"
                darkTheme={true}
                maxHeightClass="max-h-[65vh]"
              />
            </div>
          </div>
        </div>
      )}

      {/* User Activity List Popup Modal */}
      {selectedUserActivityModal && (
        <div 
          className="fixed inset-0 z-70 bg-slate-900/15 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in"
          onClick={() => setSelectedUserActivityModal(null)}
        >
          <div 
            className="bg-white w-full max-w-xl rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[85vh] animate-scale-up my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shrink-0 font-bold">
                  <Activity className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-sm text-white">
                    Daftar Aktivitas User
                  </h3>
                  <p className="text-xs text-indigo-200/90 mt-0.5">
                    {selectedUserActivityModal.userName} • <span className="font-mono text-[11px] opacity-80">{selectedUserActivityModal.userEmail}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserActivityModal(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Date Info Bar */}
            <div className="bg-indigo-50/80 border-b border-indigo-100/60 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                <Calendar className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>Tanggal Transaksi: {formatDateDisplay(selectedUserActivityModal.tanggal)}</span>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-0.5 bg-indigo-200/60 text-indigo-800 rounded-full font-mono">
                {userActivitiesForDate.length} Kegiatan
              </span>
            </div>

            {/* Activity List */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 flex-1 bg-slate-50/50">
              {userActivitiesForDate.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-2 my-2">
                  <Activity className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-700">Tidak Ada Data Aktivitas</p>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                    Belum ada pencatatan aktivitas/kegiatan untuk <strong>{selectedUserActivityModal.userName}</strong> pada tanggal {formatDateDisplay(selectedUserActivityModal.tanggal)}.
                  </p>
                </div>
              ) : (
                userActivitiesForDate.map((act) => {
                  const displayPhoto = act.buktiFileId?.trim()
                    ? `https://drive.google.com/thumbnail?sz=w1000&id=${act.buktiFileId.trim()}`
                    : act.buktiUrl;

                  const gmapsUrl = act.coordinatesDb && act.coordinatesActual
                    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(act.coordinatesDb.trim())}&destination=${encodeURIComponent(act.coordinatesActual.trim())}`
                    : act.coordinatesActual
                      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.coordinatesActual.trim())}`
                      : act.coordinatesDb
                        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.coordinatesDb.trim())}`
                        : '';

                  const distMeters = getDistanceInMeters(act.coordinatesDb, act.coordinatesActual);
                  const isDistanceFar = distMeters !== null && distMeters > 500;

                  return (
                    <div key={act.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-indigo-100">
                          SITE: {act.siteId}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 font-semibold">
                          {act.createdAt || ''}
                        </span>
                      </div>

                      <h4 className="text-xs font-bold text-slate-900">{act.siteName}</h4>
                      <p className="text-xs text-slate-600 font-normal leading-relaxed whitespace-pre-wrap">
                        {act.keterangan}
                      </p>

                      {/* Admin-Only Fake GPS Badge */}
                      {role === Role.ADMINISTRATOR && act.indikasiFake && (
                        <div className="p-2 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs">
                          <AlertOctagon className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <span className="font-bold text-rose-900 block text-[11px]">
                              Indikasi Fake GPS Terdeteksi
                            </span>
                            <span className="text-[10px] text-rose-700 block mt-0.5 leading-relaxed">
                              Alasan: {act.fakeReason || 'Akurasi, altitude, atau timestamp anomali'}
                            </span>
                          </div>
                        </div>
                      )}



                      {/* Photo & GPS Action Buttons */}
                      {(act.buktiUrl || gmapsUrl) && (
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {act.buktiUrl ? (
                              <button
                                type="button"
                                onClick={() => setSelectedPhotoUrl(displayPhoto)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 rounded-xl text-xs font-bold transition-all cursor-pointer border border-indigo-200/60 shadow-2xs"
                              >
                                <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Foto Bukti Kegiatan</span>
                              </button>
                            ) : null}

                            {/* Administrator AI Screen Recapture Check Button */}
                            {role === Role.ADMINISTRATOR && act.buktiUrl && (() => {
                              const aiRes = getAiRecaptureResult(act);
                              const isDbSaved = !!(act.aiRecaptureVerdict || aiRes?.checkedAt);

                              let btnStyle = 'bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-purple-500/10 hover:from-amber-500/20 hover:to-indigo-500/20 text-indigo-900 border-indigo-200';
                              let btnText = 'AI Screen Recapture';
                              let btnTitle = 'Periksa keaslian foto dengan AI: foto langsung vs foto layar';

                              if (aiRes) {
                                if (aiRes.isRecapture || aiRes.verdict === 'SCREEN_RECAPTURE_DETECTED') {
                                  btnStyle = 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-300 ring-1 ring-rose-200';
                                  btnText = `🚨 Foto Layar (${aiRes.confidence}%)`;
                                  btnTitle = `Terindikasi Foto Layar (${aiRes.confidence}%)${isDbSaved ? ' - Tersimpan di Database' : ''}`;
                                } else if (aiRes.verdict === 'SUSPICIOUS') {
                                  btnStyle = 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-300 ring-1 ring-amber-200';
                                  btnText = `⚠️ Ragu (${aiRes.confidence}%)`;
                                  btnTitle = `Mencurigakan / Butuh Verifikasi Manual (${aiRes.confidence}%)${isDbSaved ? ' - Tersimpan di Database' : ''}`;
                                } else {
                                  btnStyle = 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300 ring-1 ring-emerald-200';
                                  btnText = `🛡️ Foto Asli (${aiRes.confidence}%)`;
                                  btnTitle = `Foto Asli / Langsung (${aiRes.confidence}%)${isDbSaved ? ' - Tersimpan di Database' : ''}`;
                                }
                              }

                              return (
                                <button
                                  type="button"
                                  onClick={() => handleRunAiRecapture(act)}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border shadow-2xs ${btnStyle}`}
                                  title={btnTitle}
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span>{btnText}</span>
                                </button>
                              );
                            })()}
                          </div>

                          {gmapsUrl && (() => {
                            const currentRole = role || Role.USER;
                            const showDistanceWarning = isDistanceFar && currentRole !== Role.USER;
                            return (
                              <a
                                href={gmapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border shadow-2xs ${
                                  showDistanceWarning
                                    ? 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200'
                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200/60'
                                }`}
                              >
                                <MapPin className={`w-3.5 h-3.5 ${showDistanceWarning ? 'text-red-600' : 'text-emerald-600'}`} />
                                <span className={showDistanceWarning ? 'text-red-600 font-bold' : ''}>
                                  GPS Terdeteksi (Lihat Peta){showDistanceWarning ? ` [>${Math.round(distMeters)}m]` : ''}
                                </span>
                              </a>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-white border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedUserActivityModal(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Screen Recapture Forensic Modal */}
      <AiScreenRecaptureModal
        isOpen={isAiRecaptureModalOpen}
        onClose={() => setIsAiRecaptureModalOpen(false)}
        activity={selectedAiActivity}
        photoUrl={selectedAiPhotoUrl}
        photoFileId={selectedAiPhotoFileId}
        result={selectedAiActivity ? getAiRecaptureResult(selectedAiActivity) : null}
        isLoading={isAiAnalyzing}
        error={aiAnalysisError}
        onReanalyze={() => {
          if (selectedAiActivity) {
            handleRunAiRecapture(selectedAiActivity, true);
          }
        }}
        profiles={profiles}
      />

      {/* AI BBM Receipt OCR Modal (Role Administrator) */}
      <AiBbmReceiptModal
        isOpen={isAiBbmModalOpen}
        onClose={() => setIsAiBbmModalOpen(false)}
        request={selectedBbmRequest}
        usageItem={selectedBbmUsageItem}
        photoUrl={selectedBbmPhotoUrl}
        fileId={selectedBbmPhotoFileId}
        result={selectedBbmRequest ? aiBbmReceiptResults[selectedBbmRequest.id] || null : null}
        isAnalyzing={isAiBbmAnalyzing}
        error={aiBbmAnalysisError}
        onReanalyze={() => {
          if (selectedBbmRequest) {
            handleRunAiBbmReceiptCheck(selectedBbmRequest, selectedBbmUsageItem || undefined, true);
          }
        }}
      />

      {/* Modal Form Transfer Pengisian BBM Duren Sawit */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-[100010] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-lg w-full overflow-hidden my-auto animate-scale-up">
            
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center border border-white/20">
                  <Send className="w-5 h-5 text-amber-100" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold tracking-tight">Form Transfer BBM Duren Sawit</h3>
                  <p className="text-xs text-amber-100/90 font-medium">Rekapitulasi Pengisian BBM Duren Sawit Harian</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleExecuteTransferBbm} className="p-5 space-y-4">
              {transferError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{transferError}</span>
                </div>
              )}

              {/* Tanggal Transfer (Locked) */}
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                  <span>Tanggal Transfer (Sesuai Tanggal Pengisian)</span>
                  <Lock className="w-3 h-3 text-amber-600" />
                </label>
                <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 flex items-center justify-between">
                  <span>{formatDateDisplay(selectedDate)}</span>
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md font-extrabold uppercase">Terkunci</span>
                </div>
              </div>

              {/* Nominal Transfer (Editable) */}
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-slate-800">
                    <span>Nominal Transfer (Rp)</span>
                    <strong className="text-rose-500">*</strong>
                  </span>
                  <span className="text-[10px] text-amber-700 font-semibold">Dapat Disesuaikan</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-xs">Rp</span>
                  <input
                    type="number"
                    value={transferNominalInput}
                    onChange={(e) => setTransferNominalInput(e.target.value)}
                    placeholder="0"
                    className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
                {totalNominal > 0 && (
                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Total Pengisian Hari Ini: <strong>{formatIDR(totalNominal)}</strong></span>
                    {parseNumericValue(transferNominalInput) !== totalNominal && (
                      <button
                        type="button"
                        onClick={() => setTransferNominalInput(totalNominal.toString())}
                        className="text-amber-700 font-bold underline hover:text-amber-800 cursor-pointer"
                      >
                        Reset ke Total Hari Ini
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Site ID Info */}
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                  Site ID / Keterangan Sistem
                </label>
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 font-mono">
                  Transfer Pengisian BBM Duren Sawit Tanggal {formatDdMmmYyyy(selectedDate)}
                </div>
              </div>

              {/* Keterangan (Optional) */}
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                  Keterangan (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={transferKeterangan}
                  onChange={(e) => setTransferKeterangan(e.target.value)}
                  placeholder="Catatan tambahan transfer..."
                  className="w-full p-3 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              {/* Foto Bukti Transfer (Wajib) */}
              <div>
                <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-slate-800">
                    <span>Foto Bukti Transfer</span>
                    <strong className="text-rose-500">*</strong>
                  </span>
                  <span className="text-[10px] text-amber-700 font-normal">Kamera HP / Galeri</span>
                </label>

                {transferPhotoPreview ? (
                  <div className="relative rounded-2xl overflow-hidden border-2 border-amber-300 shadow-sm bg-slate-900 group">
                    <img
                      src={transferPhotoPreview}
                      alt="Bukti Transfer Preview"
                      className="w-full h-44 object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setTransferPhotoFile(null);
                        setTransferPhotoPreview(null);
                      }}
                      className="absolute top-2 right-2 p-1.5 bg-rose-600/90 text-white rounded-xl text-xs font-bold shadow-md hover:bg-rose-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="border-2 border-dashed border-amber-300 hover:border-amber-500 bg-amber-50/50 hover:bg-amber-50 rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all text-center">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center mb-1.5 shadow-2xs">
                      <Camera className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-bold text-amber-900">Ambil / Unggah Foto Bukti Transfer</span>
                    <span className="text-[10px] text-amber-700 mt-0.5">Format JPG / PNG / WEBP</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setTransferPhotoFile(file);
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setTransferPhotoPreview(reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  disabled={isSubmittingTransfer}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTransfer || !transferPhotoFile}
                  className={`px-5 py-2.5 rounded-xl text-xs font-extrabold text-white transition-all flex items-center gap-2 shadow-md ${
                    isSubmittingTransfer || !transferPhotoFile
                      ? 'bg-amber-300 cursor-not-allowed shadow-none'
                      : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 cursor-pointer shadow-amber-200 active:scale-95'
                  }`}
                >
                  {isSubmittingTransfer ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Menyimpan Transfer...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Simpan & Proses Transfer</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};
