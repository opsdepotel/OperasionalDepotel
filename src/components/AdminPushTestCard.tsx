import React, { useState, useMemo, useEffect } from 'react';
import {
  BellRing,
  Send,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
  Sparkles,
  ShieldCheck,
  Check,
  HelpCircle,
  ExternalLink,
  X,
  ArrowLeft,
} from 'lucide-react';
import { UserProfile, Role } from '../types';

interface AdminPushTestCardProps {
  profiles: UserProfile[];
  currentAdminEmail?: string;
  className?: string;
  onBack?: () => void;
}

export const AdminPushTestCard: React.FC<AdminPushTestCardProps> = ({
  profiles,
  currentAdminEmail,
  className = '',
  onBack,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<string>('');
  const [userSearch, setUserSearch] = useState<string>('');
  const [title, setTitle] = useState<string>('🔔 Tes Notifikasi Sistem DIOMS');
  const [body, setBody] = useState<string>('');
  const [url, setUrl] = useState<string>('/?tab=dashboard');
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
    details?: string;
  } | null>(null);

  // Helper to safely parse subscriptions from user profile
  const parseSubscriptions = (raw?: string): any[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
      return [];
    } catch {
      return [];
    }
  };

  // Pre-sort and filter users
  const filteredUsers = useMemo(() => {
    const q = userSearch.toLowerCase().trim();
    return profiles.filter((p) => {
      if (!p.email) return false;
      if (!q) return true;
      return (
        p.nama.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        (p.divisi && p.divisi.toLowerCase().includes(q))
      );
    });
  }, [profiles, userSearch]);

  // Selected user profile
  const selectedUser = useMemo(() => {
    return profiles.find((p) => p.email.toLowerCase() === selectedEmail.toLowerCase()) || null;
  }, [profiles, selectedEmail]);

  // Selected user subscription count
  const selectedUserSubs = useMemo(() => {
    if (!selectedUser) return [];
    return parseSubscriptions(selectedUser.pushSubscriptions);
  }, [selectedUser]);

  // Stats: count how many users have active push subscriptions registered
  const activeSubsUsersCount = useMemo(() => {
    return profiles.filter((p) => parseSubscriptions(p.pushSubscriptions).length > 0).length;
  }, [profiles]);

  // Update default message when selected user changes
  const handleSelectUser = (email: string) => {
    setSelectedEmail(email);
    setFeedback(null);
    const u = profiles.find((p) => p.email.toLowerCase() === email.toLowerCase());
    if (u) {
      setBody(`Halo ${u.nama}, perangkat Anda berhasil menerima uji coba push notifikasi dari Administrator.`);
    }
  };

  // Quick message templates
  const applyTemplate = (type: 'test' | 'activity' | 'approval' | 'urgent') => {
    const name = selectedUser ? selectedUser.nama : 'Bapak/Ibu';
    switch (type) {
      case 'test':
        setTitle('🔔 Tes Notifikasi Sistem DIOMS');
        setBody(`Halo ${name}, perangkat Anda berhasil menerima uji coba notifikasi dari Administrator.`);
        setUrl('/?tab=dashboard');
        break;
      case 'activity':
        setTitle('📋 Pengingat Laporan Kegiatan Harian');
        setBody(`Halo ${name}, mohon periksa dan kirimkan laporan kegiatan harian beserta foto validasi GPS hari ini.`);
        setUrl('/?tab=activity');
        break;
      case 'approval':
        setTitle('⚡ Pembaruan Persetujuan Operasional');
        setBody(`Halo ${name}, terdapat pembaruan status pada pengajuan operasional Anda di sistem DIOMS.`);
        setUrl('/?tab=approvals');
        break;
      case 'urgent':
        setTitle('⚠️ Informasi Penting dari Administrator');
        setBody(`Halo ${name}, ada informasi operasional penting yang memerlukan perhatian Anda segera.`);
        setUrl('/?tab=dashboard');
        break;
    }
  };

  // Send test notification handler
  const handleSendTestNotification = async () => {
    if (!selectedUser || !selectedEmail) {
      setFeedback({
        type: 'warning',
        message: 'Pilih pengguna sasaran terlebih dahulu.',
      });
      return;
    }

    if (!title.trim() || !body.trim()) {
      setFeedback({
        type: 'warning',
        message: 'Judul dan isi pesan notifikasi tidak boleh kosong.',
      });
      return;
    }

    setIsSending(true);
    setFeedback(null);

    try {
      const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('g_access_token') || '' : '';
      const subsFromSheet = parseSubscriptions(selectedUser.pushSubscriptions);

      const payload = {
        email: selectedUser.email,
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || '/?tab=dashboard',
        subscriptions: subsFromSheet.length > 0 ? subsFromSheet : undefined,
        extra: {
          fromAdmin: currentAdminEmail || 'Administrator',
          sentAt: new Date().toISOString(),
          isTest: true,
        },
      };

      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (data.success && (data.sent > 0 || data.sent !== undefined)) {
        const sentCount = data.sent ?? 1;
        setFeedback({
          type: 'success',
          message: `Berhasil! Notifikasi telah dikirim ke ${selectedUser.nama}.`,
          details: `${sentCount} perangkat target berhasil menerima pesan uji coba. Periksa layar notifikasi pada perangkat sasaran.`,
        });
      } else {
        // Did not send
        const errMessage = data.error || 'Perangkat target belum mengaktifkan izin push notifikasi.';
        setFeedback({
          type: 'warning',
          message: `Notifikasi belum dapat diterima oleh ${selectedUser.nama}.`,
          details: `${errMessage} Minta pengguna untuk login di HP/komputer dan mengaktifkan 'Izinkan Notifikasi' di modal Izin Perangkat.`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: 'Gagal menghubungi server notifikasi.',
        details: err?.message || 'Pastikan koneksi internet aktif dan server Vercel/Node.js berjalan normal.',
      });
    } finally {
      setIsSending(false);
    }
  };

  const getRoleBadgeClass = (role: Role) => {
    switch (role) {
      case Role.ADMINISTRATOR:
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case Role.DIREKTUR:
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case Role.FINANCE:
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case Role.MANAGER:
        return 'bg-amber-100 text-amber-800 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  if (!onBack && !isFormOpen) {
    return (
      <div
        id="admin-push-test-card"
        onClick={() => setIsFormOpen(true)}
        className={`p-5 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/90 via-white to-indigo-50/50 shadow-md hover:shadow-lg hover:border-sky-400 transition-all cursor-pointer group flex items-center justify-between gap-4 select-none ${className}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsFormOpen(true);
          }
        }}
      >
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-sky-200 group-hover:scale-105 transition-transform">
            <BellRing className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display font-bold text-slate-900 text-sm group-hover:text-sky-600 transition-colors">
                Uji Coba Push Notifikasi Pengguna
              </h3>
              <span className="text-[9px] font-bold bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full border border-sky-300/60 uppercase">
                Fitur Administrator
              </span>
              <span className="text-[9px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                <Smartphone className="w-3 h-3 text-emerald-600" />
                {activeSubsUsersCount} dari {profiles.length} Akun Terhubung
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-medium mt-1">
              Kirimkan pesan uji coba push notifikasi langsung ke HP atau browser pengguna tertentu untuk memastikan perangkat menerima notifikasi sistem.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-block text-xs font-semibold text-sky-700 group-hover:text-sky-900 transition-colors">
            Buka Formulir
          </span>
          <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 group-hover:translate-x-0.5 transition-transform font-bold text-xs">
            &rarr;
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 w-full ${onBack ? 'max-w-4xl mx-auto animate-slide-up' : ''} ${className}`}>
      {/* Top Navigation Bar when rendered as Full Page */}
      {onBack && (
        <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <button
            type="button"
            onClick={onBack}
            id="admin-push-test-top-back-btn"
            className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-sky-600 transition-all cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Halaman Utama</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold bg-sky-100 text-sky-800 px-2.5 py-1 rounded-full uppercase border border-sky-200">
              Admin Tool
            </span>
            <span className="text-[10px] font-medium bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
              <Smartphone className="w-3 h-3 text-emerald-600" />
              {activeSubsUsersCount} Akun Terhubung
            </span>
          </div>
        </div>
      )}

      {/* Form Container */}
      <div
        id="admin-push-test-form-container"
        className="w-full bg-white rounded-2xl sm:rounded-3xl shadow-lg border border-sky-200 overflow-hidden transition-all"
      >
        {/* Form Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-sky-600 via-sky-700 to-indigo-700 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0 shadow-inner">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display font-bold text-white text-base">
                  Uji Coba Push Notifikasi Pengguna
                </h3>
                <span className="text-[9px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full uppercase">
                  Admin
                </span>
              </div>
              <p className="text-[11px] text-sky-100 font-medium mt-0.5">
                Kirim pesan uji coba langsung ke perangkat HP atau browser pengguna
              </p>
            </div>
          </div>

          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              id="admin-push-test-header-back-btn"
              className="px-3.5 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center gap-1.5 transition-colors cursor-pointer text-xs font-semibold shrink-0"
              title="Kembali ke Halaman Utama"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Kembali</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center gap-1.5 transition-colors cursor-pointer text-xs font-medium shrink-0"
              title="Tutup formulir"
            >
              <X className="w-4 h-4" />
              <span>Tutup Formulir</span>
            </button>
          )}
        </div>

      {/* Form Body */}
      <div className="p-4 sm:p-6 space-y-4">
        {/* Target User Selector */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold text-slate-700">
            1. Pilih Pengguna Target:
          </label>

          {/* Filter Search Input */}
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Cari nama, email, role, atau divisi..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent placeholder:text-slate-400"
            />
          </div>

          {/* User Select Element */}
          <select
            id="admin-test-push-user-select"
            value={selectedEmail}
            onChange={(e) => handleSelectUser(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
          >
            <option value="">-- Pilih Akun Pengguna Target ({filteredUsers.length} pengguna) --</option>
            {filteredUsers.map((u) => {
              const subs = parseSubscriptions(u.pushSubscriptions);
              const hasSubs = subs.length > 0;
              return (
                <option key={u.email} value={u.email}>
                  {hasSubs ? '🟢 [Push Aktif]' : '⚪ [Belum Terdaftar]'} {u.nama} ({u.role}) — {u.email}
                </option>
              );
            })}
          </select>

          {/* Selected User Status Indicator Card */}
          {selectedUser && (
            <div className="mt-2 p-2.5 rounded-xl border border-slate-200/80 bg-slate-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden">
                  {selectedUser.fotoProfile ? (
                    <img
                      src={selectedUser.fotoProfile}
                      alt={selectedUser.nama}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    selectedUser.nama.substring(0, 2).toUpperCase()
                  )}
                </div>
                <div>
                  <div className="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                    <span>{selectedUser.nama}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${getRoleBadgeClass(selectedUser.role)}`}>
                      {selectedUser.role}
                    </span>
                    {selectedUser.divisi && (
                      <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                        {selectedUser.divisi}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {selectedUser.email}
                  </div>
                </div>
              </div>

              {/* Subscription Status Pill */}
              <div className="shrink-0 flex items-center gap-1.5">
                {selectedUserSubs.length > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    {selectedUserSubs.length} Perangkat Terdaftar (Kolom N)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                    <AlertCircle className="w-3 h-3 text-amber-600" />
                    Belum Terdaftar di Kolom N
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quick Template Selector */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              2. Templat Cepat Notifikasi:
            </label>
            <span className="text-[10px] text-slate-400">Klik untuk isi otomatis</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => applyTemplate('test')}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-sky-100/70 hover:bg-sky-200 text-sky-800 border border-sky-200 transition-colors cursor-pointer"
            >
              🔔 Uji Sambungan
            </button>
            <button
              type="button"
              onClick={() => applyTemplate('activity')}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-indigo-100/70 hover:bg-indigo-200 text-indigo-800 border border-indigo-200 transition-colors cursor-pointer"
            >
              📋 Laporan Kegiatan
            </button>
            <button
              type="button"
              onClick={() => applyTemplate('approval')}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-purple-100/70 hover:bg-purple-200 text-purple-800 border border-purple-200 transition-colors cursor-pointer"
            >
              ⚡ Pembaruan UID
            </button>
            <button
              type="button"
              onClick={() => applyTemplate('urgent')}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-rose-100/70 hover:bg-rose-200 text-rose-800 border border-rose-200 transition-colors cursor-pointer"
            >
              ⚠️ Pesan Mendesak
            </button>
          </div>
        </div>

        {/* Title & Body Inputs */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Judul Notifikasi:
            </label>
            <input
              type="text"
              id="admin-test-push-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Misal: 🔔 Tes Notifikasi Sistem DIOMS"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-medium"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                Isi Pesan Notifikasi:
              </label>
              <span className="text-[10px] text-slate-400 font-mono">
                {body.length} karakter
              </span>
            </div>
            <textarea
              id="admin-test-push-body-input"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Tuliskan isi pesan notifikasi yang akan muncul di layar HP atau desktop pengguna..."
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-medium resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Tautan Halaman Saat Notifikasi Diklik (Opsional):
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/?tab=dashboard"
              className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-mono text-slate-700"
            />
          </div>
        </div>

        {/* Feedback Alert Box */}
        {feedback && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 transition-all ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : feedback.type === 'warning'
                ? 'bg-amber-50 text-amber-900 border-amber-200'
                : 'bg-rose-50 text-rose-900 border-rose-200'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : feedback.type === 'warning' ? (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <div className="font-bold">{feedback.message}</div>
              {feedback.details && (
                <p className="text-[11px] leading-relaxed opacity-90">{feedback.details}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Form Footer */}
      <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/90 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="text-[11px] text-slate-500 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-sky-600 shrink-0" />
          <span>Web Push VAPID terenkripsi langsung ke browser &amp; HP.</span>
        </div>

        <div className="flex items-center gap-2 justify-end">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              id="admin-push-test-footer-back-btn"
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Kembali ke Halaman Utama</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
            >
              Tutup Formulir
            </button>
          )}
          <button
            type="button"
            id="admin-send-test-push-btn"
            disabled={isSending || !selectedEmail || !title.trim() || !body.trim()}
            onClick={handleSendTestNotification}
            className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer ${
              isSending || !selectedEmail || !title.trim() || !body.trim()
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-200 hover:shadow-md active:scale-95'
            }`}
          >
            {isSending ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Mengirim Notifikasi...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Kirim Notifikasi Uji Coba
              </>
            )}
          </button>
        </div>
      </div>
    </div>
    </div>
  );
};
