import React from 'react';
import { BudgetRequest, ItemReviewHistory, UsageReportItem, UserProfile, Role, RequestStatus, ItemStatus } from '../types';
import { getFinanceApprovedAmount } from '../App';

export interface OP_TimeLineProps {
  request: BudgetRequest;
  histories?: ItemReviewHistory[];
  usageItems?: UsageReportItem[];
  profiles?: UserProfile[];
  theme?: 'light' | 'dark';
  title?: string;
  className?: string;
}

export const OP_TimeLine: React.FC<OP_TimeLineProps> = ({
  request,
  histories = [],
  usageItems = [],
  profiles = [],
  theme = 'light',
  title = 'TIMELINE PROSES PENGAJUAN',
  className = ''
}) => {
  const formatIDR = (num: any) => {
    const val = Number(num) || 0;
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  };

  const formatTimestamp = (rawTime: any): string => {
    if (!rawTime || rawTime === '-') return '-';
    let d: Date | null = null;

    if (typeof rawTime === 'number') {
      d = new Date(rawTime);
    } else if (typeof rawTime === 'string') {
      const trimmed = rawTime.trim();
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        d = parsed;
      } else {
        // Parse Indonesian locale string: "DD/MM/YYYY, HH.mm.ss" or "DD/MM/YYYY HH:mm:ss"
        const cleanStr = trimmed.replace(',', '');
        const parts = cleanStr.split(/\s+/);
        if (parts.length >= 2) {
          const dateParts = parts[0].split('/');
          const timeParts = parts[1].replace(/\./g, ':').split(':');
          if (dateParts.length === 3 && timeParts.length >= 2) {
            const day = parseInt(dateParts[0], 10);
            const month = parseInt(dateParts[1], 10) - 1;
            const year = parseInt(dateParts[2], 10);
            const hours = parseInt(timeParts[0], 10) || 0;
            const minutes = parseInt(timeParts[1], 10) || 0;
            const seconds = parseInt(timeParts[2], 10) || 0;
            const customDate = new Date(year, month, day, hours, minutes, seconds);
            if (!isNaN(customDate.getTime())) {
              d = customDate;
            }
          }
        }
      }
    }

    if (!d || isNaN(d.getTime())) return String(rawTime);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  };

  // 1. Logika pencarian timestamp & info Approved Manager (Persetujuan Pengajuan Tahap 1)
  const getApprovedManagerTimestamp = (req: BudgetRequest) => {
    const p = profiles.find(prof => prof.email.trim().toLowerCase() === (req.userEmail || '').trim().toLowerCase());
    const defaultSupervisor = (p?.role === Role.MANAGER || p?.role === Role.FINANCE) ? 'Direktur' : 'Manager';

    let supervisor = defaultSupervisor;
    let time: string | null = null;

    if (histories && histories.length > 0) {
      // Log riwayat persetujuan pengajuan awal oleh Manager/Direktur (itemUid === requestUid)
      const approvalLog = histories.find(h =>
        (h.requestUid === req.id || h.itemUid === req.id) &&
        (h.itemUid === h.requestUid || h.itemUid === req.id) &&
        (h.actionType === 'APPROVAL_MANAGER' || h.actionType === 'APPROVAL_DIREKTUR' || h.actionType === 'REVISI_MANAGER' || h.actionType === 'REVISI_DIREKTUR')
      );
      if (approvalLog) {
        if (approvalLog.actionType === 'APPROVAL_DIREKTUR' || approvalLog.actionType === 'REVISI_DIREKTUR' || approvalLog.actorRole === Role.DIREKTUR) {
          supervisor = 'Direktur';
        } else {
          supervisor = 'Manager';
        }
        if (approvalLog.timestamp) {
          time = approvalLog.timestamp;
        }
      }
    }

    // Fallback timestamp persetujuan manager dari field BudgetRequest
    if (!time) {
      time = (req as any).managerApprovedAt || (req as any).managerReviewDate || (req as any).managerActionTime || null;
    }

    return { supervisor, time };
  };

  // 2. Logika pencarian timestamp & info Approved Finance (Persetujuan Pengajuan Tahap 2)
  const getApprovedFinanceTimestamp = (req: BudgetRequest) => {
    let approvedAmount = getFinanceApprovedAmount(req, histories, usageItems);
    let time: string | null = null;

    if (histories && histories.length > 0) {
      // Log Utama: Riwayat persetujuan pengajuan oleh Finance (actionType === 'APPROVAL_FINANCE' || 'REVISI_FINANCE', status === 'APPROVED'/'DISETUJUI', itemUid === requestUid)
      const finLog = histories.find(h =>
        (h.requestUid === req.id || h.itemUid === req.id) &&
        (h.itemUid === h.requestUid || h.itemUid === req.id) &&
        (h.actionType === 'APPROVAL_FINANCE' || h.actionType === 'REVISI_FINANCE') &&
        ((h.status || '').toString().toUpperCase() === 'APPROVED' || (h.status || '').toString().toUpperCase() === 'DISETUJUI')
      );
      if (finLog) {
        if (finLog.timestamp) {
          time = finLog.timestamp;
        }
        if (!approvedAmount && finLog.nominal) {
          approvedAmount = finLog.nominal;
        }
      }
    }

    // Fallback: Hanya mencari tanggal transfer terakhir UID terkait
    if (!time) {
      if (histories && histories.length > 0) {
        const transferLogs = histories.filter(h =>
          (h.requestUid === req.id || h.itemUid === req.id) &&
          ((h.status || '').toString().toUpperCase() === 'TRANSFERRED' ||
           (h.status || '').toString().toUpperCase() === 'TRANSFER_BERTAHAP' ||
           (h.actionType || '').toString().toUpperCase().includes('TRANSFER'))
        );
        if (transferLogs.length > 0) {
          const lastTransferLog = transferLogs[transferLogs.length - 1];
          if (lastTransferLog && lastTransferLog.timestamp) {
            time = lastTransferLog.timestamp;
          }
        }
      }

      if (!time && req.adminActionTime && req.adminActionTime !== '-') {
        time = req.adminActionTime;
      }
    }

    if (!approvedAmount && req.adminActionAmount > 0) {
      approvedAmount = req.adminActionAmount;
    }

    return { amount: approvedAmount, time };
  };

  // 3. Logika pencarian timestamp & info Review Manager (Pemeriksaan Laporan Penggunaan oleh Manager)
  const getReviewManagerTimestamp = (req: BudgetRequest) => {
    const reqUsageItems = usageItems.filter(item => item.requestId === req.id);
    const totalItems = reqUsageItems.length;

    // Jika belum ada item laporan penggunaan, kembalikan nilai kosong (time: null)
    if (totalItems === 0) {
      return {
        totalItems: 0,
        approvedCount: 0,
        approvedNominal: 0,
        time: null
      };
    }

    const itemIds = new Set(reqUsageItems.map(i => i.id));
    // KHUSUS log riwayat level item laporan penggunaan (BUKAN level pengajuan induk / h.itemUid !== req.id)
    const reportHistories = histories.filter(h =>
      h.itemUid && itemIds.has(h.itemUid) && h.itemUid !== req.id
    );

    const mgrHistories = reportHistories.filter(h => {
      const roleUpper = (h.actorRole || '').toString().toUpperCase();
      const actionUpper = (h.actionType || '').toString().toUpperCase();
      return (
        actionUpper.includes('MANAGER') ||
        actionUpper.includes('DIREKTUR') ||
        roleUpper === 'MANAGER' ||
        roleUpper === 'DIREKTUR'
      );
    });

    const approvedItemIds = new Set<string>();
    reqUsageItems.forEach(item => {
      const isApprovedInItem = item.statusManager === ItemStatus.APPROVED || (item.statusManager || '').toString().toUpperCase() === 'APPROVED';
      const isApprovedInHistory = reportHistories.some(h =>
        h.itemUid === item.id &&
        (h.actionType === 'APPROVAL_MANAGER' || h.actionType === 'APPROVAL_DIREKTUR' || ((h.status || '').toString().toUpperCase() === 'APPROVED' && ((h.actorRole || '').toString().toUpperCase() === 'MANAGER' || (h.actorRole || '').toString().toUpperCase() === 'DIREKTUR')))
      );
      if (isApprovedInItem || isApprovedInHistory) {
        approvedItemIds.add(item.id);
      }
    });

    const approvedCount = approvedItemIds.size;
    const approvedNominal = reqUsageItems.reduce((sum, item) => {
      if (approvedItemIds.has(item.id)) {
        return sum + (Number(item.nominal) || 0);
      }
      return sum;
    }, 0);

    // Jika belum ada item laporan yang disetujui Manager, waktu wajib null (-)
    if (approvedCount === 0) {
      return {
        totalItems,
        approvedCount: 0,
        approvedNominal: 0,
        time: null
      };
    }

    // Timestamp HANYA dicari dari table histories level item laporan (mgrHistories)
    let time: string | null = null;
    if (mgrHistories.length > 0) {
      let maxTime = 0;
      let latestEntry: (typeof mgrHistories)[0] | null = null;
      mgrHistories.forEach(h => {
        if (!h.timestamp || h.timestamp === '-') return;
        let timeMs = 0;
        const parsed = new Date(h.timestamp);
        if (!isNaN(parsed.getTime())) {
          timeMs = parsed.getTime();
        } else {
          const clean = h.timestamp.replace(',', '').trim();
          const parts = clean.split(/\s+/);
          if (parts.length >= 2) {
            const dateParts = parts[0].split('/');
            const timeParts = parts[1].replace(/\./g, ':').split(':');
            if (dateParts.length === 3 && timeParts.length >= 2) {
              const d = new Date(parseInt(dateParts[2], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[0], 10), parseInt(timeParts[0], 10), parseInt(timeParts[1], 10));
              if (!isNaN(d.getTime())) timeMs = d.getTime();
            }
          }
        }
        if (timeMs >= maxTime) {
          maxTime = timeMs;
          latestEntry = h;
        }
      });
      if (latestEntry && latestEntry.timestamp && latestEntry.timestamp !== '-') {
        time = latestEntry.timestamp;
      }
    }

    return {
      totalItems,
      approvedCount,
      approvedNominal,
      time
    };
  };

  // 4. Logika pencarian timestamp & info Review Finance (Pemeriksaan Laporan Penggunaan oleh Finance)
  const getReviewFinanceTimestamp = (req: BudgetRequest) => {
    const reqUsageItems = usageItems.filter(item => item.requestId === req.id);
    const totalItems = reqUsageItems.length;

    // Jika belum ada item laporan penggunaan, kembalikan nilai kosong (time: null)
    if (totalItems === 0) {
      return {
        totalItems: 0,
        approvedCount: 0,
        approvedNominal: 0,
        time: null
      };
    }

    const itemIds = new Set(reqUsageItems.map(i => i.id));
    // KHUSUS log riwayat level item laporan penggunaan (BUKAN level pengajuan induk / h.itemUid !== req.id)
    const reportHistories = histories.filter(h =>
      h.itemUid && itemIds.has(h.itemUid) && h.itemUid !== req.id
    );

    const finHistories = reportHistories.filter(h => {
      const roleUpper = (h.actorRole || '').toString().toUpperCase();
      const actionUpper = (h.actionType || '').toString().toUpperCase();
      return (
        actionUpper.includes('FINANCE') ||
        roleUpper === 'FINANCE'
      );
    });

    const approvedItemIds = new Set<string>();
    reqUsageItems.forEach(item => {
      const isApprovedInItem = item.statusAdmin === ItemStatus.APPROVED || (item.statusAdmin || '').toString().toUpperCase() === 'APPROVED';
      const isApprovedInHistory = reportHistories.some(h =>
        h.itemUid === item.id &&
        (h.actionType === 'APPROVAL_FINANCE' || ((h.status || '').toString().toUpperCase() === 'APPROVED' && (h.actorRole || '').toString().toUpperCase() === 'FINANCE'))
      );
      if (isApprovedInItem || isApprovedInHistory) {
        approvedItemIds.add(item.id);
      }
    });

    const approvedCount = approvedItemIds.size;
    const approvedNominal = reqUsageItems.reduce((sum, item) => {
      if (approvedItemIds.has(item.id)) {
        return sum + (Number(item.nominal) || 0);
      }
      return sum;
    }, 0);

    // Jika belum ada item laporan yang disetujui Finance, waktu wajib null (-)
    if (approvedCount === 0) {
      return {
        totalItems,
        approvedCount: 0,
        approvedNominal: 0,
        time: null
      };
    }

    // Timestamp HANYA dicari dari table histories level item laporan (finHistories)
    let time: string | null = null;
    if (finHistories.length > 0) {
      let maxTime = 0;
      let latestEntry: (typeof finHistories)[0] | null = null;
      finHistories.forEach(h => {
        if (!h.timestamp || h.timestamp === '-') return;
        let timeMs = 0;
        const parsed = new Date(h.timestamp);
        if (!isNaN(parsed.getTime())) {
          timeMs = parsed.getTime();
        } else {
          const clean = h.timestamp.replace(',', '').trim();
          const parts = clean.split(/\s+/);
          if (parts.length >= 2) {
            const dateParts = parts[0].split('/');
            const timeParts = parts[1].replace(/\./g, ':').split(':');
            if (dateParts.length === 3 && timeParts.length >= 2) {
              const d = new Date(parseInt(dateParts[2], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[0], 10), parseInt(timeParts[0], 10), parseInt(timeParts[1], 10));
              if (!isNaN(d.getTime())) timeMs = d.getTime();
            }
          }
        }
        if (timeMs >= maxTime) {
          maxTime = timeMs;
          latestEntry = h;
        }
      });
      if (latestEntry && latestEntry.timestamp && latestEntry.timestamp !== '-') {
        time = latestEntry.timestamp;
      }
    }

    return {
      totalItems,
      approvedCount,
      approvedNominal,
      time
    };
  };

  // Masing-masing fungsi dipanggil secara independen & terpisah:
  const approvedManagerInfo = getApprovedManagerTimestamp(request);
  const approvedFinanceInfo = getApprovedFinanceTimestamp(request);
  const reviewManagerInfo = getReviewManagerTimestamp(request);
  const reviewFinanceInfo = getReviewFinanceTimestamp(request);

  const submitTime = request.timestamp || request.createdAt || request.date || null;
  const submitAmount = request.jumlahPengajuan || request.nominal || 0;

  const hasSubmitTime = Boolean(submitTime && submitTime !== '-');
  const hasApprovedManagerTime = Boolean(approvedManagerInfo?.time && approvedManagerInfo.time !== '-');
  const hasApprovedFinanceTime = Boolean(approvedFinanceInfo?.time && approvedFinanceInfo.time !== '-');
  const hasReviewManagerTime = Boolean(reviewManagerInfo?.time && reviewManagerInfo.time !== '-');
  const hasReviewFinanceTime = Boolean(reviewFinanceInfo?.time && reviewFinanceInfo.time !== '-');
  const hasTransferTime = Boolean(request.adminActionTime && request.adminActionTime !== '-');

  const isDark = theme === 'dark';

  const isTalangan = request.id.startsWith('OPT-') || request.id.startsWith('BBMDS') || request.id.startsWith('BBM_DurenSawit') || request.tipePengajuan === 'DANA_TALANGAN';

  return (
    <div className={`${isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-slate-50/90 border-slate-200/90'} border rounded-xl p-3 my-1 text-left space-y-2.5 transition-all ${className}`}>
      {title && (
        <div className={`border-b pb-1.5 ${isDark ? 'border-slate-800' : 'border-slate-200/60'}`}>
          <span className={`text-[9px] font-bold uppercase tracking-wider block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {title}
          </span>
        </div>
      )}

      <div className={`relative pl-4 space-y-3.5 border-l-2 ml-1.5 my-1 ${isDark ? 'border-indigo-500/40' : 'border-indigo-200/80'}`}>
        {isTalangan ? (
          <>
            {/* Step 1: User SUBMIT */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 ring-4 ${isDark ? 'ring-blue-950' : 'ring-blue-50'}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>User SUBMIT</span>
                {hasSubmitTime && submitAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{formatIDR(submitAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasSubmitTime ? formatTimestamp(submitTime) : '-'}
              </div>
            </div>

            {/* Step 2: Review Manager */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReviewManagerTime ? (isDark ? 'bg-sky-500 ring-4 ring-sky-950' : 'bg-sky-600 ring-4 ring-sky-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Review Manager ({reviewManagerInfo.approvedCount}/{reviewManagerInfo.totalItems})</span>
                {hasReviewManagerTime && reviewManagerInfo.approvedNominal > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>{formatIDR(reviewManagerInfo.approvedNominal)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasReviewManagerTime ? formatTimestamp(reviewManagerInfo.time) : '-'}
              </div>
            </div>

            {/* Step 3: Review Finance */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReviewFinanceTime ? (isDark ? 'bg-purple-500 ring-4 ring-purple-950' : 'bg-purple-600 ring-4 ring-purple-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Review Finance ({reviewFinanceInfo.approvedCount}/{reviewFinanceInfo.totalItems})</span>
                {hasReviewFinanceTime && reviewFinanceInfo.approvedNominal > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>{formatIDR(reviewFinanceInfo.approvedNominal)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasReviewFinanceTime ? formatTimestamp(reviewFinanceInfo.time) : '-'}
              </div>
            </div>

            {/* Step 4: Transferred */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasTransferTime ? (isDark ? 'bg-emerald-500 ring-4 ring-emerald-950' : 'bg-emerald-600 ring-4 ring-emerald-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Transferred</span>
                {hasTransferTime && request.adminActionAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatIDR(request.adminActionAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasTransferTime ? formatTimestamp(request.adminActionTime) : '-'}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Step 1: User Submit */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 ring-4 ${isDark ? 'ring-blue-950' : 'ring-blue-50'}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>User Submit</span>
                {hasSubmitTime && submitAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>{formatIDR(submitAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasSubmitTime ? formatTimestamp(submitTime) : '-'}
              </div>
            </div>

            {/* Step 2: Approved Manager / Direktur */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasApprovedManagerTime ? (isDark ? 'bg-indigo-500 ring-4 ring-indigo-950' : 'bg-indigo-600 ring-4 ring-indigo-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Approved {approvedManagerInfo?.supervisor || 'Manager'}</span>
                {hasApprovedManagerTime && request.managerActionAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{formatIDR(request.managerActionAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasApprovedManagerTime ? formatTimestamp(approvedManagerInfo.time) : '-'}
              </div>
            </div>

            {/* Step 3: Approved Finance */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasApprovedFinanceTime ? (isDark ? 'bg-purple-500 ring-4 ring-purple-950' : 'bg-purple-600 ring-4 ring-purple-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Approved Finance</span>
                {hasApprovedFinanceTime && approvedFinanceInfo?.amount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>{formatIDR(approvedFinanceInfo.amount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasApprovedFinanceTime ? formatTimestamp(approvedFinanceInfo.time) : '-'}
              </div>
            </div>

            {/* Step 4: Transferred */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasTransferTime ? (isDark ? 'bg-emerald-500 ring-4 ring-emerald-950' : 'bg-emerald-600 ring-4 ring-emerald-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Transferred</span>
                {hasTransferTime && request.adminActionAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatIDR(request.adminActionAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasTransferTime ? formatTimestamp(request.adminActionTime) : '-'}
              </div>
            </div>

            {/* Step 5: Review Manager (Laporan Penggunaan) */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReviewManagerTime ? (isDark ? 'bg-sky-500 ring-4 ring-sky-950' : 'bg-sky-600 ring-4 ring-sky-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Review Manager ({reviewManagerInfo.approvedCount}/{reviewManagerInfo.totalItems})</span>
                {hasReviewManagerTime && reviewManagerInfo.approvedNominal > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>{formatIDR(reviewManagerInfo.approvedNominal)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasReviewManagerTime ? formatTimestamp(reviewManagerInfo.time) : '-'}
              </div>
            </div>

            {/* Step 6: Review Finance (Laporan Penggunaan) */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReviewFinanceTime ? (isDark ? 'bg-emerald-500 ring-4 ring-emerald-950' : 'bg-emerald-600 ring-4 ring-emerald-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Review Finance ({reviewFinanceInfo.approvedCount}/{reviewFinanceInfo.totalItems})</span>
                {hasReviewFinanceTime && reviewFinanceInfo.approvedNominal > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatIDR(reviewFinanceInfo.approvedNominal)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasReviewFinanceTime ? formatTimestamp(reviewFinanceInfo.time) : '-'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
