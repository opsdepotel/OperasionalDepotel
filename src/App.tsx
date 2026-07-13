/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, startDemoMode } from './lib/firebase';
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
  saveUserProfile
} from './lib/googleApi';
import { BudgetRequest, UsageReportItem, UserProfile, Role, RequestStatus, ItemStatus } from './types';

// Components
import { Header } from './components/Header';
import { ProfileSetup } from './components/ProfileSetup';
import { DashboardStats } from './components/DashboardStats';
import { BudgetRequestForm } from './components/BudgetRequestForm';
import { UsageReportForm } from './components/UsageReportForm';
import { ReviewBudgetModal } from './components/ReviewBudgetModal';
import { TransferModal } from './components/TransferModal';
import { ReviewReportModal } from './components/ReviewReportModal';
import { AppLoginForm } from './components/AppLoginForm';

// Icons
import {
  Coins, ClipboardList, CheckCircle2, AlertCircle, Clock, Plus, LogIn,
  RefreshCw, FileSpreadsheet, Eye, Search, AlertTriangle, Check, CreditCard,
  Briefcase, MessageSquare, ExternalLink, CheckSquare, XCircle, ArrowRight,
  Database, ArrowLeft, ArrowRightLeft, Paperclip
} from 'lucide-react';

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [unauthorizedDomainInfo, setUnauthorizedDomainInfo] = useState<{ hostname: string; projectId: string } | null>(null);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [isPopupClosedError, setIsPopupClosedError] = useState(false);
  const [copied, setCopied] = useState(false);

  const isInvalidGoogleAccount = !!(user && user.email && user.email.toLowerCase() !== 'ops.depotel@gmail.com' && token !== 'mock_demo_token');

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

  // Data arrays
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [usageItems, setUsageItems] = useState<UsageReportItem[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Simulation Role Override
  const [activeRole, setActiveRole] = useState<Role>(Role.USER);

  // Navigation / Views
  const [activeView, setActiveView] = useState<'dashboard' | 'new-request' | 'report-usage' | 'setup-profile'>('dashboard');
  const [selectedRequest, setSelectedRequest] = useState<BudgetRequest | null>(null);

  // Review Modals Active
  const [reviewBudgetReq, setReviewBudgetReq] = useState<BudgetRequest | null>(null);
  const [reviewReportReq, setReviewReportReq] = useState<BudgetRequest | null>(null);
  const [transferReq, setTransferReq] = useState<BudgetRequest | null>(null);
  const [closingConfirmReq, setClosingConfirmReq] = useState<BudgetRequest | null>(null);
  const [previewDocument, setPreviewDocument] = useState<{ url: string; fileId?: string; title: string } | null>(null);

  // Search/Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [initialIsTalangan, setInitialIsTalangan] = useState(false);

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

    // Strict validation: Ensure connected Google account is ops.depotel@gmail.com or mock demo
    const emailLower = user.email?.toLowerCase();
    const isValidEmail = emailLower === 'ops.depotel@gmail.com' || token === 'mock_demo_token';
    if (!isValidEmail) {
      console.warn('initializeDatabaseAndLoad: Invalid Google email detected, skipping database sync.');
      return;
    }

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
        console.warn('Google API returned 401 Unauthorized. Resetting auth state...');
        await logout();
        setToken(null);
        setUser(null);
        setNeedsAuth(true);
        setError('Sesi Google Anda telah berakhir atau tidak valid. Silakan hubungkan kembali Google Account Anda.');
      } else {
        setError(err.message || 'Gagal menginisialisasi Google Workspace.');
      }
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const syncAllData = async (accessToken: string, sheetId: string) => {
    try {
      const [allReqs, allItems, allProfs] = await Promise.all([
        fetchBudgetRequests(accessToken, sheetId),
        fetchUsageItems(accessToken, sheetId),
        fetchProfiles(accessToken, sheetId)
      ]);

      setRequests(allReqs.sort((a, b) => b.id.localeCompare(a.id))); // Newest first
      setUsageItems(allItems);
      setProfiles(allProfs);

      // If the user is already logged in, keep their active session and update with the latest data
      if (userProfile) {
        const updatedProfile = allProfs.find(
          p => p.userId?.toLowerCase() === userProfile.userId?.toLowerCase()
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
          const adminProf = allProfs.find(p => p.role === Role.ADMIN || p.userId === 'admin');
          if (adminProf && adminProf.email !== 'ops.depotel@gmail.com') {
            adminProf.email = 'ops.depotel@gmail.com';
            adminProf.nama = 'Administrator Depotel';
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
        console.warn('Google API returned 401 Unauthorized during refresh. Resetting auth...');
        await logout();
        setToken(null);
        setUser(null);
        setNeedsAuth(true);
        setError('Sesi Google Anda telah berakhir atau tidak valid. Silakan hubungkan kembali Google Account Anda.');
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
    setUnauthorizedDomainInfo(null);
    setIsNetworkError(false);
    setIsPopupClosedError(false);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err: any) {
      console.error('Login error details:', err);
      if (err.code === 'auth/unauthorized-domain' || err.message?.includes('unauthorized-domain')) {
        const hostname = window.location.hostname;
        const projectId = firebaseConfig.projectId || 'absolute-portfolio-q2t1j';
        setUnauthorizedDomainInfo({ hostname, projectId });
      } else if (err.code === 'auth/network-request-failed' || err.message?.includes('network-request-failed')) {
        setIsNetworkError(true);
        setError('Koneksi diblokir oleh browser (Network Request Failed). Ini biasanya terjadi ketika Firebase Auth dijalankan di dalam iframe preview AI Studio.');
      } else if (err.code === 'auth/popup-closed-by-user' || err.message?.includes('popup-closed-by-user')) {
        setIsPopupClosedError(true);
        setError('Pintu masuk ditutup sebelum selesai. Jika Anda berada di dalam preview AI Studio, harap gunakan tombol "Buka di Tab Baru" di bawah atau "Mode Demo (Offline)".');
      } else if (err.code === 'auth/popup-blocked' || err.message?.includes('popup-blocked')) {
        setError('Popup masuk diblokir oleh browser. Izinkan popup untuk situs ini atau gunakan "Buka di Tab Baru".');
      } else {
        setError(err.message || 'Login gagal. Pastikan Anda menyetujui izin Google Sheets dan Drive.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleAuthError = async () => {
    console.warn('Google API returned 401 Unauthorized. Resetting auth...');
    await logout();
    setToken(null);
    setUser(null);
    setNeedsAuth(true);
    setSpreadsheetId(null);
    setDriveFolderId(null);
    setRequests([]);
    setUsageItems([]);
    setProfiles([]);
    setUserProfile(null);
    setActiveView('dashboard');
    setError('Sesi Google Anda telah berakhir. Silakan hubungkan kembali akun Google Anda untuk melanjutkan.');
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
    sessionStorage.removeItem('op_app_logged_in_user_id');
    setUserProfile(null);
    setActiveView('dashboard');
  };

  const handleResetGoogleConnection = async () => {
    await logout();
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

  const handleAppLoginSuccess = (profile: UserProfile) => {
    setUserProfile(profile);
    if (profile.userId) {
      sessionStorage.setItem('op_app_logged_in_user_id', profile.userId);
    }
    setActiveRole(profile.role);
    setActiveView('dashboard');
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

  // Workflow Action 1: Create Budget Request
  const handleAddBudgetRequest = async (newRequest: BudgetRequest) => {
    if (!token || !spreadsheetId) return;
    const success = await runGoogleAction(
      () => createBudgetRequest(token, spreadsheetId, newRequest),
      'Gagal menambahkan pengajuan.'
    );
    if (success !== null) {
      const isReqTalangan = newRequest.id.startsWith('OPT-') || newRequest.keterangan.startsWith('[DANA TALANGAN]');
      if (isReqTalangan) {
        setSelectedRequest(newRequest);
        setActiveView('report-usage');
      } else {
        setActiveView('dashboard');
      }
      await handleManualRefresh();
    }
  };

  // Workflow Action 2: Review Budget Request (Manager Action)
  const handleReviewBudget = async (approvedAmount: number, comment: string) => {
    if (!token || !spreadsheetId || !reviewBudgetReq) return;
    const isApprovedFull = approvedAmount === reviewBudgetReq.jumlahPengajuan;

    const updated: BudgetRequest = {
      ...reviewBudgetReq,
      status: isApprovedFull ? RequestStatus.APPROVED : RequestStatus.PARTIALLY_APPROVED,
      managerActionAmount: approvedAmount,
      managerComment: comment,
      createdAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
    };

    const success = await runGoogleAction(
      () => updateBudgetRequest(token, spreadsheetId, updated),
      'Gagal menyimpan persetujuan anggaran.'
    );
    if (success !== null) {
      setReviewBudgetReq(null);
      await handleManualRefresh();
    }
  };

  const handleRejectBudget = async (reason: string) => {
    if (!token || !spreadsheetId || !reviewBudgetReq) return;

    const updated: BudgetRequest = {
      ...reviewBudgetReq,
      status: RequestStatus.REJECTED,
      managerActionAmount: 0,
      managerComment: reason
    };

    const success = await runGoogleAction(
      () => updateBudgetRequest(token, spreadsheetId, updated),
      'Gagal menolak anggaran.'
    );
    if (success !== null) {
      setReviewBudgetReq(null);
      await handleManualRefresh();
    }
  };

  // Workflow Action 3: Admin Transfer Funds
  const handleAdminTransfer = async (transferredAmount: number, buktiUrl: string, buktiFileId: string) => {
    if (!token || !spreadsheetId || !transferReq) return;

    const updated: BudgetRequest = {
      ...transferReq,
      status: RequestStatus.TRANSFERRED,
      adminActionAmount: transferredAmount,
      buktiTransferUrl: buktiUrl,
      buktiTransferFileId: buktiFileId
    };

    const success = await runGoogleAction(
      () => updateBudgetRequest(token, spreadsheetId, updated),
      'Gagal memproses transfer anggaran.'
    );
    if (success !== null) {
      setTransferReq(null);
      await handleManualRefresh();
    }
  };

  // Workflow Action 4: User Usage Reporting Management
  const handleAddUsageItem = async (newItem: UsageReportItem) => {
    if (!token || !spreadsheetId) return;
    const success = await runGoogleAction(
      () => createUsageItem(token, spreadsheetId, newItem),
      'Gagal menambahkan item penggunaan.'
    );
    if (success !== null) {
      if (selectedRequest && selectedRequest.status === RequestStatus.TRANSFERRED) {
        const updatedReq = { ...selectedRequest, status: RequestStatus.REPORTING };
        await updateBudgetRequest(token, spreadsheetId, updatedReq);
        setSelectedRequest(updatedReq);
      }
      await handleManualRefresh();
    }
  };

  const handleUpdateUsageItem = async (updatedItem: UsageReportItem) => {
    if (!token || !spreadsheetId) return;
    const success = await runGoogleAction(
      () => updateUsageItem(token, spreadsheetId, updatedItem),
      'Gagal memperbarui item penggunaan.'
    );
    if (success !== null) {
      if (selectedRequest && selectedRequest.status === RequestStatus.TRANSFERRED) {
        const updatedReq = { ...selectedRequest, status: RequestStatus.REPORTING };
        await updateBudgetRequest(token, spreadsheetId, updatedReq);
        setSelectedRequest(updatedReq);
      }
      await handleManualRefresh();
    }
  };

  const handleDeleteUsageItem = async (itemId: string) => {
    if (!token || !spreadsheetId) return;
    const success = await runGoogleAction(
      () => deleteUsageItem(token, spreadsheetId, itemId),
      'Gagal menghapus item penggunaan.'
    );
    if (success !== null) {
      await handleManualRefresh();
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

  // Workflow Action 5: Review Usage Items (Manager/Admin Action)
  const handleReviewUsageItems = async (
    itemDecisions: { itemId: string; status: ItemStatus; comment: string }[],
    nextRequestStatus: RequestStatus,
    targetReq?: BudgetRequest
  ) => {
    const reqToUse = targetReq || reviewReportReq || selectedRequest;
    if (!token || !spreadsheetId || !reqToUse) return;

    const success = await runGoogleAction(async () => {
      const targetItems = usageItems.filter(i => i.requestId === reqToUse.id);
      for (const dec of itemDecisions) {
        const original = targetItems.find(i => i.id === dec.itemId);
        if (original) {
          const updatedItem: UsageReportItem = {
            ...original,
            statusManager: activeRole === Role.MANAGER ? dec.status : original.statusManager,
            managerComment: activeRole === Role.MANAGER ? dec.comment : original.managerComment,
            statusAdmin: activeRole === Role.ADMIN ? dec.status : original.statusAdmin,
            adminComment: activeRole === Role.ADMIN ? dec.comment : original.adminComment,
            updatedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
          };
          await updateUsageItem(token, spreadsheetId, updatedItem);
        }
      }

      const updatedReq: BudgetRequest = {
        ...reqToUse,
        status: nextRequestStatus
      };
      await updateBudgetRequest(token, spreadsheetId, updatedReq);
    }, 'Gagal memproses review penggunaan.');

    if (success !== null) {
      setReviewReportReq(null);
      setSelectedRequest(null);
      setActiveView('dashboard');
      await handleManualRefresh();
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

  // Filter manager email list from existing profiles to make it easy for users to choose
  const managerEmails = profiles
    .filter(p => p.role === Role.MANAGER)
    .map(p => p.email);

  // Filtering Logic for requests list on Dashboard
  const filteredRequests = requests.filter((r) => {
    // Role based scoping
    if (activeRole === Role.USER) {
      // User only sees their own requests
      if (r.userEmail.toLowerCase() !== userProfile?.email?.toLowerCase()) return false;
    } else if (activeRole === Role.MANAGER) {
      // Manager only sees requests assigned to them
      if (r.managerEmail.toLowerCase() !== userProfile?.email?.toLowerCase()) return false;
    }
    // Admin sees everything!
    if (activeRole === Role.ADMIN) {
      if (r.status === RequestStatus.REVIEW_ADMIN || r.status === RequestStatus.REPORTING) {
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
      if (!matchId && !matchDesc && !matchSite && !matchUser) return false;
    }

    // Status Filter
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'PENDING') {
        if (r.status !== RequestStatus.PENDING_APPROVAL) return false;
      } else if (statusFilter === 'APPROVED') {
        if (r.status !== RequestStatus.APPROVED && r.status !== RequestStatus.PARTIALLY_APPROVED) return false;
      } else if (statusFilter === 'TRANSFERRED') {
        if (activeRole === Role.MANAGER) {
          if (r.status !== RequestStatus.TRANSFERRED && r.status !== RequestStatus.REPORTING) return false;
        } else {
          if (r.status !== RequestStatus.TRANSFERRED) return false;
        }
      } else if (statusFilter === 'REPORTING') {
        // For USER, "Proses Laporan" should display all requests that are REPORTING or TRANSFERRED as requested.
        if (activeRole === Role.USER) {
          if (r.status !== RequestStatus.TRANSFERRED &&
              r.status !== RequestStatus.REPORTING) return false;
        } else if (activeRole === Role.MANAGER) {
          if (r.status !== RequestStatus.REPORTING && r.status !== RequestStatus.REVIEW_MANAGER && r.status !== RequestStatus.REVIEW_ADMIN) return false;
        } else if (activeRole === Role.ADMIN) {
          if (r.status !== RequestStatus.REVIEW_ADMIN && r.status !== RequestStatus.REPORTING) return false;
        } else {
          if (r.status !== RequestStatus.REPORTING && r.status !== RequestStatus.REVIEW_MANAGER && r.status !== RequestStatus.REVIEW_ADMIN) return false;
        }
      } else if (statusFilter === 'CLOSED') {
        if (r.status !== RequestStatus.CLOSED) return false;
      } else if (statusFilter === 'REJECTED') {
        if (r.status !== RequestStatus.REJECTED) return false;
      }
    }

    return true;
  });

  const getStatusBadgeStyles = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.PENDING_APPROVAL:
        return 'bg-amber-50 text-amber-600 border border-amber-150';
      case RequestStatus.APPROVED:
      case RequestStatus.PARTIALLY_APPROVED:
        return 'bg-blue-50 text-blue-600 border border-blue-150';
      case RequestStatus.REJECTED:
        return 'bg-red-50 text-red-600 border border-red-150';
      case RequestStatus.TRANSFERRED:
        return 'bg-emerald-50 text-emerald-600 border border-emerald-150';
      case RequestStatus.REPORTING:
        return 'bg-purple-50 text-purple-600 border border-purple-150';
      case RequestStatus.REVIEW_MANAGER:
        return 'bg-indigo-50 text-indigo-600 border border-indigo-150';
      case RequestStatus.REVIEW_ADMIN:
        return 'bg-cyan-50 text-cyan-600 border border-cyan-150';
      case RequestStatus.CLOSED:
        return 'bg-slate-100 text-slate-500 border border-slate-200';
      default:
        return 'bg-slate-50 text-slate-600 border border-slate-150';
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
        return 'border-l-red-500';
      case RequestStatus.TRANSFERRED:
        return 'border-l-emerald-500';
      case RequestStatus.REPORTING:
        return 'border-l-purple-500';
      case RequestStatus.REVIEW_MANAGER:
        return 'border-l-indigo-500';
      case RequestStatus.REVIEW_ADMIN:
        return 'border-l-cyan-500';
      case RequestStatus.CLOSED:
        return 'border-l-slate-400';
      default:
        return 'border-l-slate-300';
    }
  };

  const getStatusLabel = (status: RequestStatus) => {
    switch (status) {
      case RequestStatus.PENDING_APPROVAL: return 'Menunggu Review Manager';
      case RequestStatus.APPROVED: return 'Disetujui Penuh Manager';
      case RequestStatus.PARTIALLY_APPROVED: return 'Disetujui Sebagian Manager';
      case RequestStatus.REJECTED: return 'Ditolak Manager';
      case RequestStatus.TRANSFERRED: return 'Dana Ditransfer Admin';
      case RequestStatus.REPORTING: return 'Pelaporan Penggunaan';
      case RequestStatus.REVIEW_MANAGER: return 'Review Laporan (Manager)';
      case RequestStatus.REVIEW_ADMIN: return 'Review Laporan (Admin)';
      case RequestStatus.CLOSED: return 'Closing';
      default: return status;
    }
  };

  const formatIDR = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0
    }).format(num);
  };

  // Render Login state
  if (needsAuth || isInvalidGoogleAccount) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-xl p-6 text-center space-y-6 animate-slide-up">
          {/* Logo illustration */}
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto shadow-md border border-indigo-100">
            {isInvalidGoogleAccount ? (
              <XCircle className="w-8 h-8 text-red-600 animate-pulse" />
            ) : (
              <Database className="w-8 h-8 text-indigo-600" />
            )}
          </div>

          <div>
            <h1 className="font-display font-black text-slate-800 text-base tracking-tight">
              {isInvalidGoogleAccount ? 'Akun Google Salah' : 'Koneksi Google Account'}
            </h1>
          </div>

          {isInvalidGoogleAccount ? (
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
          ) : unauthorizedDomainInfo ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 text-xs text-left space-y-3.5 animate-slide-up">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 animate-bounce" />
                <div>
                  <h3 className="font-bold text-amber-800 text-xs">Domain Belum Diotorisasi</h3>
                  <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                    Domain preview ini belum terdaftar di daftar <strong>Authorized Domains</strong> Firebase Authentication Anda.
                  </p>
                </div>
              </div>

              <div className="bg-amber-100/50 p-2 rounded-xl border border-amber-200/50 flex items-center justify-between gap-2">
                <code className="text-[10px] font-mono break-all font-bold select-all text-amber-900">
                  {unauthorizedDomainInfo.hostname}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(unauthorizedDomainInfo.hostname);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[9px] font-bold transition-colors cursor-pointer shrink-0"
                >
                  {copied ? 'Tersalin!' : 'Salin'}
                </button>
              </div>

              <a
                href={`https://console.firebase.google.com/project/${unauthorizedDomainInfo.projectId}/authentication/providers`}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer text-center"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Buka Settings Firebase Console</span>
              </a>

              <div className="text-[10px] text-amber-800/80 space-y-1 bg-amber-100/30 p-2.5 rounded-xl border border-amber-200/30">
                <p className="font-bold text-amber-800">Langkah Otorisasi:</p>
                <ol className="list-decimal pl-3.5 space-y-1">
                  <li>Klik tombol di atas untuk membuka Firebase Console Anda.</li>
                  <li>Di menu sebelah kiri, buka <strong>Authentication</strong>, lalu klik tab <strong>Settings</strong> di kanan atas.</li>
                  <li>Pilih menu <strong>Authorized domains</strong> di kolom kiri.</li>
                  <li>Klik <strong>Add domain</strong>, masukkan domain yang telah disalin di atas, and klik <strong>Add</strong>.</li>
                  <li>Kembali ke sini dan klik <strong>Hubungkan kembali</strong> di bawah.</li>
                </ol>
              </div>
            </div>
          ) : isNetworkError ? (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-950 rounded-2xl p-4 text-xs text-left space-y-3.5 animate-slide-up">
              <div className="flex items-start gap-2.5">
                <div className="p-1 bg-indigo-100 text-indigo-700 rounded-lg shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-indigo-900 text-xs">Blokir Koneksi Iframe Detected</h3>
                  <p className="text-[11px] text-indigo-700/90 mt-1 leading-relaxed">
                    Browser memblokir popup Google Auth karena aplikasi ini sedang berjalan di dalam panel <strong>Iframe Preview AI Studio</strong>.
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-1 border-t border-indigo-100">
                <p className="font-bold text-[11px] text-indigo-900 flex items-center gap-1">
                  <span>💡 Solusi Terbaik (Pilih Salah Satu):</span>
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-center font-bold text-[11px] flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>1. Buka di Tab Baru (Disarankan)</span>
                  </a>
                  <button
                    onClick={() => startDemoMode()}
                    className="p-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 rounded-xl text-center font-bold text-[11px] flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <CheckSquare className="w-4 h-4 text-emerald-600" />
                    <span>2. Gunakan Mode Demo (Offline)</span>
                  </button>
                </div>
              </div>
            </div>
          ) : isPopupClosedError ? (
            <div className="bg-amber-50 border border-amber-200 text-amber-950 rounded-2xl p-4 text-xs text-left space-y-3.5 animate-slide-up animate-duration-300">
              <div className="flex items-start gap-2.5">
                <div className="p-1 bg-amber-100 text-amber-700 rounded-lg shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-bold text-amber-900 text-xs">Error 403 / Login Ditutup</h3>
                  <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                    Koneksi gagal atau ditutup karena popup Google mendeteksi <strong>Error 403: access_denied</strong> (Aplikasi belum diverifikasi / dalam mode Testing).
                  </p>
                </div>
              </div>

              <div className="text-[10px] text-amber-800/90 space-y-2.5 bg-amber-100/30 p-3 rounded-xl border border-amber-200/30">
                <p className="font-bold text-amber-800 flex items-center gap-1">
                  <span>🛠️ Cara Mengatasi Error 403 (Pilih salah satu):</span>
                </p>
                <div className="space-y-3 pl-1">
                  <div>
                    <span className="font-bold text-amber-900 block mb-0.5">Metode A: Tambahkan Email sebagai Test User (Sangat Direkomendasikan)</span>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>
                        Buka <a href={`https://console.cloud.google.com/apis/credentials/consent?project=${firebaseConfig.projectId}`} target="_blank" rel="noreferrer" className="text-indigo-600 font-bold underline inline-flex items-center gap-0.5">Google Cloud Console - OAuth Consent Screen <ExternalLink className="w-2.5 h-2.5" /></a>.
                      </li>
                      <li>
                        Gulir ke bawah ke bagian <strong>Test users</strong>, klik tombol <strong>+ Add Users</strong>.
                      </li>
                      <li>
                        Masukkan email Anda: <strong className="select-all font-mono text-[9px] bg-amber-100 px-1 py-0.5 rounded border border-amber-200 text-amber-900">ops.depotel@gmail.com</strong>
                      </li>
                      <li>
                        Klik <strong>Save</strong> dan coba masuk kembali.
                      </li>
                    </ol>
                  </div>

                  <div className="border-t border-amber-200/50 pt-2">
                    <span className="font-bold text-amber-900 block mb-0.5">Metode B: Ubah Status ke "In Production"</span>
                    <p className="leading-relaxed text-amber-800">
                      Pada link <a href={`https://console.cloud.google.com/apis/credentials/consent?project=${firebaseConfig.projectId}`} target="_blank" rel="noreferrer" className="text-indigo-600 font-bold underline">OAuth Consent Screen</a> di atas, klik tombol <strong>Publish App</strong> di bawah "Publishing status". Ini akan membuka akses untuk semua email tanpa verifikasi (abaikan peringatan Unverified).
                    </p>
                  </div>

                  <div className="border-t border-amber-200/50 pt-2">
                    <span className="font-bold text-amber-900 block mb-0.5">Metode C: Otorisasi Domain di Firebase</span>
                    <p className="leading-relaxed text-amber-800">
                      Buka <a href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`} target="_blank" rel="noreferrer" className="text-indigo-600 font-bold underline">Firebase Console Settings</a>, pilih tab <strong>Sign-in method</strong> &rarr; aktifkan <strong>Google</strong>. Lalu di tab <strong>Settings</strong> &rarr; <strong>Authorized domains</strong>, daftarkan domain di bawah ini:
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-amber-100/50 p-2.5 rounded-xl border border-amber-200/50 flex items-center justify-between gap-2">
                <code className="text-[10px] font-mono break-all font-bold select-all text-amber-900">
                  {window.location.hostname}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.hostname);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[9px] font-bold transition-all cursor-pointer shrink-0"
                >
                  {copied ? 'Tersalin!' : 'Salin'}
                </button>
              </div>

              <div className="space-y-2 pt-1 border-t border-amber-100">
                <p className="font-bold text-[11px] text-amber-900">💡 Alternatif Instan:</p>
                <div className="grid grid-cols-1 gap-2">
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-center font-bold text-[11px] flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Buka di Tab Baru</span>
                  </a>
                  <button
                    onClick={() => startDemoMode()}
                    className="p-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 rounded-xl text-center font-bold text-[11px] flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    <CheckSquare className="w-4 h-4 text-emerald-600" />
                    <span>Gunakan Mode Demo (Offline)</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            error && (
              <div className="bg-red-50 border border-red-100 text-red-600 rounded-2xl p-3 text-xs flex items-start gap-2 text-left animate-slide-up">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                <span>{error}</span>
              </div>
            )
          )}

          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
          >
            {isLoggingIn ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Menghubungkan Google...</span>
              </>
            ) : (
              <>
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
                <span>{unauthorizedDomainInfo || isNetworkError || isPopupClosedError ? 'Coba Hubungkan Kembali' : 'Menghubungkan dengan Google'}</span>
              </>
            )}
          </button>

          <div className="pt-4 border-t border-slate-100 flex flex-col gap-2">
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <ExternalLink className="w-4 h-4 text-slate-500" />
              <span>Buka di Tab Baru (Disarankan)</span>
            </a>

            <button
              onClick={() => {
                if (confirm('Gunakan Mode Demo (Offline)? Data operasional akan disimpan di browser secara lokal tanpa memerlukan Google Sheets.')) {
                  startDemoMode();
                }
              }}
              className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-2 border border-slate-200 transition-all cursor-pointer"
            >
              <Database className="w-4 h-4 text-slate-500" />
              <span>Gunakan Mode Demo (Offline)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render Loader state (Database initialization or global action loaders)
  if (isLoading && loadingStep) {
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
      {userProfile && (
        <Header
          userProfile={userProfile}
          role={activeRole}
          onRoleChange={setActiveRole}
          onLogout={handleLogout}
          spreadsheetId={spreadsheetId}
          onRefresh={handleManualRefresh}
          isRefreshing={isLoading}
        />
      )}

      {/* Main Container */}
      <main className="flex-1 p-4 max-w-md mx-auto w-full space-y-4">
        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 rounded-2xl p-4 text-xs flex items-start gap-2.5 animate-slide-up">
            <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5 text-red-500" />
            <div>
              <p className="font-bold">Terjadi Kesalahan</p>
              <p className="text-[11px] text-red-600 mt-0.5">{error}</p>
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
          />
        ) : activeView === 'setup-profile' ? (
          <ProfileSetup
            profiles={profiles}
            onSave={handleSaveProfile}
            onClose={() => setActiveView('dashboard')}
          />
        ) : activeView === 'new-request' && userProfile ? (
          <BudgetRequestForm
            userEmail={userProfile.email}
            managerEmail={userProfile.managerEmail}
            defaultSiteId=""
            onSubmit={handleAddBudgetRequest}
            onClose={() => setActiveView('dashboard')}
            initialIsTalangan={initialIsTalangan}
          />
        ) : activeView === 'report-usage' && selectedRequest && driveFolderId ? (
          <UsageReportForm
            request={selectedRequest}
            items={usageItems}
            googleToken={token!}
            driveFolderId={driveFolderId}
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
          />
        ) : (
          /* Dashboard Main Section */
          <div className="space-y-4 animate-slide-up">
            {statusFilter === 'ALL' ? (
              <>
                {/* Quick Profile/Role indicator banner */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold font-display text-sm border border-slate-200 overflow-hidden">
                      {userProfile?.nama ? (
                        <span className="text-indigo-600">{userProfile.nama.charAt(0).toUpperCase()}</span>
                      ) : userProfile?.userId ? (
                        <span className="text-indigo-600">{userProfile.userId.charAt(0).toUpperCase()}</span>
                      ) : user?.photoURL ? (
                        <img src={user.photoURL} alt="Profile" className="w-10 h-10 rounded-xl" referrerPolicy="no-referrer" />
                      ) : (
                        userProfile?.email?.charAt(0).toUpperCase() || 'U'
                      )}
                    </div>
                    <div>
                      <h2 className="font-display font-bold text-slate-800 text-xs truncate max-w-[180px]">
                        {userProfile?.nama || userProfile?.userId || userProfile?.email}
                      </h2>
                      <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1 mt-0.5">
                        Role Aktif: <span className="text-indigo-600 font-bold">{activeRole}</span>
                        {userProfile && userProfile.divisi && (
                          <span>| Divisi: {userProfile.divisi}</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Core Stats Section */}
                <DashboardStats
                  role={activeRole}
                  email={userProfile?.email || ''}
                  requests={requests}
                  usageItems={usageItems}
                  activeFilter={statusFilter}
                  onSelectFilter={setStatusFilter}
                  onManageUsers={() => setActiveView('setup-profile')}
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

                {/* Action Modals */}
                {reviewBudgetReq && (
                  <ReviewBudgetModal
                    request={reviewBudgetReq}
                    requesterName={profiles.find(p => p.email.toLowerCase() === reviewBudgetReq.userEmail.toLowerCase())?.nama || reviewBudgetReq.userEmail}
                    onApprove={handleReviewBudget}
                    onReject={handleRejectBudget}
                    onClose={() => setReviewBudgetReq(null)}
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
                  />
                )}

                {transferReq && (
                  <TransferModal
                    request={transferReq}
                    requesterName={profiles.find(p => p.email.toLowerCase() === transferReq.userEmail.toLowerCase())?.nama || transferReq.userEmail}
                    onTransfer={handleAdminTransfer}
                    onClose={() => setTransferReq(null)}
                    googleToken={token!}
                    driveFolderId={driveFolderId}
                    onAuthError={handleGoogleAuthError}
                  />
                )}

                {closingConfirmReq && (
                  <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
                    <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-100 space-y-4 animate-scale-up">
                      <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
                        <AlertCircle className="w-6 h-6" />
                      </div>
                      <div className="space-y-1.5">
                        <h3 className="text-sm font-bold text-slate-800">Konfirmasi Closing UID {closingConfirmReq.id}</h3>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Apakah Anda yakin ingin melakukan **Closing** untuk pengajuan dana ini? Proses ini bersifat final dan mengunci seluruh rincian item penggunaan dana secara permanen.
                        </p>
                      </div>
                      <div className="flex gap-3 pt-2">
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
                          className="flex-1 py-2.5 px-4 bg-slate-900 hover:bg-slate-850 text-white font-bold text-xs rounded-xl transition-all shadow-sm cursor-pointer"
                        >
                          Ya, Closing
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Request Listing Container */}
                {!reviewBudgetReq && !reviewReportReq && !transferReq && (
                  <div className="space-y-3 pt-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Daftar Pengajuan: <span className="text-indigo-600 font-bold">
                          {statusFilter === 'REPORTING' && activeRole === Role.USER ? 'Proses Laporan (Transferred & Reporting)' :
                           statusFilter === 'REPORTING' && activeRole === Role.MANAGER ? 'Review Penggunaan Anggaran (Termasuk Dana Talangan)' :
                           statusFilter === 'REPORTING' && activeRole === Role.ADMIN ? 'Review Finansial' :
                           getStatusLabel(statusFilter as RequestStatus) || statusFilter}
                        </span>
                      </h3>
                    </div>

                    {/* Filtering & Search Bar */}
                    <div className="space-y-2">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Cari UID, lokasi, keterangan..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 focus:bg-white focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                        />
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      </div>

                      {/* Action buttons moved here for USER role */}
                      {activeRole === Role.USER && (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => {
                              if (!userProfile?.managerEmail) {
                                alert('Email Manager Anda belum dikonfigurasi oleh Admin. Silakan hubungi Admin Anda.');
                              } else {
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
                              if (!userProfile?.managerEmail) {
                                alert('Email Manager Anda belum dikonfigurasi oleh Admin. Silakan hubungi Admin Anda.');
                              } else {
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
                    {filteredRequests.length === 0 ? (
                      <div className="bg-slate-50 border border-slate-150 rounded-2xl py-12 px-4 text-center text-slate-400 text-xs font-medium">
                        <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-2.5" />
                        <p>Tidak ditemukan pengajuan dana.</p>
                        <p className="text-[10px] text-slate-400 mt-1">Sesuaikan filter status atau cari kata kunci lain.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredRequests.map((req) => {
                          const reqItems = usageItems.filter(i => i.requestId === req.id);
                          const isFullyApprovedByAdmin = reqItems.length > 0 && reqItems.every(i => i.statusAdmin === ItemStatus.APPROVED);
                          const isReqTalangan = req.id.startsWith('OPT-') || req.keterangan.startsWith('[DANA TALANGAN]');

                          const ditransferAmount = [
                            RequestStatus.PENDING_APPROVAL,
                            RequestStatus.APPROVED,
                            RequestStatus.PARTIALLY_APPROVED,
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
                              <div className="flex items-start justify-between">
                                <div>
                                  <span className="text-[9px] font-mono text-slate-400 block">{req.id}</span>
                                  <h4 className="text-xs font-bold text-slate-800 mt-0.5">{req.keterangan}</h4>
                                  <p className="text-[10px] text-slate-500 font-medium flex items-center gap-1.5 mt-0.5 flex-wrap">
                                    <span>Site: <strong>{req.siteId}</strong></span>
                                    <span>•</span>
                                    <span>Tgl Penggunaan: <strong className="text-indigo-600">{req.tanggalPemakaian}</strong></span>
                                    <span>•</span>
                                    <span>Pemohon: <strong>{requesterName}</strong></span>
                                  </p>
                                </div>
                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${getStatusBadgeStyles(req.status)}`}>
                                  {getStatusLabel(req.status)}
                                </span>
                              </div>

                              {/* Middle info with budget values */}
                              <div className="bg-slate-50 p-2.5 rounded-xl text-[10px] text-slate-500 grid grid-cols-3 gap-2 border border-slate-100">
                                <div>
                                  <span className="block text-[8px] font-bold text-slate-400 uppercase">Diajukan</span>
                                  <span className="font-semibold text-slate-700">
                                    {isReqTalangan ? 'Rp 0' : formatIDR(req.jumlahPengajuan)}
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-[8px] font-bold text-slate-400 uppercase">Disetujui Mgr</span>
                                  <span className="font-semibold text-emerald-600">
                                    {req.status === RequestStatus.PENDING_APPROVAL || req.status === RequestStatus.REJECTED
                                      ? '-'
                                      : formatIDR(req.managerActionAmount)}
                                  </span>
                                </div>
                                <div>
                                  <span className="block text-[8px] font-bold text-slate-400 uppercase">Ditransfer</span>
                                  <span className="font-semibold text-indigo-600">
                                    {[RequestStatus.PENDING_APPROVAL, RequestStatus.APPROVED, RequestStatus.PARTIALLY_APPROVED, RequestStatus.REJECTED].includes(req.status)
                                      ? '-'
                                      : formatIDR(req.adminActionAmount)}
                                  </span>
                                </div>
                              </div>

                              {/* Saldo UID Info Box */}
                              {!(activeRole === Role.MANAGER && req.status === RequestStatus.PENDING_APPROVAL) && (
                                <div className="flex items-center justify-between bg-slate-50/50 border border-slate-100/80 px-3 py-2 rounded-xl text-[10px]">
                                  <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                                    <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                                      saldoUID > 0 ? 'bg-blue-500' : saldoUID < 0 ? 'bg-rose-500' : 'bg-emerald-500'
                                    }`}></div>
                                    <span>{saldoUID > 0 ? 'Saldo (lebih):' : saldoUID < 0 ? 'Saldo (kurang):' : 'Saldo:'}</span>
                                  </div>
                                  <span className={`font-bold font-display ${
                                    saldoUID > 0 ? 'text-blue-600' : saldoUID < 0 ? 'text-rose-600' : 'text-emerald-600'
                                  }`}>
                                    {formatIDR(saldoUID)}
                                  </span>
                                </div>
                              )}

                              {req.buktiTransferUrl && (
                                <div className="flex items-center gap-1.5 text-[10px] text-indigo-600 bg-indigo-50/40 p-2 rounded-xl border border-indigo-50/50">
                                  <Paperclip className="w-3.5 h-3.5 shrink-0" />
                                  <span className="font-semibold text-slate-500">Bukti Transfer:</span>
                                  <button 
                                    type="button"
                                    onClick={() => setPreviewDocument({
                                      url: req.buktiTransferUrl!,
                                      fileId: req.buktiTransferFileId || undefined,
                                      title: `Bukti Transfer (UID: ${req.id})`
                                    })}
                                    className="font-bold hover:underline cursor-pointer text-indigo-600 text-left"
                                  >
                                    Lihat Dokumen / Foto
                                  </button>
                                </div>
                              )}

                              {/* Comments if any */}
                              {req.status === RequestStatus.REJECTED && req.managerComment && (
                                <div className="bg-red-50 text-red-700 p-2.5 rounded-xl text-[10px] border border-red-100">
                                  <strong>Alasan Ditolak:</strong> {req.managerComment}
                                </div>
                              )}

                              {/* Action buttons on card based on role & status */}
                              <div className="flex items-center justify-between pt-2 border-t border-slate-50 text-xs">
                                <span className="text-[9px] font-mono text-slate-400">
                                  {req.createdAt ? `Dibuat: ${req.createdAt}` : ''}
                                </span>

                                <div className="flex items-center gap-1.5">
                                  {/* USER ACTIONS */}
                                  {activeRole === Role.USER && (
                                    <>
                                      {[RequestStatus.TRANSFERRED, RequestStatus.REPORTING, RequestStatus.REVIEW_MANAGER, RequestStatus.REVIEW_ADMIN].includes(req.status) && (
                                        <button
                                          onClick={() => {
                                            setSelectedRequest(req);
                                            setActiveView('report-usage');
                                          }}
                                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-xl transition-all"
                                        >
                                          Laporkan Penggunaan
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
                                    </>
                                  )}

                                  {/* MANAGER ACTIONS */}
                                  {activeRole === Role.MANAGER && (
                                    <>
                                      {req.status === RequestStatus.PENDING_APPROVAL && (
                                        <button
                                          onClick={() => setReviewBudgetReq(req)}
                                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-sm"
                                        >
                                          Tinjau Anggaran
                                        </button>
                                      )}

                                      {req.status === RequestStatus.REVIEW_MANAGER && (
                                        <button
                                          onClick={() => setReviewReportReq(req)}
                                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-xl transition-all"
                                        >
                                          Review Item Laporan
                                        </button>
                                      )}

                                      {req.status !== RequestStatus.PENDING_APPROVAL && req.status !== RequestStatus.REVIEW_MANAGER && (
                                        <button
                                          onClick={() => {
                                            setSelectedRequest(req);
                                            setActiveView('report-usage');
                                          }}
                                          className="px-3 py-1.5 border border-slate-150 hover:bg-slate-50 text-slate-600 font-bold rounded-xl transition-all"
                                        >
                                          Rincian Laporan
                                        </button>
                                      )}
                                    </>
                                  )}

                                  {/* ADMIN ACTIONS */}
                                  {activeRole === Role.ADMIN && (
                                    <>
                                      {(req.status === RequestStatus.APPROVED || req.status === RequestStatus.PARTIALLY_APPROVED) && (
                                        <button
                                          onClick={() => setTransferReq(req)}
                                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow-sm"
                                        >
                                          Proses Transfer
                                        </button>
                                      )}

                                      {(req.status === RequestStatus.REVIEW_ADMIN || req.status === RequestStatus.REPORTING) && (
                                        <div className="flex gap-1.5">
                                          <button
                                            onClick={() => setReviewReportReq(req)}
                                            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-xl transition-all"
                                          >
                                            Tinjau Item Laporan
                                          </button>

                                          {isFullyApprovedByAdmin && (
                                            <button
                                              onClick={() => setClosingConfirmReq(req)}
                                              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-850 text-white font-bold rounded-xl transition-all shadow-sm"
                                            >
                                              Closing
                                            </button>
                                          )}
                                        </div>
                                      )}

                                      {req.status !== RequestStatus.APPROVED && req.status !== RequestStatus.PARTIALLY_APPROVED && req.status !== RequestStatus.REVIEW_ADMIN && req.status !== RequestStatus.REPORTING && (
                                        <button
                                          onClick={() => {
                                            setSelectedRequest(req);
                                            setActiveView('report-usage');
                                          }}
                                          className="px-3 py-1.5 border border-slate-150 hover:bg-slate-50 text-slate-600 font-bold rounded-xl transition-all"
                                        >
                                          Rincian Laporan
                                        </button>
                                      )}
                                    </>
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
      {previewDocument && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-xs z-[100] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl p-5 space-y-4 animate-scale-up relative border border-slate-100 flex flex-col max-h-[90vh]">
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
            <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden flex items-center justify-center min-h-[350px] relative p-1.5">
              {previewDocument.fileId ? (
                <img
                  src={`https://drive.google.com/thumbnail?sz=w1000&id=${previewDocument.fileId}`}
                  alt="Pratinjau Dokumen"
                  className="max-w-full max-h-[55vh] rounded-xl object-contain shadow-sm"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = document.getElementById('app-preview-fallback');
                    if (fallback) fallback.classList.remove('hidden');
                  }}
                />
              ) : previewDocument.url ? (
                <img
                  src={previewDocument.url}
                  alt="Pratinjau Dokumen"
                  className="max-w-full max-h-[55vh] rounded-xl object-contain shadow-sm"
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
        </div>
      )}
    </div>
  );
}
