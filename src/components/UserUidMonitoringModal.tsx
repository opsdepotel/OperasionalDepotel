import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  ShieldAlert, 
  FileText, 
  ArrowLeft,
  Users,
  Coins,
  Download
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BudgetRequest, UsageReportItem, UserProfile, Role, RequestStatus } from '../types';
import { useBackHandler } from '../hooks/useBackHandler';

export const isBbmRequest = (r: BudgetRequest): boolean => {
  const reqId = (r.id || '').toUpperCase();
  const siteId = (r.siteId || '').toUpperCase();
  const siteName = ((r as any).siteName || '').toUpperCase();
  const ket = (r.keterangan || '').toUpperCase();
  return (
    reqId.startsWith('BBMDS') ||
    reqId.startsWith('BBM_DURENSAWIT') ||
    reqId.startsWith('TFDS') ||
    siteId === 'OPT-DUREN SAWIT' ||
    siteId === 'BBM DUREN SAWIT' ||
    siteName.includes('DUREN SAWIT') ||
    ket.includes('DUREN SAWIT')
  );
};

/**
 * Returns list of requests for a user that:
 * - Already transferred (TRANSFERRED, TRANSFER_BERTAHAP, or adminActionAmount > 0)
 * - Not cancelled, not rejected, not closed, not BBM Duren Sawit
 * - NOT reported yet (0 items in usageItems)
 */
export function getUnreportedTransferredRequests(
  userEmail: string,
  requests: BudgetRequest[],
  usageItems: UsageReportItem[]
): BudgetRequest[] {
  const emailLower = (userEmail || '').trim().toLowerCase();
  if (!emailLower) return [];

  return requests.filter(r => {
    if ((r.userEmail || '').trim().toLowerCase() !== emailLower) return false;
    if (isBbmRequest(r)) return false;
    if (r.status === RequestStatus.CLOSED || r.status === RequestStatus.CANCELLED || r.status === RequestStatus.REJECTED) return false;

    const isTransferred = 
      r.status === RequestStatus.TRANSFERRED ||
      r.status === RequestStatus.TRANSFER_BERTAHAP ||
      (typeof r.adminActionAmount === 'number' && r.adminActionAmount > 0);

    if (!isTransferred) return false;

    const hasReportItem = usageItems.some(i => (i.requestId || '').trim().toUpperCase() === (r.id || '').trim().toUpperCase());
    return !hasReportItem;
  });
}

/**
 * Returns list of requests for a user that:
 * - Already reported (at least 1 item in usageItems)
 * - Not closed, not cancelled, not rejected, not BBM Duren Sawit
 */
export function getReportedUnclosedRequests(
  userEmail: string,
  requests: BudgetRequest[],
  usageItems: UsageReportItem[]
): BudgetRequest[] {
  const emailLower = (userEmail || '').trim().toLowerCase();
  if (!emailLower) return [];

  return requests.filter(r => {
    if ((r.userEmail || '').trim().toLowerCase() !== emailLower) return false;
    if (isBbmRequest(r)) return false;
    if (r.status === RequestStatus.CLOSED || r.status === RequestStatus.CANCELLED || r.status === RequestStatus.REJECTED) return false;

    const hasReportItem = usageItems.some(i => (i.requestId || '').trim().toUpperCase() === (r.id || '').trim().toUpperCase());
    return hasReportItem;
  });
}

/**
 * Validates whether a User Murni is blocked from submitting new requests.
 * Rule: If User Murni has > 1 UIDs that are already transferred and not reported at all (maksimal 1 UID), submission is blocked.
 */
export function checkUserMurniSubmissionStatus(
  userProfile: UserProfile | null | undefined,
  requests: BudgetRequest[],
  usageItems: UsageReportItem[]
): { isBlocked: boolean; count: number; unreportedUids: BudgetRequest[] } {
  if (!userProfile) return { isBlocked: false, count: 0, unreportedUids: [] };

  const role = (userProfile.role || '').toUpperCase();
  // Pembatasan secara ketat hanya berlaku bagi Role USER (User Murni)
  if (role !== Role.USER && role !== 'USER') {
    return { isBlocked: false, count: 0, unreportedUids: [] };
  }

  const unreportedUids = getUnreportedTransferredRequests(userProfile.email, requests, usageItems);
  const isBlocked = unreportedUids.length > 1;

  return {
    isBlocked,
    count: unreportedUids.length,
    unreportedUids
  };
}

interface UserUidMonitoringModalProps {
  isOpen?: boolean;
  onClose: () => void;
  profiles: UserProfile[];
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  currentRole?: Role;
  currentUserEmail?: string;
}

