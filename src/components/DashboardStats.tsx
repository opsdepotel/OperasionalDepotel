/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Role, BudgetRequest, UsageReportItem, RequestStatus, ItemStatus, UserProfile, UserActivity, ItemReviewHistory, SiteInfo } from '../types';
import { getTransferBertahap, getFinanceApprovedAmount, isPendingTransferRequest, isFinanceApprovedOpRequest, isOpBiasaRequest } from '../App';
import { parseNumericValue, formatDivisiSubDivisi } from '../lib/googleApi';
import { detectFakeGps } from '../lib/fakeGpsDetector';
import { useBackHandler } from '../hooks/useBackHandler';
import { OP_TimeLine } from './OP_TimeLine';
import type { ManualActivitySubmitData } from './AdminManualActivityModal';
import { getUnreportedTransferredRequests, isBbmRequest as isBbmRequestUtil } from '../lib/uidMonitoringUtils';
import { Clock, CheckCircle2, AlertCircle, Coins, CreditCard, ClipboardCheck, ArrowRightLeft, ShieldCheck, CalendarCheck, Fuel, AlertTriangle, FileText, XCircle, Eye, X, Search, FileSpreadsheet, Download, MapPin, Navigation, RefreshCw, Copy, Check, ExternalLink, ShieldAlert, Loader2, ArrowLeft, Pause, Play, Radio, Plus, Share2, FolderOpen, ChevronDown, ChevronUp, Trash2, RotateCcw, BellRing, Smartphone, TrendingUp } from 'lucide-react';

const UserOperationalBalanceReportModal = lazy(() =>
  import('./UserOperationalBalanceReportModal').then(m => ({ default: m.UserOperationalBalanceReportModal }))
);
const ReopenUidModal = lazy(() =>
  import('./ReopenUidModal').then(m => ({ default: m.ReopenUidModal }))
);
const AdminDatabaseToolsCard = lazy(() =>
  import('./AdminDatabaseToolsCard').then(m => ({ default: m.AdminDatabaseToolsCard }))
);
const AdminPhotoMigrationCard = lazy(() =>
  import('./AdminPhotoMigrationCard').then(m => ({ default: m.AdminPhotoMigrationCard }))
);
const AdminManualActivityModal = lazy(() =>
  import('./AdminManualActivityModal').then(m => ({ default: m.AdminManualActivityModal }))
);
const AdminResponseTimeModal = lazy(() =>
  import('./AdminResponseTimeModal').then(m => ({ default: m.AdminResponseTimeModal }))
);
const UserUidMonitoringModal = lazy(() =>
  import('./UserUidMonitoringModal').then(m => ({ default: m.UserUidMonitoringModal }))
);

const isBbmUsageItemCommon = (item: UsageReportItem) =>
  item.requestId.startsWith('BBMDS') ||
  item.requestId.startsWith('BBM_DurenSawit') ||
  item.requestId.startsWith('TFDS');

const isBbmReqLocal = (r: BudgetRequest) =>
  r.id.startsWith('BBMDS') ||
  r.id.startsWith('BBM_DurenSawit') ||
  r.id.startsWith('TFDS') ||
  r.siteId === 'OPT-DUREN SAWIT' ||
  r.siteId === 'BBM DUREN SAWIT' ||
  (r as any).siteName?.toUpperCase().includes('DUREN SAWIT') ||
  r.keterangan?.toUpperCase().includes('DUREN SAWIT');

const parseDateToYYYYMMDDCommon = (dateInput: string | Date | undefined): string => {
  if (!dateInput) return '';
  const str = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
    const parts = str.split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2].substring(0, 4);
    return `${y}-${m}-${d}`;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return '';
};

