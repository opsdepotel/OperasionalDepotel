/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Role, BudgetRequest, UsageReportItem, RequestStatus, ItemStatus, UserProfile, UserActivity, ItemReviewHistory } from '../types';
import { parseNumericValue } from '../lib/googleApi';
import { Clock, CheckCircle2, AlertCircle, Coins, CreditCard, ClipboardCheck, ArrowRightLeft, ShieldCheck, CalendarCheck, Fuel, AlertTriangle, FileText, XCircle } from 'lucide-react';

interface DashboardStatsProps {
  role: Role;
  email: string;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  activeFilter?: string;
  onSelectFilter?: (filterKey: string) => void;
  onManageUsers?: () => void;
  onOpenAdjustment?: () => void;
  onOpenReportsModal?: () => void;
  profiles?: UserProfile[];
  activities?: UserActivity[];
  onOpenActivities?: () => void;
  userProfile?: UserProfile | null;
  onOpenBbmModal?: () => void;
  onOpenBbmListModal?: () => void;
  histories?: ItemReviewHistory[];
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  role,
  email,
  requests,
  usageItems,
  activeFilter = 'ALL',
  onSelectFilter,
  onManageUsers,
  onOpenAdjustment,
  onOpenReportsModal,
  profiles = [],
  activities = [],
  onOpenActivities,
  userProfile,
  onOpenBbmModal,
  onOpenBbmListModal
}) => {
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
    return (
      <div
        onClick={onOpenBbmModal}
        className="bg-gradient-to-r from-amber-500/10 via-amber-50/80 to-orange-50/80 border border-amber-200/80 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3 transition-all cursor-pointer hover:border-amber-400 hover:shadow-md active:scale-[0.99] group"
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
              Akun ini memiliki hak akses resmi pengisian BBM operasional di SPBU Duren Sawit.
            </p>
          </div>
        </div>
      </div>
    );
  };

  // Compute stats based on roles
  if (role === Role.USER) {
    const myReqs = requests.filter(r => r.userEmail.toLowerCase() === email.toLowerCase() && r.status !== RequestStatus.CANCELLED);
    const myReqIds = myReqs.map(r => r.id);
    const myUsage = usageItems.filter(item => myReqIds.includes(item.requestId));

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
    const reportingCount = myReqs.filter(r => 
      r.status === RequestStatus.TRANSFERRED || 
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
                  taskRejected > 0 ? `${taskRejected} pengajuan perlu revisi Manager` : ''
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
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Pengajuan disetujui, menunggu proses transfer</p>
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
                {rejectedItemsInReportingCount > 0 && (
                  <span className="text-[9px] font-extrabold text-rose-600 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded-full animate-pulse">
                    {rejectedItemsInReportingCount} Perlu Perbaikan
                  </span>
                )}
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
              <p className="text-[9px] text-slate-400 mt-2 font-medium">Sedang direview</p>
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
            className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-rose-300 hover:shadow-md col-span-2 sm:col-span-1 ${
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
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Diminta revisi Manager, klik untuk lihat, revisi & batalkan</p>
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
  }

  if (role === Role.MANAGER) {
    const managerReqs = requests.filter(r => r.managerEmail.toLowerCase() === email.toLowerCase());
    const managerReqIds = managerReqs.map(r => r.id);
    const managerUsage = usageItems.filter(item => managerReqIds.includes(item.requestId));

    // Active tasks for Manager:
    // 1. Initial approval needed: requests in PENDING_APPROVAL
    const pendingBudgetReview = managerReqs.filter(r => r.status === RequestStatus.PENDING_APPROVAL).length;

    // 2. Report reviews needed: requests with usage items pending Manager review
    const pendingReportReview = managerReqs.filter(r => {
      if (![RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN, RequestStatus.TRANSFERRED].includes(r.status)) return false;
      const reqItems = usageItems.filter(item => item.requestId === r.id);
      if (reqItems.length === 0) return false;
      return reqItems.some(i => i.statusManager === ItemStatus.PENDING);
    }).length;

    const totalTasks = pendingBudgetReview + pendingReportReview;

    // Request Stats for Manager's Team
    const teamPendingAppr = managerReqs.filter(r => r.status === RequestStatus.PENDING_APPROVAL).length;
    const teamReporting = managerReqs.filter(r => r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.REPORTING).length;
    const teamUnderReview = pendingReportReview;
    const isBbmRequestManager = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
    const teamClosed = managerReqs.filter(r => r.status === RequestStatus.CLOSED && !isBbmRequestManager(r)).length;

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
    );
  }

  // Finance stats
  if (role === Role.FINANCE) {
    // Admin reviews ALL requests and manages ALL transfers
    const pendingTransfer = requests.filter(r => 
      r.status === RequestStatus.APPROVED || 
      r.status === RequestStatus.PARTIALLY_APPROVED || 
      r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
    ).length;
    const pendingAdminReportReview = requests.filter(r => {
      if (r.status !== RequestStatus.REVIEW_ADMIN && r.status !== RequestStatus.REPORTING) return false;
      const reqItems = usageItems.filter(i => i.requestId === r.id);
      if (reqItems.length === 0) return false;
      const managerApproved = reqItems.every(i => i.statusManager === ItemStatus.APPROVED);
      const adminApprovedAll = reqItems.every(i => i.statusAdmin === ItemStatus.APPROVED);
      return managerApproved && !adminApprovedAll;
    }).length;

    // Tasks needing Admin action:
    // 1. Pending cash transfers
    // 2. Pending admin report reviews
    const totalTasks = pendingTransfer + pendingAdminReportReview;
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

    const unbalancedUsersCount = profiles.filter(user => {
      const userReqs = requests.filter(r => r.userEmail.toLowerCase() === user.email.toLowerCase() && !isBbmRequestAdmin(r));
      const userReqIds = userReqs.map(r => r.id);
      const userUsage = usageItems.filter(item => userReqIds.includes(item.requestId) && !isBbmUsageItemAdmin(item));

      const totalTransferredVal = userReqs.filter(r => r.siteId !== 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
      const totalAdjustmentsVal = userReqs.filter(r => r.siteId === 'ADJUSTMENT').reduce((sum, r) => sum + r.adminActionAmount, 0);
      const totalReportedApproved = userUsage
        .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
        .reduce((sum, item) => sum + item.nominal, 0);
      
      const balance = totalTransferredVal + totalAdjustmentsVal - totalReportedApproved;
      return Math.abs(balance) > 0.01;
    }).length;

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
                <span className="text-3xl font-display font-bold text-slate-900">
                  {unbalancedUsersCount} <span className="text-xs text-slate-400 font-normal">User</span>
                </span>
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
      </div>
    );
  }

  // Compute stats for DIREKTUR role
  if (role === Role.DIREKTUR) {
    const activeReqs = requests.filter(r => r.status !== RequestStatus.CANCELLED);
    const isBbmRequest = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');

    // 1. PENGAJUAN (Pending Approval by Manager / Partially Approved)
    const pengajuanCount = activeReqs.filter(r => 
      r.status === RequestStatus.PENDING_APPROVAL || r.status === RequestStatus.PARTIALLY_APPROVED
    ).length;

    // 2. MENUNGGU TRANSFER (Approved by Manager or Bailout Reimbursement pending)
    const menungguTransferCount = activeReqs.filter(r => 
      r.status === RequestStatus.APPROVED || r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
    ).length;

    // 3. PROSES LAPORAN (Transferred, Reporting, Review Manager, Review Admin)
    const prosesLaporanCount = activeReqs.filter(r => 
      [RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(r.status)
    ).length;

    // 4. CLOSED (Closed requests excluding BBMDS)
    const closedCount = activeReqs.filter(r => r.status === RequestStatus.CLOSED && !isBbmRequest(r)).length;

    // Financial totals for executive summary
    const totalPengajuan = activeReqs.reduce((sum, r) => sum + (r.jumlahPengajuan || 0), 0);
    const totalTransferred = activeReqs.reduce((sum, r) => sum + (r.adminActionAmount || 0), 0);
    const totalClosed = activeReqs.filter(r => r.status === RequestStatus.CLOSED && !isBbmRequest(r)).reduce((sum, r) => sum + (r.adminActionAmount || 0), 0);

    return (
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
            <p className="text-[10px] text-slate-400 mt-2 font-medium">Disetujui, antrean pencairan Finance</p>
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
              <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wider">Total Pengajuan</span>
              <span className="text-sm font-bold font-display text-slate-800">{formatIDR(totalPengajuan)}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wider">Total Dana Ditransfer</span>
              <span className="text-sm font-bold font-display text-indigo-600">{formatIDR(totalTransferred)}</span>
            </div>
            <div className="col-span-2 pt-3 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block font-semibold uppercase tracking-wider">Total Closing Terverifikasi</span>
                  <span className="text-base font-extrabold font-display text-emerald-600 mt-0.5 block">{formatIDR(totalClosed)}</span>
                </div>
                <div className="text-right">
                  <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Selisih Belum Closing</span>
                  <span className="text-sm font-extrabold font-display text-amber-600 mt-0.5 block">{formatIDR(totalTransferred - totalClosed)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
