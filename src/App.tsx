/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBackHandler } from './hooks/useBackHandler';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, isGoogleTokenExpired } from './lib/firebase';
import firebaseConfig from '../firebase-applet-config.json';
import {
  findOrCreateDatabase,
  findOrCreateFolder,
  fetchBudgetRequests,
  fetchUsageItems,
  fetchProfiles,
  createBudgetRequest,
  updateBudgetRequest,
  createUsageItem,
  updateUsageItem,
  deleteUsageItem,
  saveUserProfile,
  uploadReceiptFile,
  uploadBase64Image,
  fetchSites,
  fetchUserActivities,
  createUserActivity,
  updateUserActivity,
  fetchResetDeviceLogs,
  createResetDeviceLog,
  fetchItemReviewHistories,
  createItemReviewHistory,
  createBatchItemReviewHistories,
  purgeOrphanItemReviewHistories,
  parseNumericValue,
  formatDivisiSubDivisi,
  defaultUsers
} from './lib/googleApi';
import { BudgetRequest, UsageReportItem, UserProfile, Role, RequestStatus, ItemStatus, SiteInfo, UserActivity, ResetDeviceLog, ItemReviewHistory, formatTimestamp } from './types';
import { validateDeviceAccessAndBind } from './lib/deviceUtils';

// Components
import { Header } from './components/Header';
import { ProfileSetup } from './components/ProfileSetup';
import { ProfileSettings } from './components/ProfileSettings';
import { DashboardStats } from './components/DashboardStats';
import { ZoomableImage } from './components/ZoomableImage';
import { BudgetRequestForm } from './components/BudgetRequestForm';
import { UsageReportForm } from './components/UsageReportForm';
import { ReviewBudgetModal } from './components/ReviewBudgetModal';
import { TransferModal } from './components/TransferModal';
import { ReviewReportModal } from './components/ReviewReportModal';
import { AppLoginForm } from './components/AppLoginForm';
import { AdjustmentPanel } from './components/AdjustmentPanel';
import { TransferListPanel } from './components/TransferListPanel';
import { ActivityLogView } from './components/ActivityLogView';
import { BbmRefillModal } from './components/BbmRefillModal';
import { BbmListModal } from './components/BbmListModal';
import { FinancialReportsModal } from './components/FinancialReportsModal';
import { ItemHistoryModal } from './components/ItemHistoryModal';
import { UserDashboardPreviewModal } from './components/UserDashboardPreviewModal';
import { GoogleConnectionModal } from './components/GoogleConnectionModal';
import { PwaInstallBanner } from './components/PwaInstallBanner';
import { FinanceSharedReceiptModal } from './components/FinanceSharedReceiptModal';
import { OP_TimeLine } from './components/OP_TimeLine';
import { SharedReceiptRecord, getLatestSharedReceipt, deleteSharedReceipt, clearAllSharedReceipts } from './lib/sharedReceiptStorage';

// Icons
import {
  Coins, ClipboardList, CheckCircle2, AlertCircle, Clock, Plus, LogIn,
  RefreshCw, FileSpreadsheet, Eye, Search, AlertTriangle, Check, CreditCard,
  Briefcase, MessageSquare, ExternalLink, CheckSquare, XCircle, ArrowRight, Edit2,
  Database, ArrowLeft, ArrowRightLeft, Paperclip, Filter, Fuel, X,
  Settings, LogOut, ShieldCheck, History, UserCheck, ShieldAlert, Share2, UploadCloud,
  ChevronDown, ChevronUp
} from 'lucide-react';

export const isOpBiasaRequest = (req: BudgetRequest) => {
  return req.id.startsWith('OP') && !req.id.startsWith('OPT-') && !req.id.startsWith('BBM') && !req.id.startsWith('ADJ-');
};

export const isFinanceApprovedOpRequest = (req: BudgetRequest, histories: ItemReviewHistory[]) => {
  if (!isOpBiasaRequest(req)) return true;
  if ([RequestStatus.PENDING_PENGAJUAN_TRANSFER, RequestStatus.TRANSFER_BERTAHAP, RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.CLOSED].includes(req.status)) return true;
  if (req.adminComment && req.adminComment.trim().length > 0) return true;

  return histories.some(h => {
    const isMatchingUid = h.requestUid === req.id || h.itemUid === req.id;
    if (!isMatchingUid) return false;
    const actorRoleUpper = (h.actorRole || '').toString().toUpperCase();
    const actionTypeUpper = (h.actionType || '').toString().toUpperCase();
    const statusUpper = (h.status || '').toString().toUpperCase();

    return actionTypeUpper === 'APPROVAL_FINANCE' || (actorRoleUpper === 'FINANCE' && (statusUpper === 'DISETUJUI' || statusUpper === 'APPROVED'));
  });
};

// [LOCKED - DO NOT MODIFY WITHOUT EXPLICIT USER APPROVAL]
// Logika getFinanceApprovedAmount untuk prefix OPT- dan OP- telah dikunci.
export const getFinanceApprovedAmount = (
  req: BudgetRequest,
  histories: ItemReviewHistory[] = [],
  usageItems: UsageReportItem[] = []
): number => {
  const isOpt = req.id.startsWith('OPT-') || req.tipePengajuan === 'DANA_TALANGAN' || (req.keterangan || '').startsWith('[DANA TALANGAN]');

  if (isOpt) {
    // Logika pengajuan ber-prefix OPT- (Operasional Dana Talangan):
    // Nominal getFinanceApprovedAmount diambil dari total nominal database Laporan dengan StatusManager=APPROVED, StatusAdmin=APPROVED
    const approvedLaporanItems = usageItems.filter(item => {
      if (item.requestId !== req.id) return false;
      const mgrApproved = item.statusManager === ItemStatus.APPROVED || (item.statusManager || '').toString().toUpperCase() === 'APPROVED';
      const adminApproved = item.statusAdmin === ItemStatus.APPROVED || (item.statusAdmin || '').toString().toUpperCase() === 'APPROVED';
      return mgrApproved && adminApproved;
    });

    if (approvedLaporanItems.length > 0) {
      return approvedLaporanItems.reduce((sum, item) => sum + (item.nominal || 0), 0);
    }
  }

  // Prioritas Utama (UID prefix OP- / Operasional Biasa): diambil dari nilai Nominal database ItemReviewHistory dengan ActorRole=FINANCE, ActionType=APPROVAL_FINANCE, Status=DISETUJUI
  const finApprovalHistories = histories.filter(h => {
    const isMatchingUid = h.requestUid === req.id || h.itemUid === req.id;
    if (!isMatchingUid) return false;

    const actorRoleUpper = (h.actorRole || '').toString().toUpperCase();
    const actionTypeUpper = (h.actionType || '').toString().toUpperCase();
    const statusUpper = (h.status || '').toString().toUpperCase();

    const isFinanceRole = actorRoleUpper === 'FINANCE';
    const isApprovalFinanceAction = actionTypeUpper === 'APPROVAL_FINANCE';
    const isDisetujuiStatus = statusUpper === 'DISETUJUI';

    return isFinanceRole && isApprovalFinanceAction && isDisetujuiStatus && (h.nominal || 0) > 0;
  });

  if (finApprovalHistories.length > 0) {
    const directReqHist = finApprovalHistories.find(h => h.requestUid === req.id && (h.nominal || 0) > 0);
    if (directReqHist) {
      return directReqHist.nominal;
    }
    const sumNominal = finApprovalHistories.reduce((sum, h) => sum + (h.nominal || 0), 0);
    if (sumNominal > 0) return sumNominal;
  }

  // Fallback jika tidak didapat data dari ItemReviewHistory: ambil nominal dari database Pengajuan [adminActionAmount]
  return req.adminActionAmount || 0;
};

// Logika getTransferBertahap telah dikunci ([LOCKED]). Tidak boleh diubah tanpa persetujuan eksplisit dari pengguna.
export const getTransferBertahap = (
  req: BudgetRequest,
  histories: ItemReviewHistory[] = [],
  usageItems: UsageReportItem[] = []
): boolean => {
  const finApproved = getFinanceApprovedAmount(req, histories, usageItems);
  const transferred = req.adminActionAmount || 0;
  return transferred < finApproved;
};