const getJakartaTodayStrCommon = (): string => {
  try {
    const jakartaStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    if (/^\d{4}-\d{2}-\d{2}$/.test(jakartaStr)) return jakartaStr;
  } catch {}
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getLocalTodayStrCommon = (): string => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

interface DashboardStatsProps {
  role: Role;
  email: string;
  requests: BudgetRequest[];
  usageItems: UsageReportItem[];
  sites?: SiteInfo[];
  activeFilter?: string;
  onSelectFilter?: (filterKey: string) => void;
  onManageUsers?: () => void;
  onOpenUserDashboardPreview?: () => void;
  onOpenPushTest?: () => void;
  onOpenSharedReceipt?: () => void;
  onOpenAdjustment?: () => void;
  onOpenTransferList?: () => void;
  onOpenResponseTimeTable?: () => void;
  onOpenReportsModal?: () => void;
  onOpenUserUidMonitoring?: () => void;
  profiles?: UserProfile[];
  activities?: UserActivity[];
  onOpenActivities?: () => void;
  userProfile?: UserProfile | null;
  onOpenBbmModal?: () => void;
  onOpenBbmListModal?: () => void;
  histories?: ItemReviewHistory[];
  activeTab?: 'APPROVAL' | 'SUBMISSION';
  onSelectTab?: (tab: 'APPROVAL' | 'SUBMISSION') => void;
  onPurgeOrphanHistories?: () => Promise<{ purgedCount: number; remainingCount: number } | null>;
  onReopenRequest?: (req: BudgetRequest) => Promise<boolean>;
  onSaveManualActivity?: (data: ManualActivitySubmitData, photoFile: File) => Promise<void>;
  token?: string | null;
  spreadsheetId?: string | null;
  driveFolderId?: string | null;
  onConfigUpdated?: (newSheetId: string, newFolderId: string) => void;
}

const DEFAULT_SITES_LIST: SiteInfo[] = [
  { siteId: 'JKT-SOUTH-02', siteName: 'Depotel JKT South 02', coordinates: '-6.2088, 106.8456' },
  { siteId: 'SITE-A', siteName: 'Site Alfa Jakarta', coordinates: '-6.1751, 106.8272' },
  { siteId: 'SITE-B', siteName: 'Site Bravo Surabaya', coordinates: '-7.2575, 112.7521' },
  { siteId: 'SITE-C', siteName: 'Site Charlie Medan', coordinates: '3.5952, 98.6722' }
];

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  role,
  email,
  requests,
  usageItems,
  sites = [],
  activeFilter = 'ALL',
  onSelectFilter,
  onManageUsers,
  onOpenUserDashboardPreview,
  onOpenPushTest,
  onOpenSharedReceipt,
  onOpenAdjustment,
  onOpenTransferList,
  onOpenResponseTimeTable,
  onOpenReportsModal,
  onOpenUserUidMonitoring,
  profiles = [],
  activities = [],
  onOpenActivities,
  userProfile,
  onOpenBbmModal,
  onOpenBbmListModal,
  histories = [],
  activeTab,
  onSelectTab,
  onPurgeOrphanHistories,
  onReopenRequest,
  onSaveManualActivity,
  token,
  spreadsheetId,
  driveFolderId,
  onConfigUpdated
}) => {
  const [internalTab, setInternalTab] = useState<'APPROVAL' | 'SUBMISSION'>('APPROVAL');
  const currentTab = activeTab !== undefined ? activeTab : internalTab;
  const handleTabChange = (newTab: 'APPROVAL' | 'SUBMISSION') => {
    setInternalTab(newTab);
    if (onSelectTab) {
      onSelectTab(newTab);
    }
  };

  // Orphan Data Cleanup state
  const [isPurging, setIsPurging] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);

  const handlePurgeOrphan = async () => {
    if (!onPurgeOrphanHistories) return;
    setIsPurging(true);
    setPurgeMsg(null);
    try {
      const res = await onPurgeOrphanHistories();
      if (res) {
        if (res.purgedCount > 0) {
          setPurgeMsg(`Berhasil membersihkan ${res.purgedCount} data orphan! Tersisa ${res.remainingCount} riwayat valid.`);
        } else {
          setPurgeMsg(`Tabel sudah bersih! Semua (${res.remainingCount}) riwayat terhubung dengan pengajuan valid.`);
        }
      }
      setShowPurgeConfirm(false);
    } catch (err: any) {
      setPurgeMsg(err.message || 'Gagal melakukan pembersihan orphan data.');
    } finally {
      setIsPurging(false);
    }
  };
  const [isTransactionReportOpen, setIsTransactionReportOpen] = useState(false);
  const [transactionSearchQuery, setTransactionSearchQuery] = useState('');

  useBackHandler(isTransactionReportOpen, () => setIsTransactionReportOpen(false), 'dashboardStats_transactionReport');

  // Search Site Modal States
  const [isSearchSiteModalOpen, setIsSearchSiteModalOpen] = useState(false);
  const [searchSiteIdInput, setSearchSiteIdInput] = useState('');
  const [selectedSite, setSelectedSite] = useState<SiteInfo | null>(null);
  const [geocodedAddress, setGeocodedAddress] = useState<string | null>(null);
  const [isGeocodingSite, setIsGeocodingSite] = useState(false);
  const [copyCoordSuccess, setCopyCoordSuccess] = useState(false);

  useBackHandler(isSearchSiteModalOpen, () => setIsSearchSiteModalOpen(false), 'dashboardStats_searchSiteModal');

  // Manager Active UID Modal States
  const [isManagerActiveUidModalOpen, setIsManagerActiveUidModalOpen] = useState(false);
  const [searchManagerUidText, setSearchManagerUidText] = useState('');
  const [expandedManagerTimelines, setExpandedManagerTimelines] = useState<Record<string, boolean>>({});

  useBackHandler(isManagerActiveUidModalOpen, () => setIsManagerActiveUidModalOpen(false), 'dashboardStats_managerActiveUidModal');

  // Reopen UID Modal States (Administrator)
  const [isReopenUidModalOpen, setIsReopenUidModalOpen] = useState(false);
  useBackHandler(isReopenUidModalOpen, () => setIsReopenUidModalOpen(false), 'dashboardStats_reopenUidModal');

  // Manual Activity Report Modal States (Administrator)
  const [isManualActivityModalOpen, setIsManualActivityModalOpen] = useState(false);
  useBackHandler(isManualActivityModalOpen, () => setIsManualActivityModalOpen(false), 'dashboardStats_manualActivityModal');

  // Response Time Modal States (Administrator)
  const [isResponseTimeModalOpen, setIsResponseTimeModalOpen] = useState(false);
  useBackHandler(isResponseTimeModalOpen, () => setIsResponseTimeModalOpen(false), 'dashboardStats_responseTimeModal');

  // User UID Monitoring Modal States
  const [isUserUidMonitoringModalOpen, setIsUserUidMonitoringModalOpen] = useState(false);
  useBackHandler(isUserUidMonitoringModalOpen, () => setIsUserUidMonitoringModalOpen(false), 'dashboardStats_userUidMonitoringModal');

  // Shared O(1) Lookup Indexes (Memoized once across all roles)
  const profilesByEmailMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const p of profiles || []) {
      const key = (p.email || '').trim().toLowerCase();
      if (key && !map.has(key)) {
        map.set(key, p);
      }
    }
    return map;
  }, [profiles]);

  const uniqueProfilesList = useMemo(() => Array.from(profilesByEmailMap.values()), [profilesByEmailMap]);

  const requestsByUserEmailMap = useMemo(() => {
    const map = new Map<string, BudgetRequest[]>();
    for (const r of requests) {
      const key = (r.userEmail || '').trim().toLowerCase();
      if (!key) continue;
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(r);
    }
    return map;
  }, [requests]);

  const usageItemsByRequestIdMap = useMemo(() => {
    const map = new Map<string, UsageReportItem[]>();
    for (const item of usageItems) {
      const key = item.requestId;
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(item);
    }
    return map;
  }, [usageItems]);

  const reportedRequestIdsUpperSet = useMemo(() => {
    const set = new Set<string>();
    for (const item of usageItems) {
      if (item.requestId) {
        set.add(item.requestId.trim().toUpperCase());
      }
    }
    return set;
  }, [usageItems]);

  const historiesByUidMap = useMemo(() => {
    const map = new Map<string, ItemReviewHistory[]>();
    for (const h of histories || []) {
      const rUid = h.requestUid;
      const iUid = h.itemUid;
      if (rUid) {
        let list = map.get(rUid);
        if (!list) {
          list = [];
          map.set(rUid, list);
        }
        list.push(h);
      }
      if (iUid && iUid !== rUid) {
        let list = map.get(iUid);
        if (!list) {
          list = [];
          map.set(iUid, list);
        }
        list.push(h);
      }
    }
    return map;
  }, [histories]);

  // User Murni UID Monitoring statistics (skipped for Role.USER since monitoring card is not shown to USER)
  const userMurniMonitoringStats = useMemo(() => {
    if (role === Role.USER) {
      return { totalUsers: 0, blockedCount: 0, totalUnreportedCount: 0 };
    }

    const userMurniProfiles = (profiles || []).filter(p => {
      const r = (p.role || '').toUpperCase();
      return r === Role.USER || r === 'USER';
    });

    let blockedCount = 0;
    let totalUnreportedCount = 0;

    for (const p of userMurniProfiles) {
      const emailLower = (p.email || '').trim().toLowerCase();
      if (!emailLower) continue;
      const userReqs = requestsByUserEmailMap.get(emailLower) || [];
      let unreportedLen = 0;
      for (const r of userReqs) {
        if (isBbmRequestUtil(r)) continue;
        if (r.status === RequestStatus.CLOSED || r.status === RequestStatus.CANCELLED || r.status === RequestStatus.REJECTED) continue;
        const isTransferred =
          r.status === RequestStatus.TRANSFERRED ||
          r.status === RequestStatus.TRANSFER_BERTAHAP ||
          (typeof r.adminActionAmount === 'number' && r.adminActionAmount > 0);
        if (!isTransferred) continue;
        if (!reportedRequestIdsUpperSet.has((r.id || '').trim().toUpperCase())) {
          unreportedLen++;
        }
      }
      totalUnreportedCount += unreportedLen;
      if (unreportedLen > 1) {
        blockedCount++;
      }
    }

    return {
      totalUsers: userMurniProfiles.length,
      blockedCount,
      totalUnreportedCount
    };
  }, [role, profiles, requestsByUserEmailMap, reportedRequestIdsUpperSet]);

  // Role-specific memoized aggregations (only active role is computed)
  const userDashboardStats = useMemo(() => {
    const needsUserView =
      role === Role.USER ||
      ((role === Role.MANAGER || role === Role.FINANCE) && currentTab === 'SUBMISSION');
    if (!needsUserView) return null;

    const emailLower = (email || '').trim().toLowerCase();
    const myReqs = (requestsByUserEmailMap.get(emailLower) || []).filter(r => r.status !== RequestStatus.CANCELLED);

    const requesterProfile = profilesByEmailMap.get(emailLower);
    const isRequesterManagerOrFinance = requesterProfile
      ? (requesterProfile.role === Role.MANAGER || requesterProfile.role === Role.FINANCE)
      : (role === Role.MANAGER || role === Role.FINANCE);
    const supervisorTitle = isRequesterManagerOrFinance ? 'Direktur' : 'Manager';

    let totalRequested = 0;
    let totalTransferred = 0;
    let totalAdjustments = 0;
    let totalReportedApproved = 0;
    let taskReportNeeded = 0;
    let taskCorrections = 0;
    let taskRejected = 0;
    let rejectedItemsInReportingCount = 0;
    let pendingApprCount = 0;
    let approvedWaitingTransfer = 0;
    let reportingCount = 0;
    let closedCount = 0;

    const reportingStates = new Set<RequestStatus>([
      RequestStatus.TRANSFERRED,
      RequestStatus.TRANSFER_BERTAHAP,
      RequestStatus.REPORTING,
      RequestStatus.REVIEW_MANAGER,
      RequestStatus.REVIEW_ADMIN
    ]);

    for (const r of myReqs) {
      const reqItems = usageItemsByRequestIdMap.get(r.id) || [];
      const reqHistories = historiesByUidMap.get(r.id) || [];
      const isBbm = isBbmReqLocal(r);

      if (!isBbm) {
        if (r.siteId !== 'ADJUSTMENT') {
          totalRequested += r.jumlahPengajuan;
          totalTransferred += r.adminActionAmount;
        } else {
          totalAdjustments += r.adminActionAmount;
        }
      }

      let hasRejectedItem = false;
      for (const item of reqItems) {
        if (item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED && !isBbmUsageItemCommon(item)) {
          totalReportedApproved += item.nominal;
        }
        if (item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED) {
          hasRejectedItem = true;
          if (reportingStates.has(r.status)) {
            rejectedItemsInReportingCount++;
          }
        }
      }

      if (r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.TRANSFER_BERTAHAP || r.status === RequestStatus.REPORTING) {
        taskReportNeeded++;
      }
      if (reportingStates.has(r.status) && hasRejectedItem) {
        taskCorrections++;
      }
      if (r.status === RequestStatus.REJECTED) {
        taskRejected++;
      }
      if (
        r.status === RequestStatus.PENDING_APPROVAL ||
        (isOpBiasaRequest(r) && (r.status === RequestStatus.APPROVED || r.status === RequestStatus.PARTIALLY_APPROVED) && !isFinanceApprovedOpRequest(r, reqHistories))
      ) {
        pendingApprCount++;
      }
      if (isPendingTransferRequest(r, reqHistories, reqItems)) {
        approvedWaitingTransfer++;
      }
      if (reportingStates.has(r.status)) {
        reportingCount++;
      }
      if (r.status === RequestStatus.CLOSED && !isBbm) {
        closedCount++;
      }
    }

    const saldoOperasional = totalTransferred + totalAdjustments - totalReportedApproved;
    const totalTasks = taskReportNeeded + taskCorrections + taskRejected;
    const rejectedCount = taskRejected;

    const todayStr = getLocalTodayStrCommon();
    const userEmailToMatch = (userProfile?.email || email || '').toLowerCase();
    const todayTransferredReqs = (requestsByUserEmailMap.get(userEmailToMatch.trim()) || []).filter(r => {
      if (isBbmReqLocal(r) || r.status === RequestStatus.CANCELLED || !((r.adminActionAmount || 0) > 0)) return false;
      const dateAdminActionTime = r.adminActionTime && /^\d{4}-\d{2}-\d{2}/.test(String(r.adminActionTime).trim()) ? String(r.adminActionTime).trim().substring(0, 10) : '';
      if (dateAdminActionTime) return dateAdminActionTime === todayStr;
      const datePemakaian = r.tanggalPemakaian && /^\d{4}-\d{2}-\d{2}/.test(String(r.tanggalPemakaian).trim()) ? String(r.tanggalPemakaian).trim().substring(0, 10) : '';
      const dateCreatedAt = r.createdAt && /^\d{4}-\d{2}-\d{2}/.test(String(r.createdAt).trim()) ? String(r.createdAt).trim().substring(0, 10) : '';
      const dateTimestamp = r.timestamp && /^\d{4}-\d{2}-\d{2}/.test(String(r.timestamp).trim()) ? String(r.timestamp).trim().substring(0, 10) : '';
      return datePemakaian === todayStr || dateCreatedAt === todayStr || dateTimestamp === todayStr;
    });

    const todayActivitiesCount = activities.filter(
      act => act.userEmail.toLowerCase() === (userProfile?.email || email || '').toLowerCase() && act.tanggal === todayStr
    ).length;

    return {
      supervisorTitle,
      totalRequested,
      totalTransferred,
      totalAdjustments,
      totalReportedApproved,
      saldoOperasional,
      taskReportNeeded,
      taskCorrections,
      taskRejected,
      totalTasks,
      rejectedItemsInReportingCount,
      pendingApprCount,
      approvedWaitingTransfer,
      reportingCount,
      closedCount,
      rejectedCount,
      todayTransferredCount: todayTransferredReqs.length,
      todayTransferredTotal: todayTransferredReqs.reduce((sum, r) => sum + (r.adminActionAmount || 0), 0),
      todayActivitiesCount
    };
  }, [role, currentTab, email, userProfile, requestsByUserEmailMap, usageItemsByRequestIdMap, historiesByUidMap, profilesByEmailMap, activities]);

  const managerDashboardStats = useMemo(() => {
    if (role !== Role.MANAGER) return null;
    const emailLower = (email || '').toLowerCase();

    const managerReqs = requests.filter(r => r.managerEmail.toLowerCase() === emailLower);
    let pendingBudgetReview = 0;
    let pendingReportReview = 0;

    for (const r of managerReqs) {
      if (r.status === RequestStatus.PENDING_APPROVAL && isOpBiasaRequest(r)) {
        pendingBudgetReview++;
      }
      if ([RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN, RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP].includes(r.status)) {
        const reqItems = usageItemsByRequestIdMap.get(r.id) || [];
        if (reqItems.length > 0 && reqItems.some(i => i.statusManager === ItemStatus.PENDING)) {
          pendingReportReview++;
        }
      }
    }
    const totalApprovalTasks = pendingBudgetReview + pendingReportReview;

    const myPersonalReqs = (requestsByUserEmailMap.get(emailLower.trim()) || []).filter(r => r.status !== RequestStatus.CANCELLED);
    let myTaskReportNeeded = 0;
    let myTaskCorrections = 0;
    let myTaskRejected = 0;
    for (const r of myPersonalReqs) {
      if (r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.TRANSFER_BERTAHAP || r.status === RequestStatus.REPORTING) {
        myTaskReportNeeded++;
      }
      if ([RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(r.status)) {
        const reqItems = usageItemsByRequestIdMap.get(r.id) || [];
        if (reqItems.some(item => item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED)) {
          myTaskCorrections++;
        }
      }
      if (r.status === RequestStatus.REJECTED) {
        myTaskRejected++;
      }
    }
    const totalUserTasks = myTaskReportNeeded + myTaskCorrections + myTaskRejected;

    const subProfiles = profiles.filter(p => p.managerEmail.toLowerCase() === emailLower);
    const subEmails = new Set(subProfiles.map(p => p.email.toLowerCase()));
    const subActiveCount = requests.filter(r => {
      const isSubordinate = (r.managerEmail && r.managerEmail.toLowerCase() === emailLower) || subEmails.has(r.userEmail.toLowerCase());
      const isNotSelf = r.userEmail.toLowerCase() !== emailLower;
      const isActive = r.status !== RequestStatus.CLOSED && r.status !== RequestStatus.CANCELLED && r.status !== RequestStatus.REJECTED;
      return isSubordinate && isNotSelf && isActive;
    }).length;

    const todayStr = getLocalTodayStrCommon();
    const teamProfiles = profiles.filter(p => p.managerEmail.toLowerCase() === emailLower || p.email.toLowerCase() === emailLower);
    const teamEmails = new Set(teamProfiles.map(p => p.email.toLowerCase()));
    const todayTeamActivitiesCount = activities.filter(act =>
      teamEmails.has(act.userEmail.toLowerCase()) && act.tanggal === todayStr
    ).length;

    return {
      pendingBudgetReview,
      pendingReportReview,
      totalApprovalTasks,
      totalUserTasks,
      teamPendingAppr: pendingBudgetReview,
      teamUnderReview: pendingReportReview,
      subActiveCount,
      todayTeamActivitiesCount
    };
  }, [role, email, requests, profiles, activities, requestsByUserEmailMap, usageItemsByRequestIdMap]);

  const financeDashboardStats = useMemo(() => {
    if (role !== Role.FINANCE) return null;
    const emailLower = (email || '').toLowerCase();
    const todayStr = getJakartaTodayStrCommon();

    let pendingFinanceBudgetReview = 0;
    let pendingFinanceBudgetReviewAmount = 0;
    let pendingTransfer = 0;
    let pendingTransferAmount = 0;
    let pendingAdminReportReview = 0;
    let closedCount = 0;
    let financeRejectedCount = 0;
    let totalTransferred = 0;
    let todayTransferredCount = 0;
    let todayTransferredTotal = 0;
    let todayBbmCount = 0;
    let todayBbmTotal = 0;

    for (const r of requests) {
      if ((r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit')) && r.tanggalPemakaian === todayStr) {
        todayBbmCount++;
        todayBbmTotal += r.jumlahPengajuan;
      }

      if (r.status === RequestStatus.CANCELLED) continue;

      const reqItems = usageItemsByRequestIdMap.get(r.id) || [];
      const reqHistories = historiesByUidMap.get(r.id) || [];
      const isBbm = isBbmReqLocal(r);

      if (
        isOpBiasaRequest(r) &&
        (r.status === RequestStatus.APPROVED || r.status === RequestStatus.PARTIALLY_APPROVED) &&
        !isFinanceApprovedOpRequest(r, reqHistories)
      ) {
        pendingFinanceBudgetReview++;
        pendingFinanceBudgetReviewAmount += r.managerActionAmount > 0 ? r.managerActionAmount : r.jumlahPengajuan;
      }

      if (isPendingTransferRequest(r, reqHistories, reqItems)) {
        pendingTransfer++;
        if (r.status === RequestStatus.PENDING_TALANGAN_TRANSFER) {
          let approvedUsage = 0;
          for (const i of reqItems) {
            if (i.statusManager === ItemStatus.APPROVED) approvedUsage += i.nominal || 0;
          }
          pendingTransferAmount += approvedUsage || r.adminActionAmount || r.managerActionAmount || r.jumlahPengajuan || 0;
        } else {
          const finApproved = getFinanceApprovedAmount(r, reqHistories, reqItems);
          if (isOpBiasaRequest(r) && r.status !== RequestStatus.CLOSED && getTransferBertahap(r, reqHistories, reqItems)) {
            const remainingToTransfer = Math.max(0, finApproved - (r.adminActionAmount || 0));
            pendingTransferAmount += remainingToTransfer || finApproved;
          } else {
            let finApprovedNominal = 0;
            for (const h of reqHistories) {
              if ((h.requestUid === r.id || h.itemUid === r.id) && h.actionType === 'APPROVAL_FINANCE') {
                finApprovedNominal += h.nominal || 0;
              }
            }
            const amt = r.adminActionAmount > 0 ? r.adminActionAmount : (finApprovedNominal > 0 ? finApprovedNominal : (r.managerActionAmount > 0 ? r.managerActionAmount : (r.jumlahPengajuan || 0)));
            pendingTransferAmount += amt;
          }
        }
      }

      if ((r.status === RequestStatus.REVIEW_ADMIN || r.status === RequestStatus.REPORTING) && reqItems.length > 0) {
        const allMgrApproved = reqItems.every(i => i.statusManager === ItemStatus.APPROVED);
        const noAdminRejected = !reqItems.some(i => i.statusAdmin === ItemStatus.REJECTED);
        const hasAdminPending = reqItems.some(i => i.statusAdmin === ItemStatus.PENDING);
        if (allMgrApproved && noAdminRejected && (r.status === RequestStatus.REVIEW_ADMIN || hasAdminPending)) {
          pendingAdminReportReview++;
        }
      }

      if (r.status === RequestStatus.CLOSED && !isBbm) {
        closedCount++;
      }

      if (r.status === RequestStatus.REJECTED || reqItems.some(i => i.statusAdmin === ItemStatus.REJECTED)) {
        financeRejectedCount++;
      }

      if (!isBbm) {
        totalTransferred += r.adminActionAmount;
        if ((r.adminActionAmount || 0) > 0) {
          const dateAdminActionTime = parseDateToYYYYMMDDCommon(r.adminActionTime);
          const isToday = dateAdminActionTime
            ? dateAdminActionTime === todayStr
            : (parseDateToYYYYMMDDCommon(r.tanggalPemakaian) === todayStr ||
               parseDateToYYYYMMDDCommon(r.createdAt) === todayStr ||
               parseDateToYYYYMMDDCommon(r.timestamp) === todayStr);
          if (isToday) {
            todayTransferredCount++;
            todayTransferredTotal += r.adminActionAmount || 0;
          }
        }
      }
    }

    const totalApprovalTasks = pendingFinanceBudgetReview + pendingTransfer + pendingAdminReportReview;

    const myPersonalReqs = (requestsByUserEmailMap.get(emailLower.trim()) || []).filter(r => r.status !== RequestStatus.CANCELLED);
    let myTaskReportNeeded = 0;
    let myTaskCorrections = 0;
    let myTaskRejected = 0;
    for (const r of myPersonalReqs) {
      if (r.status === RequestStatus.TRANSFERRED || r.status === RequestStatus.TRANSFER_BERTAHAP || r.status === RequestStatus.REPORTING) {
        myTaskReportNeeded++;
      }
      if ([RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(r.status)) {
        const reqItems = usageItemsByRequestIdMap.get(r.id) || [];
        if (reqItems.some(item => item.statusManager === ItemStatus.REJECTED || item.statusAdmin === ItemStatus.REJECTED)) {
          myTaskCorrections++;
        }
      }
      if (r.status === RequestStatus.REJECTED) {
        myTaskRejected++;
      }
    }
    const totalUserTasks = myTaskReportNeeded + myTaskCorrections + myTaskRejected;

    let totalClosed = 0;
    for (const item of usageItems) {
      if (item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED && !isBbmUsageItemCommon(item)) {
        totalClosed += item.nominal;
      }
    }

    let unbalancedUsersCount = 0;
    let totalAdjustmentNominalNeeded = 0;
    for (const user of uniqueProfilesList) {
      const uEmail = (user.email || '').trim().toLowerCase();
      const userReqs = requestsByUserEmailMap.get(uEmail) || [];
      let totalTransferredVal = 0;
      let totalAdjustmentsVal = 0;
      let totalReportedApproved = 0;

      for (const r of userReqs) {
        if (r.status === RequestStatus.CANCELLED || isBbmReqLocal(r)) continue;
        if (r.siteId !== 'ADJUSTMENT') {
          totalTransferredVal += r.adminActionAmount;
        } else {
          totalAdjustmentsVal += r.adminActionAmount;
        }
        const rItems = usageItemsByRequestIdMap.get(r.id) || [];
        for (const item of rItems) {
          if (!isBbmUsageItemCommon(item) && item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED) {
            totalReportedApproved += item.nominal;
          }
        }
      }

      const balance = totalTransferredVal + totalAdjustmentsVal - totalReportedApproved;
      const requiredNominal = Math.abs(balance);
      if (requiredNominal > 0.01) {
        unbalancedUsersCount++;
        totalAdjustmentNominalNeeded += requiredNominal;
      }
    }

    const todayAllActivitiesCount = activities.filter(act => act.tanggal === todayStr).length;

    return {
      pendingFinanceBudgetReview,
      pendingFinanceBudgetReviewAmount,
      pendingTransfer,
      pendingTransferAmount,
      pendingAdminReportReview,
      totalApprovalTasks,
      totalTasks: totalApprovalTasks,
      totalUserTasks,
      closedCount,
      financeRejectedCount,
      totalTransferred,
      totalClosed,
      unbalancedUsersCount,
      totalAdjustmentNominalNeeded,
      todayTransferredCount,
      todayTransferredTotal,
      todayBbmCount,
      todayBbmTotal,
      todayAllActivitiesCount
    };
  }, [role, email, requests, usageItems, activities, uniqueProfilesList, requestsByUserEmailMap, usageItemsByRequestIdMap, historiesByUidMap]);

  const direkturDashboardStats = useMemo(() => {
    if (role !== Role.DIREKTUR) return null;

    const direkturEmails = new Set<string>(['margono@depotel.com', 'direktur@company.com']);
    for (const p of profiles) {
      if (p.role === Role.DIREKTUR && p.email) {
        direkturEmails.add(p.email.trim().toLowerCase());
      }
    }
    const emailLower = (email || '').trim().toLowerCase();
    const userProfileEmailLower = (userProfile?.email || '').trim().toLowerCase();
    if (emailLower) direkturEmails.add(emailLower);
    if (userProfileEmailLower) direkturEmails.add(userProfileEmailLower);

    const isDirekturDirectReq = (r: BudgetRequest) => {
      const reqManagerEmail = (r.managerEmail || '').trim().toLowerCase();
      const requesterProfile = profilesByEmailMap.get((r.userEmail || '').trim().toLowerCase());
      if (requesterProfile?.role === Role.MANAGER || requesterProfile?.role === Role.FINANCE) {
        return true;
      }
      if (reqManagerEmail && (
        direkturEmails.has(reqManagerEmail) ||
        reqManagerEmail.includes('margono') ||
        reqManagerEmail.includes('direktur') ||
        (emailLower && reqManagerEmail === emailLower) ||
        (userProfileEmailLower && reqManagerEmail === userProfileEmailLower)
      )) {
        return true;
      }
      if (requesterProfile) {
        const profileMgrEmail = (requesterProfile.managerEmail || '').trim().toLowerCase();
        if (profileMgrEmail && (
          direkturEmails.has(profileMgrEmail) ||
          profileMgrEmail.includes('margono') ||
          profileMgrEmail.includes('direktur') ||
          (emailLower && profileMgrEmail === emailLower) ||
          (userProfileEmailLower && profileMgrEmail === userProfileEmailLower)
        )) {
          return true;
        }
      }
      return false;
    };

    const reportingStatusSet = new Set<RequestStatus>([
      RequestStatus.TRANSFERRED,
      RequestStatus.TRANSFER_BERTAHAP,
      RequestStatus.REPORTING,
      RequestStatus.REVIEW_MANAGER,
      RequestStatus.REVIEW_ADMIN
    ]);

    const todayStr = getJakartaTodayStrCommon();
    const todayLocalStr = getLocalTodayStrCommon();

    let pendingBudgetReview = 0;
    let pendingReportReview = 0;
    let pengajuanCount = 0;
    let menungguTransferCount = 0;
    let menungguTransferNominal = 0;
    let prosesLaporanCount = 0;
    let closedCount = 0;
    let totalPengajuan = 0;
    let totalTransferred = 0;
    let todayTransferredCount = 0;
    let todayTransferredTotal = 0;

    for (const r of requests) {
      const isBbm = isBbmReqLocal(r);
      if (!isBbm) {
        totalTransferred += r.adminActionAmount || 0;
      }

      if (r.status === RequestStatus.CANCELLED) continue;

      const reqItems = usageItemsByRequestIdMap.get(r.id) || [];
      const reqHistories = historiesByUidMap.get(r.id) || [];

      if (isDirekturDirectReq(r)) {
        if (r.status === RequestStatus.PENDING_APPROVAL || r.status === RequestStatus.PARTIALLY_APPROVED) {
          pendingBudgetReview++;
        }
        if (reportingStatusSet.has(r.status) && reqItems.length > 0 && reqItems.some(i => i.statusManager === ItemStatus.PENDING)) {
          pendingReportReview++;
        }
      }

      const isPendingManager = r.status === RequestStatus.PENDING_APPROVAL;
      const isPendingFinance =
        isOpBiasaRequest(r) &&
        (r.status === RequestStatus.APPROVED || r.status === RequestStatus.PARTIALLY_APPROVED) &&
        !isFinanceApprovedOpRequest(r, reqHistories);
      if (isPendingManager || isPendingFinance) {
        pengajuanCount++;
      }

      if (isPendingTransferRequest(r, reqHistories, reqItems)) {
        menungguTransferCount++;
        if (r.status === RequestStatus.PENDING_TALANGAN_TRANSFER) {
          let approvedUsage = 0;
          for (const i of reqItems) {
            if (i.statusManager === ItemStatus.APPROVED) approvedUsage += i.nominal || 0;
          }
          menungguTransferNominal += approvedUsage || r.adminActionAmount || r.managerActionAmount || r.jumlahPengajuan || 0;
        } else {
          const finApproved = getFinanceApprovedAmount(r, reqHistories, reqItems);
          if (isOpBiasaRequest(r) && r.status !== RequestStatus.CLOSED && getTransferBertahap(r, reqHistories, reqItems)) {
            const remainingToTransfer = Math.max(0, finApproved - (r.adminActionAmount || 0));
            menungguTransferNominal += remainingToTransfer || finApproved;
          } else {
            let finApprovedNominal = 0;
            for (const h of reqHistories) {
              if ((h.requestUid === r.id || h.itemUid === r.id) && h.actionType === 'APPROVAL_FINANCE') {
                finApprovedNominal += h.nominal || 0;
              }
            }
            const amt = r.adminActionAmount > 0 ? r.adminActionAmount : (finApprovedNominal > 0 ? finApprovedNominal : (r.managerActionAmount > 0 ? r.managerActionAmount : (r.jumlahPengajuan || 0)));
            menungguTransferNominal += amt;
          }
        }
      }

      if (reportingStatusSet.has(r.status)) {
        prosesLaporanCount++;
      }
      if (r.status === RequestStatus.CLOSED && !isBbm) {
        closedCount++;
      }
      totalPengajuan += r.jumlahPengajuan || 0;

      if (!isBbm && (r.adminActionAmount || 0) > 0) {
        const dateAdminActionTime = parseDateToYYYYMMDDCommon(r.adminActionTime);
        const isToday = dateAdminActionTime
          ? dateAdminActionTime === todayStr
          : (parseDateToYYYYMMDDCommon(r.tanggalPemakaian) === todayStr ||
             parseDateToYYYYMMDDCommon(r.createdAt) === todayStr ||
             parseDateToYYYYMMDDCommon(r.timestamp) === todayStr);
        if (isToday) {
          todayTransferredCount++;
          todayTransferredTotal += r.adminActionAmount || 0;
        }
      }
    }

    let totalClosed = 0;
    for (const item of usageItems) {
      if (item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED && !isBbmUsageItemCommon(item)) {
        totalClosed += item.nominal || 0;
      }
    }

    const todayAllActivitiesCount = activities.filter(act => act.tanggal === todayLocalStr).length;

    return {
      pendingBudgetReview,
      pendingReportReview,
      totalApprovalTasks: pendingBudgetReview + pendingReportReview,
      pengajuanCount,
      menungguTransferCount,
      menungguTransferNominal,
      prosesLaporanCount,
      closedCount,
      totalPengajuan,
      totalTransferred,
      totalClosed,
      todayTransferredCount,
      todayTransferredTotal,
      todayAllActivitiesCount
    };
  }, [role, email, userProfile, profiles, requests, usageItems, activities, profilesByEmailMap, usageItemsByRequestIdMap, historiesByUidMap]);

  const adminDashboardStats = useMemo(() => {
    if (role !== Role.ADMINISTRATOR) return null;
    const totalUsers = profiles.length;
    let staffCount = 0;
    let managerCount = 0;
    let financeCount = 0;
    let direkturCount = 0;
    let adminCount = 0;
    let mobileBindingCount = 0;
    let activeSubsUsersCount = 0;

    for (const p of profiles) {
      if (p.role === Role.USER) staffCount++;
      else if (p.role === Role.MANAGER) managerCount++;
      else if (p.role === Role.FINANCE) financeCount++;
      else if (p.role === Role.DIREKTUR) direkturCount++;
      else if (p.role === Role.ADMINISTRATOR) adminCount++;
      if (p.mobile || p.deviceId) mobileBindingCount++;
      if (p.pushSubscriptions) {
        try {
          const parsed = JSON.parse(p.pushSubscriptions);
          if (Array.isArray(parsed) ? parsed.length > 0 : !!parsed) activeSubsUsersCount++;
        } catch {}
      }
    }

    const todayStr = getLocalTodayStrCommon();
    let todayBbmCount = 0;
    let todayBbmTotal = 0;
    let opBiasaCount = 0;
    for (const r of requests) {
      if ((r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit')) && r.tanggalPemakaian === todayStr) {
        todayBbmCount++;
        todayBbmTotal += r.jumlahPengajuan;
      }
      if (r.id && r.id.startsWith('OP-') && !r.id.startsWith('OPT-')) {
        opBiasaCount++;
      }
    }

    return {
      totalUsers,
      staffCount,
      managerCount,
      financeCount,
      direkturCount,
      adminCount,
      mobileBindingCount,
      activeSubsUsersCount,
      todayBbmCount,
      todayBbmTotal,
      opBiasaCount,
      todayStr
    };
  }, [role, profiles, requests]);

  const allSitesToUse = useMemo(() => {
    return (sites && sites.length > 0) ? sites : DEFAULT_SITES_LIST;
  }, [sites]);

  // Auto match selected site when search input changes
  useEffect(() => {
    const q = searchSiteIdInput.trim().toLowerCase();
    if (!q) {
      setSelectedSite(prev => prev ? null : prev);
      return;
    }
    const match = allSitesToUse.find(s => s.siteId.toLowerCase() === q);
    if (match) {
      setSelectedSite(prev => (prev?.siteId === match.siteId && prev?.coordinates === match.coordinates) ? prev : match);
    } else {
      setSelectedSite(prev => prev ? null : prev);
    }
  }, [searchSiteIdInput, allSitesToUse]);

  // Reverse geocode address corresponding to site coordinates
  useEffect(() => {
    if (!selectedSite || !selectedSite.coordinates) {
      setGeocodedAddress(prev => prev ? null : prev);
      setIsGeocodingSite(prev => prev ? false : prev);
      return;
    }

    const coord = selectedSite.coordinates.trim();
    const parts = coord.split(',').map(s => s.trim());
    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
      const lat = parts[0];
      const lon = parts[1];
      setIsGeocodingSite(prev => prev ? prev : true);
      fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`)
        .then(res => res.json())
        .then(data => {
          if (data && data.display_name) {
            setGeocodedAddress(data.display_name);
          } else {
            setGeocodedAddress(`Lokasi Koordinat GPS (${coord})`);
          }
        })
        .catch(() => {
          setGeocodedAddress(`Lokasi Koordinat GPS (${coord})`);
        })
        .finally(() => {
          setIsGeocodingSite(false);
        });
    } else {
      setGeocodedAddress(coord);
      setIsGeocodingSite(false);
    }
  }, [selectedSite]);

  const getGoogleMapsDirectionUrl = (site: SiteInfo) => {
    if (!site.coordinates) return '#';
    const parts = site.coordinates.split(',').map(s => s.trim());
    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${parts[0]},${parts[1]}`)}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.coordinates)}`;
  };

  const [isGpsModalOpen, setIsGpsModalOpen] = useState(false);
  const [isFetchingGpsModal, setIsFetchingGpsModal] = useState(false);
  const [gpsModalPosition, setGpsModalPosition] = useState<GeolocationPosition | null>(null);
  const [gpsModalError, setGpsModalError] = useState<string | null>(null);
  const [gpsFetchDurationMs, setGpsFetchDurationMs] = useState<number | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [permissionState, setPermissionState] = useState<string>('Memeriksa...');
  const [gpsUpdateCount, setGpsUpdateCount] = useState<number>(0);
  const [lastGpsCheckTime, setLastGpsCheckTime] = useState<Date | null>(null);
  const [isAutoGpsActive, setIsAutoGpsActive] = useState<boolean>(true);
  const [prevGpsModalPosition, setPrevGpsModalPosition] = useState<GeolocationPosition | null>(null);

  const [direkturGroupTab, setDirekturGroupTab] = useState<'APPROVAL' | 'MONITORING'>(() => {
    try {
      const saved = localStorage.getItem('applet_direktur_dashboard_tab');
      if (saved === 'APPROVAL' || saved === 'MONITORING') return saved;
    } catch (e) {
      // ignore
    }
    return 'APPROVAL';
  });

  const updateDirekturTab = (newTab: 'APPROVAL' | 'MONITORING') => {
    setDirekturGroupTab(prev => {
      if (prev === newTab) return prev;
      try {
        localStorage.setItem('applet_direktur_dashboard_tab', newTab);
      } catch (e) {
        // ignore
      }
      return newTab;
    });
  };

  useEffect(() => {
    if (role === Role.DIREKTUR && activeFilter) {
      if (activeFilter === 'DIREKTUR_APPROVAL' || activeFilter === 'DIREKTUR_RECONCILIATION') {
        updateDirekturTab('APPROVAL');
      } else if (['PENDING', 'APPROVED', 'REPORTING', 'CLOSED'].includes(activeFilter)) {
        updateDirekturTab('MONITORING');
      }
    }
  }, [role, activeFilter]);

  useBackHandler(isGpsModalOpen, () => setIsGpsModalOpen(false), 'dashboardStats_gpsModal');

  useEffect(() => {
    if (!isGpsModalOpen) {
      setGpsUpdateCount(0);
      setGpsModalPosition(null);
      setPrevGpsModalPosition(null);
      setGpsModalError(null);
      setLastGpsCheckTime(null);
      return;
    }

    if (!navigator.geolocation) {
      setGpsModalError('Perangkat atau browser Anda tidak mendukung pencarian lokasi GPS.');
      return;
    }

    if (!isAutoGpsActive) return;

    setIsFetchingGpsModal(prev => gpsModalPosition ? false : true);
    setGpsModalError(null);

    let watchId: number | null = null;
    let intervalId: any = null;
    let startTime = Date.now();

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((p) => {
        setPermissionState(p.state);
      }).catch(() => {
        setPermissionState('Aktif / Standard');
      });
    } else {
      setPermissionState('Aktif / Standard');
    }

    const handlePos = (pos: GeolocationPosition) => {
      const duration = Date.now() - startTime;
      setGpsModalPosition(prev => {
        if (prev) setPrevGpsModalPosition(prev);
        return pos;
      });
      setGpsFetchDurationMs(duration);
      setIsFetchingGpsModal(false);
      setGpsModalError(null);
      setGpsUpdateCount(c => c + 1);
      setLastGpsCheckTime(new Date());
    };

    const handleErr = (err: GeolocationPositionError) => {
      let msg = 'Gagal mengambil koordinat lokasi GPS dari perangkat.';
      if (err.code === err.PERMISSION_DENIED) {
        msg = 'Akses lokasi (GPS) ditolak. Harap beri izin akses lokasi pada browser/perangkat Anda.';
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        msg = 'Sinyal GPS atau posisi tidak tersedia pada perangkat.';
      } else if (err.code === err.TIMEOUT) {
        msg = 'Waktu pengambilan sinyal GPS habis (timeout). Silakan klik Ulangi Cek GPS.';
      }
      setGpsModalError(msg);
      setIsFetchingGpsModal(false);
    };

    // First immediate check
    startTime = Date.now();
    navigator.geolocation.getCurrentPosition(handlePos, handleErr, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });

    // Real-time stream with watchPosition
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        startTime = Date.now();
        handlePos(pos);
      },
      (err) => {},
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    // Continuous repetition interval every 2.5s
    intervalId = setInterval(() => {
      startTime = Date.now();
      navigator.geolocation.getCurrentPosition(handlePos, () => {}, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      });
    }, 2500);

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [isGpsModalOpen, isAutoGpsActive]);

  const fetchGpsDataManual = () => {
    if (!navigator.geolocation) return;
    setIsFetchingGpsModal(true);
    setGpsModalError(null);
    const startTime = Date.now();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsModalPosition(pos);
        setGpsFetchDurationMs(Date.now() - startTime);
        setIsFetchingGpsModal(false);
        setGpsUpdateCount(c => c + 1);
        setLastGpsCheckTime(new Date());
      },
      (err) => {
        setGpsModalError('Gagal memperbarui posisi GPS.');
        setIsFetchingGpsModal(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleOpenGpsCheck = () => {
    setIsGpsModalOpen(true);
    setIsAutoGpsActive(true);
  };

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
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

  const getStatusLabel = (status: RequestStatus, userEmail?: string) => {
    const requesterProfile = userEmail ? profiles.find(p => p.email.trim().toLowerCase() === userEmail.trim().toLowerCase()) : null;
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

  const handleExportPDF = async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable')
    ]);
    const isBbmReq = (r: BudgetRequest) => r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit') || r.id.startsWith('TFDS') || r.siteId === 'OPT-DUREN SAWIT';
    const isBbmItem = (item: UsageReportItem) => item.requestId.startsWith('BBMDS') || item.requestId.startsWith('BBM_DurenSawit') || item.requestId.startsWith('TFDS');

    const myUserReqs = requests.filter(r => 
      r.userEmail.toLowerCase() === email.toLowerCase() && 
      r.status !== RequestStatus.CANCELLED && 
      !isBbmReq(r)
    ).sort((a, b) => {
      const timeA = getTransferTimestampMs(a);
      const timeB = getTransferTimestampMs(b);
      if (timeA !== timeB) return timeB - timeA;
      return b.id.localeCompare(a.id);
    });

    const filteredReqs = myUserReqs;

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const nowStr = new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('LAPORAN TRANSAKSI SALDO OPERASIONAL USER', 14, 15);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`User: ${userProfile?.nama || email} (${email}) | Divisi: ${formatDivisiSubDivisi(userProfile?.divisi, userProfile?.subDivisi)}`, 14, 21);
    doc.text(`Dicetak Pada: ${nowStr}`, 283, 21, { align: 'right' });

    // Summary Box
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 25, 269, 12, 2, 2, 'FD');

    const totPengajuan = filteredReqs.reduce((sum, r) => sum + r.jumlahPengajuan, 0);
    const totTransfer = filteredReqs.reduce((sum, r) => sum + r.adminActionAmount, 0);
    const totDilaporkan = filteredReqs.reduce((sum, r) => {
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

    const tableRows = filteredReqs.map((r, idx) => {
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
        getStatusLabel(r.status)
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
        1: { halign: 'center', cellWidth: 25 },
        2: { cellWidth: 44 },
        3: { halign: 'right', cellWidth: 35 },
        4: { halign: 'right', cellWidth: 35 },
        5: { halign: 'right', cellWidth: 35 },
        6: { halign: 'right', cellWidth: 38 },
        7: { halign: 'center', cellWidth: 47 }
      },
      foot: [[
        { content: 'TOTAL REKAPITULASI LAPORAN', colSpan: 3, styles: { halign: 'center', fontStyle: 'bold', fillColor: [241, 245, 249] } },
        { content: formatIDR(totPengajuan), styles: { halign: 'right', fontStyle: 'bold', fillColor: [241, 245, 249] } },
        { content: formatIDR(totTransfer), styles: { halign: 'right', fontStyle: 'bold', textColor: [67, 56, 202], fillColor: [241, 245, 249] } },
        { content: formatIDR(totDilaporkan), styles: { halign: 'right', fontStyle: 'bold', textColor: [4, 120, 87], fillColor: [241, 245, 249] } },
        { content: formatIDR(totSisa), styles: { halign: 'right', fontStyle: 'bold', textColor: totSisa >= 0 ? [4, 120, 87] : [190, 18, 60], fillColor: [241, 245, 249] } },
        { content: '', styles: { fillColor: [241, 245, 249] } }
      ]],
      margin: { left: 14, right: 14 }
    });

    const cleanName = (userProfile?.nama || email).replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(`Laporan_Saldo_Operasional_${cleanName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const renderStatusBadge = (status: RequestStatus, userEmail?: string) => {
    const requesterProfile = userEmail ? profilesByEmailMap.get(userEmail.trim().toLowerCase()) || null : null;
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
    const userEmailToMatch = (userProfile?.email || email || '').trim().toLowerCase();
    const userMatchedProfile = profiles.find(p => 
      (p.email && userEmailToMatch && p.email.trim().toLowerCase() === userEmailToMatch) ||
      (p.userId && userProfile?.userId && p.userId.trim().toLowerCase() === userProfile.userId.trim().toLowerCase())
    ) || userProfile;

    const isPrivileged = [
      Role.MANAGER, Role.FINANCE, Role.DIREKTUR, Role.ADMINISTRATOR
    ].includes(role) || [
      Role.MANAGER, Role.FINANCE, Role.DIREKTUR, Role.ADMINISTRATOR
    ].includes(userMatchedProfile?.role as Role);

    const rawAksesBbm = userMatchedProfile?.aksesBBM !== undefined ? userMatchedProfile.aksesBBM : userProfile?.aksesBBM;
    const bbmStr = String(rawAksesBbm ?? '').trim().toUpperCase();
    const hasBbmAccess = isPrivileged || rawAksesBbm === true || [
      'TRUE', 'YA', '1', 'BENAR', 'YES', 'Y', 'AKTIF', 'ACTIVE', 'CENTANG', 'V', '✓'
    ].includes(bbmStr);

    if (!hasBbmAccess) return null;

    const getTodayStr = () => {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const todayStr = getTodayStr();

    const todayRefillCount = requests.filter(r => {
      const isBbmReq = r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit');
      if (!isBbmReq) return false;
      if (r.status === RequestStatus.CANCELLED) return false;
      const isSameUser = r.userEmail.toLowerCase() === userEmailToMatch;
      const isSameDate = r.tanggalPemakaian === todayStr || (r.createdAt && r.createdAt.substring(0, 10) === todayStr);
      return isSameUser && isSameDate;
    }).length;

    return (
      <button
        type="button"
        onClick={onOpenBbmListModal || onOpenBbmModal}
        className="w-full text-left bg-gradient-to-r from-amber-500/10 via-amber-50/80 to-orange-50/80 border border-amber-200/80 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3 transition-all cursor-pointer hover:border-amber-400 hover:shadow-md active:scale-[0.99] group"
        id="bbm-refill-dashboard-card"
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
              {todayRefillCount > 0
                ? `Tercatat ${todayRefillCount}x pengisian hari ini (${todayStr}). Klik untuk lihat / tambah pengisian.`
                : 'Klik untuk melihat daftar & catat pengisian BBM Duren Sawit.'}
            </p>
          </div>
        </div>
        {todayRefillCount > 0 ? (
          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-lg shrink-0 border border-emerald-200 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            {todayRefillCount}x Terisi
          </span>
        ) : (
          <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-lg shrink-0 border border-amber-200">
            Pengisian BBM
          </span>
        )}
      </button>
    );
  };

  // Modal UID Aktif Tim Bawahan (VIEW ONLY - MANAGER)
  const renderManagerActiveUidModal = () => {
    if (!isManagerActiveUidModalOpen || role !== Role.MANAGER) return null;

    const subProfiles = profiles.filter(p => p.managerEmail.toLowerCase() === email.toLowerCase());
    const subEmails = new Set(subProfiles.map(p => p.email.toLowerCase()));

    const subActiveRequests = requests.filter(r => {
      const isSubordinate = (r.managerEmail && r.managerEmail.toLowerCase() === email.toLowerCase()) || subEmails.has(r.userEmail.toLowerCase());
      const isNotSelf = r.userEmail.toLowerCase() !== email.toLowerCase();
      const isActive = r.status !== RequestStatus.CLOSED && r.status !== RequestStatus.CANCELLED && r.status !== RequestStatus.REJECTED;
      return isSubordinate && isNotSelf && isActive;
    });

    const searchLower = searchManagerUidText.trim().toLowerCase();
    const subActiveRequestsFiltered = subActiveRequests.filter(r => {
      if (!searchLower) return true;
      const reqProfile = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
      const reqName = (reqProfile?.nama || (reqProfile as any)?.name || r.userEmail).toLowerCase();
      const siteInfo = (r.siteName || r.siteId || '').toLowerCase();
      const ket = (r.keterangan || '').toLowerCase();
      const uid = r.id.toLowerCase();
      const statusLbl = getStatusLabel(r.status, r.userEmail).toLowerCase();

      return uid.includes(searchLower) ||
        reqName.includes(searchLower) ||
        r.userEmail.toLowerCase().includes(searchLower) ||
        siteInfo.includes(searchLower) ||
        ket.includes(searchLower) ||
        statusLbl.includes(searchLower);
    });

    return (
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in overflow-y-auto">
        <div className="bg-white w-full max-w-3xl rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden my-auto animate-scale-up">
          {/* Header */}
          <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-xs flex items-center justify-center text-indigo-300">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-base text-white">Daftar UID Aktif (Tim Bawahan)</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Menampilkan {subActiveRequestsFiltered.length} UID milik tim bawahan yang sedang berjalan
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsManagerActiveUidModalOpen(false)}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search Input */}
          <div className="p-4 bg-slate-50 border-b border-slate-200 shrink-0 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchManagerUidText}
                onChange={(e) => setSearchManagerUidText(e.target.value)}
                placeholder="Cari berdasarkan UID, nama pemohon, lokasi, keterangan..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
              />
            </div>
          </div>

          {/* List Content */}
          <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1 bg-slate-50/50">
            {subActiveRequestsFiltered.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 p-6">
                <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-700">Tidak ada UID aktif milik tim bawahan</p>
                <p className="text-xs text-slate-400 mt-1">
                  {searchManagerUidText ? 'Tidak ada data yang cocok dengan pencarian Anda.' : 'Seluruh pengajuan UID bawahan telah selesai (closed) atau belum ada pengajuan baru.'}
                </p>
              </div>
            ) : (
              subActiveRequestsFiltered.map((req) => {
                const reqProfile = profiles.find(p => p.email.toLowerCase() === req.userEmail.toLowerCase());
                const reqName = reqProfile?.nama || (reqProfile as any)?.name || req.userEmail.split('@')[0];
                const divisiText = formatDivisiSubDivisi(reqProfile?.divisi || req.divisi, reqProfile?.subDivisi || req.subDivisi);
                const isTalangan = req.id.startsWith('OPT-') || req.id.startsWith('BBMDS') || req.id.startsWith('BBM_DurenSawit') || req.tipePengajuan === 'DANA_TALANGAN';
                const nominal = req.managerActionAmount || req.jumlahPengajuan || req.nominalTotal || 0;

                return (
                  <div
                    key={req.id}
                    className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs hover:border-slate-300 transition-all flex flex-col gap-2.5"
                  >
                    {/* Top Row */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                          {req.id}
                        </span>
                        {isTalangan && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-pink-50 text-pink-700 border border-pink-200">
                            Dana Talangan
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400 font-medium">
                          {req.tanggalPengajuan || req.tanggal || '-'}
                        </span>
                      </div>
                      <div>{renderStatusBadge(req.status, req.userEmail)}</div>
                    </div>

                    {/* Subordinate info & Site */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                      <div>
                        <span className="text-[10px] font-semibold text-slate-400 block uppercase">Pemohon:</span>
                        <span className="font-bold text-slate-800">{reqName}</span>
                        <span className="text-slate-500 text-[11px] block">{req.userEmail}</span>
                        {divisiText && (
                          <span className="text-[10px] text-slate-400 font-medium block">{divisiText}</span>
                        )}
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold text-slate-400 block uppercase">Lokasi / Site:</span>
                        <span className="font-semibold text-slate-700">{req.siteName || req.siteId || '-'}</span>
                        {req.siteId && req.siteName && req.siteId !== req.siteName && (
                          <span className="text-[10px] text-slate-400 block">({req.siteId})</span>
                        )}
                      </div>
                    </div>

                    {/* Keterangan & Nominal */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 mt-1">
                      <div className="flex-1">
                        <span className="text-[10px] font-semibold text-slate-400 block uppercase">Keterangan:</span>
                        <p className="text-xs text-slate-700 font-medium line-clamp-2">
                          {req.keterangan || '-'}
                        </p>
                      </div>
                      <div className="text-left sm:text-right shrink-0">
                        <span className="text-[10px] font-semibold text-slate-400 block uppercase">Estimasi / Nominal:</span>
                        <span className="text-sm font-display font-bold text-indigo-600">
                          {formatIDR(nominal)}
                        </span>
                      </div>
                    </div>

                    {/* Collapsible Timeline Toggle & Component */}
                    {(() => {
                      const isExpanded = !!expandedManagerTimelines[req.id]; // Default minimized (false)
                      return (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedManagerTimelines(prev => ({
                                ...prev,
                                [req.id]: !isExpanded
                              }));
                            }}
                            className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-100/80 hover:bg-indigo-50/80 border border-slate-200/80 rounded-xl text-xs font-bold text-slate-700 hover:text-indigo-700 transition-all cursor-pointer group shadow-2xs"
                          >
                            <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-slate-700 group-hover:text-indigo-700">
                              <Clock className="w-3.5 h-3.5 text-indigo-600" />
                              <span>Timeline Proses Pengajuan</span>
                            </span>
                            <span className="flex items-center text-indigo-600">
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4 text-indigo-600" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-indigo-600" />
                              )}
                            </span>
                          </button>
                          {isExpanded && (
                            <OP_TimeLine
                              request={req}
                              histories={histories}
                              usageItems={usageItems}
                              profiles={profiles}
                              theme="light"
                              className="mt-1 animate-fade-in"
                            />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end shrink-0">
            <button
              type="button"
              onClick={() => setIsManagerActiveUidModalOpen(false)}
              className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition-all cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Reusable User Dashboard View for USER role or MANAGER/FINANCE Pengajuan Anggaran tab
  const renderUserDashboardView = () => {
    const {
      supervisorTitle,
      saldoOperasional,
      taskReportNeeded,
      taskCorrections,
      taskRejected,
      totalTasks,
      rejectedItemsInReportingCount,
      pendingApprCount,
      approvedWaitingTransfer,
      reportingCount,
      closedCount,
      rejectedCount,
      todayTransferredCount,
      todayTransferredTotal,
      todayActivitiesCount
    } = userDashboardStats!;

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
                  taskRejected > 0 ? `${taskRejected} pengajuan perlu revisi ${supervisorTitle}` : ''
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
                <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider">REVIEW</span>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Menunggu Approval</p>
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
              <p className="text-[9px] text-slate-400 mt-2 font-medium">Sedang dalam proses laporan / review</p>
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
            className={`p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-rose-300 hover:shadow-md ${
              activeFilter === 'REJECTED' ? 'border-rose-500 bg-rose-50/20 ring-2 ring-rose-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PENGAJUAN PERLU REVISI</p>
              <div className="flex items-end justify-between mt-2">
                <span className="text-3xl font-display font-bold text-rose-600">{rejectedCount} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                {rejectedCount > 0 ? (
                  <span className="text-[9px] font-extrabold text-white bg-rose-600 px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse flex items-center gap-1 shadow-xs">
                    <AlertTriangle className="w-2.5 h-2.5 text-white" />
                    Perlu Revisi ({rejectedCount})
                  </span>
                ) : (
                  <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Perlu Revisi</span>
                )}
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Diminta revisi. Klik untuk lihat, revisi & pembatalan</p>
          </div>

          {/* Card CARI SITE */}
          <div 
            onClick={() => {
              setIsSearchSiteModalOpen(true);
            }}
            className="p-5 rounded-2xl border shadow-sm flex flex-col justify-between transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md bg-white border-slate-200 group"
            id="cari-site-card"
          >
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PENCARIAN SITE</p>
              </div>
              <div className="flex items-center gap-2.5 mt-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-xs">
                  <Search className="w-4.5 h-4.5" />
                </div>
                <div>
                  <span className="text-xs font-display font-bold text-slate-900 group-hover:text-indigo-600 transition-colors block whitespace-nowrap">
                    CARI SITE
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium flex items-center justify-between">
              <span>Cari alamat site & Google Maps</span>
              <Navigation className="w-3.5 h-3.5 text-indigo-500 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </p>
          </div>
        </div>

        {/* Financial info Card - Saldo Operasional */}
        <div 
          onClick={() => setIsTransactionReportOpen(true)}
          className="bg-slate-900 hover:bg-slate-850 text-white rounded-2xl p-5 shadow-lg border border-slate-800 hover:border-emerald-500/50 hover:shadow-emerald-950/20 transition-all cursor-pointer group relative overflow-hidden"
          id="saldo-operasional-card"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase group-hover:text-emerald-300 transition-colors">SALDO OPERASIONAL</p>
            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1 shadow-2xs">
              <Eye className="w-3 h-3 text-emerald-400" /> Sisa Kas
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

          <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 font-medium">
            <span className="group-hover:text-slate-200 transition-colors flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              Klik untuk Laporan Transaksi User
            </span>
            <span className="text-[10px] font-bold text-emerald-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
              Lihat Detail &rarr;
            </span>
          </div>
        </div>

        {/* Kartu DAFTAR TRANSFER - ROLE USER */}
        {onOpenTransferList && (
          <div 
            onClick={onOpenTransferList}
            id="user-transfer-list-card"
            className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-emerald-400 hover:shadow-md group ${
              activeFilter === 'TRANSFER_LIST' ? 'border-emerald-500 bg-emerald-100/40 ring-2 ring-emerald-500/20' : 'bg-emerald-50/40 border-emerald-200/80 hover:bg-emerald-50/70'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold text-emerald-800/70 uppercase tracking-widest">DAFTAR TRANSFER</p>
                <h4 className="font-display font-black text-slate-800 text-xs mt-1 group-hover:text-emerald-700 transition-colors">List Transfer UID</h4>
              </div>
            </div>

            <div className="flex items-end justify-between mt-3">
              <div>
                <span className="text-3xl font-display font-bold text-slate-900 block">
                  {todayTransferredCount} <span className="text-xs text-slate-400 font-normal">UID Hari Ini</span>
                </span>
                <p className="text-[11px] font-bold text-emerald-600 mt-0.5">
                  Total: {formatIDR(todayTransferredTotal)}
                </p>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 mt-2.5 font-medium border-t border-emerald-100/80 pt-2">
              Lihat daftar pengajuan UID yang telah ditransfer dana oleh Finance beserta rincian bukti transfer.
            </p>
          </div>
        )}

        {/* Modal Laporan Transaksi Saldo Operasional User */}
        {isTransactionReportOpen && (
          <Suspense fallback={null}>
            <UserOperationalBalanceReportModal
              isOpen={isTransactionReportOpen}
              onClose={() => setIsTransactionReportOpen(false)}
              userProfile={userProfile}
              userEmail={email}
              requests={requests}
              usageItems={usageItems}
              histories={histories}
              profiles={profiles}
              role={role}
            />
          </Suspense>
        )}

        {/* Modal CARI SITE */}
        {isSearchSiteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/80 backdrop-blur-xs overflow-y-auto">
            <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in fade-in zoom-in-95 duration-150">
              {/* Header Modal */}
              <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 border-b border-indigo-500/30 shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-2xl bg-white/20 border border-white/30 backdrop-blur-xs flex items-center justify-center text-white shrink-0 shadow-md">
                    <MapPin className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-sm sm:text-base text-white tracking-wide truncate">
                      Pencarian Site & Navigasi Lokasi
                    </h3>
                    <p className="text-[11px] text-indigo-100 font-medium mt-0.5 truncate">
                      Masukkan Site ID untuk alamat lengkap & rute Google Maps
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSearchSiteModalOpen(false)}
                  className="w-9 h-9 rounded-2xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-all cursor-pointer shrink-0"
                  title="Tutup Modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body Modal */}
              <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1">
                {/* Search Form */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Form Pencarian Site ID
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={searchSiteIdInput}
                      onChange={(e) => setSearchSiteIdInput(e.target.value)}
                      placeholder="Masukkan atau ketik Site ID (contoh: JKT-SOUTH-02)..."
                      className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-300 rounded-2xl text-xs text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                      autoFocus
                    />
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    {searchSiteIdInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchSiteIdInput('');
                          setSelectedSite(null);
                        }}
                        className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Result Section */}
                {selectedSite ? (
                  <div className="bg-slate-50 border border-indigo-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
                      <div>
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md">
                          SITE DITEMUKAN
                        </span>
                        <h4 className="font-display font-bold text-slate-900 text-base mt-1">
                          {selectedSite.siteName || selectedSite.siteId}
                        </h4>
                        <p className="text-xs text-slate-500 font-mono font-semibold mt-0.5">
                          ID: <span className="text-slate-800">{selectedSite.siteId}</span>
                        </p>
                      </div>
                      <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                        <MapPin className="w-5 h-5" />
                      </div>
                    </div>

                    {/* Address corresponding to coordinates */}
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Alamat Sesuai Koordinat Site:
                      </p>
                      <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-700 font-medium min-h-[50px] flex items-center">
                        {isGeocodingSite ? (
                          <div className="flex items-center gap-2 text-indigo-600 font-semibold animate-pulse">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Mencari alamat lokasi dari koordinat GPS...</span>
                          </div>
                        ) : geocodedAddress ? (
                          <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                            <span className="leading-relaxed text-slate-800 font-medium">
                              {geocodedAddress}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Alamat tidak dapat dimuat.</span>
                        )}
                      </div>
                    </div>

                    {/* Link Direction Clickable to Google Maps */}
                    {selectedSite.coordinates && (
                      <div className="pt-2">
                        <a
                          href={getGoogleMapsDirectionUrl(selectedSite)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-indigo-200 cursor-pointer"
                        >
                          <Navigation className="w-4 h-4 text-white" />
                          <span>Google Maps Direction</span>
                          <ExternalLink className="w-3.5 h-3.5 text-indigo-200" />
                        </a>
                      </div>
                    )}
                  </div>
                ) : searchSiteIdInput.trim() ? (
                  <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-2">
                    <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
                    <h5 className="font-bold text-xs text-slate-800">
                      Site ID "{searchSiteIdInput}" Tidak Ditemukan
                    </h5>
                    <p className="text-[11px] text-slate-500">
                      Silakan periksa kembali Site ID yang Anda ketik.
                    </p>
                  </div>
                ) : (
                  <div className="p-6 bg-slate-50 border border-slate-200/80 rounded-2xl text-center space-y-2">
                    <Search className="w-8 h-8 text-indigo-400 mx-auto" />
                    <h5 className="font-bold text-xs text-slate-700">
                      Silakan Isikan Site ID
                    </h5>
                    <p className="text-[11px] text-slate-400">
                      Sistem akan menampilkan alamat lokasi lengkap dan tombol rute navigasi Google Maps secara langsung.
                    </p>
                  </div>
                )}
              </div>

              {/* Footer Modal */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setIsSearchSiteModalOpen(false)}
                  className="px-5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition-all cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}



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
  };

  if (role === Role.USER) {
    return renderUserDashboardView();
  }  if (role === Role.MANAGER) {
    const {
      pendingBudgetReview,
      pendingReportReview,
      totalApprovalTasks,
      totalUserTasks,
      teamPendingAppr,
      teamUnderReview,
      subActiveCount,
      todayTeamActivitiesCount
    } = managerDashboardStats!;

    return (
      <div className="space-y-4">
        {/* Dual Tab Switcher for MANAGER */}
        <div className="bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200/80 flex items-center gap-1.5 shadow-xs">
          <button
            type="button"
            onClick={() => handleTabChange('APPROVAL')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              currentTab === 'APPROVAL'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <ShieldCheck className={`w-4 h-4 ${currentTab === 'APPROVAL' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>APPROVAL</span>
            {totalApprovalTasks > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                currentTab === 'APPROVAL'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-rose-100 text-rose-700'
              }`}>
                {totalApprovalTasks}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('SUBMISSION')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              currentTab === 'SUBMISSION'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <FileText className={`w-4 h-4 ${currentTab === 'SUBMISSION' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>PENGAJUAN</span>
            {totalUserTasks > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                currentTab === 'SUBMISSION'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>
                {totalUserTasks}
              </span>
            )}
          </button>
        </div>

        {currentTab === 'APPROVAL' ? (
          <div className="space-y-4">
            {/* Urgent Task Card */}
            {totalApprovalTasks > 0 ? (
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-700 shrink-0">
                  <ClipboardCheck className="w-5.5 h-5.5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-indigo-900 text-xs tracking-wide uppercase">TUGAS PERSETUJUAN ({totalApprovalTasks})</h3>
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
                  <p className="text-[9px] text-slate-400 mt-2 font-medium">Berisi UID yang telah ditransfer Finance dan dilaporkan penggunannya oleh User (termasuk Laporan Dana Talangan User)</p>
                </div>
              </div>
            </div>

            {/* Kartu UID AKTIF - MANAGER */}
            <div 
              onClick={() => setIsManagerActiveUidModalOpen(true)}
              className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer flex items-center justify-between"
              id="manager-active-uid-card"
            >
              <div>
                <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">UID AKTIF (TIM BAWAHAN)</p>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="text-3xl font-display font-bold text-slate-900">{subActiveCount}</span>
                  <span className="text-xs text-slate-500 font-medium">UID Aktif</span>
                </div>
                <p className="text-[9px] text-slate-400 mt-1 font-medium">Klik untuk melihat daftar UID milik bawahan yang masih aktif.</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                <FolderOpen className="w-6 h-6" />
              </div>
            </div>

            {/* Kartu Activity User - MANAGER */}
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

            {/* Kartu Monitoring UID User Murni - MANAGER */}
            <div 
              onClick={onOpenUserUidMonitoring || (() => setIsUserUidMonitoringModalOpen(true))}
              id="manager-user-uid-monitoring-card"
              className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer flex items-center justify-between"
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">MONITORING TIM BAWAHAN</p>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                    userMurniMonitoringStats.blockedCount > 0
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    {userMurniMonitoringStats.blockedCount > 0 ? `${userMurniMonitoringStats.blockedCount} Dibatasi` : 'Normal'}
                  </span>
                </div>
                <h4 className="font-display font-bold text-xs text-slate-800 mt-1">Daftar UID Belum Dilaporkan User Murni</h4>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Pengawasan UID yang sudah ditransfer dan pemblokiran pengajuan (&gt; 1 UID).
                </p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
            </div>

            {renderBbmCard()}
          </div>
        ) : (
          renderUserDashboardView()
        )}

        {renderManagerActiveUidModal()}

        {/* Modal Monitoring UID User Murni */}
        {isUserUidMonitoringModalOpen && (
          <Suspense fallback={null}>
            <UserUidMonitoringModal
              isOpen={isUserUidMonitoringModalOpen}
              onClose={() => setIsUserUidMonitoringModalOpen(false)}
              profiles={profiles || []}
              requests={requests}
              usageItems={usageItems}
              currentRole={role}
              currentUserEmail={email}
            />
          </Suspense>
        )}
      </div>
    );
  }

  // Finance stats
  if (role === Role.FINANCE) {
    const {
      pendingFinanceBudgetReview,
      pendingFinanceBudgetReviewAmount,
      pendingTransfer,
      pendingTransferAmount,
      pendingAdminReportReview,
      totalApprovalTasks,
      totalTasks,
      totalUserTasks,
      closedCount,
      financeRejectedCount,
      totalTransferred,
      totalClosed,
      unbalancedUsersCount,
      totalAdjustmentNominalNeeded,
      todayTransferredCount,
      todayTransferredTotal,
      todayBbmCount,
      todayBbmTotal,
      todayAllActivitiesCount
    } = financeDashboardStats!;

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
        {/* Dual Tab Switcher for FINANCE */}
        <div className="bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200/80 flex items-center gap-1.5 shadow-xs">
          <button
            type="button"
            onClick={() => handleTabChange('APPROVAL')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              currentTab === 'APPROVAL'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <ShieldCheck className={`w-4 h-4 ${currentTab === 'APPROVAL' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>APPROVAL</span>
            {totalApprovalTasks > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                currentTab === 'APPROVAL'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-rose-100 text-rose-700'
              }`}>
                {totalApprovalTasks}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('SUBMISSION')}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              currentTab === 'SUBMISSION'
                ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <FileText className={`w-4 h-4 ${currentTab === 'SUBMISSION' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>PENGAJUAN</span>
            {totalUserTasks > 0 && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                currentTab === 'SUBMISSION'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>
                {totalUserTasks}
              </span>
            )}
          </button>
        </div>

        {currentTab === 'APPROVAL' ? (
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
                Ada {pendingFinanceBudgetReview} pengajuan anggaran menunggu Tinjauan Finance, {pendingTransfer} pengajuan menunggu Transfer Dana, dan {pendingAdminReportReview} laporan operasional menunggu Tinjauan Finansial Anda.
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

        {/* Stats Cards Grid for Finance */}
        <div className="grid grid-cols-2 gap-4">
          <div 
            onClick={() => handleCardClick('PENDING')}
            className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'PENDING' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">REVIEW PENGAJUAN</p>
            <div className="mt-2">
              <span className="text-3xl font-display font-bold text-slate-900">{pendingFinanceBudgetReview} <span className="text-xs text-slate-400 font-normal">UID</span></span>
              <p className="text-xs font-bold text-indigo-700 mt-1">{formatIDR(pendingFinanceBudgetReviewAmount)}</p>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Pengajuan Anggaran yang perlu persetujuan</p>
          </div>

          <div 
            onClick={() => handleCardClick('APPROVED')}
            className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-300 hover:shadow-md ${
              activeFilter === 'APPROVED' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
            }`}
          >
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">BELUM DITRANSFER</p>
            <div className="mt-2">
              <span className="text-3xl font-display font-bold text-slate-900">{pendingTransfer} <span className="text-xs text-slate-400 font-normal">UID</span></span>
              <p className="text-xs font-bold text-amber-700 mt-1">{formatIDR(pendingTransferAmount)}</p>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 font-medium">Pengajuan siap diproses transfer dana</p>
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

          {onOpenActivities && (
            <div 
              onClick={onOpenActivities}
              id="finance-activity-card"
              className="p-5 rounded-2xl border border-indigo-200/90 bg-gradient-to-br from-indigo-50/70 via-white to-sky-50/40 shadow-sm transition-all cursor-pointer hover:border-indigo-400 hover:shadow-md active:scale-[0.99] group flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-indigo-800 uppercase tracking-widest flex items-center gap-1">
                  <CalendarCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>LOG KEGIATAN OPERASIONAL</span>
                </p>
                <span className="text-[9px] font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Hari Ini
                </span>
              </div>

              <div className="flex items-end justify-between mt-2">
                <div>
                  <span className="text-3xl font-display font-bold text-slate-900">{todayAllActivitiesCount} <span className="text-xs text-slate-400 font-normal">Log</span></span>
                  <p className="text-[10px] font-bold text-indigo-600 mt-0.5">Lihat Aktivitas &amp; Foto Lapangan &rarr;</p>
                </div>
              </div>
            </div>
          )}

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
                <div>
                  <span className="text-3xl font-display font-bold text-slate-900">
                    {unbalancedUsersCount} <span className="text-xs text-slate-400 font-normal">User</span>
                  </span>
                  <div className="text-[11px] font-bold text-indigo-600 font-mono mt-1">
                    Total Nominal Adjustment: {formatIDR(totalAdjustmentNominalNeeded)}
                  </div>
                </div>
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

          {onOpenTransferList && (
            <div 
              onClick={onOpenTransferList}
              id="finance-transfer-list-card"
              className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-indigo-400 hover:shadow-md col-span-2 group ${
                activeFilter === 'TRANSFER_LIST' ? 'border-indigo-500 bg-indigo-50/20 ring-2 ring-indigo-500/20' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">DAFTAR TRANSFER</p>
                  <h4 className="font-display font-black text-slate-800 text-xs mt-1 group-hover:text-indigo-600 transition-colors">List Transfer UID</h4>
                </div>
                <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Finance Direct
                </span>
              </div>

              <div className="flex items-end justify-between mt-3">
                <div>
                  <span className="text-3xl font-display font-bold text-slate-900 block">
                    {todayTransferredCount} <span className="text-xs text-slate-400 font-normal">UID Hari Ini</span>
                  </span>
                  <p className="text-[11px] font-bold text-indigo-600 mt-0.5">
                    Total: {formatIDR(todayTransferredTotal)}
                  </p>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 mt-2.5 font-medium border-t border-slate-100 pt-2">
                Lihat daftar pengajuan UID yang telah ditransfer dana oleh Finance beserta rincian bukti transfer.
              </p>
            </div>
          )}

          {/* Kartu Monitoring UID User Murni - FINANCE */}
          <div 
            onClick={onOpenUserUidMonitoring || (() => setIsUserUidMonitoringModalOpen(true))}
            id="finance-user-uid-monitoring-card"
            className="p-5 rounded-2xl border border-slate-200 bg-white shadow-sm transition-all cursor-pointer hover:border-indigo-400 hover:shadow-md col-span-2 group"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">KONTROL &amp; PENGAWASAN</p>
                <h4 className="font-display font-black text-slate-800 text-xs mt-1 group-hover:text-indigo-600 transition-colors">
                  Monitoring UID User Murni
                </h4>
              </div>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                userMurniMonitoringStats.blockedCount > 0
                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}>
                {userMurniMonitoringStats.blockedCount > 0 ? `${userMurniMonitoringStats.blockedCount} User Dibatasi` : 'All Clear'}
              </span>
            </div>

            <div className="flex items-end justify-between mt-3">
              <div>
                <span className="text-3xl font-display font-bold text-slate-900 block">
                  {userMurniMonitoringStats.totalUnreportedCount} <span className="text-xs text-slate-400 font-normal">UID Belum Lapor</span>
                </span>
                <p className="text-[11px] font-bold text-rose-600 mt-0.5">
                  {userMurniMonitoringStats.blockedCount} User Murni memiliki &gt; 1 UID belum dilaporkan
                </p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
                <ShieldAlert className="w-5.5 h-5.5" />
              </div>
            </div>

            <p className="text-[10px] text-slate-400 mt-2.5 font-medium border-t border-slate-100 pt-2">
              Klik untuk membuka form Daftar User Murni, status UID yang sudah ditransfer dan pembatasan pengajuan baru.
            </p>
          </div>

          {/* Kartu Pintasan: Tabel Response Waktu Pengajuan & Transfer - FINANCE */}
          {(() => {
            const financeOpBiasaCount = requests.reduce(
              (acc, r) => (r.id && r.id.startsWith('OP-') && !r.id.startsWith('OPT-') ? acc + 1 : acc),
              0
            );
            return (
              <div
                id="finance-response-time-shortcut-card"
                onClick={() => {
                  if (onOpenResponseTimeTable) {
                    onOpenResponseTimeTable();
                  } else {
                    setIsResponseTimeModalOpen(true);
                  }
                }}
                className="p-5 rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50/90 via-white to-emerald-50/60 shadow-md hover:shadow-lg hover:border-teal-400 transition-all cursor-pointer group flex items-center justify-between gap-4 select-none col-span-2"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (onOpenResponseTimeTable) {
                      onOpenResponseTimeTable();
                    } else {
                      setIsResponseTimeModalOpen(true);
                    }
                  }
                }}
                title="Klik untuk membuka Tabel Response Waktu Pengajuan & Transfer (SLA)"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-700 text-white flex items-center justify-center shrink-0 shadow-md shadow-teal-200 group-hover:scale-105 transition-transform">
                    <Clock className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-teal-600 transition-colors">
                        Tabel Response Waktu Pengajuan &amp; Transfer
                      </h3>
                      <span className="text-[9px] font-bold bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full border border-teal-200 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-teal-600" />
                        SLA Timeline
                      </span>
                      <span className="text-[9px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                        {financeOpBiasaCount} UID (OP-)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="hidden sm:inline-block text-xs font-semibold text-teal-700 group-hover:text-teal-900 transition-colors">
                    Buka Tabel
                  </span>
                  <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
                    &rarr;
                  </div>
                </div>
              </div>
            );
          })()}

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
    ) : (
      renderUserDashboardView()
    )}

    {/* Modal Monitoring UID User Murni */}
    {isUserUidMonitoringModalOpen && (
      <Suspense fallback={null}>
        <UserUidMonitoringModal
          isOpen={isUserUidMonitoringModalOpen}
          onClose={() => setIsUserUidMonitoringModalOpen(false)}
          profiles={profiles || []}
          requests={requests}
          usageItems={usageItems}
          currentRole={role}
          currentUserEmail={email}
        />
      </Suspense>
    )}

    {/* Modal Response Time Table (Finance Fallback) */}
    {isResponseTimeModalOpen && (
      <Suspense fallback={null}>
        <AdminResponseTimeModal
          isOpen={isResponseTimeModalOpen}
          onClose={() => setIsResponseTimeModalOpen(false)}
          requests={requests}
          usageItems={usageItems}
          histories={histories}
          profiles={profiles}
        />
      </Suspense>
    )}
  </div>
);
}

  // Compute stats for ADMINISTRATOR role
  if (role === Role.ADMINISTRATOR) {
    const {
      totalUsers,
      staffCount,
      managerCount,
      financeCount,
      direkturCount,
      adminCount,
      mobileBindingCount,
      activeSubsUsersCount,
      todayBbmCount,
      todayBbmTotal,
      opBiasaCount,
      todayStr
    } = adminDashboardStats!;

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

        {/* Shortcut Card: Intip Dashboard & Status UID User */}
        {onOpenUserDashboardPreview && (
          <div
            onClick={onOpenUserDashboardPreview}
            className="p-5 rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50/90 via-white to-indigo-50/60 shadow-md hover:shadow-lg hover:border-purple-400 transition-all cursor-pointer group flex items-center justify-between gap-4"
            id="admin-preview-user-dashboard-card"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-purple-200 group-hover:scale-105 transition-transform">
                <Eye className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-purple-600 transition-colors flex items-center gap-2">
                  Pintasan Dashboard &amp; Status UID User
                </h3>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Pilih akun pengguna untuk melihat statistik, saldo operasional, task &amp; status UID sama seperti user terpilih.
                </p>
              </div>
            </div>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
              &rarr;
            </div>
          </div>
        )}

        {/* Administrator Kartu Pintasan: Tabel Response Waktu Pengajuan & Transfer */}
        <div
          id="admin-response-time-shortcut-card"
          onClick={() => {
            if (onOpenResponseTimeTable) {
              onOpenResponseTimeTable();
            } else {
              setIsResponseTimeModalOpen(true);
            }
          }}
          className="p-5 rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50/90 via-white to-emerald-50/60 shadow-md hover:shadow-lg hover:border-teal-400 transition-all cursor-pointer group flex items-center justify-between gap-4 select-none"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (onOpenResponseTimeTable) {
                onOpenResponseTimeTable();
              } else {
                setIsResponseTimeModalOpen(true);
              }
            }
          }}
          title="Klik untuk membuka Tabel Response Waktu Pengajuan & Persetujuan (SLA)"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-700 text-white flex items-center justify-center shrink-0 shadow-md shadow-teal-200 group-hover:scale-105 transition-transform">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-teal-600 transition-colors">
                  Tabel Response Waktu Pengajuan &amp; Transfer
                </h3>
                <span className="text-[9px] font-bold bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full border border-teal-200 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-teal-600" />
                  SLA Timeline
                </span>
                <span className="text-[9px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                  {opBiasaCount} UID (OP-)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline-block text-xs font-semibold text-teal-700 group-hover:text-teal-900 transition-colors">
              Buka Tabel
            </span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
              &rarr;
            </div>
          </div>
        </div>

        {/* Administrator Kartu Pintasan: Penerima Sharing Nota BRImo */}
        {onOpenSharedReceipt && (
          <div
            id="admin-brimo-shared-receipt-card"
            onClick={onOpenSharedReceipt}
            className="p-5 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/90 via-white to-indigo-50/60 shadow-md hover:shadow-lg hover:border-blue-400 transition-all cursor-pointer group flex items-center justify-between gap-4 select-none"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenSharedReceipt();
              }
            }}
            title="Klik untuk membuka Form Penerima Sharing Nota BRImo"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-200 group-hover:scale-105 transition-transform">
                <Share2 className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-blue-600 transition-colors">
                    Penerima Sharing Nota BRImo
                  </h3>
                  <span className="text-[9px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full border border-blue-200">
                    BRImo Share Target
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium mt-1">
                  Buka form penerima dan pencocokan bukti transfer / resi yang dibagikan dari aplikasi BRImo ke pengajuan atau adjustment.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-block text-xs font-semibold text-blue-700 group-hover:text-blue-900 transition-colors">
                Buka Form
              </span>
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
                &rarr;
              </div>
            </div>
          </div>
        )}

        {/* Administrator Kartu Monitoring UID User Murni */}
        <div 
          id="admin-user-uid-monitoring-card"
          className="p-4 sm:p-5 rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
              <ShieldAlert className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-slate-900 text-sm">
                  Monitoring UID User Murni
                </h3>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                  userMurniMonitoringStats.blockedCount > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {userMurniMonitoringStats.blockedCount} Dibatasi
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium mt-1">
                Daftar status UID yang sudah ditransfer dan belum dilaporkan sama sekali (&gt; 1 UID diblokir).
              </p>
            </div>
          </div>

          <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-end">
            <button
              type="button"
              onClick={onOpenUserUidMonitoring || (() => setIsUserUidMonitoringModalOpen(true))}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-indigo-700 text-xs font-bold transition-all cursor-pointer border border-indigo-200/80 shadow-2xs"
            >
              <span>Buka Form</span>
              <span className="font-bold text-xs">&rarr;</span>
            </button>
          </div>
        </div>

        {/* Administrator Kartu Blast Notifikasi */}
        {onOpenPushTest && (
          <div
            id="admin-blast-notification-card"
            onClick={onOpenPushTest}
            className="p-5 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/90 via-white to-indigo-50/50 shadow-md hover:shadow-lg hover:border-sky-400 transition-all cursor-pointer group flex items-center justify-between gap-4 select-none"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenPushTest();
              }
            }}
            title="Klik untuk membuka Form Blast Notifikasi Pengguna"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-sky-200 group-hover:scale-105 transition-transform">
                <BellRing className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-sky-600 transition-colors">
                    Kartu Blast Notifikasi
                  </h3>
                  <span className="text-[9px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                    <Smartphone className="w-3 h-3 text-emerald-600" />
                    {activeSubsUsersCount} Akun Terhubung
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 font-medium mt-1">
                  Kirimkan pesan blast push notifikasi ke satu, beberapa, atau seluruh user pilihan dalam sistem.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-block text-xs font-semibold text-sky-700 group-hover:text-sky-900 transition-colors">
                Buka Form Blast
              </span>
              <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
                &rarr;
              </div>
            </div>
          </div>
        )}

        {/* Administrator Kartu Tools Database (Backup & Switch Database) */}
        <Suspense fallback={null}>
          <AdminDatabaseToolsCard
            token={token}
            spreadsheetId={spreadsheetId}
            driveFolderId={driveFolderId}
            adminEmail={email}
            onConfigUpdated={onConfigUpdated}
          />
        </Suspense>

        {/* Administrator Kartu Migrasi Kepemilikan Foto Google Drive */}
        <Suspense fallback={null}>
          <AdminPhotoMigrationCard
            token={token}
            adminEmail={email}
          />
        </Suspense>

        {/* Administrator Kartu Manual Activity Report (Input Kegiatan Susulan) */}
        {onSaveManualActivity && (
          <div
            onClick={() => setIsManualActivityModalOpen(true)}
            className="p-5 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/90 via-white to-blue-50/60 shadow-md hover:shadow-lg hover:border-indigo-400 transition-all cursor-pointer group flex items-center justify-between gap-4"
            id="admin-manual-activity-report-card"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-200 group-hover:scale-105 transition-transform">
                <CalendarCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-indigo-600 transition-colors">
                    Manual Activity Report
                  </h3>
                </div>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Input susulan foto & log kegiatan harian untuk staf/pengguna yang berhalangan atau lupa mengambil data di lapangan.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-block text-xs font-semibold text-indigo-700 group-hover:text-indigo-900 transition-colors">
                Buka Form
              </span>
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
                &rarr;
              </div>
            </div>
          </div>
        )}

        {/* Card: Reopen UID (Mengubah status CLOSED menjadi REPORTING) */}
        <div
          onClick={() => setIsReopenUidModalOpen(true)}
          className="p-5 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/90 via-white to-orange-50/50 shadow-md hover:shadow-lg hover:border-amber-400 transition-all cursor-pointer group flex items-center justify-between gap-4"
          id="admin-reopen-uid-card"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-amber-200 group-hover:scale-105 transition-transform">
              <RotateCcw className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-amber-600 transition-colors">
                Reopen UID
              </h3>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                Buka kembali status UID CLOSED menjadi REPORTING khusus UID Pengajuan (prefix OP-).
              </p>
            </div>
          </div>
          <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
            &rarr;
          </div>
        </div>

        {/* Card: Pembersihan Orphan Data (ItemReviewHistory) */}
        {onPurgeOrphanHistories && (
          <div
            className="p-4 sm:p-5 rounded-2xl border border-rose-100 bg-white shadow-sm flex flex-col gap-3 transition-all"
            id="admin-orphan-cleanup-card"
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-display font-bold text-slate-800 text-sm flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>Pembersihan Orphan Data (ItemReviewHistory)</span>
                </h3>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Hapus baris riwayat review yang tidak memiliki referensi Pengajuan/Laporan valid.
                </p>
              </div>

              {!showPurgeConfirm && (
                <button
                  type="button"
                  onClick={() => { setPurgeMsg(null); setShowPurgeConfirm(true); }}
                  disabled={isPurging}
                  className="py-2 px-3.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shrink-0 shadow-sm"
                  id="btn-admin-bersihkan-orphan-data"
                >
                  <Trash2 className="w-4 h-4 text-rose-600" />
                  <span>Bersihkan Orphan Data</span>
                </button>
              )}
            </div>

            {/* Confirmation prompt */}
            {showPurgeConfirm && (
              <div className="p-3 bg-rose-50/90 border border-rose-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 animate-fade-in">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="text-slate-700 font-medium text-xs">
                    Konfirmasi: Yakin ingin membersihkan data <code className="font-mono text-rose-700 font-bold">ItemReviewHistory</code> orphan?
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowPurgeConfirm(false)}
                    disabled={isPurging}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={handlePurgeOrphan}
                    disabled={isPurging}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
                  >
                    {isPurging ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Membersihkan...</span>
                      </>
                    ) : (
                      <span>Lanjutkan</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Result / notification message */}
            {purgeMsg && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center justify-between gap-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-medium">{purgeMsg}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPurgeMsg(null)}
                  className="text-emerald-600 hover:text-emerald-800 text-xs font-bold px-1.5 py-0.5 rounded cursor-pointer"
                >
                  &times;
                </button>
              </div>
            )}
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

        {/* Kartu BBM Duren Sawit (Administrator) */}
        <div 
          onClick={onOpenBbmListModal || onOpenBbmModal}
          className="bg-gradient-to-r from-amber-500/10 via-amber-50/80 to-orange-50/80 border border-amber-200/90 rounded-2xl p-4 shadow-sm hover:border-amber-400 hover:shadow-md transition-all cursor-pointer flex items-center justify-between gap-3 group"
          id="administrator-bbm-card"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-amber-200/60 group-hover:scale-105 transition-transform">
              <Fuel className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-display font-bold text-xs text-slate-800 group-hover:text-amber-900 transition-colors">
                  Pengisian BBM Duren Sawit
                </h4>
                <span className="text-[9px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Seluruh UID
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                Pengisian hari ini ({todayStr}): <span className="font-bold text-slate-800">{todayBbmCount} transaksi ({formatIDR(todayBbmTotal)})</span>. Klik untuk lihat daftar &amp; filter tanggal.
              </p>
            </div>
          </div>
          <div className="w-8 h-8 rounded-xl bg-amber-100/80 text-amber-800 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
            &rarr;
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

        {/* Modal Cek GPS Perangkat */}
        {isGpsModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
              {/* Header Modal */}
              <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 text-white p-5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-emerald-300" />
                  </div>
                  <div>
                    <h3 className="text-base font-display font-bold text-white flex items-center gap-2">
                      Diagnostik &amp; Form Parameter GPS
                      <span className="text-[9px] font-bold bg-emerald-500/30 text-emerald-200 px-2 py-0.5 rounded-full border border-emerald-400/30 uppercase tracking-wider">
                        Monitoring Berulang Aktif
                      </span>
                    </h3>
                    <p className="text-[11px] text-emerald-200 mt-0.5">
                      Pengecekan GPS otomatis berjalan berulang sampai Anda menekan tombol Keluar / Kembali
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsGpsModalOpen(false)}
                    className="px-3.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-400/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Keluar / Kembali"
                  >
                    <ArrowLeft className="w-4 h-4 text-rose-300" />
                    <span className="hidden sm:inline">Keluar / Kembali</span>
                  </button>
                  <button
                    onClick={() => setIsGpsModalOpen(false)}
                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Status Banner Pengecekan Berulang */}
              <div className="bg-emerald-900/10 border-b border-emerald-200/60 px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-900 font-medium">
                  {isAutoGpsActive ? (
                    <>
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600"></span>
                      </span>
                      <span className="font-bold">Pengecekan GPS Berulang Sedang Aktif</span>
                      <span className="text-[11px] text-emerald-700 font-mono hidden sm:inline">(Refresh otomatis tiap ~2.5 detik)</span>
                    </>
                  ) : (
                    <>
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500 inline-block"></span>
                      <span className="font-bold text-amber-900">Pengecekan Dijeda</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="bg-emerald-100 text-emerald-800 font-extrabold px-2 py-0.5 rounded-full font-mono">
                    Total Cek: {gpsUpdateCount}x
                  </span>
                </div>
              </div>

              {/* Body Content */}
              <div className="p-5 overflow-y-auto space-y-4">
                {isFetchingGpsModal && !gpsModalPosition ? (
                  <div className="py-12 text-center space-y-3">
                    <Loader2 className="w-10 h-10 text-emerald-600 animate-spin mx-auto" />
                    <div>
                      <h4 className="text-sm font-bold text-slate-800 font-display">Meminta Sinyal &amp; Parameter GPS...</h4>
                      <p className="text-xs text-slate-400 mt-1">Mengakses sensor Geolocation API dari perangkat ini</p>
                    </div>
                  </div>
                ) : gpsModalError && !gpsModalPosition ? (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 space-y-3">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-bold text-rose-900">Gagal Mengambil Lokasi GPS</h4>
                        <p className="text-xs text-rose-700 mt-1 font-medium">{gpsModalError}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={fetchGpsDataManual}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Coba Ulangi Cek GPS
                      </button>
                      <button
                        onClick={() => setIsGpsModalOpen(false)}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-all cursor-pointer"
                      >
                        Keluar / Kembali
                      </button>
                    </div>
                  </div>
                ) : gpsModalPosition ? (() => {
                  const coords = gpsModalPosition.coords;
                  const lat = coords.latitude;
                  const lng = coords.longitude;
                  const acc = coords.accuracy;
                  const altitude = coords.altitude;
                  const altAcc = coords.altitudeAccuracy;
                  const heading = coords.heading;
                  const speed = coords.speed;
                  const timestamp = gpsModalPosition.timestamp;
                  const fakeCheck = detectFakeGps(gpsModalPosition, '', prevGpsModalPosition, gpsUpdateCount);

                  const latLngStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

                  const isHighAcc = acc <= 15;
                  const isMedAcc = acc > 15 && acc <= 50;

                  return (
                    <div className="space-y-4">
                      {/* Top Quick Status Badges */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">IZIN GPS BROWSER</span>
                          <span className={`inline-block text-[10px] font-extrabold mt-1 px-2 py-0.5 rounded-full uppercase ${
                            permissionState.toLowerCase() === 'granted' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}>
                            {permissionState}
                          </span>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">TINGKAT AKURASI</span>
                          <span className={`inline-block text-[10px] font-extrabold mt-1 px-2 py-0.5 rounded-full ${
                            isHighAcc ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : isMedAcc ? 'bg-blue-100 text-blue-800 border border-blue-200' : 'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {isHighAcc ? 'Tinggi (< 15m)' : isMedAcc ? 'Sedang (15-50m)' : 'Rendah (> 50m)'}
                          </span>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">SKOR VALIDITAS HARDWARE</span>
                          <span className={`inline-block text-[10px] font-extrabold mt-1 px-2 py-0.5 rounded-full uppercase ${
                            fakeCheck.overallScore >= 80 ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : fakeCheck.overallScore >= 60 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-rose-100 text-rose-800 border border-rose-200'
                          }`}>
                            {fakeCheck.overallScore} / 100 ({fakeCheck.isFake ? 'Indikasi Fake' : 'Valid Hardware'})
                          </span>
                        </div>

                        <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">UPDATE TERAKHIR</span>
                          <span className="text-xs font-bold font-mono text-emerald-700 mt-1 block">
                            {lastGpsCheckTime ? lastGpsCheckTime.toLocaleTimeString('id-ID') : '-'}
                          </span>
                        </div>
                      </div>

                      {/* Card Evaluasi Kombinasi 3 Parameter Fake GPS */}
                      {fakeCheck.evaluations && (
                        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white p-4 rounded-2xl shadow-md border border-slate-700 space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-700 pb-2.5">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4 text-emerald-400" />
                              <h4 className="text-xs font-bold text-white font-display uppercase tracking-wider">
                                Metode Evaluasi Fake GPS System (3 Parameter Hardware)
                              </h4>
                            </div>
                            <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase ${
                              fakeCheck.isFake ? 'bg-rose-500/20 text-rose-300 border border-rose-400/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                            }`}>
                              {fakeCheck.isFake ? 'Terdeteksi Anomali' : 'Terverifikasi Asli'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                            {/* Parameter 1: Timestamp Hardware */}
                            {(() => {
                              const ts = fakeCheck.evaluations.timestamp;
                              return (
                                <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 flex flex-col justify-between">
                                  <div>
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-tight">
                                        1. Timestamp Hardware
                                      </span>
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                        ts.status === 'VALID' ? 'bg-emerald-500/20 text-emerald-300' : ts.status === 'WARNING' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                                      }`}>
                                        {ts.status} ({ts.score}%)
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-mono font-bold text-emerald-300">{ts.detailValue}</p>
                                    <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{ts.analysisNote}</p>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Parameter 2: Akurasi Radius */}
                            {(() => {
                              const acc = fakeCheck.evaluations.accuracy;
                              return (
                                <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 flex flex-col justify-between">
                                  <div>
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-tight">
                                        2. Akurasi Radius
                                      </span>
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                        acc.status === 'VALID' ? 'bg-emerald-500/20 text-emerald-300' : acc.status === 'WARNING' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                                      }`}>
                                        {acc.status} ({acc.score}%)
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-mono font-bold text-emerald-300">{acc.detailValue}</p>
                                    <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{acc.analysisNote}</p>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Parameter 3: Data Elevasi */}
                            {(() => {
                              const alt = fakeCheck.evaluations.elevation;
                              return (
                                <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700 flex flex-col justify-between">
                                  <div>
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-tight">
                                        3. Data Elevasi 3D
                                      </span>
                                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                        alt.status === 'VALID' ? 'bg-emerald-500/20 text-emerald-300' : alt.status === 'WARNING' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
                                      }`}>
                                        {alt.status} ({alt.score}%)
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-mono font-bold text-emerald-300">{alt.detailValue}</p>
                                    <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{alt.analysisNote}</p>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Fake GPS Warning if detected */}
                      {fakeCheck.isFake && (
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          <div className="text-xs text-amber-900">
                            <span className="font-bold block">Catatan Anomali Fake GPS:</span>
                            <span>{fakeCheck.reason}</span>
                          </div>
                        </div>
                      )}

                      {/* Form Parameter Grid */}
                      <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5 font-display">
                            <Navigation className="w-4 h-4 text-emerald-600" />
                            Parameter Sensor GPS Perangkat (Live)
                          </h4>
                          <span className="text-[10px] text-slate-400 font-mono">
                            Fixed: {new Date(timestamp).toLocaleTimeString('id-ID')}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Latitude */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Garis Lintang (Latitude)
                            </label>
                            <div className="relative">
                              <input
                                type="text"
                                readOnly
                                value={lat}
                                className="w-full bg-white border border-slate-200 text-slate-900 text-xs font-mono font-bold rounded-xl py-2 px-3 pr-9 shadow-sm"
                              />
                              <button
                                onClick={() => copyToClipboard(String(lat), 'lat')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                                title="Salin Latitude"
                              >
                                {copiedField === 'lat' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          {/* Longitude */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Garis Bujur (Longitude)
                            </label>
                            <div className="relative">
                              <input
                                type="text"
                                readOnly
                                value={lng}
                                className="w-full bg-white border border-slate-200 text-slate-900 text-xs font-mono font-bold rounded-xl py-2 px-3 pr-9 shadow-sm"
                              />
                              <button
                                onClick={() => copyToClipboard(String(lng), 'lng')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                                title="Salin Longitude"
                              >
                                {copiedField === 'lng' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          {/* Akurasi */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Akurasi Radius (Accuracy)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={`${acc.toFixed(2)} Meter (${Math.round(acc)}m)`}
                              className="w-full bg-white border border-slate-200 text-slate-900 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Lat Lng Combined */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Koordinat Gabungan (Lat, Lng)
                            </label>
                            <div className="relative">
                              <input
                                type="text"
                                readOnly
                                value={latLngStr}
                                className="w-full bg-white border border-indigo-200 text-indigo-700 text-xs font-mono font-bold rounded-xl py-2 px-3 pr-9 shadow-sm"
                              />
                              <button
                                onClick={() => copyToClipboard(latLngStr, 'latlng')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                                title="Salin Koordinat Gabungan"
                              >
                                {copiedField === 'latlng' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>

                          {/* Altitude */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Ketinggian / Elevasi (Altitude)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={altitude !== null && altitude !== undefined ? `${altitude.toFixed(2)} Meter` : 'Tidak Didukung Hardware (Null)'}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Altitude Accuracy */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Akurasi Ketinggian (Altitude Accuracy)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={altAcc !== null && altAcc !== undefined ? `${altAcc.toFixed(2)} Meter` : 'Tidak Didukung Hardware (Null)'}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Heading */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Arah Vektor Pergerakan (Heading)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={heading !== null && !isNaN(heading) ? `${heading.toFixed(1)}° (Derajat)` : 'Diam / Tidak Ada Arah (Null)'}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Speed */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Kecepatan Perangkat (Speed)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={speed !== null && !isNaN(speed) ? `${(speed * 3.6).toFixed(2)} km/jam (${speed.toFixed(2)} m/s)` : '0 km/jam (Diam)'}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Timestamp Hardware */}
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Waktu Terekam Sensor GPS Hardware (Timestamp Epoch)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={`${new Date(timestamp).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'medium' })} (${timestamp})`}
                              className="w-full bg-white border border-slate-200 text-slate-800 text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm"
                            />
                          </div>

                          {/* Timestamp Hardware Delta dalam milidetik (ms) */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Timestamp Hardware Delta (Milidetik / ms)
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={fakeCheck.timeDeltaMs !== null && fakeCheck.timeDeltaMs !== undefined ? `${fakeCheck.timeDeltaMs.toLocaleString('id-ID')} ms (${(fakeCheck.timeDeltaMs / 1000).toFixed(2)} detik)` : 'Tidak Tersedia'}
                              className={`w-full bg-white border text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm ${
                                fakeCheck.isTimestampStagnant ? 'border-rose-300 text-rose-700 bg-rose-50/50' : 'border-emerald-300 text-emerald-800 bg-emerald-50/30'
                              }`}
                            />
                          </div>

                          {/* Evaluasi Dinamika Fix Timestamp */}
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              Dinamika Perubahan Fix (Polling #{gpsUpdateCount})
                            </label>
                            <input
                              type="text"
                              readOnly
                              value={
                                gpsUpdateCount <= 1
                                  ? 'Cek Awal (Memantau Polling Next Fix)'
                                  : fakeCheck.isTimestampStagnant
                                  ? 'ANOMALI: Stagnan / Beku (Indikasi Fake GPS)'
                                  : 'VALID: Dinamis / Fresh Fix (Sinyal Asli)'
                              }
                              className={`w-full bg-white border text-xs font-mono font-bold rounded-xl py-2 px-3 shadow-sm ${
                                fakeCheck.isTimestampStagnant ? 'border-rose-300 text-rose-700 bg-rose-50/50' : 'border-emerald-300 text-emerald-800 bg-emerald-50/30'
                              }`}
                            />
                          </div>

                          {/* User Agent */}
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                              User Agent / Informasi Perangkat Browser
                            </label>
                            <textarea
                              readOnly
                              rows={2}
                              value={navigator.userAgent}
                              className="w-full bg-white border border-slate-200 text-slate-600 text-[10px] font-mono rounded-xl p-2.5 resize-none shadow-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Bottom Action Controls */}
                      <div className="pt-3 flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-200">
                        <div className="flex flex-wrap items-center gap-2">
                          {isAutoGpsActive ? (
                            <button
                              onClick={() => setIsAutoGpsActive(false)}
                              className="px-3.5 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                            >
                              <Pause className="w-3.5 h-3.5" />
                              Jeda Pengecekan
                            </button>
                          ) : (
                            <button
                              onClick={() => setIsAutoGpsActive(true)}
                              className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              Lanjutkan Pengecekan Berulang
                            </button>
                          )}

                          <button
                            onClick={fetchGpsDataManual}
                            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl border border-slate-200 transition-all flex items-center gap-2 cursor-pointer"
                            title="Paksa refresh lokasi sekarang"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Refresh Sekarang
                          </button>

                          <a
                            href={`https://www.google.com/maps?q=${lat},${lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer border border-slate-200"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-slate-600" />
                            Maps
                          </a>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const summaryText = `--- DATA DIAGNOSTIK GPS PERANGKAT ---
Tanggal Fix: ${new Date(timestamp).toLocaleString('id-ID')}
Latitude: ${lat}
Longitude: ${lng}
Koordinat: ${latLngStr}
Akurasi: ${acc.toFixed(2)}m
Elevasi: ${altitude !== null ? `${altitude}m` : 'Null'}
Akurasi Elevasi: ${altAcc !== null ? `${altAcc}m` : 'Null'}
Arah (Heading): ${heading !== null ? `${heading}°` : 'Null'}
Kecepatan: ${speed !== null ? `${speed}m/s` : '0'}
Evaluasi Fake GPS: ${fakeCheck.reason}
User Agent: ${navigator.userAgent}`;
                              copyToClipboard(summaryText, 'all');
                            }}
                            className="px-3.5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                          >
                            {copiedField === 'all' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedField === 'all' ? 'Tersalin!' : 'Salin Parameter'}
                          </button>

                          {/* Explicit Keluar / Kembali Button */}
                          <button
                            onClick={() => setIsGpsModalOpen(false)}
                            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer border border-slate-700"
                          >
                            <ArrowLeft className="w-4 h-4 text-slate-300" />
                            Keluar / Kembali
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })() : null}
              </div>
            </div>
          </div>
        )}

        {/* Modal Reopen UID (Administrator) */}
        {isReopenUidModalOpen && (
          <Suspense fallback={null}>
            <ReopenUidModal
              isOpen={isReopenUidModalOpen}
              onClose={() => setIsReopenUidModalOpen(false)}
              requests={requests}
              profiles={profiles}
              usageItems={usageItems}
              histories={histories}
              onReopenRequest={onReopenRequest || (async () => false)}
            />
          </Suspense>
        )}

        {/* Modal Manual Activity Report (Administrator) */}
        {onSaveManualActivity && isManualActivityModalOpen && (
          <Suspense fallback={null}>
            <AdminManualActivityModal
              isOpen={isManualActivityModalOpen}
              onClose={() => setIsManualActivityModalOpen(false)}
              profiles={profiles}
              sites={sites}
              currentAdminEmail={email}
              onSubmitManualActivity={onSaveManualActivity}
            />
          </Suspense>
        )}

        {/* Modal Response Time Table (Administrator) */}
        {isResponseTimeModalOpen && (
          <Suspense fallback={null}>
            <AdminResponseTimeModal
              isOpen={isResponseTimeModalOpen}
              onClose={() => setIsResponseTimeModalOpen(false)}
              requests={requests}
              usageItems={usageItems}
              histories={histories}
              profiles={profiles}
            />
          </Suspense>
        )}

        {/* Modal Monitoring UID User Murni (Administrator) */}
        {isUserUidMonitoringModalOpen && (
          <Suspense fallback={null}>
            <UserUidMonitoringModal
              isOpen={isUserUidMonitoringModalOpen}
              onClose={() => setIsUserUidMonitoringModalOpen(false)}
              profiles={profiles || []}
              requests={requests}
              usageItems={usageItems}
              currentRole={role}
              currentUserEmail={email}
            />
          </Suspense>
        )}
      </div>
    );
  }

  // Compute stats for DIREKTUR role
  if (role === Role.DIREKTUR) {
    const {
      pendingBudgetReview,
      pendingReportReview,
      totalApprovalTasks,
      pengajuanCount,
      menungguTransferCount,
      menungguTransferNominal,
      prosesLaporanCount,
      closedCount,
      totalPengajuan,
      totalTransferred,
      totalClosed,
      todayTransferredCount,
      todayTransferredTotal,
      todayAllActivitiesCount
    } = direkturDashboardStats!;

    return (
      <div className="space-y-4">
        {/* DIREKTUR TAB SWITCHER */}
        <div className="bg-slate-100 p-1.5 rounded-2xl flex items-center gap-1.5 border border-slate-200/80 shadow-xs">
          <button
            type="button"
            onClick={() => {
              updateDirekturTab('APPROVAL');
              if (onSelectFilter && (activeFilter === 'DIREKTUR_APPROVAL' || activeFilter === 'DIREKTUR_RECONCILIATION')) {
                onSelectFilter('ALL');
              }
            }}
            className={`flex-1 py-2.5 px-3 rounded-xl font-display font-black text-xs transition-all cursor-pointer flex items-center justify-center gap-2 ${
              direkturGroupTab === 'APPROVAL'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>APPROVAL</span>
            {totalApprovalTasks > 0 && (
              <span className={`px-2 py-0.5 text-[10px] rounded-full font-bold ${
                direkturGroupTab === 'APPROVAL' ? 'bg-purple-800 text-purple-100' : 'bg-purple-600 text-white'
              }`}>
                {totalApprovalTasks}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              updateDirekturTab('MONITORING');
              if (onSelectFilter && (activeFilter === 'DIREKTUR_APPROVAL' || activeFilter === 'DIREKTUR_RECONCILIATION')) {
                onSelectFilter('ALL');
              }
            }}
            className={`flex-1 py-2.5 px-3 rounded-xl font-display font-black text-xs transition-all cursor-pointer flex items-center justify-center gap-2 ${
              direkturGroupTab === 'MONITORING'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>MONITORING</span>
          </button>
        </div>

        {/* KELOMPOK APPROVAL TAB CONTENT */}
        {direkturGroupTab === 'APPROVAL' && (
          <div className="space-y-4">
            {/* Urgent Task Card untuk Direktur */}
            {totalApprovalTasks > 0 ? (
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-purple-700 shrink-0">
                  <ClipboardCheck className="w-5.5 h-5.5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-purple-900 text-xs tracking-wide uppercase">TUGAS PERSETUJUAN DIREKTUR ({totalApprovalTasks})</h3>
                  <p className="text-xs text-purple-700 font-medium mt-0.5">
                    Ada {pendingBudgetReview} pengajuan anggaran baru dan {pendingReportReview} laporan operasional yang membutuhkan tinjauan Anda.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3.5 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                  <CheckCircle2 className="w-5.5 h-5.5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-emerald-900 text-xs tracking-wide uppercase">SEMUA TINJAUAN DIREKTUR BERES</h3>
                  <p className="text-xs text-emerald-700 font-medium mt-0.5">
                    Tidak ada tugas persetujuan anggaran atau review laporan bawahan langsung yang tertunda.
                  </p>
                </div>
              </div>
            )}

            {/* 2 Kartu Akses Approval & Review Direktur */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div 
                onClick={() => handleCardClick('DIREKTUR_APPROVAL')}
                className={`p-4.5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-purple-300 hover:shadow-md flex flex-col justify-between min-h-[130px] ${
                  activeFilter === 'DIREKTUR_APPROVAL' ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <p className="text-[10px] font-bold text-purple-600 uppercase tracking-widest flex items-center gap-1">
                    <span>ALUR PERSETUJUAN DIREKTUR</span>
                  </p>
                  <h4 className="font-display font-black text-slate-800 text-xs mt-1">Approval Pengajuan Anggaran</h4>
                </div>
                <div>
                  <div className="flex items-end justify-between mt-2">
                    <span className="text-2xl font-display font-bold text-slate-900">{pendingBudgetReview} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                    <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-amber-200/60">Persetujuan (Aksi)</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1 font-medium">Pengajuan anggaran dari bawahan hirarki Direktur</p>
                </div>
              </div>

              <div 
                onClick={() => handleCardClick('DIREKTUR_RECONCILIATION')}
                className={`p-4.5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-purple-300 hover:shadow-md flex flex-col justify-between min-h-[130px] ${
                  activeFilter === 'DIREKTUR_RECONCILIATION' ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <p className="text-[10px] font-bold text-purple-600 uppercase tracking-widest flex items-center gap-1">
                    <span>ALUR REKONSILIASI DIREKTUR</span>
                  </p>
                  <h4 className="font-display font-black text-slate-800 text-xs mt-1">Review Penggunaan Anggaran</h4>
                </div>
                <div>
                  <div className="flex items-end justify-between mt-2">
                    <span className="text-2xl font-display font-bold text-slate-900">{pendingReportReview} <span className="text-xs text-slate-400 font-normal">UID</span></span>
                    <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md uppercase tracking-wider border border-purple-200/60">Review Laporan (Aksi)</span>
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1 font-medium">Laporan nota & dana talangan dari bawahan hirarki Direktur</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KELOMPOK MONITORING TAB CONTENT */}
        {direkturGroupTab === 'MONITORING' && (
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
                <div className="mt-2 pt-2 border-t border-slate-100/80 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-medium">Total Nominal:</span>
                  <span className="text-xs font-bold text-slate-800 font-mono">
                    Rp {menungguTransferNominal.toLocaleString('id-ID')}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">Disetujui, antrean pencairan Finance</p>
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

            {/* Kartu DAFTAR TRANSFER - DIREKTUR MONITORING */}
            {onOpenTransferList && (
              <div 
                onClick={onOpenTransferList}
                id="direktur-transfer-list-card"
                className={`p-5 rounded-2xl border shadow-sm transition-all cursor-pointer hover:border-purple-300 hover:shadow-md group ${
                  activeFilter === 'TRANSFER_LIST' ? 'border-purple-500 bg-purple-50/30 ring-2 ring-purple-500/20' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">DAFTAR TRANSFER</p>
                    <h4 className="font-display font-black text-slate-800 text-xs mt-1 group-hover:text-purple-700 transition-colors">List Transfer UID</h4>
                  </div>
                  <span className="text-[9px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-md uppercase tracking-wider">
                    Eksekutif
                  </span>
                </div>

                <div className="flex items-end justify-between mt-3">
                  <div>
                    <span className="text-3xl font-display font-bold text-slate-900 block">
                      {todayTransferredCount} <span className="text-xs text-slate-400 font-normal">UID Hari Ini</span>
                    </span>
                    <p className="text-[11px] font-bold text-purple-700 mt-0.5">
                      Total: {formatIDR(todayTransferredTotal)}
                    </p>
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 mt-2.5 font-medium border-t border-slate-100 pt-2">
                  Lihat daftar pengajuan UID yang telah ditransfer dana oleh Finance beserta rincian bukti transfer.
                </p>
              </div>
            )}

            {/* Kartu Activity User - DIREKTUR */}
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

            {/* Card: Monitoring UID User Murni - DIREKTUR */}
            <div 
              onClick={onOpenUserUidMonitoring || (() => setIsUserUidMonitoringModalOpen(true))}
              id="direktur-user-uid-monitoring-card"
              className="bg-white border border-purple-200/80 rounded-2xl p-5 shadow-sm hover:border-purple-400 hover:shadow-md transition-all cursor-pointer flex items-center justify-between bg-gradient-to-r from-purple-50/40 via-white to-indigo-50/30"
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-bold text-purple-700 tracking-widest uppercase">MONITORING OPERASIONAL USER</p>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                    userMurniMonitoringStats.blockedCount > 0
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    {userMurniMonitoringStats.blockedCount > 0 ? `${userMurniMonitoringStats.blockedCount} Dibatasi` : 'Normal'}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-2xl font-display font-bold text-slate-900">{userMurniMonitoringStats.totalUnreportedCount}</span>
                  <span className="text-xs text-slate-500 font-medium">UID Belum Dilaporkan</span>
                </div>
                <p className="text-[10px] text-rose-600 font-medium mt-0.5">
                  {userMurniMonitoringStats.blockedCount} User Murni memiliki &gt; 1 UID belum dilaporkan (pengajuan diblokir)
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 shadow-sm">
                <ShieldAlert className="w-6 h-6" />
              </div>
            </div>

            {/* Kartu Pintasan: Tabel Response Waktu Pengajuan & Transfer - DIREKTUR MONITORING */}
            {(() => {
              const direkturOpBiasaCount = requests.reduce(
                (acc, r) => (r.id && r.id.startsWith('OP-') && !r.id.startsWith('OPT-') ? acc + 1 : acc),
                0
              );
              return (
                <div
                  id="direktur-response-time-shortcut-card"
                  onClick={() => {
                    if (onOpenResponseTimeTable) {
                      onOpenResponseTimeTable();
                    } else {
                      setIsResponseTimeModalOpen(true);
                    }
                  }}
                  className="p-5 rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50/90 via-white to-emerald-50/60 shadow-md hover:shadow-lg hover:border-teal-400 transition-all cursor-pointer group flex items-center justify-between gap-4 select-none"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (onOpenResponseTimeTable) {
                        onOpenResponseTimeTable();
                      } else {
                        setIsResponseTimeModalOpen(true);
                      }
                    }
                  }}
                  title="Klik untuk membuka Tabel Response Waktu Pengajuan & Transfer (SLA)"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-700 text-white flex items-center justify-center shrink-0 shadow-md shadow-teal-200 group-hover:scale-105 transition-transform">
                      <Clock className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-teal-600 transition-colors">
                          Tabel Response Waktu Pengajuan &amp; Transfer
                        </h3>
                        <span className="text-[9px] font-bold bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full border border-teal-200 flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 text-teal-600" />
                          SLA Timeline
                        </span>
                        <span className="text-[9px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                          {direkturOpBiasaCount} UID (OP-)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="hidden sm:inline-block text-xs font-semibold text-teal-700 group-hover:text-teal-900 transition-colors">
                      Buka Tabel
                    </span>
                    <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
                      &rarr;
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Total Financial Summary Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">IKHTISAR REKONSILIASI KEUANGAN</p>
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Total Pengajuan</span>
                  <span className="text-base font-extrabold font-display text-slate-800 mt-0.5 block">{formatIDR(totalPengajuan)}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Total Dana Ditransfer</span>
                  <span className="text-base font-extrabold font-display text-indigo-600 mt-0.5 block">{formatIDR(totalTransferred)}</span>
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                  <div>
                    <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Total Closing Terverifikasi</span>
                    <span className="text-base font-extrabold font-display text-emerald-600 mt-0.5 block">{formatIDR(totalClosed)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block font-semibold uppercase tracking-wider">Selisih Belum Closing</span>
                    <span className="text-base font-extrabold font-display text-amber-600 mt-0.5 block">{formatIDR(totalTransferred - totalClosed)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal Monitoring UID User Murni (Direktur) */}
        {isUserUidMonitoringModalOpen && (
          <Suspense fallback={null}>
            <UserUidMonitoringModal
              isOpen={isUserUidMonitoringModalOpen}
              onClose={() => setIsUserUidMonitoringModalOpen(false)}
              profiles={profiles || []}
              requests={requests}
              usageItems={usageItems}
              currentRole={role}
              currentUserEmail={email}
            />
          </Suspense>
        )}

        {/* Modal Response Time Table (Direktur Fallback) */}
        {isResponseTimeModalOpen && (
          <Suspense fallback={null}>
            <AdminResponseTimeModal
              isOpen={isResponseTimeModalOpen}
              onClose={() => setIsResponseTimeModalOpen(false)}
              requests={requests}
              usageItems={usageItems}
              histories={histories}
              profiles={profiles}
            />
          </Suspense>
        )}
      </div>
    );
  }

  return null;
};
