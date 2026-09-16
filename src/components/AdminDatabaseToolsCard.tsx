import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Database,
  HardDriveDownload,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Loader2,
  Copy,
  Check,
  FolderOpen,
  FileSpreadsheet,
  ShieldCheck,
  AlertTriangle,
  Info,
  X,
  Server
} from 'lucide-react';
import { AdminBackupCard } from './AdminBackupCard';
import {
  getBackupHistory,
  formatBackupTimestamp,
  BackupHistoryItem,
  BACKUP_TARGET_FOLDER_ID
} from '../lib/driveBackup';
import {
  SPREADSHEET_ID,
  DRIVE_FOLDER_ID,
  fetchGlobalConfig,
  updateGlobalConfig,
  GlobalAppConfigResponse
} from '../lib/googleApi';

interface AdminDatabaseToolsCardProps {
  token?: string | null;
  spreadsheetId?: string | null;
  driveFolderId?: string | null;
  adminEmail?: string;
  onConfigUpdated?: (newSheetId: string, newFolderId: string) => void;
}

export const AdminDatabaseToolsCard: React.FC<AdminDatabaseToolsCardProps> = ({
  token,
  spreadsheetId,
  driveFolderId,
  adminEmail = 'admin@depotel.co.id',
  onConfigUpdated
}) => {
  // Modal States
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isSwitchModalOpen, setIsSwitchModalOpen] = useState(false);

  // Server Config State
  const [serverConfig, setServerConfig] = useState<GlobalAppConfigResponse | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  // Switch Database Form States
  const [newSheetId, setNewSheetId] = useState('');
  const [newFolderId, setNewFolderId] = useState('');
  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [selectedBackupItem, setSelectedBackupItem] = useState<BackupHistoryItem | null>(null);

  // Status & Modal States
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchSuccess, setSwitchSuccess] = useState<string | null>(null);
  const [copiedSheetId, setCopiedSheetId] = useState(false);
  const [copiedFolderId, setCopiedFolderId] = useState(false);

  // Fetch active server config and backup history
  const loadConfig = async () => {
    setIsLoadingConfig(true);
    try {
      const cfg = await fetchGlobalConfig();
      setServerConfig(cfg);
    } catch (err) {
      console.warn('Gagal memuat konfigurasi server:', err);
    } finally {
      setIsLoadingConfig(false);
    }
  };

  useEffect(() => {
    loadConfig();
    setHistory(getBackupHistory());
  }, []);

  const currentActiveSheet = serverConfig?.spreadsheetId || spreadsheetId || SPREADSHEET_ID;
  const currentActiveFolder = serverConfig?.driveFolderId || driveFolderId || DRIVE_FOLDER_ID;

  const handleCopySheetId = () => {
    navigator.clipboard.writeText(currentActiveSheet);
    setCopiedSheetId(true);
    setTimeout(() => setCopiedSheetId(false), 2000);
  };

  const handleCopyFolderId = () => {
    navigator.clipboard.writeText(currentActiveFolder);
    setCopiedFolderId(true);
    setTimeout(() => setCopiedFolderId(false), 2000);
  };

  const handleSelectBackupHistory = (item: BackupHistoryItem) => {
    setSelectedBackupItem(item);
    if (item.copiedSheetId) {
      setNewSheetId(item.copiedSheetId);
    }
    if (item.backupFolderId) {
      setNewFolderId(item.backupFolderId);
    }
    setSwitchError(null);
  };

  const handleOpenConfirmModal = () => {
    setSwitchError(null);
    setSwitchSuccess(null);

    const targetSheet = newSheetId.trim();
    const targetFolder = newFolderId.trim() || currentActiveFolder;

    if (!targetSheet) {
      setSwitchError('ID Google Sheet Baru wajib diisi atau dipilih dari riwayat backup.');
      return;
    }

    if (targetSheet === currentActiveSheet && targetFolder === currentActiveFolder) {
      setSwitchError('ID Google Sheet dan Folder yang dimasukkan sama dengan database aktif saat ini.');
      return;
    }

    setIsConfirmModalOpen(true);
  };

  const handleExecuteSwitch = async () => {
    const targetSheet = newSheetId.trim();
    const targetFolder = newFolderId.trim() || currentActiveFolder;

    if (!token) {
      setSwitchError('Sesi Google Auth tidak ditemukan. Silakan login ulang.');
      setIsConfirmModalOpen(false);
      return;
    }

    setIsSubmitting(true);
    setSwitchError(null);

    try {
      // Execute global update (includes schema check on target Google Sheet)
      const res = await updateGlobalConfig(token, targetSheet, targetFolder, adminEmail);

      setServerConfig(res);
      setSwitchSuccess(
        `Database Utama berhasil dialihkan secara GLOBAL! Seluruh pengguna kini terhubung ke ID Google Sheet: ${res.spreadsheetId}`
      );
      setIsConfirmModalOpen(false);

      // Notify parent App component to update local states
      if (onConfigUpdated) {
        onConfigUpdated(res.spreadsheetId, res.driveFolderId);
      }
    } catch (err: any) {
      console.error('Error switching database:', err);
      setSwitchError(err.message || 'Gagal mengalihkan Database Utama secara terpusat.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetToDefault = () => {
    setNewSheetId(SPREADSHEET_ID);
    setNewFolderId(DRIVE_FOLDER_ID);
    setSelectedBackupItem(null);
    setSwitchError(null);
  };

  return (
    <div
      className="p-5 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50/90 via-white to-emerald-50/30 shadow-md hover:shadow-lg transition-all w-full"
      id="admin-tools-database-card"
    >
      {/* Header Container */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-200">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display font-bold text-slate-900 text-base">
                Tools Database
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Kelola cadangan data Google Drive & pengalihan database aktif secara terpusat.
            </p>
          </div>
        </div>

        {/* Clickable Badge Navigation (disusun vertikal rata kanan) */}
        <div className="flex flex-col items-end gap-2 shrink-0 sm:ml-auto">
          <button
            type="button"
            onClick={() => setIsBackupModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border border-emerald-300/80 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 shadow-2xs"
            id="badge-tools-db-backup"
          >
            <HardDriveDownload className="w-3.5 h-3.5" />
            <span>Backup Database</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSwitchModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer border border-emerald-300/80 bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 shadow-2xs"
            id="badge-tools-db-switch"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>Switch Database</span>
          </button>
        </div>
      </div>

      {/* Form Modal Backup Database */}
      <AdminBackupCard
        token={token}
        spreadsheetId={currentActiveSheet}
        driveFolderId={currentActiveFolder}
        adminEmail={adminEmail}
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        hideCardPreview={true}
      />

      {/* Form Modal Switch Database */}
      {isSwitchModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-fade-in"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isSubmitting) {
                setIsSwitchModalOpen(false);
              }
            }}
          >
            <div
              className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] my-auto animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
              id="modal-switch-database"
            >
              {/* Modal Header */}
              <div className="p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 via-white to-teal-50/60 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-emerald-200">
                    <ArrowRightLeft className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-bold text-slate-900 text-base">
                        Form Switch Database
                      </h3>
                      <span className="text-[9px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300 uppercase flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-700" />
                        Pengalihan Terpusat
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Pengalihan Database Utama & Folder Google Drive secara global untuk seluruh pengguna
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => !isSubmitting && setIsSwitchModalOpen(false)}
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  title="Tutup Form Modal"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Body Scrollable */}
              <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs">
                {/* Active Server Configuration Info Card */}
                <div className="p-4 rounded-xl border border-emerald-200/80 bg-emerald-50/50 flex flex-col gap-3 w-full">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1 rounded-full border border-emerald-300/80 shadow-2xs">
                        <Server className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Database Utama Aktif Saat Ini (Server Terpusat)</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-300">
                      <ShieldCheck className="w-3 h-3" />
                      <span>GLOBAL SINKRON</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
                    {/* Google Sheet Active */}
                    <div className="bg-white p-3 rounded-lg border border-slate-200/80 flex flex-col justify-between gap-2">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase text-slate-400">Google Sheet ID:</span>
                          <button
                            onClick={handleCopySheetId}
                            className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                          >
                            {copiedSheetId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedSheetId ? 'Tersalin' : 'Salin ID'}</span>
                          </button>
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-800 truncate block mt-0.5" title={currentActiveSheet}>
                          {currentActiveSheet}
                        </span>
                      </div>
                      <a
                        href={`https://docs.google.com/spreadsheets/d/${currentActiveSheet}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 hover:underline pt-1"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>Buka Google Sheet Utama</span>
                        <ExternalLink className="w-3 h-3 ml-auto" />
                      </a>
                    </div>

                    {/* Google Drive Folder Active */}
                    <div className="bg-white p-3 rounded-lg border border-slate-200/80 flex flex-col justify-between gap-2">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase text-slate-400">Folder Google Drive ID:</span>
                          <button
                            onClick={handleCopyFolderId}
                            className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                          >
                            {copiedFolderId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedFolderId ? 'Tersalin' : 'Salin ID'}</span>
                          </button>
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-800 truncate block mt-0.5" title={currentActiveFolder}>
                          {currentActiveFolder}
                        </span>
                      </div>
                      <a
                        href={`https://drive.google.com/drive/folders/${currentActiveFolder}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 hover:underline pt-1"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Buka Folder Google Drive Utama</span>
                        <ExternalLink className="w-3 h-3 ml-auto" />
                      </a>
                    </div>
                  </div>

                  {serverConfig?.updatedAt && (
                    <p className="text-[10px] text-slate-500 flex items-center gap-1 italic">
                      <Info className="w-3 h-3 text-slate-400 shrink-0" />
                      <span>
                        Terakhir diperbarui: {formatBackupTimestamp(serverConfig.updatedAt)} oleh {serverConfig.updatedBy || 'ADMIN'}
                      </span>
                    </p>
                  )}
                </div>

                {/* Form Switch Database */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col gap-4">
                  <div className="border-b border-slate-100 pb-2">
                    <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wide flex items-center gap-1.5">
                      <ArrowRightLeft className="w-4 h-4 text-emerald-600" />
                      Form Pengalihan Database Utama
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Pilih dari riwayat backup sebelumnya atau masukkan ID Google Sheet & Folder baru.
                    </p>
                  </div>

                  {/* Error / Success Notifications */}
                  {switchError && (
                    <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-bold block">Gagal Mengalihkan Database:</span>
                        <span>{switchError}</span>
                      </div>
                    </div>
                  )}

                  {switchSuccess && (
                    <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-bold block">Pengalihan Berhasil:</span>
                        <span>{switchSuccess}</span>
                      </div>
                    </div>
                  )}

                  {/* Opsi A: Pilih dari Riwayat Backup */}
                  {history.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                        <span>PILIH DARI RIWAYAT BACKUP TERSEDIA ({history.length}):</span>
                        {selectedBackupItem && (
                          <button
                            onClick={() => setSelectedBackupItem(null)}
                            className="text-[10px] text-rose-600 hover:underline cursor-pointer font-normal"
                          >
                            Batal Pilih Backup
                          </button>
                        )}
                      </label>

                      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 border border-slate-200 rounded-lg p-2 bg-slate-50/50">
                        {history.map((item) => {
                          const isSelected = selectedBackupItem?.id === item.id;

                          return (
                            <div
                              key={item.id}
                              onClick={() => handleSelectBackupHistory(item)}
                              className={`p-2.5 rounded-lg border text-xs transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                isSelected
                                  ? 'bg-emerald-50 border-emerald-400 ring-1 ring-emerald-400'
                                  : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-slate-800 text-xs truncate">
                                    {item.copiedSheetName || 'Backup Google Sheet'}
                                  </span>
                                  <span className="text-[9px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border">
                                    {formatBackupTimestamp(item.timestamp)}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                                  Folder Drive Cadangan ID: {item.backupFolderId}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSelectBackupHistory(item);
                                }}
                                className={`px-2.5 py-1 rounded text-[10px] font-bold shrink-0 transition-all cursor-pointer ${
                                  isSelected
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-slate-100 text-slate-700 hover:bg-emerald-100 hover:text-emerald-800'
                                }`}
                              >
                                {isSelected ? 'Terpilih' : 'Gunakan Backup Ini'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Opsi B: Input Manual ID Sheet & Folder */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        ID Google Sheet Utama Baru: <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={newSheetId}
                        onChange={(e) => {
                          setNewSheetId(e.target.value);
                          setSwitchError(null);
                        }}
                        placeholder="Contoh: 1_XLMT5VIqctS1EyPlhHs0JzggzT39RZ2"
                        className="w-full text-xs font-mono p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Pastikan Sheet memiliki tab-tab dasar (akan diverifikasi otomatis).
                      </span>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        ID Folder Google Drive Utama Baru:
                      </label>
                      <input
                        type="text"
                        value={newFolderId}
                        onChange={(e) => {
                          setNewFolderId(e.target.value);
                          setSwitchError(null);
                        }}
                        placeholder="Contoh: 1RZHDhcGEdrEu1S1OJh24Za1qkxfU-1kE"
                        className="w-full text-xs font-mono p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                      />
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        Folder untuk menyimpan foto bukti nota & kegiatan operasional.
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 flex-wrap">
                    <button
                      type="button"
                      onClick={handleResetToDefault}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 underline cursor-pointer"
                    >
                      Reset ke ID Default Awal
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenConfirmModal}
                      disabled={isSubmitting || !newSheetId.trim()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      id="btn-admin-exec-switch-db"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Memverifikasi & Mengalihkan...</span>
                        </>
                      ) : (
                        <>
                          <ArrowRightLeft className="w-4 h-4" />
                          <span>Verifikasi & Alihkan Database Utama (Global)</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Modal Konfirmasi Keamanan Switch Database */}
      {isConfirmModalOpen &&
        createPortal(
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden flex flex-col"
              id="admin-switch-db-confirm-modal"
            >
              {/* Modal Header */}
              <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-4 text-white flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-100 shrink-0" />
                  <h3 className="font-bold text-sm">Konfirmasi Pengalihan Database Utama (Global)</h3>
                </div>
                <button
                  onClick={() => !isSubmitting && setIsConfirmModalOpen(false)}
                  disabled={isSubmitting}
                  className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-5 flex flex-col gap-4 text-slate-700 text-xs">
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">PERINGATAN SINKRONISASI SERVER GLOBAL:</span>
                    <span>
                      Aksi ini akan mengganti ID Google Sheet dan Folder Drive Utama untuk **SELURUH PENGGUNA** (Manager, Finance, Direktur, Staff) di server secara terpusat.
                    </span>
                  </div>
                </div>

                <div className="space-y-2 border border-slate-200 rounded-xl p-3 bg-slate-50">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Google Sheet ID Lama:</span>
                    <span className="font-mono text-[11px] text-slate-600 truncate">{currentActiveSheet}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-1.5 flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-bold text-emerald-700">Google Sheet ID Baru (Akan Aktif):</span>
                    <span className="font-mono text-xs font-bold text-emerald-800 truncate">{newSheetId.trim()}</span>
                  </div>

                  <div className="border-t border-slate-200 pt-1.5 flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-bold text-emerald-700">Folder Google Drive ID (Akan Aktif):</span>
                    <span className="font-mono text-xs font-bold text-emerald-800 truncate">
                      {newFolderId.trim() || currentActiveFolder}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500">
                  Sistem akan otomatis memverifikasi bahwa Google Sheet baru memiliki skema tab yang lengkap sebelum menyimpan pengalihan ini.
                </p>
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmModalOpen(false)}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-bold text-xs transition-all disabled:opacity-50 cursor-pointer"
                >
                  Batal
                </button>

                <button
                  type="button"
                  onClick={handleExecuteSwitch}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md shadow-amber-200 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Memverifikasi Skema & Mengalihkan...</span>
                    </>
                  ) : (
                    <>
                      <ArrowRightLeft className="w-4 h-4" />
                      <span>Ya, Alihkan Database Sekarang</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
