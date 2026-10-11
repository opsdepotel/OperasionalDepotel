import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  HardDriveDownload,
  CheckCircle2,
  AlertCircle,
  FolderSync,
  Play,
  Pause,
  RefreshCw,
  FolderArchive,
  ShieldCheck,
  FileImage,
  ArrowRight,
  X,
  Loader2,
  Database,
  Trash2,
  FolderCheck,
  Layers,
  ExternalLink,
  LogIn,
  Eye,
  Copy,
  Check,
  Download,
  Search,
  Filter
} from 'lucide-react';
import { useBackHandler } from '../hooks/useBackHandler';
import {
  scanPhotoMigration,
  copyDriveFileInBrowser,
  commitMigratedBatchToDatabase,
  archiveOrphanedPhotos,
  ensureDepotelArchiveFolder,
  verifyOwnershipAudit,
  OwnershipAuditResult,
  MigrationScanResult,
  OrphanedPhotoItem,
  UnmigratedDbPhotoItem,
  MASTER_DRIVE_FOLDER_ID,
  MASTER_ARCHIVE_FOLDER_NAME,
  verifyTokenAccountEmail
} from '../lib/photoMigration';
import { googleSignIn } from '../lib/firebase';

interface AdminPhotoMigrationCardProps {
  token?: string | null;
  adminEmail?: string;
}

const STORAGE_KEY_MIGRATION_PROGRESS = 'op_app_photo_migration_progress_v2';

