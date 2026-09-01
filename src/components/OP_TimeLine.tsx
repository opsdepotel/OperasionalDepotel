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

  // Helper to extract approval time from supervisor (Manager / Direktur)
  const getApprovalTimeInfo = (req: BudgetRequest) => {
    const p = profiles.find(prof => prof.email.trim().toLowerCase() === (req.userEmail || '').trim().toLowerCase());
    const defaultSupervisor = (p?.role === Role.MANAGER || p?.role === Role.FINANCE) ? 'Direktur' : 'Manager';

    if (histories && histories.length > 0) {
      const approvalLog = histories.find(h =>
        (h.requestUid === req.id || h.itemUid === req.id) &&
        (h.actionType === 'APPROVAL_MANAGER' || h.actionType === 'APPROVAL_DIREKTUR' || h.actionType === 'REVISI_MANAGER' || h.actionType === 'REVISI_DIREKTUR')
      );
      if (approvalLog && approvalLog.timestamp) {
        const supervisor = (approvalLog.actionType === 'APPROVAL_DIREKTUR' || approvalLog.actionType === 'REVISI_DIREKTUR' || approvalLog.actorRole === Role.DIREKTUR) ? 'Direktur' : 'Manager';
        return {
          supervisor,
          time: approvalLog.timestamp
        };
      }
    }

    return {
      supervisor: defaultSupervisor,
      time: null
    };
  };

  // Helper to extract Finance approval info
  const getFinanceApprovalInfo = (req: BudgetRequest) => {
    let approvedAmount = getFinanceApprovedAmount(req, histories, usageItems);

    let approvalTime: string | null = null;
    if (histories && histories.length > 0) {
      const finLog = histories.find(h =>
        (h.requestUid === req.id || h.itemUid === req.id) &&
        (h.actionType === 'APPROVAL_FINANCE' || (h.actorRole || '').toString().toUpperCase() === 'FINANCE')
      );
      if (finLog && finLog.timestamp) {
        approvalTime = finLog.timestamp;
        if (!approvedAmount && finLog.nominal) approvedAmount = finLog.nominal;
      }
    }

    if (!approvedAmount && req.adminActionAmount > 0) {
      approvedAmount = req.adminActionAmount;
    }

    return {
      amount: approvedAmount,
      time: approvalTime
    };
  };

  // Helper to extract Manager Review Info for usage report items (Laporan)
  const getManagerReportReviewInfo = (req: BudgetRequest) => {
    const reqUsageItems = usageItems.filter(item => item.requestId === req.id);
    const totalItems = reqUsageItems.length;

    const itemIds = new Set(reqUsageItems.map(i => i.id));
    const reportHistories = histories.filter(h =>
      (h.requestUid && h.requestUid === req.id) || (h.itemUid && itemIds.has(h.itemUid))
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

    let latestTimestamp: string | null = null;
    const historyListToUse = mgrHistories.length > 0 ? mgrHistories : reportHistories;
    if (historyListToUse.length > 0) {
      let maxTime = 0;
      historyListToUse.forEach(h => {
        if (!h.timestamp) return;
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
          latestTimestamp = h.timestamp;
        }
      });
      if (!latestTimestamp && historyListToUse[historyListToUse.length - 1]?.timestamp) {
        latestTimestamp = historyListToUse[historyListToUse.length - 1].timestamp;
      }
    }

    return {
      totalItems,
      approvedCount,
      approvedNominal,
      latestTimestamp
    };
  };

  const approvalInfo = getApprovalTimeInfo(request);
  const finInfo = getFinanceApprovalInfo(request);
  const reportReviewInfo = getManagerReportReviewInfo(request);

  // Helper to extract Finance Review Info for usage report items (Laporan)
  const getFinanceReportReviewInfo = (req: BudgetRequest) => {
    const reqUsageItems = usageItems.filter(item => item.requestId === req.id);
    const totalItems = reqUsageItems.length;

    const itemIds = new Set(reqUsageItems.map(i => i.id));
    const reportHistories = histories.filter(h =>
      (h.requestUid && h.requestUid === req.id) || (h.itemUid && itemIds.has(h.itemUid))
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

    let latestTimestamp: string | null = null;
    const historyListToUse = finHistories.length > 0 ? finHistories : reportHistories.filter(h => h.itemUid);
    if (historyListToUse.length > 0) {
      let maxTime = 0;
      historyListToUse.forEach(h => {
        if (!h.timestamp) return;
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
          latestTimestamp = h.timestamp;
        }
      });
      if (!latestTimestamp && historyListToUse[historyListToUse.length - 1]?.timestamp) {
        latestTimestamp = historyListToUse[historyListToUse.length - 1].timestamp;
      }
    }

    if (!latestTimestamp && approvedCount > 0) {
      reqUsageItems.forEach(item => {
        if (approvedItemIds.has(item.id) && item.updatedAt) {
          latestTimestamp = item.updatedAt;
        }
      });
    }

    return {
      totalItems,
      approvedCount,
      approvedNominal,
      latestTimestamp
    };
  };

  const finReportReviewInfo = getFinanceReportReviewInfo(request);

  const submitTime = request.timestamp || request.createdAt || request.date || null;
  const submitAmount = request.jumlahPengajuan || request.nominal || 0;

  const hasSubmitTime = Boolean(submitTime && submitTime !== '-');
  const hasApprovalTime = Boolean(approvalInfo?.time && approvalInfo.time !== '-');
  const hasFinTime = Boolean(finInfo?.time && finInfo.time !== '-');
  const hasTransferTime = Boolean(request.adminActionTime && request.adminActionTime !== '-');
  const hasReportReviewTime = Boolean(reportReviewInfo.latestTimestamp && reportReviewInfo.latestTimestamp !== '-');
  const hasFinReportReviewTime = Boolean(finReportReviewInfo.latestTimestamp && finReportReviewInfo.latestTimestamp !== '-');

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
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReportReviewTime ? (isDark ? 'bg-sky-500 ring-4 ring-sky-950' : 'bg-sky-600 ring-4 ring-sky-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Review Manager ({reportReviewInfo.approvedCount}/{reportReviewInfo.totalItems})</span>
                {hasReportReviewTime && reportReviewInfo.approvedNominal > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>{formatIDR(reportReviewInfo.approvedNominal)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasReportReviewTime ? formatTimestamp(reportReviewInfo.latestTimestamp) : '-'}
              </div>
            </div>

            {/* Step 3: Review Finance */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasFinReportReviewTime ? (isDark ? 'bg-purple-500 ring-4 ring-purple-950' : 'bg-purple-600 ring-4 ring-purple-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Review Finance ({finReportReviewInfo.approvedCount}/{finReportReviewInfo.totalItems})</span>
                {hasFinReportReviewTime && finReportReviewInfo.approvedNominal > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>{formatIDR(finReportReviewInfo.approvedNominal)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasFinReportReviewTime ? formatTimestamp(finReportReviewInfo.latestTimestamp) : '-'}
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
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasApprovalTime ? (isDark ? 'bg-indigo-500 ring-4 ring-indigo-950' : 'bg-indigo-600 ring-4 ring-indigo-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Approved {approvalInfo?.supervisor || 'Manager'}</span>
                {hasApprovalTime && request.managerActionAmount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-indigo-400' : 'text-indigo-600'}`}>{formatIDR(request.managerActionAmount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasApprovalTime ? formatTimestamp(approvalInfo.time) : '-'}
              </div>
            </div>

            {/* Step 3: Approved Finance */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasFinTime ? (isDark ? 'bg-purple-500 ring-4 ring-purple-950' : 'bg-purple-600 ring-4 ring-purple-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Approved Finance</span>
                {hasFinTime && finInfo?.amount > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>{formatIDR(finInfo.amount)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasFinTime ? formatTimestamp(finInfo.time) : '-'}
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

            {/* Step 5: Review Manager (I/A) */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasReportReviewTime ? (isDark ? 'bg-sky-500 ring-4 ring-sky-950' : 'bg-sky-600 ring-4 ring-sky-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Review Manager ({reportReviewInfo.approvedCount}/{reportReviewInfo.totalItems})</span>
                {hasReportReviewTime && reportReviewInfo.approvedNominal > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>{formatIDR(reportReviewInfo.approvedNominal)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasReportReviewTime ? formatTimestamp(reportReviewInfo.latestTimestamp) : '-'}
              </div>
            </div>

            {/* Step 6: Review Finance (I/A) */}
            <div className="relative text-left">
              <div className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${hasFinReportReviewTime ? (isDark ? 'bg-emerald-500 ring-4 ring-emerald-950' : 'bg-emerald-600 ring-4 ring-emerald-50') : (isDark ? 'bg-slate-700' : 'bg-slate-300')}`} />
              <div className={`flex items-center justify-between text-[10px] font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                <span>Review Finance ({finReportReviewInfo.approvedCount}/{finReportReviewInfo.totalItems})</span>
                {hasFinReportReviewTime && finReportReviewInfo.approvedNominal > 0 && (
                  <span className={`font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{formatIDR(finReportReviewInfo.approvedNominal)}</span>
                )}
              </div>
              <div className="text-[9px] font-mono text-slate-400">
                {hasFinReportReviewTime ? formatTimestamp(finReportReviewInfo.latestTimestamp) : '-'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
