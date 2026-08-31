/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { UserProfile, Role, BudgetRequest, ResetDeviceLog, formatTimestamp } from '../types';
import { formatDivisiSubDivisi } from '../lib/googleApi';
import { User, Shield, Briefcase, Mail, Save, AlertCircle, Plus, Edit2, ArrowLeft, Search, Lock, Fuel, Smartphone, RotateCcw, CheckCircle2, History, FileSpreadsheet, Clock, Tag, Trash2, Loader2, RefreshCw } from 'lucide-react';

interface ProfileSetupProps {
  profiles: UserProfile[];
  requests: BudgetRequest[];
  resetDeviceLogs?: ResetDeviceLog[];
  onSave: (profile: UserProfile) => Promise<void>;
  onResetDeviceId?: (targetUser: UserProfile, reason: string) => Promise<void>;
  onPurgeOrphanHistories?: () => Promise<{ purgedCount: number; remainingCount: number } | null>;
  onClose: () => void;
}

export const ProfileSetup: React.FC<ProfileSetupProps> = ({
  profiles,
  requests,
  resetDeviceLogs = [],
  onSave,
  onResetDeviceId,
  onPurgeOrphanHistories,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'users' | 'reset-logs'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  
  const [editingProfile, setEditingProfile] = useState<UserProfile | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  // Form states
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('123456');
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(Role.USER);
  const [managerEmail, setManagerEmail] = useState('');
  const [divisi, setDivisi] = useState('');
  const [subDivisi, setSubDivisi] = useState('');
  const [aksesBBM, setAksesBBM] = useState<boolean>(false);
  const [mobile, setMobile] = useState<boolean>(false);
  const [deviceId, setDeviceId] = useState<string>('');
  
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset Modal state
  const [resetModalUser, setResetModalUser] = useState<UserProfile | null>(null);
  const [resetReason, setResetReason] = useState<string>('User ganti perangkat HP baru');
  const [isResetting, setIsResetting] = useState<boolean>(false);

  // Orphan Data Cleanup state
  const [isPurging, setIsPurging] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);

  const handlePurgeOrphan = async () => {
    if (!onPurgeOrphanHistories) return;
    setIsPurging(true);
    setPurgeMsg(null);
    setError(null);
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
      setError(err.message || 'Gagal melakukan pembersihan orphan data.');
    } finally {
      setIsPurging(false);
    }
  };

  // Filter profiles based on search
  const filteredProfiles = profiles.filter(p => {
    const q = searchQuery.toLowerCase();
    return (
      (p.userId || '').toLowerCase().includes(q) ||
      (p.nama || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      (p.divisi || '').toLowerCase().includes(q) ||
      (p.subDivisi || '').toLowerCase().includes(q) ||
      p.role.toLowerCase().includes(q)
    );
  });

  // Filter reset logs based on search
  const filteredLogs = resetDeviceLogs.filter(log => {
    const q = logSearchQuery.toLowerCase();
    return (
      (log.targetUserNama || '').toLowerCase().includes(q) ||
      (log.targetUserEmail || '').toLowerCase().includes(q) ||
      (log.adminNama || '').toLowerCase().includes(q) ||
      (log.adminEmail || '').toLowerCase().includes(q) ||
      (log.oldDeviceId || '').toLowerCase().includes(q) ||
      (log.keterangan || '').toLowerCase().includes(q) ||
      (log.id || '').toLowerCase().includes(q)
    );
  });

  // Get list of manager emails for selection helper
  const managerEmails = Array.from(
    new Set(
      profiles
        .filter(p => p.role === Role.MANAGER || p.role === Role.DIREKTUR)
        .map(p => p.email)
        .filter(Boolean)
    )
  );

  const startEdit = (p: UserProfile) => {
    setEditingProfile(p);
    setIsAddingNew(false);
    setUserId(p.userId || '');
    setPassword(p.password || '123456');
    setNama(p.nama || '');
    setEmail(p.email);
    setRole(p.role);
    setManagerEmail(p.managerEmail || '');
    setDivisi(p.divisi || '');
    setSubDivisi(p.subDivisi || '');

    const isBbm = p.aksesBBM === true || String(p.aksesBBM).trim().toUpperCase() === 'TRUE' || String(p.aksesBBM).trim().toUpperCase() === 'YA' || String(p.aksesBBM).trim() === '1';
    const isMob = p.mobile === true || String(p.mobile).trim().toUpperCase() === 'TRUE' || String(p.mobile).trim().toUpperCase() === 'YA' || String(p.mobile).trim() === '1';

    setAksesBBM(isBbm);
    setMobile(isMob);
    setDeviceId(p.deviceId || '');
    setError(null);
    setSuccessMsg(null);
  };

  const startAdd = () => {
    setEditingProfile(null);
    setIsAddingNew(true);
    setUserId('');
    setPassword('123456');
    setNama('');
    setEmail('');
    setRole(Role.USER);
    setManagerEmail('');
    setDivisi('');
    setSubDivisi('');
    setAksesBBM(false);
    setMobile(false);
    setDeviceId('');
    setError(null);
    setSuccessMsg(null);
  };

  const cancelForm = () => {
    setEditingProfile(null);
    setIsAddingNew(false);
    setError(null);
  };

  const openResetModal = (p: UserProfile) => {
    setResetModalUser(p);
    setResetReason('User ganti perangkat HP baru');
    setError(null);
  };

  const handleConfirmResetDevice = async () => {
    if (!resetModalUser) return;
    if (!resetReason.trim()) {
      setError('Mohon isi alasan / keterangan reset Device ID.');
      return;
    }

    setIsResetting(true);
    setError(null);
    try {
      if (onResetDeviceId) {
        await onResetDeviceId(resetModalUser, resetReason.trim());
      } else {
        await onSave({
          ...resetModalUser,
          deviceId: ''
        });
      }

      if (editingProfile && editingProfile.email.toLowerCase() === resetModalUser.email.toLowerCase()) {
        setDeviceId('');
      }

      setSuccessMsg(`Device ID pengguna ${resetModalUser.nama || resetModalUser.email} berhasil di-reset dan tersimpan ke Sheet Google "ResetDeviceLog".`);
      setResetModalUser(null);
      setResetReason('User ganti perangkat HP baru');
    } catch (err: any) {
      setError(err.message || 'Gagal mereset Device ID.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!userId.trim()) {
      setError('User ID wajib diisi.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Format Email Pengguna tidak valid.');
      return;
    }
    if (!password.trim()) {
      setError('Password wajib diisi.');
      return;
    }

    if (role === Role.USER || role === Role.MANAGER || role === Role.FINANCE) {
      if (role === Role.USER && !managerEmail.trim()) {
        setError('Email Manager wajib diisi untuk role Staff/User.');
        return;
      }
      if (managerEmail.trim() && !managerEmail.includes('@')) {
        setError('Format Email Approver tidak valid.');
        return;
      }
      if (managerEmail.trim() && managerEmail.toLowerCase() === email.toLowerCase()) {
        setError('Email Approver tidak boleh sama dengan email pengguna itu sendiri.');
        return;
      }
    }

    setIsSaving(true);
    try {
      await onSave({
        userId: userId.trim().toLowerCase(),
        password: password.trim(),
        nama: nama.trim(),
        email: email.trim(),
        role,
        managerEmail: (role === Role.USER || role === Role.MANAGER || role === Role.FINANCE) ? managerEmail.trim() : '',
        divisi: divisi.trim().toUpperCase(),
        subDivisi: subDivisi.trim().toUpperCase(),
        aksesBBM,
        mobile,
        deviceId: mobile ? deviceId.trim() : ''
      });
      setSuccessMsg(`Data pengguna ${nama || userId} berhasil disimpan!`);
      setEditingProfile(null);
      setIsAddingNew(false);
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan data pengguna.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 animate-slide-up relative">
      {/* Header section with back button */}
      <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-50 text-slate-500 hover:text-slate-700 rounded-xl transition-all cursor-pointer"
            title="Kembali ke Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="font-display font-bold text-slate-800 text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-600" />
              Kelola Pengguna (Administrator)
            </h2>
            <p className="text-[11px] text-slate-400">Atur akun, role, divisi, dan wewenang reset Device ID HP</p>
          </div>
        </div>

        {!isAddingNew && !editingProfile && activeTab === 'users' && (
          <button
            onClick={startAdd}
            className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah User</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      {!isAddingNew && !editingProfile && (
        <div className="flex items-center gap-2 mb-4 bg-slate-50 p-1 rounded-xl border border-slate-150">
          <button
            onClick={() => { setActiveTab('users'); setError(null); }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'users'
                ? 'bg-white text-indigo-600 shadow-xs border border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Daftar User ({profiles.length})</span>
          </button>

          <button
            onClick={() => { setActiveTab('reset-logs'); setError(null); }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'reset-logs'
                ? 'bg-white text-indigo-600 shadow-xs border border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <History className="w-3.5 h-3.5 text-amber-600" />
            <span>Riwayat Reset Device ID</span>
            {resetDeviceLogs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 text-[10px] bg-amber-100 text-amber-800 rounded-full font-mono">
                {resetDeviceLogs.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Success Notification */}
      {successMsg && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 text-xs flex items-start gap-2.5 animate-slide-up">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span className="font-medium leading-relaxed">{successMsg}</span>
        </div>
      )}

      {/* Error Notification */}
      {error && !resetModalUser && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-xs flex items-start gap-2 animate-slide-up">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <span className="font-medium leading-relaxed">{error}</span>
        </div>
      )}

      {/* Main layout routing: Add/Edit Form vs List View vs Reset Logs Tab */}
      {isAddingNew || editingProfile ? (
        <form onSubmit={handleSubmit} className="space-y-4 animate-slide-up">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            {editingProfile ? `Edit Pengguna: ${editingProfile.userId}` : 'Tambah Pengguna Baru'}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* User ID */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">User ID (Username Login)</label>
              <div className="relative">
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="contoh: joko"
                  disabled={!!editingProfile}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Nama Lengkap */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Nama Lengkap</label>
              <div className="relative">
                <input
                  type="text"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  placeholder="contoh: Joko Susilo"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                  required
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Email Pengguna */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Email Pengguna</label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contoh: joko@company.com"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                  required
                />
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Password Login</label>
              <div className="relative">
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="123456"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none font-mono"
                  required
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Role */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Role / Peran</label>
              <div className="relative">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none appearance-none"
                >
                  <option value={Role.USER}>STAFF / USER</option>
                  <option value={Role.MANAGER}>MANAGER</option>
                  <option value={Role.FINANCE}>FINANCE (ADMIN KEUANGAN)</option>
                  <option value={Role.DIREKTUR}>DIREKTUR</option>
                  <option value={Role.ADMINISTRATOR}>ADMINISTRATOR SYSTEM</option>
                </select>
                <Shield className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              </div>
            </div>

            {/* Divisi */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Divisi / Departemen</label>
              <div className="relative">
                <input
                  type="text"
                  value={divisi}
                  onChange={(e) => setDivisi(e.target.value)}
                  placeholder="contoh: OPERASIONAL / LOGISTIK / IT"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none uppercase"
                />
                <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* SubDivisi */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">SubDivisi (Opsional)</label>
              <div className="relative">
                <input
                  type="text"
                  value={subDivisi}
                  onChange={(e) => setSubDivisi(e.target.value)}
                  placeholder="contoh: TIM A / CABANG 1"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none uppercase"
                />
                <Tag className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Email Manager / Direktur (For Staff/User, Manager, Finance) */}
            {(role === Role.USER || role === Role.MANAGER || role === Role.FINANCE) && (
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  {role === Role.USER ? 'Email Manager Atasan' : 'Email Direktur (Approver)'} {role === Role.USER && <span className="text-red-500">*</span>}
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={managerEmail}
                    onChange={(e) => setManagerEmail(e.target.value)}
                    placeholder={role === Role.USER ? "Pilih atau ketik email manager..." : "Pilih atau ketik email direktur..."}
                    list="manager-options"
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                    required={role === Role.USER}
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <datalist id="manager-options">
                    {managerEmails.map(m => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  {role === Role.USER
                    ? 'Pengajuan anggaran dari user ini akan diteruskan ke email Manager di atas untuk diapprove.'
                    : 'Pengajuan anggaran dan review laporan Manager/Finance akan diteruskan ke email Direktur di atas untuk diapprove.'}
                </p>
              </div>
            )}
          </div>

          {/* Special Permissions Checkboxes */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <label className="block text-xs font-semibold text-slate-500">Izin Akses Khusus</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-start gap-2.5 p-2.5 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100/60 transition-all">
                <input
                  type="checkbox"
                  checked={aksesBBM}
                  onChange={(e) => setAksesBBM(e.target.checked)}
                  className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Fuel className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Pengisian BBM Duren Sawit</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-normal mt-0.5">
                    Berikan hak akses untuk pengisian BBM di lokasi Duren Sawit.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2.5 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100/60 transition-all">
                <input
                  type="checkbox"
                  checked={mobile}
                  onChange={(e) => setMobile(e.target.checked)}
                  className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Smartphone className="w-3.5 h-3.5 text-purple-600" />
                    <span>Akses Khusus Perangkat Mobile</span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-normal mt-0.5">
                    Mewajibkan login terikat dengan Device ID HP pengguna.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Device ID Field & Reset */}
          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Device ID Terikat (Mobile)
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  placeholder="Kosong = Belum ada perangkat terikat"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none font-mono text-slate-700"
                />
                <Smartphone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
              {deviceId && (
                <button
                  type="button"
                  onClick={() => editingProfile ? openResetModal(editingProfile) : setDeviceId('')}
                  className="py-2 px-3 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer shrink-0"
                  title="Reset Device ID agar pengguna dapat mendaftarkan HP baru saat login"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Device ID</span>
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Device ID akan otomatis terisi saat user login pertama kali dari HP. Tekan Reset jika user ganti HP.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={cancelForm}
              className="flex-1 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold text-xs rounded-xl transition-all cursor-pointer text-center"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md disabled:bg-slate-300 transition-all cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan User'}</span>
            </button>
          </div>
        </form>
      ) : activeTab === 'reset-logs' ? (
        /* Tab 2: Reset Device ID Logs */
        <div className="space-y-3.5 animate-slide-up">
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2.5">
            <FileSpreadsheet className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Pencatatan Otomatis Google Sheets (Sheet: ResetDeviceLog)</p>
              <p className="text-[11px] text-amber-800/90 mt-0.5">
                Setiap kali Administrator me-reset Device ID pengguna, riwayat tindakan ini secara otomatis tersimpan permanen di sheet <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-[10px]">ResetDeviceLog</code>.
              </p>
            </div>
          </div>

          {/* Maintenance / Orphan Data Cleanup Banner */}
          {onPurgeOrphanHistories && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Trash2 className="w-4 h-4 text-rose-500" />
                    <span>Pembersihan Orphan Data (ItemReviewHistory)</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Hapus baris riwayat review yang tidak memiliki referensi Pengajuan/Laporan valid.
                  </p>
                </div>
                {!showPurgeConfirm && (
                  <button
                    type="button"
                    onClick={() => { setPurgeMsg(null); setShowPurgeConfirm(true); }}
                    disabled={isPurging}
                    className="py-1.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    <span>Bersihkan Orphan Data</span>
                  </button>
                )}
              </div>

              {showPurgeConfirm && (
                <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 animate-fade-in">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span className="text-slate-700 font-medium">
                      Konfirmasi: Yakin ingin membersihkan data <code className="font-mono text-rose-700 font-bold">ItemReviewHistory</code> orphan?
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowPurgeConfirm(false)}
                      disabled={isPurging}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={handlePurgeOrphan}
                      disabled={isPurging}
                      className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isPurging ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Membersihkan...</span>
                        </>
                      ) : (
                        <span>Ya, Bersihkan Sekarang</span>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {purgeMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2 animate-fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{purgeMsg}</span>
            </div>
          )}

          {/* Search Box Log */}
          <div className="relative">
            <input
              type="text"
              placeholder="Cari riwayat reset berdasarkan user, admin, device ID, atau alasan..."
              value={logSearchQuery}
              onChange={(e) => setLogSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          {/* Logs List */}
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs space-y-1">
                <History className="w-6 h-6 mx-auto text-slate-300 mb-1" />
                <p className="font-semibold text-slate-600">Belum ada riwayat reset Device ID</p>
                <p className="text-[11px]">Riwayat reset oleh Administrator akan tampil di sini.</p>
              </div>
            ) : (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-all space-y-2"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                          {log.id}
                        </span>
                        <span className="font-bold text-xs text-slate-800">{log.targetUserNama}</span>
                        <span className="text-[10px] text-slate-400">({log.targetUserEmail})</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0 font-medium">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{formatTimestamp(log.timestamp)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Administrator yang Mereset</span>
                      <span className="font-semibold text-slate-700 block">{log.adminNama || log.adminEmail}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Device ID Lama</span>
                      <span className="font-mono text-[10px] text-slate-600 block truncate" title={log.oldDeviceId}>
                        {log.oldDeviceId || '-'}
                      </span>
                    </div>
                  </div>

                  {log.keterangan && (
                    <div className="pt-1.5 border-t border-slate-100">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Alasan / Keterangan Reset</span>
                      <p className="text-xs text-slate-700 font-medium italic bg-slate-50 p-2 rounded-lg border border-slate-100">
                        "{log.keterangan}"
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* List of Users with Search Filter */
        <div className="space-y-3.5 animate-slide-up">
          {/* Search Box */}
          <div className="relative">
            <input
              type="text"
              placeholder="Cari nama, email, divisi, atau role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          {/* Users List Grid */}
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {filteredProfiles.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                Tidak ada pengguna yang cocok dengan pencarian Anda.
              </div>
            ) : (
              filteredProfiles.map((p) => (
                <div
                  key={p.userId || p.email}
                  className="p-3.5 bg-white border border-slate-200 rounded-2xl hover:border-indigo-300 hover:shadow-xs transition-all space-y-3 relative text-left"
                >
                  {/* Top Section: Kiri atas foto profile, Samping kanan: [UserName], [UserID], [Role], [email] sejajar vertical */}
                  <div className="flex items-start gap-3">
                    {/* Kiri Atas Foto Profile (Ukuran +15% -> 52px) */}
                    {p.fotoProfile ? (
                      <img
                        src={p.fotoProfile}
                        alt={p.nama || 'User'}
                        className="w-[52px] h-[52px] rounded-xl object-cover border border-slate-200 shrink-0 shadow-2xs"
                        referrerPolicy="no-referrer"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-[52px] h-[52px] rounded-xl bg-indigo-50 border border-indigo-150 text-indigo-600 font-black text-base flex items-center justify-center shrink-0 shadow-2xs">
                        {p.nama ? p.nama.charAt(0).toUpperCase() : 'U'}
                      </div>
                    )}

                    {/* Samping Kanan Foto Profile: [UserName], [UserID], [Role], [email] sejajar vertical */}
                    <div className="flex flex-col items-start gap-0.5 flex-1 min-w-0 text-left">
                      {/* 1. [UserName] */}
                      <span className="font-extrabold text-xs text-slate-900 truncate max-w-full">
                        {p.nama || p.userId || 'No ID'}
                      </span>

                      {/* 2. [UserID] - sejajar di bawah UserName */}
                      {p.userId && (
                        <span className="text-[10px] text-slate-500 font-mono font-semibold truncate max-w-full">
                          User ID: <strong className="text-slate-700 font-bold">{p.userId}</strong>
                        </span>
                      )}

                      {/* 3. [Role] */}
                      <div className="mt-0.5">
                        <span className={`inline-block text-[9px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                          p.role === Role.ADMINISTRATOR
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : p.role === Role.FINANCE
                            ? 'bg-red-50 text-red-600 border border-red-100'
                            : p.role === Role.MANAGER
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                            : p.role === Role.DIREKTUR
                            ? 'bg-purple-50 text-purple-600 border border-purple-100'
                            : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                        }`}>
                          {p.role}
                        </span>
                      </div>

                      {/* 4. [email] */}
                      <p className="text-[11px] text-slate-500 font-mono font-medium truncate max-w-full mt-0.5">
                        {p.email}
                      </p>
                    </div>
                  </div>

                  {/* Middle Section: Divisi, Manager Email, Badges & Device ID */}
                  {(p.divisi || p.managerEmail || p.deviceId || p.aksesBBM || p.mobile) && (
                    <div className="pt-2 border-t border-slate-100/80 flex flex-wrap items-center gap-1.5 text-[10px]">
                      {p.divisi && (
                        <span className="text-[9px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200 uppercase font-mono">
                          Divisi: {formatDivisiSubDivisi(p.divisi, p.subDivisi)}
                        </span>
                      )}
                      {p.role === Role.USER && p.managerEmail && (
                        <span className="text-[9px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200 font-mono">
                          Manager: <strong className="text-slate-700">{p.managerEmail}</strong>
                        </span>
                      )}
                      {(p.aksesBBM === true || String(p.aksesBBM).trim().toUpperCase() === 'TRUE' || String(p.aksesBBM).trim().toUpperCase() === 'YA' || String(p.aksesBBM).trim() === '1') && (
                        <span className="text-[9px] font-bold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-md border border-amber-200/60 flex items-center gap-1">
                          <Fuel className="w-2.5 h-2.5 text-amber-600" />
                          BBM Duren Sawit
                        </span>
                      )}
                      {(p.mobile === true || String(p.mobile).trim().toUpperCase() === 'TRUE' || String(p.mobile).trim().toUpperCase() === 'YA' || String(p.mobile).trim() === '1') && (
                        <span className="text-[9px] font-bold bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-md border border-purple-200/60 flex items-center gap-1">
                          <Smartphone className="w-2.5 h-2.5 text-purple-600" />
                          Mobile Only
                        </span>
                      )}
                      {p.deviceId && (
                        <span className="text-[9px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200 font-mono truncate max-w-full">
                          Device ID: <strong className="text-slate-700">{p.deviceId}</strong>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Footer Section: Tombol Edit berada di kanan bawah (tanpa label Password) */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                    {p.deviceId && (
                      <button
                        onClick={() => openResetModal(p)}
                        className="py-1 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer shadow-2xs"
                        title="Reset Device ID user dan catat ke log"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset ID</span>
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(p)}
                      className="py-1 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                      title="Edit User"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal for Reset Device ID */}
      {resetModalUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-scale-up">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-800">Reset Device ID Pengguna</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Tindakan ini akan mengosongkan Device ID terikat dan mencatat riwayat ke Google Sheet <code className="font-mono text-indigo-600">ResetDeviceLog</code>.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-150 text-xs space-y-1 font-medium">
              <p className="text-slate-700 font-bold">{resetModalUser.nama || resetModalUser.userId}</p>
              <p className="text-slate-500 text-[11px]">Email: {resetModalUser.email}</p>
              <p className="text-slate-500 text-[11px] font-mono truncate">Device ID: {resetModalUser.deviceId || '-'}</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Alasan / Keterangan Reset <span className="text-red-500">*</span>
              </label>
              <textarea
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="misal: User ganti HP Android baru, HP lama hilang/rusak..."
                rows={3}
                className="w-full p-2.5 text-xs bg-white border border-slate-200 rounded-xl focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all outline-none resize-none"
                required
              />
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setResetModalUser(null); setError(null); }}
                className="flex-1 py-2 text-xs border border-slate-200 hover:bg-slate-50 font-bold text-slate-600 rounded-xl transition-all cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmResetDevice}
                disabled={isResetting}
                className="flex-1 py-2 text-xs bg-amber-600 hover:bg-amber-700 font-bold text-white rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
                <span>{isResetting ? 'Memproses...' : 'Proses Reset'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
