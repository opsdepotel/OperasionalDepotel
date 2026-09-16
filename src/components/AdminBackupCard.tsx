import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  HardDriveDownload,
  FileSpreadsheet,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  FolderSync,
  ShieldCheck,
  Info,
  Square,
  X
} from 'lucide-react';
import {
  BACKUP_TARGET_FOLDER_ID,
  getBackupHistory,
  formatBackupTimestamp,
  scanDriveBackup,
  executeDriveBackup,
  BackupHistoryItem,
  BackupScanResult,
  BackupExecutionResult
} from '../lib/driveBackup';

interface AdminBackupCardProps {
  token?: string | null;
  spreadsheetId?: string | null;
  driveFolderId?: string | null;
  adminEmail?: string;
  isOpen?: boolean;
  onClose?: () => void;
  hideCardPreview?: boolean;
}

export const AdminBackupCard: React.FC<AdminBackupCardProps> = ({
  token,
  spreadsheetId,
  driveFolderId,
  adminEmail = 'admin@depotel.co.id',
  isOpen,
  onClose,
  hideCardPreview = false
}) => {
  const [copySheet, setCopySheet] = useState(true);
  const [copyPhotos, setCopyPhotos] = useState(true);
  const [autoLoop, setAutoLoop] = useState(true);
  const [batchSize, setBatchSize] = useState(50);
  const [isScanning, setIsScanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [scanResult, setScanResult] = useState<BackupScanResult | null>(null);
  const [executionResult, setExecutionResult] = useState<BackupExecutionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ step: string; percent: number; detail: string } | null>(null);
  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedFolderId, setCopiedFolderId] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(isOpen || false);
  const cancelLoopRef = useRef(false);

  useEffect(() => {
    if (typeof isOpen === 'boolean') {
      setIsModalOpen(isOpen);
    }
  }, [isOpen]);

  useEffect(() => {
    setHistory(getBackupHistory());
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen && !isExecuting) {
        setIsModalOpen(false);
        if (onClose) onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, isExecuting, onClose]);

  const handleCopyFolderId = () => {
    navigator.clipboard.writeText(BACKUP_TARGET_FOLDER_ID);
    setCopiedFolderId(true);
    setTimeout(() => setCopiedFolderId(false), 2000);
  };

  const getActivePhotoName = (progressDetail?: string): string | null => {
    if (!progressDetail) return null;
    const match = progressDetail.match(/:\s*([^\s:]+\.(?:jpg|jpeg|png|webp|heic|pdf|gif))/i) ||
                  progressDetail.match(/:\s*([^\s:]+)/i);
    if (match && match[1]) {
      const clean = match[1].replace(/\.{3}$/, '').trim();
      if (clean.length > 2 && !clean.includes(' ') && clean.includes('.')) {
        return clean;
      }
    }
    const extMatch = progressDetail.match(/([a-zA-Z0-9_\-.]+\.(?:jpg|jpeg|png|webp|heic|pdf|gif))/i);
    if (extMatch && extMatch[1]) {
      return extMatch[1];
    }
    return null;
  };

  const handleScan = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsScanning(true);
    try {
      const result = await scanDriveBackup({
        targetFolderId: BACKUP_TARGET_FOLDER_ID,
        spreadsheetId: spreadsheetId || undefined,
        sourceFolderId: driveFolderId || undefined,
        token
      });
      setScanResult(result);
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memindai folder Google Drive cadangan.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleCancelBackup = () => {
    cancelLoopRef.current = true;
    setProgress((prev) =>
      prev ? { ...prev, detail: 'Menghentikan proses setelah batch saat ini selesai...' } : null
    );
  };

  const handleExecuteBackup = async () => {
    if (!copySheet && !copyPhotos) {
      setErrorMessage('Pilih minimal satu opsi: Salin Google Sheet atau Salin Foto Bukti.');
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setExecutionResult(null);
    setIsExecuting(true);
    cancelLoopRef.current = false;
    setProgress({ step: 'INITIALIZING', percent: 5, detail: 'Memulai proses backup database...' });

    let loopIteration = 0;
    let keepGoing = true;
    let cumulativeCopied = 0;
    let finalResult: BackupExecutionResult | null = null;

    try {
      while (keepGoing && !cancelLoopRef.current && loopIteration < 50) {
        loopIteration++;
        const isFirstLoop = loopIteration === 1;

        const currentResult = await executeDriveBackup({
          targetFolderId: BACKUP_TARGET_FOLDER_ID,
          spreadsheetId: spreadsheetId || undefined,
          sourceFolderId: driveFolderId || undefined,
          copySpreadsheet: isFirstLoop ? copySheet : false,
          copyPhotos: copyPhotos,
          maxPhotos: batchSize,
          token,
          adminEmail,
          onProgress: (prog) => {
            const batchPrefix = autoLoop && copyPhotos ? `[Batch #${loopIteration}] ` : '';
            setProgress({
              ...prog,
              detail: `${batchPrefix}${prog.detail}`
            });
          }
        });

        finalResult = currentResult;
        cumulativeCopied += currentResult.photosSummary?.copied || 0;

        // Check if we should continue the auto-loop
        if (!autoLoop || !copyPhotos || cancelLoopRef.current) {
          keepGoing = false;
        } else {
          const remaining = currentResult.photosSummary?.remaining ?? 0;
          if (remaining <= 0 || (currentResult.photosSummary?.copied === 0 && (currentResult.photosSummary?.failed ?? 0) > 0)) {
            keepGoing = false;
          } else {
            // Update progress and wait 600ms before triggering next batch
            setProgress({
              step: 'LOOP_NEXT',
              percent: Math.min(95, Math.round(((scanResult?.alreadyInBackupPhotos || 0) + cumulativeCopied) / Math.max(1, (scanResult?.totalSourcePhotos || 1000)) * 100)),
              detail: `Batch #${loopIteration} selesai (${currentResult.photosSummary?.copied || 0} foto). Menyiapkan batch berikutnya (${remaining} tersisa)...`
            });
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
      }

      if (finalResult) {
        // Adjust final photosSummary to reflect cumulative total copied this session
        if (loopIteration > 1) {
          finalResult = {
            ...finalResult,
            photosSummary: {
              ...finalResult.photosSummary,
              copied: cumulativeCopied
            }
          };
        }
        setExecutionResult(finalResult);
      }

      const cancelNote = cancelLoopRef.current ? ' (Dihentikan oleh pengguna)' : '';
      setSuccessMessage(`Proses backup ke Google Drive cadangan selesai!${cancelNote}`);
      setHistory(getBackupHistory());
      // Refresh scan data
      handleScan().catch(() => {});
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal menjalankan proses backup ke Google Drive cadangan.');
    } finally {
      setIsExecuting(false);
      cancelLoopRef.current = false;
    }
  };

  const lastBackup = history.length > 0 ? history[0] : null;

  const handleClose = () => {
    if (!isExecuting) {
      setIsModalOpen(false);
      onClose?.();
    } else {
      if (confirm('Proses pencadangan sedang berjalan. Tutup tampilan form modal? (Pencadangan akan tetap berjalan sampai selesai di latar belakang)')) {
        setIsModalOpen(false);
        onClose?.();
      }
    }
  };

  return (
    <>
      {/* Simple Clickable Administrator Card */}
      {!hideCardPreview && (
        <div
          id="admin-backup-card"
          onClick={() => setIsModalOpen(true)}
          className="p-4 sm:p-5 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/50 shadow-md hover:shadow-lg hover:border-emerald-400 transition-all cursor-pointer group flex items-center justify-between gap-4 select-none"
          title="Klik untuk membuka Form Detail Backup Database"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-200 group-hover:scale-105 transition-transform">
              <HardDriveDownload className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold text-slate-900 text-sm sm:text-base group-hover:text-emerald-700 transition-colors">
                  Kartu Backup Database
                </h3>
                <span className="text-[9px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300/60 uppercase flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-700" />
                  Fitur Administrator
                </span>
                {isExecuting ? (
                  <span className="text-[9px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300 animate-pulse flex items-center gap-1">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    Sedang Berjalan...
                  </span>
                ) : lastBackup ? (
                  <span className="text-[9px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                    Terakhir: {formatBackupTimestamp(lastBackup.timestamp)}
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium mt-0.5">
                Cadangkan berkas master Google Sheet & foto bukti transaksi ke Google Drive cadangan secara aman.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline-block text-xs font-semibold text-emerald-700 group-hover:text-emerald-900 transition-colors">
              Buka Form Backup
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center shrink-0 group-hover:translate-x-1 group-hover:bg-emerald-600 group-hover:text-white transition-all font-bold text-xs">
              &rarr;
            </div>
          </div>
        </div>
      )}

      {/* Modal Detail Backup Database */}
      {isModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isExecuting) {
              handleClose();
            }
          }}
        >
          <div
            className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
            id="admin-backup-modal"
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 via-white to-teal-50/60 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-emerald-200">
                  <HardDriveDownload className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-bold text-slate-900 text-base">
                      Form Backup Database
                    </h3>
                    <span className="text-[9px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300 uppercase flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-700" />
                      Google Drive Cadangan
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Menyalin master Google Sheet & berkas foto bukti ke Google Drive cadangan
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                title="Tutup Form Modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">

      {/* Target Drive Cadangan Information */}
      <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">ID Folder Cadangan:</span>
            <code className="bg-slate-100 px-2 py-0.5 rounded font-mono text-[11px] text-slate-800 font-semibold select-all">
              {BACKUP_TARGET_FOLDER_ID}
            </code>
            <button
              type="button"
              onClick={handleCopyFolderId}
              className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
              title="Salin ID Folder Cadangan"
            >
              {copiedFolderId ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Seluruh salinan Google Sheet dan foto-foto bukti akan ditempatkan di folder ini.
          </p>
        </div>

        {lastBackup && (
          <div className="text-right border-t sm:border-t-0 sm:border-l border-slate-100 pt-2 sm:pt-0 sm:pl-4">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">Backup Terakhir:</span>
            <span className="text-[11px] font-bold text-emerald-700 block">
              {formatBackupTimestamp(lastBackup.timestamp)}
            </span>
          </div>
        )}
      </div>

      {/* Backup Options Checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Option: Google Sheet */}
        <label
          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
            copySheet
              ? 'border-emerald-300 bg-emerald-50/40'
              : 'border-slate-200 bg-white hover:bg-slate-50'
          }`}
        >
          <input
            type="checkbox"
            checked={copySheet}
            onChange={(e) => setCopySheet(e.target.checked)}
            disabled={isExecuting}
            className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
          />
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span className="font-bold text-slate-800 text-xs">Salin Master Google Sheet</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Menyalin Google Sheet master lengkap dengan seluruh tabel. Tautan foto di sheet cadangan otomatis dialihkan langsung ke berkas di Google Drive cadangan.
            </p>
          </div>
        </label>

        {/* Option: Photos */}
        <label
          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
            copyPhotos
              ? 'border-emerald-300 bg-emerald-50/40'
              : 'border-slate-200 bg-white hover:bg-slate-50'
          }`}
        >
          <input
            type="checkbox"
            checked={copyPhotos}
            onChange={(e) => setCopyPhotos(e.target.checked)}
            disabled={isExecuting}
            className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
          />
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-teal-600" />
              <span className="font-bold text-slate-800 text-xs">Salin Berkas Foto Bukti</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Menyalin seluruh foto nota pengeluaran, bukti transfer, dan kegiatan ke folder cadangan (hanya menyalin foto baru yang belum ada).
            </p>
          </div>
        </label>
      </div>

      {/* Auto-loop & batching controls when copying photos */}
      {copyPhotos && (
        <div className="p-3 bg-slate-50/90 border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-fade-in">
          <label className="flex items-center gap-2 cursor-pointer text-slate-700 font-medium">
            <input
              type="checkbox"
              checked={autoLoop}
              onChange={(e) => setAutoLoop(e.target.checked)}
              disabled={isExecuting}
              className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
            />
            <span className="text-[11px] sm:text-xs">
              <strong>Salin Otomatis Sampai Selesai</strong> (Lanjut batch secara otomatis)
            </span>
          </label>

          <div className="flex items-center gap-2 text-[11px] text-slate-500 self-start sm:self-auto">
            <span>Per batch:</span>
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              disabled={isExecuting}
              aria-label="Ukuran batch penyalinan foto"
              className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-slate-800 font-bold focus:outline-hidden focus:ring-1 focus:ring-emerald-500 text-xs"
            >
              <option value={50}>50 foto</option>
              <option value={100}>100 foto</option>
              <option value={150}>150 foto</option>
            </select>
          </div>
        </div>
      )}

      {/* Scan preview stats if scanned */}
      {scanResult && (
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2 animate-fade-in">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <FolderSync className="w-4 h-4 text-slate-600" />
              Hasil Pemindaian Google Drive:
            </span>
            <span className="text-[10px] font-bold text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded">
              {scanResult.targetFolderName}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            <div className="bg-white p-2.5 rounded-lg border border-slate-200/60 relative overflow-hidden">
              <span className="text-[10px] text-slate-400 block uppercase font-bold">Google Sheet:</span>
              <span className="text-xs font-bold text-slate-800 truncate block mt-0.5">
                {scanResult.spreadsheetName || 'Operasional Perusahaan DB'}
              </span>

              {isExecuting ? (
                <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex flex-col gap-0.5 animate-fade-in">
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-tight">
                      {progress?.step === 'UPDATE_LINKS' ? 'Penyelarasan Link:' : 'Menyalin Foto:'}
                    </span>
                  </div>
                  <span
                    className="text-[10px] font-semibold text-slate-700 font-mono truncate block bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200"
                    title={getActivePhotoName(progress?.detail) || progress?.detail || 'Memproses berkas...'}
                  >
                    {getActivePhotoName(progress?.detail) || (progress?.step === 'UPDATE_LINKS' ? 'Menyelaraskan link...' : 'Memproses berkas...')}
                  </span>
                </div>
              ) : (
                <div className="mt-1.5 pt-1 border-t border-slate-100 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-[10px] text-slate-500 font-medium truncate block">
                    Status: Siap Diselaraskan
                  </span>
                </div>
              )}
            </div>

            <div className="bg-white p-2.5 rounded-lg border border-slate-200/60">
              <span className="text-[10px] text-slate-400 block uppercase font-bold">Total Foto Master:</span>
              <span className="text-xs font-bold text-slate-800 block mt-0.5">
                {scanResult.totalSourcePhotos} berkas
              </span>
            </div>

            <div className="bg-white p-2.5 rounded-lg border border-slate-200/60">
              <span className="text-[10px] text-slate-400 block uppercase font-bold">Sudah di Cadangan:</span>
              <span className="text-xs font-bold text-emerald-700 block mt-0.5">
                {scanResult.alreadyInBackupPhotos} berkas
              </span>
            </div>

            <div className="bg-white p-2.5 rounded-lg border border-slate-200/60">
              <span className="text-[10px] text-slate-400 block uppercase font-bold">Akan Disalin:</span>
              <span className="text-xs font-bold text-blue-700 block mt-0.5">
                {scanResult.newPhotosToCopy} berkas baru
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Real-time Progress Bar when executing */}
      {isExecuting && progress && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2 animate-fade-in">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-emerald-900 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>Memproses Cadangan Database...</span>
            </span>
            <span className="font-mono font-bold text-emerald-800">{progress.percent}%</span>
          </div>

          <div className="w-full bg-emerald-200/60 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-emerald-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>

          <p className="text-[11px] font-medium text-emerald-700 leading-snug">
            {progress.detail}
          </p>
        </div>
      )}

      {/* Success alert with direct link to copied sheet */}
      {successMessage && executionResult && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl space-y-3 animate-fade-in">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-bold text-emerald-900">{successMessage}</h4>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                Waktu: {formatBackupTimestamp(executionResult.timestamp)}
              </p>
            </div>
          </div>

          {executionResult.copiedSheet && (
            <div className="bg-white p-3 rounded-lg border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-bold">Salinan Google Sheet:</span>
                  <span className="text-xs font-bold text-slate-800">{executionResult.copiedSheet.name}</span>
                </div>
              </div>
              {executionResult.copiedSheet.webViewLink && (
                <a
                  href={executionResult.copiedSheet.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-colors self-start sm:self-center shadow-xs"
                >
                  <span>Buka Sheet Cadangan</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {executionResult.photosSummary && (
            <div className="space-y-2">
              <div className="text-[11px] text-emerald-800 font-medium bg-emerald-100/50 p-2.5 rounded-lg border border-emerald-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span>
                  Ringkasan Foto: {executionResult.photosSummary.copied} foto baru disalin,{' '}
                  {executionResult.photosSummary.alreadyPresent} foto sudah ada sebelumnya
                  {executionResult.photosSummary.failed > 0 && `, ${executionResult.photosSummary.failed} gagal`}
                  {executionResult.photosSummary.remaining !== undefined && executionResult.photosSummary.remaining > 0 && (
                    <strong className="text-amber-800 ml-1">
                      (Tersisa {executionResult.photosSummary.remaining} foto antrean berikutnya)
                    </strong>
                  )}
                  .
                </span>

                {executionResult.photosSummary.remaining !== undefined && executionResult.photosSummary.remaining > 0 && (
                  <button
                    type="button"
                    onClick={handleExecuteBackup}
                    disabled={isExecuting}
                    className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shrink-0 transition-colors shadow-xs cursor-pointer"
                  >
                    Salin Batch Berikutnya &rarr;
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error alert */}
      {errorMessage && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start gap-2.5 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block">{errorMessage}</span>
            <p className="text-[11px] text-rose-600">
              Catatan: Pastikan folder Google Drive cadangan (ID: {BACKUP_TARGET_FOLDER_ID}) telah dibagikan dengan akses Editor ke akun Google Anda atau Service Account.
            </p>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={handleScan}
          disabled={isScanning || isExecuting}
          className="py-2.5 px-4 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 shadow-xs"
          id="btn-admin-scan-backup"
        >
          {isScanning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
              <span>Memindai Google Drive...</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 text-slate-600" />
              <span>Pindai File (Scan)</span>
            </>
          )}
        </button>

        <div className="flex items-center gap-2">
          {isExecuting && autoLoop && (
            <button
              type="button"
              onClick={handleCancelBackup}
              className="py-2.5 px-4 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
              title="Hentikan penyalinan setelah batch saat ini selesai"
            >
              <Square className="w-3.5 h-3.5 fill-amber-700 text-amber-700" />
              <span>Hentikan Proses</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExecuteBackup}
            disabled={isExecuting || (!copySheet && !copyPhotos)}
            className="w-full sm:w-auto py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 shadow-md shadow-emerald-200"
            id="btn-admin-mulai-backup"
          >
            {isExecuting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Sedang Menyalin Data...</span>
              </>
            ) : (
              <>
                <HardDriveDownload className="w-4 h-4" />
                <span>{autoLoop && copyPhotos ? 'Salin Semua ke Drive Cadangan' : 'Mulai Salin ke Drive Cadangan'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Collapsible History Section */}
      {history.length > 0 && (
        <div className="pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center justify-between w-full text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors py-1 cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <span>Riwayat Cadangan Sebelumnya ({history.length})</span>
            </span>
            {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showHistory && (
            <div className="mt-3 space-y-2 max-h-60 overflow-y-auto pr-1">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-white rounded-xl border border-slate-200/80 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800">
                        {formatBackupTimestamp(item.timestamp)}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-2 py-0.2 rounded-full ${
                          item.status === 'SUCCESS'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : item.status === 'PARTIAL'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Oleh: <span className="font-medium text-slate-700">{item.adminEmail}</span>
                      {item.copiedPhotosCount !== undefined && ` • ${item.copiedPhotosCount} foto disalin`}
                    </p>
                  </div>

                  {item.copiedSheetLink && (
                    <a
                      href={item.copiedSheetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold flex items-center gap-1 self-start sm:self-center transition-colors"
                    >
                      <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
                      <span>Buka Sheet</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

              {/* Helpful Permissions Notice */}
              <div className="flex items-start gap-2 text-[11px] text-slate-400 pt-1">
                <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <span>
                  Data dicadangkan ke Google Drive cadangan tanpa mengubah atau menghapus data asli di Google Sheets utama.
                </span>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