export const UserUidMonitoringModal: React.FC<UserUidMonitoringModalProps> = ({
  isOpen = true,
  onClose,
  profiles,
  requests,
  usageItems,
  currentRole,
  currentUserEmail
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'ALL' | 'BLOCKED' | 'NORMAL'>('ALL');
  const [subordinateOnly, setSubordinateOnly] = useState<boolean>(currentRole === Role.MANAGER);
  const [selectedDetailUserEmail, setSelectedDetailUserEmail] = useState<string | null>(null);

  useBackHandler(isOpen !== false, onClose, 'user_uid_monitoring_panel');
  useBackHandler(!!selectedDetailUserEmail, () => setSelectedDetailUserEmail(null), 'user_uid_monitoring_detail_modal');

  const formatIDR = (num: any) => {
    const val = Number(num) || 0;
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
  };

  const formatTransferDate = (req: BudgetRequest): string => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    const candidates = [
      (req as any).tanggalTransfer,
      req.adminActionTime,
      (req as any).transferDate,
      req.timestamp,
      req.createdAt,
      (req as any).tanggalPengajuan
    ];

    for (const raw of candidates) {
      if (!raw) continue;
      const s = String(raw).trim();
      if (!s || s === '-' || s === '0') continue;

      // DD/MM/YYYY or DD-MM-YYYY
      const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (m1) {
        const [, d, m, y] = m1;
        const mIdx = parseInt(m, 10) - 1;
        const monthName = months[mIdx] || m;
        return `${d.padStart(2, '0')}/${monthName}/${y}`;
      }

      // YYYY-MM-DD or YYYY/MM/DD
      const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (m2) {
        const [, y, m, d] = m2;
        const mIdx = parseInt(m, 10) - 1;
        const monthName = months[mIdx] || m;
        return `${d.padStart(2, '0')}/${monthName}/${y}`;
      }

      const parsed = new Date(s);
      if (!isNaN(parsed.getTime())) {
        const d = String(parsed.getDate()).padStart(2, '0');
        const mIdx = parsed.getMonth();
        const y = parsed.getFullYear();
        return `${d}/${months[mIdx] || (mIdx + 1)}/${y}`;
      }
    }

    // Fallback: extract date encoded in UID (e.g. OP-20261007-080839-5138 -> 07/Okt/2026)
    const idMatch = (req.id || '').match(/(\d{4})(\d{2})(\d{2})/);
    if (idMatch) {
      const [, y, m, d] = idMatch;
      const mIdx = parseInt(m, 10) - 1;
      if (mIdx >= 0 && mIdx < 12) {
        return `${d}/${months[mIdx]}/${y}`;
      }
    }

    return '-';
  };

  // 1. Filter unique profiles for USER Murni (Role.USER)
  const userMurniProfiles = useMemo(() => {
    const map = new Map<string, UserProfile>();
    profiles.forEach(p => {
      const r = (p.role || '').toUpperCase();
      if ((r === Role.USER || r === 'USER') && p.email) {
        const key = p.email.toLowerCase().trim();
        if (!map.has(key)) {
          map.set(key, p);
        }
      }
    });
    return Array.from(map.values());
  }, [profiles]);

  // 2. Compute UID stats per user
  const usersWithStats = useMemo(() => {
    return userMurniProfiles.map(p => {
      const emailLower = p.email.toLowerCase().trim();
      const unreported = getUnreportedTransferredRequests(emailLower, requests, usageItems);
      const reportedUnclosed = getReportedUnclosedRequests(emailLower, requests, usageItems);

      const managerProfile = profiles.find(
        m => m.email.toLowerCase().trim() === (p.managerEmail || '').toLowerCase().trim()
      );
      const managerName = managerProfile?.nama || (managerProfile as any)?.name || p.managerEmail || '-';

      const isBlocked = unreported.length > 1;

      return {
        profile: p,
        managerName,
        unreportedCount: unreported.length,
        unreportedList: unreported,
        reportedUnclosedCount: reportedUnclosed.length,
        reportedUnclosedList: reportedUnclosed,
        isBlocked
      };
    });
  }, [userMurniProfiles, requests, usageItems, profiles]);

  // 3. Overall Statistics
  const totalUserMurni = usersWithStats.length;
  const blockedUsersCount = usersWithStats.filter(u => u.isBlocked).length;
  const totalUnreportedUids = usersWithStats.reduce((sum, u) => sum + u.unreportedCount, 0);
  const totalReportedUnclosedUids = usersWithStats.reduce((sum, u) => sum + u.reportedUnclosedCount, 0);

  // 4. Filtering and search
  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return usersWithStats
      .filter(item => {
        if (subordinateOnly && currentUserEmail) {
          const userMgrEmail = (item.profile.managerEmail || '').toLowerCase().trim();
          if (userMgrEmail !== currentUserEmail.toLowerCase().trim()) return false;
        }

        if (filterTab === 'BLOCKED' && !item.isBlocked) return false;
        if (filterTab === 'NORMAL' && item.isBlocked) return false;

        if (!q) return true;
        const name = (item.profile.nama || (item.profile as any)?.name || '').toLowerCase();
        const email = item.profile.email.toLowerCase();
        const mgr = item.managerName.toLowerCase();
        const div = (item.profile.divisi || '').toLowerCase();

        return name.includes(q) || email.includes(q) || mgr.includes(q) || div.includes(q);
      })
      .sort((a, b) => {
        // Sort highest unreported count first
        if (b.unreportedCount !== a.unreportedCount) {
          return b.unreportedCount - a.unreportedCount;
        }
        return (a.profile.nama || a.profile.email).localeCompare(b.profile.nama || b.profile.email);
      });
  }, [usersWithStats, searchQuery, filterTab, subordinateOnly, currentUserEmail]);

  const selectedDetailUser = useMemo(() => {
    if (!selectedDetailUserEmail) return null;
    return usersWithStats.find(
      u => u.profile.email.toLowerCase().trim() === selectedDetailUserEmail.toLowerCase().trim()
    ) || null;
  }, [selectedDetailUserEmail, usersWithStats]);

  const [isExporting, setIsExporting] = useState(false);

  // Export PDF untuk Ringkasan Seluruh Data Monitoring UID User Murni
  const handleExportSummaryPDF = () => {
    setIsExporting(true);
    try {
      const doc = new jsPDF('landscape', 'mm', 'a4');
      const now = new Date();
      const nowStr = now.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });

      // Title & Header
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42); // slate-900
      doc.text('LAPORAN MONITORING UID USER MURNI', 14, 15);

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text('Pengawasan Status UID Ditransfer & Batas Toleransi Pelaporan Nota Pemakaian (Role USER)', 14, 20);
      doc.text(`Dicetak Pada: ${nowStr} | Oleh: ${currentRole || 'ADMIN'}`, 283, 20, { align: 'right' });

      // Summary Card Box
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 24, 269, 14, 2, 2, 'FD');

      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);

      // Stat 1: Total User Murni
      doc.text('Total User Murni', 20, 29);
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(`${totalUserMurni} User`, 20, 35);

      // Stat 2: User Dibatasi (> 1 UID)
      doc.setFontSize(8);
      doc.setTextColor(190, 18, 60);
      doc.text('User Dibatasi (> 1 UID)', 75, 29);
      doc.setFontSize(11);
      doc.text(`${blockedUsersCount} User`, 75, 35);

      // Stat 3: User Normal (<= 1 UID)
      doc.setFontSize(8);
      doc.setTextColor(4, 120, 87);
      doc.text('User Normal', 135, 29);
      doc.setFontSize(11);
      doc.text(`${totalUserMurni - blockedUsersCount} User`, 135, 35);

      // Stat 4: Total UID Belum Lapor
      doc.setFontSize(8);
      doc.setTextColor(180, 83, 9);
      doc.text('Total UID Belum Lapor', 185, 29);
      doc.setFontSize(11);
      doc.text(`${totalUnreportedUids} UID`, 185, 35);

      // Stat 5: UID Belum Closed
      doc.setFontSize(8);
      doc.setTextColor(67, 56, 202);
      doc.text('UID Belum Closed', 240, 29);
      doc.setFontSize(11);
      doc.text(`${totalReportedUnclosedUids} UID`, 240, 35);

      // Table Data
      let totalDanaBelumLaporSemua = 0;

      const tableRows = filteredUsers.map((item, index) => {
        const danaBelumLapor = item.unreportedList.reduce(
          (sum, r) => sum + (Number(r.adminActionAmount) || Number(r.jumlahPengajuan) || 0),
          0
        );
        totalDanaBelumLaporSemua += danaBelumLapor;

        const uidListStr = item.unreportedList.length > 0
          ? item.unreportedList.map(u => u.id).join(', ')
          : '-';

        const userDisplay = `${item.profile.nama || (item.profile as any)?.name || 'User'}\n${item.profile.email}`;
        const divisi = item.profile.divisi || '-';
        const statusLabel = item.isBlocked ? 'DIBATASI (> 1 UID)' : 'DAPAT MENGAJUKAN';

        return [
          index + 1,
          userDisplay,
          divisi,
          item.managerName || '-',
          `${item.unreportedCount} UID\n(${uidListStr})`,
          formatIDR(danaBelumLapor),
          `${item.reportedUnclosedCount} UID`,
          statusLabel
        ];
      });

      autoTable(doc, {
        startY: 42,
        head: [[
          'No',
          'Nama & Email User Murni',
          'Divisi',
          'Atasan (Manager)',
          'UID Belum Dilaporkan (0 Nota)',
          'Dana Belum Lapor (Rp)',
          'Belum Closed',
          'Status Pengajuan'
        ]],
        body: tableRows,
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
          halign: 'center',
          valign: 'middle'
        },
        bodyStyles: {
          fontSize: 7.5,
          textColor: [51, 65, 85],
          valign: 'middle'
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 10 },
          1: { cellWidth: 50, fontStyle: 'bold' },
          2: { cellWidth: 26 },
          3: { cellWidth: 34 },
          4: { cellWidth: 55, fontSize: 7 },
          5: { halign: 'right', fontStyle: 'bold', cellWidth: 32 },
          6: { halign: 'center', cellWidth: 26 },
          7: { halign: 'center', fontStyle: 'bold', cellWidth: 36 }
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 7) {
            if (data.cell.raw === 'DIBATASI (> 1 UID)') {
              data.cell.styles.textColor = [190, 18, 60];
              data.cell.styles.fillColor = [255, 241, 242];
            } else {
              data.cell.styles.textColor = [4, 120, 87];
              data.cell.styles.fillColor = [236, 253, 245];
            }
          }
        },
        foot: [[
          { content: 'TOTAL KESELURUHAN (DATA TERFILTER)', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } },
          { content: formatIDR(totalDanaBelumLaporSemua), styles: { halign: 'right', fontStyle: 'bold', textColor: [190, 18, 60], fillColor: [241, 245, 249] } },
          { content: `${totalReportedUnclosedUids} UID`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [241, 245, 249] } },
          { content: `${blockedUsersCount} Dibatasi`, styles: { halign: 'center', fontStyle: 'bold', textColor: [190, 18, 60], fillColor: [241, 245, 249] } }
        ]],
        margin: { left: 14, right: 14 },
        didDrawPage: (data) => {
          const pageCount = typeof (doc as any).getNumberOfPages === 'function' 
            ? (doc as any).getNumberOfPages() 
            : ((doc as any).internal?.getNumberOfPages ? (doc as any).internal.getNumberOfPages() : 1);
          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(148, 163, 184);
          doc.text(
            '* Aturan Sistem: User Murni (Role USER) maksimal memiliki 1 UID belum lapor (pada UID ke-2 otomatis diblokir dari membuat pengajuan baru).',
            14,
            202
          );
          doc.text(
            `Halaman ${data.pageNumber} dari ${pageCount}`,
            283,
            202,
            { align: 'right' }
          );
        }
      });

      const filterSuffix = filterTab !== 'ALL' ? `_${filterTab}` : '';
      doc.save(`Laporan_Monitoring_UID_User_Murni${filterSuffix}_${now.toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('Gagal membuat PDF Monitoring UID:', err);
      alert('Terjadi kesalahan saat mengekspor PDF. Silakan coba kembali.');
    } finally {
      setIsExporting(false);
    }
  };

  // Export PDF untuk Rincian Satu User Murni Tertentu
  const handleExportUserDetailPDF = (userItem: typeof usersWithStats[0]) => {
    try {
      const doc = new jsPDF('portrait', 'mm', 'a4');
      const now = new Date();
      const nowStr = now.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
      const userName = userItem.profile.nama || (userItem.profile as any)?.name || 'User';
      const userEmail = userItem.profile.email;

      // Title & Header
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text('RINCIAN UID AKTIF USER MURNI', 14, 15);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Pengawasan Status Pengajuan, Riwayat Transfer & Pelaporan Nota Pemakaian', 14, 20);
      doc.text(`Dicetak: ${nowStr}`, 196, 20, { align: 'right' });

      // User Profile Box
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 24, 182, 22, 2, 2, 'FD');

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`Nama: ${userName}`, 18, 30);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`Email: ${userEmail}`, 18, 35);
      doc.text(`Divisi: ${userItem.profile.divisi || '-'}`, 18, 40);

      doc.text(`Atasan (Manager): ${userItem.managerName}`, 105, 30);
      doc.text(`Status: ${userItem.isBlocked ? 'DIBATASI (> 1 UID BELUM LAPOR)' : 'DAPAT MENGAJUKAN'}`, 105, 35);
      const totalDanaUnreported = userItem.unreportedList.reduce(
        (sum, r) => sum + (Number(r.adminActionAmount) || Number(r.jumlahPengajuan) || 0),
        0
      );
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(190, 18, 60);
      doc.text(`Dana Belum Lapor: ${formatIDR(totalDanaUnreported)}`, 105, 40);

      let currentY = 51;

      // Section 1: UID Belum Dilaporkan (0 Nota)
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(190, 18, 60);
      doc.text(`1. UID Sudah Ditransfer Namun Belum Ada Laporan (${userItem.unreportedCount} UID)`, 14, currentY);

      const rowsUnreported = userItem.unreportedList.map((req, idx) => [
        idx + 1,
        req.id,
        formatTransferDate(req),
        `${(req as any).siteName || req.siteId || '-'}\n${req.keterangan || '-'}`,
        formatIDR(req.adminActionAmount || req.jumlahPengajuan || 0),
        'BELUM LAPOR (0 NOTA)'
      ]);

      if (rowsUnreported.length === 0) {
        currentY += 4;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 116, 139);
        doc.text('Tidak ada UID yang belum dilaporkan. Seluruh dana yang ditransfer sudah memiliki nota.', 14, currentY + 3);
        currentY += 12;
      } else {
        autoTable(doc, {
          startY: currentY + 3,
          head: [['No', 'UID Pengajuan', 'Tgl Transfer', 'Site & Keterangan', 'Nominal Ditransfer', 'Status']],
          body: rowsUnreported,
          theme: 'grid',
          headStyles: {
            fillColor: [190, 18, 60],
            textColor: [255, 255, 255],
            fontSize: 7.5,
            fontStyle: 'bold',
            halign: 'center'
          },
          bodyStyles: {
            fontSize: 7.5,
            textColor: [51, 65, 85]
          },
          columnStyles: {
            0: { halign: 'center', cellWidth: 8 },
            1: { cellWidth: 32, fontStyle: 'bold' },
            2: { halign: 'center', cellWidth: 22 },
            3: { cellWidth: 55 },
            4: { halign: 'right', fontStyle: 'bold', cellWidth: 30 },
            5: { halign: 'center', fontStyle: 'bold', cellWidth: 35, textColor: [190, 18, 60] }
          },
          margin: { left: 14, right: 14 }
        });
        currentY = (doc as any).lastAutoTable.finalY + 10;
      }

      // Section 2: UID Dilaporkan Belum Closed
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(67, 56, 202);
      doc.text(`2. UID Sudah Dilaporkan Namun Belum Closed (${userItem.reportedUnclosedCount} UID)`, 14, currentY);

      const rowsReported = userItem.reportedUnclosedList.map((req, idx) => [
        idx + 1,
        req.id,
        formatTransferDate(req),
        `${(req as any).siteName || req.siteId || '-'}\n${req.keterangan || '-'}`,
        formatIDR(req.adminActionAmount || req.jumlahPengajuan || 0),
        req.status
      ]);

      if (rowsReported.length === 0) {
        currentY += 4;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(100, 116, 139);
        doc.text('Tidak ada UID yang sedang dalam proses reviu laporan.', 14, currentY + 3);
      } else {
        autoTable(doc, {
          startY: currentY + 3,
          head: [['No', 'UID Pengajuan', 'Tgl Transfer', 'Site & Keterangan', 'Nominal', 'Status Reviu']],
          body: rowsReported,
          theme: 'grid',
          headStyles: {
            fillColor: [67, 56, 202],
            textColor: [255, 255, 255],
            fontSize: 7.5,
            fontStyle: 'bold',
            halign: 'center'
          },
          bodyStyles: {
            fontSize: 7.5,
            textColor: [51, 65, 85]
          },
          columnStyles: {
            0: { halign: 'center', cellWidth: 8 },
            1: { cellWidth: 32, fontStyle: 'bold' },
            2: { halign: 'center', cellWidth: 22 },
            3: { cellWidth: 55 },
            4: { halign: 'right', fontStyle: 'bold', cellWidth: 30 },
            5: { halign: 'center', fontStyle: 'bold', cellWidth: 35 }
          },
          margin: { left: 14, right: 14 },
          didDrawPage: (data) => {
            const pageCount = typeof (doc as any).getNumberOfPages === 'function' 
              ? (doc as any).getNumberOfPages() 
              : ((doc as any).internal?.getNumberOfPages ? (doc as any).internal.getNumberOfPages() : 1);
            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(148, 163, 184);
            doc.text(
              '* Sistem Pembatasan: Maksimal 1 UID belum dilaporkan (pada UID ke-2 pengajuan baru otomatis diblokir).',
              14,
              287
            );
            doc.text(
              `Halaman ${data.pageNumber} dari ${pageCount}`,
              196,
              287,
              { align: 'right' }
            );
          }
        });
      }

      const cleanEmail = userEmail.replace(/[^a-zA-Z0-9]/g, '_');
      doc.save(`Rincian_UID_${cleanEmail}_${now.toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('Gagal membuat PDF Rincian UID User:', err);
      alert('Terjadi kesalahan saat mengekspor PDF rincian user. Silakan coba kembali.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="space-y-4 w-full animate-fade-in">
      {/* Back to Dashboard Header (Non-Modal Form Header) */}
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-sm gap-2 flex-wrap">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-indigo-600 transition-all cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Dashboard</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportSummaryPDF}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer border border-emerald-500/30 active:scale-95 disabled:opacity-50"
            title="Export Rekap Monitoring UID ke PDF"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export PDF</span>
          </button>
          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2.5 py-1 rounded-full flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-indigo-600" />
            <span>Monitoring Mode</span>
          </span>
        </div>
      </div>

      <div 
        id="form-monitoring-uid-user-murni"
        className="bg-white w-full rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col"
      >
        {/* Header Form */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-indigo-950 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 border-b border-slate-800 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-xs flex items-center justify-center text-indigo-300 shrink-0 shadow-md">
              <ShieldAlert className="w-5 h-5 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold text-sm sm:text-base text-white tracking-wide truncate">
                  Monitoring UID User Murni
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/30 text-rose-200 border border-rose-400/40">
                  Batas &gt; 1 UID
                </span>
              </div>
              <p className="text-[11px] text-slate-300/90 truncate mt-0.5">
                Pengawasan status UID yang sudah ditransfer dan pelaporan nota pemakaian (Role USER)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              type="button"
              onClick={handleExportSummaryPDF}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-sm cursor-pointer shrink-0 border border-emerald-400/30 active:scale-95 disabled:opacity-50"
              title="Export Tabel Monitoring UID ke PDF"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export PDF</span>
              <span className="sm:hidden">PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0 border border-white/10"
              title="Kembali ke Dashboard"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Kembali</span>
            </button>
          </div>
        </div>

        {/* Overview Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 sm:p-3.5 bg-slate-50 border-b border-slate-200 shrink-0 text-left">
          <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200/90 shadow-2xs min-w-0 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block truncate">
              Total User Murni
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl font-black font-display text-slate-900">{totalUserMurni}</span>
              <span className="text-xs text-slate-400 font-medium">User</span>
            </div>
          </div>

          <div className="bg-rose-50/70 p-2.5 sm:p-3 rounded-xl border border-rose-200 shadow-2xs min-w-0 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block truncate">
              User Dibatasi
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl font-black font-display text-rose-700">{blockedUsersCount}</span>
              <span className="text-xs text-rose-500 font-medium truncate">User (&gt; 1 UID)</span>
            </div>
          </div>

          <div className="bg-amber-50/70 p-2.5 sm:p-3 rounded-xl border border-amber-200 shadow-2xs min-w-0 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block truncate">
              UID Belum Lapor
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl font-black font-display text-amber-900">{totalUnreportedUids}</span>
              <span className="text-xs text-amber-600 font-medium">UID</span>
            </div>
          </div>

          <div className="bg-indigo-50/70 p-2.5 sm:p-3 rounded-xl border border-indigo-200 shadow-2xs min-w-0 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block truncate">
              Belum Closed
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl font-black font-display text-indigo-900">{totalReportedUnclosedUids}</span>
              <span className="text-xs text-indigo-500 font-medium">UID</span>
            </div>
          </div>
        </div>

        {/* Filter Bar & Search */}
        <div className="p-3 sm:p-3.5 bg-white border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 shrink-0">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <button
              type="button"
              onClick={() => setFilterTab('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                filterTab === 'ALL'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Semua User ({totalUserMurni})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('BLOCKED')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                filterTab === 'BLOCKED'
                  ? 'bg-rose-600 text-white shadow-xs'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Dibatasi ({blockedUsersCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('NORMAL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                filterTab === 'NORMAL'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Normal ({totalUserMurni - blockedUsersCount})</span>
            </button>

            {currentRole === Role.MANAGER && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600 font-bold ml-2 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={subordinateOnly}
                  onChange={(e) => setSubordinateOnly(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Hanya Tim Saya</span>
              </label>
            )}
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-56 shrink-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama, email, atasan..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-y-auto">
          {filteredUsers.length === 0 ? (
            <div className="text-center py-16 px-4">
              <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">Tidak ada data User Murni</p>
              <p className="text-xs text-slate-400 mt-1">
                {searchQuery ? 'Tidak ada user yang cocok dengan kata kunci pencarian.' : 'Seluruh data user telah terfilter.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 text-slate-600 text-[11px] font-bold border-b border-slate-200 sticky top-0 z-10 backdrop-blur-xs">
                    <th className="py-3 px-3 text-center w-12">No</th>
                    <th className="py-3 px-4">Nama &amp; Email USER Murni</th>
                    <th className="py-3 px-4">Atasan (Manager)</th>
                    <th className="py-3 px-4 text-center">UID Belum Dilaporkan</th>
                    <th className="py-3 px-4 text-center">UID Dilaporkan Belum CLOSED</th>
                    <th className="py-3 px-4 text-center">Status Pengajuan</th>
                    <th className="py-3 px-3 text-center w-20">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {filteredUsers.map((item, index) => (
                    <tr 
                      key={item.profile.email}
                      onClick={() => setSelectedDetailUserEmail(item.profile.email)}
                      className={`hover:bg-slate-50/80 transition-colors cursor-pointer group select-none ${
                        item.isBlocked ? 'bg-rose-50/20' : ''
                      }`}
                      title="Klik baris untuk membuka Form Modal Rincian UID Aktif"
                    >
                      {/* No */}
                      <td className="py-3.5 px-3 text-center text-slate-400 font-mono text-xs font-semibold">
                        {index + 1}
                      </td>

                      {/* Nama & Email User Murni */}
                      <td className="py-3.5 px-4">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 leading-tight group-hover:text-indigo-600 transition-colors">
                            {item.profile.nama || (item.profile as any)?.name || item.profile.userId || 'User'}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
                            {item.profile.email}
                          </p>
                        </div>
                      </td>

                      {/* Atasan (Manager) */}
                      <td className="py-3.5 px-4 font-medium text-slate-700">
                        {item.managerName}
                      </td>

                      {/* UID Belum Dilaporkan (Transferred, 0 nota) */}
                      <td className="py-3.5 px-4 text-center">
                        <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono transition-all ${
                          item.unreportedCount > 0
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {item.unreportedCount} UID
                        </span>
                      </td>

                      {/* UID Dilaporkan Belum CLOSED */}
                      <td className="py-3.5 px-4 text-center">
                        <span className={`inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono transition-all ${
                          item.reportedUnclosedCount > 0
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {item.reportedUnclosedCount} UID
                        </span>
                      </td>

                      {/* Status Pengajuan */}
                      <td className="py-3.5 px-4 text-center">
                        {item.isBlocked ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                            <span>Dibatasi (&gt; 1 UID)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>Dapat Mengajukan</span>
                          </span>
                        )}
                      </td>

                      {/* Aksi / Rincian */}
                      <td className="py-3.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDetailUserEmail(item.profile.email);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 group-hover:bg-indigo-100 text-indigo-700 text-xs font-bold border border-indigo-200/80 transition-all cursor-pointer shadow-2xs active:scale-95"
                          title="Buka Form Modal Rincian UID Aktif"
                        >
                          <span>Lihat</span>
                          <span className="text-[10px]">&rarr;</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="p-3.5 bg-slate-50 border-t border-slate-200 text-center text-[11px] text-slate-500 shrink-0">
          * Aturan Pembatasan: User Murni (Role USER) yang memiliki &gt; 1 UID berstatus sudah ditransfer namun belum dilaporkan sama sekali, otomatis diblokir dari membuat Pengajuan Operasional maupun Dana Talangan.
        </div>
      </div>

      {/* Modal Form Rincian UID Aktif (dibuka saat baris user diklik) */}
      {selectedDetailUser && createPortal(
        <div 
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in"
          onClick={() => setSelectedDetailUserEmail(null)}
        >
          <div 
            className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-indigo-950 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 border-b border-slate-800 shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-xs flex items-center justify-center text-indigo-300 shrink-0 shadow-md">
                  <FileText className="w-5 h-5 text-indigo-300" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display font-bold text-sm sm:text-base text-white tracking-wide truncate">
                    Rincian UID Aktif User Murni
                  </h3>
                  <p className="text-[11px] text-slate-300/90 truncate mt-0.5">
                    {selectedDetailUser.profile.nama || (selectedDetailUser.profile as any)?.name || 'User'} ({selectedDetailUser.profile.email})
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => selectedDetailUser && handleExportUserDetailPDF(selectedDetailUser)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-sm cursor-pointer border border-emerald-400/30 active:scale-95"
                  title="Export Rincian UID User Ini ke PDF"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Export PDF</span>
                  <span className="sm:hidden">PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDetailUserEmail(null)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center justify-center transition-all cursor-pointer border border-white/10 shrink-0"
                  title="Tutup Modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              {/* User Profile Card */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/90 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">
                      {selectedDetailUser.profile.nama || (selectedDetailUser.profile as any)?.name || selectedDetailUser.profile.userId || 'User'}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                      USER Murni
                    </span>
                    {selectedDetailUser.isBlocked ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-rose-600" />
                        <span>Dibatasi (&gt; 1 UID)</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Dapat Mengajukan</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 font-mono mt-1">
                    {selectedDetailUser.profile.email}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    <span className="font-medium text-slate-500">Atasan (Manager):</span> <span className="font-semibold text-slate-800">{selectedDetailUser.managerName}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200">
                  <div className="text-center px-3.5 py-2 bg-white rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Total UID Aktif</span>
                    <span className="text-sm font-black font-mono text-slate-900">{selectedDetailUser.unreportedCount + selectedDetailUser.reportedUnclosedCount} UID</span>
                  </div>
                </div>
              </div>

              {/* Section 1: UID Belum Dilaporkan (Transferred, 0 nota) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                  <h4 className="text-xs font-bold text-rose-700 flex items-center gap-1.5 uppercase tracking-wide">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>UID Sudah Ditransfer &amp; Belum Dilaporkan Sama Sekali ({selectedDetailUser.unreportedCount} UID)</span>
                  </h4>
                </div>

                {selectedDetailUser.unreportedList.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500 italic">
                    Tidak ada UID yang belum dilaporkan. Status tertib dan aman.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {selectedDetailUser.unreportedList.map(req => (
                      <div key={req.id} className="p-3 rounded-xl border border-rose-200 bg-rose-50/40 text-left space-y-1.5 text-xs shadow-2xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-rose-900 bg-rose-100/90 px-2.5 py-0.5 rounded text-[11px] border border-rose-200">
                            {req.id}
                          </span>
                          <span className="font-mono font-black text-slate-900">
                            {formatIDR(req.adminActionAmount || req.jumlahPengajuan || 0)}
                          </span>
                        </div>
                        <p className="text-slate-800 font-semibold text-[11px] leading-relaxed">
                          {(req as any).siteName || req.siteId || 'Site'} • {req.keterangan || '-'}
                        </p>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-rose-200/60">
                          <span>Tanggal transfer : {formatTransferDate(req)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 2: UID Dilaporkan Belum CLOSED */}
              {selectedDetailUser.reportedUnclosedList.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                    <h4 className="text-xs font-bold text-indigo-700 flex items-center gap-1.5 uppercase tracking-wide">
                      <Coins className="w-4 h-4 text-indigo-600" />
                      <span>UID Sudah Dilaporkan Namun Belum CLOSED ({selectedDetailUser.reportedUnclosedCount} UID)</span>
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Dalam Proses Reviu
                    </span>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {selectedDetailUser.reportedUnclosedList.map(req => (
                      <div key={req.id} className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/30 text-left space-y-1.5 text-xs shadow-2xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-indigo-900 bg-indigo-100/80 px-2.5 py-0.5 rounded text-[11px] border border-indigo-200">
                            {req.id}
                          </span>
                          <span className="font-mono font-black text-slate-900">
                            {formatIDR(req.adminActionAmount || req.jumlahPengajuan || 0)}
                          </span>
                        </div>
                        <p className="text-slate-800 font-semibold text-[11px] leading-relaxed">
                          {(req as any).siteName || req.siteId || 'Site'} • {req.keterangan || '-'}
                        </p>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-indigo-200/60">
                          <span>Status: {req.status}</span>
                          <span className="text-indigo-700 font-bold bg-indigo-100 px-2 py-0.5 rounded">
                            Sedang Direviu
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <p className="text-[10px] text-slate-400 leading-tight">
                * User Murni dengan &gt; 1 UID belum dilaporkan otomatis dibatasi dari pengajuan baru.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => selectedDetailUser && handleExportUserDetailPDF(selectedDetailUser)}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-xs active:scale-95 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDetailUserEmail(null)}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-xs active:scale-95"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export const UserUidMonitoringPanel = UserUidMonitoringModal;
