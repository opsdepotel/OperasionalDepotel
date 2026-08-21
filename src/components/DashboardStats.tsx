/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Role, BudgetRequest, UsageReportItem, RequestStatus, ItemStatus, UserProfile, UserActivity, ItemReviewHistory } from '../types';
import { parseNumericValue, formatDivisiSubDivisi } from '../lib/googleApi';
import { detectFakeGps } from '../lib/fakeGpsDetector';
import { useBackHandler } from '../hooks/useBackHandler';
import { Clock, CheckCircle2, AlertCircle, Coins, CreditCard, ClipboardCheck, ArrowRightLeft, ShieldCheck, CalendarCheck, Fuel, AlertTriangle, FileText, XCircle, Eye, X, Search, FileSpreadsheet, Download, MapPin, Navigation, RefreshCw, Copy, Check, ExternalLink, ShieldAlert, Loader2, ArrowLeft, Pause, Play, Radio, Plus } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface DashboardStatsProps {
  role: Role;
  email: string;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  activeFilter?: string;
  onSelectFilter?: (filterKey: string) => void;
  onManageUsers?: () => void;
  onOpenUserDashboardPreview?: () => void;
  onOpenAdjustment?: () => void;
  onOpenTransferList?: () => void;
  onOpenReportsModal?: () => void;
  profiles?: UserProfile[];
  activities?: UserActivity[];
  onOpenActivities?: () => void;
  userProfile?: UserProfile | null;
  onOpenBbmModal?: () => void;
  onOpenBbmListModal?: () => void;
  histories?: ItemReviewHistory[];
  activeTab?: 'APPROVAL' | 'SUBMISSION';
  onSelectTab?: (tab: 'APPROVAL' | 'SUBMISSION') => void;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  role,
  email,
  requests,
  usageItems,
  activeFilter = 'ALL',
  onSelectFilter,
  onManageUsers,
  onOpenUserDashboardPreview,
  onOpenAdjustment,
  onOpenTransferList,
  onOpenReportsModal,
  profiles = [],
  activities = [],
  onOpenActivities,
  userProfile,
  onOpenBbmModal,
  onOpenBbmListModal,
  histories = [],
  activeTab,
  onSelectTab
}) => {
  const [internalTab, setInternalTab] = useState<'APPROVAL' | 'SUBMISSION'>('APPROVAL');
  const currentTab = activeTab !== undefined ? activeTab : internalTab;
  const handleTabChange = (newTab: 'APPROVAL' | 'SUBMISSION') => {
    setInternalTab(newTab);
    if (onSelectTab) {
      onSelectTab(newTab);
    }
  };
  const [isTransactionReportOpen, setIsTransactionReportOpen] = useState(false);
  const [transactionSearchQuery, setTransactionSearchQuery] = useState('');

  useBackHandler(isTransactionReportOpen, () => setIsTransactionReportOpen(false), 'dashboardStats_transactionReport');

  const [isGpsModalOpen, setIsGpsModalOpen] = useState(false);
  const [isFetchingGpsModal, setIsFetchingGpsModal] = useState(false);
  const [gpsModalPosition, setGpsModalPosition] = useState<GeolocationPosition | null>(null);
  const [gpsModalError, setGpsModalError] = useState<string | null>(null);
  const [gpsFetchDurationMs, setGpsFetchDurationMs] = useState<number | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<string>('Memeriksa...');
  const [gpsUpdateCount, setGpsUpdateCount] = useState<number>(0);
  const [lastGpsCheckTime, setLastGpsCheckTime] = useState<Date | null>(null);
  const [isAutoGpsActive, setIsAutoGpsActive] = useState<boolean>(true);
  const [prevGpsModalPosition, setPrevGpsModalPosition] = useState<GeolocationPosition | null>(null);

  const [direkturGroupTab, setDirekturGroupTab] = useState<'APPROVAL' | 'MONITORING'>(() => {
    try {
      const saved = localStorage.getItem('applet_direktur_dashboard_tab');
      if (saved === 'APPROVAL' || saved === 'MONITORING') return saved;
    } catch (e) {
      // ignore
    }
    return 'APPROVAL';
  });

  const updateDirekturTab = (newTab: 'APPROVAL' | 'MONITORING') => {
    setDirekturGroupTab(newTab);
    try {
      localStorage.setItem('applet_direktur_dashboard_tab', newTab);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    if (role === Role.DIREKTUR && activeFilter) {
      if (activeFilter === 'DIREKTUR_APPROVAL' || activeFilter === 'DIREKTUR_RECONCILIATION') {
        updateDirekturTab('APPROVAL');
      } else if (['PENDING', 'APPROVED', 'REPORTING', 'CLOSED'].includes(activeFilter)) {
        updateDirekturTab('MONITORING');
      }
    }
  }, [role, activeFilter]);

  useBackHandler(isGpsModalOpen, () => setIsGpsModalOpen(false), 'dashboardStats_gpsModal');

  useEffect(() => {
    if (!isGpsModalOpen) {
      setGpsUpdateCount(0);
      setGpsModalPosition(null);
      setPrevGpsModalPosition(null);
      setGpsModalError(null);
      setLastGpsCheckTime(null);
      return;
    }

    if (!navigator.geolocation) {
      setGpsModalError('Perangkat atau browser Anda tidak mendukung pencarian lokasi GPS.');
      return;
    }

    if (!isAutoGpsActive) return;

    setIsFetchingGpsModal(prev => gpsModalPosition ? false : true);
    setGpsModalError(null);

    let watchId: number | null = null;
    let intervalId: any = null;
    let startTime = Date.now();

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((p) => {
        setPermissionState(p.state);
      }).catch(() => {
        setPermissionState('Aktif / Standard');
      });
    } else {
      setPermissionState('Aktif / Standard');
    }

    const handlePos = (pos: GeolocationPosition) => {
      const duration = Date.now() - startTime;
      setGpsModalPosition(prev => {
        if (prev) setPrevGpsModalPosition(prev);
        return pos;
      });
      setGpsFetchDurationMs(duration);
      setIsFetchingGpsModal(false);
      setGpsModalError(null);
      setGpsUpdateCount(c => c + 1);
      setLastGpsCheckTime(new Date());
    };

    const handleErr = (err: GeolocationPositionError) => {
      let msg = 'Gagal mengambil koordinat lokasi GPS dari perangkat.';
      if (err.code === err.PERMISSION_DENIED) {
        msg = 'Akses lokasi (GPS) ditolak. Harap beri izin akses lokasi pada browser/perangkat Anda.';
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        msg = 'Sinyal GPS atau posisi tidak tersedia pada perangkat.';
      } else if (err.code === err.TIMEOUT) {
        msg = 'Waktu pengambilan sinyal GPS habis (timeout). Silakan klik Ulangi Cek GPS.';
      }
      setGpsModalError(msg);
      setIsFetchingGpsModal(false);
    };

    // First immediate check
    startTime = Date.now();
    navigator.geolocation.getCurrentPosition(handlePos, handleErr, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });

    // Real-time stream with watchPosition
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        startTime = Date.now();
        handlePos(pos);
      },
      (err) => {},
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    // Continuous repetition interval every 2.5s
    intervalId = setInterval(() => {
      startTime = Date.now();
      navigator.geolocation.getCurrentPosition(handlePos, () => {}, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      });
    }, 2500);

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [isGpsModalOpen, isAutoGpsActive]);

  const fetchGpsDataManual = () => {
    if (!navigator.geolocation) return;
    setIsFetchingGpsModal(true);
    setGpsModalError(null);
    const startTime = Date.now();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsModalPosition(pos);
        setGpsFetchDurationMs(Date.now() - startTime);
        setIsFetchingGpsModal(false);
        setGpsUpdateCount(c => c + 1);
        setLastGpsCheckTime(new Date());
      },
      (err) => {
        setGpsModalError('Gagal memperbarui posisi GPS.');
        setIsFetchingGpsModal(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleOpenGpsCheck = () => {
    setIsGpsModalOpen(true);
    setIsAutoGpsActive(true);
  };

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const formatDateDisplay = (dateStr?: string): string => {
    if (!dateStr) return '-';
    const clean = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
      const [y, m, d] = clean.substring(0, 10).split('-');
      return `${d}/${m}/${y}`;
    }
    return clean;
  };

  const getRequestDate = (r: BudgetRequest): string => {
    const rawDate = r.tanggalPemakaian || r.createdAt || r.timestamp || '';
    return formatDateDisplay(rawDate);
  };

  const getTimestampMs = (r: BudgetRequest): number => {
    const timeStr = r.timestamp || r.createdAt || r.tanggalPemakaian || '';
    if (!timeStr) return 0;
    const parsed = new Date(timeStr).getTime();
    if (!isNaN(parsed) && parsed > 0) return parsed;
    if (/^\d{4}-\d{2}-\d{2}/.test(timeStr)) {
      return new Date(timeStr.substring(0, 10)).getTime();
    }
    return 0;
  };

  const getTransferTimestampMs = (r: BudgetRequest): number => {
    if (histories && histories.length > 0) {
      const transferLog = histories.find(h => 
        (h.requestUid === r.id || h.itemUid === r.id) &&
        (h.status === 'TRANSFERRED' || h.status === RequestStatus.TRANSFERRED || h.actionType === 'APPROVAL_FINANCE')
      );
      if (transferLog && transferLog.timestamp) {
        const parsed = new Date(transferLog.timestamp).getTime();
        if (!isNaN(parsed) && parsed > 0) return parsed;
        if (/^\d{4}-\d{2}-\d{2}/.test(transferLog.timestamp)) {
          return new Date(transferLog.timestamp.substring(0, 10)).getTime();
        }
      }
    }
    return getTimestampMs(r);
  };

  const getTransferDateDisplay = (r: BudgetRequest): string => {
    if (histories && histories.length > 0) {
      const transferLog = histories.find(h => 
        (h.requestUid === r.id || h.itemUid === r.id) &&
        (h.status === 'TRANSFERRED' || h.status === RequestStatus.TRANSFERRED || h.actionType === 'APPROVAL_FINANCE')
      );
      if (transferLog && transferLog.timestamp) {
        return formatDateDisplay(transferLog.timestamp);
      }
    }
    return getRequestDate(r);
  };

  const getStatusLabel = (status: RequestStatus, userEmail?: string) => {
    const requesterProfile = userEmail ? profiles.find(p => p.email.trim().toLowerCase() === userEmail.trim().toLowerCase()) : null;
    const isRequesterManagerOrFinance = requesterProfile ? (requesterProfile.role === Role.MANAGER || requesterProfile.role === Role.FINANCE) : (role === Role.MANAGER || role === Role.FINANCE);
    const supervisorTitle = isRequesterManagerOrFinance ? 'DIREKTUR' : 'MANAGER';

    switch (status) {
      case RequestStatus.PENDING_APPROVAL:
        return `PENDING ${supervisorTitle}`;
      case RequestStatus.APPROVED:
      case RequestStatus.PARTIALLY_APPROVED:
        return 'DISETUJUI';
      case RequestStatus.TRANSFERRED:
        return 'DITRANSFER';
      case RequestStatus.REPORTING:
        return 'PROSES LAPORAN';
      case RequestStatus.REVIEW_MANAGER:
        return `REVIEW ${supervisorTitle}`;
      case RequestStatus.REVIEW_ADMIN:
        return 'REVIEW FINANCE';
      case RequestStatus.CLOSED:
        return 'SELESAI (CLOSED)';
      case RequestStatus.REJECTED:
        return 'DITOLAK';
      case RequestStatus.PENDING_TALANGAN_TRANSFER:
        return 'WAITING REIMBURSE';
      default:
        return status;
    }
  };

  const handleExportPDF = () => {
    const isBbmReq = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
    const isBbmItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

    const myUserReqs = requests.filter(r => 
      r.userEmail.toLowerCase() === email.toLowerCase() && 
      r.status !== RequestStatus.CANCELLED && 
      !isBbmReq(r)
    ).sort((a, b) => {
      const timeA = getTransferTimestampMs(a);
      const timeB = getTransferTimestampMs(b);
      if (timeA !== timeB) return timeB - timeA;
      return b.id.localeCompare(a.id);
    });

    const filteredReqs = myUserReqs;

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const nowStr = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('LAPORAN TRANSAKSI SALDO OPERASIONAL USER', 14, 15);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`User: ${userProfile?.nama || email} (${email}) | Divisi: ${formatDivisiSubDivisi(userProfile?.divisi, userProfile?.subDivisi)}`, 14, 21);
    doc.text(`Dicetak Pada: ${nowStr}`, 283, 21, { align: 'right' });

    // Summary Box
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 25, 269, 12, 2, 2, 'FD');

    const totPengajuan = filteredReqs.reduce((sum, r) => sum + r.jumlahPengajuan, 0);
    const totTransfer = filteredReqs.reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totDilaporkan = filteredReqs.reduce((sum, r) => {
      const reqUsage = usageItems.filter(item => 
        item.requestId === r.id && 
        item.statusManager === ItemStatus.APPROVED && 
        item.statusAdmin === ItemStatus.APPROVED && 
        !isBbmItem(item)
      );
      return sum + reqUsage.reduce((sub, u) => sub + u.nominal, 0);
    }, 0);
    const totSisa = totTransfer - totDilaporkan;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Total Pengajuan: ${formatIDR(totPengajuan)}`, 18, 32.5);
    doc.text(`Total Ditransfer: ${formatIDR(totTransfer)}`, 85, 32.5);
    doc.text(`Total Dilaporkan: ${formatIDR(totDilaporkan)}`, 155, 32.5);
    doc.text(`Sisa Saldo Operasional: ${formatIDR(totSisa)}`, 225, 32.5);

    const tableRows = filteredReqs.map((r, idx) => {
      const reqUsageApproved = usageItems.filter(item => 
        item.requestId === r.id && 
        item.statusManager === ItemStatus.APPROVED && 
        item.statusAdmin === ItemStatus.APPROVED && 
        !isBbmItem(item)
      );
      const reportedApproved = reqUsageApproved.reduce((sum, u) => sum + u.nominal, 0);
      const sisa = r.adminActionAmount - reportedApproved;

      const uidDisplay = r.siteId ? `${r.id}\n(Site: ${r.siteId})` : r.id;
      const sisaDisplay = sisa > 0 ? `+${formatIDR(sisa)}` : formatIDR(sisa);

      return [
        idx + 1,
        getRequestDate(r),
        uidDisplay,
        formatIDR(r.jumlahPengajuan),
        formatIDR(r.adminActionAmount),
        formatIDR(reportedApproved),
        sisaDisplay,
        getStatusLabel(r.status)
      ];
    });

    autoTable(doc, {
      startY: 40,
      head: [['No', 'Tanggal', 'UID / Site', 'Pengajuan', 'Ditransfer', 'Dilaporkan', 'Lebih / Sisa', 'Status']],
      body: tableRows,
      theme: 'grid',
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 8,
        textColor: [30, 41, 59]
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { halign: 'center', cellWidth: 25 },
        2: { cellWidth: 44 },
        3: { halign: 'right', cellWidth: 35 },
        4: { halign: 'right', cellWidth: 35 },
        5: { halign: 'right', cellWidth: 35 },
        6: { halign: 'right', cellWidth: 38 },
        7: { halign: 'center', cellWidth: 47 }
      },
      foot: [[
        { content: 'TOTAL REKAPITULASI LAPORAN', colSpan: 3, styles: { halign: 'center', fontStyle: 'bold', fillColor: [241, 245, 249] } },
        { content: formatIDR(totPengajuan), styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } },
        { content: formatIDR(totTransfer), styles: { halign: 'right', fontStyle: 'bold', textColor: [67, 56, 202], fillColor: [241, 245, 249] } },
        { content: formatIDR(totDilaporkan), styles: { halign: 'right', fontStyle: 'bold', textColor: [4, 120, 87], fillColor: [241, 245, 249] } },
        { content: formatIDR(totSisa), styles: { halign: 'right', fontStyle: 'bold', textColor: totSisa >= 0 ? [4, 120, 87] : [190, 18, 60], fillColor: [241, 245, 249] } },
        { content: '', styles: { fillColor: [241, 245, 249] } }
      ]],
      margin: { left: 14, right: 14 }
    });

    const cleanName = (userProfile?.nama || email).replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(`Laporan_Saldo_Operasional_${cleanName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const renderStatusBadge = (status: RequestStatus, userEmail?: string) => {
    const requesterProfile = userEmail ? profiles.find(p => p.email.trim().toLowerCase() === userEmail.trim().toLowerCase()) : null;
    const isRequesterManagerOrFinance = requesterProfile ? (requesterProfile.role === Role.MANAGER || requesterProfile.role === Role.FINANCE) : (role === Role.MANAGER || role === Role.FINANCE);
    const supervisorTitle = isRequesterManagerOrFinance ? 'DIREKTUR' : 'MANAGER';

    switch (status) {
      case RequestStatus.PENDING_APPROVAL:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">PENDING {supervisorTitle}</span>;
      case RequestStatus.APPROVED:
      case RequestStatus.PARTIALLY_APPROVED:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">DISETUJUI</span>;
      case RequestStatus.TRANSFERRED:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">DITRANSFER</span>;
      case RequestStatus.REPORTING:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">PROSES LAPORAN</span>;
      case RequestStatus.REVIEW_MANAGER:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-100 text-cyan-800 border border-cyan-200">REVIEW {supervisorTitle}</span>;
      case RequestStatus.REVIEW_ADMIN:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">REVIEW FINANCE</span>;
      case RequestStatus.CLOSED:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">SELESAI (CLOSED)</span>;
      case RequestStatus.REJECTED:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">DITOLAK</span>;
      case RequestStatus.PENDING_TALANGAN_TRANSFER:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 border border-orange-200">WAITING REIMBURSE</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">{status}</span>;
    }
  };
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

  const handleCardClick = (key: string) => {
    if (onSelectFilter) {
      onSelectFilter(activeFilter === key ? 'ALL' : key);
    }
  };

  const renderBbmCard = () => {
    if (!userProfile?.aksesBBM) return null;

    const getTodayStr = () => {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const todayStr = getTodayStr();

    const userEmailToMatch = (userProfile?.email || email || '').toLowerCase();

    const hasRefilledToday = requests.some(r => {
      const isBbmReq = r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
      if (!isBbmReq) return false;
      if (r.status === RequestStatus.CANCELLED) return false;
      const isSameUser = r.userEmail.toLowerCase() === userEmailToMatch;
      const isSameDate = r.tanggalPemakaian === todayStr || (r.createdAt && r.createdAt.substring(0, 10) === todayStr);
      return isSameUser && isSameDate;
    });

    return (
      <button
        type="button"
        onClick={onOpenBbmListModal || onOpenBbmModal}
        className="w-full text-left bg-gradient-to-r from-amber-500/10 via-amber-50/80 to-orange-50/80 border border-amber-200/80 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3 transition-all cursor-pointer hover:border-amber-400 hover:shadow-md active:scale-[0.99] group"
        id="bbm-refill-dashboard-card"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-amber-200/60 group-hover:scale-105 transition-transform">
            <Fuel className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-slate-800 text-xs group-hover:text-amber-900 transition-colors">
              Pengisian BBM Duren Sawit
            </h3>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">
              {hasRefilledToday
                ? `Telah melakukan pengisian BBM di POM Duren Sawit hari ini (${todayStr}). Klik untuk melihat daftar.`
                : 'Klik untuk melihat daftar & catat pengisian BBM Duren Sawit.'}
            </p>
          </div>
        </div>
        {hasRefilledToday ? (
          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-lg shrink-0 border border-emerald-200 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Terisi
          </span>
        ) : (
          <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-lg shrink-0 border border-amber-200">
            Pengisian BBM
          </span>
        )}
      </button>
    );
  };

  // Reusable User Dashboard View for USER role or MANAGER/FINANCE Pengajuan Anggaran tab
  const renderUserDashboardView = () => {
    const myReqs = requests.filter(r => r.userEmail.toLowerCase() === email.toLowerCase() && r.status !== RequestStatus.CANCELLED);
    const myReqIds = myReqs.map(r => r.id);
    const myUsage = usageItems.filter(item => myReqIds.includes(item.requestId));

    const requesterProfile = profiles.find(p => p.email.trim().toLowerCase() === email.trim().toLowerCase());
    const isRequesterManagerOrFinance = requesterProfile ? (requesterProfile.role === Role.MANAGER || requesterProfile.role === Role.FINANCE) : (role === Role.MANAGER || role === Role.FINANCE);
    const supervisorTitle = isRequesterManagerOrFinance ? 'Direktur' : 'Manager';

    const isBbmRequest = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
    const isBbmUsageItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

    const totalRequested = myReqs.filter(r => r.siteId !== 'ADJUSTMENT' && !isBbmRequest(r)).reduce((sum, r) => sum + r.jumlahPengajuan, 0);
    const totalTransferred = myReqs.filter(r => r.siteId !== 'ADJUSTMENT' && !isBbmRequest(r)).reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalAdjustments = myReqs.filter(r => r.siteId === 'ADJUSTMENT' && !isBbmRequest(r)).reduce((sum, r) => sum + r.adminActionAmount, 0);

    // Saldo Operasional: Jumlah seluruh transfer + total adjustment dikurangi jumlah item laporan yang telah mendapatkan persetujuan Manager dan Admin (termasuk item dana talangan), tidak termasuk transaksi BBM Duren Sawit
    const totalReportedApproved = myUsage
      .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED && !isBbmUsageItem(item))
      .reduce((sum, item) => sum + item.nominal, 0);
    const saldoOperasional = totalTransferred + totalAdjustments - totalReportedApproved;

    // Active tasks for User:
    // 1. Rejected requests (need cancellation / review)
    // 2. Transferred requests that need usage report filling (status is TRANSFERRED or REPORTING)
    // 3. Reports with some rejected items that need correction
    const taskReportNeeded = myReqs.filter(r => r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.REPORTING).length;
    const taskCorrections = myReqs.filter(r => 
      [RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(r.status) && 
      myUsage.some(item => item.requestId === r.id && (item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED))
    ).length;
    const taskRejected = myReqs.filter(r => r.status === RequestStatus.REJECTED).length;

    const totalTasks = taskReportNeeded + taskCorrections + taskRejected;

    // Count rejected items in requests currently in PROSES LAPORAN
    const rejectedItemsInReportingCount = myUsage.filter(item => {
      const parentReq = myReqs.find(r => r.id === item.requestId);
      if (!parentReq) return false;
      const isReportingState = [
        RequestStatus.TRANSFERRED,
        RequestStatus.REPORTING,
        RequestStatus.REVIEW_MANAGER,
        RequestStatus.REVIEW_ADMIN
      ].includes(parentReq.status);
      return isReportingState && (item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED);
    }).length;

    // UID count by status
    const pendingApprCount = myReqs.filter(r => r.status === RequestStatus.PENDING_APPROVAL).length;
    const approvedWaitingTransfer = myReqs.filter(r => 
      r.status === RequestStatus.APPROVED || 
      r.status === RequestStatus.PARTIALLY_APPROVED || 
      r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
    ).length;
    const notReportedCount = myReqs.filter(r => r.status === RequestStatus.TRANSFERRED).length;
    const reportingCount = myReqs.filter(r => 
      r.status === RequestStatus.REPORTING ||
      r.status === RequestStatus.REVIEW_MANAGER ||
      r.status === RequestStatus.REVIEW_ADMIN
    ).length;
    const closedCount = myReqs.filter(r => r.status === RequestStatus.CLOSED && !isBbmRequest(r)).length;
    const rejectedCount = taskRejected;

    return (
      <div className="space-y-4">
        {/* Urgent Task Card */}
        {totalTasks > 0 ? (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm animate-pulse-subtle">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
              <AlertCircle className="w-5.5 h-5.5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-amber-900 text-xs tracking-wide uppercase">TUGAS ANDA ({totalTasks})</h3>
              <p className="text-xs text-amber-700 font-medium mt-0.5">
                {[
                  taskReportNeeded > 0 ? `${taskReportNeeded} pengajuan siap dilaporkan` : '',
                  taskCorrections > 0 ? `${taskCorrections} laporan perlu perbaikan` : '',
                  taskRejected > 0 ? `${taskRejected} pengajuan perlu revisi ${supervisorTitle}` : ''
                ].filter(Boolean).join(', ')}.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
              <CheckCircle2 className="w-5.5 h-5.5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-emerald-900 text-xs tracking-wide uppercase">SEMUA BERES</h3>
              <p className="text-xs text-emerald-700 font-medium mt-0.5">
                Tidak ada tugas operasional tertunda saat ini. Kerja bagus!
              </p>
            </div>
          </div>
        )}

        {/* Stats Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div 
            onClick={() => handleCardClick('PENDING')}
            className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'PENDING' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PENGAJUAN</p>
              <div className="flex items-end justify-between mt-2">
                <span className="text-3xl font-display font-bold text-slate-900">{pendingApprCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider">{supervisorTitle}</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Menunggu Approval {supervisorTitle}</p>
          </div>

          <div 
            onClick={() => handleCardClick('APPROVED')}
            className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'APPROVED' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">MENUNGGU TRANSFER</p>
              <div className="flex items-end justify-between mt-2">
                <span className="text-3xl font-display font-bold text-slate-900">{approvedWaitingTransfer} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Pencairan</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Pengajuan disetujui, menunggu proses transfer</p>
          </div>

          <div 
            onClick={() => handleCardClick('TRANSFERRED')}
            className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-cyan-300 hover:shadow-md ${
              activeFilter === 'TRANSFERRED' ? 'border-cyan-500 bg-cyan-50/20 ring-2 ring-cyan-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">BELUM DILAPORKAN</p>
              <div className="flex items-end justify-between mt-2">
                <span className="text-3xl font-display font-bold text-slate-900">{notReportedCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                <span className="text-[9px] font-bold text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-cyan-200/60">Siap Lapor</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Telah ditransfer, belum ada laporan</p>
          </div>

          <div 
            onClick={() => handleCardClick('REPORTING')}
            className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'REPORTING' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PROSES LAPORAN</p>
              </div>
              <div className="flex items-end justify-between mt-2">
                <span className="text-3xl font-display font-bold text-slate-900">{reportingCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Review</span>
              </div>
            </div>
            {rejectedItemsInReportingCount > 0 ? (
              <p className="text-[10px] font-bold text-rose-600 mt-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>{rejectedItemsInReportingCount} item review perlu perbaikan</span>
              </p>
            ) : (
              <p className="text-[9px] text-slate-400 mt-2 font-medium">Sedang dalam proses laporan / review</p>
            )}
          </div>

          <div 
            onClick={() => handleCardClick('CLOSED')}
            className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'CLOSED' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">CLOSED</p>
              <div className="flex items-end justify-between mt-2">
                <span className="text-3xl font-display font-bold text-slate-900">{closedCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Arsip</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Dinyatakan Closed oleh Finance</p>
          </div>

          <div 
            onClick={() => handleCardClick('REJECTED')}
            className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-rose-300 hover:shadow-md ${
              activeFilter === 'REJECTED' ? 'border-rose-500 bg-rose-50/20 ring-2 ring-rose-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PENGAJUAN PERLU REVISI</p>
              <div className="flex items-end justify-between mt-2">
                <span className="text-3xl font-display font-bold text-rose-600">{rejectedCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Perlu Revisi</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Diminta revisi. Klik untuk lihat, revisi & pembatalan</p>
          </div>
        </div>

        {/* Financial info Card - Saldo Operasional */}
        <div 
          onClick={() => setIsTransactionReportOpen(true)}
          className="bg-slate-900 hover:bg-slate-850 text-white rounded-2xl p-5 shadow-lg border border-slate-800 hover:border-emerald-500/50 hover:shadow-emerald-950/20 transition-all cursor-pointer group relative overflow-hidden"
          id="saldo-operasional-card"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase group-hover:text-emerald-300 transition-colors">SALDO OPERASIONAL</p>
            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1 shadow-2xs">
              <Eye className="w-3 h-3 text-emerald-400" /> Sisa Kas
            </span>
          </div>

          <div className="text-3xl font-display font-bold text-emerald-400 mt-2 font-mono">
            {formatIDR(saldoOperasional)}
          </div>
          {saldoOperasional < 0 && (
            <p className="text-[10px] text-amber-300 mt-2 font-medium">
              * Saldo negatif menunjukkan total dana talangan pribadi Anda yang disetujui melebihi dana transfer yang diterima (menunggu reimburse / penyesuaian kas).
            </p>
          )}

          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-medium">
            <span className="group-hover:text-slate-200 transition-colors flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              Klik untuk Laporan Transaksi User
            </span>
            <span className="text-[10px] font-bold text-emerald-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
              Lihat Detail &rarr;
            </span>
          </div>
        </div>

        {/* Modal Laporan Transaksi Saldo Operasional User */}
        {isTransactionReportOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/80 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in-95 duration-150">
              {/* Header Modal */}
              <div className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 border-b border-emerald-900/50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-600 border border-emerald-400/30 flex items-center justify-center text-white shrink-0 shadow-md">
                    <FileSpreadsheet className="w-5 h-5 text-emerald-100" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-sm sm:text-base text-white tracking-wide truncate">
                      Laporan Transaksi Saldo Operasional User
                    </h3>
                    <p className="text-[11px] text-emerald-200/80 font-medium mt-0.5 truncate">
                      {userProfile?.nama || email} • {formatDivisiSubDivisi(userProfile?.divisi, userProfile?.subDivisi)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsTransactionReportOpen(false)}
                  className="w-9 h-9 rounded-2xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0"
                  title="Tutup Modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body Content / Table */}
              <div className="p-4 sm:p-5 overflow-y-auto flex-1">
                {(() => {
                  const isBbmReq = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
                  const isBbmItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

                  const myUserReqs = requests.filter(r => 
                    r.userEmail.toLowerCase() === email.toLowerCase() && 
                    r.status !== RequestStatus.CANCELLED && 
                    !isBbmReq(r)
                  ).sort((a, b) => {
                    const timeA = getTransferTimestampMs(a);
                    const timeB = getTransferTimestampMs(b);
                    if (timeA !== timeB) return timeB - timeA;
                    return b.id.localeCompare(a.id);
                  });

                  const filteredReqs = myUserReqs;

                  if (filteredReqs.length === 0) {
                    return (
                      <div className="py-12 text-center text-slate-400 space-y-2">
                        <FileSpreadsheet className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
                        <p className="text-xs font-semibold text-slate-500">
                          {transactionSearchQuery ? 'Tidak ada transaksi yang cocok dengan kata kunci pencarian.' : 'Belum ada transaksi pengajuan / laporan untuk pengguna ini.'}
                        </p>
                      </div>
                    );
                  }

                  // Calculate totals for table footer
                  const totPengajuan = filteredReqs.reduce((sum, r) => sum + r.jumlahPengajuan, 0);
                  const totTransfer = filteredReqs.reduce((sum, r) => sum + r.adminActionAmount, 0);
                  const totDilaporkan = filteredReqs.reduce((sum, r) => {
                    const reqUsage = usageItems.filter(item => 
                      item.requestId === r.id && 
                      item.statusManager === ItemStatus.APPROVED && 
                      item.statusAdmin === ItemStatus.APPROVED && 
                      !isBbmItem(item)
                    );
                    return sum + reqUsage.reduce((sub, u) => sub + u.nominal, 0);
                  }, 0);
                  const totSisa = totTransfer - totDilaporkan;

                  return (
                    <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-900 text-white font-bold uppercase tracking-wider text-[10px]">
                            <th className="py-3.5 px-3 text-center w-12 border-b border-slate-800">No</th>
                            <th className="py-3.5 px-3 border-b border-slate-800">Tanggal</th>
                            <th className="py-3.5 px-3 border-b border-slate-800">UID</th>
                            <th className="py-3.5 px-3 text-right border-b border-slate-800">Pengajuan</th>
                            <th className="py-3.5 px-3 text-right border-b border-slate-800">Ditransfer</th>
                            <th className="py-3.5 px-3 text-right border-b border-slate-800">Dilaporkan</th>
                            <th className="py-3.5 px-3 text-right border-b border-slate-800">Lebih / Sisa</th>
                            <th className="py-3.5 px-3 text-center border-b border-slate-800">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 bg-white">
                          {filteredReqs.map((r, idx) => {
                            const reqUsageApproved = usageItems.filter(item => 
                              item.requestId === r.id && 
                              item.statusManager === ItemStatus.APPROVED && 
                              item.statusAdmin === ItemStatus.APPROVED && 
                              !isBbmItem(item)
                            );
                            const reportedApproved = reqUsageApproved.reduce((sum, u) => sum + u.nominal, 0);
                            const sisa = r.adminActionAmount - reportedApproved;

                            return (
                              <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="py-3 px-3 text-center font-bold text-slate-400 font-mono">
                                  {idx + 1}
                                </td>
                                <td className="py-3 px-3 font-mono text-xs font-semibold text-slate-700 whitespace-nowrap">
                                  {getTransferDateDisplay(r)}
                                </td>
                                <td className="py-3 px-3">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                      {r.id}
                                    </span>
                                    {r.siteId && (
                                      <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                                        Site: {r.siteId}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-slate-500 font-medium line-clamp-1 mt-0.5 max-w-[240px]" title={r.keterangan}>
                                    {r.keterangan}
                                  </p>
                                </td>
                                <td className="py-3 px-3 text-right font-mono font-bold text-slate-700">
                                  {formatIDR(r.jumlahPengajuan)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono font-bold text-indigo-700">
                                  {formatIDR(r.adminActionAmount)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                                  {formatIDR(reportedApproved)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono font-bold">
                                  {sisa > 0 ? (
                                    <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 inline-block">
                                      +{formatIDR(sisa)}
                                    </span>
                                  ) : sisa < 0 ? (
                                    <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 inline-block">
                                      {formatIDR(sisa)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">Rp 0</span>
                                  )}
                                </td>
                                <td className="py-3 px-3 text-center">
                                  {renderStatusBadge(r.status)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900 text-xs">
                            <td colSpan={3} className="py-3.5 px-3 uppercase text-[10px] tracking-wider text-slate-700">
                              TOTAL REKAPITULASI LAPORAN
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono text-slate-800">
                              {formatIDR(totPengajuan)}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono text-indigo-800">
                              {formatIDR(totTransfer)}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono text-emerald-800">
                              {formatIDR(totDilaporkan)}
                            </td>
                            <td className="py-3.5 px-3 text-right font-mono text-sm">
                              <span className={totSisa >= 0 ? 'text-emerald-700 font-black' : 'text-rose-700 font-black'}>
                                {formatIDR(totSisa)}
                              </span>
                            </td>
                            <td className="py-3.5 px-3 text-center text-[10px] text-slate-500 uppercase">
                              REKAPITULASI
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  );
                })()}
              </div>

              {/* Footer Modal */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
                <p className="text-[10px] text-slate-400 font-medium hidden sm:block">
                  Perhitungan Saldo: Total Transfer dikurangi Total Nota Laporan yang telah disetujui (Approved).
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportPDF}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsTransactionReportOpen(false)}
                    className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
                  >
                    Tutup Laporan
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Kartu Activity */}
        {(() => {
          const getTodayStr = () => {
            const d = new Date();
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          };
          const todayStr = getTodayStr();
          const todayActivitiesCount = activities.filter(act => 
            act.userEmail.toLowerCase() === email.toLowerCase() && act.tanggal === todayStr
          ).length;

          return (
            <div 
              onClick={onOpenActivities}
              className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer flex items-center justify-between"
              id="activity-dashboard-card"
            >
              <div>
                <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">KEGIATAN HARI INI</p>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-3xl font-display font-bold text-slate-900">{todayActivitiesCount}</span>
                  <span className="text-xs text-slate-500 font-medium">Log Kegiatan</span>
                </div>
                <p className="text-[9px] text-slate-400 mt-1 font-medium">Klik untuk melihat list & catat kegiatan baru</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                <CalendarCheck className="w-6 h-6" />
              </div>
            </div>
          );
        })()}
        {renderBbmCard()}
      </div>
    );
  };

  if (role === Role.USER) {
    return renderUserDashboardView();
  }  if (role === Role.MANAGER) {
    const managerReqs = requests.filter(r => r.managerEmail.toLowerCase() === email.toLowerCase());
    const managerReqIds = managerReqs.map(r => r.id);
    const managerUsage = usageItems.filter(item => managerReqIds.includes(item.requestId));

    // Active tasks for Manager Approval:
    // 1. Initial approval needed: requests in PENDING_APPROVAL
    const pendingBudgetReview = managerReqs.filter(r => r.status === RequestStatus.PENDING_APPROVAL).length;

    // 2. Report reviews needed: requests with usage items pending Manager review
    const pendingReportReview = managerReqs.filter(r => {
      if (![RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN, RequestStatus.TRANSFERRED].includes(r.status)) return false;
      const reqItems = usageItems.filter(item => item.requestId === r.id);
      if (reqItems.length === 0) return false;
      return reqItems.some(i => i.statusManager === ItemStatus.PENDING);
    }).length;

    const totalApprovalTasks = pendingBudgetReview + pendingReportReview;

    // Active tasks for Manager's own submissions:
    const myPersonalReqs = requests.filter(r => r.userEmail.toLowerCase() === email.toLowerCase() && r.status !== RequestStatus.CANCELLED);
    const myPersonalReqIds = myPersonalReqs.map(r => r.id);
    const myPersonalUsage = usageItems.filter(item => myPersonalReqIds.includes(item.requestId));
    const myTaskReportNeeded = myPersonalReqs.filter(r => r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.REPORTING).length;
    const myTaskCorrections = myPersonalReqs.filter(r => 
      [RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(r.status) && 
      myPersonalUsage.some(item => item.requestId === r.id && (item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED))
    ).length;
    const myTaskRejected = myPersonalReqs.filter(r => r.status === RequestStatus.REJECTED).length;
    const totalUserTasks = myTaskReportNeeded + myTaskCorrections + myTaskRejected;

    // Request Stats for Manager's Team
    const teamPendingAppr = managerReqs.filter(r => r.status === RequestStatus.PENDING_APPROVAL).length;
    const teamUnderReview = managerReqs.filter(r => {
      const reqItems = usageItems.filter(item => item.requestId === r.id);
      if (reqItems.length === 0) return false;
      const hasRejectedItem = reqItems.some(i => i.statusManager === ItemStatus.REJECTED || i.statusAdmin === ItemStatus.REJECTED);
      if (r.status === RequestStatus.REVIEW_MANAGER) return true;
      if (r.status === RequestStatus.REPORTING && !hasRejectedItem) return true;
      return false;
    }).length;

    return (
      <div className="space-y-4">
        {/* Dual Tab Switcher for MANAGER */}
        <div className="bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200/80 flex items-center gap-1.5 shadow-xs">
          <button
            type="button"
            onClick={() => handleTabChange('APPROVAL')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              currentTab === 'APPROVAL'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <ShieldCheck className={`w-4 h-4 ${currentTab === 'APPROVAL' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>APPROVAL</span>
            {totalApprovalTasks > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                currentTab === 'APPROVAL'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-rose-100 text-rose-700'
              }`}>
                {totalApprovalTasks}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('SUBMISSION')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              currentTab === 'SUBMISSION'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <FileText className={`w-4 h-4 ${currentTab === 'SUBMISSION' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>PENGAJUAN</span>
            {totalUserTasks > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                currentTab === 'SUBMISSION'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>
                {totalUserTasks}
              </span>
            )}
          </button>
        </div>

        {currentTab === 'APPROVAL' ? (
          <div className="space-y-4">
            {/* Urgent Task Card */}
            {totalApprovalTasks > 0 ? (
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
                  <ClipboardCheck className="w-5.5 h-5.5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-indigo-900 text-xs tracking-wide uppercase">TUGAS PERSETUJUAN ({totalApprovalTasks})</h3>
                  <p className="text-xs text-indigo-700 font-medium mt-0.5">
                    Ada {pendingBudgetReview} pengajuan anggaran baru dan {pendingReportReview} laporan operasional tim yang membutuhkan tinjauan Anda.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <CheckCircle2 className="w-5.5 h-5.5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-emerald-900 text-xs tracking-wide uppercase">SEMUA TINJAUAN BERES</h3>
                  <p className="text-xs text-emerald-700 font-medium mt-0.5">
                    Selamat! Anda telah memproses semua tugas persetujuan anggaran dan laporan tim.
                  </p>
                </div>
              </div>
            )}

            {/* 2 Stats Cards (Approval & Review) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div 
                onClick={() => handleCardClick('PENDING')}
                className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md flex flex-col justify-between min-h-[140px] ${
                  activeFilter === 'PENDING' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ALUR PERSETUJUAN</p>
                  <h4 className="font-display font-black text-slate-800 text-xs mt-1">Approval Pengajuan Anggaran</h4>
                </div>
                <div>
                  <div className="flex items-end justify-between mt-3">
                    <span className="text-3xl font-display font-bold text-slate-900">{teamPendingAppr} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Persetujuan</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-2 font-medium">Menunggu persetujuan awal anggaran baru</p>
                </div>
              </div>

              <div 
                onClick={() => handleCardClick('REPORTING')}
                className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md flex flex-col justify-between min-h-[140px] ${
                  activeFilter === 'REPORTING' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ALUR REKONSILIASI</p>
                  <h4 className="font-display font-black text-slate-800 text-xs mt-1">Review Penggunaan Anggaran</h4>
                </div>
                <div>
                  <div className="flex items-end justify-between mt-3">
                    <span className="text-3xl font-display font-bold text-slate-900">{teamUnderReview} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                    <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Review Laporan</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-2 font-medium">Berisi UID yang telah ditransfer Finance dan dilaporkan penggunannya oleh User (termasuk Laporan Dana Talangan User)</p>
                </div>
              </div>
            </div>

            {/* Kartu Activity User - MANAGER */}
            {(() => {
              const getTodayStr = () => {
                const d = new Date();
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
              };
              const todayStr = getTodayStr();

              // Subordinates emails
              const subProfiles = profiles.filter(p => p.managerEmail.toLowerCase() === email.toLowerCase() || p.email.toLowerCase() === email.toLowerCase());
              const subEmails = new Set(subProfiles.map(p => p.email.toLowerCase()));

              const todayTeamActivitiesCount = activities.filter(act => 
                subEmails.has(act.userEmail.toLowerCase()) && act.tanggal === todayStr
              ).length;

              return (
                <div 
                  onClick={onOpenActivities}
                  className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer flex items-center justify-between"
                  id="manager-activity-card"
                >
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">ACTIVITY USER (TIM BAWAHAN)</p>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-display font-bold text-slate-900">{todayTeamActivitiesCount}</span>
                      <span className="text-xs text-slate-500 font-medium">Log Kegiatan Hari Ini</span>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1 font-medium">Klik untuk melihat daftar activity bawahan &amp; filter per user / tanggal</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                    <CalendarCheck className="w-6 h-6" />
                  </div>
                </div>
              );
            })()}

            {renderBbmCard()}
          </div>
        ) : (
          renderUserDashboardView()
        )}
      </div>
    );
  }

  // Finance stats
  if (role === Role.FINANCE) {
    // Admin reviews ALL requests and manages ALL transfers
    const pendingTransferReqs = requests.filter(r => 
      r.status === RequestStatus.APPROVED || 
      r.status === RequestStatus.PARTIALLY_APPROVED || 
      r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
    );
    const pendingTransfer = pendingTransferReqs.length;
    const pendingTransferAmount = pendingTransferReqs.reduce((sum, r) => {
      if (r.status === RequestStatus.PENDING_TALANGAN_TRANSFER) {
        const reqItems = usageItems.filter(i => i.requestId === r.id && i.statusManager === ItemStatus.APPROVED);
        const approvedUsage = reqItems.reduce((iSum, item) => iSum + (item.nominal || 0), 0);
        return sum + (approvedUsage || r.managerActionAmount || r.jumlahPengajuan || 0);
      }
      const amt = r.managerActionAmount > 0 ? r.managerActionAmount : (r.jumlahPengajuan || 0);
      return sum + amt;
    }, 0);
    const pendingAdminReportReview = requests.filter(r => {
      if (r.status !== RequestStatus.REVIEW_ADMIN && r.status !== RequestStatus.REPORTING) return false;
      const reqItems = usageItems.filter(i => i.requestId === r.id);
      if (reqItems.length === 0) return false;
      if (reqItems.some(i => i.statusAdmin === ItemStatus.REJECTED)) return false;
      const managerApproved = reqItems.every(i => i.statusManager === ItemStatus.APPROVED);
      return managerApproved;
    }).length;

    // Tasks needing Admin action:
    // 1. Pending cash transfers
    // 2. Pending admin report reviews
    const totalApprovalTasks = pendingTransfer + pendingAdminReportReview;
    const totalTasks = totalApprovalTasks;

    // Active tasks for Finance's own submissions:
    const myPersonalReqs = requests.filter(r => r.userEmail.toLowerCase() === email.toLowerCase() && r.status !== RequestStatus.CANCELLED);
    const myPersonalReqIds = myPersonalReqs.map(r => r.id);
    const myPersonalUsage = usageItems.filter(item => myPersonalReqIds.includes(item.requestId));
    const myTaskReportNeeded = myPersonalReqs.filter(r => r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.REPORTING).length;
    const myTaskCorrections = myPersonalReqs.filter(r => 
      [RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(r.status) && 
      myPersonalUsage.some(item => item.requestId === r.id && (item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED))
    ).length;
    const myTaskRejected = myPersonalReqs.filter(r => r.status === RequestStatus.REJECTED).length;
    const totalUserTasks = myTaskReportNeeded + myTaskCorrections + myTaskRejected;
    const isBbmRequestAdmin = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
    const isBbmUsageItemAdmin = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

    const closedCount = requests.filter(r => r.status === RequestStatus.CLOSED && !isBbmRequestAdmin(r)).length;

    const financeRejectedReqs = requests.filter(r => {
      if (r.status === RequestStatus.CANCELLED) return false;
      const isReqRejected = r.status === RequestStatus.REJECTED;
      const hasAdminRejectedItems = usageItems.some(i => i.requestId === r.id && i.statusAdmin === ItemStatus.REJECTED);
      return isReqRejected || hasAdminRejectedItems;
    });
    const financeRejectedCount = financeRejectedReqs.length;

    const totalTransferred = requests.filter(r => !isBbmRequestAdmin(r)).reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totalClosed = usageItems
      .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED && !isBbmUsageItemAdmin(item))
      .reduce((sum, item) => sum + item.nominal, 0);

    const unbalancedUsersStats = profiles.map(user => {
      const userReqs = requests.filter(r => r.userEmail.toLowerCase() === user.email.toLowerCase() && !isBbmRequestAdmin(r));
      const userReqIds = userReqs.map(r => r.id);
      const userUsage = usageItems.filter(item => userReqIds.includes(item.requestId) && !isBbmUsageItemAdmin(item));

      const totalTransferredVal = userReqs.filter(r => r.siteId !== 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
      const totalAdjustmentsVal = userReqs.filter(r => r.siteId === 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
      const totalReportedApproved = userUsage
        .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
        .reduce((sum, item) => sum + item.nominal, 0);
      
      const balance = totalTransferredVal + totalAdjustmentsVal - totalReportedApproved;
      return { user, balance, requiredNominal: Math.abs(balance) };
    }).filter(item => item.requiredNominal > 0.01);

    const unbalancedUsersCount = unbalancedUsersStats.length;
    const totalAdjustmentNominalNeeded = unbalancedUsersStats.reduce((sum, item) => sum + item.requiredNominal, 0);

    const transferredReqsList = requests.filter(r => 
      !isBbmRequestAdmin(r) && 
      r.status !== RequestStatus.CANCELLED &&
      (r.adminActionAmount || 0) > 0
    );
    const transferredCount = transferredReqsList.length;
    const transferredTotalAmount = transferredReqsList.reduce((sum, r) => sum + (r.adminActionAmount || 0), 0);

    const parseDateToYYYYMMDD = (dateInput: string | Date | undefined): string => {
      if (!dateInput) return '';
      const str = String(dateInput).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return str.substring(0, 10);
      }
      if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
        const parts = str.split('/');
        const d = parts[0].padStart(2, '0');
        const m = parts[1].padStart(2, '0');
        const y = parts[2].substring(0, 4);
        return `${y}-${m}-${d}`;
      }
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return '';
    };

    const getTodayStr = () => {
      try {
        const jakartaStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        if (/^\d{4}-\d{2}-\d{2}$/.test(jakartaStr)) return jakartaStr;
      } catch (e) {}
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const todayStr = getTodayStr();

    const todayTransferredReqs = transferredReqsList.filter(r => {
      const dateAdminActionTime = parseDateToYYYYMMDD(r.adminActionTime);
      const datePemakaian = parseDateToYYYYMMDD(r.tanggalPemakaian);
      const dateCreatedAt = parseDateToYYYYMMDD(r.createdAt);
      const dateTimestamp = parseDateToYYYYMMDD(r.timestamp);
      if (dateAdminActionTime) {
        return dateAdminActionTime === todayStr;
      }
      return datePemakaian === todayStr || dateCreatedAt === todayStr || dateTimestamp === todayStr;
    });
    const todayTransferredCount = todayTransferredReqs.length;
    const todayTransferredTotal = todayTransferredReqs.reduce((sum, r) => sum + (r.adminActionAmount || 0), 0);

    const todayBbmReqs = requests.filter(r => 
      (r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit')) &&
      r.tanggalPemakaian === todayStr
    );
    const todayBbmCount = todayBbmReqs.length;
    const todayBbmTotal = todayBbmReqs.reduce((sum, r) => sum + r.jumlahPengajuan, 0);

    const todayAllActivitiesCount = activities.filter(act => act.tanggal === todayStr).length;

    const renderAdminBbmCard = () => {
      return (
        <div
          onClick={onOpenBbmListModal || onOpenBbmModal}
          className="p-5 rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50/80 via-white to-orange-50/40 shadow-sm transition-all cursor-pointer hover:border-amber-400 hover:shadow-md active:scale-[0.99] group flex flex-col justify-between"
          id="admin-bbm-card"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest flex items-center gap-1">
              <Fuel className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>BBM DUREN SAWIT</span>
            </p>
            <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
              Hari Ini
            </span>
          </div>

          <div className="flex items-end justify-between mt-2">
            <div>
              <span className="text-3xl font-display font-bold text-slate-900">{todayBbmCount} <span className="text-xs text-slate-400 font-normal">Isi</span></span>
              <p className="text-[10px] font-bold text-amber-700 mt-0.5">{formatIDR(todayBbmTotal)}</p>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        {/* Dual Tab Switcher for FINANCE */}
        <div className="bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200/80 flex items-center gap-1.5 shadow-xs">
          <button
            type="button"
            onClick={() => handleTabChange('APPROVAL')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              currentTab === 'APPROVAL'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <ShieldCheck className={`w-4 h-4 ${currentTab === 'APPROVAL' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>APPROVAL</span>
            {totalApprovalTasks > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                currentTab === 'APPROVAL'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-rose-100 text-rose-700'
              }`}>
                {totalApprovalTasks}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('SUBMISSION')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              currentTab === 'SUBMISSION'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <FileText className={`w-4 h-4 ${currentTab === 'SUBMISSION' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>PENGAJUAN</span>
            {totalUserTasks > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                currentTab === 'SUBMISSION'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>
                {totalUserTasks}
              </span>
            )}
          </button>
        </div>

        {currentTab === 'APPROVAL' ? (
          <div className="space-y-4">
            {/* Urgent Task Card */}
        {totalTasks > 0 ? (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-700 shrink-0">
              <ArrowRightLeft className="w-5.5 h-5.5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-red-900 text-xs tracking-wide uppercase">TUGAS FINANCE ({totalTasks})</h3>
              <p className="text-xs text-red-700 font-medium mt-0.5">
                Ada {pendingTransfer} pengajuan menunggu Transfer Dana, dan {pendingAdminReportReview} laporan operasional menunggu Tinjauan Finansial Anda.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
              <CheckCircle2 className="w-5.5 h-5.5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-emerald-900 text-xs tracking-wide uppercase">OPERASIONAL LANCAR</h3>
              <p className="text-xs text-emerald-700 font-medium mt-0.5">
                Semua dana terproses dan review selesai. Finansial perusahaan dalam keadaan rapi.
              </p>
            </div>
          </div>
        )}

        {/* 2x2 Stats Cards Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div 
            onClick={() => handleCardClick('APPROVED')}
            className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'APPROVED' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">BELUM DITRANSFER</p>
            <div className="flex items-end justify-between mt-2">
              <div>
                <span className="text-3xl font-display font-bold text-slate-900">{pendingTransfer} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                <p className="text-xs font-bold text-amber-700 mt-1">{formatIDR(pendingTransferAmount)}</p>
              </div>
              <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Pencairan</span>
            </div>
          </div>

          <div 
            onClick={() => handleCardClick('REPORTING')}
            className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'REPORTING' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">REVIEW FINANSIAL</p>
            <div className="flex items-end justify-between mt-2">
              <span className="text-3xl font-display font-bold text-slate-900">{pendingAdminReportReview} <span className="text-xs text-slate-400 font-normal">UID</span></span>
              <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Review</span>
            </div>
          </div>

          <div 
            onClick={() => handleCardClick('CLOSED')}
            className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'CLOSED' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">UID CLOSED</p>
            <div className="flex items-end justify-between mt-2">
              <span className="text-3xl font-display font-bold text-slate-900">{closedCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
              <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Arsip / Selesai</span>
            </div>
          </div>

          <div 
            onClick={() => handleCardClick('REJECTED')}
            className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-rose-300 hover:shadow-md ${
              activeFilter === 'REJECTED' ? 'border-rose-500 bg-rose-50/20 ring-2 ring-rose-500/20' : 'bg-white border-slate-200'
            }`}
            id="finance-rejected-card"
          >
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PENGAJUAN REJECTED</p>
            <div className="flex items-end justify-between mt-2">
              <span className="text-3xl font-display font-bold text-rose-600">{financeRejectedCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
              <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Revisi Finance</span>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Berisi UID yang pengajuannya di-reject oleh Finance</p>
          </div>

          {renderAdminBbmCard()}

          {onOpenActivities && (
            <div 
              onClick={onOpenActivities}
              id="finance-activity-card"
              className="p-5 rounded-2xl border border-indigo-200/90 bg-gradient-to-br from-indigo-50/70 via-white to-sky-50/40 shadow-sm transition-all cursor-pointer hover:border-indigo-400 hover:shadow-md active:scale-[0.99] group flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-indigo-800 uppercase tracking-widest flex items-center gap-1">
                  <CalendarCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>LOG KEGIATAN OPERASIONAL</span>
                </p>
                <span className="text-[9px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Hari Ini
                </span>
              </div>

              <div className="flex items-end justify-between mt-2">
                <div>
                  <span className="text-3xl font-display font-bold text-slate-900">{todayAllActivitiesCount} <span className="text-xs text-slate-400 font-normal">Log</span></span>
                  <p className="text-[10px] font-bold text-indigo-600 mt-0.5">Lihat Aktivitas &amp; Foto Lapangan &rarr;</p>
                </div>
              </div>
            </div>
          )}

          {onOpenReportsModal && (
            <div 
              onClick={onOpenReportsModal}
              id="finance-reports-card"
              className="p-5 rounded-2xl border border-indigo-200/90 bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/40 shadow-sm transition-all cursor-pointer hover:border-indigo-400 hover:shadow-md col-span-2 group flex items-center justify-between"
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-bold text-indigo-700 uppercase tracking-widest">REKAP &amp; DAFTAR LAPORAN</p>
                  <span className="text-[9px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                    Cetak PDF
                  </span>
                </div>
                <h4 className="font-display font-black text-slate-800 text-sm mt-1 group-hover:text-indigo-600 transition-colors">
                  LAPORAN
                </h4>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
                <FileText className="w-5.5 h-5.5" />
              </div>
            </div>
          )}

          {onOpenAdjustment && (
            <div 
              onClick={onOpenAdjustment}
              className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-400 hover:shadow-md col-span-2 group ${
                activeFilter === 'ADJUSTMENT' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PROSES PENYESUAIAN</p>
                  <h4 className="font-display font-black text-slate-800 text-xs mt-1 group-hover:text-indigo-600 transition-colors">Adjustment Saldo User</h4>
                </div>
                <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Finance Direct
                </span>
              </div>
              <div className="flex items-end justify-between mt-3">
                <div>
                  <span className="text-3xl font-display font-bold text-slate-900">
                    {unbalancedUsersCount} <span className="text-xs text-slate-400 font-normal">User</span>
                  </span>
                  <div className="text-[11px] font-bold text-indigo-600 font-mono mt-1">
                    Total Nominal Adjustment: {formatIDR(totalAdjustmentNominalNeeded)}
                  </div>
                </div>
                {unbalancedUsersCount > 0 ? (
                  <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                    Perlu Balance
                  </span>
                ) : (
                  <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                    All Balanced
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 mt-2 font-medium">
                Sesuaikan sisa saldo operasional (lebih/kurang) masing-masing user menjadi Rp 0 secara instan dengan bukti potongan/transfer.
              </p>
            </div>
          )}

          {onOpenTransferList && (
            <div 
              onClick={onOpenTransferList}
              id="finance-transfer-list-card"
              className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-400 hover:shadow-md col-span-2 group ${
                activeFilter === 'TRANSFER_LIST' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">DAFTAR TRANSFER</p>
                  <h4 className="font-display font-black text-slate-800 text-xs mt-1 group-hover:text-indigo-600 transition-colors">List Transfer UID</h4>
                </div>
                <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Finance Direct
                </span>
              </div>

              <div className="flex items-end justify-between mt-3">
                <div>
                  <span className="text-3xl font-display font-bold text-slate-900 block">
                    {todayTransferredCount} <span className="text-xs text-slate-400 font-normal">UID Hari Ini</span>
                  </span>
                  <p className="text-[11px] font-bold text-indigo-600 mt-0.5">
                    Total: {formatIDR(todayTransferredTotal)}
                  </p>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 mt-2.5 font-medium border-t border-slate-100 pt-2">
                Lihat daftar pengajuan UID yang telah ditransfer dana oleh Finance beserta rincian bukti transfer.
              </p>
            </div>
          )}

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm col-span-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">TOTAL REKONSILIASI KEUANGAN</p>
            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100">
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wider">Total Dana Ditransfer</span>
                <span className="text-sm font-bold font-display text-slate-850">{formatIDR(totalTransferred)}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wider">Total Closing Terverifikasi</span>
                <span className="text-sm font-bold font-display text-emerald-600">{formatIDR(totalClosed)}</span>
              </div>
              <div className="col-span-2 pt-3 border-t border-slate-100 mt-1">
                <span className="text-[9px] text-slate-400 block font-bold uppercase tracking-wider">Selisih Operasional Belum Dilaporkan / Di Tangan Karyawan</span>
                <span className="text-base font-extrabold font-display text-amber-600 block mt-0.5">
                  {formatIDR(totalTransferred - totalClosed)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : (
      renderUserDashboardView()
    )}
  </div>
);
}

  // Compute stats for ADMINISTRATOR role
  if (role === Role.ADMINISTRATOR) {
    const totalUsers = profiles.length;
    const staffCount = profiles.filter(p => p.role === Role.USER).length;
    const managerCount = profiles.filter(p => p.role === Role.MANAGER).length;
    const financeCount = profiles.filter(p => p.role === Role.FINANCE).length;
    const direkturCount = profiles.filter(p => p.role === Role.DIREKTUR).length;
    const adminCount = profiles.filter(p => p.role === Role.ADMINISTRATOR).length;
    const mobileBindingCount = profiles.filter(p => p.mobile || p.deviceId).length;

    const getTodayStr = () => {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const todayStr = getTodayStr();

    const todayBbmReqs = requests.filter(r => 
      (r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit')) &&
      r.tanggalPemakaian === todayStr
    );
    const todayBbmCount = todayBbmReqs.length;
    const todayBbmTotal = todayBbmReqs.reduce((sum, r) => sum + r.jumlahPengajuan, 0);

    return (
      <div className="space-y-4">
        {/* Banner Administrator */}
        <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white p-5 rounded-2xl shadow-lg border border-blue-800/50">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold tracking-widest text-blue-300 uppercase bg-blue-950/80 px-2.5 py-1 rounded-lg border border-blue-700/50">
                System Administrator
              </span>
              <h2 className="text-base font-display font-bold mt-2 text-white">Manajemen Pengguna &amp; Perangkat</h2>
              <p className="text-[11px] text-blue-200 mt-0.5">
                Kelola akun pengguna, reset Device ID mobile, atur role (Staff, Manager, Finance, Direktur, Admin) &amp; divisi.
              </p>
            </div>
            <div className="hidden sm:flex w-11 h-11 rounded-2xl bg-blue-500/20 border border-blue-400/30 items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6 text-blue-300" />
            </div>
          </div>
        </div>

        {/* Primary Action Card: Kelola User */}
        {onManageUsers && (
          <div
            onClick={onManageUsers}
            className="p-5 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-blue-50/50 shadow-md hover:shadow-lg hover:border-indigo-400 transition-all cursor-pointer group flex items-center justify-between gap-4"
            id="admin-manage-users-card"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-200 group-hover:scale-105 transition-transform">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-indigo-600 transition-colors flex items-center gap-2">
                  Kelola User / Pengguna System
                  <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full uppercase">
                    Akses Utama
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Tambah user baru, edit akun, atasi reset Device ID, ubah role &amp; relasi manager.
                </p>
              </div>
            </div>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
              &rarr;
            </div>
          </div>
        )}

        {/* Shortcut Card: Intip Dashboard & Status UID User */}
        {onOpenUserDashboardPreview && (
          <div
            onClick={onOpenUserDashboardPreview}
            className="p-5 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50/90 via-white to-indigo-50/60 shadow-md hover:shadow-lg hover:border-purple-400 transition-all cursor-pointer group flex items-center justify-between gap-4"
            id="admin-preview-user-dashboard-card"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-purple-200 group-hover:scale-105 transition-transform">
                <Eye className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-purple-600 transition-colors flex items-center gap-2">
                  Pintasan Dashboard &amp; Status UID User
                  <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full uppercase">
                    Pintasan Admin
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Pilih akun pengguna untuk melihat statistik, saldo operasional, task &amp; status UID sama seperti user terpilih.
                </p>
              </div>
            </div>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
              &rarr;
            </div>
          </div>
        )}

        {/* Card: Cek GPS Perangkat */}
        <div
          onClick={handleOpenGpsCheck}
          className="p-5 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/60 shadow-md hover:shadow-lg hover:border-emerald-400 transition-all cursor-pointer group flex items-center justify-between gap-4"
          id="admin-check-gps-card"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-200 group-hover:scale-105 transition-transform">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-emerald-600 transition-colors flex items-center gap-2">
                Cek GPS Perangkat System
                <span className="text-[9px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full uppercase">
                  Diagnostik GPS
                </span>
              </h3>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                Uji parameter akurasi GPS hardware, elevasi, kecepatan, timestamp &amp; deteksi indikasi Fake GPS perangkat ini.
              </p>
            </div>
          </div>
          <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
            &rarr;
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">TOTAL PENGGUNA</p>
            <p className="text-2xl font-display font-bold text-slate-900 mt-1">{totalUsers} <span className="text-xs text-slate-400 font-normal">Akun</span></p>
            <p className="text-[10px] text-slate-400 mt-1">Terdaftar dalam database</p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">STAFF &amp; MANAGER</p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-xl font-display font-bold text-indigo-600">{staffCount} <span className="text-[10px] text-slate-400">Staff</span></span>
              <span className="text-xl font-display font-bold text-emerald-600">{managerCount} <span className="text-[10px] text-slate-400">Manager</span></span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Struktur operasional</p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm col-span-2 sm:col-span-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PERANGKAT MOBILE</p>
            <p className="text-2xl font-display font-bold text-purple-600 mt-1">{mobileBindingCount} <span className="text-xs text-slate-400 font-normal">Perangkat</span></p>
            <p className="text-[10px] text-slate-400 mt-1">Wajib HP / Device ID terikat</p>
          </div>
        </div>

        {/* Role Distribution Summary */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">SEBARAN ROLE SISTEM</p>
          <div className="grid grid-cols-5 gap-2 pt-2 border-t border-slate-100 text-center">
            <div className="p-2 bg-slate-50 rounded-xl">
              <span className="text-[9px] text-slate-400 font-bold block">STAFF</span>
              <span className="text-sm font-bold text-indigo-600">{staffCount}</span>
            </div>
            <div className="p-2 bg-slate-50 rounded-xl">
              <span className="text-[9px] text-slate-400 font-bold block">MANAGER</span>
              <span className="text-sm font-bold text-emerald-600">{managerCount}</span>
            </div>
            <div className="p-2 bg-slate-50 rounded-xl">
              <span className="text-[9px] text-slate-400 font-bold block">FINANCE</span>
              <span className="text-sm font-bold text-red-600">{financeCount}</span>
            </div>
            <div className="p-2 bg-slate-50 rounded-xl">
              <span className="text-[9px] text-slate-400 font-bold block">DIREKTUR</span>
              <span className="text-sm font-bold text-purple-600">{direkturCount}</span>
            </div>
            <div className="p-2 bg-slate-50 rounded-xl">
              <span className="text-[9px] text-slate-400 font-bold block">ADMIN</span>
              <span className="text-sm font-bold text-blue-600">{adminCount}</span>
            </div>
          </div>
        </div>

        {/* Kartu BBM Duren Sawit (Administrator) */}
        <div 
          onClick={onOpenBbmListModal || onOpenBbmModal}
          className="bg-gradient-to-r from-amber-500/10 via-amber-50/80 to-orange-50/80 border border-amber-200/90 rounded-2xl p-4 shadow-sm hover:border-amber-400 hover:shadow-md transition-all cursor-pointer flex items-center justify-between gap-3 group"
          id="administrator-bbm-card"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-amber-200/60 group-hover:scale-105 transition-transform">
              <Fuel className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-display font-bold text-xs text-slate-800 group-hover:text-amber-900 transition-colors">
                  Pengisian BBM Duren Sawit
                </h4>
                <span className="text-[9px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Seluruh UID
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                Pengisian hari ini ({todayStr}): <span className="font-bold text-slate-800">{todayBbmCount} transaksi ({formatIDR(todayBbmTotal)})</span>. Klik untuk lihat daftar &amp; filter tanggal.
              </p>
            </div>
          </div>
          <div className="w-8 h-8 rounded-xl bg-amber-100/80 text-amber-800 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
            &rarr;
          </div>
        </div>

        {/* Kartu Activity User (Log Kegiatan) */}
        {onOpenActivities && (
          <div 
            onClick={onOpenActivities}
            className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-indigo-300 transition-all cursor-pointer flex items-center justify-between"
          >
            <div>
              <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">LOG KEGIATAN OPERASIONAL</p>
              <h4 className="font-display font-bold text-xs text-slate-800 mt-1">Lihat Activity Log Seluruh User</h4>
              <p className="text-[10px] text-slate-400 mt-0.5">Monitoring lokasi GPS &amp; abnormal check-in kegiatan lapangan</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <CalendarCheck className="w-5 h-5" />
            </div>
          </div>
        )}

        {/* Modal Cek GPS Perangkat */}
        {isGpsModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
              {/* Header Modal */}
              <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 text-white p-5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-emerald-300" />
                  </div>
                  <div>
                    <h3 className="text-base font-display font-bold text-white flex items-center gap-2">
                      Diagnostik &amp; Form Parameter GPS
                      <span className="text-[9px] font-bold bg-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-400/30 uppercase tracking-wider">
                        Monitoring Berulang Aktif
                      </span>
                    </h3>
                    <p className="text-[11px] text-emerald-200 mt-0.5">
                      Pengecekan GPS otomatis berjalan berulang sampai Anda menekan tombol Keluar / Kembali
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsGpsModalOpen(false)}
                    className="px-3.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-400/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Keluar / Kembali"
                  >
                    <ArrowLeft className="w-4 h-4 text-rose-300" />
                    <span className="hidden sm:inline">Keluar / Kembali</span>
                  </button>
                  <button
                    onClick={() => setIsGpsModalOpen(false)}
                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Status Banner Pengecekan Berulang */}
              <div className="bg-emerald-900/10 border-b border-emerald-200/60 px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-900 font-medium">
                  {isAutoGpsActive ? (
                    <>
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600"></span>
                      </span>
                      <span className="font-bold">Pengecekan GPS Berulang Sedang Aktif</span>
                      <span className="text-[11px] text-emerald-700 font-mono hidden sm:inline">(Refresh otomatis tiap ~2.5 detik)</span>
                    </>
                  ) : (
                    <>
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500 inline-block"></span>
                      <span className="font-bold text-amber-900">Pengecekan Dijeda</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="bg-emerald-100 text-emerald-800 font-extrabold px-2 py-0.5 rounded-full font-mono">
                    Total Cek: {gpsUpdateCount}x
                  </span>
                </div>
              </div>

              {/* Body Content */}
              <div className="p-5 overflow-y-auto space-y-4">
                {isFetchingGpsModal && !gpsModalPosition ? (
                  <div className="py-12 text-center space-y-3">
                    <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mx-auto" />
                    <div>
                      <h4 className="text-sm font-bold text-slate-800 font-display">Meminta Sinyal &amp; Parameter GPS...</h4>
                      <p className="text-xs text-slate-400 mt-1">Mengakses sensor Geolocation API dari perangkat ini</p>
                    </div>
                  </div>
                ) : gpsModalError && !gpsModalPosition ? (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 space-y-3">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-bold text-rose-900">Gagal Mengambil Lokasi GPS</h4>
                        <p className="text-xs text-rose-700 mt-1 font-medium">{gpsModalError}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={fetchGpsDataManual}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Coba Ulangi Cek GPS
                      </button>
                      <button
                        onClick={() => setIsGpsModalOpen(false)}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-all cursor-pointer"
                      >
                        Keluar / Kembali
                      </button>
                    </div>
                  </div>
                ) : gpsModalPosition ? (() => {
                  const coords = gpsModalPosition.coords;
                  const lat = coords.latitude;
                  const lng = coords.longitude;
                  const acc = coords.accuracy;
                  const altitude = coords.altitude;
                  const altAcc = coords.altitudeAccuracy;
                  const heading = coords.heading;
                  const speed = coords.speed;
                  const timestamp = gpsModalPosition.timestamp;
                  const fakeCheck = detectFakeGps(gpsModalPosition, '', prevGpsModalPosition, gpsUpdateCount);

                  const latLngStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

                  const isHighAcc = acc <= 15;
                  const isMedAcc = acc > 15 && acc <= 50;

                  return (
                    <div className="space-y-4">
                      {/* Top Quick Status Badges */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">IZIN GPS BROWSER</span>
                          <span className={`inline-block text-[10px] font-extrabold mt-1 px-2 py-0.5 rounded-full uppercase ${
                            permissionState.toLowerCase() === 'granted' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            {permissionState}
                          </span>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">TINGKAT AKURASI</span>
                          <span className={`inline-block text-[10px] font-extrabold mt-1 px-2 py-0.5 rounded-full ${
                            isHighAcc ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : isMedAcc ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {isHighAcc ? 'Tinggi (< 15m)' : isMedAcc ? 'Sedang (15-50m)' : 'Rendah (> 50m)'}
                          </span>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">SKOR VALIDITAS HARDWARE</span>
                          <span className={`inline-block text-[10px] font-extrabold mt-1 px-2 py-0.5 rounded-full uppercase ${
                            fakeCheck.overallScore >= 80 ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : fakeCheck.overallScore >= 60 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {fakeCheck.overallScore} / 100 ({fakeCheck.isFake ? 'Indikasi Fake' : 'Valid Hardware'})
                          </span>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">UPDATE TERAKHIR</span>
                          <span className="text-xs font-bold font-mono text-emerald-700 mt-1 block">
                            {lastGpsCheckTime ? lastGpsCheckTime.toLocaleTimeString('id-ID') : '-'}
                          </span>
                        </div>
                      </div>

                      {/* Card Evaluasi Kombinasi 3 Parameter Fake GPS */}
                      {fakeCheck.evaluations && (
                        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white p-4 rounded-2xl shadow-md border border-slate-700 space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-700 pb-2.5">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4 text-emerald-400" />
                              <h4 className="text-xs font-bold text-white font-display uppercase tracking-wider">
                                Metode Evaluasi Fake GPS System (3 Parameter Hardware)
                              </h4>
                            </div>
                            <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase ${
                              fakeCheck.isFake ? 'bg-rose-500/20 text-rose-300 border border-rose-400/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                            }`}>
                              {fakeCheck.isFake ? 'Terdeteksi Anomali' : 'Terverifikasi Asli'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                            {/* Parameter 1: Timestamp Hardware */}
                            {(() => {
                              const ts = fakeCheck.evaluations.timestamp;
                              return (
                                <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 flex flex-col justify-between">
                                  <div>
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-tight">
                                        1. Timestamp Hardware
                                      </span>
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                        ts.status === 'VALID' ? 'bg-emerald-500/20 text-emerald-300' : ts.status === 'WARNING' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                                      }`}>
                                        {ts.status} ({ts.score}%)
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-mono font-bold text-emerald-300">{ts.detailValue}</p>
                                    <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{ts.analysisNote}</p>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Parameter 2: Akurasi Radius */}
                            {(() => {
                              const acc = fakeCheck.evaluations.accuracy;
                              return (
                                <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 flex flex-col justify-between">
                                  <div>
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-tight">
                                        2. Akurasi Radius
                                      </span>
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                        acc.status === 'VALID' ? 'bg-emerald-500/20 text-emerald-300' : acc.status === 'WARNING' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                                      }`}>
                                        {acc.status} ({acc.score}%)
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-mono font-bold text-emerald-300">{acc.detailValue}</p>
                                    <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{acc.analysisNote}</p>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Parameter 3: Data Elevasi */}
                            {(() => {
                              const alt = fakeCheck.evaluations.elevation;
                              return (
                                <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 flex flex-col justify-between">
                                  <div>
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-tight">
                                        3. Data Elevasi 3D
                                      </span>
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                        alt.status === 'VALID' ? 'bg-emerald-500/20 text-emerald-300' : alt.status === 'WARNING' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                                      }`}>
                                        {alt.status} ({alt.score}%)
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-mono font-bold text-emerald-300">{alt.detailValue}</p>
                                    <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{alt.analysisNote}</p>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Fake GPS Warning if detected */}
                      {fakeCheck.isFake && (
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          <div className="text-xs text-amber-900">
                            <span className="font-bold block">Catatan Anomali Fake GPS:</span>
                            <span>{fakeCheck.reason}</span>
                          </div>
                        </div>
                      )}

                      {/* Form Parameter Grid */}
                      <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 font-display">
                            <Navigation className="w-4 h-4 text-emerald-600" />
                            Parameter Sensor GPS Perangkat (Live)
                          </h4>
                          <span className="text-[10px] text-slate-400 font-mono">
                            Fixed: {new Date(timestamp).toLocaleTimeString('id-ID')}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Latitude */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Garis Lintang (Latitude)
                            </label>
                            <div className="relative">
                              <input
                                type="text"
                                readOnly
                                value={lat}
                                className="w-full bg-white border border-slate-200 text-slate-900 text-xs font-mono font-bold rounded-xl py-2 px-3 pr-9 shadow-sm"
                              />
                              <button
                                onClick={() => copyToClipboard(String(lat), 'lat')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                                title="Salin Latitude"
                              >
                                {copiedField === 'lat' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          {/* Longitude */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Garis Bujur (Longitude)
                            </label>
                            <div className="relative">
                              <input
                                type="text"
                                readOnly
                                value={lng}
                                className="w-full bg-white border border-slate-200 text-slate-900 text-xs font-mono font-bold rounded-xl py-2 px-3 pr-9 shadow-sm"
                              />
                              <button
                                onClick={() => copyToClipboard(String(lng), 'lng')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                                title="Salin Longitude"
                              >
                                {copiedField === 'lng' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          {/* Akurasi */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Akurasi Radius (Accuracy)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={`${acc.toFixed(2)} Meter (${Math.round(acc)}m)`}
                              className="w-full bg-white border border-slate-200 text-slate-900 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Lat Lng Combined */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Koordinat Gabungan (Lat, Lng)
                            </label>
                            <div className="relative">
                              <input
                                type="text"
                                readOnly
                                value={latLngStr}
                                className="w-full bg-white border border-indigo-200 text-indigo-700 text-xs font-mono font-bold rounded-xl py-2 px-3 pr-9 shadow-sm"
                              />
                              <button
                                onClick={() => copyToClipboard(latLngStr, 'latlng')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                                title="Salin Koordinat Gabungan"
                              >
                                {copiedField === 'latlng' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          {/* Altitude */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Ketinggian / Elevasi (Altitude)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={altitude !== null && altitude !== undefined ? `${altitude.toFixed(2)} Meter` : 'Tidak Didukung Hardware (Null)'}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Altitude Accuracy */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Akurasi Ketinggian (Altitude Accuracy)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={altAcc !== null && altAcc !== undefined ? `${altAcc.toFixed(2)} Meter` : 'Tidak Didukung Hardware (Null)'}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Heading */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Arah Vektor Pergerakan (Heading)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={heading !== null && !isNaN(heading) ? `${heading.toFixed(1)}° (Derajat)` : 'Diam / Tidak Ada Arah (Null)'}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Speed */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Kecepatan Perangkat (Speed)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={speed !== null && !isNaN(speed) ? `${(speed * 3.6).toFixed(2)} km/jam (${speed.toFixed(2)} m/s)` : '0 km/jam (Diam)'}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Timestamp Hardware */}
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Waktu Terekam Sensor GPS Hardware (Timestamp Epoch)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={`${new Date(timestamp).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'medium' })} (${timestamp})`}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Timestamp Hardware Delta dalam milidetik (ms) */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Timestamp Hardware Delta (Milidetik / ms)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={fakeCheck.timeDeltaMs !== null && fakeCheck.timeDeltaMs !== undefined ? `${fakeCheck.timeDeltaMs.toLocaleString('id-ID')} ms (${(fakeCheck.timeDeltaMs / 1000).toFixed(2)} detik)` : 'Tidak Tersedia'}
                              className={`w-full bg-white border text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm ${
                                fakeCheck.isTimestampStagnant ? 'border-rose-300 text-rose-700 bg-rose-50/50' : 'border-emerald-300 text-emerald-800 bg-emerald-50/30'
                              }`}
                            />
                          </div>

                          {/* Evaluasi Dinamika Fix Timestamp */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Dinamika Perubahan Fix (Polling #{gpsUpdateCount})
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={
                                gpsUpdateCount <= 1
                                  ? 'Cek Awal (Memantau Polling Next Fix)'
                                  : fakeCheck.isTimestampStagnant
                                  ? 'ANOMALI: Stagnan / Beku (Indikasi Fake GPS)'
                                  : 'VALID: Dinamis / Fresh Fix (Sinyal Asli)'
                              }
                              className={`w-full bg-white border text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm ${
                                fakeCheck.isTimestampStagnant ? 'border-rose-300 text-rose-700 bg-rose-50/50' : 'border-emerald-300 text-emerald-800 bg-emerald-50/30'
                              }`}
                            />
                          </div>

                          {/* User Agent */}
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              User Agent / Informasi Perangkat Browser
                            </label>
                            <textarea
                              readOnly
                              rows={2}
                              value={navigator.userAgent}
                              className="w-full bg-white border border-slate-200 text-slate-600 text-[10px] font-mono rounded-xl p-2.5 resize-none shadow-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Bottom Action Controls */}
                      <div className="pt-3 flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-200">
                        <div className="flex flex-wrap items-center gap-2">
                          {isAutoGpsActive ? (
                            <button
                              onClick={() => setIsAutoGpsActive(false)}
                              className="px-3.5 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                            >
                              <Pause className="w-3.5 h-3.5" />
                              Jeda Pengecekan
                            </button>
                          ) : (
                            <button
                              onClick={() => setIsAutoGpsActive(true)}
                              className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              Lanjutkan Pengecekan Berulang
                            </button>
                          )}

                          <button
                            onClick={fetchGpsDataManual}
                            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl border border-slate-200 transition-all flex items-center gap-2 cursor-pointer"
                            title="Paksa refresh lokasi sekarang"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Refresh Sekarang
                          </button>

                          <a
                            href={`https://www.google.com/maps?q=${lat},${lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer border border-slate-200"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-slate-600" />
                            Maps
                          </a>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const summaryText = `--- DATA DIAGNOSTIK GPS PERANGKAT ---
Tanggal Fix: ${new Date(timestamp).toLocaleString('id-ID')}
Latitude: ${lat}
Longitude: ${lng}
Koordinat: ${latLngStr}
Akurasi: ${acc.toFixed(2)}m
Elevasi: ${altitude !== null ? `${altitude}m` : 'Null'}
Akurasi Elevasi: ${altAcc !== null ? `${altAcc}m` : 'Null'}
Arah (Heading): ${heading !== null ? `${heading}°` : 'Null'}
Kecepatan: ${speed !== null ? `${speed}m/s` : '0'}
Evaluasi Fake GPS: ${fakeCheck.reason}
User Agent: ${navigator.userAgent}`;
                              copyToClipboard(summaryText, 'all');
                            }}
                            className="px-3.5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                          >
                            {copiedField === 'all' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedField === 'all' ? 'Tersalin!' : 'Salin Parameter'}
                          </button>

                          {/* Explicit Keluar / Kembali Button */}
                          <button
                            onClick={() => setIsGpsModalOpen(false)}
                            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer border border-slate-700"
                          >
                            <ArrowLeft className="w-4 h-4 text-slate-300" />
                            Keluar / Kembali
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })() : null}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Compute stats for DIREKTUR role
  if (role === Role.DIREKTUR) {
    const activeReqs = requests.filter(r => r.status !== RequestStatus.CANCELLED);
    const isBbmRequest = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');

    // Direct reports approval & reconciliation tasks for Direktur (where managerEmail matches Direktur email or hierarchy)
    const direkturEmails = new Set<string>([
      'margono@depotel.com',
      'direktur@company.com'
    ]);
    profiles
      .filter(p => p.role === Role.DIREKTUR)
      .forEach(p => {
        if (p.email) direkturEmails.add(p.email.trim().toLowerCase());
      });
    if (email) direkturEmails.add(email.trim().toLowerCase());
    if (userProfile?.email) direkturEmails.add(userProfile.email.trim().toLowerCase());

    const isDirekturDirectReq = (r: BudgetRequest) => {
      const reqManagerEmail = (r.managerEmail || '').trim().toLowerCase();
      const requesterProfile = profiles.find(p => p.email.trim().toLowerCase() === (r.userEmail || '').trim().toLowerCase());

      // Check role of requester (MANAGER and FINANCE are direct subordinates of Direktur)
      if (requesterProfile?.role === Role.MANAGER || requesterProfile?.role === Role.FINANCE) {
        return true;
      }

      // Direct check on ManagerEmail field (e.g. margono@depotel.com)
      if (reqManagerEmail && (
        direkturEmails.has(reqManagerEmail) || 
        reqManagerEmail.includes('margono') || 
        reqManagerEmail.includes('direktur') || 
        (email && reqManagerEmail === email.trim().toLowerCase()) ||
        (userProfile?.email && reqManagerEmail === userProfile.email.trim().toLowerCase())
      )) {
        return true;
      }

      // Check hierarchy from user profiles
      if (requesterProfile) {
        const profileMgrEmail = (requesterProfile.managerEmail || '').trim().toLowerCase();
        if (profileMgrEmail && (
          direkturEmails.has(profileMgrEmail) || 
          profileMgrEmail.includes('margono') || 
          profileMgrEmail.includes('direktur') || 
          (email && profileMgrEmail === email.trim().toLowerCase()) ||
          (userProfile?.email && profileMgrEmail === userProfile.email.trim().toLowerCase())
        )) {
          return true;
        }
      }
      return false;
    };

    const direkturDirectReqs = activeReqs.filter(r => isDirekturDirectReq(r));
    const pendingBudgetReview = direkturDirectReqs.filter(r => 
      r.status === RequestStatus.PENDING_APPROVAL || r.status === RequestStatus.PARTIALLY_APPROVED
    ).length;
    const pendingReportReview = direkturDirectReqs.filter(r => {
      if (![RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER].includes(r.status)) return false;
      const reqItems = usageItems.filter(item => item.requestId === r.id);
      if (reqItems.length === 0) return false;
      return reqItems.some(i => i.statusManager === ItemStatus.PENDING);
    }).length;
    const totalApprovalTasks = pendingBudgetReview + pendingReportReview;

    // Company-wide Executive stats for MONITORING (memuat seluruh UID perusahaan, sama seperti Role Finance)
    const monitoringReqs = activeReqs;

    // 1. PENGAJUAN (Pending Approval by Manager / Partially Approved)
    const pengajuanCount = monitoringReqs.filter(r => 
      r.status === RequestStatus.PENDING_APPROVAL || r.status === RequestStatus.PARTIALLY_APPROVED
    ).length;

    // 2. MENUNGGU TRANSFER (Approved by Manager / Partially Approved or Bailout Reimbursement pending)
    const pendingTransferReqs = monitoringReqs.filter(r => 
      r.status === RequestStatus.APPROVED || 
      r.status === RequestStatus.PARTIALLY_APPROVED || 
      r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
    );
    const menungguTransferCount = pendingTransferReqs.length;
    const menungguTransferNominal = pendingTransferReqs.reduce((sum, r) => {
      if (r.status === RequestStatus.PENDING_TALANGAN_TRANSFER) {
        const reqItems = usageItems.filter(i => i.requestId === r.id && i.statusManager === ItemStatus.APPROVED);
        const approvedUsage = reqItems.reduce((iSum, item) => iSum + (item.nominal || 0), 0);
        return sum + (approvedUsage || r.managerActionAmount || r.jumlahPengajuan || 0);
      }
      const amt = r.managerActionAmount > 0 ? r.managerActionAmount : (r.jumlahPengajuan || 0);
      return sum + amt;
    }, 0);

    // 3. PROSES LAPORAN (Transferred, Reporting, Review Manager, Review Admin)
    const prosesLaporanCount = monitoringReqs.filter(r => 
      [RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(r.status)
    ).length;

    // 4. CLOSED (Closed requests excluding BBMDS)
    const closedCount = monitoringReqs.filter(r => r.status === RequestStatus.CLOSED && !isBbmRequest(r)).length;

    // Financial totals for executive summary (Monitoring) - aligned with Role Finance formulas
    const isBbmUsageItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

    const totalPengajuan = activeReqs.reduce((sum, r) => sum + (r.jumlahPengajuan || 0), 0);
    const totalTransferred = requests
      .filter(r => !isBbmRequest(r))
      .reduce((sum, r) => sum + (r.adminActionAmount || 0), 0);
    const totalClosed = usageItems
      .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED && !isBbmUsageItem(item))
      .reduce((sum, item) => sum + (item.nominal || 0), 0);

    return (
      <div className="space-y-4">
        {/* DIREKTUR TAB SWITCHER */}
        <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center gap-1.5 border border-slate-200/80 shadow-xs">
          <button
            type="button"
            onClick={() => {
              updateDirekturTab('APPROVAL');
              if (onSelectFilter && (activeFilter === 'DIREKTUR_APPROVAL' || activeFilter === 'DIREKTUR_RECONCILIATION')) {
                onSelectFilter('ALL');
              }
            }}
            className={`flex-1 py-2.5 px-3 rounded-xl font-display font-black text-xs transition-all cursor-pointer flex items-center justify-center gap-2 ${
              direkturGroupTab === 'APPROVAL'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>APPROVAL</span>
            {totalApprovalTasks > 0 && (
              <span className={`px-2 py-0.5 text-[10px] rounded-full font-bold ${
                direkturGroupTab === 'APPROVAL' ? 'bg-purple-800 text-purple-100' : 'bg-purple-600 text-white'
              }`}>
                {totalApprovalTasks}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              updateDirekturTab('MONITORING');
              if (onSelectFilter && (activeFilter === 'DIREKTUR_APPROVAL' || activeFilter === 'DIREKTUR_RECONCILIATION')) {
                onSelectFilter('ALL');
              }
            }}
            className={`flex-1 py-2.5 px-3 rounded-xl font-display font-black text-xs transition-all cursor-pointer flex items-center justify-center gap-2 ${
              direkturGroupTab === 'MONITORING'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>MONITORING</span>
          </button>
        </div>

        {/* KELOMPOK APPROVAL TAB CONTENT */}
        {direkturGroupTab === 'APPROVAL' && (
          <div className="space-y-4">
            {/* Urgent Task Card untuk Direktur */}
            {totalApprovalTasks > 0 ? (
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-purple-700 shrink-0">
                  <ClipboardCheck className="w-5.5 h-5.5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-purple-900 text-xs tracking-wide uppercase">TUGAS PERSETUJUAN DIREKTUR ({totalApprovalTasks})</h3>
                  <p className="text-xs text-purple-700 font-medium mt-0.5">
                    Ada {pendingBudgetReview} pengajuan anggaran baru dan {pendingReportReview} laporan operasional yang membutuhkan tinjauan Anda.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <CheckCircle2 className="w-5.5 h-5.5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-emerald-900 text-xs tracking-wide uppercase">SEMUA TINJAUAN DIREKTUR BERES</h3>
                  <p className="text-xs text-emerald-700 font-medium mt-0.5">
                    Tidak ada tugas persetujuan anggaran atau review laporan bawahan langsung yang tertunda.
                  </p>
                </div>
              </div>
            )}

            {/* 2 Kartu Akses Approval & Review Direktur */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div 
                onClick={() => handleCardClick('DIREKTUR_APPROVAL')}
                className={`p-4.5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-purple-300 hover:shadow-md flex flex-col justify-between min-h-[130px] ${
                  activeFilter === 'DIREKTUR_APPROVAL' ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <p className="text-[10px] font-bold text-purple-600 uppercase tracking-widest flex items-center gap-1">
                    <span>ALUR PERSETUJUAN DIREKTUR</span>
                  </p>
                  <h4 className="font-display font-black text-slate-800 text-xs mt-1">Approval Pengajuan Anggaran</h4>
                </div>
                <div>
                  <div className="flex items-end justify-between mt-2">
                    <span className="text-2xl font-display font-bold text-slate-900">{pendingBudgetReview} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                    <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-amber-200/60">Persetujuan (Aksi)</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1 font-medium">Pengajuan anggaran dari bawahan hirarki Direktur</p>
                </div>
              </div>

              <div 
                onClick={() => handleCardClick('DIREKTUR_RECONCILIATION')}
                className={`p-4.5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-purple-300 hover:shadow-md flex flex-col justify-between min-h-[130px] ${
                  activeFilter === 'DIREKTUR_RECONCILIATION' ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <p className="text-[10px] font-bold text-purple-600 uppercase tracking-widest flex items-center gap-1">
                    <span>ALUR REKONSILIASI DIREKTUR</span>
                  </p>
                  <h4 className="font-display font-black text-slate-800 text-xs mt-1">Review Penggunaan Anggaran</h4>
                </div>
                <div>
                  <div className="flex items-end justify-between mt-2">
                    <span className="text-2xl font-display font-bold text-slate-900">{pendingReportReview} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                    <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-purple-200/60">Review Laporan (Aksi)</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1 font-medium">Laporan nota & dana talangan dari bawahan hirarki Direktur</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KELOMPOK MONITORING TAB CONTENT */}
        {direkturGroupTab === 'MONITORING' && (
          <div className="space-y-4">
            {/* Banner Direktur */}
            <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white p-5 rounded-2xl shadow-lg border border-purple-800/50">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold tracking-widest text-purple-300 uppercase bg-purple-950/80 px-2.5 py-1 rounded-lg border border-purple-700/50">
                    Ringkasan Eksekutif Direktur
                  </span>
                  <h2 className="text-base font-display font-bold mt-2 text-white">Monitoring Operasional Anggaran</h2>
                  <p className="text-[11px] text-purple-200 mt-0.5">
                    Tinjauan & review status UID pengajuan anggaran seluruh operasional perusahaan.
                  </p>
                </div>
                <div className="hidden sm:flex w-11 h-11 rounded-2xl bg-purple-500/20 border border-purple-400/30 items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6 text-purple-300" />
                </div>
              </div>
            </div>

            {/* 4 Core Cards Grid */}
            <div className="grid grid-cols-2 gap-3.5">
              {/* Card 1: PENGAJUAN */}
              <div
                onClick={() => handleCardClick('PENDING')}
                className={`p-4 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-purple-300 hover:shadow-md ${
                  activeFilter === 'PENDING' ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PENGAJUAN</p>
                <div className="flex items-end justify-between mt-2">
                  <span className="text-2xl sm:text-3xl font-display font-bold text-slate-900">{pengajuanCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                  <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-amber-200/60">Tinjauan</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 font-medium">Menunggu persetujuan Manager</p>
              </div>

              {/* Card 2: MENUNGGU TRANSFER */}
              <div
                onClick={() => handleCardClick('APPROVED')}
                className={`p-4 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-purple-300 hover:shadow-md ${
                  activeFilter === 'APPROVED' ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">MENUNGGU TRANSFER</p>
                <div className="flex items-end justify-between mt-2">
                  <span className="text-2xl sm:text-3xl font-display font-bold text-slate-900">{menungguTransferCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                  <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-blue-200/60">Transfer</span>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100/80 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-medium">Total Nominal:</span>
                  <span className="text-xs font-bold text-slate-800 font-mono">
                    Rp {menungguTransferNominal.toLocaleString('id-ID')}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">Disetujui, antrean pencairan Finance</p>
              </div>

              {/* Card 3: PROSES LAPORAN */}
              <div
                onClick={() => handleCardClick('REPORTING')}
                className={`p-4 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-purple-300 hover:shadow-md ${
                  activeFilter === 'REPORTING' ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PROSES LAPORAN</p>
                <div className="flex items-end justify-between mt-2">
                  <span className="text-2xl sm:text-3xl font-display font-bold text-slate-900">{prosesLaporanCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                  <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-purple-200/60">Penggunaan</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 font-medium">Pengisian & verifikasi laporan</p>
              </div>

              {/* Card 4: CLOSED */}
              <div
                onClick={() => handleCardClick('CLOSED')}
                className={`p-4 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-purple-300 hover:shadow-md ${
                  activeFilter === 'CLOSED' ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">CLOSED</p>
                <div className="flex items-end justify-between mt-2">
                  <span className="text-2xl sm:text-3xl font-display font-bold text-slate-900">{closedCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                  <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-emerald-200/60">Selesai</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-2 font-medium">Laporan lengkap & ter-closing</p>
              </div>
            </div>

            {/* Kartu Activity User - DIREKTUR */}
            {(() => {
              const getTodayStr = () => {
                const d = new Date();
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
              };
              const todayStr = getTodayStr();

              const todayAllActivitiesCount = activities.filter(act => act.tanggal === todayStr).length;

              return (
                <div 
                  onClick={onOpenActivities}
                  className="bg-white border border-purple-200/80 rounded-2xl p-5 shadow-sm hover:border-purple-400 hover:shadow-md transition-all cursor-pointer flex items-center justify-between bg-gradient-to-r from-purple-50/40 via-white to-indigo-50/30"
                  id="direktur-activity-card"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[10px] font-bold text-purple-700 tracking-widest uppercase">ACTIVITY USER (SEMUA USER)</p>
                      <span className="text-[9px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                        Eksekutif
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-display font-bold text-slate-900">{todayAllActivitiesCount}</span>
                      <span className="text-xs text-slate-500 font-medium">Log Kegiatan Hari Ini</span>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1 font-medium">Klik untuk melihat log kegiatan seluruh user (Filter Divisi, User &amp; Tanggal)</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 shadow-sm">
                    <CalendarCheck className="w-6 h-6" />
                  </div>
                </div>
              );
            })()}

            {/* Total Financial Summary Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">IKHTISAR REKONSILIASI KEUANGAN</p>
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Total Pengajuan</span>
                  <span className="text-base font-extrabold font-display text-slate-800 mt-0.5 block">{formatIDR(totalPengajuan)}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Total Dana Ditransfer</span>
                  <span className="text-base font-extrabold font-display text-indigo-600 mt-0.5 block">{formatIDR(totalTransferred)}</span>
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                  <div>
                    <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Total Closing Terverifikasi</span>
                    <span className="text-base font-extrabold font-display text-emerald-600 mt-0.5 block">{formatIDR(totalClosed)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Selisih Belum Closing</span>
                    <span className="text-base font-extrabold font-display text-amber-600 mt-0.5 block">{formatIDR(totalTransferred - totalClosed)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
};
