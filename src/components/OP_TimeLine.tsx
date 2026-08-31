import React from 'react';
import { BudgetRequest, ItemReviewHistory, UsageReportItem, UserProfile, Role, RequestStatus } from '../types';
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

  const approvalInfo = getApprovalTimeInfo(request);
  const finInfo = getFinanceApprovalInfo(request);
  const submitTime = request.timestamp || request.createdAt || request.date || null;
  const submitAmount = request.jumlahPengajuan || request.nominal || 0;

  const hasSubmitTime = Boolean(submitTime && submitTime !== '-');
  const hasApprovalTime = Boolean(approvalInfo?.time && approvalInfo.time !== '-');
  const hasFinTime = Boolean(finInfo?.time && finInfo.time !== '-');
  const hasTransferTime = Boolean(request.adminActionTime && request.adminActionTime !== '-');

  const isDark = theme === 'dark';

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
            {hasSubmitTime ? submitTime : '-'}
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
            {hasApprovalTime ? approvalInfo.time : '-'}
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
            {hasFinTime ? finInfo.time : '-'}
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
            {hasTransferTime ? request.adminActionTime : '-'}
          </div>
        </div>
      </div>
    </div>
  );
};
