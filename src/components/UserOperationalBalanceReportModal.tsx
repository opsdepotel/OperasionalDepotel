import React from 'react';
import { FileSpreadsheet, X, Download } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BudgetRequest, UsageReportItem, UserProfile, ItemReviewHistory, Role, RequestStatus, ItemStatus } from '../types';
import { formatDivisiSubDivisi, parseNumericValue } from '../lib/googleApi';
import { useBackHandler } from '../hooks/useBackHandler';

interface UserOperationalBalanceReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: UserProfile | null;
  userEmail: string;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  histories?: ItemReviewHistory[];
  profiles?: UserProfile[];
  role?: Role;
  excludeTalangan?: boolean;
  onlyTalangan?: boolean;
}

export const UserOperationalBalanceReportModal: React.FC<UserOperationalBalanceReportModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  userEmail,
  requests,
  usageItems,
  histories = [],
  profiles = [],
  role = Role.USER,
  excludeTalangan = false,
  onlyTalangan = false,
}) => {
  useBackHandler(isOpen, onClose, 'user_operational_balance_report_modal');

  if (!isOpen) return null;

  // Format IDR
  const formatIDR = (num: any) => {
    const val = parseNumericValue(num);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
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

  const getStatusLabel = (status: RequestStatus, emailKey?: string) => {
    const requesterProfile = emailKey ? profiles.find(p => p.email.trim().toLowerCase() === emailKey.trim().toLowerCase()) : null;
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
      case RequestStatus.PENDING_PENGAJUAN_TRANSFER:
        return 'MENUNGGU TRANSFER ANGGARAN';
      case RequestStatus.TRANSFER_BERTAHAP:
        return 'TRANSFER BERTAHAP';
      default:
        return status;
    }
  };

  const renderStatusBadge = (status: RequestStatus, emailKey?: string) => {
    const requesterProfile = emailKey ? profiles.find(p => p.email.trim().toLowerCase() === emailKey.trim().toLowerCase()) : null;
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

  const isBbmReq = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit') || r.siteId === 'OPT-DUREN SAWIT';
  const isBbmItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit');

  const isTalanganReq = (r: BudgetRequest) => (r.id.startsWith('OPT-') || r.siteId?.startsWith('OPT-') || (r.keterangan || '').toUpperCase().includes('TALANGAN')) && !isBbmReq(r);

  const myUserReqs = requests.filter(r => 
    r.userEmail.toLowerCase() === userEmail.toLowerCase() && 
    r.status !== RequestStatus.CANCELLED && 
    !isBbmReq(r) &&
    (!excludeTalangan || !isTalanganReq(r)) &&
    (!onlyTalangan || isTalanganReq(r))
  ).sort((a, b) => {
    const timeA = getTransferTimestampMs(a);
    const timeB = getTransferTimestampMs(b);
    if (timeA !== timeB) return timeB - timeA;
    return b.id.localeCompare(a.id);
  });

  const handleExportPDF = () => {
    const doc = new jsPDF('landscape', 'mm', 'a4');
    const nowStr = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(onlyTalangan ? 'LAPORAN TRANSAKSI DANA TALANGAN (OPT-) USER' : 'LAPORAN TRANSAKSI SALDO OPERASIONAL USER', 14, 15);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`User: ${userProfile?.nama || userEmail} (${userEmail}) | Divisi: ${formatDivisiSubDivisi(userProfile?.divisi, userProfile?.subDivisi)}`, 14, 21);
    doc.text(`Dicetak Pada: ${nowStr}`, 283, 21, { align: 'right' });

    // Summary Box
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 25, 269, 12, 2, 2, 'FD');

    const totPengajuan = myUserReqs.reduce((sum, r) => sum + r.jumlahPengajuan, 0);
    const totTransfer = myUserReqs.reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totDilaporkan = myUserReqs.reduce((sum, r) => {
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

    const tableRows = myUserReqs.map((r, idx) => {
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
        getStatusLabel(r.status, r.userEmail)
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
        1: { halign: 'center', cellWidth: 22 },
        2: { cellWidth: 45 },
        3: { halign: 'right', cellWidth: 32 },
        4: { halign: 'right', cellWidth: 32 },
        5: { halign: 'right', cellWidth: 32 },
        6: { halign: 'right', cellWidth: 32 },
        7: { halign: 'center', cellWidth: 32 }
      }
    });

    const userCleanName = (userProfile?.nama || userEmail).replace(/[^a-zA-Z0-9]/g, '_');
    const pdfPrefix = onlyTalangan ? 'Laporan_Dana_Talangan_OPT' : 'Laporan_Saldo_Operasional';
    doc.save(`${pdfPrefix}_${userCleanName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const totPengajuan = myUserReqs.reduce((sum, r) => sum + r.jumlahPengajuan, 0);
  const totTransfer = myUserReqs.reduce((sum, r) => sum + r.adminActionAmount, 0);
  const totDilaporkan = myUserReqs.reduce((sum, r) => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white w-full max-w-[98vw] sm:max-w-[96vw] xl:max-w-[98vw] rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header Modal */}
        <div className={`p-4 sm:p-5 flex items-center justify-between shrink-0 border-b text-white ${
          onlyTalangan 
            ? 'bg-gradient-to-r from-slate-900 via-amber-950 to-slate-900 border-amber-900/50' 
            : 'bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 border-emerald-900/50'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-md border ${
              onlyTalangan ? 'bg-amber-600 border-amber-400/30' : 'bg-emerald-600 border-emerald-400/30'
            }`}>
              <FileSpreadsheet className={`w-5 h-5 ${onlyTalangan ? 'text-amber-100' : 'text-emerald-100'}`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-sm sm:text-base text-white tracking-wide truncate">
                {onlyTalangan ? 'Laporan Transaksi Khusus Dana Talangan (OPT-) User' : 'Laporan Transaksi Saldo Operasional User'}
              </h3>
              <p className={`text-[11px] font-medium mt-0.5 truncate ${onlyTalangan ? 'text-amber-200/80' : 'text-emerald-200/80'}`}>
                {userProfile?.nama || userEmail} • {formatDivisiSubDivisi(userProfile?.divisi, userProfile?.subDivisi)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-2xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0"
            title="Tutup Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content / Table */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          {myUserReqs.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <FileSpreadsheet className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
              <p className="text-xs font-semibold text-slate-500">
                Belum ada transaksi pengajuan / laporan untuk pengguna ini.
              </p>
            </div>
          ) : (
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
                  {myUserReqs.map((r, idx) => {
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
                          {renderStatusBadge(r.status, r.userEmail)}
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
          )}
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
              onClick={onClose}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer"
            >
              Tutup Laporan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
