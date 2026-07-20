/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout } from './lib/firebase';
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
  fetchSites,
  fetchUserActivities,
  createUserActivity
} from './lib/googleApi';
import { BudgetRequest, UsageReportItem, UserProfile, Role, RequestStatus, ItemStatus, SiteInfo, UserActivity } from './types';

// Components
import { Header } from './components/Header';
import { ProfileSetup } from './components/ProfileSetup';
import { ProfileSettings } from './components/ProfileSettings';
import { DashboardStats } from './components/DashboardStats';
import { BudgetRequestForm } from './components/BudgetRequestForm';
import { UsageReportForm } from './components/UsageReportForm';
import { ReviewBudgetModal } from './components/ReviewBudgetModal';
import { TransferModal } from './components/TransferModal';
import { ReviewReportModal } from './components/ReviewReportModal';
import { AppLoginForm } from './components/AppLoginForm';
import { AdjustmentPanel } from './components/AdjustmentPanel';
import { ActivityLogView } from './components/ActivityLogView';

// Icons
import {
  Coins, ClipboardList, CheckCircle2, AlertCircle, Clock, Plus, LogIn,
  RefreshCw, FileSpreadsheet, Eye, Search, AlertTriangle, Check, CreditCard,
  Briefcase, MessageSquare, ExternalLink, CheckSquare, XCircle, ArrowRight,
  Database, ArrowLeft, ArrowRightLeft, Paperclip, Filter
} from 'lucide-react';

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const isInvalidGoogleAccount = !!(user && user.email && user.email.toLowerCase() !== 'ops.depotel@gmail.com');

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
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Simulation Role Override
  const [activeRole, setActiveRole] = useState<Role>(Role.USER);

  // Navigation / Views
  const [activeView, setActiveView] = useState<'dashboard' | 'new-request' | 'report-usage' | 'setup-profile' | 'adjustment' | 'profile-settings' | 'activities'>('dashboard');
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
  const [expandedReportReqIds, setExpandedReportReqIds] = useState<Record<string, boolean>>({});

  // Closed requests filter states
  const [closedUserFilter, setClosedUserFilter] = useState<string>('ALL');
  const [closedDivisiFilter, setClosedDivisiFilter] = useState<string>('ALL');
  const [closedStartDateFilter, setClosedStartDateFilter] = useState<string>('');
  const [closedEndDateFilter, setClosedEndDateFilter] = useState<string>('');

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

    // Strict validation: Ensure connected Google account is ops.depotel@gmail.com
    const emailLower = user.email?.toLowerCase();
    const isValidEmail = emailLower === 'ops.depotel@gmail.com';
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
      const [allReqs, allItems, allProfs, allSites, allActs] = await Promise.all([
        fetchBudgetRequests(accessToken, sheetId),
        fetchUsageItems(accessToken, sheetId),
        fetchProfiles(accessToken, sheetId),
        fetchSites(accessToken, sheetId),
        fetchUserActivities(accessToken, sheetId)
      ]);

      setRequests(allReqs.sort((a, b) => b.id.localeCompare(a.id))); // Newest first
      setUsageItems(allItems);
      setProfiles(allProfs);
      setSites(allSites);
      setActivities(allActs);
      localStorage.setItem('op_app_cached_sites', JSON.stringify(allSites));
      localStorage.setItem('op_app_cached_activities', JSON.stringify(allActs));

      // If the user is already logged in, keep their active session and update with the latest data
      const savedUserId = sessionStorage.getItem('op_app_logged_in_user_id');
      const activeUserProf = userProfile || (savedUserId ? allProfs.find(p => p.userId?.toLowerCase() === savedUserId.toLowerCase()) : null);
      if (activeUserProf) {
        const updatedProfile = allProfs.find(
          p => p.userId?.toLowerCase() === activeUserProf.userId?.toLowerCase()
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
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err: any) {
      console.error('Login error details:', err);
      setError('Error menghubungkan dengan Google');
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
        } else {
          throw new Error('Gagal mendapatkan token akses Google.');
        }
      } catch (err: any) {
        console.error('Auto Google auth error:', err);
        setIsLoading(false);
        setLoadingStep('');
        onFormError('Gagal menghubungkan ke Google Account. Pastikan Anda masuk menggunakan email ops.depotel@gmail.com.');
        return;
      }
    }

    // 2. Validate credentials against Google Sheets
    setIsLoading(true);
    setLoadingStep('Memverifikasi kredensial login...');
    try {
      const sheetId = spreadsheetId || await findOrCreateDatabase(currentToken!);
      setSpreadsheetId(sheetId);
      
      const folderId = driveFolderId || await findOrCreateFolder(currentToken!);
      setDriveFolderId(folderId);

      const allProfs = await fetchProfiles(currentToken!, sheetId);
      setProfiles(allProfs);
      localStorage.setItem('op_app_cached_profiles', JSON.stringify(allProfs));

      const matched = allProfs.find(
        (p) =>
          p.userId?.toLowerCase() === userId.trim().toLowerCase() &&
          p.password === password
      );

      if (matched) {
        await syncAllData(currentToken!, sheetId);
        handleAppLoginSuccess(matched);
      } else {
        onFormError('User ID atau Password salah. Silakan coba lagi.');
      }
    } catch (err: any) {
      console.error('Login validation error:', err);
      // Fallback to cache if offline / Sheet request fails
      const matched = profiles.find(
        (p) =>
          p.userId?.toLowerCase() === userId.trim().toLowerCase() &&
          p.password === password
      );
      if (matched) {
        handleAppLoginSuccess(matched);
      } else {
        onFormError(err.message || 'Gagal memproses verifikasi login.');
      }
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
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
          managerComment: 'Disetujui otomatis oleh Admin',
          adminActionAmount: amount,
          createdAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
          buktiTransferUrl: finalBuktiUrl || undefined,
          buktiTransferFileId: finalBuktiFileId || undefined
        };

        await createBudgetRequest(token, spreadsheetId, newRequest);
      },
      'Gagal membuat transaksi Adjustment.'
    );

    if (success !== null) {
      setActiveView('dashboard');
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

    const isReqTalangan = transferReq.id.startsWith('OPT-') || transferReq.keterangan.startsWith('[DANA TALANGAN]');
    const isPendingTalanganTransfer = transferReq.status === RequestStatus.PENDING_TALANGAN_TRANSFER;

    const updated: BudgetRequest = {
      ...transferReq,
      status: (isReqTalangan && isPendingTalanganTransfer) ? RequestStatus.CLOSED : RequestStatus.TRANSFERRED,
      adminActionAmount: transferredAmount,
      buktiTransferUrl: buktiUrl,
      buktiTransferFileId: buktiFileId
    };

    const success = await runGoogleAction(
      () => updateBudgetRequest(token, spreadsheetId, updated),
      (isReqTalangan && isPendingTalanganTransfer) ? 'Gagal memproses transfer dana talangan.' : 'Gagal memproses transfer anggaran.'
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

  const handleSaveActivity = async (
    activityData: {
      tanggal: string;
      siteId: string;
      siteName: string;
      coordinatesDb: string;
      coordinatesActual: string;
      keterangan: string;
    },
    photoFile?: File
  ) => {
    if (!token || !spreadsheetId) {
      throw new Error('Koneksi database tidak aktif. Hubungkan Google Account Anda.');
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
      buktiFileId: finalBuktiFileId || undefined
    };

    await createUserActivity(token, spreadsheetId, newActivity);

    // Refresh activities state
    const allActs = await fetchUserActivities(token, spreadsheetId);
    setActivities(allActs);
    localStorage.setItem('op_app_cached_activities', JSON.stringify(allActs));
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
        if (r.status !== RequestStatus.APPROVED && 
            r.status !== RequestStatus.PARTIALLY_APPROVED && 
            r.status !== RequestStatus.PENDING_TALANGAN_TRANSFER) return false;
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
          const reqItems = usageItems.filter(i => i.requestId === r.id);
          if (reqItems.length > 0 && reqItems.every(i => i.statusManager === ItemStatus.APPROVED)) {
            return false;
          }
        } else if (activeRole === Role.ADMIN) {
          if (r.status !== RequestStatus.REVIEW_ADMIN && r.status !== RequestStatus.REPORTING) return false;
        } else {
          if (r.status !== RequestStatus.REPORTING && r.status !== RequestStatus.REVIEW_MANAGER && r.status !== RequestStatus.REVIEW_ADMIN) return false;
        }
      } else if (statusFilter === 'CLOSED') {
        if (r.status !== RequestStatus.CLOSED) return false;

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
      case RequestStatus.PENDING_TALANGAN_TRANSFER:
        return 'bg-pink-50 text-pink-600 border border-pink-150 animate-pulse';
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
      case RequestStatus.PENDING_TALANGAN_TRANSFER:
        return 'border-l-pink-500';
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
      case RequestStatus.PENDING_TALANGAN_TRANSFER: return 'Menunggu Transfer Dana Talangan';
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
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto shadow-md border border-indigo-100">
            <Database className="w-8 h-8 text-indigo-600 animate-pulse" />
          </div>

          <div className="space-y-2">
            <h1 className="font-display font-black text-slate-800 text-base tracking-tight">
              Sistem Manajemen Operasional
            </h1>
            <p className="text-xs text-slate-400 font-medium">
              Hubungkan Google Account Anda untuk memuat database
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 text-xs text-left space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-amber-800 text-xs">Hubungkan Akun Google</h3>
                <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                  Aplikasi ini disinkronkan secara online dengan Google Sheets &amp; Drive operasional pusat.
                </p>
                <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                  Semua user wajib menghubungkan Google Account resmi:
                </p>
                <p className="font-bold font-mono text-[11px] bg-amber-100/50 p-1.5 rounded border border-amber-200 text-amber-900 mt-1.5 text-center">
                  ops.depotel@gmail.com
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
          onOpenSettings={() => setActiveView('profile-settings')}
          activeView={activeView}
        />
      )}

      {/* Main Container */}
      <main className="flex-1 p-4 max-w-md mx-auto w-full space-y-4">
        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-150 text-red-700 rounded-2xl p-4 text-xs flex flex-col gap-3 animate-slide-up">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5 text-red-500" />
              <div>
                <p className="font-bold text-red-800">Terjadi Kesalahan</p>
                <p className="text-[11px] text-red-650 mt-0.5">{error}</p>
              </div>
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
          />
        ) : activeView === 'setup-profile' ? (
          <ProfileSetup
            profiles={profiles}
            requests={requests}
            onSave={handleSaveProfile}
            onClose={() => setActiveView('dashboard')}
          />
        ) : activeView === 'profile-settings' && userProfile ? (
          <ProfileSettings
            userProfile={userProfile}
            onUpdatePassword={handleUpdatePassword}
            onClose={() => setActiveView('dashboard')}
            theme={theme}
            onThemeChange={setTheme}
          />
        ) : activeView === 'new-request' && userProfile ? (
          <BudgetRequestForm
            userEmail={userProfile.email}
            managerEmail={userProfile.managerEmail}
            defaultSiteId=""
            onSubmit={handleAddBudgetRequest}
            onClose={() => setActiveView('dashboard')}
            initialIsTalangan={initialIsTalangan}
            sites={sites}
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
            sites={sites}
            activities={activities}
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
        ) : activeView === 'activities' && userProfile ? (
          <ActivityLogView
            activities={activities}
            sites={sites}
            userEmail={userProfile.email}
            onSaveActivity={handleSaveActivity}
            onBack={() => setActiveView('dashboard')}
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
                  onOpenAdjustment={() => setActiveView('adjustment')}
                  profiles={profiles}
                  activities={activities}
                  onOpenActivities={() => setActiveView('activities')}
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
                    activities={activities}
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
                    approvedUsageAmount={
                      usageItems
                        .filter(item => item.requestId === transferReq.id && item.statusAdmin === ItemStatus.APPROVED)
                        .reduce((sum, item) => sum + item.nominal, 0)
                    }
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
                           statusFilter === 'CLOSED' ? 'Arsip / UID Selesai (Closed)' :
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

                      {statusFilter === 'CLOSED' && activeRole === Role.ADMIN && (
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
                                      .filter(r => r.status === RequestStatus.CLOSED)
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
                                      .filter(r => r.status === RequestStatus.CLOSED)
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
                            RequestStatus.PENDING_TALANGAN_TRANSFER,
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
                                    {[
                                      RequestStatus.PENDING_APPROVAL, 
                                      RequestStatus.APPROVED, 
                                      RequestStatus.PARTIALLY_APPROVED, 
                                      RequestStatus.PENDING_TALANGAN_TRANSFER,
                                      RequestStatus.REJECTED
                                    ].includes(req.status)
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

                              {/* Expanded Report Items List for Menunggu Transfer Dana Talangan */}
                              {req.status === RequestStatus.PENDING_TALANGAN_TRANSFER && expandedReportReqIds[req.id] && (
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
                                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                                      {reqItems.map((item, idx) => (
                                        <div key={item.id} className="bg-white border border-slate-100 rounded-xl p-3 space-y-1.5 shadow-sm">
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
                                                <span>Bukti</span>
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
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
                                      {(req.status === RequestStatus.APPROVED || 
                                         req.status === RequestStatus.PARTIALLY_APPROVED ||
                                         req.status === RequestStatus.PENDING_TALANGAN_TRANSFER) && (
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
