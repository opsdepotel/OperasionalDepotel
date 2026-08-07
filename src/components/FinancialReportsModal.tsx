import React, { useState, useMemo } from 'react';
import { useBackHandler } from '../hooks/useBackHandler';
import { BudgetRequest, UsageReportItem, UserProfile, Role, ItemStatus } from '../types';
import { FileText, Download, Filter, X, User, ArrowUpRight, Search } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

  // Active Report Tab: 'TRANSFER' or 'SALDO'
  const [activeTab, setActiveTab] = useState<'TRANSFER' | 'SALDO'>('TRANSFER');

  // Filters for Transfer Report
  const [transferStartDate, setTransferStartDate] = useState<string>('');
  const [transferEndDate, setTransferEndDate] = useState<string>('');
  const [transferDivisi, setTransferDivisi] = useState<string>('ALL');
  const [transferUserName, setTransferUserName] = useState<string>('');

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
    return extractDate(r.createdAt) || extractDate(r.timestamp) || extractDate(r.tanggalPemakaian);
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-100 flex flex-col max-h-[92vh] overflow-hidden">
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
        <div className="bg-slate-100/80 p-2 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveTab('TRANSFER')}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'TRANSFER'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>1. Daftar Transfer Finance</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('SALDO')}
              className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'SALDO'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-200/70 border border-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>2. Daftar Saldo Operasional User</span>
            </button>
          </div>

          <button
            type="button"
            onClick={generatePDF}
            className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Cetak PDF Laporan</span>
          </button>
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

          {/* TAB 2: DAFTAR SALDO OPERASIONAL USER */}
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
                              <td className={`py-2.5 px-3 text-right font-mono font-extrabold ${hasPositiveBalance ? 'text-amber-600' : 'text-slate-800'}`}>
                                {formatIDR(item.balance)}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {isBalanced ? (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    BALANCE (Rp 0)
                                  </span>
                                ) : hasPositiveBalance ? (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-amber-50 text-amber-800 border border-amber-200">
                                    MEMEGANG SALDO
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 text-[9px] font-bold rounded bg-rose-50 text-rose-700 border border-rose-200">
                                    SURPLUS/DEFISIT
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
            * Laporan dapat di-export secara langsung dalam format PDF resmi (ber-logo DEPOTEL &amp; DIOMS) dengan menekan tombol &quot;Cetak PDF Laporan&quot;.
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
              onClick={generatePDF}
              className="sm:hidden px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Cetak PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
