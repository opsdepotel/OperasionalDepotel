/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { UserProfile, Role, BudgetRequest } from '../types';
import { User, Shield, Briefcase, Mail, Save, AlertCircle, Plus, Edit2, ArrowLeft, Search, Lock } from 'lucide-react';

interface ProfileSetupProps {
  profiles: UserProfile[];
  requests: BudgetRequest[];
  onSave: (profile: UserProfile) => Promise<void>;
  onClose: () => void;
}

export const ProfileSetup: React.FC<ProfileSetupProps> = ({
  profiles,
  requests,
  onSave,
  onClose
}) => {
  const [searchQuery, setSearchQuery] = useState('');
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
  
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Filter profiles based on search
  const filteredProfiles = profiles.filter(p => {
    const q = searchQuery.toLowerCase();
    return (
      (p.userId || '').toLowerCase().includes(q) ||
      (p.nama || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      (p.divisi || '').toLowerCase().includes(q) ||
      p.role.toLowerCase().includes(q)
    );
  });

  // Get list of manager emails for auto-complete/selection helper
  const managerEmails = Array.from(
    new Set(
      profiles
        .filter(p => p.role === Role.MANAGER)
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
    setError(null);
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
    setError(null);
  };

  const cancelForm = () => {
    setEditingProfile(null);
    setIsAddingNew(false);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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

    if (role === Role.USER) {
      if (!managerEmail.trim()) {
        setError('Email Manager wajib diisi untuk role Staff/User.');
        return;
      }
      if (!managerEmail.includes('@')) {
        setError('Format Email Manager tidak valid.');
        return;
      }
      if (managerEmail.toLowerCase() === email.toLowerCase()) {
        setError('Email Manager tidak boleh sama dengan email pengguna itu sendiri.');
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
        managerEmail: role === Role.USER ? managerEmail.trim() : '',
        divisi: divisi.trim().toUpperCase()
      });
      // Reset form states
      setEditingProfile(null);
      setIsAddingNew(false);
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan data pengguna.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 animate-slide-up">
      {/* Header section with back button */}
      <div className="flex items-center justify-between mb-5 border-b border-slate-100 pb-4">
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
              Kelola Pengguna (Admin)
            </h2>
            <p className="text-[11px] text-slate-400">Atur akun, role, divisi, dan relasi manager</p>
          </div>
        </div>

        {!isAddingNew && !editingProfile && (
          <button
            onClick={startAdd}
            className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah User</span>
          </button>
        )}
      </div>

      {/* Main layout routing: List View vs Add/Edit Form */}
      {isAddingNew || editingProfile ? (
        <form onSubmit={handleSubmit} className="space-y-4 animate-slide-up">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            {editingProfile ? `Edit Pengguna: ${editingProfile.userId}` : 'Tambah Pengguna Baru'}
          </h3>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

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
                  disabled={!!editingProfile} // UserID is the primary key and shouldn't change
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
                />
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Email Pengguna</label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="joko@company.com"
                  disabled={editingProfile ? requests.some(r => 
                    r.userEmail.toLowerCase() === editingProfile.email.toLowerCase() ||
                    r.managerEmail.toLowerCase() === editingProfile.email.toLowerCase()
                  ) : false}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                />
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
              {editingProfile && requests.some(r => 
                r.userEmail.toLowerCase() === editingProfile.email.toLowerCase() ||
                r.managerEmail.toLowerCase() === editingProfile.email.toLowerCase()
              ) && (
                <p className="text-[10px] text-amber-600 font-semibold mt-1 flex items-start gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                  <span>Email tidak dapat diedit karena telah tercatat dalam riwayat transaksi pengajuan atau laporan.</span>
                </p>
              )}
            </div>

            {/* Divisi */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Divisi</label>
              <div className="relative">
                <input
                  type="text"
                  value={divisi}
                  onChange={(e) => setDivisi(e.target.value.toUpperCase())}
                  placeholder="contoh: FINANCE, MARKETING, IT"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                />
                <Briefcase className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              </div>
            </div>
          </div>

          {/* Role Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Role Pekerjaan</label>
            <div className="grid grid-cols-3 gap-2">
              {([Role.USER, Role.MANAGER, Role.ADMIN] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`py-2 px-3 text-xs font-medium rounded-xl border text-center transition-all cursor-pointer ${
                    role === r
                      ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 font-semibold'
                      : 'border-slate-150 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {r === Role.USER ? 'Staff / User' : r === Role.MANAGER ? 'Manager' : 'Admin'}
                </button>
              ))}
            </div>
          </div>

          {/* Manager Email (For standard USER role) */}
          {role === Role.USER && (
            <div className="pt-2 border-t border-slate-50 animate-slide-up">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Email Manager</label>
              <div className="relative">
                <input
                  type="email"
                  value={managerEmail}
                  onChange={(e) => setManagerEmail(e.target.value)}
                  placeholder="manager@company.com"
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
                  list="admin-managers-list"
                />
                <Shield className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <datalist id="admin-managers-list">
                  {managerEmails.map(m => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Relasikan user Staff ini ke email Manager tertentu untuk proses persetujuan berjenjang.
              </p>
            </div>
          )}

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
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            {filteredProfiles.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-xs">
                Tidak ada pengguna yang cocok dengan pencarian Anda.
              </div>
            ) : (
              filteredProfiles.map((p) => (
                <div
                  key={p.userId || p.email}
                  className="p-3 border border-slate-150 rounded-xl hover:border-slate-300 hover:bg-slate-50/40 transition-all flex items-start justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-800">{p.nama || p.userId || 'No ID'}</span>
                      <span className="text-[10px] text-slate-400">({p.userId})</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        p.role === Role.ADMIN
                          ? 'bg-red-50 text-red-600 border border-red-100'
                          : p.role === Role.MANAGER
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                          : 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                      }`}>
                        {p.role}
                      </span>
                      {p.divisi && (
                        <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 uppercase font-mono">
                          {p.divisi}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium">
                      <span className="block">Email: {p.email}</span>
                      {p.role === Role.USER && p.managerEmail && (
                        <span className="block text-slate-400">Manager: {p.managerEmail}</span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => startEdit(p)}
                    className="p-1.5 hover:bg-white text-slate-400 hover:text-indigo-600 rounded-lg border border-transparent hover:border-slate-100 transition-all cursor-pointer shrink-0"
                    title="Edit User"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
