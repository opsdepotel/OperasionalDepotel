import React, { useState, useMemo } from 'react';
import { useBackHandler } from '../hooks/useBackHandler';
import { BudgetRequest, UsageReportItem, UserProfile, Role, ItemStatus, RequestStatus } from '../types';
import { FileText, Download, Filter, X, User, ArrowUpRight, Search, Clock, FileSpreadsheet } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';

interface FinancialReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  profiles: UserProfile[];
  role?: Role;
}

// Helper to convert image URL to Base64 Data URL for jsPDF
const loadImageAsDataUrl = (url: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const isPng = url.toLowerCase().endsWith('.png');
          resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg'));
          return;
        }
      } catch (e) {
        console.warn('Canvas toDataURL failed:', e);
      }
      resolve('');
    };
    img.onerror = () => resolve('');
    img.src = url;
  });
};

export const FinancialReportsModal: React.FC<FinancialReportsModalProps> = ({
  isOpen,
  onClose,
  requests,
  usageItems,
  profiles,
}) => {
  useBackHandler(isOpen, onClose, 'isFinancialReportsModalOpen');

  // Active Report Tab: 'TRANSFER', 'PENDING_TRANSFER', or 'SALDO'
  const [activeTab, setActiveTab] = useState<'TRANSFER' | 'PENDING_TRANSFER' | 'SALDO'>('TRANSFER');

  // Filters for Transfer Report
  const [transferStartDate, setTransferStartDate] = useState<string>('');
  const [transferEndDate, setTransferEndDate] = useState<string>('');
  const [transferDivisi, setTransferDivisi] = useState<string>('ALL');
  const [transferUserName, setTransferUserName] = useState<string>('');

  // Filters for Pending Transfer Report
  const [pendingStartDate, setPendingStartDate] = useState<string>('');
  const [pendingEndDate, setPendingEndDate] = useState<string>('');
  const [pendingDivisi, setPendingDivisi] = useState<string>('ALL');
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string>('');

  // Filters for Saldo Report
  const [saldoUser, setSaldoUser] = useState<string>('ALL');
  const [saldoDivisi, setSaldoDivisi] = useState<string>('ALL');
  const [saldoSearchQuery, setSaldoSearchQuery] = useState<string>('');
  // Status filter: UNBALANCED (default, sisa saldo != 0) or ALL
  const [saldoStatusFilter, setSaldoStatusFilter] = useState<'UNBALANCED' | 'ALL'>('UNBALANCED');

  // Format Currency
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val || 0);
  };

  // Helper to extract clean ISO date string (YYYY-MM-DD)
  const extractDate = (dateStr?: string): string => {
    if (!dateStr || !dateStr.trim()) return '';
    const raw = dateStr.trim();

    // 1. Check if it already starts with YYYY-MM-DD (e.g. "2026-08-03" or "2026-08-03T15:30:00")
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return raw.substring(0, 10);
    }

    // Extract the date part before comma or space if present
    const datePart = raw.split(',')[0].trim().split(' ')[0].trim();

    // 2. Check DD/MM/YYYY or D/M/YYYY (e.g. "03/08/2026")
    if (datePart.includes('/')) {
      const parts = datePart.split('/');
      if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (!isNaN(d) && !isNaN(m) && !isNaN(y) && y > 1900) {
          const paddedM = String(m).padStart(2, '0');
          const paddedD = String(d).padStart(2, '0');
          return `${y}-${paddedM}-${paddedD}`;
        }
      }
    }

    // 3. Check DD-MM-YYYY or YYYY-MM-DD
    if (datePart.includes('-')) {
      const parts = datePart.split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          return datePart.substring(0, 10);
        } else {
          const d = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const y = parseInt(parts[2], 10);
          if (!isNaN(d) && !isNaN(m) && !isNaN(y) && y > 1900) {
            const paddedM = String(m).padStart(2, '0');
            const paddedD = String(d).padStart(2, '0');
            return `${y}-${paddedM}-${paddedD}`;
          }
        }
      }
    }

    // 4. Try JS Date constructor
    try {
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch {
      // ignore
    }

    return '';
  };

  // Helper to extract transfer date for a request
  const getTransferRecordDate = (r: BudgetRequest): string => {
    return extractDate(r.adminActionTime) || extractDate(r.createdAt) || extractDate(r.timestamp) || extractDate(r.tanggalPemakaian);
  };

  // Helper for displaying date formatted DD/MM/YYYY
  const formatDateDisplay = (isoDateStr: string): string => {
    if (!isoDateStr) return '-';
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoDateStr)) {
      const [y, m, d] = isoDateStr.split('-');
      return `${d}/${m}/${y}`;
    }
    return isoDateStr;
  };

  // Unique profiles deduplicated by email
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

  // Unique list of divisions from user profiles
  const availableDivisions = Array.from(
    new Set(uniqueProfiles.map(p => p.divisi?.trim()).filter((d): d is string => !!d))
  ).sort();

  // Helper check for BBMDS requests
  const isBbmRequestAdmin = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
  const isBbmUsageItemAdmin = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

  // 1. FILTERED TRANSFER DATA
  const filteredTransfers = useMemo(() => {
    return requests.filter(r => {
      // Must be a transfer made by Finance (adminActionAmount > 0)
      const hasTransferAmount = (r.adminActionAmount || 0) > 0;
      if (!hasTransferAmount) return false;

      const userProf = uniqueProfiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
      const userDiv = userProf?.divisi?.trim() || '';

      // Nama (User) Text Filter
      if (transferUserName.trim()) {
        const q = transferUserName.toLowerCase().trim();
        const userName = (userProf?.nama || '').toLowerCase();
        const userId = (userProf?.userId || '').toLowerCase();
        const userEmail = (r.userEmail || '').toLowerCase();
        if (!userName.includes(q) && !userId.includes(q) && !userEmail.includes(q)) {
          return false;
        }
      }

      // Divisi Filter
      if (transferDivisi !== 'ALL' && userDiv.toLowerCase() !== transferDivisi.toLowerCase()) {
        return false;
      }

      // Date Range Filter
      const reqDate = getTransferRecordDate(r);
      if (transferStartDate && (!reqDate || reqDate < transferStartDate)) return false;
      if (transferEndDate && (!reqDate || reqDate > transferEndDate)) return false;

      return true;
    }).sort((a, b) => b.id.localeCompare(a.id));
  }, [requests, uniqueProfiles, transferUserName, transferDivisi, transferStartDate, transferEndDate]);

  const totalTransferAmount = useMemo(() => {
    return filteredTransfers.reduce((sum, r) => sum + (r.adminActionAmount || 0), 0);
  }, [filteredTransfers]);

  // Helper to calculate pending transfer amount for a request
  const getPendingTransferAmount = (r: BudgetRequest): number => {
    if (r.status === RequestStatus.PENDING_TALANGAN_TRANSFER) {
      const approvedUsageTotal = usageItems
        .filter(item => item.requestId === r.id && item.statusAdmin === ItemStatus.APPROVED)
        .reduce((sum, item) => sum + (item.nominal || 0), 0);
      return approvedUsageTotal > 0 ? approvedUsageTotal : (r.managerActionAmount || r.jumlahPengajuan || 0);
    }
    return r.managerActionAmount > 0 ? r.managerActionAmount : (r.jumlahPengajuan || 0);
  };

  // 2. FILTERED PENDING TRANSFER DATA (Menunggu Transfer)
  const filteredPendingTransfers = useMemo(() => {
    return requests.filter(r => {
      // Must be in a status that is waiting for transfer
      const isPendingTransfer =
        r.status === RequestStatus.APPROVED ||
        r.status === RequestStatus.PARTIALLY_APPROVED ||
        r.status === RequestStatus.PENDING_TALANGAN_TRANSFER;

      if (!isPendingTransfer) return false;

      const userProf = uniqueProfiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
      const userDiv = userProf?.divisi?.trim() || '';

      // Search Query Filter
      if (pendingSearchQuery.trim()) {
        const q = pendingSearchQuery.toLowerCase().trim();
        const userName = (userProf?.nama || '').toLowerCase();
        const userId = (userProf?.userId || '').toLowerCase();
        const userEmail = (r.userEmail || '').toLowerCase();
        const reqId = (r.id || '').toLowerCase();
        const site = (r.siteId || '').toLowerCase();
        const ket = (r.keterangan || '').toLowerCase();
        if (!userName.includes(q) && !userId.includes(q) && !userEmail.includes(q) && !reqId.includes(q) && !site.includes(q) && !ket.includes(q)) {
          return false;
        }
      }

      // Divisi Filter
      if (pendingDivisi !== 'ALL' && userDiv.toLowerCase() !== pendingDivisi.toLowerCase()) {
        return false;
      }

      // Date Range Filter
      const reqDate = getTransferRecordDate(r);
      if (pendingStartDate && (!reqDate || reqDate < pendingStartDate)) return false;
      if (pendingEndDate && (!reqDate || reqDate > pendingEndDate)) return false;

      return true;
    }).sort((a, b) => b.id.localeCompare(a.id));
  }, [requests, uniqueProfiles, pendingSearchQuery, pendingDivisi, pendingStartDate, pendingEndDate, usageItems]);

  const totalPendingTransferAmount = useMemo(() => {
    return filteredPendingTransfers.reduce((sum, r) => sum + getPendingTransferAmount(r), 0);
  }, [filteredPendingTransfers, usageItems]);

  // 2. FILTERED SALDO DATA
  const filteredSaldoUsers = useMemo(() => {
    return uniqueProfiles.filter(user => {
      if (saldoDivisi !== 'ALL' && (user.divisi?.trim() || '').toLowerCase() !== saldoDivisi.toLowerCase()) {
        return false;
      }

      if (saldoUser !== 'ALL' && user.email.toLowerCase() !== saldoUser.toLowerCase()) {
        return false;
      }

      if (saldoSearchQuery.trim()) {
        const q = saldoSearchQuery.toLowerCase();
        const matchName = (user.nama || '').toLowerCase().includes(q);
        const matchEmail = (user.email || '').toLowerCase().includes(q);
        const matchDiv = (user.divisi || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchDiv) return false;
      }

      return true;
    }).map(user => {
      const userReqs = requests.filter(r => r.userEmail.toLowerCase() === user.email.toLowerCase() && !isBbmRequestAdmin(r));
      const userReqIds = userReqs.map(r => r.id);
      const userUsage = usageItems.filter(item => userReqIds.includes(item.requestId) && !isBbmUsageItemAdmin(item));

      const totalTransferredVal = userReqs.reduce((sum, r) => sum + (r.adminActionAmount || 0), 0);
      const totalReportedApproved = userUsage
        .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
        .reduce((sum, item) => sum + (item.nominal || 0), 0);

      const balance = totalTransferredVal - totalReportedApproved;

      return {
        user,
        totalTransferred: totalTransferredVal,
        totalReportedApproved,
        balance,
        transferCount: userReqs.filter(r => (r.adminActionAmount || 0) > 0).length,
        reportCount: userUsage.length
      };
    }).filter(item => {
      // Filter for UNBALANCED balance (sisa saldo != 0)
      if (saldoStatusFilter === 'UNBALANCED') {
        return Math.abs(item.balance) >= 0.01;
      }
      return true;
    }).sort((a, b) => b.balance - a.balance); // Highest remaining balance first
  }, [profiles, requests, usageItems, saldoDivisi, saldoUser, saldoSearchQuery, saldoStatusFilter]);

  const totalSaldoCombined = useMemo(() => {
    return filteredSaldoUsers.reduce((sum, item) => sum + item.balance, 0);
  }, [filteredSaldoUsers]);

  const totalTransferredCombined = useMemo(() => {
    return filteredSaldoUsers.reduce((sum, item) => sum + item.totalTransferred, 0);
  }, [filteredSaldoUsers]);

  const totalUsageCombined = useMemo(() => {
    return filteredSaldoUsers.reduce((sum, item) => sum + item.totalReportedApproved, 0);
  }, [filteredSaldoUsers]);


  // PDF Export Generator Function
  const generatePDF = async () => {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const nowStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    // Load logos: DEPOTEL (top left) and DIOMS (top right)
    const [depotelLogo, diomsLogo] = await Promise.all([
      loadImageAsDataUrl('/DEPOTEL_rounded22.jpg'),
      loadImageAsDataUrl('/DIOMS-1.png')
    ]);

    // Draw Top Left DEPOTEL Logo
    if (depotelLogo) {
      doc.addImage(depotelLogo, 'JPEG', 14, 7, 24, 12);
    }

    // Draw Top Right DIOMS Logo
    if (diomsLogo) {
      doc.addImage(diomsLogo, 'PNG', 259, 7, 24, 12);
    }

    // Main Header Text (positioned next to DEPOTEL logo at x = 42)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(30, 41, 59);
    doc.text('PT. DEPORINDO TELEKOMUNIKASI', 42, 12);

    if (activeTab === 'TRANSFER') {
      doc.setFontSize(11);
      doc.setTextColor(79, 70, 229);
      doc.text('LAPORAN DAFTAR TRANSFER DANA FINANCE', 42, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      const periodeText = `Periode: ${transferStartDate || 'Semua'} s/d ${transferEndDate || 'Semua'} | User: ${transferUserName.trim() || 'Semua User'} | Divisi: ${transferDivisi === 'ALL' ? 'Semua Divisi' : transferDivisi}`;
      doc.text(periodeText, 42, 23);
      doc.text(`Dicetak Pada: ${nowStr}`, 255, 23, { align: 'right' });

      // Summary Box
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 27, 269, 12, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`Total Transaksi: ${filteredTransfers.length} Transfer`, 20, 34.5);
      doc.text(`Total Nominal Transfer: ${formatIDR(totalTransferAmount)}`, 190, 34.5);

      // Table Data
      const tableRows = filteredTransfers.map((r, idx) => {
        const userProf = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
        const userNama = userProf?.nama || r.userEmail;
        const divisi = userProf?.divisi || '-';
        const tgl = formatDateDisplay(getTransferRecordDate(r));

        return [
          idx + 1,
          r.id,
          tgl,
          `${userNama}\n(${r.userEmail})`,
          divisi,
          r.siteId || '-',
          r.keterangan || '-',
          formatIDR(r.adminActionAmount || 0),
          r.status,
          r.adminComment || '-'
        ];
      });

      autoTable(doc, {
        startY: 42,
        head: [['No', 'UID Pengajuan', 'Tanggal', 'Pemohon / User', 'Divisi', 'Site ID', 'Kebutuhan', 'Nominal Transfer', 'Status', 'Catatan Finance']],
        body: tableRows,
        theme: 'grid',
        headStyles: {
          fillColor: [49, 46, 129], // indigo-900
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
          halign: 'center'
        },
        bodyStyles: {
          fontSize: 8,
          textColor: [51, 65, 85]
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 10 },
          1: { cellWidth: 28, fontStyle: 'bold' },
          2: { halign: 'center', cellWidth: 22 },
          3: { cellWidth: 42 },
          4: { cellWidth: 25 },
          5: { cellWidth: 25 },
          6: { cellWidth: 45 },
          7: { halign: 'right', fontStyle: 'bold', cellWidth: 30 },
          8: { halign: 'center', cellWidth: 22 },
          9: { cellWidth: 20 }
        },
        foot: [[
          { content: 'TOTAL DANA DITRANSFER', colSpan: 7, styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } },
          { content: formatIDR(totalTransferAmount), styles: { halign: 'right', fontStyle: 'bold', textColor: [67, 56, 202], fillColor: [241, 245, 249] } },
          { content: '', colSpan: 2, styles: { fillColor: [241, 245, 249] } }
        ]],
        margin: { left: 14, right: 14 }
      });

      doc.save(`Laporan_Transfer_Finance_${new Date().toISOString().slice(0, 10)}.pdf`);

    } else if (activeTab === 'PENDING_TRANSFER') {
      doc.setFontSize(11);
      doc.setTextColor(180, 83, 9);
      doc.text('LAPORAN DAFTAR UID MENUNGGU TRANSFER FINANCE', 42, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      const periodeText = `Periode: ${pendingStartDate || 'Semua'} s/d ${pendingEndDate || 'Semua'} | Pencarian: ${pendingSearchQuery.trim() || 'Semua'} | Divisi: ${pendingDivisi === 'ALL' ? 'Semua Divisi' : pendingDivisi}`;
      doc.text(periodeText, 42, 23);
      doc.text(`Dicetak Pada: ${nowStr}`, 255, 23, { align: 'right' });

      // Summary Box
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(254, 243, 199);
      doc.roundedRect(14, 27, 269, 12, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(120, 53, 15);
      doc.text(`Total Pengajuan: ${filteredPendingTransfers.length} UID Menunggu Transfer`, 20, 34.5);
      doc.text(`Total Estimasi Nominal Transfer: ${formatIDR(totalPendingTransferAmount)}`, 160, 34.5);

      // Table Data
      const tableRows = filteredPendingTransfers.map((r, idx) => {
        const userProf = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
        const userNama = userProf?.nama || r.userEmail;
        const divisi = userProf?.divisi || '-';
        const tgl = formatDateDisplay(getTransferRecordDate(r));
        const approvedAmt = getPendingTransferAmount(r);
        const statusLabel = r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
          ? 'Transfer Talangan'
          : r.status === RequestStatus.PENDING_PENGAJUAN_TRANSFER
          ? 'Menunggu Transfer Anggaran'
          : r.status === RequestStatus.TRANSFER_BERTAHAP
          ? 'TRANSFER BERTAHAP'
          : r.status === RequestStatus.PARTIALLY_APPROVED
          ? 'Disetujui Sebagian'
          : 'Disetujui Manager';

        return [
          idx + 1,
          r.id,
          tgl,
          `${userNama}\n(${r.userEmail})`,
          divisi,
          r.siteId || '-',
          r.keterangan || '-',
          formatIDR(r.jumlahPengajuan || 0),
          formatIDR(approvedAmt),
          statusLabel
        ];
      });

      autoTable(doc, {
        startY: 42,
        head: [['No', 'UID Pengajuan', 'Tanggal', 'Pemohon / User', 'Divisi', 'Site ID', 'Kebutuhan', 'Pengajuan', 'Est. Transfer', 'Status']],
        body: tableRows,
        theme: 'grid',
        headStyles: {
          fillColor: [180, 83, 9], // amber-700
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
          halign: 'center'
        },
        bodyStyles: {
          fontSize: 8,
          textColor: [51, 65, 85]
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 10 },
          1: { cellWidth: 28, fontStyle: 'bold' },
          2: { halign: 'center', cellWidth: 22 },
          3: { cellWidth: 42 },
          4: { cellWidth: 25 },
          5: { cellWidth: 22 },
          6: { cellWidth: 42 },
          7: { halign: 'right', cellWidth: 26 },
          8: { halign: 'right', fontStyle: 'bold', cellWidth: 28 },
          9: { halign: 'center', cellWidth: 24 }
        },
        foot: [[
          { content: 'TOTAL MENUNGGU TRANSFER', colSpan: 8, styles: { halign: 'right', fontStyle: 'bold', fillColor: [254, 243, 199] } },
          { content: formatIDR(totalPendingTransferAmount), styles: { halign: 'right', fontStyle: 'bold', textColor: [180, 83, 9], fillColor: [254, 243, 199] } },
          { content: '', styles: { fillColor: [254, 243, 199] } }
        ]],
        margin: { left: 14, right: 14 }
      });

      doc.save(`Laporan_Menunggu_Transfer_Finance_${new Date().toISOString().slice(0, 10)}.pdf`);

    } else {
      // SALDO USER PDF
      doc.setFontSize(11);
      doc.setTextColor(79, 70, 229);
      doc.text('LAPORAN REKAPITULASI SALDO OPERASIONAL USER', 42, 18);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      const filterDesc = `Filter User: ${saldoUser === 'ALL' ? 'Semua User' : saldoUser} | Divisi: ${saldoDivisi === 'ALL' ? 'Semua Divisi' : saldoDivisi} | Status: ${saldoStatusFilter === 'UNBALANCED' ? 'Hanya Saldo Tidak Balance' : 'Semua User'}`;
      doc.text(filterDesc, 42, 23);
      doc.text(`Dicetak Pada: ${nowStr}`, 255, 23, { align: 'right' });

      // Summary Box
      doc.setDrawColor(226, 232, 240);
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, 27, 269, 12, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text(`Total User: ${filteredSaldoUsers.length} Personel`, 18, 34.5);
      doc.text(`Total Transfer Received: ${formatIDR(totalTransferredCombined)}`, 85, 34.5);
      doc.text(`Total Usage Approved: ${formatIDR(totalUsageCombined)}`, 165, 34.5);
      doc.text(`Total Sisa Saldo: ${formatIDR(totalSaldoCombined)}`, 230, 34.5);

      // Table Data
      const tableRows = filteredSaldoUsers.map((item, idx) => {
        const u = item.user;
        const statusStr = item.balance === 0 
          ? 'BALANCED (Rp 0)' 
          : item.balance > 0 
          ? `MEMEGANG SALDO (${formatIDR(item.balance)})` 
          : `SURPLUS/DEFISIT (${formatIDR(item.balance)})`;

        return [
          idx + 1,
          u.nama || u.userId || u.email,
          u.email,
          u.divisi || '-',
          u.managerEmail || '-',
          item.transferCount,
          formatIDR(item.totalTransferred),
          formatIDR(item.totalReportedApproved),
          formatIDR(item.balance),
          statusStr
        ];
      });

      autoTable(doc, {
        startY: 42,
        head: [['No', 'Nama User', 'Email User', 'Divisi', 'Manager', 'Transfer', 'Total Transfer', 'Usage Disetujui', 'Sisa Saldo', 'Status Balance']],
        body: tableRows,
        theme: 'grid',
        headStyles: {
          fillColor: [15, 23, 42], // slate-900
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
          halign: 'center'
        },
        bodyStyles: {
          fontSize: 8,
          textColor: [51, 65, 85]
        },
        columnStyles: {
          0: { halign: 'center', cellWidth: 10 },
          1: { cellWidth: 32, fontStyle: 'bold' },
          2: { cellWidth: 38 },
          3: { cellWidth: 25 },
          4: { cellWidth: 32 },
          5: { halign: 'center', cellWidth: 15 },
          6: { halign: 'right', cellWidth: 28 },
          7: { halign: 'right', cellWidth: 28 },
          8: { halign: 'right', fontStyle: 'bold', cellWidth: 30 },
          9: { halign: 'center', cellWidth: 31 }
        },
        foot: [[
          { content: 'TOTAL KESELURUHAN', colSpan: 6, styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } },
          { content: formatIDR(totalTransferredCombined), styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } },
          { content: formatIDR(totalUsageCombined), styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } },
          { content: formatIDR(totalSaldoCombined), styles: { halign: 'right', fontStyle: 'bold', textColor: [180, 83, 9], fillColor: [241, 245, 249] } },
          { content: '', styles: { fillColor: [241, 245, 249] } }
        ]],
        margin: { left: 14, right: 14 }
      });

      doc.save(`Laporan_Saldo_Operasional_User_${new Date().toISOString().slice(0, 10)}.pdf`);
    }
  };

  // Excel Export Generator Function (matching exact sample layout & metadata specifications)
  const generateExcel = async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const exportDateTimeStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const todayFilename = new Date().toISOString().slice(0, 10);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PT. DEPORINDO TELEKOMUNIKASI';
    workbook.created = new Date();

    if (activeTab === 'TRANSFER') {
      const sheet = workbook.addWorksheet('Laporan Transfer');

      // Title Block
      const row1 = sheet.addRow(['PT. DEPORINDO TELEKOMUNIKASI']);
      row1.getCell(1).font = { name: 'Calibri', size: 11, bold: true };

      const row2 = sheet.addRow(['LAPORAN TRANSFER']);
      row2.getCell(1).font = { name: 'Calibri', size: 11, bold: true };

      sheet.addRow([]); // Blank row 3

      // Metadata Block (Rows 4-7)
      const userText = transferUserName.trim() ? transferUserName.trim() : '';
      const tglMulaiText = transferStartDate ? formatDateDisplay(transferStartDate) : '';
      const tglSelesaiText = transferEndDate ? formatDateDisplay(transferEndDate) : '';
      const divisiText = transferDivisi !== 'ALL' ? transferDivisi : '';

      const metaUser = sheet.addRow(['User', userText]);
      const metaRange = sheet.addRow(['Rentang waktu', tglMulaiText, '', tglSelesaiText]);
      const metaDivisi = sheet.addRow(['Divisi', divisiText]);
      const metaDate = sheet.addRow(['Tanggal export :', exportDateTimeStr]);

      // Fill gray background for metadata block across columns 1..10
      [metaUser, metaRange, metaDivisi, metaDate].forEach(row => {
        for (let col = 1; col <= 10; col++) {
          const cell = row.getCell(col);
          cell.font = { name: 'Calibri', size: 10 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFEFEFEF' }
          };
        }
      });

      sheet.addRow([]); // Blank row 8

      // Table Header Row (Row 9)
      const headerRow = sheet.addRow([
        'No',
        'UID Pengajuan',
        'Tanggal Transfer',
        'Pemohon / User',
        'Email User',
        'Divisi',
        'Site ID',
        'Kebutuhan / Keterangan',
        'Nominal Transfer (Rp)',
        'Status'
      ]);

      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF0F2942' } // Dark Navy Blue matching image
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF0F2942' } },
          bottom: { style: 'thin', color: { argb: 'FF0F2942' } },
          left: { style: 'thin', color: { argb: 'FF0F2942' } },
          right: { style: 'thin', color: { argb: 'FF0F2942' } }
        };
      });

      // Data Rows
      filteredTransfers.forEach((r, idx) => {
        const userProf = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
        const userNama = userProf?.nama || r.userEmail;
        const divisi = userProf?.divisi || '-';
        const tgl = formatDateDisplay(getTransferRecordDate(r));

        const row = sheet.addRow([
          idx + 1,
          r.id,
          tgl,
          userNama,
          r.userEmail,
          divisi,
          r.siteId || '-',
          r.keterangan || '-',
          r.adminActionAmount || 0,
          r.status || 'CLOSED'
        ]);

        row.height = 20;

        // Alternating Sage Green background color matching sample image
        const isEven = idx % 2 === 0;
        const bgColor = isEven ? 'FFE2EFCB' : 'FFEEF4E3';

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: 'Calibri', size: 10 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgColor }
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBDDAF' } },
            bottom: { style: 'thin', color: { argb: 'FFCBDDAF' } },
            left: { style: 'thin', color: { argb: 'FFCBDDAF' } },
            right: { style: 'thin', color: { argb: 'FFCBDDAF' } }
          };

          if (colNumber === 1) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (colNumber === 3 || colNumber === 6 || colNumber === 10) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (colNumber === 9) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });
      });

      // Set explicit Column widths
      sheet.columns = [
        { width: 6 },  // No
        { width: 22 }, // UID
        { width: 18 }, // Tanggal
        { width: 26 }, // Pemohon
        { width: 32 }, // Email
        { width: 14 }, // Divisi
        { width: 20 }, // Site ID
        { width: 45 }, // Kebutuhan
        { width: 24 }, // Nominal Transfer
        { width: 14 }  // Status
      ];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Laporan_Transfer_Finance_${todayFilename}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);

    } else if (activeTab === 'PENDING_TRANSFER') {
      const sheet = workbook.addWorksheet('Menunggu Transfer');

      // Title Block
      const row1 = sheet.addRow(['PT. DEPORINDO TELEKOMUNIKASI']);
      row1.getCell(1).font = { name: 'Calibri', size: 11, bold: true };

      const row2 = sheet.addRow(['LAPORAN DAFTAR UID MENUNGGU TRANSFER']);
      row2.getCell(1).font = { name: 'Calibri', size: 11, bold: true };

      sheet.addRow([]);

      // Metadata Block
      const tglMulaiText = pendingStartDate ? formatDateDisplay(pendingStartDate) : '';
      const tglSelesaiText = pendingEndDate ? formatDateDisplay(pendingEndDate) : '';
      const divisiText = pendingDivisi !== 'ALL' ? pendingDivisi : '';
      const userSearchText = pendingSearchQuery.trim() ? pendingSearchQuery.trim() : '';

      const metaSearch = sheet.addRow(['User / Pencarian', userSearchText]);
      const metaRange = sheet.addRow(['Rentang waktu', tglMulaiText, '', tglSelesaiText]);
      const metaDivisi = sheet.addRow(['Divisi', divisiText]);
      const metaDate = sheet.addRow(['Tanggal export :', exportDateTimeStr]);

      [metaSearch, metaRange, metaDivisi, metaDate].forEach(row => {
        for (let col = 1; col <= 10; col++) {
          const cell = row.getCell(col);
          cell.font = { name: 'Calibri', size: 10 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFEFEFEF' }
          };
        }
      });

      sheet.addRow([]);

      // Table Header Row
      const headerRow = sheet.addRow([
        'No',
        'UID Pengajuan',
        'Tanggal Pengajuan',
        'Pemohon / User',
        'Email User',
        'Divisi',
        'Site ID',
        'Kebutuhan / Keterangan',
        'Nominal Pengajuan (Rp)',
        'Estimasi Transfer (Rp)',
        'Status Persetujuan'
      ]);

      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF78350F' } // Amber Brown/Navy
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF78350F' } },
          bottom: { style: 'thin', color: { argb: 'FF78350F' } },
          left: { style: 'thin', color: { argb: 'FF78350F' } },
          right: { style: 'thin', color: { argb: 'FF78350F' } }
        };
      });

      // Data Rows
      filteredPendingTransfers.forEach((r, idx) => {
        const userProf = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
        const userNama = userProf?.nama || r.userEmail;
        const divisi = userProf?.divisi || '-';
        const tgl = formatDateDisplay(getTransferRecordDate(r));
        const pendingAmt = getPendingTransferAmount(r);
        const statusLabel = r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
          ? 'Transfer Talangan'
          : r.status === RequestStatus.PENDING_PENGAJUAN_TRANSFER
          ? 'Menunggu Transfer Anggaran'
          : r.status === RequestStatus.TRANSFER_BERTAHAP
          ? 'TRANSFER BERTAHAP'
          : r.status === RequestStatus.PARTIALLY_APPROVED
          ? 'Disetujui Sebagian'
          : 'Disetujui Manager';

        const row = sheet.addRow([
          idx + 1,
          r.id,
          tgl,
          userNama,
          r.userEmail,
          divisi,
          r.siteId || '-',
          r.keterangan || '-',
          r.jumlahPengajuan || 0,
          pendingAmt,
          statusLabel
        ]);

        row.height = 20;

        const isEven = idx % 2 === 0;
        const bgColor = isEven ? 'FFFEF3C7' : 'FFFFFBEB';

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: 'Calibri', size: 10 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgColor }
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFFCD34D' } },
            bottom: { style: 'thin', color: { argb: 'FFFCD34D' } },
            left: { style: 'thin', color: { argb: 'FFFCD34D' } },
            right: { style: 'thin', color: { argb: 'FFFCD34D' } }
          };

          if (colNumber === 1) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (colNumber === 3 || colNumber === 6 || colNumber === 11) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (colNumber === 9 || colNumber === 10) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });
      });

      sheet.columns = [
        { width: 6 },  // No
        { width: 22 }, // UID
        { width: 18 }, // Tanggal
        { width: 26 }, // Pemohon
        { width: 32 }, // Email
        { width: 14 }, // Divisi
        { width: 20 }, // Site ID
        { width: 45 }, // Kebutuhan
        { width: 22 }, // Pengajuan
        { width: 24 }, // Estimasi Transfer
        { width: 20 }  // Status
      ];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Laporan_Menunggu_Transfer_Finance_${todayFilename}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);

    } else if (activeTab === 'SALDO') {
      const sheet = workbook.addWorksheet('Saldo Operasional');

      // Title Block
      const row1 = sheet.addRow(['PT. DEPORINDO TELEKOMUNIKASI']);
      row1.getCell(1).font = { name: 'Calibri', size: 11, bold: true };

      const row2 = sheet.addRow(['LAPORAN SALDO OPERASIONAL USER']);
      row2.getCell(1).font = { name: 'Calibri', size: 11, bold: true };

      sheet.addRow([]);

      // Metadata Block
      const divisiText = saldoDivisi !== 'ALL' ? saldoDivisi : '';
      const userText = saldoUser !== 'ALL' ? saldoUser : '';

      const metaUser = sheet.addRow(['User Filter', userText]);
      const metaDivisi = sheet.addRow(['Divisi Filter', divisiText]);
      const metaDate = sheet.addRow(['Tanggal export :', exportDateTimeStr]);

      [metaUser, metaDivisi, metaDate].forEach(row => {
        for (let col = 1; col <= 10; col++) {
          const cell = row.getCell(col);
          cell.font = { name: 'Calibri', size: 10 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFEFEFEF' }
          };
        }
      });

      sheet.addRow([]);

      // Table Header Row
      const headerRow = sheet.addRow([
        'No',
        'Nama Personel',
        'Email User',
        'Divisi',
        'Manager Email',
        'Jumlah Transfer (Kali)',
        'Total Transfer Received (Rp)',
        'Total Usage Disetujui (Rp)',
        'Sisa Saldo Operasional (Rp)',
        'Status Balance'
      ]);

      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF0F2942' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF0F2942' } },
          bottom: { style: 'thin', color: { argb: 'FF0F2942' } },
          left: { style: 'thin', color: { argb: 'FF0F2942' } },
          right: { style: 'thin', color: { argb: 'FF0F2942' } }
        };
      });

      // Data Rows
      filteredSaldoUsers.forEach((item, idx) => {
        const u = item.user;
        const isBalanced = Math.abs(item.balance) < 0.01;
        const hasPositiveBalance = item.balance > 0;
        const statusStr = isBalanced ? 'BALANCE (Rp 0)' : hasPositiveBalance ? 'MEMEGANG SALDO' : 'SURPLUS / DEFISIT';

        const row = sheet.addRow([
          idx + 1,
          u.nama || u.userId || u.email,
          u.email,
          u.divisi || '-',
          u.managerEmail || '-',
          item.transferCount,
          item.totalTransferred,
          item.totalReportedApproved,
          item.balance,
          statusStr
        ]);

        row.height = 20;

        const isEven = idx % 2 === 0;
        const bgColor = isEven ? 'FFE2EFCB' : 'FFEEF4E3';

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: 'Calibri', size: 10 };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgColor }
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBDDAF' } },
            bottom: { style: 'thin', color: { argb: 'FFCBDDAF' } },
            left: { style: 'thin', color: { argb: 'FFCBDDAF' } },
            right: { style: 'thin', color: { argb: 'FFCBDDAF' } }
          };

          if (colNumber === 1 || colNumber === 4 || colNumber === 6 || colNumber === 10) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else if (colNumber === 7 || colNumber === 8 || colNumber === 9) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });
      });

      sheet.columns = [
        { width: 6 },  // No
        { width: 28 }, // Nama
        { width: 32 }, // Email
        { width: 14 }, // Divisi
        { width: 32 }, // Manager
        { width: 20 }, // Count
        { width: 26 }, // Total Transfer
        { width: 26 }, // Total Usage
        { width: 26 }, // Sisa Saldo
        { width: 20 }  // Status
      ];

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Laporan_Saldo_Operasional_User_${todayFilename}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn overflow-y-auto">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-100 flex flex-col max-h-[92vh] overflow-hidden my-auto">
        {/* Header Modal */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[9px] font-bold tracking-widest text-indigo-300 uppercase bg-indigo-900/80 px-2 py-0.5 rounded border border-indigo-700/50">
                REKAPITULASI FINANSIAL
              </span>
              <h2 className="text-sm sm:text-base font-display font-bold mt-0.5 text-white">Daftar Laporan Keuangan</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selection Navigation */}
        <div className="bg-slate-100/80 p-2 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveTab('TRANSFER')}
              className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'TRANSFER'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>1. Transfer Finance</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('PENDING_TRANSFER')}
              className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'PENDING_TRANSFER'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>2. Menunggu Transfer ({filteredPendingTransfers.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('SALDO')}
              className={`flex-1 sm:flex-initial px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'SALDO'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>3. Saldo Operasional User</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={generateExcel}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer active:scale-95"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
              <span>Export Excel (.xlsx)</span>
            </button>
            <button
              type="button"
              onClick={generatePDF}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer active:scale-95"
            >
              <Download className="w-3.5 h-3.5 text-indigo-200" />
              <span>Cetak PDF Laporan</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* TAB 1: DAFTAR TRANSFER */}
          {activeTab === 'TRANSFER' && (
            <div className="space-y-4 animate-fadeIn">
              {/* Filter Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Filter className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">Filter Laporan Transfer</h3>
                  </div>
                  {(transferStartDate || transferEndDate || transferDivisi !== 'ALL' || transferUserName) && (
                    <button
                      onClick={() => {
                        setTransferStartDate('');
                        setTransferEndDate('');
                        setTransferDivisi('ALL');
                        setTransferUserName('');
                      }}
                      className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      Reset Filter
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Nama (User)</label>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Ketik nama / email user..."
                        value={transferUserName}
                        onChange={(e) => setTransferUserName(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tanggal Mulai</label>
                    <input
                      type="date"
                      value={transferStartDate}
                      onChange={(e) => setTransferStartDate(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tanggal Selesai</label>
                    <input
                      type="date"
                      value={transferEndDate}
                      onChange={(e) => setTransferEndDate(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Filter Divisi</label>
                    <select
                      value={transferDivisi}
                      onChange={(e) => setTransferDivisi(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                    >
                      <option value="ALL">Semua Divisi ({availableDivisions.length})</option>
                      {availableDivisions.map(div => (
                        <option key={div} value={div}>{div}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Summary Header */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block">Total Transaksi Transfer</span>
                    <span className="text-xl font-display font-bold text-indigo-900 mt-0.5 block">{filteredTransfers.length} Transaksi</span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                    #{filteredTransfers.length}
                  </div>
                </div>

                <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Total Nominal Transfer</span>
                    <span className="text-xl font-display font-bold text-emerald-900 mt-0.5 block">{formatIDR(totalTransferAmount)}</span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                    Rp
                  </div>
                </div>
              </div>

              {/* Table List */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-white uppercase text-[9px] font-bold tracking-wider">
                      <tr>
                        <th className="py-3 px-3 text-center w-10">No</th>
                        <th className="py-3 px-3">UID</th>
                        <th className="py-3 px-3">Tanggal</th>
                        <th className="py-3 px-3">Pemohon / User</th>
                        <th className="py-3 px-3">Divisi</th>
                        <th className="py-3 px-3">Site ID</th>
                        <th className="py-3 px-3">Kebutuhan</th>
                        <th className="py-3 px-3 text-right">Nominal Transfer</th>
                        <th className="py-3 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredTransfers.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-400 italic font-medium">
                            Tidak ada data transfer yang sesuai dengan kriteria filter ini.
                          </td>
                        </tr>
                      ) : (
                        filteredTransfers.map((r, idx) => {
                          const userProf = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
                          const tgl = formatDateDisplay(getTransferRecordDate(r));

                          return (
                            <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-2.5 px-3 text-center font-mono text-slate-400">{idx + 1}</td>
                              <td className="py-2.5 px-3 font-mono font-bold text-indigo-600">{r.id}</td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">{tgl}</td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-800">{userProf?.nama || userProf?.userId || r.userEmail}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{r.userEmail}</div>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-slate-100 text-slate-700">
                                  {userProf?.divisi || '-'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-700">{r.siteId || '-'}</td>
                              <td className="py-2.5 px-3 text-slate-700 max-w-[200px] truncate" title={r.keterangan}>
                                {r.keterangan}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold font-mono text-indigo-700">
                                {formatIDR(r.adminActionAmount || 0)}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <span className="px-2 py-0.5 text-[9px] font-bold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  {r.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DAFTAR MENUNGGU TRANSFER */}
          {activeTab === 'PENDING_TRANSFER' && (
            <div className="space-y-4 animate-fadeIn">
              {/* Filter Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Filter className="w-4 h-4 text-amber-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">Filter UID Menunggu Transfer</h3>
                  </div>
                  {(pendingStartDate || pendingEndDate || pendingDivisi !== 'ALL' || pendingSearchQuery) && (
                    <button
                      onClick={() => {
                        setPendingStartDate('');
                        setPendingEndDate('');
                        setPendingDivisi('ALL');
                        setPendingSearchQuery('');
                      }}
                      className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      Reset Filter
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cari UID / User / Site</label>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Ketik UID, nama, email..."
                        value={pendingSearchQuery}
                        onChange={(e) => setPendingSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tanggal Mulai</label>
                    <input
                      type="date"
                      value={pendingStartDate}
                      onChange={(e) => setPendingStartDate(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Tanggal Selesai</label>
                    <input
                      type="date"
                      value={pendingEndDate}
                      onChange={(e) => setPendingEndDate(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Filter Divisi</label>
                    <select
                      value={pendingDivisi}
                      onChange={(e) => setPendingDivisi(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-amber-500 font-semibold"
                    >
                      <option value="ALL">Semua Divisi ({availableDivisions.length})</option>
                      {availableDivisions.map(div => (
                        <option key={div} value={div}>{div}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Summary Header */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">Total UID Menunggu Transfer</span>
                    <span className="text-xl font-display font-bold text-amber-950 mt-0.5 block">{filteredPendingTransfers.length} Pengajuan</span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                    #{filteredPendingTransfers.length}
                  </div>
                </div>

                <div className="bg-orange-50/70 border border-orange-200/80 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-orange-800 uppercase tracking-wider block">Total Estimasi Nominal Transfer</span>
                    <span className="text-xl font-display font-bold text-orange-950 mt-0.5 block">{formatIDR(totalPendingTransferAmount)}</span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-800 flex items-center justify-center font-bold">
                    Rp
                  </div>
                </div>
              </div>

              {/* Table List */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-white uppercase text-[9px] font-bold tracking-wider">
                      <tr>
                        <th className="py-3 px-3 text-center w-10">No</th>
                        <th className="py-3 px-3">UID Pengajuan</th>
                        <th className="py-3 px-3">Tanggal</th>
                        <th className="py-3 px-3">Pemohon / User</th>
                        <th className="py-3 px-3">Divisi</th>
                        <th className="py-3 px-3">Site ID</th>
                        <th className="py-3 px-3">Kebutuhan</th>
                        <th className="py-3 px-3 text-right">Pengajuan</th>
                        <th className="py-3 px-3 text-right">Estimasi Transfer</th>
                        <th className="py-3 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredPendingTransfers.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-slate-400 italic font-medium">
                            Tidak ada pengajuan UID yang menunggu transfer saat ini.
                          </td>
                        </tr>
                      ) : (
                        filteredPendingTransfers.map((r, idx) => {
                          const userProf = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
                          const tgl = formatDateDisplay(getTransferRecordDate(r));
                          const pendingAmt = getPendingTransferAmount(r);

                          return (
                            <tr key={r.id} className="hover:bg-amber-50/30 transition-colors">
                              <td className="py-2.5 px-3 text-center font-mono text-slate-400">{idx + 1}</td>
                              <td className="py-2.5 px-3 font-mono font-bold text-amber-700">{r.id}</td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">{tgl}</td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-800">{userProf?.nama || userProf?.userId || r.userEmail}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{r.userEmail}</div>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-slate-100 text-slate-700">
                                  {userProf?.divisi || '-'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-700">{r.siteId || '-'}</td>
                              <td className="py-2.5 px-3 text-slate-700 max-w-[180px] truncate" title={r.keterangan}>
                                {r.keterangan}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                                {formatIDR(r.jumlahPengajuan || 0)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold font-mono text-amber-700">
                                {formatIDR(pendingAmt)}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {r.status === RequestStatus.PENDING_TALANGAN_TRANSFER ? (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded-md bg-purple-50 text-purple-700 border border-purple-200">
                                    Transfer Talangan
                                  </span>
                                ) : r.status === RequestStatus.PARTIALLY_APPROVED ? (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded-md bg-sky-50 text-sky-700 border border-sky-200">
                                    Disetujui Sebagian
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                                    Disetujui Manager
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: DAFTAR SALDO OPERASIONAL USER */}
          {activeTab === 'SALDO' && (
            <div className="space-y-4 animate-fadeIn">
              {/* Filter Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Filter className="w-4 h-4 text-indigo-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider">Filter Saldo Operasional User</h3>
                  </div>
                  {(saldoUser !== 'ALL' || saldoDivisi !== 'ALL' || saldoSearchQuery || saldoStatusFilter !== 'UNBALANCED') && (
                    <button
                      onClick={() => {
                        setSaldoUser('ALL');
                        setSaldoDivisi('ALL');
                        setSaldoSearchQuery('');
                        setSaldoStatusFilter('UNBALANCED');
                      }}
                      className="text-[10px] font-bold text-rose-600 hover:underline"
                    >
                      Reset Filter
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Cari Nama / Email</label>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Ketik kata kunci..."
                        value={saldoSearchQuery}
                        onChange={(e) => setSaldoSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Filter Status Saldo</label>
                    <select
                      value={saldoStatusFilter}
                      onChange={(e) => setSaldoStatusFilter(e.target.value as 'UNBALANCED' | 'ALL')}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-indigo-300 text-indigo-900 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
                    >
                      <option value="UNBALANCED">Hanya Tidak Balance (≠ Rp 0)</option>
                      <option value="ALL">Semua User (Termasuk Rp 0)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Pilih User</label>
                    <select
                      value={saldoUser}
                      onChange={(e) => setSaldoUser(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                    >
                      <option value="ALL">Semua User ({uniqueProfiles.length})</option>
                      {uniqueProfiles.map((p, idx) => (
                        <option key={`${p.email}_${p.userId || idx}`} value={p.email}>
                          {p.nama || p.userId || p.email} ({p.divisi || 'HQ'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Filter Divisi</label>
                    <select
                      value={saldoDivisi}
                      onChange={(e) => setSaldoDivisi(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                    >
                      <option value="ALL">Semua Divisi ({availableDivisions.length})</option>
                      {availableDivisions.map(div => (
                        <option key={div} value={div}>{div}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Summary Header Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Total Transfer Received</span>
                  <span className="text-lg font-display font-bold text-slate-800 mt-0.5 block">{formatIDR(totalTransferredCombined)}</span>
                </div>

                <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-3.5">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Total Usage Disetujui</span>
                  <span className="text-lg font-display font-bold text-emerald-900 mt-0.5 block">{formatIDR(totalUsageCombined)}</span>
                </div>

                <div className="bg-amber-50/60 border border-amber-100 rounded-2xl p-3.5">
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Total Sisa Saldo Operasional</span>
                  <span className="text-lg font-display font-bold text-amber-900 mt-0.5 block">{formatIDR(totalSaldoCombined)}</span>
                </div>
              </div>

              {/* Table List */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900 text-white uppercase text-[9px] font-bold tracking-wider">
                      <tr>
                        <th className="py-3 px-3 text-center w-10">No</th>
                        <th className="py-3 px-3">Nama Personel</th>
                        <th className="py-3 px-3">Divisi</th>
                        <th className="py-3 px-3 text-center">Transfer</th>
                        <th className="py-3 px-3 text-right">Total Transfer</th>
                        <th className="py-3 px-3 text-right">Total Usage Approved</th>
                        <th className="py-3 px-3 text-right">Sisa Saldo Operasional</th>
                        <th className="py-3 px-3 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredSaldoUsers.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-400 italic font-medium">
                            Tidak ada data saldo user yang sesuai dengan kriteria filter (semua ber-saldo Rp 0 / balanced).
                          </td>
                        </tr>
                      ) : (
                        filteredSaldoUsers.map((item, idx) => {
                          const u = item.user;
                          const isBalanced = Math.abs(item.balance) < 0.01;
                          const hasPositiveBalance = item.balance > 0;

                          return (
                            <tr key={`${u.email}_${u.userId || idx}`} className="hover:bg-slate-50/80 transition-colors">
                              <td className="py-2.5 px-3 text-center font-mono text-slate-400">{idx + 1}</td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-800">{u.nama || u.userId || u.email}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{u.email}</div>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-slate-100 text-slate-700">
                                  {u.divisi || '-'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center font-mono text-slate-600">{item.transferCount}x</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-700">
                                {formatIDR(item.totalTransferred)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-emerald-700 font-bold">
                                {formatIDR(item.totalReportedApproved)}
                              </td>
                              <td className={`py-2.5 px-3 text-right font-mono font-extrabold ${hasPositiveBalance ? 'text-blue-600' : item.balance < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                                {formatIDR(item.balance)}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {isBalanced ? (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    BALANCE (Rp 0)
                                  </span>
                                ) : hasPositiveBalance ? (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-blue-50 text-blue-700 border border-blue-200">
                                    LEBIH SALDO
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-rose-50 text-rose-700 border border-rose-200">
                                    SALDO KURANG
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <p className="text-[10px] text-slate-400 font-medium hidden sm:block">
            * Laporan dapat di-export secara langsung dalam format PDF resmi atau Excel (.xlsx) sesuai dengan filter data yang aktif.
          </p>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={generateExcel}
              className="sm:hidden px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={generatePDF}
              className="sm:hidden px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-indigo-200" />
              <span>PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