export const isPendingTransferRequest = (
  req: BudgetRequest,
  histories: ItemReviewHistory[] = [],
  usageItems: UsageReportItem[] = []
): boolean => {
  if (req.status === RequestStatus.CANCELLED || req.status === RequestStatus.REJECTED) return false;

  // Operasional Biasa (OP-): Jika belum CLOSED dan kondisi getTransferBertahap = TRUE (termasuk status TRANSFER_BERTAHAP maupun REVIEW_ADMIN)
  if (isOpBiasaRequest(req) && req.status !== RequestStatus.CLOSED && getTransferBertahap(req, histories, usageItems)) {
    return true;
  }

  if (req.status === RequestStatus.PENDING_TALANGAN_TRANSFER || req.status === RequestStatus.PENDING_PENGAJUAN_TRANSFER) {
    return true;
  }

  if (req.status === RequestStatus.TRANSFER_BERTAHAP) {
    return getTransferBertahap(req, histories, usageItems);
  }

  if (req.status === RequestStatus.REVIEW_ADMIN) {
    if (isOpBiasaRequest(req) && getTransferBertahap(req, histories, usageItems)) {
      return true;
    }
  }

  if (req.status === RequestStatus.APPROVED || req.status === RequestStatus.PARTIALLY_APPROVED) {
    if (isOpBiasaRequest(req)) {
      return isFinanceApprovedOpRequest(req, histories);
    }
    return true;
  }

  return false;
};

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isAuthAlertModalOpen, setIsAuthAlertModalOpen] = useState(false);
  const [isAuthModalDismissed, setIsAuthModalDismissed] = useState(false);

  const isInvalidGoogleAccount = false;

  // Theme state defaulting to 'theme3' as requested
  const [theme, setTheme] = useState<string>(() => {
    return localStorage.getItem('op_app_theme') || 'theme3';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('op_app_theme', theme);
  }, [theme]);

  // App Database Context
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(null);
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loginRejectError, setLoginRejectError] = useState<string | null>(null);

  // Data arrays
  const [requests, setRequests] = useState<BudgetRequest[]>(() => {
    try {
      const cached = localStorage.getItem('op_app_cached_requests');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [usageItems, setUsageItems] = useState<UsageReportItem[]>(() => {
    try {
      const cached = localStorage.getItem('op_app_cached_usage_items');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [profiles, setProfiles] = useState<UserProfile[]>(() => {
    try {
      const cached = localStorage.getItem('op_app_cached_profiles');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [sites, setSites] = useState<SiteInfo[]>(() => {
    try {
      const cached = localStorage.getItem('op_app_cached_sites');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [activities, setActivities] = useState<UserActivity[]>(() => {
    try {
      const cached = localStorage.getItem('op_app_cached_activities');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [resetDeviceLogs, setResetDeviceLogs] = useState<ResetDeviceLog[]>(() => {
    try {
      const cached = localStorage.getItem('op_app_cached_reset_device_logs');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [itemReviewHistories, setItemReviewHistories] = useState<ItemReviewHistory[]>(() => {
    try {
      const cached = localStorage.getItem('op_app_cached_item_review_histories');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => {
    try {
      const savedUserId = localStorage.getItem('op_app_logged_in_user_id') || sessionStorage.getItem('op_app_logged_in_user_id');
      if (savedUserId) {
        const cachedProfsStr = localStorage.getItem('op_app_cached_profiles');
        const candidateProfiles: UserProfile[] = cachedProfsStr ? JSON.parse(cachedProfsStr) : defaultUsers;
        const matched = candidateProfiles.find(
          p => p.userId?.toLowerCase() === savedUserId.toLowerCase() || p.email?.toLowerCase() === savedUserId.toLowerCase()
        );
        if (matched) return matched;
      }
    } catch (e) {
      console.warn('Gagal memuat sesi user profile dari localStorage:', e);
    }
    return null;
  });
  const [isTokenExpired, setIsTokenExpired] = useState(false);

  // Simulation Role Override
  const [activeRole, setActiveRole] = useState<Role>(() => userProfile?.role || Role.USER);

  // Navigation / Views
  const [activeView, setActiveView] = useState<'dashboard' | 'new-request' | 'report-usage' | 'setup-profile' | 'adjustment' | 'transfer-list' | 'profile-settings' | 'activities'>('dashboard');
  const [selectedRequest, setSelectedRequest] = useState<BudgetRequest | null>(null);
  const [editingRequest, setEditingRequest] = useState<BudgetRequest | null>(null);

  // Review Modals Active
  const [reviewBudgetReq, setReviewBudgetReq] = useState<BudgetRequest | null>(null);
  const [reviewReportReq, setReviewReportReq] = useState<BudgetRequest | null>(null);
  const [transferReq, setTransferReq] = useState<BudgetRequest | null>(null);
  const [closingConfirmReq, setClosingConfirmReq] = useState<BudgetRequest | null>(null);
  const [cancelConfirmReq, setCancelConfirmReq] = useState<BudgetRequest | null>(null);
  const [requestHistoryModalItem, setRequestHistoryModalItem] = useState<UsageReportItem | null>(null);
  const [isBbmModalOpen, setIsBbmModalOpen] = useState(false);
  const [isBbmListModalOpen, setIsBbmListModalOpen] = useState(false);
  const [isFinancialReportsModalOpen, setIsFinancialReportsModalOpen] = useState(false);
  const [isUserDashboardPreviewModalOpen, setIsUserDashboardPreviewModalOpen] = useState(false);
  const [isDiomsLogoModalOpen, setIsDiomsLogoModalOpen] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<{ url: string; fileId?: string; title: string } | null>(null);

  // Mobile Device Back Button Navigation Shortcuts
  useBackHandler(activeView !== 'dashboard', () => setActiveView('dashboard'), 'activeView');
  useBackHandler(!!selectedRequest, () => setSelectedRequest(null), 'selectedRequest');
  useBackHandler(!!reviewBudgetReq, () => setReviewBudgetReq(null), 'reviewBudgetReq');
  useBackHandler(!!reviewReportReq, () => setReviewReportReq(null), 'reviewReportReq');
  useBackHandler(!!transferReq, () => setTransferReq(null), 'transferReq');
  useBackHandler(!!closingConfirmReq, () => setClosingConfirmReq(null), 'closingConfirmReq');
  useBackHandler(!!cancelConfirmReq, () => setCancelConfirmReq(null), 'cancelConfirmReq');
  useBackHandler(isBbmModalOpen, () => setIsBbmModalOpen(false), 'isBbmModalOpen');
  useBackHandler(isBbmListModalOpen, () => setIsBbmListModalOpen(false), 'isBbmListModalOpen');
  useBackHandler(isFinancialReportsModalOpen, () => setIsFinancialReportsModalOpen(false), 'isFinancialReportsModalOpen');
  useBackHandler(isUserDashboardPreviewModalOpen, () => setIsUserDashboardPreviewModalOpen(false), 'isUserDashboardPreviewModalOpen');
  useBackHandler(isDiomsLogoModalOpen, () => setIsDiomsLogoModalOpen(false), 'isDiomsLogoModalOpen');
  useBackHandler(!!previewDocument, () => setPreviewDocument(null), 'previewDocument');

  // Search/Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dashboardTab, setDashboardTab] = useState<'APPROVAL' | 'SUBMISSION'>(() => {
    try {
      const saved = localStorage.getItem('applet_last_dashboard_tab');
      if (saved === 'APPROVAL' || saved === 'SUBMISSION') return saved;
    } catch (e) {
      // ignore
    }
    return 'APPROVAL';
  });

  // Restore dashboardTab when activeRole changes
  useEffect(() => {
    try {
      const savedForRole = localStorage.getItem(`applet_last_dashboard_tab_${activeRole}`);
      if (savedForRole === 'APPROVAL' || savedForRole === 'SUBMISSION') {
        setDashboardTab(savedForRole as 'APPROVAL' | 'SUBMISSION');
      }
    } catch (e) {
      // ignore
    }
  }, [activeRole]);

  const handleSelectDashboardTab = (tab: 'APPROVAL' | 'SUBMISSION') => {
    setDashboardTab(tab);
    try {
      localStorage.setItem('applet_last_dashboard_tab', tab);
      localStorage.setItem(`applet_last_dashboard_tab_${activeRole}`, tab);
    } catch (e) {
      // ignore
    }
  };
  const [initialIsTalangan, setInitialIsTalangan] = useState(false);
  const [expandedReportReqIds, setExpandedReportReqIds] = useState<Record<string, boolean>>({});
  const [expandedTimelineReqIds, setExpandedTimelineReqIds] = useState<Record<string, boolean>>({});

  // Closed requests filter states
  const [closedUserFilter, setClosedUserFilter] = useState<string>('ALL');
  const [closedDivisiFilter, setClosedDivisiFilter] = useState<string>('ALL');
  const [closedStartDateFilter, setClosedStartDateFilter] = useState<string>('');
  const [closedEndDateFilter, setClosedEndDateFilter] = useState<string>('');

  // PWA Share Target states for received receipts
  const [pendingSharedRecord, setPendingSharedRecord] = useState<SharedReceiptRecord | null>(null);
  const [sharedFilePrefill, setSharedFilePrefill] = useState<{ file: File; recordId?: string } | null>(null);
  const [shareAccessDeniedModal, setShareAccessDeniedModal] = useState<{
    open: boolean;
    userName: string;
    userRole: string;
  } | null>(null);

  // Check for received shared receipts from IndexedDB
  useEffect(() => {
    let isMounted = true;
    const checkSharedReceipts = async () => {
      try {
        if (typeof window !== 'undefined' && window.location.search.includes('shared_receipt=1')) {
          window.history.replaceState({}, '', window.location.pathname);
        }
        const record = await getLatestSharedReceipt();
        if (!isMounted) return;

        if (record) {
          if (userProfile) {
            // User IS ALREADY LOGGED IN: Check if userID has Role Finance
            if (userProfile.role === Role.FINANCE) {
              setPendingSharedRecord(record);
              if (activeRole !== Role.FINANCE) {
                setActiveRole(Role.FINANCE);
              }
              setDashboardTab('APPROVAL');
              setStatusFilter('APPROVED');
              setActiveView('dashboard');
            } else {
              // User IS LOGGED IN, BUT DOES NOT HAVE ROLE FINANCE -> Cancel process & show notification
              setPendingSharedRecord(null);
              await deleteSharedReceipt(record.id);
              setShareAccessDeniedModal({
                open: true,
                userName: userProfile.nama || userProfile.userId || userProfile.email,
                userRole: userProfile.role,
              });
            }
          } else {
            // User IS NOT LOGGED IN YET: Keep record so AppLoginForm prompts to log in as Role Finance
            setPendingSharedRecord(record);
          }
        } else {
          setPendingSharedRecord(null);
        }
      } catch (err) {
        console.error('Error checking IndexedDB for shared receipts:', err);
      }
    };

    checkSharedReceipts();

    // Listen for window focus or visibility change
    const handleFocus = () => {
      checkSharedReceipts();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      isMounted = false;
      window.removeEventListener('focus', handleFocus);
    };
  }, [userProfile, activeRole]);

  // Trigger loading & initialization
  useEffect(() => {
    initAuth(
      (currentUser, accessToken) => {
        setUser(currentUser);
        setToken(accessToken);
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
      }
    );
  }, []);

  // Periodically monitor Google OAuth token expiration status
  useEffect(() => {
    const checkTokenStatus = () => {
      if (token) {
        const expired = isGoogleTokenExpired();
        setIsTokenExpired(expired);
        if (expired) {
          setIsAuthAlertModalOpen(true);
          setIsAuthModalDismissed(false);
          if (!error || !error.includes('Sesi Google')) {
            setError('Sesi Google Anda telah kadaluarsa (Masa aktif token 1 Jam). Data lokal & login aplikasi Anda tetap aman. Silakan klik "1-Klik Koneksi Google" untuk melanjutkan.');
          }
        }
      }
    };

    checkTokenStatus();
    const interval = setInterval(checkTokenStatus, 30000);
    return () => clearInterval(interval);
  }, [token, error]);

  // When auth completes, load spreadsheet & data
  useEffect(() => {
    if (token && user) {
      initializeDatabaseAndLoad();
    }
  }, [token, user]);

  // If profile changes, align active role to default user profile role
  useEffect(() => {
    if (userProfile) {
      setActiveRole(userProfile.role);
    }
  }, [userProfile]);

  const initializeDatabaseAndLoad = async () => {
    if (!token || !user) return;

    setIsLoading(true);
    setError(null);

    try {
      setLoadingStep('Mencari/Membuat Database Google Sheets...');
      const sheetId = await findOrCreateDatabase(token);
      setSpreadsheetId(sheetId);

      setLoadingStep('Mencari/Membuat Folder Bukti Google Drive...');
      const folderId = await findOrCreateFolder(token);
      setDriveFolderId(folderId);

      setLoadingStep('Sinkronisasi Data Operasional...');
      await syncAllData(token, sheetId);
    } catch (err: any) {
      console.error(err);
      const isAuthError = err.message && (
        err.message.includes('401') ||
        err.message.toLowerCase().includes('authentication credentials') ||
        err.message.toLowerCase().includes('invalid_grant') ||
        err.message.toLowerCase().includes('unauthorized') ||
        err.message.toLowerCase().includes('token')
      );
      if (isAuthError) {
        console.warn('Google API returned 401 Unauthorized. Sesi token Google expired.');
        await handleGoogleAuthError();
      } else {
        const hasCachedProfiles = !!localStorage.getItem('op_app_cached_profiles');
        if (hasCachedProfiles && (err.message?.includes('Gagal terhubung') || err.message?.includes('Failed to fetch') || err.message?.includes('timeout') || err.message?.includes('SiteID'))) {
          console.warn('Google API network/CORS issue, restoring cached data from localStorage...');
          try {
            const cachedReqs = JSON.parse(localStorage.getItem('op_app_cached_requests') || '[]');
            const cachedItems = JSON.parse(localStorage.getItem('op_app_cached_usage_items') || '[]');
            const cachedProfs = JSON.parse(localStorage.getItem('op_app_cached_profiles') || '[]');
            const cachedSites = JSON.parse(localStorage.getItem('op_app_cached_sites') || '[]');
            const cachedActs = JSON.parse(localStorage.getItem('op_app_cached_activities') || '[]');
            const cachedLogs = JSON.parse(localStorage.getItem('op_app_cached_reset_device_logs') || '[]');
            const cachedHist = JSON.parse(localStorage.getItem('op_app_cached_item_review_histories') || '[]');

            if (cachedProfs.length > 0) {
              setRequests(cachedReqs);
              setUsageItems(cachedItems);
              setProfiles(cachedProfs);
              setSites(cachedSites);
              setActivities(cachedActs);
              setResetDeviceLogs(cachedLogs);
              setItemReviewHistories(cachedHist);

              const savedUserId = localStorage.getItem('op_app_logged_in_user_id') || sessionStorage.getItem('op_app_logged_in_user_id');
              if (savedUserId) {
                const matchedUser = cachedProfs.find((u: any) => u.userId?.toLowerCase() === savedUserId.toLowerCase() || u.email?.toLowerCase() === savedUserId.toLowerCase());
                if (matchedUser) {
                  setUserProfile(matchedUser);
                  setActiveRole(matchedUser.role);
                }
              }

              setError('Koneksi ke Google API terganggu. Aplikasi berjalan menggunakan data lokal (Offline). Anda dapat menekan tombol "Coba Sinkron Ulang" saat koneksi terhubung.');
              return;
            }
          } catch (restoreErr) {
            console.error('Gagal memuat cache lokal:', restoreErr);
          }
        }
        setError(err.message || 'Gagal menginisialisasi Google Workspace.');
      }
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const syncAllData = async (accessToken: string, sheetId: string) => {
    try {
      const [allReqs, allItems, allProfs, allSites, allActs, allResetLogs, allHistories] = await Promise.all([
        fetchBudgetRequests(accessToken, sheetId),
        fetchUsageItems(accessToken, sheetId),
        fetchProfiles(accessToken, sheetId),
        fetchSites(accessToken, sheetId),
        fetchUserActivities(accessToken, sheetId),
        fetchResetDeviceLogs(accessToken, sheetId),
        fetchItemReviewHistories(accessToken, sheetId)
      ]);

      // Synchronize Dana Talangan requests' JumlahPengajuan with total nominal of their items
      const synchronizedReqs = allReqs.map(req => {
        const isTalangan = req.id.startsWith('OPT-') || 
          req.id.startsWith('BBMDS') || 
          req.id.startsWith('BBM_DurenSawit') || 
          req.tipePengajuan === 'DANA_TALANGAN' || 
          req.keterangan.startsWith('[DANA TALANGAN]');
        
        if (isTalangan) {
          const reqItems = allItems.filter(i => i.requestId === req.id);
          if (reqItems.length > 0) {
            const sumNominal = reqItems.reduce((sum, item) => sum + (Number(item.nominal) || 0), 0);
            if (req.jumlahPengajuan !== sumNominal) {
              return { ...req, jumlahPengajuan: sumNominal };
            }
          }
        }
        return req;
      });

      const sortedReqs = synchronizedReqs.sort((a, b) => b.id.localeCompare(a.id));
      setRequests(sortedReqs); // Newest first
      setUsageItems(allItems);
      setProfiles(allProfs);
      setSites(allSites);
      setActivities(allActs);
      setResetDeviceLogs(allResetLogs.sort((a, b) => b.id.localeCompare(a.id)));
      setItemReviewHistories(allHistories.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      setIsTokenExpired(false);
      localStorage.setItem('op_app_cached_requests', JSON.stringify(sortedReqs));
      localStorage.setItem('op_app_cached_usage_items', JSON.stringify(allItems));
      localStorage.setItem('op_app_cached_profiles', JSON.stringify(allProfs));
      localStorage.setItem('op_app_cached_sites', JSON.stringify(allSites));
      localStorage.setItem('op_app_cached_activities', JSON.stringify(allActs));
      localStorage.setItem('op_app_cached_reset_device_logs', JSON.stringify(allResetLogs));
      localStorage.setItem('op_app_cached_item_review_histories', JSON.stringify(allHistories));

      if (selectedRequest) {
        const freshReq = sortedReqs.find(r => r.id === selectedRequest.id);
        if (freshReq) {
          setSelectedRequest(freshReq);
        }
      }

      // If the user is already logged in, keep their active session and update with the latest data
      const savedUserId = localStorage.getItem('op_app_logged_in_user_id') || sessionStorage.getItem('op_app_logged_in_user_id');
      const activeUserProf = userProfile || (savedUserId ? allProfs.find(p => p.userId?.toLowerCase() === savedUserId.toLowerCase() || p.email?.toLowerCase() === savedUserId.toLowerCase()) : null);
      if (activeUserProf) {
        const updatedProfile = allProfs.find(
          p => p.userId?.toLowerCase() === activeUserProf.userId?.toLowerCase() || p.email?.toLowerCase() === activeUserProf.email?.toLowerCase()
        );
        if (updatedProfile) {
          setUserProfile(updatedProfile);
          setActiveRole(updatedProfile.role);
        }
        return;
      }

      // Ensure the admin profile in Google Sheets has the correct email associated with it in the background
      if (user && user.email) {
        const emailLower = user.email.toLowerCase();
        if (emailLower === 'ops.depotel@gmail.com' || emailLower === 'ops.depotel.gmail.com') {
          const adminProf = allProfs.find(p => p.role === Role.FINANCE || p.userId === 'admin' || p.userId === 'finance');
          if (adminProf && adminProf.email !== 'ops.depotel@gmail.com') {
            adminProf.email = 'ops.depotel@gmail.com';
            adminProf.nama = 'Finance Depotel';
            try {
              saveUserProfile(accessToken, sheetId, adminProf).catch(console.error);
            } catch (e) {
              console.error('Failed to sync updated admin profile to sheet:', e);
            }
          }
        }
      }

      // Always show the local application login form (UserID + Password) first
      setUserProfile(null);
    } catch (err: any) {
      throw new Error(`Gagal memuat tabel database: ${err.message}`);
    }
  };

  const handleManualRefresh = async () => {
    if (!token || !spreadsheetId) return;
    setIsLoading(true);
    setError(null);
    setLoadingStep('Memperbarui Data...');
    try {
      await syncAllData(token, spreadsheetId);
    } catch (err: any) {
      console.error(err);
      const isAuthError = err.message && (
        err.message.includes('401') ||
        err.message.toLowerCase().includes('authentication credentials') ||
        err.message.toLowerCase().includes('invalid_grant') ||
        err.message.toLowerCase().includes('unauthorized') ||
        err.message.toLowerCase().includes('token')
      );
      if (isAuthError) {
        console.warn('Google API returned 401 Unauthorized during refresh. Sesi token Google expired.');
        await handleGoogleAuthError();
      } else {
        setError(err.message || 'Gagal memperbarui data.');
      }
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err: any) {
      const isCancelled =
        err?.code === 'auth/popup-closed-by-user' ||
        err?.code === 'auth/cancelled-popup-request' ||
        err?.code === 'auth/popup-blocked' ||
        err?.message?.includes('popup-closed-by-user');

      if (isCancelled) {
        console.log('Login dibatalkan oleh pengguna.');
        setError('Proses login Google dibatalkan oleh pengguna.');
      } else {
        console.error('Login error details:', err);
        setError('Error menghubungkan dengan Google');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleAuthError = async () => {
    console.warn('Google API returned 401 Unauthorized. Sesi token Google expired.');
    setIsTokenExpired(true);
    setIsAuthAlertModalOpen(true);
    setIsAuthModalDismissed(false);
    setError('Sesi Google (ops.depotel@gmail.com) telah berakhir (Masa aktif token 1 Jam). Data lokal & login aplikasi Anda tetap aman. Silakan klik "1-Klik Koneksi Google" untuk melanjutkan.');
  };

  const handleRenewGoogleToken = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
        setIsTokenExpired(false);
        setIsAuthAlertModalOpen(false);
        setIsAuthModalDismissed(false);
        let sId = spreadsheetId;
        if (!sId) {
          sId = await findOrCreateDatabase(result.accessToken);
          setSpreadsheetId(sId);
        }
        if (!driveFolderId) {
          const fId = await findOrCreateFolder(result.accessToken);
          setDriveFolderId(fId);
        }
        await syncAllData(result.accessToken, sId);
      }
    } catch (err: any) {
      const isCancelled =
        err?.code === 'auth/popup-closed-by-user' ||
        err?.code === 'auth/cancelled-popup-request' ||
        err?.code === 'auth/popup-blocked' ||
        err?.message?.includes('popup-closed-by-user');

      if (isCancelled) {
        console.log('Perbaruan token Google dibatalkan oleh pengguna.');
        setError('Proses perbaruan sesi Google dibatalkan oleh pengguna.');
      } else {
        console.error('Gagal memperbarui token Google:', err);
        setError('Gagal memperbarui sesi Google. Pastikan tidak memblokir popup Google.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const runGoogleAction = async <T,>(
    action: () => Promise<T>,
    errorMessage: string
  ): Promise<T | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await action();
      return result;
    } catch (err: any) {
      console.error(err);
      const isAuthError = err.message && (
        err.message.includes('401') ||
        err.message.toLowerCase().includes('authentication credentials') ||
        err.message.toLowerCase().includes('invalid_grant') ||
        err.message.toLowerCase().includes('unauthorized') ||
        err.message.toLowerCase().includes('token')
      );
      if (isAuthError) {
        await handleGoogleAuthError();
      } else {
        setError(err.message || errorMessage);
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('op_app_logged_in_user_id');
    sessionStorage.removeItem('op_app_logged_in_user_id');
    setUserProfile(null);
    setActiveView('dashboard');
  };

  const handleResetGoogleConnection = async () => {
    await logout();
    localStorage.removeItem('op_app_logged_in_user_id');
    sessionStorage.removeItem('op_app_logged_in_user_id');
    setUser(null);
    setToken(null);
    setNeedsAuth(true);
    setSpreadsheetId(null);
    setDriveFolderId(null);
    setRequests([]);
    setUsageItems([]);
    setProfiles([]);
    setUserProfile(null);
    setActiveView('dashboard');
  };

  const handleAppLoginSuccess = async (profile: UserProfile) => {
    setUserProfile(profile);
    if (profile.userId) {
      localStorage.setItem('op_app_logged_in_user_id', profile.userId);
      sessionStorage.setItem('op_app_logged_in_user_id', profile.userId);
    }

    if (pendingSharedRecord) {
      if (profile.role === Role.FINANCE) {
        setActiveRole(Role.FINANCE);
        setDashboardTab('APPROVAL');
        setStatusFilter('APPROVED');
        setActiveView('dashboard');
      } else {
        // User logged in, but does NOT have Role Finance! Cancel share process & notify user
        const recordToDelete = pendingSharedRecord;
        setPendingSharedRecord(null);
        if (recordToDelete?.id) {
          await deleteSharedReceipt(recordToDelete.id);
        }
        setActiveRole(profile.role);
        setActiveView('dashboard');
        setShareAccessDeniedModal({
          open: true,
          userName: profile.nama || profile.userId || profile.email,
          userRole: profile.role,
        });
      }
    } else {
      setActiveRole(profile.role);
      setActiveView('dashboard');
    }
  };

  const handleAppLoginWithCredentials = async (
    userId: string,
    password: string,
    onFormError: (msg: string) => void
  ) => {
    setError(null);
    let currentToken = token;
    let currentUser = user;

    // 1. If Google is not connected (needsAuth is true or token is missing), trigger Google Sign-In popup
    if (!currentToken || !currentUser || needsAuth) {
      setIsLoading(true);
      setLoadingStep('Menghubungkan Akun Google secara otomatis...');
      try {
        const result = await googleSignIn();
        if (result) {
          currentToken = result.accessToken;
          currentUser = result.user;
          setToken(result.accessToken);
          setUser(result.user);
          setNeedsAuth(false);
          setIsTokenExpired(false);
        }
      } catch (err: any) {
        console.warn('Auto Google auth error:', err);
        // Continue to local credential check if token connection popup fails or closed
      }
    }

    // 2. Validate credentials against Google Sheets or Cached profiles
    setIsLoading(true);
    setLoadingStep('Memverifikasi kredensial login...');

    let fetchedProfs: UserProfile[] | null = null;
    let sheetId = spreadsheetId;

    if (currentToken) {
      try {
        if (!sheetId) {
          sheetId = await findOrCreateDatabase(currentToken);
          setSpreadsheetId(sheetId);
        }
        if (!driveFolderId) {
          const folderId = await findOrCreateFolder(currentToken);
          setDriveFolderId(folderId);
        }

        fetchedProfs = await fetchProfiles(currentToken, sheetId);
        setProfiles(fetchedProfs);
        localStorage.setItem('op_app_cached_profiles', JSON.stringify(fetchedProfs));
        setIsTokenExpired(false);
      } catch (err: any) {
        console.warn('Google API validation attempt error:', err);
        const isAuthError = err.message && (
          err.message.includes('401') ||
          err.message.toLowerCase().includes('authentication credentials') ||
          err.message.toLowerCase().includes('invalid_grant') ||
          err.message.toLowerCase().includes('unauthorized') ||
          err.message.toLowerCase().includes('token')
        );

        if (isAuthError) {
          setIsTokenExpired(true);
          // Try to transparently prompt Google re-authorization
          try {
            const reAuth = await googleSignIn();
            if (reAuth) {
              currentToken = reAuth.accessToken;
              currentUser = reAuth.user;
              setToken(reAuth.accessToken);
              setUser(reAuth.user);
              setNeedsAuth(false);
              setIsTokenExpired(false);

              if (!sheetId) {
                sheetId = await findOrCreateDatabase(reAuth.accessToken);
                setSpreadsheetId(sheetId);
              }
              fetchedProfs = await fetchProfiles(reAuth.accessToken, sheetId);
              setProfiles(fetchedProfs);
              localStorage.setItem('op_app_cached_profiles', JSON.stringify(fetchedProfs));
            }
          } catch (reAuthErr) {
            console.warn('Google re-authentication skipped or cancelled, using local user profiles:', reAuthErr);
          }
        }
      }
    }

    // Get candidate profiles list from fetched, state, localStorage, or defaults
    let cachedProfsList: UserProfile[] = [];
    try {
      const cachedStr = localStorage.getItem('op_app_cached_profiles');
      if (cachedStr) cachedProfsList = JSON.parse(cachedStr);
    } catch {}

    const candidateProfiles = fetchedProfs || (profiles.length > 0 ? profiles : (cachedProfsList.length > 0 ? cachedProfsList : defaultUsers));

    const matched = candidateProfiles.find(
      (p) =>
        p.userId?.toLowerCase() === userId.trim().toLowerCase() &&
        p.password === password
    );

    if (matched) {
      const deviceCheck = await validateDeviceAccessAndBind(
        matched,
        currentToken && sheetId && !isTokenExpired
          ? async (updated) => {
              try {
                await saveUserProfile(currentToken!, sheetId!, updated);
              } catch (e) {
                console.warn('Failed to save updated user profile deviceId to sheet:', e);
              }
            }
          : undefined,
        candidateProfiles
      );

      if (!deviceCheck.success) {
        const errMsg = deviceCheck.errorMessage || 'Akses ditolak.';
        setLoginRejectError(errMsg);
        onFormError(errMsg);
        setIsLoading(false);
        setLoadingStep('');
        return;
      }

      const finalUser = deviceCheck.updatedUser || matched;
      if (deviceCheck.updatedUser) {
        const updatedProfs = candidateProfiles.map(p => p.email.toLowerCase() === finalUser.email.toLowerCase() ? finalUser : p);
        setProfiles(updatedProfs);
        localStorage.setItem('op_app_cached_profiles', JSON.stringify(updatedProfs));
      }

      if (currentToken && sheetId && !isTokenExpired) {
        try {
          await syncAllData(currentToken, sheetId);
        } catch (syncErr) {
          console.warn('Background sync on login encountered an error, continuing locally:', syncErr);
        }
      }

      handleAppLoginSuccess(finalUser);
    } else {
      const errMsg = 'User ID atau Password salah. Silakan periksa kembali.';
      setLoginRejectError(errMsg);
      onFormError(errMsg);
    }

    setIsLoading(false);
    setLoadingStep('');
  };

  // Profile Save
  const handleSaveProfile = async (newProfile: UserProfile) => {
    if (!token || !spreadsheetId) return;
    const success = await runGoogleAction(
      () => saveUserProfile(token, spreadsheetId, newProfile),
      'Gagal menyimpan profil.'
    );
    if (success !== null) {
      setUserProfile(newProfile);
      setActiveRole(newProfile.role);
      setActiveView('dashboard');
      await handleManualRefresh();
    }
  };

  // Reset Device ID by Administrator
  const handleResetUserDeviceId = async (targetUser: UserProfile, reason: string) => {
    const currentToken = token || 'mock_demo_token';
    const currentSheetId = spreadsheetId || 'mock_sheet_id';

    const updatedProfile: UserProfile = {
      ...targetUser,
      deviceId: ''
    };

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const logEntry: ResetDeviceLog = {
      id: `RDL-${Date.now()}`,
      timestamp: timestampStr,
      adminEmail: userProfile?.email || user?.email || 'admin@company.com',
      adminNama: userProfile?.nama || userProfile?.userId || user?.displayName || 'Administrator',
      targetUserEmail: targetUser.email,
      targetUserNama: targetUser.nama || targetUser.userId || targetUser.email,
      oldDeviceId: targetUser.deviceId || '-',
      keterangan: reason || 'Reset Device ID oleh Administrator'
    };

    const success = await runGoogleAction(
      async () => {
        await saveUserProfile(currentToken, currentSheetId, updatedProfile);
        await createResetDeviceLog(currentToken, currentSheetId, logEntry);
      },
      'Gagal mereset Device ID pengguna.'
    );

    if (success !== null) {
      setProfiles(prev => prev.map(p => p.email.toLowerCase() === targetUser.email.toLowerCase() ? updatedProfile : p));
      setResetDeviceLogs(prev => [logEntry, ...prev]);
      localStorage.setItem('op_app_cached_reset_device_logs', JSON.stringify([logEntry, ...resetDeviceLogs]));
      if (userProfile && userProfile.email.toLowerCase() === targetUser.email.toLowerCase()) {
        setUserProfile(updatedProfile);
      }
    }
  };

  // Pembersihan Orphan Data ItemReviewHistory
  const handlePurgeOrphanHistories = async (): Promise<{ purgedCount: number; remainingCount: number } | null> => {
    const currentToken = token || 'mock_demo_token';
    const currentSheetId = spreadsheetId || 'mock_sheet_id';

    const validRequestIds = new Set<string>(requests.map(r => r.id).filter(Boolean));
    const validUsageItemIds = new Set<string>(usageItems.map(i => i.id).filter(Boolean));

    let result: { purgedCount: number; remainingCount: number } | null = null;

    const success = await runGoogleAction(
      async () => {
        result = await purgeOrphanItemReviewHistories(currentToken, currentSheetId, validRequestIds, validUsageItemIds);
      },
      'Gagal melakukan pembersihan orphan data ItemReviewHistory.'
    );

    if (success !== null && result) {
      // Refresh local itemReviewHistories state
      const freshHistories = await fetchItemReviewHistories(currentToken, currentSheetId);
      setItemReviewHistories(freshHistories);
      return result;
    }
    return null;
  };

  // Profile Update Password
  const handleUpdatePassword = async (newPassword: string) => {
    if (!userProfile) return false;
    const updatedProfile: UserProfile = {
      ...userProfile,
      password: newPassword
    };

    const currentToken = token || '';
    const currentSheetId = spreadsheetId || '';

    const success = await runGoogleAction(
      () => saveUserProfile(currentToken, currentSheetId, updatedProfile),
      'Gagal memperbarui password.'
    );

    if (success !== null) {
      setUserProfile(updatedProfile);
      setProfiles(prev => prev.map(p => p.email.toLowerCase() === updatedProfile.email.toLowerCase() ? updatedProfile : p));
      return true;
    }
    return false;
  };

  // Profile Update Foto Profile
  const handleUpdateProfilePhoto = async (currentProf: UserProfile, photoFile?: File | null): Promise<boolean> => {
    if (!currentProf) return false;
    let fotoUrl = currentProf.fotoProfile || '';
    let fotoFileId = currentProf.fotoProfileFileId || '';

    const currentToken = token || '';
    const currentSheetId = spreadsheetId || '';

    if (photoFile) {
      // User uploaded a photo file -> upload to Google Drive if connected
      if (currentToken && driveFolderId && currentToken !== 'mock_demo_token') {
        try {
          const uploadRes = await uploadReceiptFile(currentToken, driveFolderId, photoFile);
          fotoFileId = uploadRes.fileId;
          // Use direct drive thumbnail URL for reliable image rendering across devices
          fotoUrl = `https://drive.google.com/thumbnail?sz=w1000&id=${uploadRes.fileId}`;
        } catch (err) {
          console.warn('Gagal unggah foto profil ke Google Drive, menggunakan base64 data URL:', err);
          fotoUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string || '');
            reader.readAsDataURL(photoFile);
          });
        }
      } else {
        // Fallback for mock/local mode
        fotoUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string || '');
          reader.readAsDataURL(photoFile);
        });
        fotoFileId = `mock_profile_${Date.now()}`;
      }
    } else if (photoFile === null) {
      // User requested deletion
      fotoUrl = '';
      fotoFileId = '';
    }

    const updatedProfile: UserProfile = {
      ...currentProf,
      fotoProfile: fotoUrl,
      fotoProfileFileId: fotoFileId
    };

    const success = await runGoogleAction(
      () => saveUserProfile(currentToken, currentSheetId, updatedProfile),
      'Gagal memperbarui foto profil.'
    );

    if (success !== null) {
      setUserProfile(updatedProfile);
      setProfiles(prev => prev.map(p => p.email.toLowerCase() === updatedProfile.email.toLowerCase() ? updatedProfile : p));
      localStorage.setItem('op_app_cached_profiles', JSON.stringify(
        profiles.map(p => p.email.toLowerCase() === updatedProfile.email.toLowerCase() ? updatedProfile : p)
      ));

      // Reload database profiles ONLY when profile photo changes
      if (currentToken && currentSheetId) {
        try {
          const freshProfiles = await fetchProfiles(currentToken, currentSheetId);
          if (freshProfiles && freshProfiles.length > 0) {
            setProfiles(freshProfiles);
            localStorage.setItem('op_app_cached_profiles', JSON.stringify(freshProfiles));
            const freshUser = freshProfiles.find(p => p.email.toLowerCase() === updatedProfile.email.toLowerCase());
            if (freshUser) {
              setUserProfile(freshUser);
            }
          }
        } catch (reloadErr) {
          console.warn('Gagal memuat ulang database user setelah update foto profil:', reloadErr);
        }
      }

      return true;
    }
    return false;
  };

  // Workflow Action 1: Create or Revise Budget Request
  const handleAddBudgetRequest = async (
    newRequest: BudgetRequest,
    firstItem?: UsageReportItem,
    itemFile?: File | null
  ) => {
    if (!token || !spreadsheetId) return;
    const isExisting = requests.some(r => r.id === newRequest.id);
    const isReqTalangan = newRequest.id.startsWith('OPT-') || newRequest.keterangan.startsWith('[DANA TALANGAN]');

    let finalReportItem: UsageReportItem | undefined = firstItem;

    const historyLog: ItemReviewHistory = {
      id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      itemUid: newRequest.id,
      requestUid: newRequest.id,
      timestamp: formatTimestamp(new Date()),
      actorRole: userProfile?.role || activeRole || Role.USER,
      actorEmail: userProfile?.email || newRequest.userEmail,
      actorNama: userProfile?.nama || userProfile?.email || newRequest.userEmail,
      actionType: isExisting ? 'PENGAJUAN_REVISED' : 'PENGAJUAN_CREATED',
      status: isExisting ? 'PENGAJUAN REVISI' : 'SUBMITTED',
      catatan: isExisting 
        ? 'Revisi pengajuan anggaran dikirim ulang oleh pemohon' 
        : (isReqTalangan ? 'Pengajuan Dana Talangan & item pertama dibuat' : 'Pengajuan anggaran baru dibuat oleh pemohon'),
      tanggalPenggunaan: newRequest.tanggalPemakaian,
      nominal: newRequest.jumlahPengajuan,
      keterangan: newRequest.keterangan
    };

    const success = await runGoogleAction(
      async () => {
        // If there is an item file to upload for Dana Talangan first item
        if (itemFile && driveFolderId) {
          const uploadResult = await uploadReceiptFile(token, driveFolderId, itemFile);
          if (finalReportItem) {
            finalReportItem = {
              ...finalReportItem,
              buktiUrl: uploadResult.viewUrl,
              buktiFileId: uploadResult.fileId
            };
          }
        }

        if (isExisting) {
          await updateBudgetRequest(token, spreadsheetId, newRequest);
        } else {
          await createBudgetRequest(token, spreadsheetId, newRequest);
        }

        // Atomically store first item in Laporan sheet for Dana Talangan
        if (finalReportItem && !isExisting) {
          await createUsageItem(token, spreadsheetId, finalReportItem);
        }

        await createItemReviewHistory(token, spreadsheetId, historyLog);
      },
      isExisting 
        ? 'Gagal mengupdate revisi pengajuan.' 
        : (isReqTalangan ? 'Gagal menyimpan Pengajuan & Item Dana Talangan.' : 'Gagal menambahkan pengajuan.')
    );

    if (success !== null) {
      setItemReviewHistories(prev => [historyLog, ...prev]);
      setEditingRequest(null);
      if (finalReportItem) {
        setUsageItems(prev => [...prev, finalReportItem!]);
      }
      if (isReqTalangan) {
        setSelectedRequest(newRequest);
        setActiveView('report-usage');
      } else {
        setActiveView('dashboard');
      }
      await handleManualRefresh();
    }
  };

  // Workflow Action: Create Adjustment (Admin Direct Action)
  const handleCreateAdjustment = async (
    targetUserEmail: string,
    amount: number,
    type: string,
    notes: string,
    tanggal: string,
    file: File | null
  ) => {
    if (!token || !spreadsheetId) return;

    // Check if target user has any unclosed Dana Talangan transactions
    const unclosedTalangan = requests.filter(r => 
      r.userEmail.toLowerCase() === targetUserEmail.toLowerCase() &&
      (
        r.id.startsWith('OPT-') ||
        r.keterangan?.toUpperCase().includes('[DANA TALANGAN]') ||
        r.keterangan?.toUpperCase().includes('DANA TALANGAN') ||
        r.keterangan?.toUpperCase().includes('TALANGAN') ||
        r.status === RequestStatus.PENDING_TALANGAN_TRANSFER
      ) &&
      r.status !== RequestStatus.CLOSED &&
      r.status !== RequestStatus.REJECTED &&
      r.status !== RequestStatus.CANCELLED
    );

    if (unclosedTalangan.length > 0) {
      throw new Error(`Adjustment tidak dapat dilakukan karena user ${targetUserEmail} masih memiliki ${unclosedTalangan.length} transaksi Dana Talangan yang belum CLOSED.`);
    }

    const success = await runGoogleAction(
      async () => {
        let finalBuktiUrl = '';
        let finalBuktiFileId = '';

        if (file) {
          if (!driveFolderId) {
            throw new Error('ID Folder Google Drive belum terinisialisasi.');
          }
          const uploadResult = await uploadReceiptFile(token, driveFolderId, file);
          finalBuktiUrl = uploadResult.viewUrl;
          finalBuktiFileId = uploadResult.fileId;
        }

        // Find target user managerEmail
        const targetUser = profiles.find(p => p.email.toLowerCase() === targetUserEmail.toLowerCase());
        const targetManagerEmail = targetUser?.managerEmail || '';

        // Generate clean unique ID based on selected date
        const dateStr = tanggal.replace(/-/g, '');
        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        const uid = `ADJ-${dateStr}-${randomDigits}`;

        const nowTime = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        const newRequest: BudgetRequest = {
          id: uid,
          userEmail: targetUserEmail,
          managerEmail: targetManagerEmail,
          tanggalPemakaian: tanggal,
          siteId: 'ADJUSTMENT',
          jumlahPengajuan: amount,
          keterangan: `[ADJUSTMENT] ${type} - ${notes}`,
          status: RequestStatus.CLOSED,
          managerActionAmount: amount,
          managerComment: 'Disetujui otomatis oleh Finance',
          adminActionAmount: amount,
          createdAt: nowTime,
          buktiTransferUrl: finalBuktiUrl || undefined,
          buktiTransferFileId: finalBuktiFileId || undefined,
          adminActionTime: nowTime
        };

        const historyLog: ItemReviewHistory = {
          id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
          itemUid: uid,
          requestUid: uid,
          timestamp: formatTimestamp(new Date()),
          actorRole: Role.FINANCE,
          actorEmail: userProfile?.email || 'finance@depotel.co.id',
          actorNama: userProfile?.nama || userProfile?.email || 'Finance',
          actionType: 'APPROVAL_FINANCE',
          status: 'DISETUJUI',
          catatan: `Adjustment Saldo User (${type}) - ${notes}`,
          tanggalPenggunaan: tanggal,
          nominal: amount,
          keterangan: `[ADJUSTMENT] ${type} - ${notes}`,
          buktiUrl: finalBuktiUrl || undefined,
          buktiFileId: finalBuktiFileId || undefined
        };

        await createBudgetRequest(token, spreadsheetId, newRequest);
        await createItemReviewHistory(token, spreadsheetId, historyLog);
      },
      'Gagal membuat transaksi Adjustment.'
    );

    if (success !== null) {
      setActiveView('dashboard');
      await handleManualRefresh();
    }
  };

  // Workflow Action 1.5: Submit BBM Refill (BBM Duren Sawit)
  const handleBbmRefillSubmit = async (req: BudgetRequest, reportItem: UsageReportItem) => {
    const currentToken = token || 'mock_demo_token';
    const currentSheetId = spreadsheetId || 'mock_sheet_id';

    const savedItem = await runGoogleAction<UsageReportItem>(
      async () => {
        let finalReportItem = { ...reportItem };

        // Process uploading base64 photo to Google Drive if connected to Google Drive
        if (reportItem.buktiUrl && reportItem.buktiUrl.startsWith('data:')) {
          if (currentToken !== 'mock_demo_token' && driveFolderId) {
            try {
              const uploadRes = await uploadBase64Image(
                currentToken,
                driveFolderId,
                reportItem.buktiUrl,
                `NOTA_BBM_${req.id}.jpg`
              );
              finalReportItem.buktiUrl = uploadRes.viewUrl;
              finalReportItem.buktiFileId = uploadRes.fileId;
            } catch (err: any) {
              console.warn('Gagal unggah foto nota ke Google Drive, menggunakan URL fallback:', err);
            }
          }
        }

        await createBudgetRequest(currentToken, currentSheetId, req);
        await createUsageItem(currentToken, currentSheetId, finalReportItem);
        return finalReportItem;
      },
      'Gagal menyimpan transaksi BBM Duren Sawit.'
    );

    if (savedItem !== null) {
      setRequests(prev => [req, ...prev]);
      setUsageItems(prev => [...prev, savedItem]);
    } else {
      throw new Error('Gagal menyimpan transaksi BBM Duren Sawit. Silakan periksa koneksi atau coba lagi.');
    }
  };

  // Workflow Action 2: Review Budget Request (Manager/Direktur/Finance Action)
  const handleReviewBudget = async (approvedAmount: number, comment: string) => {
    if (!token || !spreadsheetId || !reviewBudgetReq) return;
    const isApprovedFull = approvedAmount === reviewBudgetReq.jumlahPengajuan;
    const isFinance = activeRole === Role.FINANCE || userProfile?.role === Role.FINANCE;

    const updated: BudgetRequest = isFinance ? {
      ...reviewBudgetReq,
      status: RequestStatus.PENDING_PENGAJUAN_TRANSFER,
      managerActionAmount: approvedAmount > 0 ? approvedAmount : (reviewBudgetReq.managerActionAmount || reviewBudgetReq.jumlahPengajuan),
      adminActionAmount: 0,
      adminComment: comment,
    } : {
      ...reviewBudgetReq,
      status: isApprovedFull ? RequestStatus.APPROVED : RequestStatus.PARTIALLY_APPROVED,
      managerActionAmount: approvedAmount,
      managerComment: comment,
      createdAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
    };

    const historyLog: ItemReviewHistory = {
      id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      itemUid: reviewBudgetReq.id,
      requestUid: reviewBudgetReq.id,
      timestamp: formatTimestamp(new Date()),
      actorRole: userProfile?.role || activeRole || (isFinance ? Role.FINANCE : Role.MANAGER),
      actorEmail: userProfile?.email || reviewBudgetReq.managerEmail,
      actorNama: userProfile?.nama || userProfile?.email || (isFinance ? 'Finance' : activeRole === Role.DIREKTUR ? 'Direktur' : 'Manager'),
      actionType: isFinance ? 'APPROVAL_FINANCE' : activeRole === Role.DIREKTUR ? 'APPROVAL_DIREKTUR' : 'APPROVAL_MANAGER',
      status: 'DISETUJUI',
      catatan: comment,
      tanggalPenggunaan: reviewBudgetReq.tanggalPemakaian,
      nominal: approvedAmount,
      keterangan: reviewBudgetReq.keterangan
    };

    const success = await runGoogleAction(
      async () => {
        await updateBudgetRequest(token, spreadsheetId, updated);
        await createItemReviewHistory(token, spreadsheetId, historyLog);
      },
      'Gagal menyimpan persetujuan anggaran.'
    );
    if (success !== null) {
      setItemReviewHistories(prev => [historyLog, ...prev]);
      setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
      setReviewBudgetReq(null);
      await handleManualRefresh();
    }
  };

  const handleRejectBudget = async (reason: string) => {
    if (!token || !spreadsheetId || !reviewBudgetReq) return;
    const isFinance = activeRole === Role.FINANCE || userProfile?.role === Role.FINANCE;

    const updated: BudgetRequest = isFinance ? {
      ...reviewBudgetReq,
      status: RequestStatus.REJECTED,
      adminComment: reason
    } : {
      ...reviewBudgetReq,
      status: RequestStatus.REJECTED,
      managerActionAmount: 0,
      managerComment: reason
    };

    const historyLog: ItemReviewHistory = {
      id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      itemUid: reviewBudgetReq.id,
      requestUid: reviewBudgetReq.id,
      timestamp: formatTimestamp(new Date()),
      actorRole: userProfile?.role || activeRole || (isFinance ? Role.FINANCE : Role.MANAGER),
      actorEmail: userProfile?.email || reviewBudgetReq.managerEmail,
      actorNama: userProfile?.nama || userProfile?.email || (isFinance ? 'Finance' : activeRole === Role.DIREKTUR ? 'Direktur' : 'Manager'),
      actionType: isFinance ? 'REVISI_FINANCE' : activeRole === Role.DIREKTUR ? 'REVISI_DIREKTUR' : 'REVISI_MANAGER',
      status: 'REVISI',
      catatan: reason,
      tanggalPenggunaan: reviewBudgetReq.tanggalPemakaian,
      nominal: reviewBudgetReq.jumlahPengajuan,
      keterangan: reviewBudgetReq.keterangan
    };

    const success = await runGoogleAction(
      async () => {
        await updateBudgetRequest(token, spreadsheetId, updated);
        await createItemReviewHistory(token, spreadsheetId, historyLog);
      },
      'Gagal menolak anggaran.'
    );
    if (success !== null) {
      setItemReviewHistories(prev => [historyLog, ...prev]);
      setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
      setReviewBudgetReq(null);
      await handleManualRefresh();
    }
  };

  // Workflow Action 3: Admin Transfer Funds
  const handleAdminTransfer = async (
    transferredAmount: number,
    buktiUrl: string,
    buktiFileId: string,
    adminComment?: string,
    customAdminActionTime?: string,
    isCloseTransferChecked?: boolean
  ) => {
    if (!token || !spreadsheetId || !transferReq) return;

    const isReqTalangan = transferReq.id.startsWith('OPT-') || transferReq.id.startsWith('BBMDS') || transferReq.id.startsWith('BBM_DurenSawit') || transferReq.tipePengajuan === 'DANA_TALANGAN' || transferReq.keterangan.startsWith('[DANA TALANGAN]');
    const isPendingTalanganTransfer = transferReq.status === RequestStatus.PENDING_TALANGAN_TRANSFER;

    const nowActionTime = customAdminActionTime || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

    // 1. Accumulate total transferred amount
    const prevTransferred = transferReq.adminActionAmount || 0;
    const updatedTotalTransferred = prevTransferred + transferredAmount;

    // 2. Combine URLs and File IDs
    const existingUrls = transferReq.buktiTransferUrl ? transferReq.buktiTransferUrl.split('||').map(u => u.trim()).filter(Boolean) : [];
    if (buktiUrl) existingUrls.push(buktiUrl);
    const combinedBuktiUrl = existingUrls.join('||');

    const existingFileIds = transferReq.buktiTransferFileId ? transferReq.buktiTransferFileId.split('||').map(f => f.trim()).filter(Boolean) : [];
    if (buktiFileId) existingFileIds.push(buktiFileId);
    const combinedFileId = existingFileIds.join('||');

    // 3. Determine target approved amount
    const approvedUsageAmount = usageItems
      .filter(item => item.requestId === transferReq.id && item.statusAdmin === ItemStatus.APPROVED)
      .reduce((sum, item) => sum + item.nominal, 0);

    const finHistories = itemReviewHistories.filter(h => (h.requestUid === transferReq.id || h.itemUid === transferReq.id) && h.actionType === 'APPROVAL_FINANCE');
    let finApprovedNominal = 0;
    if (finHistories.length > 0) {
      finApprovedNominal = finHistories.reduce((s, h) => s + (h.nominal || 0), 0);
    }

    const targetTotal = isReqTalangan
      ? (approvedUsageAmount > 0 ? approvedUsageAmount : transferReq.managerActionAmount)
      : (finApprovedNominal > 0 ? finApprovedNominal : (transferReq.managerActionAmount > 0 ? transferReq.managerActionAmount : transferReq.jumlahPengajuan));

    // 4. Determine status:
    let nextStatus = RequestStatus.TRANSFERRED;
    if (isReqTalangan) {
      if (targetTotal > 0 && updatedTotalTransferred >= targetTotal) {
        nextStatus = RequestStatus.CLOSED;
      } else if (isPendingTalanganTransfer) {
        nextStatus = RequestStatus.PENDING_TALANGAN_TRANSFER;
      }
    } else {
      if ((targetTotal > 0 && updatedTotalTransferred >= targetTotal) || isCloseTransferChecked) {
        nextStatus = RequestStatus.TRANSFERRED;
      } else {
        nextStatus = RequestStatus.TRANSFER_BERTAHAP;
      }
    }

    const updated: BudgetRequest = {
      ...transferReq,
      status: nextStatus,
      adminActionAmount: updatedTotalTransferred,
      buktiTransferUrl: combinedBuktiUrl,
      buktiTransferFileId: combinedFileId,
      adminComment: adminComment || transferReq.adminComment || '',
      adminActionTime: nowActionTime
    };

    const historyLog: ItemReviewHistory = {
      id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      itemUid: transferReq.id,
      requestUid: transferReq.id,
      timestamp: formatTimestamp(new Date()),
      actorRole: userProfile?.role || activeRole || Role.FINANCE,
      actorEmail: userProfile?.email || '',
      actorNama: userProfile?.nama || userProfile?.email || 'Finance',
      actionType: 'APPROVAL_FINANCE',
      status: nextStatus === RequestStatus.CLOSED ? 'CLOSED' : 'TRANSFERRED',
      catatan: adminComment || (nextStatus === RequestStatus.CLOSED ? 'Closing UID Talangan oleh Finance' : `Transfer #${existingUrls.length} sebesar ${formatIDR(transferredAmount)}`),
      tanggalPenggunaan: transferReq.tanggalPemakaian,
      nominal: transferredAmount,
      keterangan: transferReq.keterangan,
      buktiFileId: buktiFileId,
      buktiUrl: buktiUrl
    };

    const success = await runGoogleAction(
      async () => {
        await updateBudgetRequest(token, spreadsheetId, updated);
        await createItemReviewHistory(token, spreadsheetId, historyLog);
      },
      (isReqTalangan && isPendingTalanganTransfer) ? 'Gagal memproses transfer dana talangan.' : 'Gagal memproses transfer anggaran.'
    );
    if (success !== null) {
      if (sharedFilePrefill?.recordId) {
        await deleteSharedReceipt(sharedFilePrefill.recordId);
      }
      await clearAllSharedReceipts();
      setSharedFilePrefill(null);
      setItemReviewHistories(prev => [historyLog, ...prev]);
      setTransferReq(null);
      await handleManualRefresh();
    }
  };

  const handleRejectTransfer = async (reason: string) => {
    if (!token || !spreadsheetId || !transferReq) return;

    const updated: BudgetRequest = {
      ...transferReq,
      status: RequestStatus.REJECTED,
      managerComment: reason,
      adminComment: reason
    };

    const historyLog: ItemReviewHistory = {
      id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      itemUid: transferReq.id,
      requestUid: transferReq.id,
      timestamp: formatTimestamp(new Date()),
      actorRole: userProfile?.role || activeRole || Role.FINANCE,
      actorEmail: userProfile?.email || '',
      actorNama: userProfile?.nama || userProfile?.email || 'Finance',
      actionType: 'REVISI_FINANCE',
      status: 'REVISI',
      catatan: reason,
      tanggalPenggunaan: transferReq.tanggalPemakaian,
      nominal: transferReq.jumlahPengajuan,
      keterangan: transferReq.keterangan
    };

    const success = await runGoogleAction(
      async () => {
        await updateBudgetRequest(token, spreadsheetId, updated);
        await createItemReviewHistory(token, spreadsheetId, historyLog);
      },
      'Gagal meminta revisi pengajuan anggaran.'
    );
    if (success !== null) {
      if (sharedFilePrefill?.recordId) {
        await deleteSharedReceipt(sharedFilePrefill.recordId);
      }
      await clearAllSharedReceipts();
      setSharedFilePrefill(null);
      setItemReviewHistories(prev => [historyLog, ...prev]);
      setTransferReq(null);
      await handleManualRefresh();
    }
  };

  // Workflow Action 4: User Usage Reporting Management
  const handleAddUsageItem = async (newItem: UsageReportItem) => {
    const updatedUsageItems = [...usageItems.filter(i => i.id !== newItem.id), newItem];
    setUsageItems(updatedUsageItems);

    const targetReq = requests.find(r => r.id === newItem.requestId) || (selectedRequest?.id === newItem.requestId ? selectedRequest : null);
    const isTalangan = targetReq && (
      targetReq.id.startsWith('OPT-') ||
      targetReq.id.startsWith('BBMDS') ||
      targetReq.id.startsWith('BBM_DurenSawit') ||
      targetReq.tipePengajuan === 'DANA_TALANGAN' ||
      targetReq.keterangan.startsWith('[DANA TALANGAN]')
    );

    let updatedReq: BudgetRequest | null = null;
    if (targetReq) {
      if (isTalangan) {
        const reqItems = updatedUsageItems.filter(i => i.requestId === targetReq.id);
        const totalNominal = reqItems.reduce((sum, item) => sum + (Number(item.nominal) || 0), 0);
        updatedReq = {
          ...targetReq,
          jumlahPengajuan: totalNominal,
          status: targetReq.status === RequestStatus.TRANSFERRED ? RequestStatus.REPORTING : targetReq.status
        };
      } else if (targetReq.status === RequestStatus.TRANSFERRED) {
        updatedReq = { ...targetReq, status: RequestStatus.REPORTING };
      }
    }

    if (updatedReq) {
      setSelectedRequest(updatedReq);
      setRequests(prev => prev.map(r => r.id === updatedReq!.id ? updatedReq! : r));
    }

    const currentToken = token || 'mock_demo_token';
    const currentSheetId = spreadsheetId || 'mock_sheet_id';
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const createHistoryLog: ItemReviewHistory = {
      id: `IRH-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      itemUid: newItem.id,
      requestUid: newItem.requestId,
      timestamp: timestampStr,
      actorRole: activeRole || userProfile?.role || 'USER',
      actorEmail: userProfile?.email || user?.email || '',
      actorNama: userProfile?.nama || userProfile?.userId || user?.displayName || 'User',
      actionType: 'ITEM_CREATED',
      status: 'PENDING',
      catatan: 'Item laporan baru dibuat oleh user',
      tanggalPenggunaan: newItem.tanggalPenggunaan,
      nominal: newItem.nominal,
      keterangan: newItem.keterangan,
      buktiFileId: newItem.buktiFileId,
      buktiUrl: newItem.buktiUrl
    };

    const success = await runGoogleAction(
      async () => {
        await createUsageItem(currentToken, currentSheetId, newItem);
        if (updatedReq) {
          await updateBudgetRequest(currentToken, currentSheetId, updatedReq);
        }
        await createItemReviewHistory(currentToken, currentSheetId, createHistoryLog);
      },
      'Gagal menambahkan item penggunaan.'
    );

    if (success !== null) {
      setItemReviewHistories(prev => [createHistoryLog, ...prev]);
      await handleManualRefresh();
    }
  };

  const handleUpdateUsageItem = async (updatedItem: UsageReportItem) => {
    const updatedUsageItems = usageItems.map(i => i.id === updatedItem.id ? updatedItem : i);
    setUsageItems(updatedUsageItems);

    const targetReq = requests.find(r => r.id === updatedItem.requestId) || (selectedRequest?.id === updatedItem.requestId ? selectedRequest : null);
    const isTalangan = targetReq && (
      targetReq.id.startsWith('OPT-') ||
      targetReq.id.startsWith('BBMDS') ||
      targetReq.id.startsWith('BBM_DurenSawit') ||
      targetReq.tipePengajuan === 'DANA_TALANGAN' ||
      targetReq.keterangan.startsWith('[DANA TALANGAN]')
    );

    let updatedReq: BudgetRequest | null = null;
    if (targetReq) {
      if (isTalangan) {
        const reqItems = updatedUsageItems.filter(i => i.requestId === targetReq.id);
        const totalNominal = reqItems.reduce((sum, item) => sum + (Number(item.nominal) || 0), 0);
        updatedReq = {
          ...targetReq,
          jumlahPengajuan: totalNominal,
          status: targetReq.status === RequestStatus.TRANSFERRED ? RequestStatus.REPORTING : targetReq.status
        };
      } else if (targetReq.status === RequestStatus.TRANSFERRED) {
        updatedReq = { ...targetReq, status: RequestStatus.REPORTING };
      }
    }

    if (updatedReq) {
      setSelectedRequest(updatedReq);
      setRequests(prev => prev.map(r => r.id === updatedReq!.id ? updatedReq! : r));
    }

    const currentToken = token || 'mock_demo_token';
    const currentSheetId = spreadsheetId || 'mock_sheet_id';
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const editHistoryLog: ItemReviewHistory = {
      id: `IRH-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      itemUid: updatedItem.id,
      requestUid: updatedItem.requestId,
      timestamp: timestampStr,
      actorRole: activeRole || userProfile?.role || 'USER',
      actorEmail: userProfile?.email || user?.email || '',
      actorNama: userProfile?.nama || userProfile?.userId || user?.displayName || 'User',
      actionType: 'PERBAIKAN_USER',
      status: 'PERBAIKAN',
      catatan: 'Perbaikan item/bukti nota dilakukan oleh user',
      tanggalPenggunaan: updatedItem.tanggalPenggunaan,
      nominal: updatedItem.nominal,
      keterangan: updatedItem.keterangan,
      buktiFileId: updatedItem.buktiFileId,
      buktiUrl: updatedItem.buktiUrl
    };

    const success = await runGoogleAction(
      async () => {
        await updateUsageItem(currentToken, currentSheetId, updatedItem);
        if (updatedReq) {
          await updateBudgetRequest(currentToken, currentSheetId, updatedReq);
        }
        await createItemReviewHistory(currentToken, currentSheetId, editHistoryLog);
      },
      'Gagal memperbarui item penggunaan.'
    );

    if (success !== null) {
      setItemReviewHistories(prev => [editHistoryLog, ...prev]);
      await handleManualRefresh();
    }
  };


  const handleDeleteUsageItem = async (itemId: string) => {
    const deletedItem = usageItems.find(i => i.id === itemId);
    const updatedUsageItems = usageItems.filter(i => i.id !== itemId);
    setUsageItems(updatedUsageItems);

    let updatedReq: BudgetRequest | null = null;
    if (deletedItem) {
      const targetReq = requests.find(r => r.id === deletedItem.requestId) || (selectedRequest?.id === deletedItem.requestId ? selectedRequest : null);
      const isTalangan = targetReq && (
        targetReq.id.startsWith('OPT-') ||
        targetReq.id.startsWith('BBMDS') ||
        targetReq.id.startsWith('BBM_DurenSawit') ||
        targetReq.tipePengajuan === 'DANA_TALANGAN' ||
        targetReq.keterangan.startsWith('[DANA TALANGAN]')
      );
      if (isTalangan && targetReq) {
        const reqItems = updatedUsageItems.filter(i => i.requestId === targetReq.id);
        const totalNominal = reqItems.reduce((sum, item) => sum + (Number(item.nominal) || 0), 0);
        updatedReq = {
          ...targetReq,
          jumlahPengajuan: totalNominal
        };
        setSelectedRequest(updatedReq);
        setRequests(prev => prev.map(r => r.id === updatedReq!.id ? updatedReq! : r));
      }
    }

    const currentToken = token || 'mock_demo_token';
    const currentSheetId = spreadsheetId || 'mock_sheet_id';

    if (token && spreadsheetId) {
      const success = await runGoogleAction(
        async () => {
          await deleteUsageItem(currentToken, currentSheetId, itemId);
          if (updatedReq) {
            await updateBudgetRequest(currentToken, currentSheetId, updatedReq);
          }
        },
        'Gagal menghapus item penggunaan.'
      );
      if (success !== null) {
        await handleManualRefresh();
      }
    }
  };

  const handleSubmitUsageReport = async (req: BudgetRequest) => {
    if (!token || !spreadsheetId) return;
    const updatedReq: BudgetRequest = {
      ...req,
      status: RequestStatus.REVIEW_MANAGER
    };
    const success = await runGoogleAction(
      () => updateBudgetRequest(token, spreadsheetId, updatedReq),
      'Gagal mengirim laporan penggunaan.'
    );
    if (success !== null) {
      setSelectedRequest(null);
      setActiveView('dashboard');
      await handleManualRefresh();
    }
  };

  const handleSaveActivity = async (
    activityData: {
      tanggal: string;
      siteId: string;
      siteName: string;
      coordinatesDb: string;
      coordinatesActual: string;
      keterangan: string;
      indikasiFake?: boolean;
      fakeReason?: string;
    },
    photoFile?: File
  ) => {
    if (!token || !spreadsheetId) {
      throw new Error('Koneksi database tidak aktif. Hubungkan Google Account Anda.');
    }

    const rawCoord = (activityData.coordinatesActual || '').trim().toLowerCase();
    const isInvalidGps = !rawCoord || rawCoord.includes('tidak') || rawCoord.includes('belum') || rawCoord.includes('gagal') || rawCoord.includes('error');
    if (isInvalidGps) {
      throw new Error('Data koordinat GPS wajib ada untuk menyimpan Log Kegiatan Harian.');
    }

    let finalBuktiUrl = '';
    let finalBuktiFileId = '';

    if (photoFile) {
      if (token === 'mock_demo_token') {
        // Read file as base64 for local preview
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
        });
        reader.readAsDataURL(photoFile);
        finalBuktiUrl = await base64Promise;
      } else {
        const uploadResult = await uploadReceiptFile(token, driveFolderId, photoFile);
        finalBuktiUrl = uploadResult.viewUrl;
        finalBuktiFileId = uploadResult.fileId;
      }
    }

    const todayStr = activityData.tanggal.replace(/-/g, '');
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const activityId = `ACT-${todayStr}-${randomDigits}`;

    const newActivity: UserActivity = {
      id: activityId,
      userEmail: userProfile?.email || user?.email || '',
      tanggal: activityData.tanggal,
      createdAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
      siteId: activityData.siteId,
      siteName: activityData.siteName,
      coordinatesDb: activityData.coordinatesDb,
      coordinatesActual: activityData.coordinatesActual,
      keterangan: activityData.keterangan,
      buktiUrl: finalBuktiUrl,
      buktiFileId: finalBuktiFileId || undefined,
      indikasiFake: activityData.indikasiFake ?? false,
      fakeReason: activityData.fakeReason || ''
    };

    await createUserActivity(token, spreadsheetId, newActivity);

    // Refresh activities state
    const allActs = await fetchUserActivities(token, spreadsheetId);
    setActivities(allActs);
    localStorage.setItem('op_app_cached_activities', JSON.stringify(allActs));
  };

  const handleUpdateActivity = async (updatedActivity: UserActivity) => {
    const currentToken = token || 'mock_demo_token';
    const currentSheetId = spreadsheetId || 'mock_sheet_id';

    // Optimistic UI state update
    setActivities(prev => prev.map(a => a.id.toUpperCase() === updatedActivity.id.toUpperCase() ? { ...a, ...updatedActivity } : a));

    try {
      await updateUserActivity(currentToken, currentSheetId, updatedActivity);
      const allActs = await fetchUserActivities(currentToken, currentSheetId);
      setActivities(allActs);
      localStorage.setItem('op_app_cached_activities', JSON.stringify(allActs));
    } catch (err) {
      console.error('Error updating activity in database:', err);
    }
  };

  // Workflow Action 5: Review Usage Items (Manager/Admin Action)
  const handleReviewUsageItems = async (
    itemDecisions: { itemId: string; status: ItemStatus; comment: string }[],
    nextRequestStatus: RequestStatus,
    targetReq?: BudgetRequest
  ) => {
    const reqToUse = targetReq || reviewReportReq || selectedRequest;
    const currentToken = token || 'mock_demo_token';
    const currentSheetId = spreadsheetId || 'mock_sheet_id';

    if (!reqToUse) return;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const isManager = activeRole === Role.MANAGER || activeRole === Role.DIREKTUR;
    const historyLogs: ItemReviewHistory[] = [];

    const success = await runGoogleAction(async () => {
      const targetItems = usageItems.filter(i => i.requestId === reqToUse.id);
      for (const dec of itemDecisions) {
        const original = targetItems.find(i => i.id === dec.itemId);
        if (original) {
          const updatedItem: UsageReportItem = {
            ...original,
            statusManager: isManager ? dec.status : original.statusManager,
            managerComment: isManager ? dec.comment : original.managerComment,
            statusAdmin: !isManager ? dec.status : original.statusAdmin,
            adminComment: !isManager ? dec.comment : original.adminComment,
            updatedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
          };
          await updateUsageItem(currentToken, currentSheetId, updatedItem);

          const actionType = isManager
            ? (dec.status === ItemStatus.APPROVED 
                ? (activeRole === Role.DIREKTUR ? 'APPROVAL_DIREKTUR' : 'APPROVAL_MANAGER') 
                : (activeRole === Role.DIREKTUR ? 'REVISI_DIREKTUR' : 'REVISI_MANAGER'))
            : (dec.status === ItemStatus.APPROVED ? 'APPROVAL_FINANCE' : 'REVISI_FINANCE');

          historyLogs.push({
            id: `IRH-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
            itemUid: original.id,
            requestUid: original.requestId,
            timestamp: timestampStr,
            actorRole: activeRole || (isManager ? 'MANAGER' : 'FINANCE'),
            actorEmail: userProfile?.email || user?.email || '',
            actorNama: userProfile?.nama || userProfile?.userId || user?.displayName || (activeRole === Role.DIREKTUR ? 'Direktur' : isManager ? 'Manager' : 'Finance'),
            actionType: actionType as any,
            status: dec.status,
            catatan: dec.comment || (dec.status === ItemStatus.APPROVED ? 'Disetujui' : 'Minta Revisi'),
            tanggalPenggunaan: original.tanggalPenggunaan,
            nominal: original.nominal,
            keterangan: original.keterangan,
            buktiFileId: original.buktiFileId,
            buktiUrl: original.buktiUrl
          });
        }
      }

      if (historyLogs.length > 0) {
        await createBatchItemReviewHistories(currentToken, currentSheetId, historyLogs);
      }

      const isReqTalangan = reqToUse.id.startsWith('OPT-') || 
                            reqToUse.id.startsWith('BBMDS') || 
                            reqToUse.id.startsWith('BBM_DurenSawit') || 
                            reqToUse.tipePengajuan === 'DANA_TALANGAN' || 
                            reqToUse.keterangan.startsWith('[DANA TALANGAN]');

      let updatedManagerActionAmount = reqToUse.managerActionAmount;
      let updatedManagerComment = reqToUse.managerComment;

      if (isManager) {
        // Calculate total nominal of all items approved by Manager for this request
        const totalApprovedByManager = targetItems.reduce((sum, item) => {
          const dec = itemDecisions.find(d => d.itemId === item.id);
          const finalStatus = dec ? dec.status : item.statusManager;
          return finalStatus === ItemStatus.APPROVED ? sum + (Number(item.nominal) || 0) : sum;
        }, 0);

        if (isReqTalangan) {
          updatedManagerActionAmount = totalApprovedByManager;
          const comments = itemDecisions
            .filter(d => d.comment && d.comment.trim().length > 0)
            .map(d => d.comment.trim());
          if (comments.length > 0) {
            updatedManagerComment = comments.join('; ');
          }
        }
      }

      const updatedReq: BudgetRequest = {
        ...reqToUse,
        status: nextRequestStatus,
        managerActionAmount: updatedManagerActionAmount,
        managerComment: updatedManagerComment
      };
      await updateBudgetRequest(currentToken, currentSheetId, updatedReq);
    }, 'Gagal memproses review penggunaan.');

    if (success !== null) {
      if (historyLogs.length > 0) {
        setItemReviewHistories(prev => [...historyLogs, ...prev]);
      }
      setReviewReportReq(null);
      setSelectedRequest(null);
      setActiveView('dashboard');
      await handleManualRefresh();

      // Check if Finance approved all items for standard request => open dedicated Form Closing modal
      const allApprovedByFinance = itemDecisions.length > 0 && itemDecisions.every(d => d.status === ItemStatus.APPROVED);
      const isTalangan = reqToUse.id.startsWith('OPT-') || reqToUse.id.startsWith('BBMDS') || reqToUse.id.startsWith('BBM_DurenSawit') || reqToUse.tipePengajuan === 'DANA_TALANGAN' || reqToUse.keterangan.startsWith('[DANA TALANGAN]');

      if (activeRole === Role.FINANCE && allApprovedByFinance && !isTalangan && nextRequestStatus !== RequestStatus.CLOSED) {
        setClosingConfirmReq(reqToUse);
      }
    }
  };


  // Workflow Action 6: Closing Process (Admin Action)
  const handleCloseRequest = async (req: BudgetRequest) => {
    if (!token || !spreadsheetId) return;
    const updatedReq: BudgetRequest = {
      ...req,
      status: RequestStatus.CLOSED
    };
    const success = await runGoogleAction(
      () => updateBudgetRequest(token, spreadsheetId, updatedReq),
      'Gagal menutup laporan.'
    );
    if (success !== null) {
      await handleManualRefresh();
    }
  };

  const handleUpdateTransferDetails = async (
    requestId: string,
    adminComment: string,
    file: File | null
  ) => {
    if (!token || !spreadsheetId) return;
    const targetReq = requests.find(r => r.id === requestId);
    if (!targetReq) return;

    let finalBuktiUrl = targetReq.buktiTransferUrl || '';
    let finalBuktiFileId = targetReq.buktiTransferFileId || '';

    if (file) {
      if (!driveFolderId) {
        throw new Error('ID Folder Google Drive belum terinisialisasi.');
      }
      const uploadResult = await uploadReceiptFile(token, driveFolderId, file);
      const existingUrls = targetReq.buktiTransferUrl ? targetReq.buktiTransferUrl.split('||').map(u => u.trim()).filter(Boolean) : [];
      existingUrls.push(uploadResult.viewUrl);
      finalBuktiUrl = existingUrls.join('||');

      const existingFileIds = targetReq.buktiTransferFileId ? targetReq.buktiTransferFileId.split('||').map(f => f.trim()).filter(Boolean) : [];
      existingFileIds.push(uploadResult.fileId);
      finalBuktiFileId = existingFileIds.join('||');
    }

    const updatedReq: BudgetRequest = {
      ...targetReq,
      adminComment,
      buktiTransferUrl: finalBuktiUrl,
      buktiTransferFileId: finalBuktiFileId,
      adminActionTime: targetReq.adminActionTime || new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
    };

    const success = await runGoogleAction(
      () => updateBudgetRequest(token, spreadsheetId, updatedReq),
      'Gagal memperbarui data transfer.'
    );
    if (success !== null) {
      await handleManualRefresh();
    }
  };

  // Filter manager email list from existing profiles to make it easy for users to choose
  const managerEmails = profiles
    .filter(p => p.role === Role.MANAGER || p.role === Role.DIREKTUR)
    .map(p => p.email);

  const parseIndonesianDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    const datePart = dateStr.split(',')[0].trim();
    
    if (datePart.includes('/')) {
      const parts = datePart.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          return new Date(year, month, day);
        }
      }
    }

    if (datePart.includes('-')) {
      const parts = datePart.split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          const year = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const day = parseInt(parts[2], 10);
          return new Date(year, month, day);
        } else {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const year = parseInt(parts[2], 10);
          return new Date(year, month, day);
        }
      }
    }

    const parsed = Date.parse(dateStr);
    return isNaN(parsed) ? null : new Date(parsed);
  };

  const getClosingDate = (req: BudgetRequest): Date | null => {
    const reqItems = usageItems.filter(i => i.requestId === req.id);
    if (reqItems.length > 0) {
      const dates = reqItems
        .map(i => i.updatedAt)
        .filter(Boolean)
        .map(d => parseIndonesianDate(d))
        .filter((d): d is Date => d !== null);
      if (dates.length > 0) {
        return new Date(Math.max(...dates.map(d => d.getTime())));
      }
    }
    return parseIndonesianDate(req.createdAt);
  };

  const getRequestCreatedDate = (req: BudgetRequest): Date | null => {
    const dateStr = req.timestamp || req.createdAt;
    if (!dateStr) return null;
    const indonesianDate = parseIndonesianDate(dateStr);
    if (indonesianDate && !isNaN(indonesianDate.getTime())) return indonesianDate;
    const parsed = Date.parse(dateStr);
    return isNaN(parsed) ? null : new Date(parsed);
  };

  // Auto-cancel REJECTED requests older than 2 days (48 hours)
  useEffect(() => {
    if (!token || !spreadsheetId || requests.length === 0) return;

    const now = new Date().getTime();
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

    const expiredReqs = requests.filter(r => {
      if (r.status !== RequestStatus.REJECTED) return false;
      const cDate = getRequestCreatedDate(r);
      if (!cDate) return false;
      return (now - cDate.getTime()) >= TWO_DAYS_MS;
    });

    if (expiredReqs.length > 0) {
      const processAutoCancel = async () => {
        const expiredIds = new Set(expiredReqs.map(r => r.id));
        setRequests(prev => prev.map(r => expiredIds.has(r.id) ? { ...r, status: RequestStatus.CANCELLED } : r));

        for (const req of expiredReqs) {
          try {
            await updateBudgetRequest(token, spreadsheetId, {
              ...req,
              status: RequestStatus.CANCELLED
            });
          } catch (err) {
            console.error(`Auto-cancel failed for request ${req.id}:`, err);
          }
        }
      };
      processAutoCancel();
    }
  }, [requests, token, spreadsheetId]);

  const handleCancelBudgetRequest = async (req: BudgetRequest) => {
    if (!token || !spreadsheetId) return;
    setIsLoading(true);
    setLoadingStep('Membatalkan pengajuan dana...');
    try {
      const updatedReq: BudgetRequest = {
        ...req,
        status: RequestStatus.CANCELLED
      };
      const historyLog: ItemReviewHistory = {
        id: `HIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        itemUid: req.id,
        requestUid: req.id,
        timestamp: formatTimestamp(new Date()),
        actorRole: userProfile?.role || activeRole || Role.USER,
        actorEmail: userProfile?.email || req.userEmail,
        actorNama: userProfile?.nama || userProfile?.email || req.userEmail,
        actionType: 'PERBAIKAN_USER',
        status: 'CANCELLED',
        catatan: 'Pengajuan dibatalkan oleh pemohon',
        tanggalPenggunaan: req.tanggalPemakaian,
        nominal: req.jumlahPengajuan,
        keterangan: req.keterangan
      };

      await updateBudgetRequest(token, spreadsheetId, updatedReq);
      await createItemReviewHistory(token, spreadsheetId, historyLog);
      setItemReviewHistories(prev => [historyLog, ...prev]);
      setRequests(prev => prev.map(r => r.id === req.id ? updatedReq : r));
      setCancelConfirmReq(null);
    } catch (err: any) {
      setError(`Gagal membatalkan pengajuan: ${err.message || err}`);
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  // Filtering Logic for requests list on Dashboard
  const filteredRequests = requests.filter((r) => {
    // Exclude CANCELLED requests from all main views
    if (r.status === RequestStatus.CANCELLED) return false;

    // Role based scoping
    if (activeRole === Role.USER || ((activeRole === Role.MANAGER || activeRole === Role.FINANCE) && dashboardTab === 'SUBMISSION')) {
      // User only sees their own requests in submission mode
      if (r.userEmail.toLowerCase() !== userProfile?.email?.toLowerCase()) return false;
    } else if (activeRole === Role.MANAGER) {
      // Manager sees requests assigned to them
      if (userProfile?.email && r.managerEmail.toLowerCase() !== userProfile?.email?.toLowerCase()) return false;
    }
    // DIREKTUR, FINANCE & ADMINISTRATOR see all requests across the organization!
    // Finance sees everything in APPROVAL mode!
    if (activeRole === Role.FINANCE && dashboardTab !== 'SUBMISSION') {
      if ((r.status === RequestStatus.REVIEW_ADMIN || r.status === RequestStatus.REPORTING) && statusFilter === 'REPORTING') {
        const reqItems = usageItems.filter(i => i.requestId === r.id);
        if (reqItems.length === 0 || !reqItems.every(i => i.statusManager === ItemStatus.APPROVED)) {
          return false;
        }
      }
    }

    // Text search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchId = r.id.toLowerCase().includes(query);
      const matchDesc = r.keterangan.toLowerCase().includes(query);
      const matchSite = r.siteId.toLowerCase().includes(query);
      const matchUser = r.userEmail.toLowerCase().includes(query);

      const requesterProfile = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
      const matchName = requesterProfile?.nama ? requesterProfile.nama.toLowerCase().includes(query) : false;
      const matchUserId = requesterProfile?.userId ? requesterProfile.userId.toLowerCase().includes(query) : false;
      const matchDivisi = requesterProfile?.divisi ? requesterProfile.divisi.toLowerCase().includes(query) : false;

      if (!matchId && !matchDesc && !matchSite && !matchUser && !matchName && !matchUserId && !matchDivisi) return false;
    }

    // DIREKTUR Role UID Filter: APPROVAL group = direct subordinates (MANAGER & FINANCE), MONITORING group = all other UIDs
    if (activeRole === Role.DIREKTUR) {
      const direkturEmails = new Set<string>([
        'margono@depotel.com',
        'direktur@company.com'
      ]);
      profiles
        .filter(p => p.role === Role.DIREKTUR)
        .forEach(p => {
          if (p.email) direkturEmails.add(p.email.trim().toLowerCase());
        });
      if (userProfile?.email) direkturEmails.add(userProfile.email.trim().toLowerCase());

      const reqManagerEmail = (r.managerEmail || '').trim().toLowerCase();
      const requesterProfile = profiles.find(p => p.email.trim().toLowerCase() === (r.userEmail || '').trim().toLowerCase());
      const profileMgrEmail = (requesterProfile?.managerEmail || '').trim().toLowerCase();

      const isDirectSubordinate = 
        (requesterProfile?.role === Role.MANAGER || requesterProfile?.role === Role.FINANCE) ||
        (reqManagerEmail && (
          direkturEmails.has(reqManagerEmail) || 
          reqManagerEmail.includes('margono') || 
          reqManagerEmail.includes('direktur') || 
          (userProfile?.email && reqManagerEmail === userProfile.email.trim().toLowerCase())
        )) ||
        (profileMgrEmail && (
          direkturEmails.has(profileMgrEmail) || 
          profileMgrEmail.includes('margono') || 
          profileMgrEmail.includes('direktur') || 
          (userProfile?.email && profileMgrEmail === userProfile.email.trim().toLowerCase())
        ));

      if (statusFilter === 'DIREKTUR_APPROVAL' || statusFilter === 'DIREKTUR_RECONCILIATION') {
        if (!isDirectSubordinate) return false;
      }
    }

    // Status Filter
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'DIREKTUR_APPROVAL') {
        if (r.status !== RequestStatus.PENDING_APPROVAL && r.status !== RequestStatus.PARTIALLY_APPROVED) return false;
      } else if (statusFilter === 'DIREKTUR_RECONCILIATION') {
        if (![RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN, RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP].includes(r.status)) return false;
        const reqItems = usageItems.filter(i => i.requestId === r.id);
        if (reqItems.length === 0) return false;
        if (!reqItems.some(i => i.statusManager === ItemStatus.PENDING)) return false;
      } else if (statusFilter === 'PENDING') {
        if (activeRole === Role.MANAGER && dashboardTab === 'APPROVAL') {
          if (r.status !== RequestStatus.PENDING_APPROVAL) return false;
          if (!isOpBiasaRequest(r)) return false;
        } else if (activeRole === Role.FINANCE && dashboardTab !== 'SUBMISSION') {
          if (!isOpBiasaRequest(r)) return false;
          if (r.status !== RequestStatus.APPROVED && r.status !== RequestStatus.PARTIALLY_APPROVED) return false;
          if (isFinanceApprovedOpRequest(r, itemReviewHistories)) return false;
        } else {
          const isPendingManager = r.status === RequestStatus.PENDING_APPROVAL;
          const isPendingFinance = isOpBiasaRequest(r) && (r.status === RequestStatus.APPROVED || r.status === RequestStatus.PARTIALLY_APPROVED) && !isFinanceApprovedOpRequest(r, itemReviewHistories);
          if (!isPendingManager && !isPendingFinance) return false;
        }
      } else if (statusFilter === 'APPROVED') {
        if (!isPendingTransferRequest(r, itemReviewHistories, usageItems)) return false;
      } else if (statusFilter === 'TRANSFERRED') {
        if (r.status !== RequestStatus.TRANSFERRED && r.status !== RequestStatus.TRANSFER_BERTAHAP) return false;
      } else if (statusFilter === 'REPORTING') {
        // For USER or SUBMISSION tab, "Proses Laporan" displays requests currently in reporting / review process
        if (activeRole === Role.USER || dashboardTab === 'SUBMISSION') {
          if (r.status !== RequestStatus.REPORTING &&
              r.status !== RequestStatus.REVIEW_MANAGER &&
              r.status !== RequestStatus.REVIEW_ADMIN &&
              r.status !== RequestStatus.TRANSFERRED &&
              r.status !== RequestStatus.TRANSFER_BERTAHAP) return false;
        } else if (activeRole === Role.MANAGER) {
          if (![RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN, RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP].includes(r.status)) return false;
          const reqItems = usageItems.filter(i => i.requestId === r.id);
          if (reqItems.length === 0) return false;
          return reqItems.some(i => i.statusManager === ItemStatus.PENDING);
        } else if (activeRole === Role.FINANCE) {
          if (r.status !== RequestStatus.REVIEW_ADMIN && r.status !== RequestStatus.REPORTING) return false;
          const reqItems = usageItems.filter(i => i.requestId === r.id);
          if (reqItems.length === 0) return false;
          if (reqItems.some(i => i.statusAdmin === ItemStatus.REJECTED)) return false;
          const managerApproved = reqItems.every(i => i.statusManager === ItemStatus.APPROVED);
          if (!managerApproved) return false;
        } else if (activeRole === Role.DIREKTUR) {
          if (![RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(r.status)) return false;
        } else {
          if (r.status !== RequestStatus.REPORTING && r.status !== RequestStatus.REVIEW_MANAGER && r.status !== RequestStatus.REVIEW_ADMIN) return false;
        }
      } else if (statusFilter === 'CLOSED') {
        if (r.status !== RequestStatus.CLOSED) return false;
        if (r.id.startsWith('BBMDS') || r.id.startsWith('BBM_DurenSawit')) return false;

        // User filter
        if (closedUserFilter !== 'ALL') {
          if (r.userEmail.toLowerCase() !== closedUserFilter.toLowerCase()) return false;
        }

        // Division filter
        if (closedDivisiFilter !== 'ALL') {
          const reqProfile = profiles.find(p => p.email.toLowerCase() === r.userEmail.toLowerCase());
          const divisi = reqProfile?.divisi || '';
          if (divisi.toLowerCase() !== closedDivisiFilter.toLowerCase()) return false;
        }

        // Closing date range filter
        if (closedStartDateFilter || closedEndDateFilter) {
          const closingDate = getClosingDate(r);
          if (closingDate) {
            if (closedStartDateFilter) {
              const start = new Date(closedStartDateFilter);
              start.setHours(0, 0, 0, 0);
              if (closingDate < start) return false;
            }
            if (closedEndDateFilter) {
              const end = new Date(closedEndDateFilter);
              end.setHours(23, 59, 59, 999);
              if (closingDate > end) return false;
            }
          } else {
            return false;
          }
        }
      } else if (statusFilter === 'REJECTED') {
        const isReqRejected = r.status === RequestStatus.REJECTED;
        const hasAdminRejectedItems = usageItems.some(i => i.requestId === r.id && i.statusAdmin === ItemStatus.REJECTED);
        if (!isReqRejected && !hasAdminRejectedItems) return false;
      }
    }

    return true;
  });

  const sortedRequests = [...filteredRequests].sort((a, b) => {
    if (activeRole === Role.FINANCE && (statusFilter === 'APPROVED' || statusFilter === RequestStatus.APPROVED)) {
      const timeA = getRequestCreatedDate(a)?.getTime() || 0;
      const timeB = getRequestCreatedDate(b)?.getTime() || 0;
      if (timeA !== timeB) {
        return timeA - timeB; // Oldest at the top
      }
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    }
    return 0;
  });

  const getStatusBadgeStyles = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.PENDING_APPROVAL:
        return 'bg-amber-50 text-amber-600 border border-amber-150';
      case RequestStatus.APPROVED:
      case RequestStatus.PARTIALLY_APPROVED:
        return 'bg-blue-50 text-blue-600 border border-blue-150';
      case RequestStatus.REJECTED:
        return 'bg-amber-50 text-amber-700 border border-amber-200';
      case RequestStatus.TRANSFERRED:
        return 'bg-emerald-50 text-emerald-600 border border-emerald-150';
      case RequestStatus.REPORTING:
        return 'bg-purple-50 text-purple-600 border border-purple-150';
      case RequestStatus.REVIEW_MANAGER:
        return 'bg-indigo-50 text-indigo-600 border border-indigo-150';
      case RequestStatus.REVIEW_ADMIN:
        return 'bg-cyan-50 text-cyan-600 border border-cyan-150';
      case RequestStatus.PENDING_TALANGAN_TRANSFER:
        return 'bg-pink-50 text-pink-600 border border-pink-150 animate-pulse';
      case RequestStatus.PENDING_PENGAJUAN_TRANSFER:
        return 'bg-blue-50 text-blue-600 border border-blue-150 animate-pulse';
      case RequestStatus.TRANSFER_BERTAHAP:
        return 'bg-amber-50 text-amber-700 border border-amber-200 animate-pulse';
      case RequestStatus.CLOSED:
        return 'bg-slate-100 text-slate-500 border border-slate-200';
      case RequestStatus.CANCELLED:
        return 'bg-slate-100 text-slate-400 border border-slate-200 line-through';
      default:
        return 'bg-slate-50 text-slate-600 border border-slate-150';
    }
  };

  const getStatusTextColor = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.PENDING_APPROVAL:
        return 'text-amber-600';
      case RequestStatus.APPROVED:
      case RequestStatus.PARTIALLY_APPROVED:
        return 'text-blue-600';
      case RequestStatus.REJECTED:
        return 'text-amber-700';
      case RequestStatus.TRANSFERRED:
        return 'text-emerald-600';
      case RequestStatus.REPORTING:
        return 'text-purple-600';
      case RequestStatus.REVIEW_MANAGER:
        return 'text-indigo-600';
      case RequestStatus.REVIEW_ADMIN:
        return 'text-cyan-600';
      case RequestStatus.PENDING_TALANGAN_TRANSFER:
        return 'text-pink-600 animate-pulse';
      case RequestStatus.PENDING_PENGAJUAN_TRANSFER:
        return 'text-blue-600 animate-pulse';
      case RequestStatus.TRANSFER_BERTAHAP:
        return 'text-amber-700 font-bold animate-pulse';
      case RequestStatus.CLOSED:
        return 'text-slate-500';
      case RequestStatus.CANCELLED:
        return 'text-slate-400 line-through';
      default:
        return 'text-slate-600';
    }
  };

  const getLeftBorderColor = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.PENDING_APPROVAL:
        return 'border-l-amber-500';
      case RequestStatus.APPROVED:
      case RequestStatus.PARTIALLY_APPROVED:
        return 'border-l-blue-500';
      case RequestStatus.REJECTED:
        return 'border-l-amber-500';
      case RequestStatus.TRANSFERRED:
        return 'border-l-emerald-500';
      case RequestStatus.REPORTING:
        return 'border-l-purple-500';
      case RequestStatus.REVIEW_MANAGER:
        return 'border-l-indigo-500';
      case RequestStatus.REVIEW_ADMIN:
        return 'border-l-cyan-500';
      case RequestStatus.PENDING_TALANGAN_TRANSFER:
        return 'border-l-pink-500';
      case RequestStatus.PENDING_PENGAJUAN_TRANSFER:
        return 'border-l-blue-500';
      case RequestStatus.TRANSFER_BERTAHAP:
        return 'border-l-amber-500';
      case RequestStatus.CLOSED:
        return 'border-l-slate-400';
      default:
        return 'border-l-slate-300';
    }
  };

  const getStatusLabel = (status: RequestStatus, userEmail?: string) => {
    let requesterProfile = userEmail ? profiles.find(p => p.email.trim().toLowerCase() === userEmail.trim().toLowerCase()) : null;
    if (!requesterProfile && userProfile) {
      if (activeRole === Role.MANAGER || activeRole === Role.FINANCE) {
        if (dashboardTab === 'SUBMISSION') {
          requesterProfile = userProfile;
        }
      }
    }
    const isRequesterManagerOrFinance = requesterProfile ? (requesterProfile.role === Role.MANAGER || requesterProfile.role === Role.FINANCE) : false;
    const supervisorTitle = isRequesterManagerOrFinance ? 'Direktur' : 'Manager';

    switch (status) {
      case RequestStatus.PENDING_APPROVAL: return `Menunggu Review ${supervisorTitle}`;
      case RequestStatus.APPROVED: return `Disetujui oleh ${supervisorTitle}`;
      case RequestStatus.PARTIALLY_APPROVED: return `Disetujui Sebagian oleh ${supervisorTitle}`;
      case RequestStatus.REJECTED: return `Diminta Revisi ${supervisorTitle}`;
      case RequestStatus.TRANSFERRED: return 'Dana Ditransfer Finance';
      case RequestStatus.REPORTING: return 'Pelaporan Penggunaan';
      case RequestStatus.REVIEW_MANAGER: return `Review Laporan (${supervisorTitle})`;
      case RequestStatus.REVIEW_ADMIN: return 'Review Laporan (Finance)';
      case RequestStatus.PENDING_TALANGAN_TRANSFER: return 'Menunggu Transfer Dana Talangan';
      case RequestStatus.PENDING_PENGAJUAN_TRANSFER: return 'Menunggu Transfer Anggaran';
      case RequestStatus.TRANSFER_BERTAHAP: return 'TRANSFER BERTAHAP';
      case RequestStatus.CLOSED: return 'Closing';
      case RequestStatus.CANCELLED: return 'Dibatalkan (Cancelled)';
      default: return status;
    }
  };

  const formatIDR = (num: any) => {
    const val = parseNumericValue(num);
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(val);
  };

  // Render Login state only if the Google Account is explicitly invalid
  if (isInvalidGoogleAccount) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-xl p-6 text-center space-y-6 animate-slide-up">
          {/* Logo illustration */}
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto shadow-md border border-indigo-100">
            <XCircle className="w-8 h-8 text-red-600 animate-pulse" />
          </div>

          <div>
            <h1 className="font-display font-black text-slate-800 text-base tracking-tight">
              Akun Google Salah
            </h1>
          </div>

          <div className="bg-red-50 border border-red-200 text-red-900 rounded-2xl p-4 text-xs text-left space-y-4 animate-slide-up">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-red-800 text-xs">Akses Ditolak</h3>
                <p className="text-[11px] text-red-700 mt-1 leading-relaxed">
                  Anda masuk menggunakan akun <strong className="break-all font-mono">{user?.email}</strong>.
                </p>
                <p className="text-[11px] text-red-700 mt-1.5 leading-relaxed">
                  Semua user wajib menghubungkan Google Account melalui email operasional pusat:
                </p>
                <p className="font-bold font-mono text-[11px] bg-red-100/50 p-1.5 rounded border border-red-200 text-red-900 mt-1.5 text-center">
                  ops.depotel@gmail.com
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-red-200/50">
              <button
                onClick={async () => {
                  await logout();
                  setToken(null);
                  setUser(null);
                  setNeedsAuth(true);
                }}
                className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-[11px] rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer text-center"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Ganti ke Akun ops.depotel@gmail.com</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render Google Account Connection block if Google is not connected
  if (!user || !token || needsAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-xl p-6 text-center space-y-6 animate-slide-up">
          {/* Logo illustration */}
          <div className="flex items-center justify-center mx-auto py-1">
            <img
              src="/DIOMS-1.png"
              alt="DIOMS Logo"
              className="h-14 w-auto object-contain"
              referrerPolicy="no-referrer"
            />
          </div>

          <div className="space-y-2">
            <h1 className="font-display font-black text-slate-800 text-sm sm:text-base tracking-tight leading-snug">
              Depotel Integrated Operation Monitoring System
            </h1>
          </div>

          <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-2xl p-4 text-xs text-left space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-indigo-800 text-xs">Hubungkan Akun Google</h3>
                <p className="text-[11px] text-indigo-700 mt-1 leading-relaxed font-semibold">
                  Semua akun Google diizinkan untuk terhubung dan mengakses aplikasi.
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-150 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2.5 text-left animate-slide-up">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 transition-all cursor-pointer"
          >
            {isLoggingIn ? (
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
            ) : (
              <LogIn className="w-4 h-4 text-white" />
            )}
            <span>{isLoggingIn ? 'Menghubungkan...' : 'Hubungkan Google Account'}</span>
          </button>
        </div>
      </div>
    );
  }

  // Render Loader state (Database initialization or global action loaders)
  if (isLoading && loadingStep && userProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white border border-slate-100 p-6 rounded-3xl shadow-xl text-center space-y-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 flex items-center justify-center rounded-2xl mx-auto shadow-sm">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
          </div>
          <h2 className="font-display font-bold text-slate-800 text-sm">Menyiapkan Aplikasi</h2>
          <p className="text-xs text-slate-500 font-medium leading-relaxed">
            {loadingStep}
          </p>
          <div className="h-1 w-24 bg-indigo-100 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-indigo-600 rounded-full w-2/3 animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <PwaInstallBanner />
      <Header
        userProfile={userProfile}
        role={activeRole}
        onRoleChange={setActiveRole}
        onLogout={handleLogout}
        spreadsheetId={spreadsheetId}
        onRefresh={handleManualRefresh}
        isRefreshing={isLoading}
        onOpenSettings={() => setActiveView('profile-settings')}
        activeView={activeView}
        onOpenDiomsLogo={() => setIsDiomsLogoModalOpen(true)}
        isTokenExpired={isTokenExpired}
        token={token}
        onRenewToken={handleRenewGoogleToken}
      />

      {/* Main Container */}
      <main className="flex-1 p-4 max-w-md mx-auto w-full space-y-4">
        {/* Error / Token Expired / Offline Banner */}
        {error && (
          <div className={`rounded-2xl p-4 text-xs flex flex-col gap-3 animate-slide-up shadow-sm border ${
            isTokenExpired || error.toLowerCase().includes('sesi google') || error.includes('401')
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : error.toLowerCase().includes('offline') || error.toLowerCase().includes('luring')
              ? 'bg-blue-50 border-blue-200 text-blue-900'
              : 'bg-red-50 border-red-150 text-red-700'
          }`}>
            <div className="flex items-start gap-2.5">
              <AlertCircle className={`w-4.5 h-4.5 shrink-0 mt-0.5 ${
                isTokenExpired || error.toLowerCase().includes('sesi google') || error.includes('401')
                  ? 'text-amber-600'
                  : error.toLowerCase().includes('offline') || error.toLowerCase().includes('luring')
                  ? 'text-blue-600'
                  : 'text-red-500'
              }`} />
              <div className="flex-1">
                <p className="font-bold text-slate-800">
                  {isTokenExpired || error.toLowerCase().includes('sesi google')
                    ? 'Sesi Google Expired (1 Jam)'
                    : error.toLowerCase().includes('offline') || error.toLowerCase().includes('luring')
                    ? 'Mode Luring (Offline Cache)'
                    : 'Terjadi Kendala Koneksi API'}
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">{error}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              {(isTokenExpired || error.toLowerCase().includes('sesi google') || error.includes('401')) ? (
                <button
                  onClick={handleRenewGoogleToken}
                  disabled={isLoading}
                  className="w-full py-2.5 px-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Perbarui Sesi Google (1-Klik Connect)</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={handleManualRefresh}
                    disabled={isLoading}
                    className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                    <span>Coba Sinkron Ulang</span>
                  </button>
                  <button
                    onClick={() => setError(null)}
                    className="py-2 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium rounded-xl text-xs transition-all cursor-pointer"
                  >
                    Tutup Peringatan
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* View Routing */}
        {!userProfile ? (
          <AppLoginForm
            profiles={profiles}
            onLoginSuccess={handleAppLoginSuccess}
            isLoading={isLoading}
            onResetGoogle={handleResetGoogleConnection}
            onLoginWithCredentials={handleAppLoginWithCredentials}
            externalError={loginRejectError}
            onClearExternalError={() => setLoginRejectError(null)}
            hasSharedReceipt={!!pendingSharedRecord}
          />
        ) : activeView === 'setup-profile' ? (
          <ProfileSetup
            profiles={profiles}
            requests={requests}
            resetDeviceLogs={resetDeviceLogs}
            onSave={handleSaveProfile}
            onResetDeviceId={handleResetUserDeviceId}
            onPurgeOrphanHistories={handlePurgeOrphanHistories}
            onClose={() => setActiveView('dashboard')}
          />
        ) : activeView === 'profile-settings' && userProfile ? (
          <ProfileSettings
            userProfile={userProfile}
            onUpdatePassword={handleUpdatePassword}
            onUpdateProfilePhoto={handleUpdateProfilePhoto}
            onClose={() => setActiveView('dashboard')}
            theme={theme}
            onThemeChange={setTheme}
            token={token}
            driveFolderId={driveFolderId}
          />
        ) : activeView === 'new-request' && userProfile ? (
          <BudgetRequestForm
            userEmail={userProfile.email}
            managerEmail={userProfile.managerEmail}
            defaultSiteId=""
            onSubmit={handleAddBudgetRequest}
            onClose={() => {
              setEditingRequest(null);
              setActiveView('dashboard');
            }}
            initialIsTalangan={initialIsTalangan}
            sites={sites}
            initialRequest={editingRequest || undefined}
            userProfile={userProfile}
          />
        ) : activeView === 'report-usage' && selectedRequest ? (
          <UsageReportForm
            request={selectedRequest}
            items={usageItems}
            googleToken={token || ''}
            driveFolderId={driveFolderId || ''}
            onAddItem={handleAddUsageItem}
            onUpdateItem={handleUpdateUsageItem}
            onDeleteItem={handleDeleteUsageItem}
            onSubmitReport={handleSubmitUsageReport}
            onSubmitReview={handleReviewUsageItems}
            onClose={() => {
              setSelectedRequest(null);
              setActiveView('dashboard');
            }}
            role={activeRole}
            onAuthError={handleGoogleAuthError}
            sites={sites}
            activities={activities}
            profiles={profiles}
            requests={requests}
            histories={itemReviewHistories}
            onPreviewDocument={setPreviewDocument}
            userProfile={userProfile}
          />
        ) : activeView === 'adjustment' && userProfile ? (
          <AdjustmentPanel
            profiles={profiles}
            requests={requests}
            usageItems={usageItems}
            googleToken={token!}
            driveFolderId={driveFolderId || ''}
            onCreateAdjustment={handleCreateAdjustment}
            onClose={() => setActiveView('dashboard')}
            onAuthError={handleGoogleAuthError}
          />
        ) : activeView === 'transfer-list' && userProfile ? (
          <TransferListPanel
            profiles={profiles}
            requests={requests}
            usageItems={usageItems}
            sites={sites}
            googleToken={token!}
            driveFolderId={driveFolderId || ''}
            histories={itemReviewHistories}
            onClose={() => setActiveView('dashboard')}
            onPreviewDocument={setPreviewDocument}
            onUpdateTransfer={handleUpdateTransferDetails}
            onAuthError={handleGoogleAuthError}
          />
        ) : activeView === 'activities' && userProfile ? (
          <ActivityLogView
            activities={activities}
            sites={sites}
            userEmail={userProfile.email}
            userProfile={userProfile}
            profiles={profiles}
            role={activeRole}
            onSaveActivity={handleSaveActivity}
            onUpdateActivity={handleUpdateActivity}
            onBack={() => setActiveView('dashboard')}
          />
        ) : (
          /* Dashboard Main Section */
          <div className="space-y-4 animate-slide-up">
            {statusFilter === 'ALL' ? (
              <>
                {/* Quick Profile/Role indicator banner */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3 overflow-hidden">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => setActiveView('profile-settings')}
                      title={`Pengaturan Profil (${userProfile?.nama || userProfile?.email || 'User'}). Klik untuk Pengaturan Profil.`}
                      className="relative w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-bold font-display text-sm overflow-hidden shrink-0 transition-all cursor-pointer hover:bg-slate-200 focus:outline-none shadow-xs"
                    >
                      {userProfile?.fotoProfile ? (
                        <img
                          src={userProfile.fotoProfile}
                          alt={userProfile.nama || 'Profile'}
                          className="w-full h-full rounded-xl object-cover"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : userProfile?.nama ? (
                        <span>{userProfile.nama.charAt(0).toUpperCase()}</span>
                      ) : userProfile?.userId ? (
                        <span>{userProfile.userId.charAt(0).toUpperCase()}</span>
                      ) : user?.photoURL ? (
                        <img src={user.photoURL} alt="Profile" className="w-10 h-10 rounded-xl object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        userProfile?.email?.charAt(0).toUpperCase() || 'U'
                      )}
                    </button>
                    <div className="min-w-0">
                      <h2 className="font-display font-bold text-slate-800 text-xs truncate max-w-[130px] sm:max-w-[180px]">
                        {userProfile?.nama || userProfile?.userId || userProfile?.email}
                      </h2>
                      <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1 mt-0.5 truncate">
                        {activeRole === Role.USER ? (
                          <span>
                            Divisi : {formatDivisiSubDivisi(userProfile?.divisi, userProfile?.subDivisi)}
                          </span>
                        ) : (
                          <>
                            Role: <span className="text-indigo-600 font-bold">{activeRole}</span>
                            {userProfile && userProfile.divisi && activeRole !== Role.DIREKTUR && (
                              <span>
                                | Divisi : {formatDivisiSubDivisi(userProfile.divisi, userProfile.subDivisi)}
                              </span>
                            )}
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Action Controls in Profile Bar */}
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Settings / Profile Button */}
                    <button
                      onClick={() => setActiveView('profile-settings')}
                      className={`p-2 rounded-xl transition-all cursor-pointer ${
                        activeView === 'profile-settings'
                          ? 'text-indigo-600 bg-indigo-50 font-bold'
                          : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                      }`}
                      title="Pengaturan Profil & Sandi"
                    >
                      <Settings className="w-4 h-4" />
                    </button>

                    {/* Refresh Button */}
                    <button
                      onClick={handleManualRefresh}
                      disabled={isLoading}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all cursor-pointer"
                      title="Sinkronisasi Data"
                    >
                      <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
                    </button>

                    {/* User Sign Out */}
                    <button
                      onClick={handleLogout}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
                      title="Keluar"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Core Stats Section */}
                <DashboardStats
                  role={activeRole}
                  email={userProfile?.email || ''}
                  requests={requests}
                  usageItems={usageItems}
                  sites={sites}
                  activeFilter={statusFilter}
                  onSelectFilter={setStatusFilter}
                  onManageUsers={() => setActiveView('setup-profile')}
                  onOpenUserDashboardPreview={() => setIsUserDashboardPreviewModalOpen(true)}
                  onOpenAdjustment={() => setActiveView('adjustment')}
                  onOpenTransferList={() => setActiveView('transfer-list')}
                  onOpenReportsModal={() => setIsFinancialReportsModalOpen(true)}
                  profiles={profiles}
                  activities={activities}
                  onOpenActivities={() => setActiveView('activities')}
                  userProfile={userProfile}
                  onOpenBbmModal={() => setIsBbmModalOpen(true)}
                  onOpenBbmListModal={() => setIsBbmListModalOpen(true)}
                  histories={itemReviewHistories}
                  activeTab={dashboardTab}
                  onSelectTab={handleSelectDashboardTab}
                />
              </>
            ) : (
              <>
                {/* Back button and title */}
                <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-sm gap-2">
                  <button
                    onClick={() => setStatusFilter('ALL')}
                    className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-all cursor-pointer shrink-0"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Kembali ke Dashboard</span>
                  </button>
                </div>



                {/* Request Listing Container */}
                {!reviewBudgetReq && !reviewReportReq && !transferReq && (
                  <div className="space-y-3 pt-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 flex-wrap gap-2">
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Daftar Pengajuan: <span className="text-indigo-600 font-bold">
                          {statusFilter === 'PENDING' && activeRole === Role.MANAGER && dashboardTab === 'APPROVAL' ? 'Alur Persetujuan (Menunggu Approval Manager)' :
                           statusFilter === 'PENDING' ? 'Menunggu Approval (Review Manager / Finance)' :
                           statusFilter === 'APPROVED' ? 'Telah Disetujui Finance (Menunggu Transfer)' :
                           statusFilter === 'DIREKTUR_APPROVAL' ? 'Alur Persetujuan Direktur (Tinjau Anggaran)' :
                           statusFilter === 'DIREKTUR_RECONCILIATION' ? 'Alur Rekonsiliasi Direktur (Review Penggunaan Anggaran)' :
                           statusFilter === 'TRANSFERRED' ? 'Belum Dilaporkan (Telah Ditransfer)' :
                           statusFilter === 'REPORTING' && (activeRole === Role.USER || activeRole === Role.MANAGER || (activeRole === Role.FINANCE && dashboardTab === 'SUBMISSION')) ? 'Proses Laporan (Pengisian & Review Laporan)' :
                           statusFilter === 'REPORTING' && activeRole === Role.FINANCE ? 'Review Finansial' :
                           statusFilter === 'REPORTING' && activeRole === Role.DIREKTUR ? 'Proses Laporan Operasional' :
                           statusFilter === 'CLOSED' ? 'Arsip / UID Selesai (Closed)' :
                           statusFilter === 'REJECTED' && activeRole === Role.FINANCE && dashboardTab !== 'SUBMISSION' ? 'Pengajuan Rejected (Revisi Finance)' :
                           getStatusLabel(statusFilter as RequestStatus, filteredRequests[0]?.userEmail || userProfile?.email) || statusFilter}
                        </span>
                      </h3>
                    </div>

                    {/* Filtering & Search Bar */}
                    <div className="space-y-2">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Cari UID, nama pemohon, lokasi, keterangan..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 focus:bg-white focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                        />
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      </div>

                      {statusFilter === 'CLOSED' && activeRole === Role.FINANCE && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3 mt-2 animate-slide-up">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                              <Filter className="w-3.5 h-3.5 text-indigo-500" />
                              Filter Arsip Selesai
                            </span>
                            {(closedUserFilter !== 'ALL' || closedDivisiFilter !== 'ALL' || closedStartDateFilter || closedEndDateFilter) && (
                              <button
                                onClick={() => {
                                  setClosedUserFilter('ALL');
                                  setClosedDivisiFilter('ALL');
                                  setClosedStartDateFilter('');
                                  setClosedEndDateFilter('');
                                }}
                                className="text-[9px] text-indigo-600 hover:text-indigo-800 font-bold transition-colors cursor-pointer bg-transparent border-none p-0"
                              >
                                Bersihkan Filter
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {/* User Filter */}
                            <div className="space-y-1">
                              <label className="block text-[9px] font-bold text-slate-400 uppercase">Pemohon (User)</label>
                              <select
                                value={closedUserFilter}
                                onChange={(e) => setClosedUserFilter(e.target.value)}
                                className="w-full text-[11px] bg-white border border-slate-200 rounded-lg p-2 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none text-slate-700"
                              >
                                <option value="ALL">Semua Pemohon</option>
                                {Array.from(
                                  new Set<string>(
                                    requests
                                      .filter(r => r.status === RequestStatus.CLOSED && !r.id.startsWith('BBMDS') && !r.id.startsWith('BBM_DurenSawit'))
                                      .map(r => r.userEmail)
                                  )
                                ).map(email => {
                                  const emailStr = String(email);
                                  const p = profiles.find(prof => prof.email.toLowerCase() === emailStr.toLowerCase());
                                  const name = p?.nama || emailStr;
                                  return (
                                    <option key={emailStr} value={emailStr}>
                                      {name} ({emailStr})
                                    </option>
                                  );
                                })}
                              </select>
                            </div>

                            {/* Divisi Filter */}
                            <div className="space-y-1">
                              <label className="block text-[9px] font-bold text-slate-400 uppercase">Divisi</label>
                              <select
                                value={closedDivisiFilter}
                                onChange={(e) => setClosedDivisiFilter(e.target.value)}
                                className="w-full text-[11px] bg-white border border-slate-200 rounded-lg p-2 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none text-slate-700"
                              >
                                <option value="ALL">Semua Divisi</option>
                                {Array.from(
                                  new Set<string>(
                                    requests
                                      .filter(r => r.status === RequestStatus.CLOSED && !r.id.startsWith('BBMDS') && !r.id.startsWith('BBM_DurenSawit'))
                                      .map(r => {
                                        const p = profiles.find(prof => prof.email.toLowerCase() === r.userEmail.toLowerCase());
                                        return p?.divisi || '';
                                      })
                                      .filter(Boolean)
                                  )
                                ).map(divisi => {
                                  const divisiStr = String(divisi);
                                  return (
                                    <option key={divisiStr} value={divisiStr}>
                                      {divisiStr}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>

                            {/* Date Range Filter */}
                            <div className="space-y-1">
                              <label className="block text-[9px] font-bold text-slate-400 uppercase">Tanggal Closing (Rentang)</label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="date"
                                  value={closedStartDateFilter}
                                  onChange={(e) => setClosedStartDateFilter(e.target.value)}
                                  className="w-full text-[11px] bg-white border border-slate-200 rounded-lg p-1.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none text-slate-700"
                                />
                                <span className="text-[10px] text-slate-400 font-bold">s/d</span>
                                <input
                                  type="date"
                                  value={closedEndDateFilter}
                                  onChange={(e) => setClosedEndDateFilter(e.target.value)}
                                  className="w-full text-[11px] bg-white border border-slate-200 rounded-lg p-1.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none text-slate-700"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Action buttons for USER role and MANAGER/FINANCE (SUBMISSION mode only) */}
                      {(activeRole === Role.USER || ((activeRole === Role.MANAGER || activeRole === Role.FINANCE) && dashboardTab === 'SUBMISSION')) && statusFilter !== RequestStatus.APPROVED && statusFilter !== 'REPORTING' && statusFilter !== RequestStatus.CLOSED && statusFilter !== 'CLOSED' && statusFilter !== 'TRANSFERRED' && statusFilter !== RequestStatus.TRANSFERRED && (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => {
                              if (!userProfile?.managerEmail && activeRole === Role.USER) {
                                alert('Email Manager Anda belum dikonfigurasi oleh Finance. Silakan hubungi Finance Anda.');
                              } else {
                                setEditingRequest(null);
                                setInitialIsTalangan(false);
                                setActiveView('new-request');
                              }
                            }}
                            className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Ajukan Anggaran</span>
                          </button>
                          <button
                            onClick={() => {
                              if (!userProfile?.managerEmail && activeRole === Role.USER) {
                                alert('Email Manager Anda belum dikonfigurasi oleh Finance. Silakan hubungi Finance Anda.');
                              } else {
                                setEditingRequest(null);
                                setInitialIsTalangan(true);
                                setActiveView('new-request');
                              }
                            }}
                            className="flex-1 py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Laporan Dana Talangan</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Request Cards Grid */}
                    {sortedRequests.length === 0 ? (
                      <div className="bg-slate-50 border border-slate-150 rounded-2xl py-12 px-4 text-center text-slate-400 text-xs font-medium">
                        <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-2.5" />
                        <p>Tidak ditemukan pengajuan dana.</p>
                        <p className="text-[10px] text-slate-400 mt-1">Sesuaikan filter status atau cari kata kunci lain.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {sortedRequests.map((req) => {
                          const reqItems = usageItems.filter(i => i.requestId === req.id);
                          const rejectedItems = reqItems.filter(i => i.statusManager === ItemStatus.REJECTED || i.statusAdmin === ItemStatus.REJECTED);
                          const hasRejectedItems = rejectedItems.length > 0;
                          const isFullyApprovedByAdmin = reqItems.length > 0 && reqItems.every(i => i.statusAdmin === ItemStatus.APPROVED);
                          const isReqTalangan = req.id.startsWith('OPT-') || req.keterangan.startsWith('[DANA TALANGAN]');

                          const ditransferAmount = [
                            RequestStatus.PENDING_APPROVAL,
                            RequestStatus.APPROVED,
                            RequestStatus.PARTIALLY_APPROVED,
                            RequestStatus.PENDING_TALANGAN_TRANSFER,
                            RequestStatus.PENDING_PENGAJUAN_TRANSFER,
                            RequestStatus.REJECTED
                          ].includes(req.status)
                            ? 0
                            : req.adminActionAmount;

                          const approvedUsageAmount = reqItems
                            .filter(item => item.statusManager === ItemStatus.APPROVED && item.statusAdmin === ItemStatus.APPROVED)
                            .reduce((sum, item) => sum + item.nominal, 0);

                          const saldoUID = ditransferAmount - approvedUsageAmount;

                          const requesterProfile = profiles.find(p => p.email.toLowerCase() === req.userEmail.toLowerCase());
                          const requesterName = requesterProfile?.nama || requesterProfile?.userId || req.userEmail;

                          return (
                            <div
                              key={req.id}
                              className={`bg-white border-l-4 ${getLeftBorderColor(req.status)} border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 hover:border-slate-300 hover:shadow-md transition-all relative`}
                            >
                              {/* Header card info */}
                              <div>
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[9px] font-mono text-slate-400 font-bold">{req.id}</span>
                                    {/* Indikator / Badge Notifikasi Baru Removed for cleaner UI */}
                                  </div>
                                  <span className={`text-[9px] font-mono font-bold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded ${getStatusTextColor(req.status)}`}>
                                    {getStatusLabel(req.status, req.userEmail)}
                                  </span>
                                </div>
                                <h4 className="text-xs font-bold text-slate-800 mt-1 whitespace-pre-wrap">{req.keterangan}</h4>
                                <div className="text-[10px] text-slate-500 font-medium space-y-1 mt-1">
                                  {/* SiteID & Tanggal Penggunaan: sejajar vertikal rata kiri */}
                                  <div className="flex flex-col items-start gap-0.5">
                                    <span>Site: <strong>{req.siteId}</strong></span>
                                    <span>Tgl Penggunaan: <strong className="text-indigo-600">{req.tanggalPemakaian}</strong></span>
                                  </div>

                                  {/* Pemohon & Divisi: sejajar horisontal di bawah Tanggal Penggunaan */}
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span>Pemohon: <strong>{requesterName}</strong></span>
                                    {requesterProfile?.divisi && (
                                      <>
                                        <span>•</span>
                                        <span>Divisi: <strong>{requesterProfile.divisi}</strong></span>
                                      </>
                                    )}
                                    {req.status === RequestStatus.CLOSED && (
                                      <>
                                        <span>•</span>
                                        <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100 text-[9px] font-bold">
                                          Closed: {getClosingDate(req) ? getClosingDate(req)!.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : req.createdAt.split(',')[0]}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Middle info with budget values */}
                              <div className="bg-slate-50 p-2.5 rounded-xl text-[10px] text-slate-500 grid grid-cols-3 gap-2 border border-slate-100">
                                <div>
                                  <span className="block text-[8px] font-bold text-slate-400 uppercase">Diajukan</span>
                                  <span className="font-semibold text-slate-700">
                                    {formatIDR(req.jumlahPengajuan)}
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-[8px] font-bold text-slate-400 uppercase">Disetujui</span>
                                  <span className="font-semibold text-emerald-600">
                                    {(() => {
                                      const isOp = isOpBiasaRequest(req) || req.id.startsWith('OP-');
                                      const finApproved = getFinanceApprovedAmount(req, itemReviewHistories, usageItems);
                                      const hasFinApproval = itemReviewHistories.some(h => (h.requestUid === req.id || h.itemUid === req.id) && h.actionType === 'APPROVAL_FINANCE') ||
                                        !!req.adminComment ||
                                        [RequestStatus.PENDING_PENGAJUAN_TRANSFER, RequestStatus.TRANSFER_BERTAHAP, RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.CLOSED].includes(req.status);

                                      if (isOp) {
                                        if (!hasFinApproval) return '-';
                                        return formatIDR(finApproved);
                                      }

                                      if (req.status === RequestStatus.PENDING_APPROVAL || req.status === RequestStatus.REJECTED) {
                                        return '-';
                                      }
                                      return formatIDR(finApproved);
                                    })()}
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-[8px] font-bold text-slate-400 uppercase">Ditransfer</span>
                                  <span className="font-semibold text-indigo-600">
                                    {(req.adminActionAmount && req.adminActionAmount > 0)
                                      ? formatIDR(req.adminActionAmount)
                                      : '-'}
                                  </span>
                                </div>
                              </div>

                              {(req.status === RequestStatus.TRANSFER_BERTAHAP || (getTransferBertahap(req, itemReviewHistories, usageItems) && (req.adminActionAmount || 0) > 0)) && (
                                <div className="text-left">
                                  <span className="text-[9px] font-bold text-cyan-700 bg-cyan-50 px-2.5 py-1 rounded-md uppercase tracking-wider border border-cyan-200/60 inline-block">
                                    Transfer Bertahap
                                  </span>
                                </div>
                              )}

                              {req.buktiTransferUrl && (() => {
                                const urls = req.buktiTransferUrl.split('||').map(u => u.trim()).filter(Boolean);
                                const fileIds = (req.buktiTransferFileId || '').split('||').map(f => f.trim()).filter(Boolean);
                                if (urls.length === 0) return null;

                                if (urls.length === 1) {
                                  return (
                                    <button 
                                      type="button"
                                      onClick={() => setPreviewDocument({
                                        url: urls[0],
                                        fileId: fileIds[0] || undefined,
                                        title: `Bukti Transfer (UID: ${req.id})`
                                      })}
                                      className="w-full flex items-center gap-1.5 text-[10px] font-bold text-indigo-600 bg-indigo-50/50 hover:bg-indigo-100/70 p-2 rounded-xl border border-indigo-100/80 transition-colors cursor-pointer text-left"
                                    >
                                      <Paperclip className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                                      <span>Bukti Transfer</span>
                                    </button>
                                  );
                                }

                                return (
                                  <div className="space-y-1">
                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">
                                      Bukti Transfer ({urls.length} Resi):
                                    </span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                      {urls.map((url, idx) => (
                                        <button 
                                          key={idx}
                                          type="button"
                                          onClick={() => setPreviewDocument({
                                            url: url,
                                            fileId: fileIds[idx] || undefined,
                                            title: `Bukti Transfer #${idx + 1} (UID: ${req.id})`
                                          })}
                                          className="flex items-center justify-between text-[10px] font-bold text-indigo-600 bg-indigo-50/50 hover:bg-indigo-100/70 p-2 rounded-xl border border-indigo-100/80 transition-colors cursor-pointer text-left truncate"
                                        >
                                          <div className="flex items-center gap-1.5 truncate">
                                            <Paperclip className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                                            <span className="truncate">Resi #${idx + 1}</span>
                                          </div>
                                          <Eye className="w-3 h-3 text-indigo-500 shrink-0 ml-1" />
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Clickable Timeline Pengajuan rata kiri vertikal di atas Catatan Manager */}
                              <div className="space-y-1.5 text-left">
                                <button
                                  type="button"
                                  onClick={() => setExpandedTimelineReqIds(prev => ({ ...prev, [req.id]: !prev[req.id] }))}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-[10px] transition-all cursor-pointer border border-indigo-200/80 shrink-0 shadow-2xs"
                                  title="Lihat Timeline Pengajuan"
                                >
                                  <Clock className="w-3.5 h-3.5 text-indigo-600" />
                                  <span>Timeline Pengajuan</span>
                                  {expandedTimelineReqIds[req.id] ? (
                                    <ChevronUp className="w-3.5 h-3.5 text-indigo-600" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-indigo-600" />
                                  )}
                                </button>

                                {expandedTimelineReqIds[req.id] && (
                                  <OP_TimeLine
                                    request={req}
                                    histories={itemReviewHistories}
                                    usageItems={usageItems}
                                    profiles={profiles}
                                    theme="light"
                                    className="animate-fade-in my-1.5"
                                  />
                                )}
                              </div>

                              {((req.managerComment && req.status !== RequestStatus.REJECTED) || req.adminComment) && (
                                <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 space-y-1.5 text-[10px] text-slate-600">
                                  {req.managerComment && req.status !== RequestStatus.REJECTED && (
                                    <div className="flex items-start gap-1.5">
                                      <span className="font-semibold text-slate-500 shrink-0">
                                        {(() => {
                                          const p = profiles.find(prof => prof.email.trim().toLowerCase() === (req.userEmail || '').trim().toLowerCase());
                                          return (p?.role === Role.MANAGER || p?.role === Role.FINANCE) ? 'Catatan Direktur:' : 'Catatan Manager:';
                                        })()}
                                      </span>
                                      <span className="italic text-slate-700">{req.managerComment}</span>
                                    </div>
                                  )}
                                  {req.adminComment && (
                                    <div className="flex items-start gap-1.5">
                                      <span className="font-semibold text-slate-500 shrink-0">Catatan Finance:</span>
                                      <span className="italic text-slate-700">{req.adminComment}</span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Expanded Report Items List for Dana Talangan */}
                              {(req.status === RequestStatus.PENDING_TALANGAN_TRANSFER || isReqTalangan) && expandedReportReqIds[req.id] && (
                                <div className="bg-indigo-50/30 rounded-xl p-3.5 border border-indigo-100/80 space-y-2.5 animate-slide-up mt-2">
                                  <div className="flex items-center justify-between border-b border-indigo-100 pb-1.5 mb-1.5">
                                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Item Laporan Penggunaan</span>
                                    <span className="text-[9px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-md">
                                      {reqItems.length} Item
                                    </span>
                                  </div>
                                  {reqItems.length === 0 ? (
                                    <p className="text-[10px] text-slate-400 italic text-center py-2">Tidak ada item laporan ditemukan.</p>
                                  ) : (
                                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                                      {reqItems.map((item, idx) => (
                                        <div key={item.id} className="bg-white border border-slate-100 rounded-xl p-3 space-y-2 shadow-xs">
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="space-y-0.5">
                                              <span className="text-[8px] text-slate-400 font-bold block">ITEM #{idx + 1}</span>
                                              <h5 className="text-[11px] font-bold text-slate-800 leading-tight">{item.keterangan}</h5>
                                              <p className="text-[9px] text-slate-500 font-medium mt-0.5">
                                                Tanggal: {item.tanggalPenggunaan} • Nominal: <strong className="text-slate-700">{formatIDR(item.nominal)}</strong>
                                              </p>
                                            </div>
                                            {item.buktiUrl && (
                                              <button
                                                type="button"
                                                onClick={() => setPreviewDocument({
                                                  url: item.buktiUrl,
                                                  fileId: item.buktiFileId || undefined,
                                                  title: `Bukti Nota: ${item.keterangan}`
                                                })}
                                                className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-[9px] font-bold shrink-0 flex items-center gap-1 transition-all cursor-pointer"
                                              >
                                                <Paperclip className="w-3 h-3" />
                                                <span>Nota</span>
                                              </button>
                                            )}
                                          </div>

                                          {/* Persetujuan Manager & Finance per item Dana Talangan */}
                                          <div className="pt-2 border-t border-slate-100 space-y-1 text-[10px]">
                                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider block">
                                              Status Persetujuan Item:
                                            </span>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                              {/* Manager Approval */}
                                              <div className={`p-1.5 rounded-lg border text-[9.5px] space-y-0.5 ${
                                                item.statusManager === ItemStatus.APPROVED
                                                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                                                  : item.statusManager === ItemStatus.REJECTED
                                                  ? 'bg-rose-50/70 border-rose-200 text-rose-900'
                                                  : 'bg-amber-50/70 border-amber-200 text-amber-900'
                                              }`}>
                                                <div className="flex items-center justify-between gap-1">
                                                  <span className="font-bold text-slate-700 flex items-center gap-1">
                                                    <UserCheck className="w-3 h-3 text-slate-500" />
                                                    Manager:
                                                  </span>
                                                  <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider border flex items-center gap-1 ${
                                                    item.statusManager === ItemStatus.APPROVED
                                                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                                      : item.statusManager === ItemStatus.REJECTED
                                                      ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                                                      : 'bg-amber-100 text-amber-800 border-amber-300'
                                                  }`}>
                                                    {item.statusManager === ItemStatus.APPROVED ? (
                                                      <>
                                                        <CheckCircle2 className="w-2.5 h-2.5 shrink-0 text-emerald-600" />
                                                        <span>Disetujui</span>
                                                      </>
                                                    ) : item.statusManager === ItemStatus.REJECTED ? (
                                                      <>
                                                        <AlertTriangle className="w-2.5 h-2.5 shrink-0 text-white" />
                                                        <span>Revisi</span>
                                                      </>
                                                    ) : (
                                                      'Menunggu'
                                                    )}
                                                  </span>
                                                </div>
                                                {item.managerComment && (
                                                  <p className="text-[9px] italic text-slate-600 bg-white/80 p-1 rounded border border-slate-200/60 leading-tight">
                                                    <span className="font-bold not-italic text-slate-500">Catatan:</span> "{item.managerComment}"
                                                  </p>
                                                )}
                                              </div>

                                              {/* Finance Approval */}
                                              <div className={`p-1.5 rounded-lg border text-[9.5px] space-y-0.5 ${
                                                item.statusAdmin === ItemStatus.APPROVED
                                                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                                                  : item.statusAdmin === ItemStatus.REJECTED
                                                  ? 'bg-rose-50/70 border-rose-200 text-rose-900'
                                                  : 'bg-amber-50/70 border-amber-200 text-amber-900'
                                              }`}>
                                                <div className="flex items-center justify-between gap-1">
                                                  <span className="font-bold text-slate-700 flex items-center gap-1">
                                                    <ShieldCheck className="w-3 h-3 text-slate-500" />
                                                    Finance:
                                                  </span>
                                                  <span className={`px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider border flex items-center gap-1 ${
                                                    item.statusAdmin === ItemStatus.APPROVED
                                                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                                      : item.statusAdmin === ItemStatus.REJECTED
                                                      ? 'bg-rose-600 text-white border-rose-700 animate-pulse'
                                                      : 'bg-amber-100 text-amber-800 border-amber-300'
                                                  }`}>
                                                    {item.statusAdmin === ItemStatus.APPROVED ? (
                                                      <>
                                                        <CheckCircle2 className="w-2.5 h-2.5 shrink-0 text-emerald-600" />
                                                        <span>Disetujui</span>
                                                      </>
                                                    ) : item.statusAdmin === ItemStatus.REJECTED ? (
                                                      <>
                                                        <AlertTriangle className="w-2.5 h-2.5 shrink-0 text-white" />
                                                        <span>Revisi</span>
                                                      </>
                                                    ) : (
                                                      'Menunggu'
                                                    )}
                                                  </span>
                                                </div>
                                                {item.adminComment && (
                                                  <p className="text-[9px] italic text-slate-600 bg-white/80 p-1 rounded border border-slate-200/60 leading-tight">
                                                    <span className="font-bold not-italic text-slate-500">Catatan:</span> "{item.adminComment}"
                                                  </p>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Comments if any */}
                              {req.status === RequestStatus.REJECTED && (
                                <div className="bg-amber-50 text-amber-800 p-2.5 rounded-xl text-[10px] border border-amber-200 space-y-2">
                                  {req.managerComment && (
                                    <p>
                                      <strong>
                                        {(() => {
                                          const p = profiles.find(prof => prof.email.trim().toLowerCase() === (req.userEmail || '').trim().toLowerCase());
                                          return (p?.role === Role.MANAGER || p?.role === Role.FINANCE) ? 'Catatan Revisi Direktur:' : 'Catatan Revisi Manager:';
                                        })()}
                                      </strong> {req.managerComment}
                                    </p>
                                  )}
                                  <div className="flex items-center justify-between pt-1 border-t border-amber-200/60">
                                    <span className="text-[9px] text-amber-700 font-medium">Riwayat Approval & Revisi:</span>
                                    <button
                                      type="button"
                                      onClick={() => setRequestHistoryModalItem({
                                        id: req.id,
                                        requestId: req.id,
                                        tanggalPenggunaan: req.tanggalPemakaian,
                                        nominal: req.jumlahPengajuan,
                                        keterangan: req.keterangan,
                                        buktiUrl: req.buktiTransferUrl || '',
                                        buktiFileId: req.buktiTransferFileId || '',
                                        statusManager: req.status === RequestStatus.APPROVED ? ItemStatus.APPROVED : req.status === RequestStatus.REJECTED ? ItemStatus.REJECTED : ItemStatus.PENDING,
                                        managerComment: req.managerComment || '',
                                        statusAdmin: req.adminActionAmount > 0 ? ItemStatus.APPROVED : ItemStatus.PENDING,
                                        adminComment: req.adminComment || '',
                                        updatedAt: req.createdAt
                                      })}
                                      className="px-2.5 py-1 bg-white hover:bg-amber-100 text-amber-900 font-bold rounded-lg text-[10px] transition-all flex items-center gap-1 cursor-pointer border border-amber-300 shrink-0 shadow-xs"
                                    >
                                      <History className="w-3.5 h-3.5 text-indigo-600" />
                                      <span>Riwayat</span>
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Item Review Perbaikan Warning Banner */}
                              {hasRejectedItems && (
                                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-2 text-xs text-rose-900 shadow-xs">
                                  <div className="flex items-center gap-2 font-bold text-rose-700">
                                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                                    <span>Perhatian: Ada {rejectedItems.length} item laporan yang perlu perbaikan / revisi!</span>
                                  </div>
                                  <div className="space-y-1.5 pl-0.5">
                                    {rejectedItems.map(item => (
                                      <div key={item.id} className="text-[11px] bg-white p-2.5 rounded-lg border border-rose-150 space-y-1 shadow-2xs">
                                        <div className="flex items-start justify-between gap-2 font-semibold text-slate-800">
                                          <span>• {item.keterangan}</span>
                                          <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded shrink-0">
                                            {formatIDR(item.nominal)}
                                          </span>
                                        </div>
                                        {item.statusManager === ItemStatus.REJECTED && item.managerComment && (
                                          <p className="text-[10px] text-rose-700 font-medium leading-tight">
                                            <strong className="text-slate-600">
                                              {(() => {
                                                const p = profiles.find(prof => prof.email.trim().toLowerCase() === (req.userEmail || '').trim().toLowerCase());
                                                return (p?.role === Role.MANAGER || p?.role === Role.FINANCE) ? 'Catatan Direktur:' : 'Catatan Manager:';
                                              })()}
                                            </strong> "{item.managerComment}"
                                          </p>
                                        )}
                                        {item.statusAdmin === ItemStatus.REJECTED && item.adminComment && (
                                          <p className="text-[10px] text-rose-700 font-medium leading-tight">
                                            <strong className="text-slate-600">Catatan Finance:</strong> "{item.adminComment}"
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Action buttons on card based on role & status */}
                              <div className="flex items-center justify-between pt-2 border-t border-slate-50 text-xs">
                                <div className="flex flex-col items-start gap-1">
                                  <span className="text-[9px] font-mono text-slate-400">
                                    {req.createdAt ? `Dibuat: ${req.createdAt}` : ''}
                                  </span>

                                  {req.status !== RequestStatus.REJECTED && (
                                    <button
                                      type="button"
                                      onClick={() => setRequestHistoryModalItem({
                                        id: req.id,
                                        requestId: req.id,
                                        tanggalPenggunaan: req.tanggalPemakaian,
                                        nominal: req.jumlahPengajuan,
                                        keterangan: req.keterangan,
                                        buktiUrl: req.buktiTransferUrl || '',
                                        buktiFileId: req.buktiTransferFileId || '',
                                        statusManager: req.status === RequestStatus.APPROVED ? ItemStatus.APPROVED : req.status === RequestStatus.REJECTED ? ItemStatus.REJECTED : ItemStatus.PENDING,
                                        managerComment: req.managerComment || '',
                                        statusAdmin: req.adminActionAmount > 0 ? ItemStatus.APPROVED : ItemStatus.PENDING,
                                        adminComment: req.adminComment || '',
                                        updatedAt: req.createdAt
                                      })}
                                      className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[10px] transition-all flex items-center gap-1 cursor-pointer border border-slate-200/80 shrink-0"
                                      title="Lihat Riwayat Approval & Revisi Pengajuan"
                                    >
                                      <History className="w-3 h-3 text-indigo-600" />
                                      <span>Riwayat</span>
                                    </button>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {/* USER ACTIONS */}
                                  {activeRole === Role.USER && (
                                    <>
                                      {([RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(req.status) || (req.status === RequestStatus.PENDING_APPROVAL && (req.id.startsWith('OPT-') || req.keterangan.startsWith('[DANA TALANGAN]')))) && (
                                        <button
                                          onClick={() => {
                                            setSelectedRequest(req);
                                            setActiveView('report-usage');
                                          }}
                                          className={`px-3 py-1.5 font-bold rounded-xl transition-all cursor-pointer ${
                                            hasRejectedItems
                                              ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm shadow-rose-200'
                                              : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600'
                                          }`}
                                        >
                                          {hasRejectedItems
                                            ? 'Perbaiki Laporan'
                                            : [RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(req.status)
                                              ? 'Lihat Laporan (Dalam Review)'
                                              : 'Laporkan Penggunaan'
                                          }
                                        </button>
                                      )}

                                      {req.status === RequestStatus.PENDING_TALANGAN_TRANSFER && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setExpandedReportReqIds(prev => ({
                                              ...prev,
                                              [req.id]: !prev[req.id]
                                            }));
                                          }}
                                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <ClipboardList className="w-3.5 h-3.5 text-indigo-500" />
                                          <span>{expandedReportReqIds[req.id] ? 'Sembunyikan Item Laporan' : 'Lihat Item Laporan'}</span>
                                        </button>
                                      )}

                                      {req.status === RequestStatus.CLOSED && (
                                        <button
                                          onClick={() => {
                                            setSelectedRequest(req);
                                            setActiveView('report-usage');
                                          }}
                                          className="px-3 py-1.5 border border-slate-150 hover:bg-slate-50 text-slate-600 font-bold rounded-xl transition-all"
                                        >
                                          Lihat Rincian Laporan
                                        </button>
                                      )}

                                      {req.status === RequestStatus.REJECTED && (
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingRequest(req);
                                              setActiveView('new-request');
                                            }}
                                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs shadow-amber-100"
                                          >
                                            <Edit2 className="w-3.5 h-3.5" />
                                            <span>Revisi</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setCancelConfirmReq(req)}
                                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-rose-200/60"
                                          >
                                            <XCircle className="w-3.5 h-3.5" />
                                            <span>Batalkan</span>
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )}

                                  {/* MANAGER ACTIONS */}
                                  {activeRole === Role.MANAGER && (
                                    <>
                                      {dashboardTab !== 'SUBMISSION' && req.status === RequestStatus.PENDING_APPROVAL && (
                                        <div className="flex gap-1.5 flex-wrap">
                                          {(req.id.startsWith('OPT-') || req.keterangan.startsWith('[DANA TALANGAN]')) ? (
                                            <button
                                              onClick={() => setReviewReportReq(req)}
                                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                                            >
                                              Tinjau Item Talangan
                                            </button>
                                          ) : (
                                            <button
                                              onClick={() => setReviewBudgetReq(req)}
                                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                                            >
                                              Tinjau Anggaran
                                            </button>
                                          )}
                                        </div>
                                      )}

                                      {([RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN, RequestStatus.REPORTING, RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP, RequestStatus.PENDING_TALANGAN_TRANSFER].includes(req.status) || (req.status === RequestStatus.PENDING_APPROVAL && (req.id.startsWith('OPT-') || req.keterangan.startsWith('[DANA TALANGAN]') || req.category === 'TALANGAN'))) && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSelectedRequest(req);
                                            setActiveView('report-usage');
                                          }}
                                          className={`px-3 py-1.5 font-bold rounded-xl transition-all cursor-pointer shadow-sm ${
                                            hasRejectedItems
                                              ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200'
                                              : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                          }`}
                                        >
                                          {hasRejectedItems
                                            ? 'Perbaiki Laporan'
                                             : 'Lihat Laporan'}
                                        </button>
                                      )}

                                      {req.status === RequestStatus.PENDING_TALANGAN_TRANSFER && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setExpandedReportReqIds(prev => ({
                                              ...prev,
                                              [req.id]: !prev[req.id]
                                            }));
                                          }}
                                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                                        >
                                          <ClipboardList className="w-3.5 h-3.5 text-indigo-500" />
                                          <span>{expandedReportReqIds[req.id] ? 'Sembunyikan Item Laporan' : 'Lihat Item Laporan'}</span>
                                        </button>
                                      )}

                                      {req.status === RequestStatus.CLOSED && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setSelectedRequest(req);
                                            setActiveView('report-usage');
                                          }}
                                          className="px-3 py-1.5 border border-slate-150 hover:bg-slate-50 text-slate-600 font-bold rounded-xl transition-all cursor-pointer"
                                        >
                                          Rincian Laporan
                                        </button>
                                      )}
                                    </>
                                  )}

                                  {/* DIREKTUR ACTIONS */}
                                  {activeRole === Role.DIREKTUR && (
                                    <>
                                      {/* Approval functionality only enabled under DIREKTUR_APPROVAL card */}
                                      {statusFilter === 'DIREKTUR_APPROVAL' && (
                                        <div className="flex gap-1.5 flex-wrap">
                                          {(req.id.startsWith('OPT-') || req.keterangan.startsWith('[DANA TALANGAN]')) ? (
                                            <button
                                              onClick={() => setReviewReportReq(req)}
                                              className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                                            >
                                              Tinjau Item Talangan
                                            </button>
                                          ) : (
                                            <button
                                              onClick={() => setReviewBudgetReq(req)}
                                              className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                                            >
                                              Tinjau Anggaran
                                            </button>
                                          )}
                                        </div>
                                      )}

                                      {/* Reconciliation functionality only enabled under DIREKTUR_RECONCILIATION card */}
                                      {statusFilter === 'DIREKTUR_RECONCILIATION' && (
                                        <button
                                          type="button"
                                          onClick={() => setReviewReportReq(req)}
                                          className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                                        >
                                          {(req.id.startsWith('OPT-') || req.keterangan.startsWith('[DANA TALANGAN]')) ? 'Tinjau Item Talangan' : 'Tinjau Laporan Nota'}
                                        </button>
                                      )}

                                      {/* View Only mode for Ringkasan Eksekutif Direktur cards and all other filters */}
                                      {statusFilter !== 'DIREKTUR_APPROVAL' && statusFilter !== 'DIREKTUR_RECONCILIATION' && (
                                        <>
                                          {/* Do not show Rincian Laporan for OP prefix pending transfer OR status TRANSFERRED (Dana Ditransfer Finance) */}
                                          {!((statusFilter === 'APPROVED' || req.status === RequestStatus.APPROVED || req.status === RequestStatus.PARTIALLY_APPROVED) && req.id.startsWith('OP') && !req.id.startsWith('OPT-')) &&
                                           req.status !== RequestStatus.TRANSFERRED &&
                                           statusFilter !== 'TRANSFERRED' && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setSelectedRequest(req);
                                                setActiveView('report-usage');
                                              }}
                                              className="px-3 py-1.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs shadow-xs"
                                            >
                                              <Eye className="w-3.5 h-3.5 text-slate-500" />
                                              <span>Rincian Laporan</span>
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </>
                                  )}

                                  {/* FINANCE ACTIONS */}
                                  {activeRole === Role.FINANCE && (
                                    <>
                                      {dashboardTab === 'SUBMISSION' ? (
                                        <>
                                          {([RequestStatus.TRANSFERRED, RequestStatus.TRANSFER_BERTAHAP, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(req.status)) && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setSelectedRequest(req);
                                                setActiveView('report-usage');
                                              }}
                                              className={`px-3 py-1.5 font-bold rounded-xl transition-all cursor-pointer shadow-sm ${
                                                hasRejectedItems
                                                  ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200'
                                                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                              }`}
                                            >
                                              {hasRejectedItems ? 'Perbaiki Laporan' : 'Lihat Laporan'}
                                            </button>
                                          )}

                                          {(req.status === RequestStatus.PENDING_TALANGAN_TRANSFER || isReqTalangan) && reqItems.length > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setExpandedReportReqIds(prev => ({
                                                  ...prev,
                                                  [req.id]: !prev[req.id]
                                                }));
                                              }}
                                              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                                            >
                                              <ClipboardList className="w-3.5 h-3.5 text-indigo-500" />
                                              <span>{expandedReportReqIds[req.id] ? 'Sembunyikan Item Laporan' : 'Lihat Item Laporan'}</span>
                                            </button>
                                          )}

                                          {req.status === RequestStatus.CLOSED && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setSelectedRequest(req);
                                                setActiveView('report-usage');
                                              }}
                                              className="px-3 py-1.5 border border-slate-150 hover:bg-slate-50 text-slate-600 font-bold rounded-xl transition-all cursor-pointer"
                                            >
                                              Rincian Laporan
                                            </button>
                                          )}

                                          {req.status === RequestStatus.REJECTED && (
                                            <div className="flex items-center gap-1.5">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setEditingRequest(req);
                                                  setActiveView('new-request');
                                                }}
                                                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs shadow-amber-100"
                                              >
                                                <Edit2 className="w-3.5 h-3.5" />
                                                <span>Revisi</span>
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => setCancelConfirmReq(req)}
                                                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-rose-200/60"
                                              >
                                                <XCircle className="w-3.5 h-3.5" />
                                                <span>Batalkan</span>
                                              </button>
                                            </div>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          {(req.status === RequestStatus.APPROVED || 
                                             req.status === RequestStatus.PARTIALLY_APPROVED) && (
                                            isOpBiasaRequest(req) && !isFinanceApprovedOpRequest(req, itemReviewHistories) ? (
                                              <button
                                                type="button"
                                                onClick={() => setReviewBudgetReq(req)}
                                                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                                              >
                                                Tinjau Anggaran (Finance)
                                              </button>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() => setTransferReq(req)}
                                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                                              >
                                                Proses Transfer
                                              </button>
                                            )
                                          )}

                                          {(req.status === RequestStatus.PENDING_TALANGAN_TRANSFER || req.status === RequestStatus.PENDING_PENGAJUAN_TRANSFER || req.status === RequestStatus.TRANSFER_BERTAHAP || (isOpBiasaRequest(req) && req.status !== RequestStatus.CLOSED && getTransferBertahap(req, itemReviewHistories, usageItems))) && (
                                            <button
                                              type="button"
                                              onClick={() => setTransferReq(req)}
                                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                                            >
                                              Proses Transfer
                                            </button>
                                          )}

                                          {(req.status === RequestStatus.REVIEW_ADMIN || req.status === RequestStatus.REPORTING) && (
                                            <button
                                              onClick={() => setReviewReportReq(req)}
                                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm cursor-pointer"
                                            >
                                              {(req.id.startsWith('OPT-') || req.keterangan.startsWith('[DANA TALANGAN]')) ? 'Review Item Talangan' : 'Tinjau Item Laporan'}
                                            </button>
                                          )}

                                          {req.status === RequestStatus.CLOSED && (
                                            <button
                                              onClick={() => {
                                                setSelectedRequest(req);
                                                setActiveView('report-usage');
                                              }}
                                              className="px-3 py-1.5 border border-slate-150 hover:bg-slate-50 text-slate-600 font-bold rounded-xl transition-all cursor-pointer"
                                            >
                                              Rincian Laporan
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </>
                                  )}

                                  {/* ADMINISTRATOR ACTIONS */}
                                  {activeRole === Role.ADMINISTRATOR && (
                                    <button
                                      onClick={() => {
                                        setSelectedRequest(req);
                                        setActiveView('report-usage');
                                      }}
                                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl transition-all border border-blue-200/60 flex items-center gap-1.5 cursor-pointer"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-blue-600" />
                                      <span>Lihat Rincian</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Document/Photo Preview Popup Modal */}
      {previewDocument && createPortal(
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[100000] flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-5 space-y-4 animate-scale-up relative border border-slate-100 flex flex-col max-h-[90vh] my-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">PREVIEW DOKUMEN / FOTO</h3>
                <h4 className="text-sm font-bold text-slate-800 mt-0.5">{previewDocument.title}</h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDocument(null)}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-all cursor-pointer border border-slate-100"
              >
                <span className="text-base font-bold">✕</span>
              </button>
            </div>

            {/* Document/Image display area */}
            <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden flex flex-col items-center justify-center min-h-[350px] relative p-1.5">
              {previewDocument.fileId ? (
                <ZoomableImage
                  src={`https://drive.google.com/thumbnail?sz=w1000&id=${previewDocument.fileId}`}
                  alt="Pratinjau Dokumen"
                  maxHeightClass="max-h-[50vh]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = document.getElementById('app-preview-fallback');
                    if (fallback) fallback.classList.remove('hidden');
                  }}
                />
              ) : previewDocument.url ? (
                <ZoomableImage
                  src={previewDocument.url}
                  alt="Pratinjau Dokumen"
                  maxHeightClass="max-h-[50vh]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = document.getElementById('app-preview-fallback');
                    if (fallback) fallback.classList.remove('hidden');
                  }}
                />
              ) : null}

              {/* Fallback block */}
              <div
                id="app-preview-fallback"
                className={`flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-3 ${previewDocument.fileId || previewDocument.url ? 'hidden absolute inset-0 bg-slate-50 flex' : ''}`}
              >
                <Paperclip className="w-12 h-12 text-slate-300" />
                <p className="text-xs font-bold text-slate-700">Dokumen Lampiran Terbuka</p>
                <p className="text-[10px] text-slate-400 max-w-[280px]">Pratinjau langsung tidak dapat ditampilkan (kemungkinan format non-gambar seperti PDF, atau adanya batasan hak akses berkas). Silakan buka tautan dokumen asli di bawah ini.</p>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-3 border-t border-slate-100 flex gap-3">
              <button
                type="button"
                onClick={() => setPreviewDocument(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all cursor-pointer text-center"
              >
                Tutup Preview
              </button>
              {previewDocument.url && (
                <a
                  href={previewDocument.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-indigo-100 text-center"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Buka Dokumen Asli</span>
                </a>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Modal BbmRefillModal */}
      {isBbmModalOpen && userProfile && (
        <BbmRefillModal
          userEmail={userProfile.email}
          managerEmail={userProfile.managerEmail}
          defaultSiteId={userProfile.divisi || 'DUREN-SAWIT'}
          sites={sites}
          userProfile={userProfile}
          onSubmit={handleBbmRefillSubmit}
          onClose={() => setIsBbmModalOpen(false)}
        />
      )}

      {/* Modal BbmListModal */}
      <BbmListModal
        isOpen={isBbmListModalOpen}
        onClose={() => setIsBbmListModalOpen(false)}
        requests={requests}
        usageItems={usageItems}
        profiles={profiles}
        activities={activities}
        role={activeRole}
        userEmail={userProfile?.email}
        onUpdateActivity={handleUpdateActivity}
        onOpenBbmRefillModal={userProfile?.aksesBBM ? () => setIsBbmModalOpen(true) : undefined}
        onPreviewDocument={(rawUrl) => {
          const match = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
          if (match && match[1]) {
            setPreviewDocument({ url: rawUrl, fileId: match[1], title: 'Nota Pengisian BBM Duren Sawit' });
          } else {
            setPreviewDocument({ url: rawUrl, title: 'Nota Pengisian BBM Duren Sawit' });
          }
        }}
      />

      {/* Modal Laporan Keuangan Finance */}
      <FinancialReportsModal
        isOpen={isFinancialReportsModalOpen}
        onClose={() => setIsFinancialReportsModalOpen(false)}
        requests={requests}
        usageItems={usageItems}
        profiles={profiles}
        role={activeRole}
      />

      {/* Modal Pratinjau Dashboard User Administrator */}
      <UserDashboardPreviewModal
        isOpen={isUserDashboardPreviewModalOpen}
        onClose={() => setIsUserDashboardPreviewModalOpen(false)}
        profiles={profiles}
        requests={requests}
        usageItems={usageItems}
        activities={activities}
        histories={itemReviewHistories}
        sites={sites}
      />

      {/* Modal Popup Preview Logo DIOMS */}
      {isDiomsLogoModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-slate-900/15 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
          onClick={() => setIsDiomsLogoModalOpen(false)}
        >
          <div 
            className="relative bg-white rounded-2xl p-4 md:p-6 max-w-3xl w-full max-h-[90vh] flex flex-col items-center justify-center shadow-2xl overflow-hidden my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsDiomsLogoModalOpen(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors font-bold z-10 shadow-sm"
              title="Tutup"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-full flex flex-col items-center justify-center p-2">
              <img
                src="/DIOMS-1.png"
                alt="DIOMS Logo"
                className="max-h-[75vh] w-auto max-w-full object-contain rounded-xl"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating 1-Click Google Reconnect Banner when modal is dismissed */}
      {(isTokenExpired || (!token && userProfile)) && !isAuthAlertModalOpen && (
        <div 
          id="google-auth-floating-banner"
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[9990] w-[95%] max-w-md bg-amber-600 text-white rounded-2xl shadow-2xl p-2.5 px-3.5 flex items-center justify-between gap-2 border border-amber-300 animate-slide-up"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-200 animate-ping shrink-0" />
            <p className="text-xs font-bold truncate">
              Sesi Google Terputus (Expired)
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleRenewGoogleToken}
              disabled={isLoading}
              className="py-1.5 px-3 bg-white hover:bg-amber-50 text-amber-800 font-extrabold text-[11px] rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
              <span>1-Klik Hubungkan</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAuthAlertModalOpen(true);
                setIsAuthModalDismissed(false);
              }}
              className="py-1.5 px-2.5 bg-amber-700/80 hover:bg-amber-700 text-white text-[11px] font-semibold rounded-xl transition-all cursor-pointer"
              title="Buka Detail Status Koneksi"
            >
              Detail
            </button>
          </div>
        </div>
      )}

      {/* Modal Popup Pemberitahuan Status Koneksi Google (Semua Role & Mengambang di Atas Layar Aktif) */}
      <GoogleConnectionModal
        isOpen={isAuthAlertModalOpen}
        onClose={() => {
          setIsAuthAlertModalOpen(false);
          setIsAuthModalDismissed(true);
        }}
        onRenewToken={handleRenewGoogleToken}
        isLoading={isLoading}
        errorMessage={error}
        userEmail={user?.email || (userProfile ? userProfile.email : 'ops.depotel@gmail.com')}
      />

      {/* Root Action Modals */}
      {reviewBudgetReq && (
        <ReviewBudgetModal
          request={reviewBudgetReq}
          requesterName={profiles.find(p => p.email.toLowerCase() === reviewBudgetReq.userEmail.toLowerCase())?.nama || reviewBudgetReq.userEmail}
          profiles={profiles}
          sites={sites}
          histories={itemReviewHistories}
          role={activeRole}
          onApprove={handleReviewBudget}
          onReject={handleRejectBudget}
          onClose={() => setReviewBudgetReq(null)}
        />
      )}

      {requestHistoryModalItem && (
        <ItemHistoryModal
          item={requestHistoryModalItem}
          histories={itemReviewHistories}
          onClose={() => setRequestHistoryModalItem(null)}
          onPreviewDocument={setPreviewDocument}
        />
      )}

      {reviewReportReq && (
        <ReviewReportModal
          request={reviewReportReq}
          requesterName={profiles.find(p => p.email.toLowerCase() === reviewReportReq.userEmail.toLowerCase())?.nama || reviewReportReq.userEmail}
          items={usageItems}
          role={activeRole}
          onSubmitReview={handleReviewUsageItems}
          onClose={() => setReviewReportReq(null)}
          onPreviewDocument={setPreviewDocument}
          activities={activities}
          profiles={profiles}
          requests={requests}
          histories={itemReviewHistories}
        />
      )}

      {pendingSharedRecord && (
        <FinanceSharedReceiptModal
          activeRole={activeRole}
          sharedRecord={pendingSharedRecord}
          requests={requests}
          profiles={profiles}
          onSwitchToFinanceRole={() => {
            setActiveRole(Role.FINANCE);
            setDashboardTab('APPROVAL');
            setStatusFilter('APPROVED');
            setActiveView('dashboard');
          }}
          onSelectCandidate={(candidateReq, file) => {
            setSharedFilePrefill({ file, recordId: pendingSharedRecord?.id });
            setTransferReq(candidateReq);
            setPendingSharedRecord(null);
          }}
          onClose={async () => {
            if (pendingSharedRecord?.id) {
              await deleteSharedReceipt(pendingSharedRecord.id);
            }
            await clearAllSharedReceipts();
            setPendingSharedRecord(null);
          }}
        />
      )}

      {shareAccessDeniedModal?.open && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden my-auto p-5 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Akses Ditolak - Share Bukti Transfer</h3>
                <p className="text-[11px] text-slate-500">Khusus Pengguna dengan Role Finance</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between items-center text-slate-600">
                <span className="text-[11px] font-medium">User ID / Akun:</span>
                <span className="font-bold text-slate-800">{shareAccessDeniedModal.userName}</span>
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span className="text-[11px] font-medium">Role Akun Anda:</span>
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                  {shareAccessDeniedModal.userRole}
                </span>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-xs leading-relaxed space-y-1">
              <p className="font-semibold text-red-900">⚠️ Proses Share Dibatalkan</p>
              <p className="text-[11px] text-red-700">
                Bukti transfer yang dikirim via Share hanya dapat diproses oleh pengguna dengan <strong>Role Finance</strong>. Karena akun Anda (<strong>{shareAccessDeniedModal.userName}</strong>) tidak memiliki kewenangan Role Finance, pemrosesan resi ini dibatalkan secara otomatis.
              </p>
            </div>

            <button
              onClick={() => setShareAccessDeniedModal(null)}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition-all cursor-pointer shadow-sm"
            >
              Mengerti &amp; Tutup
            </button>
          </div>
        </div>
      )}

      {transferReq && (
        <TransferModal
          request={transferReq}
          requesterName={profiles.find(p => p.email.toLowerCase() === transferReq.userEmail.toLowerCase())?.nama || transferReq.userEmail}
          profiles={profiles}
          onTransfer={handleAdminTransfer}
          onReject={handleRejectTransfer}
          histories={itemReviewHistories}
          onPreviewDocument={setPreviewDocument}
          onClose={async () => {
            if (sharedFilePrefill?.recordId) {
              await deleteSharedReceipt(sharedFilePrefill.recordId);
            }
            await clearAllSharedReceipts();
            setTransferReq(null);
            setSharedFilePrefill(null);
          }}
          googleToken={token!}
          driveFolderId={driveFolderId}
          onAuthError={handleGoogleAuthError}
          approvedUsageAmount={
            usageItems
              .filter(item => item.requestId === transferReq.id && item.statusAdmin === ItemStatus.APPROVED)
              .reduce((sum, item) => sum + item.nominal, 0)
          }
          initialFile={sharedFilePrefill?.file}
        />
      )}

      {closingConfirmReq && (() => {
        const reqItems = usageItems.filter(i => i.requestId === closingConfirmReq.id);
        const approvedUsage = reqItems
          .filter(i => i.statusAdmin === ItemStatus.APPROVED)
          .reduce((sum, i) => sum + i.nominal, 0);
        const totalTransfer = parseNumericValue(closingConfirmReq.adminActionAmount || closingConfirmReq.jumlahPengajuan);
        const selisih = approvedUsage - totalTransfer;

        return (
          <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-[2px] flex items-center justify-center p-4 z-[100] animate-fade-in overflow-y-auto">
            <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-100 space-y-4 animate-scale-up my-auto">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Form Closing Laporan Keuangan</h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    UID: <span className="font-mono font-bold text-slate-700">{closingConfirmReq.id}</span> | Pemohon: <span className="font-semibold text-slate-700">{closingConfirmReq.userEmail}</span>
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-150 space-y-2 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ringkasan Rekonsiliasi Finansial</span>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white p-2.5 rounded-xl border border-slate-150">
                    <span className="text-[9px] text-slate-400 block font-semibold uppercase">Total Transfer</span>
                    <span className="font-bold text-slate-800 text-xs font-display">{formatIDR(totalTransfer)}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-slate-150">
                    <span className="text-[9px] text-slate-400 block font-semibold uppercase">Laporan Disetujui</span>
                    <span className="font-bold text-emerald-600 text-xs font-display">{formatIDR(approvedUsage)}</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-slate-150">
                    <span className="text-[9px] text-slate-400 block font-semibold uppercase">Rekonsiliasi</span>
                    <span className={`font-bold text-xs font-display ${selisih === 0 ? 'text-emerald-600' : selisih > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                      {selisih === 0 ? 'Pas / Clear' : selisih > 0 ? `+${formatIDR(selisih)}` : formatIDR(selisih)}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed bg-amber-50/50 p-3 rounded-xl border border-amber-100 text-amber-800">
                <strong>Perhatian:</strong> Seluruh item laporan telah disetujui Finance. Melakukan Closing akan secara permanen menyelesaikan UID ini dan menyimpan riwayat transaksi secara final.
              </p>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setClosingConfirmReq(null)}
                  className="flex-1 py-2.5 px-4 border border-slate-150 hover:bg-slate-50 text-slate-600 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  Batal
                </button>
                <button
                  onClick={async () => {
                    const req = closingConfirmReq;
                    setClosingConfirmReq(null);
                    await handleCloseRequest(req);
                  }}
                  className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-emerald-100 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Selesaikan & Form Closing</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {cancelConfirmReq && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-[2px] flex items-center justify-center p-4 z-[100] animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4 animate-scale-up my-auto">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600">
              <XCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-slate-800">Batalkan Pengajuan UID {cancelConfirmReq.id}?</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Apakah Anda yakin ingin membatalkan pengajuan dana ini? Status pengajuan akan diubah secara permanen menjadi <strong>CANCELLED</strong> dan dikecualikan dari seluruh proses operasional aplikasi.
              </p>
              <div className="bg-slate-50 p-3 rounded-xl text-xs space-y-1 border border-slate-100 mt-2">
                <p className="text-slate-700 font-medium">Keterangan: <strong>{cancelConfirmReq.keterangan}</strong></p>
                <p className="text-slate-700 font-medium">Nominal: <strong className="text-indigo-600">{formatIDR(cancelConfirmReq.jumlahPengajuan)}</strong></p>
                {cancelConfirmReq.managerComment && (
                  <p className="text-amber-700 font-medium text-[11px] pt-1">
                    {(() => {
                      const p = profiles.find(prof => prof.email.trim().toLowerCase() === (cancelConfirmReq?.userEmail || '').trim().toLowerCase());
                      return (p?.role === Role.MANAGER || p?.role === Role.FINANCE) ? 'Catatan Revisi Direktur:' : 'Catatan Revisi Manager:';
                    })()} "{cancelConfirmReq.managerComment}"
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCancelConfirmReq(null)}
                className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-all cursor-pointer"
              >
                Kembali
              </button>
              <button
                type="button"
                onClick={() => handleCancelBudgetRequest(cancelConfirmReq)}
                className="flex-1 py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-all cursor-pointer shadow-sm"
              >
                Ya, Batalkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
