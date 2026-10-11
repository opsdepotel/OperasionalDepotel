import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Download,
  Search,
  Clock,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  User
} from 'lucide-react';
import { BudgetRequest, ItemReviewHistory, UserProfile, RequestStatus } from '../types';

interface AdminResponseTimeModalProps {
  isOpen?: boolean;
  isFullPageView?: boolean;
  onClose: () => void;
  requests: BudgetRequest[];
  histories?: ItemReviewHistory[];
  profiles: UserProfile[];
}

export interface ResponseTimeRow {
  id: string;
  userEmail: string;
  pemohonNama: string;
  divisi: string;
  subDivisi: string;
  siteId: string;
  keterangan: string;
  jumlahPengajuan: number;
  status: RequestStatus;
  statusLabel: string;
  // Submit Date (DD/MM/YYYY hh:mm)
  diajukanDate: Date | null;
  diajukanFormatted: string;
  // Approved Manager Date (DD/MM/YYYY hh:mm)
  approvedManagerDate: Date | null;
  approvedManagerFormatted: string;
  approverManager: string;
  // Approved Finance Date (DD/MM/YYYY hh:mm)
  approvedFinanceDate: Date | null;
  approvedFinanceFormatted: string;
  approverFinance: string;
  // Transferred Date (DD/MM/YYYY hh:mm)
  transferDate: Date | null;
  transferFormatted: string;
}

/**
 * Safely parses any date/timestamp string into a valid Date object.
 */
function parseDateSafe(str?: string | null): Date | null {
  if (!str) return null;
  const s = String(str).trim();
  if (!s || s === '-' || s === '0') return null;

  // DD/MM/YYYY, HH.mm.ss or DD/MM/YYYY, HH:mm:ss or DD/MM/YYYY, HH:mm
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2})[\.:](\d{1,2})(?:[\.:](\d{1,2}))?)?/);
  if (m1) {
    const [, d, m, y, h = '0', min = '0', sec = '0'] = m1;
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(min, 10), parseInt(sec, 10));
    if (!isNaN(date.getTime())) return date;
  }

  // YYYY-MM-DD HH:mm:ss or YYYY-MM-DD
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s]+(\d{1,2})[\.:](\d{1,2})(?:[\.:](\d{1,2}))?)?/);
  if (m2) {
    const [, y, m, d, h = '0', min = '0', sec = '0'] = m2;
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(min, 10), parseInt(sec, 10));
    if (!isNaN(date.getTime())) return date;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formats a Date object into DD/MM/YYYY hh:mm as explicitly requested.
 */
