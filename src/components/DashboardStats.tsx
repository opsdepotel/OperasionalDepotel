/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Role, BudgetRequest, UsageReportItem, RequestStatus, ItemStatus } from '../types';
import { Clock, CheckCircle2, AlertCircle, Coins, CreditCard, ClipboardCheck, ArrowRightLeft, ShieldCheck } from 'lucide-react';

interface DashboardStatsProps {
  role: Role;
  email: string;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  activeFilter?: string;
  onSelectFilter?: (filterKey: string) => void;
  onManageUsers?: () => void;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  role,
  email,
  requests,
  usageItems,
  activeFilter = 'ALL',
  onSelectFilter,
  onManageUsers
}) => {
  // Format Currency
  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(num);
  };

  const handleCardClick = (key: string) => {
    if (onSelectFilter) {
      onSelectFilter(activeFilter === key ? 'ALL' : key);
    }
  };

  // Compute stats based on roles
  if (role === Role.USER) {
    const myReqs = requests.filter(r => r.userEmail.toLowerCase() === email.toLowerCase());
    const myReqIds = myReqs.map(r => r.id);
    const myUsage = usageItems.filter(item => myReqIds.includes(item.requestId));

    const totalRequested = myReqs.reduce((sum, r) => sum + r.jumlahPengajuan, 0);
    const totalTransferred = myReqs.reduce((sum, r) => sum + r.adminActionAmount, 0);

    // Saldo Operasional: jumlah semua uang yang ditransfer dikurangi jumlah uang yang telah dilaporkan itemnya dan UID telah dalam posisi Closed
    const closedReqIds = myReqs.filter(r => r.status === RequestStatus.CLOSED).map(r => r.id);
    const totalReportedClosed = myUsage.filter(item => closedReqIds.includes(item.requestId)).reduce((sum, item) => sum + item.nominal, 0);
    const saldoOperasional = totalTransferred - totalReportedClosed;

    // Active tasks for User:
    // 1. Rejected requests (need adjustment/resubmit - or just awareness)
    // 2. Transferred requests that need usage report filling (status is TRANSFERRED or REPORTING)
    // 3. Reports with some rejected items that need correction (status is REPORTING and there are rejected usage items)
    const taskReportNeeded = myReqs.filter(r => r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.REPORTING).length;
    const taskCorrections = myReqs.filter(r => r.status === RequestStatus.REPORTING && myUsage.some(item => item.requestId === r.id && (item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED))).length;

    const totalTasks = taskReportNeeded + taskCorrections;

    // UID count by status
    const pendingApprCount = myReqs.filter(r => r.status === RequestStatus.PENDING_APPROVAL).length;
    const approvedWaitingTransfer = myReqs.filter(r => r.status === RequestStatus.APPROVED || r.status === RequestStatus.PARTIALLY_APPROVED).length;
    const reportingCount = myReqs.filter(r => r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.REPORTING).length;
    const closedCount = myReqs.filter(r => r.status === RequestStatus.CLOSED).length;

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
                Ada {taskReportNeeded} pengajuan yang ditransfer dan siap dilaporkan, serta {taskCorrections} laporan yang perlu perbaikan.
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

        {/* 2x2 Stats Cards Grid */}
        <div className="grid grid-cols-2 gap-4">
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
                <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Manager</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Menunggu Approval Manager</p>
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
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Disetujui Manager siap ditransfer</p>
          </div>

          <div 
            onClick={() => handleCardClick('REPORTING')}
            className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'REPORTING' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PROSES LAPORAN</p>
              <div className="flex items-end justify-between mt-2">
                <span className="text-3xl font-display font-bold text-slate-900">{reportingCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Review</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Dana ditransfer, proses pelaporan penggunaan</p>
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
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Dinyatakan Closed oleh Admin</p>
          </div>
        </div>

        {/* Financial info Card - Saldo Operasional */}
        <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-lg border border-slate-800">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">SALDO OPERASIONAL</p>
            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md uppercase tracking-wider">
              Sisa Kas
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
        </div>
      </div>
    );
  }

  if (role === Role.MANAGER) {
    const managerReqs = requests.filter(r => r.managerEmail.toLowerCase() === email.toLowerCase());
    const managerReqIds = managerReqs.map(r => r.id);
    const managerUsage = usageItems.filter(item => managerReqIds.includes(item.requestId));

    // Active tasks for Manager:
    // 1. Initial approval needed: requests in PENDING_APPROVAL
    const pendingBudgetReview = managerReqs.filter(r => r.status === RequestStatus.PENDING_APPROVAL).length;

    // 2. Report reviews needed: requests in REVIEW_MANAGER
    const pendingReportReview = managerReqs.filter(r => r.status === RequestStatus.REVIEW_MANAGER).length;

    const totalTasks = pendingBudgetReview + pendingReportReview;

    // Request Stats for Manager's Team
    const teamPendingAppr = managerReqs.filter(r => r.status === RequestStatus.PENDING_APPROVAL).length;
    const teamReporting = managerReqs.filter(r => r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.REPORTING).length;
    const teamUnderReview = managerReqs.filter(r => r.status === RequestStatus.REPORTING || r.status === RequestStatus.REVIEW_MANAGER || r.status === RequestStatus.REVIEW_ADMIN).length;
    const teamClosed = managerReqs.filter(r => r.status === RequestStatus.CLOSED).length;

    return (
      <div className="space-y-4">
        {/* Urgent Task Card */}
        {totalTasks > 0 ? (
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
              <ClipboardCheck className="w-5.5 h-5.5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-indigo-900 text-xs tracking-wide uppercase">TUGAS PERSETUJUAN ({totalTasks})</h3>
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
              <p className="text-[9px] text-slate-400 mt-2 font-medium">Berisi UID yang telah ditransfer Admin dan dilaporkan penggunannya oleh User (termasuk Laporan Dana Talangan User)</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Admin stats
  if (role === Role.ADMIN) {
    // Admin reviews ALL requests and manages ALL transfers
    const pendingTransfer = requests.filter(r => r.status === RequestStatus.APPROVED || r.status === RequestStatus.PARTIALLY_APPROVED).length;
    const pendingAdminReportReview = requests.filter(r => {
      if (r.status !== RequestStatus.REVIEW_ADMIN && r.status !== RequestStatus.REPORTING) return false;
      const reqItems = usageItems.filter(i => i.requestId === r.id);
      if (reqItems.length === 0) return false;
      return reqItems.every(i => i.statusManager === ItemStatus.APPROVED);
    }).length;

    // Tasks needing Admin action:
    // 1. Pending cash transfers
    // 2. Pending admin report reviews
    const totalTasks = pendingTransfer + pendingAdminReportReview;

    const totalTransferred = requests.reduce((sum, r) => sum + r.adminActionAmount, 0);
    const closedRequestIds = requests.filter(r => r.status === RequestStatus.CLOSED).map(r => r.id);
    const totalClosed = usageItems
      .filter(item => closedRequestIds.includes(item.requestId))
      .reduce((sum, item) => sum + item.nominal, 0);

    return (
      <div className="space-y-4">
        {/* Urgent Task Card */}
        {totalTasks > 0 ? (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-700 shrink-0">
              <ArrowRightLeft className="w-5.5 h-5.5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-red-900 text-xs tracking-wide uppercase">TUGAS ADMINISTRATOR ({totalTasks})</h3>
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
              <span className="text-3xl font-display font-bold text-slate-900">{pendingTransfer} <span className="text-xs text-slate-400 font-normal">UID</span></span>
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
            </div>
          </div>

          {onManageUsers && (
            <div className="col-span-2 pt-1">
              <button
                onClick={onManageUsers}
                className="w-full py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
              >
                <ShieldCheck className="w-4 h-4 text-indigo-500" />
                <span>Kelola User</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
};