export const AdminPhotoMigrationCard: React.FC<AdminPhotoMigrationCardProps> = ({
  token,
  adminEmail = 'depotel@vgd4.my.id'
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  useBackHandler(isModalOpen, () => {
    if (!isRunning && !isArchivingOrphans) setIsModalOpen(false);
  }, 'adminPhotoMigrationModal');

  // Archive folder state (owned by depotel@vgd4.my.id)
  const [depotelArchiveFolder, setDepotelArchiveFolder] = useState<{ id: string; name: string; webViewLink: string } | null>(null);

  // Scan state
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<MigrationScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Ensure archive folder under depotel@vgd4.my.id when token is available
  useEffect(() => {
    if (token && token !== 'mock_demo_token') {
      ensureDepotelArchiveFolder(token)
        .then((folder) => {
          setDepotelArchiveFolder(folder);
        })
        .catch((err) => {
          console.warn('Could not auto-ensure depotel archive folder:', err);
        });
    }
  }, [token]);

  // Migration process state (Active DB files)
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [batchSize, setBatchSize] = useState<number>(10);

  // Progress counters
  const [totalDbFiles, setTotalDbFiles] = useState<number>(0);
  const [processedDbFiles, setProcessedDbFiles] = useState<number>(0);
  const [remainingDbQueue, setRemainingDbQueue] = useState<string[]>([]);
  const [migratedCount, setMigratedCount] = useState<number>(0);
  const [failedCount, setFailedCount] = useState<number>(0);
  const [updatedCellsCount, setUpdatedCellsCount] = useState<number>(0);

  // Orphaned files state
  const [orphanedQueue, setOrphanedQueue] = useState<string[]>([]);
  const [isArchivingOrphans, setIsArchivingOrphans] = useState(false);
  const [archivedOrphanCount, setArchivedOrphanCount] = useState<number>(0);

  // Verification audit state
  const [isVerifying, setIsVerifying] = useState(false);
  const [auditResult, setAuditResult] = useState<OwnershipAuditResult | null>(null);

  // Detail Inspector Modal State
  const [detailModalTab, setDetailModalTab] = useState<'orphaned' | 'unmigrated' | null>(null);
  const [detailSearchQuery, setDetailSearchQuery] = useState('');
  const [detailSheetFilter, setDetailSheetFilter] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isCopiedAll, setIsCopiedAll] = useState(false);

  useBackHandler(detailModalTab !== null, () => {
    setDetailModalTab(null);
  }, 'adminPhotoMigrationDetailModal');

  // Activity logs
  const [logs, setLogs] = useState<Array<{ id: string; time: string; text: string; type: 'info' | 'success' | 'warn' | 'error' }>>([]);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Control ref to handle pause/stop without stale state
  const shouldContinueRef = useRef(false);

  // Active token ref with auto-renew support
  const activeTokenRef = useRef<string>(token || '');
  const [tokenAccountEmail, setTokenAccountEmail] = useState<string | null>(null);
  const [isTokenDepotel, setIsTokenDepotel] = useState<boolean | null>(null);
  const [isConnectingAccount, setIsConnectingAccount] = useState<boolean>(false);

  const checkTokenIdentity = async (tok?: string) => {
    const candidate = tok || activeTokenRef.current || localStorage.getItem('g_user_oauth_token') || localStorage.getItem('g_access_token');
    if (!candidate || candidate === 'mock_demo_token') {
      setIsTokenDepotel(false);
      setTokenAccountEmail(null);
      return;
    }
    const info = await verifyTokenAccountEmail(candidate);
    if (info) {
      setTokenAccountEmail(info.email);
      setIsTokenDepotel(info.isDepotel);
      if (info.isDepotel) {
        activeTokenRef.current = candidate;
      }
    } else {
      setIsTokenDepotel(false);
      setTokenAccountEmail(null);
    }
  };

  useEffect(() => {
    const tok = token || localStorage.getItem('g_user_oauth_token') || localStorage.getItem('g_access_token') || '';
    if (tok) {
      activeTokenRef.current = tok;
      checkTokenIdentity(tok);
    }
  }, [token]);

  useEffect(() => {
    const handleGoogleTokenUpdated = (e: any) => {
      const newToken = e.detail?.token;
      if (newToken) {
        activeTokenRef.current = newToken;
        checkTokenIdentity(newToken);
      }
    };
    window.addEventListener('google_user_token_updated', handleGoogleTokenUpdated);
    return () => {
      window.removeEventListener('google_user_token_updated', handleGoogleTokenUpdated);
    };
  }, []);

  const handleConnectDepotelAccount = async () => {
    setIsConnectingAccount(true);
    addLog('Membuka dialog Login Google. Silakan pilih akun depotel@vgd4.my.id...', 'info');
    try {
      const res = await googleSignIn();
      if (res && res.accessToken) {
        activeTokenRef.current = res.accessToken;
        const email = String(res.user?.email || '').trim().toLowerCase();
        setTokenAccountEmail(email);
        const isDep = email === 'depotel@vgd4.my.id';
        setIsTokenDepotel(isDep);
        if (isDep) {
          addLog(`Berhasil terhubung ke akun sah: ${email}! Siap menduplikasi foto.`, 'success');
        } else {
          addLog(`Peringatan: Akun yang dipilih (${email}) bukan 'depotel@vgd4.my.id'.`, 'warn');
        }
      }
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        addLog(`Gagal login Google: ${err?.message || err}`, 'error');
      }
    } finally {
      setIsConnectingAccount(false);
    }
  };

  // Add log helper
  const addLog = (text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    setLogs(prev => [...prev.slice(-300), { id: `${Date.now()}-${Math.random()}`, time, text, type }]);
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Load saved progress from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MIGRATION_PROGRESS);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.totalDbFiles) setTotalDbFiles(saved.totalDbFiles);
        if (saved.processedDbFiles) setProcessedDbFiles(saved.processedDbFiles);
        if (saved.migratedCount) setMigratedCount(saved.migratedCount);
        if (saved.failedCount) setFailedCount(saved.failedCount);
        if (saved.updatedCellsCount) setUpdatedCellsCount(saved.updatedCellsCount);
        if (Array.isArray(saved.remainingDbQueue)) setRemainingDbQueue(saved.remainingDbQueue);
        if (Array.isArray(saved.orphanedQueue)) setOrphanedQueue(saved.orphanedQueue);
        if (saved.archivedOrphanCount) setArchivedOrphanCount(saved.archivedOrphanCount);
      }
    } catch {}
  }, []);

  // Save progress helper
  const saveProgress = (
    processed: number,
    migrated: number,
    failed: number,
    cells: number,
    remaining: string[],
    orphans: string[],
    archivedOrphans: number
  ) => {
    try {
      localStorage.setItem(
        STORAGE_KEY_MIGRATION_PROGRESS,
        JSON.stringify({
          totalDbFiles,
          processedDbFiles: processed,
          migratedCount: migrated,
          failedCount: failed,
          updatedCellsCount: cells,
          remainingDbQueue: remaining,
          orphanedQueue: orphans,
          archivedOrphanCount: archivedOrphans,
          lastUpdated: new Date().toISOString()
        })
      );
    } catch {}
  };

  // Formatters & helpers for detailed inspection
  const formatFileSize = (bytesStr?: string) => {
    if (!bytesStr) return '-';
    const bytes = Number(bytesStr);
    if (isNaN(bytes) || bytes <= 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const activeOrphanedList: OrphanedPhotoItem[] =
    auditResult?.orphanedList && auditResult.orphanedList.length > 0
      ? auditResult.orphanedList
      : scanResult?.orphanedList && scanResult.orphanedList.length > 0
      ? scanResult.orphanedList
      : orphanedQueue.map((id) => ({
          id,
          name: `foto_${id}.jpg`,
          ownerEmail: 'Bukan depotel@vgd4.my.id',
          webViewLink: `https://drive.google.com/file/d/${id}/view`
        }));

  const activeUnmigratedList: UnmigratedDbPhotoItem[] =
    auditResult?.unmigratedDbList && auditResult.unmigratedDbList.length > 0
      ? auditResult.unmigratedDbList
      : scanResult?.unmigratedDbList && scanResult.unmigratedDbList.length > 0
      ? scanResult.unmigratedDbList
      : remainingDbQueue.map((id) => ({
          id,
          name: `foto_${id}.jpg`,
          ownerEmail: 'Bukan depotel@vgd4.my.id',
          webViewLink: `https://drive.google.com/file/d/${id}/view`,
          sheets: ['Database']
        }));

  const filteredOrphaned = activeOrphanedList.filter((item) => {
    if (!detailSearchQuery.trim()) return true;
    const q = detailSearchQuery.toLowerCase();
    return (
      item.id.toLowerCase().includes(q) ||
      (item.name && item.name.toLowerCase().includes(q)) ||
      (item.ownerEmail && item.ownerEmail.toLowerCase().includes(q)) ||
      (item.ownerName && item.ownerName.toLowerCase().includes(q))
    );
  });

  const filteredUnmigrated = activeUnmigratedList.filter((item) => {
    if (detailSheetFilter !== 'ALL') {
      const matchSheet = item.sheets?.some((s) => s.toLowerCase() === detailSheetFilter.toLowerCase());
      if (!matchSheet) return false;
    }
    if (!detailSearchQuery.trim()) return true;
    const q = detailSearchQuery.toLowerCase();
    return (
      item.id.toLowerCase().includes(q) ||
      (item.name && item.name.toLowerCase().includes(q)) ||
      (item.ownerEmail && item.ownerEmail.toLowerCase().includes(q)) ||
      (item.ownerName && item.ownerName.toLowerCase().includes(q)) ||
      item.sheets?.some((s) => s.toLowerCase().includes(q))
    );
  });

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAllIds = (items: Array<{ id: string }>) => {
    const text = items.map((i) => i.id).join('\n');
    navigator.clipboard.writeText(text);
    setIsCopiedAll(true);
    setTimeout(() => setIsCopiedAll(false), 2000);
  };

  const handleDownloadCsv = (
    tab: 'orphaned' | 'unmigrated',
    items: Array<OrphanedPhotoItem | UnmigratedDbPhotoItem>
  ) => {
    let csvHeader = '';
    let rows: string[] = [];

    if (tab === 'orphaned') {
      csvHeader = 'No,ID File,Nama File,Pemilik (Email),Nama Pemilik,Ukuran,Tanggal Dibuat,Link Google Drive';
      rows = (items as OrphanedPhotoItem[]).map((item, idx) => {
        const safeName = `"${(item.name || '').replace(/"/g, '""')}"`;
        const safeOwner = `"${(item.ownerEmail || '').replace(/"/g, '""')}"`;
        const safeOwnerName = `"${(item.ownerName || '').replace(/"/g, '""')}"`;
        const safeSize = `"${formatFileSize(item.size)}"`;
        const safeDate = `"${formatDate(item.createdTime)}"`;
        const safeLink = `"${item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`}"`;
        return `${idx + 1},${item.id},${safeName},${safeOwner},${safeOwnerName},${safeSize},${safeDate},${safeLink}`;
      });
    } else {
      csvHeader = 'No,ID File,Nama File,Sheet Terkait,Pemilik (Email),Nama Pemilik,Ukuran,Tanggal Dibuat,Link Google Drive';
      rows = (items as UnmigratedDbPhotoItem[]).map((item, idx) => {
        const safeName = `"${(item.name || '').replace(/"/g, '""')}"`;
        const safeSheets = `"${(item.sheets || []).join('; ')}"`;
        const safeOwner = `"${(item.ownerEmail || '').replace(/"/g, '""')}"`;
        const safeOwnerName = `"${(item.ownerName || '').replace(/"/g, '""')}"`;
        const safeSize = `"${formatFileSize(item.size)}"`;
        const safeDate = `"${formatDate(item.createdTime)}"`;
        const safeLink = `"${item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`}"`;
        return `${idx + 1},${item.id},${safeName},${safeSheets},${safeOwner},${safeOwnerName},${safeSize},${safeDate},${safeLink}`;
      });
    }

    const csvContent = [csvHeader, ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.download = `Audit_${tab === 'orphaned' ? 'Foto_Yatim_Drive' : 'Foto_Belum_Beralih'}_${dateStamp}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 1. Scan Handler
  const handleScan = async () => {
    setIsScanning(true);
    setScanError(null);
    addLog('Memulai pemindaian audit Google Drive & Google Sheets...', 'info');

    try {
      const res = await scanPhotoMigration(token);
      setScanResult(res);
      setTotalDbFiles(res.totalDbFiles);
      setRemainingDbQueue(res.dbFileIds);
      setOrphanedQueue(res.orphanedFileIds || []);
      const alreadyDone = res.migratedDbFilesCount ?? Math.max(0, res.totalDbFiles - res.dbFileIds.length);
      setProcessedDbFiles(alreadyDone);
      setMigratedCount(alreadyDone);
      setFailedCount(0);
      setUpdatedCellsCount(0);
      setArchivedOrphanCount(0);

      addLog(`Pemindaian kepemilikan Google Drive & Sheets selesai:`, 'success');
      addLog(`• Total foto terdaftar di database: ${res.totalDbFiles.toLocaleString()} file`, 'info');
      addLog(`• Foto sudah berpemilik depotel@vgd4.my.id: ${alreadyDone.toLocaleString()} file (${Math.round((alreadyDone / (res.totalDbFiles || 1)) * 100)}%)`, 'success');
      if (res.dbFileIds.length > 0) {
        addLog(`• Foto di database belum milik depotel (antrean duplikasi): ${res.dbFileIds.length.toLocaleString()} file`, 'warn');
      } else {
        addLog(`• Seluruh link foto di database (100%) sudah sah milik depotel@vgd4.my.id!`, 'success');
      }
      addLog(`• Foto yatim lama di Drive (bukan milik depotel & siap backup): ${(res.orphanedFileIds || []).length.toLocaleString()} file`, 'warn');

      saveProgress(alreadyDone, alreadyDone, 0, 0, res.dbFileIds, res.orphanedFileIds || [], 0);
    } catch (err: any) {
      const msg = err.message || 'Gagal memindai database foto.';
      setScanError(msg);
      addLog(`Gagal memindai: ${msg}`, 'error');
    } finally {
      setIsScanning(false);
    }
  };

  // 1b. Verify Ownership Audit Handler (100% Comprehensive Inspection)
  const handleVerifyOwnership = async () => {
    setIsVerifying(true);
    addLog('Menjalankan audit verifikasi kepemilikan 100% seluruh link Google Sheets & Drive...', 'info');
    try {
      const res = await verifyOwnershipAudit();
      setAuditResult(res);
      const db = res.database;
      addLog(`Hasil Verifikasi Total Database: ${db.percentage}% file unik (${db.verifiedFilesCount.toLocaleString()} dari ${db.totalUniqueFiles.toLocaleString()}) sudah sah merujuk ke file kepemilikan depotel@vgd4.my.id!`, 'success');
      if (db.unmigratedFilesCount > 0) {
        addLog(`• Sisa belum beralih: ${db.unmigratedFilesCount} file unik (${db.sheetBreakdown.Pengajuan.unmigrated} di Pengajuan, ${db.sheetBreakdown.Laporan.unmigrated} di Laporan, ${db.sheetBreakdown.Activity.unmigrated} di Activity, ${db.sheetBreakdown.ItemReviewHistory.unmigrated} di Review).`, 'warn');
      } else {
        addLog(`• SEMUA link di Google Sheets (100%) sudah terverifikasi merujuk ke file milik depotel@vgd4.my.id!`, 'success');
      }
    } catch (err: any) {
      addLog(`Gagal verifikasi kepemilikan: ${err.message}`, 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  // 2. Client-Side Batch Migration (Guarantees depotel@vgd4.my.id Ownership)
  const startMigration = async (overrideQueue?: string[]) => {
    if (!token || token === 'mock_demo_token') {
      addLog('Sesi token Google login tidak tersedia. Silakan muat ulang halaman.', 'error');
      return;
    }

    const queueToRun = overrideQueue || remainingDbQueue;
    if (queueToRun.length === 0) {
      if (totalDbFiles === 0) {
        await handleScan();
      } else {
        addLog('Seluruh file dalam antrean database sudah selesai dimigrasikan.', 'info');
        return;
      }
    }

    if (overrideQueue && overrideQueue.length > 0) {
      setRemainingDbQueue(overrideQueue);
      if (auditResult) {
        setTotalDbFiles(auditResult.database.totalUniqueFiles);
        setProcessedDbFiles(auditResult.database.verifiedFilesCount);
        setMigratedCount(auditResult.database.verifiedFilesCount);
      }
    }

    setIsRunning(true);
    setIsPaused(false);
    shouldContinueRef.current = true;
    addLog(`Memeriksa token & memulai duplikasi ${queueToRun.length} file (Akun: depotel@vgd4.my.id)...`, 'info');

    // Validate that the active token is strictly verified as depotel@vgd4.my.id
    const currentToken = activeTokenRef.current || localStorage.getItem('g_user_oauth_token') || localStorage.getItem('g_access_token') || '';
    if (!currentToken) {
      addLog('Token akses Google Drive tidak tersedia. Silakan klik Login Akun depotel@vgd4.my.id.', 'error');
      setIsRunning(false);
      return;
    }

    addLog('Memvalidasi identitas akun Google...', 'info');
    const tokenInfo = await verifyTokenAccountEmail(currentToken);
    if (!tokenInfo) {
      addLog('Sesi token Google tidak valid atau kedaluwarsa. Silakan Login Akun depotel@vgd4.my.id.', 'error');
      setIsRunning(false);
      return;
    }

    if (!tokenInfo.isDepotel) {
      addLog(`PENCEGAHAN KEPEMILIKAN: Token saat ini terikat ke '${tokenInfo.email}', BUKAN 'depotel@vgd4.my.id'. Duplikasi ditolak agar file tidak dimiliki akun lain. Silakan klik tombol 'Hubungkan depotel@vgd4.my.id'.`, 'error');
      setIsRunning(false);
      return;
    }

    activeTokenRef.current = currentToken;
    setTokenAccountEmail(tokenInfo.email);
    setIsTokenDepotel(true);
    addLog(`Identitas token terkonfirmasi sah: ${tokenInfo.email}. Memulai duplikasi...`, 'success');

    let currentQueue = [...queueToRun];
    let currentProcessed = overrideQueue && auditResult ? auditResult.database.verifiedFilesCount : processedDbFiles;
    let currentMigrated = overrideQueue && auditResult ? auditResult.database.verifiedFilesCount : migratedCount;
    let currentFailed = failedCount;
    let currentCells = updatedCellsCount;

    while (shouldContinueRef.current && currentQueue.length > 0) {
      const currentBatchIds = currentQueue.slice(0, batchSize);
      addLog(`[Batch] Menduplikasi ${currentBatchIds.length} foto langsung di browser...`, 'info');

      const batchMappings: Array<{ oldFileId: string; newFileId: string; newWebViewLink: string; fileName: string }> = [];

      // Step A: Duplicate directly in user's browser using depotel@vgd4.my.id token
      for (const fId of currentBatchIds) {
        if (!shouldContinueRef.current) break;
        try {
          const copyResult = await copyDriveFileInBrowser(
            activeTokenRef.current,
            fId,
            `bukti_${fId}.jpg`,
            MASTER_DRIVE_FOLDER_ID,
            (newToken) => {
              activeTokenRef.current = newToken;
              addLog('Token akses Google Drive diperbarui otomatis (Auto-Renew).', 'info');
            }
          );
          if (copyResult.success && copyResult.newFileId) {
            batchMappings.push({
              oldFileId: fId,
              newFileId: copyResult.newFileId,
              newWebViewLink: copyResult.newWebViewLink,
              fileName: copyResult.fileName
            });
            currentMigrated++;
            addLog(`[OK] Foto disalin: ${copyResult.newFileId} (Owner: depotel@vgd4.my.id)`, 'success');
          } else {
            currentFailed++;
            addLog(`[GAGAL COPY] File ${fId}: ${copyResult.error || 'Error'}`, 'warn');
          }
        } catch (copyErr: any) {
          currentFailed++;
          addLog(`[ERROR] File ${fId}: ${copyErr?.message || copyErr}`, 'error');
        }
      }

      // Step B: Atomically commit batch to Google Sheets & move old files to archive folder
      if (batchMappings.length > 0) {
        try {
          addLog(`Memperbarui tautan database Google Sheets & memindahkan foto lama ke backup...`, 'info');
          const targetArchiveId = depotelArchiveFolder?.id || '1u3wyWZ9CgYwM2867-mLEBkEwLJ3z6oiY';
          const commitRes = await commitMigratedBatchToDatabase({
            batchMappings,
            archiveFolderId: targetArchiveId
          });

          if (commitRes.success) {
            currentCells += commitRes.updatedCells || 0;
            addLog(`Berhasil: ${commitRes.updatedCells} sel database diperbarui & ${commitRes.movedFiles} file lama dipindah ke backup.`, 'success');
          } else {
            addLog(`Peringatan commit: ${commitRes.error || 'Terjadi kendala update database'}`, 'warn');
          }
        } catch (commitErr: any) {
          addLog(`Gagal commit ke database: ${commitErr?.message || commitErr}`, 'error');
        }
      }

      currentProcessed += currentBatchIds.length;
      currentQueue = currentQueue.slice(currentBatchIds.length);

      // Update state
      setProcessedDbFiles(currentProcessed);
      setMigratedCount(currentMigrated);
      setFailedCount(currentFailed);
      setUpdatedCellsCount(currentCells);
      setRemainingDbQueue(currentQueue);

      saveProgress(
        currentProcessed,
        currentMigrated,
        currentFailed,
        currentCells,
        currentQueue,
        orphanedQueue,
        archivedOrphanCount
      );

      // Small delay between batches to respect rate limits
      if (shouldContinueRef.current && currentQueue.length > 0) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    setIsRunning(false);
    if (currentQueue.length === 0) {
      addLog('Selesai! Seluruh foto aktif di database berhasil diduplikasi menjadi milik depotel@vgd4.my.id.', 'success');
      // Auto-refresh verification audit
      verifyOwnershipAudit()
        .then(res => setAuditResult(res))
        .catch(() => {});
    } else if (!shouldContinueRef.current) {
      addLog('Proses migrasi dijeda oleh Administrator.', 'warn');
    }
  };

  const handlePause = () => {
    shouldContinueRef.current = false;
    setIsPaused(true);
    setIsRunning(false);
    addLog('Menjeda migrasi...', 'warn');
  };

  // 3. Orphaned Files Archiving Loop
  const handleArchiveOrphans = async () => {
    if (orphanedQueue.length === 0) {
      addLog('Tidak ada file foto yatim dalam antrean.', 'warn');
      return;
    }

    setIsArchivingOrphans(true);
    addLog(`Memulai pemindahan ${orphanedQueue.length} file foto yatim ke folder backup...`, 'info');

    let currentOrphans = [...orphanedQueue];
    let totalMoved = archivedOrphanCount;

    while (currentOrphans.length > 0) {
      const batch = currentOrphans.slice(0, 50);
      try {
        let targetArchiveId = depotelArchiveFolder?.id;
        if (!targetArchiveId && activeTokenRef.current) {
          try {
            const folder = await ensureDepotelArchiveFolder(activeTokenRef.current);
            if (folder?.id) {
              setDepotelArchiveFolder(folder);
              targetArchiveId = folder.id;
            }
          } catch {}
        }
        if (!targetArchiveId) {
          targetArchiveId = '1u3wyWZ9CgYwM2867-mLEBkEwLJ3z6oiY';
        }

        const res = await archiveOrphanedPhotos({
          fileIds: batch,
          archiveFolderId: targetArchiveId,
          userToken: activeTokenRef.current
        });

        if (res.success) {
          if (res.movedCount > 0) {
            totalMoved += res.movedCount;
            currentOrphans = currentOrphans.slice(res.movedCount);
            setOrphanedQueue(currentOrphans);
            setArchivedOrphanCount(totalMoved);

            addLog(`Memindahkan batch: ${res.movedCount} file yatim dipindahkan (Sisa antrean: ${currentOrphans.length}).`, 'info');

            saveProgress(
              processedDbFiles,
              migratedCount,
              failedCount,
              updatedCellsCount,
              remainingDbQueue,
              currentOrphans,
              totalMoved
            );
          } else {
            addLog(`Peringatan: 0 file berhasil dipindahkan pada batch ini.`, 'warn');
            break;
          }
        } else {
          addLog(`Gagal memindahkan batch yatim: ${res.error || 'Error'}`, 'error');
          break;
        }
      } catch (err: any) {
        addLog(`Kesalahan pemindahan yatim: ${err?.message || err}`, 'error');
        break;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    setIsArchivingOrphans(false);
    if (totalMoved > 0) {
      addLog(`Pengarsipan file yatim selesai: Total ${totalMoved} file berhasil dipindahkan/dibersihkan dari folder aktif.`, 'success');
    } else {
      addLog(`Proses selesai. Tidak ada file yang dipindahkan.`, 'info');
    }
  };

  const handleResetProgress = () => {
    if (isRunning || isArchivingOrphans) return;
    localStorage.removeItem(STORAGE_KEY_MIGRATION_PROGRESS);
    setTotalDbFiles(0);
    setProcessedDbFiles(0);
    setRemainingDbQueue([]);
    setOrphanedQueue([]);
    setMigratedCount(0);
    setFailedCount(0);
    setUpdatedCellsCount(0);
    setArchivedOrphanCount(0);
    setScanResult(null);
    setLogs([]);
    addLog('Riwayat lokal di-reset. Silakan tekan Mulai Pindai Audit.', 'info');
  };

  const progressPercent = totalDbFiles > 0 ? Math.min(100, Math.round((processedDbFiles / totalDbFiles) * 100)) : 0;
  const isTargetAccount = (adminEmail || '').toLowerCase().includes('depotel@vgd4.my.id');

  return (
    <>
      {/* Administrator Card on Dashboard */}
      <div className="bg-gradient-to-br from-white via-blue-50/40 to-indigo-50/60 rounded-3xl border border-blue-200/80 shadow-md p-5 sm:p-6 space-y-4 hover:shadow-lg transition-all relative overflow-hidden group">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-200 group-hover:scale-105 transition-transform shrink-0">
              <HardDriveDownload className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                  Audit data Google Drive
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Duplikasi foto ke <strong className="text-slate-800">depotel@vgd4.my.id</strong> (folder aktif), perbarui database, & arsipkan foto lama/yatim ke backup.
              </p>
            </div>
          </div>
        </div>

        {/* Progress teaser if previously scanned or started */}
        {totalDbFiles > 0 && (
          <div className="bg-white/80 border border-blue-100 rounded-2xl p-3.5 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-medium text-slate-600 flex items-center gap-1.5">
                <FileImage className="w-4 h-4 text-indigo-500" />
                <span>Foto Aktif Database: <strong>{processedDbFiles}</strong> dari <strong>{totalDbFiles}</strong> ({progressPercent}%)</span>
              </span>
              <span className="text-[11px] font-bold text-emerald-600">
                {migratedCount} selesai dialihkan
              </span>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 flex-wrap gap-3">
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Folder aktif tetap digunakan. Foto lama & foto yatim dialihkan ke backup.</span>
          </div>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-100 flex items-center gap-2 cursor-pointer active:scale-95 ml-auto"
          >
            <span>Buka Panel Migrasi Foto</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Modal Dialog */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-[100000] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl p-5 sm:p-6 max-w-2xl w-full my-auto space-y-5 animate-in zoom-in-95 duration-150 relative max-h-[92vh] flex flex-col">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                  <HardDriveDownload className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    Panel Migrasi Kepemilikan Foto Google Drive
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Eksekusi duplikasi langsung di browser (Owner: <strong>depotel@vgd4.my.id</strong>)
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isRunning || isArchivingOrphans}
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all cursor-pointer disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="overflow-y-auto space-y-4 pr-1 flex-1">
              
              {/* Target & Archive Folders Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl space-y-1">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                    <FolderCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Folder Aktif Saat Ini (Live):</span>
                  </span>
                  <p className="font-mono text-[11px] font-semibold text-emerald-950 truncate" title={MASTER_DRIVE_FOLDER_ID}>
                    {MASTER_DRIVE_FOLDER_ID}
                  </p>
                  <p className="text-[10px] text-emerald-700">
                    Foto hasil migrasi (Milik <strong>depotel@vgd4.my.id</strong>) tetap berada di folder aktif ini.
                  </p>
                </div>

                <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-2xl space-y-1">
                  <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider flex items-center justify-between gap-1.5">
                    <span className="flex items-center gap-1.5">
                      <FolderArchive className="w-3.5 h-3.5 text-amber-600" />
                      <span>Folder Backup (Arsip):</span>
                    </span>
                    <a
                      href={depotelArchiveFolder?.webViewLink || `https://drive.google.com/drive/folders/${depotelArchiveFolder?.id || '1u3wyWZ9CgYwM2867-mLEBkEwLJ3z6oiY'}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 hover:text-amber-950 underline cursor-pointer"
                      title="Buka langsung di Google Drive depotel@vgd4.my.id"
                    >
                      <span>Buka Folder</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </span>
                  <p className="font-medium text-[11px] text-amber-950 truncate" title={MASTER_ARCHIVE_FOLDER_NAME}>
                    {MASTER_ARCHIVE_FOLDER_NAME}
                  </p>
                  <p className="text-[10px] text-amber-700 flex items-center justify-between">
                    <span>Menampung foto lama ops.depotel@gmail.com & foto yatim.</span>
                    <span className="font-bold text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded text-[9px]">
                      Milik: depotel@vgd4.my.id
                    </span>
                  </p>
                </div>
              </div>

              {/* Step 1: Scan & Audit */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-600" />
                    <h4 className="text-xs font-bold text-slate-800">1. Pindai Database & Audit Google Drive</h4>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={isScanning || isRunning || isArchivingOrphans || isVerifying}
                      onClick={handleVerifyOwnership}
                      className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                      title="Audit verifikasi sampel kepemilikan file di Google Sheet & Google Drive"
                    >
                      {isVerifying ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                          <span>Memverifikasi...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Verifikasi Kepemilikan</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={isScanning || isRunning || isArchivingOrphans || isVerifying}
                      onClick={handleScan}
                      className="px-3 py-1.5 bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                    >
                      {isScanning ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Memindai...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>{totalDbFiles > 0 ? 'Pindai Ulang' : 'Mulai Pindai Audit'}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {auditResult && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl text-xs space-y-2.5 animate-slide-up shadow-xs">
                    <div className="flex items-center justify-between font-bold text-emerald-950 flex-wrap gap-2">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600" />
                        <span>Verifikasi Seluruh Tautan Google Sheets (100% Data Riil)</span>
                      </span>
                      <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200">
                        {auditResult.database.totalCells.toLocaleString()} link diperiksa
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                      {/* Box 1: Status Seluruh Tautan Google Sheets */}
                      <div className="bg-white p-3 rounded-xl border border-emerald-200 space-y-1.5 shadow-2xs">
                        <span className="text-slate-500 block text-[10px] font-bold uppercase tracking-wider">
                          Kepemilikan Link di Google Sheets:
                        </span>
                        <div className="flex items-baseline gap-1.5">
                          <strong className="text-emerald-700 font-mono text-xl font-black">
                            {auditResult.database.percentage}%
                          </strong>
                          <span className="text-slate-700 font-semibold text-xs">
                            milik depotel@vgd4.my.id
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-600 leading-relaxed font-medium">
                          <strong className="text-emerald-700">{auditResult.database.verifiedFilesCount.toLocaleString()}</strong> dari{' '}
                          <strong className="text-slate-900">{auditResult.database.totalUniqueFiles.toLocaleString()}</strong> file unik terverifikasi sah.
                          {auditResult.database.unmigratedFilesCount > 0 ? (
                            <span className="text-amber-700 block mt-0.5 font-bold">
                              (Tersisa {auditResult.database.unmigratedFilesCount} file belum beralih).
                            </span>
                          ) : (
                            <span className="text-emerald-600 block mt-0.5 font-bold">
                              (Seluruh file 100% sudah beralih penuh!).
                            </span>
                          )}
                        </p>

                        {/* Breakdown per Sheet */}
                        <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-1 text-[10px]">
                          <div>
                            <span className="text-slate-400">Pengajuan:</span>{' '}
                            <strong className={auditResult.database.sheetBreakdown.Pengajuan.unmigrated === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                              {auditResult.database.sheetBreakdown.Pengajuan.unmigrated === 0 ? '✓ 100% Selesai' : `${auditResult.database.sheetBreakdown.Pengajuan.unmigrated} belum`}
                            </strong>
                          </div>
                          <div>
                            <span className="text-slate-400">Laporan:</span>{' '}
                            <strong className={auditResult.database.sheetBreakdown.Laporan.unmigrated === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                              {auditResult.database.sheetBreakdown.Laporan.unmigrated === 0 ? '✓ 100% Selesai' : `${auditResult.database.sheetBreakdown.Laporan.unmigrated} belum`}
                            </strong>
                          </div>
                          <div>
                            <span className="text-slate-400">Activity:</span>{' '}
                            <strong className={auditResult.database.sheetBreakdown.Activity.unmigrated === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                              {auditResult.database.sheetBreakdown.Activity.unmigrated === 0 ? '✓ 100% Selesai' : `${auditResult.database.sheetBreakdown.Activity.unmigrated} belum`}
                            </strong>
                          </div>
                          <div>
                            <span className="text-slate-400">Review Hist:</span>{' '}
                            <strong className={auditResult.database.sheetBreakdown.ItemReviewHistory.unmigrated === 0 ? 'text-emerald-600' : 'text-amber-600'}>
                              {auditResult.database.sheetBreakdown.ItemReviewHistory.unmigrated === 0 ? '✓ 100% Selesai' : `${auditResult.database.sheetBreakdown.ItemReviewHistory.unmigrated} belum`}
                            </strong>
                          </div>
                        </div>

                        {/* View Details Button for Unmigrated Database Photos */}
                        {auditResult.database.unmigratedFilesCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setDetailModalTab('unmigrated');
                              setDetailSearchQuery('');
                              setDetailSheetFilter('ALL');
                            }}
                            className="w-full mt-2 py-1.5 px-2 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <Eye className="w-3.5 h-3.5 text-amber-600" />
                            <span>Lihat Daftar {auditResult.database.unmigratedFilesCount} Foto Belum Beralih</span>
                          </button>
                        )}
                      </div>

                      {/* Box 2: Status Folder Aktif Google Drive */}
                      <div className="bg-white p-3 rounded-xl border border-indigo-200 space-y-1.5 shadow-2xs flex flex-col justify-between">
                        <div>
                          <span className="text-slate-500 block text-[10px] font-bold uppercase tracking-wider">
                            Status Folder Aktif Google Drive:
                          </span>
                          <div className="flex items-baseline gap-1.5 mt-0.5">
                            <strong className="text-indigo-700 font-mono text-xl font-black">
                              {auditResult.folder.nonDepotelTotal}
                            </strong>
                            <span className="text-slate-700 font-semibold text-xs">
                              file bukan milik depotel
                            </span>
                          </div>
                          <ul className="text-[10px] text-slate-600 space-y-1 mt-1 font-medium">
                            <li className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              <span><strong>{auditResult.folder.nonDepotelInDatabase} file</strong> masih aktif dirujuk di Sheet (perlu disalin)</span>
                            </li>
                            <li className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                              <span><strong>{auditResult.folder.orphanedReadyForBackup} file</strong> foto yatim lama siap dipindahkan ke backup</span>
                            </li>
                          </ul>

                          {/* View Detail Buttons for Google Drive Orphaned & Non-Depotel Photos */}
                          <div className="flex gap-1.5 mt-2">
                            {auditResult.folder.orphanedReadyForBackup > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDetailModalTab('orphaned');
                                  setDetailSearchQuery('');
                                }}
                                className="flex-1 py-1.5 px-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-800 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                              >
                                <Eye className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Lihat {auditResult.folder.orphanedReadyForBackup} Foto Yatim</span>
                              </button>
                            )}
                            {auditResult.folder.nonDepotelInDatabase > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setDetailModalTab('unmigrated');
                                  setDetailSearchQuery('');
                                  setDetailSheetFilter('ALL');
                                }}
                                className="flex-1 py-1.5 px-2 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                              >
                                <Eye className="w-3.5 h-3.5 text-amber-600" />
                                <span>Lihat {auditResult.folder.nonDepotelInDatabase} Foto Aktif</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Quick action button to directly start duplicating remaining unmigrated files */}
                        {auditResult.database.unmigratedFilesCount > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {isTokenDepotel !== true && (
                              <button
                                type="button"
                                disabled={isConnectingAccount || isRunning}
                                onClick={handleConnectDepotelAccount}
                                className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                              >
                                {isConnectingAccount ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <LogIn className="w-3.5 h-3.5" />
                                )}
                                <span>Hubungkan Sesi depotel@vgd4.my.id</span>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={isRunning || isArchivingOrphans || isTokenDepotel !== true}
                              onClick={() => {
                                startMigration(auditResult.database.unmigratedFileIds);
                              }}
                              className="w-full py-2 px-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-200 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-98"
                              title="Mulai duplikasi file sisa langsung sekarang juga"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              <span>Jalankan Duplikasi {auditResult.database.unmigratedFilesCount} File Sisa Sekarang &rarr;</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {scanError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span>{scanError}</span>
                  </div>
                )}

                {/* Audit Counters */}
                {totalDbFiles > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200/80 shadow-2xs">
                      <p className="text-[10px] text-slate-500 font-medium">Foto di Database</p>
                      <p className="text-sm sm:text-base font-extrabold text-slate-900">{totalDbFiles.toLocaleString()}</p>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-emerald-200/80 shadow-2xs">
                      <p className="text-[10px] text-emerald-600 font-medium">Selesai Diduplikasi</p>
                      <p className="text-sm sm:text-base font-extrabold text-emerald-700">{migratedCount.toLocaleString()}</p>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-amber-200/80 shadow-2xs">
                      <p className="text-[10px] text-amber-600 font-medium">Foto Yatim (Drive)</p>
                      <p className="text-sm sm:text-base font-extrabold text-amber-700">{orphanedQueue.length.toLocaleString()}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Active Photos Duplication (Client-Side) */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-indigo-600" />
                      <span>2. Migrasi Foto Aktif Database</span>
                    </h4>
                    <p className="text-[10px] text-slate-500">
                      Disalin langsung dari browser Anda agar Google Drive menandai <strong>Owner: depotel@vgd4.my.id</strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      disabled={isRunning}
                      value={batchSize}
                      onChange={(e) => setBatchSize(Number(e.target.value))}
                      className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                    >
                      <option value={5}>5 / batch</option>
                      <option value={10}>10 / batch</option>
                      <option value={20}>20 / batch</option>
                    </select>

                    {isTokenDepotel !== true && (
                      <button
                        type="button"
                        disabled={isConnectingAccount || isRunning}
                        onClick={handleConnectDepotelAccount}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        title="Otentikasi Google sebagai depotel@vgd4.my.id"
                      >
                        {isConnectingAccount ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <LogIn className="w-3.5 h-3.5" />
                        )}
                        <span>Login depotel@vgd4.my.id</span>
                      </button>
                    )}

                    {isRunning ? (
                      <button
                        type="button"
                        onClick={handlePause}
                        className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-amber-100 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Pause className="w-3.5 h-3.5" />
                        <span>Jeda (Pause)</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isScanning || isArchivingOrphans || (totalDbFiles > 0 && remainingDbQueue.length === 0)}
                        onClick={startMigration}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-100 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>{isPaused ? 'Lanjutkan' : 'Mulai Duplikasi'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar for Active Photos */}
                {totalDbFiles > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-[11px] text-slate-600">
                      <span>Progres Duplikasi Foto Aktif:</span>
                      <span className="font-bold text-indigo-700">
                        {processedDbFiles} / {totalDbFiles} ({progressPercent}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-500 rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Step 3: Orphaned Photos Archiving */}
              {orphanedQueue.length > 0 ? (
                <div className="p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-2xl flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h5 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                      <FolderArchive className="w-4 h-4 text-amber-600" />
                      <span>3. Pengarsipan Foto Yatim ({orphanedQueue.length} file)</span>
                    </h5>
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Pindahkan file yang tidak tercantum di Google Sheet langsung ke folder backup tanpa diduplikasi.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isRunning || isArchivingOrphans}
                    onClick={handleArchiveOrphans}
                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-amber-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {isArchivingOrphans ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Mengarsipkan ({archivedOrphanCount} dipindah)...</span>
                      </>
                    ) : (
                      <>
                        <FolderArchive className="w-3.5 h-3.5" />
                        <span>Pindahkan ke Backup</span>
                      </>
                    )}
                  </button>
                </div>
              ) : archivedOrphanCount > 0 ? (
                <div className="p-3.5 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h5 className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>3. Seluruh Foto Yatim Selesai Diarsipkan ({archivedOrphanCount} file)</span>
                    </h5>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      Seluruh file lama di luar database telah dipindahkan ke folder backup. Folder aktif kini 100% bersih.
                    </p>
                  </div>
                </div>
              ) : null}

              {/* Live Activity Log */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Log Aktivitas Real-time:</span>
                  <div className="flex items-center gap-3">
                    <span>{updatedCellsCount} sel diperbarui</span>
                    {totalDbFiles > 0 && !isRunning && !isArchivingOrphans && (
                      <button
                        type="button"
                        onClick={handleResetProgress}
                        className="text-slate-400 hover:text-rose-600 transition-colors text-[10px] cursor-pointer"
                      >
                        Reset Antrean
                      </button>
                    )}
                  </div>
                </div>
                <div className="bg-slate-900 rounded-2xl p-3 h-40 overflow-y-auto font-mono text-[10px] text-slate-200 space-y-1 border border-slate-800 shadow-inner">
                  {logs.length === 0 ? (
                    <p className="text-slate-500 italic">Belum ada aktivitas. Tekan "Mulai Pindai Audit" untuk memulai.</p>
                  ) : (
                    logs.map(log => (
                      <div
                        key={log.id}
                        className={`flex items-start gap-2 leading-relaxed ${
                          log.type === 'success'
                            ? 'text-emerald-400'
                            : log.type === 'error'
                            ? 'text-rose-400'
                            : log.type === 'warn'
                            ? 'text-amber-400'
                            : 'text-slate-300'
                        }`}
                      >
                        <span className="text-slate-500 shrink-0">[{log.time}]</span>
                        <span>{log.text}</span>
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-500">
                {isRunning ? (
                  <span className="text-amber-600 font-bold flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Sedang menduplikasi foto di browser...</span>
                  </span>
                ) : isArchivingOrphans ? (
                  <span className="text-amber-600 font-bold flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Sedang memindahkan file yatim ke backup...</span>
                  </span>
                ) : (
                  <span>Status: Siap</span>
                )}
              </span>
              <button
                type="button"
                disabled={isRunning || isArchivingOrphans}
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
              >
                Tutup
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}

      {/* 4. Sub-Modal: Detail Inspector for Orphaned & Unmigrated Photos */}
      {detailModalTab !== null && createPortal(
        <div className="fixed inset-0 z-[120] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/70">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-2xl ${detailModalTab === 'orphaned' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>
                  {detailModalTab === 'orphaned' ? <FolderArchive className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <span>{detailModalTab === 'orphaned' ? 'Daftar Foto Yatim di Google Drive' : 'Daftar Foto Belum Beralih di Database'}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {detailModalTab === 'orphaned'
                      ? 'File foto di folder aktif Drive yang BUKAN milik depotel dan TIDAK ADA di Google Sheets (siap dipindahkan ke backup).'
                      : 'File foto yang masih aktif dirujuk di baris Google Sheets namun kepemilikannya di Drive belum milik depotel@vgd4.my.id.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailModalTab(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-all cursor-pointer"
                title="Tutup"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tab Switcher & Quick Metrics */}
            <div className="px-4 sm:px-5 pt-3 pb-2 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-white shrink-0">
              <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setDetailModalTab('orphaned');
                    setDetailSearchQuery('');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    detailModalTab === 'orphaned'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FolderArchive className="w-3.5 h-3.5" />
                  <span>Foto Yatim Drive</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-50 text-indigo-700 font-extrabold">
                    {activeOrphanedList.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDetailModalTab('unmigrated');
                    setDetailSearchQuery('');
                    setDetailSheetFilter('ALL');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    detailModalTab === 'unmigrated'
                      ? 'bg-white text-amber-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Foto Belum Beralih di Database</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-50 text-amber-700 font-extrabold">
                    {activeUnmigratedList.length}
                  </span>
                </button>
              </div>

              {/* Action Buttons: Copy All IDs & Export CSV */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyAllIds(detailModalTab === 'orphaned' ? filteredOrphaned : filteredUnmigrated)}
                  disabled={(detailModalTab === 'orphaned' ? filteredOrphaned.length : filteredUnmigrated.length) === 0}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                  title="Salin seluruh ID file hasil filter ke clipboard"
                >
                  {isCopiedAll ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                  <span>{isCopiedAll ? 'Semua ID Tersalin!' : 'Salin Semua ID'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadCsv(detailModalTab, detailModalTab === 'orphaned' ? filteredOrphaned : filteredUnmigrated)}
                  disabled={(detailModalTab === 'orphaned' ? filteredOrphaned.length : filteredUnmigrated.length) === 0}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40 shadow-2xs"
                  title="Unduh seluruh data daftar ini dalam format file CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh CSV</span>
                </button>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="px-4 sm:px-5 py-2.5 bg-slate-50/50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={detailSearchQuery}
                  onChange={(e) => setDetailSearchQuery(e.target.value)}
                  placeholder="Cari berdasarkan nama file, ID Drive, atau email pemilik..."
                  className="w-full pl-9 pr-8 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400"
                />
                {detailSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setDetailSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {detailModalTab === 'unmigrated' && (
                <div className="flex items-center gap-1.5 text-xs">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-500 font-medium">Sheet:</span>
                  <select
                    value={detailSheetFilter}
                    onChange={(e) => setDetailSheetFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="ALL">Semua Sheet</option>
                    <option value="Pengajuan">Pengajuan</option>
                    <option value="Laporan">Laporan</option>
                    <option value="Activity">Activity</option>
                    <option value="ItemReviewHistory">Review Hist</option>
                  </select>
                </div>
              )}

              <div className="text-[11px] text-slate-500">
                Menampilkan <strong>{detailModalTab === 'orphaned' ? filteredOrphaned.length : filteredUnmigrated.length}</strong> dari{' '}
                <strong>{detailModalTab === 'orphaned' ? activeOrphanedList.length : activeUnmigratedList.length}</strong> file
              </div>
            </div>

            {/* List / Table Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {(detailModalTab === 'orphaned' ? filteredOrphaned : filteredUnmigrated).length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <Search className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-700">Tidak ada file yang cocok</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    {detailSearchQuery
                      ? `Tidak ditemukan file dengan kata kunci "${detailSearchQuery}". Silakan coba kata kunci lain.`
                      : 'Kategori ini tidak memiliki file sisa. Seluruh file dalam kategori ini sudah bersih/terverifikasi.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-bold text-[11px]">
                        <th className="py-2.5 px-3 w-12 text-center">No</th>
                        <th className="py-2.5 px-3">Nama File</th>
                        <th className="py-2.5 px-3">ID File Google Drive</th>
                        <th className="py-2.5 px-3">Pemilik Asli (Drive)</th>
                        {detailModalTab === 'unmigrated' && <th className="py-2.5 px-3">Sheet Terkait</th>}
                        <th className="py-2.5 px-3 text-right">Ukuran</th>
                        <th className="py-2.5 px-3">Tanggal Dibuat</th>
                        <th className="py-2.5 px-3 text-center w-20">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {(detailModalTab === 'orphaned' ? filteredOrphaned : filteredUnmigrated).map((item, index) => {
                        const isCopied = copiedId === item.id;
                        return (
                          <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2.5 px-3 text-center text-slate-400 font-sans font-medium">{index + 1}</td>
                            <td className="py-2.5 px-3 font-sans font-semibold text-slate-800">
                              <div className="flex items-center gap-2">
                                <FileImage className="w-4 h-4 text-indigo-500 shrink-0" />
                                <span className="truncate max-w-[200px] sm:max-w-[260px]" title={item.name}>
                                  {item.name || `foto_${item.id}.jpg`}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              <div className="flex items-center gap-1.5">
                                <span className="bg-slate-100 px-2 py-0.5 rounded text-[10px] text-slate-700 font-mono select-all">
                                  {item.id}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyId(item.id)}
                                  className="p-1 hover:bg-slate-200 text-slate-400 hover:text-slate-700 rounded transition-all cursor-pointer"
                                  title="Salin ID"
                                >
                                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-sans">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                {item.ownerEmail || 'Bukan depotel'}
                              </span>
                              {item.ownerName && (
                                <span className="block text-[10px] text-slate-400 mt-0.5">{item.ownerName}</span>
                              )}
                            </td>
                            {detailModalTab === 'unmigrated' && (
                              <td className="py-2.5 px-3 font-sans">
                                <div className="flex flex-wrap gap-1">
                                  {((item as UnmigratedDbPhotoItem).sheets || ['Database']).map((s) => (
                                    <span
                                      key={s}
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                        s === 'Pengajuan'
                                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                          : s === 'Laporan'
                                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                          : s === 'Activity'
                                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                                      }`}
                                    >
                                      {s}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            )}
                            <td className="py-2.5 px-3 text-right text-slate-500 font-sans">
                              {formatFileSize(item.size)}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 font-sans">
                              {formatDate(item.createdTime)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <a
                                href={item.webViewLink || `https://drive.google.com/file/d/${item.id}/view`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 rounded-lg text-[10px] font-sans font-bold transition-all"
                                title="Buka foto di Google Drive"
                              >
                                <span>Buka</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/70">
              <span className="text-xs text-slate-500">
                Total terdaftar: <strong>{detailModalTab === 'orphaned' ? activeOrphanedList.length : activeUnmigratedList.length}</strong> file
              </span>
              <button
                type="button"
                onClick={() => setDetailModalTab(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Tutup Rincian
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