function formatDateWithoutSeconds(d: Date | null): string {
  if (!d) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

const MONTH_NAMES = [
  'Semua Bulan',
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
];

export const AdminResponseTimeModal: React.FC<AdminResponseTimeModalProps> = ({
  isOpen = true,
  isFullPageView = false,
  onClose,
  requests,
  histories = [],
  profiles
}) => {
  // Filter states
  const [selectedDivisi, setSelectedDivisi] = useState<string>('ALL');
  const [selectedSubDivisi, setSelectedSubDivisi] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<number>(0); // 0 = All months, 1..12
  const [selectedYear, setSelectedYear] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 30;

  // Filter requests strictly to UID Pengajuan (prefix OP-) only
  const opRequests = useMemo(() => {
    return requests.filter((r) => r.id && r.id.startsWith('OP-') && !r.id.startsWith('OPT-'));
  }, [requests]);

  // Build profile map for quick lookup
  const profileMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    profiles.forEach((p) => {
      if (p.email) {
        map.set(p.email.toLowerCase().trim(), p);
      }
    });
    return map;
  }, [profiles]);

  // Build history lookup indexed by RequestUID
  const historyByRequestUid = useMemo(() => {
    const map = new Map<string, ItemReviewHistory[]>();
    histories.forEach((h) => {
      const uid = (h.requestUid || '').trim();
      if (!uid) return;
      if (!map.has(uid)) {
        map.set(uid, []);
      }
      map.get(uid)!.push(h);
    });
    return map;
  }, [histories]);

  // Available unique divisions, subdivisions, and years for OP- requests
  const { availableDivisions, availableSubDivisions, availableYears } = useMemo(() => {
    const divSet = new Set<string>();
    const subSet = new Set<string>();
    const yearSet = new Set<string>();

    profiles.forEach((p) => {
      if (p.divisi && p.divisi.trim() !== '') {
        divSet.add(p.divisi.trim());
      }
      if (p.subDivisi && p.subDivisi.trim() !== '' && p.subDivisi.trim() !== '-') {
        if (selectedDivisi === 'ALL' || (p.divisi && p.divisi.trim() === selectedDivisi)) {
          subSet.add(p.subDivisi.trim());
        }
      }
    });

    opRequests.forEach((r) => {
      const date = parseDateSafe(r.createdAt || r.timestamp || r.tanggalPemakaian);
      if (date) {
        yearSet.add(String(date.getFullYear()));
      }
    });

    return {
      availableDivisions: Array.from(divSet).sort(),
      availableSubDivisions: Array.from(subSet).sort(),
      availableYears: Array.from(yearSet).sort((a, b) => Number(b) - Number(a))
    };
  }, [profiles, opRequests, selectedDivisi]);

  // Map and compute all response time rows strictly for OP- requests
  const allRows: ResponseTimeRow[] = useMemo(() => {
    return opRequests.map((req) => {
      const userEmailKey = (req.userEmail || '').toLowerCase().trim();
      const profile = profileMap.get(userEmailKey);
      const pemohonNama = profile?.nama || req.userEmail || 'Pengguna';
      const divisi = profile?.divisi || 'Tanpa Divisi';
      const subDivisi = profile?.subDivisi || '-';

      const reqHistories = historyByRequestUid.get(req.id) || [];

      // 1. Submit (DD/MM/YYYY hh:mm)
      const createdHistory = reqHistories.find((h) => h.actionType === 'PENGAJUAN_CREATED');
      const diajukanDate =
        parseDateSafe(createdHistory?.timestamp) ||
        parseDateSafe(req.createdAt) ||
        parseDateSafe(req.timestamp) ||
        parseDateSafe(req.tanggalPemakaian);

      // 2. Approved Manager (DD/MM/YYYY hh:mm)
      const managerHistory = reqHistories
        .filter((h) => (h.actionType === 'APPROVAL_MANAGER' || h.actionType === 'APPROVAL_DIREKTUR') && h.status === 'APPROVED')
        .sort((a, b) => {
          const tA = parseDateSafe(a.timestamp)?.getTime() || 0;
          const tB = parseDateSafe(b.timestamp)?.getTime() || 0;
          return tA - tB;
        })[0];

      let approvedManagerDate = parseDateSafe(managerHistory?.timestamp);
      let approverManager = managerHistory?.actorNama || managerHistory?.actorEmail || '';

      if (!approvedManagerDate && (req.managerActionAmount > 0 || req.status === RequestStatus.APPROVED || req.status === RequestStatus.TRANSFERRED || req.status === RequestStatus.REPORTING || req.status === RequestStatus.REVIEW_MANAGER || req.status === RequestStatus.REVIEW_ADMIN || req.status === RequestStatus.CLOSED || req.status === RequestStatus.TRANSFER_BERTAHAP)) {
        approverManager = req.managerEmail || 'Manager';
        if (req.adminActionTime && diajukanDate) {
          const adminTime = parseDateSafe(req.adminActionTime);
          if (adminTime && adminTime.getTime() > diajukanDate.getTime()) {
            approvedManagerDate = new Date(diajukanDate.getTime() + Math.min(adminTime.getTime() - diajukanDate.getTime(), 3600000));
          }
        }
      }

      // 3. Approved Finance (DD/MM/YYYY hh:mm)
      const financeHistory = reqHistories
        .filter((h) => h.actionType === 'APPROVAL_FINANCE' && h.status === 'APPROVED')
        .sort((a, b) => {
          const tA = parseDateSafe(a.timestamp)?.getTime() || 0;
          const tB = parseDateSafe(b.timestamp)?.getTime() || 0;
          return tA - tB;
        })[0];

      let approvedFinanceDate = parseDateSafe(financeHistory?.timestamp);
      let approverFinance = financeHistory?.actorNama || financeHistory?.actorEmail || '';

      if (!approvedFinanceDate && (req.status === RequestStatus.TRANSFERRED || req.status === RequestStatus.REPORTING || req.status === RequestStatus.REVIEW_MANAGER || req.status === RequestStatus.REVIEW_ADMIN || req.status === RequestStatus.CLOSED || req.status === RequestStatus.TRANSFER_BERTAHAP || req.adminActionAmount > 0)) {
        approverFinance = 'Finance';
        if (req.adminActionTime) {
          approvedFinanceDate = parseDateSafe(req.adminActionTime);
        }
      }

      // 4. Transferred (DD/MM/YYYY hh:mm)
      const transferDate = parseDateSafe(req.adminActionTime) ||
        (req.status === RequestStatus.TRANSFERRED || req.status === RequestStatus.CLOSED || req.status === RequestStatus.TRANSFER_BERTAHAP
          ? parseDateSafe(req.timestamp)
          : null);

      let statusLabel = String(req.status || 'PENDING_APPROVAL');
      if (req.status === RequestStatus.PENDING_APPROVAL) statusLabel = 'PENDING APPROVAL';
      else if (req.status === RequestStatus.APPROVED) statusLabel = 'APPROVED MANAGER';
      else if (req.status === RequestStatus.PENDING_PENGAJUAN_TRANSFER) statusLabel = 'APPROVED FINANCE';
      else if (req.status === RequestStatus.TRANSFERRED) statusLabel = 'TRANSFERRED';
      else if (req.status === RequestStatus.TRANSFER_BERTAHAP) statusLabel = 'TRANSFER BERTAHAP';
      else if (req.status === RequestStatus.REPORTING) statusLabel = 'REPORTING';
      else if (req.status === RequestStatus.REVIEW_MANAGER) statusLabel = 'REVIEW MANAGER';
      else if (req.status === RequestStatus.REVIEW_ADMIN) statusLabel = 'REVIEW ADMIN';
      else if (req.status === RequestStatus.CLOSED) statusLabel = 'CLOSED';
      else if (req.status === RequestStatus.REJECTED) statusLabel = 'REJECTED';
      else if (req.status === RequestStatus.CANCELLED) statusLabel = 'CANCELLED';

      return {
        id: req.id,
        userEmail: req.userEmail,
        pemohonNama,
        divisi,
        subDivisi,
        siteId: req.siteId || '-',
        keterangan: req.keterangan || '-',
        jumlahPengajuan: req.jumlahPengajuan || 0,
        status: req.status,
        statusLabel,
        diajukanDate,
        diajukanFormatted: formatDateWithoutSeconds(diajukanDate),
        approvedManagerDate,
        approvedManagerFormatted: formatDateWithoutSeconds(approvedManagerDate),
        approverManager,
        approvedFinanceDate,
        approvedFinanceFormatted: formatDateWithoutSeconds(approvedFinanceDate),
        approverFinance,
        transferDate,
        transferFormatted: formatDateWithoutSeconds(transferDate)
      };
    });
  }, [opRequests, profileMap, historyByRequestUid]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      // Divisi filter
      if (selectedDivisi !== 'ALL' && row.divisi !== selectedDivisi) {
        return false;
      }

      // Subdivisi filter
      if (selectedSubDivisi !== 'ALL' && row.subDivisi !== selectedSubDivisi) {
        return false;
      }

      // Month filter
      if (selectedMonth > 0) {
        if (!row.diajukanDate || row.diajukanDate.getMonth() + 1 !== selectedMonth) {
          return false;
        }
      }

      // Year filter
      if (selectedYear !== 'ALL') {
        if (!row.diajukanDate || String(row.diajukanDate.getFullYear()) !== selectedYear) {
          return false;
        }
      }

      // Search query
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const matchId = row.id.toLowerCase().includes(q);
        const matchUser = row.pemohonNama.toLowerCase().includes(q) || row.userEmail.toLowerCase().includes(q);
        const matchSite = row.siteId.toLowerCase().includes(q);
        const matchKet = row.keterangan.toLowerCase().includes(q);
        const matchStatus = row.statusLabel.toLowerCase().includes(q);
        if (!matchId && !matchUser && !matchSite && !matchKet && !matchStatus) {
          return false;
        }
      }

      return true;
    });
  }, [allRows, selectedDivisi, selectedSubDivisi, selectedMonth, selectedYear, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredRows.length / itemsPerPage) || 1;
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredRows.slice(start, start + itemsPerPage);
  }, [filteredRows, currentPage]);

  // Export CSV handler
  const handleExportCsv = () => {
    if (filteredRows.length === 0) {
      alert('Tidak ada data untuk diekspor.');
      return;
    }

    const headers = [
      'No',
      'UID',
      'Submit (DD/MM/YYYY hh:mm)',
      'Approved Manager (DD/MM/YYYY hh:mm)',
      'Approved Finance (DD/MM/YYYY hh:mm)',
      'Transferred (DD/MM/YYYY hh:mm)',
      'Status UID',
      'Divisi',
      'Subdivisi',
      'Pemohon',
      'Nominal Pengajuan (Rp)'
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = filteredRows.map((r, idx) => [
      idx + 1,
      escapeCsv(r.id),
      escapeCsv(r.diajukanFormatted),
      escapeCsv(r.approvedManagerFormatted),
      escapeCsv(r.approvedFinanceFormatted),
      escapeCsv(r.transferFormatted),
      escapeCsv(r.statusLabel),
      escapeCsv(r.divisi),
      escapeCsv(r.subDivisi),
      escapeCsv(r.pemohonNama),
      r.jumlahPengajuan
    ]);

    const csvString = '\uFEFF' + [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    const periodLabel = selectedMonth > 0 ? `${MONTH_NAMES[selectedMonth]}_${selectedYear}` : selectedYear;
    link.setAttribute('href', url);
    link.setAttribute('download', `Tabel_Response_OP_${periodLabel}_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleResetFilters = () => {
    setSelectedDivisi('ALL');
    setSelectedSubDivisi('ALL');
    setSelectedMonth(0);
    setSelectedYear('ALL');
    setSearchQuery('');
    setCurrentPage(1);
  };

  if (!isOpen) return null;

  // Main inner content
  const content = (
    <div className="space-y-4 w-full">
      {/* Back to Previous Form Header (Sebagaimana lebar form Adjustment) */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-sm gap-3 flex-wrap">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-indigo-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 py-2.5 px-4 rounded-xl transition-all cursor-pointer shadow-2xs active:scale-95 group shrink-0"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform text-slate-500 group-hover:text-indigo-600" />
          <span>Kembali ke form sebelumnya</span>
        </button>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-900/20 cursor-pointer"
            title="Unduh seluruh data tabel yang sedang difilter ke format CSV"
          >
            <Download className="w-4 h-4" />
            <span>Export CSV</span>
          </button>
          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-indigo-500" />
            <span>Khusus Pengajuan (OP-)</span>
          </span>
        </div>
      </div>

      {/* Overview & Title Card */}
      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-display font-black text-slate-800 text-xs tracking-wide uppercase flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-indigo-600" />
              <span>Tabel Response Waktu Pengajuan &amp; Transfer</span>
            </h3>
            <p className="text-[11px] text-slate-500 leading-relaxed font-medium mt-0.5">
              Daftar seluruh timeline khusus UID Pengajuan (prefix OP-): Waktu Submit, Approved Manager, Approved Finance, dan Transferred.
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-slate-700 bg-white border border-slate-200 px-3 py-1 rounded-lg shadow-2xs">
            Total Terfilter: <strong className="text-indigo-600">{filteredRows.length} UID OP-</strong>
          </span>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          {/* Search */}
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Cari UID OP-, pemohon, status..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs font-medium"
            />
          </div>

          {/* Divisi */}
          <div>
            <select
              value={selectedDivisi}
              onChange={(e) => {
                setSelectedDivisi(e.target.value);
                setSelectedSubDivisi('ALL');
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
            >
              <option value="ALL">Semua Divisi</option>
              {availableDivisions.map((div) => (
                <option key={div} value={div}>
                  Divisi: {div}
                </option>
              ))}
            </select>
          </div>

          {/* Subdivisi */}
          <div>
            <select
              value={selectedSubDivisi}
              onChange={(e) => {
                setSelectedSubDivisi(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
            >
              <option value="ALL">Semua Subdivisi</option>
              {availableSubDivisions.map((sub) => (
                <option key={sub} value={sub}>
                  Sub: {sub}
                </option>
              ))}
            </select>
          </div>

          {/* Bulan */}
          <div>
            <select
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={idx} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {/* Tahun & Reset */}
          <div className="flex items-center gap-1.5">
            <select
              value={selectedYear}
              onChange={(e) => {
                setSelectedYear(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-2xs"
            >
              <option value="ALL">Semua Tahun</option>
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
            <button
              onClick={handleResetFilters}
              className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-xl transition-colors cursor-pointer shrink-0"
              title="Reset semua filter"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 pt-0.5 border-t border-slate-100">
          <span>
            Format Tanggal &amp; Waktu:{' '}
            <code className="text-slate-700 font-semibold font-mono bg-slate-100 px-2 py-0.5 rounded">
              DD/MM/YYYY hh:mm
            </code>
          </span>
          <span className="text-[11px] text-slate-400">
            Halaman {currentPage} dari {totalPages} ({filteredRows.length} UID)
          </span>
        </div>
      </div>

      {/* Table Content Area (Full Width Card with Horizontal Scroll) */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs min-w-[960px]">
            <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 select-none">
              <tr>
                <th className="py-3.5 px-4 w-14 text-center">No</th>
                <th className="py-3.5 px-4 min-w-[190px]">UID</th>
                <th className="py-3.5 px-4 min-w-[180px]">Submit (DD/MM/YYYY hh:mm)</th>
                <th className="py-3.5 px-4 min-w-[200px]">Approved Manager (DD/MM/YYYY hh:mm)</th>
                <th className="py-3.5 px-4 min-w-[200px]">Approved Finance (DD/MM/YYYY hh:mm)</th>
                <th className="py-3.5 px-4 min-w-[190px]">Transferred (DD/MM/YYYY hh:mm)</th>
                <th className="py-3.5 px-4 min-w-[160px] text-center">Status UID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400">
                    <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-semibold text-slate-600 text-sm">Tidak ada data pengajuan (OP-) yang cocok dengan filter.</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Silakan sesuaikan filter divisi, subdivisi, atau rentang bulan-tahun.</p>
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, idx) => {
                  const globalIdx = (currentPage - 1) * itemsPerPage + idx + 1;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* No */}
                      <td className="py-3.5 px-4 text-center font-mono text-slate-400 font-medium">
                        {globalIdx}
                      </td>

                      {/* UID */}
                      <td className="py-3.5 px-4">
                        <div className="font-mono font-bold text-slate-900 text-xs">
                          {row.id}
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5 truncate max-w-[220px]" title={`${row.pemohonNama} (${row.divisi}${row.subDivisi !== '-' ? ' - ' + row.subDivisi : ''})`}>
                          <User className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-700">{row.pemohonNama}</span>
                          <span className="text-slate-400">&bull;</span>
                          <span className="text-indigo-600 font-semibold">{row.divisi}</span>
                        </div>
                      </td>

                      {/* Submit (DD/MM/YYYY hh:mm) */}
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-800">
                        {row.diajukanFormatted !== '-' ? (
                          <span>{row.diajukanFormatted}</span>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">-</span>
                        )}
                      </td>

                      {/* Approved Manager (DD/MM/YYYY hh:mm) */}
                      <td className="py-3.5 px-4">
                        {row.approvedManagerFormatted !== '-' ? (
                          <div>
                            <div className="font-mono font-medium text-slate-800 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-indigo-600 shrink-0" />
                              <span>{row.approvedManagerFormatted}</span>
                            </div>
                            {row.approverManager && (
                              <div className="text-[10px] text-slate-400 font-sans truncate max-w-[190px]" title={row.approverManager}>
                                By: {row.approverManager}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">-</span>
                        )}
                      </td>

                      {/* Approved Finance (DD/MM/YYYY hh:mm) */}
                      <td className="py-3.5 px-4">
                        {row.approvedFinanceFormatted !== '-' ? (
                          <div>
                            <div className="font-mono font-medium text-slate-800 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-purple-600 shrink-0" />
                              <span>{row.approvedFinanceFormatted}</span>
                            </div>
                            {row.approverFinance && (
                              <div className="text-[10px] text-slate-400 font-sans truncate max-w-[190px]" title={row.approverFinance}>
                                By: {row.approverFinance}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">-</span>
                        )}
                      </td>

                      {/* Transferred (DD/MM/YYYY hh:mm) */}
                      <td className="py-3.5 px-4">
                        {row.transferFormatted !== '-' ? (
                          <div className="font-mono font-medium text-emerald-700 flex items-center gap-1">
                            <CreditCard className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>{row.transferFormatted}</span>
                          </div>
                        ) : (
                          <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-semibold border border-amber-200">
                            Belum Transfer
                          </span>
                        )}
                      </td>

                      {/* Status UID */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold font-mono border ${
                            row.transferDate || row.status === RequestStatus.TRANSFERRED || row.status === RequestStatus.CLOSED || row.status === RequestStatus.REPORTING
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : row.status === RequestStatus.CANCELLED || row.status === RequestStatus.REJECTED
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {row.statusLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer with Pagination and Bottom Back Button */}
        <div className="p-3.5 px-6 bg-slate-50 border-t border-slate-200 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold text-xs rounded-lg transition-all cursor-pointer shadow-2xs"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-slate-500" />
              <span>Kembali</span>
            </button>
            <div className="text-xs text-slate-500 font-medium">
              Menampilkan{' '}
              <strong className="text-slate-800">
                {filteredRows.length > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0}
              </strong>{' '}
              sampai{' '}
              <strong className="text-slate-800">
                {Math.min(currentPage * itemsPerPage, filteredRows.length)}
              </strong>{' '}
              dari <strong className="text-slate-800">{filteredRows.length}</strong> pengajuan OP-
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              Sebelumnya
            </button>
            <span className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg">
              Halaman {currentPage} dari {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              Selanjutnya
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // If used as full page view (like AdjustmentPanel in main)
  if (isFullPageView) {
    return content;
  }

  // Otherwise rendered as full screen overlay (no cramped popup box)
  return (
    <div className="fixed inset-0 z-50 bg-slate-100/95 overflow-y-auto p-3 sm:p-5 w-full h-full min-h-screen animate-fade-in flex flex-col items-center">
      <div className="w-full max-w-7xl">
        {content}
      </div>
    </div>
  );
};
