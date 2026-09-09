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
  Users,
  CheckSquare,
  Square,
  Radio,
} from 'lucide-react';
import { UserProfile, Role } from '../types';
import { useBackHandler } from '../hooks/useBackHandler';

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
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState<string>('');
  const [title, setTitle] = useState<string>('🔔 Blast Notifikasi Sistem DIOMS');
  const [body, setBody] = useState<string>('Halo, terdapat informasi penting mengenai operasional dan status UID di sistem DIOMS.');
  const [url, setUrl] = useState<string>('/?tab=dashboard');
  const [isSending, setIsSending] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
    details?: string;
  } | null>(null);

  // Use hardware back handler when displayed in full page view
  useBackHandler(!!onBack, onBack || (() => {}), 'admin_blast_notification_form');

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

  // Count active push subscribers
  const activeSubsUsersCount = useMemo(() => {
    return profiles.filter((p) => parseSubscriptions(p.pushSubscriptions).length > 0).length;
  }, [profiles]);

  // Toggle single user selection
  const handleToggleUser = (email: string) => {
    setFeedback(null);
    setSelectedEmails((prev) => {
      const exists = prev.some((e) => e.toLowerCase() === email.toLowerCase());
      if (exists) {
        return prev.filter((e) => e.toLowerCase() !== email.toLowerCase());
      } else {
        return [...prev, email];
      }
    });
  };

  // Select all filtered users
  const handleSelectAllFiltered = () => {
    setFeedback(null);
    const filteredEmails = filteredUsers.map((u) => u.email);
    const allSelected = filteredEmails.every((e) =>
      selectedEmails.some((se) => se.toLowerCase() === e.toLowerCase())
    );

    if (allSelected) {
      // Unselect filtered
      setSelectedEmails((prev) =>
        prev.filter((e) => !filteredEmails.some((fe) => fe.toLowerCase() === e.toLowerCase()))
      );
    } else {
      // Merge filtered into selected
      const newSelection = Array.from(new Set([...selectedEmails, ...filteredEmails]));
      setSelectedEmails(newSelection);
    }
  };

  // Select only active push subscribers
  const handleSelectActivePushOnly = () => {
    setFeedback(null);
    const activeEmails = filteredUsers
      .filter((u) => parseSubscriptions(u.pushSubscriptions).length > 0)
      .map((u) => u.email);
    setSelectedEmails(activeEmails);
  };

  // Clear selection
  const handleClearSelection = () => {
    setFeedback(null);
    setSelectedEmails([]);
  };

  // Quick message templates
  const applyTemplate = (type: 'announcement' | 'activity' | 'approval' | 'urgent') => {
    const selectedCount = selectedEmails.length;
    const targetLabel = selectedCount === 1 
      ? (profiles.find(p => p.email.toLowerCase() === selectedEmails[0].toLowerCase())?.nama || 'Bapak/Ibu')
      : 'Rekan-rekan Pengguna DIOMS';

    switch (type) {
      case 'announcement':
        setTitle('📢 Pengumuman Sistem DIOMS');
        setBody(`Halo ${targetLabel}, mohon periksa pembaruan sistem dan jadwal operasional terbaru di dashboard DIOMS.`);
        setUrl('/?tab=dashboard');
        break;
      case 'activity':
        setTitle('📋 Pengingat Laporan Kegiatan Harian');
        setBody(`Halo ${targetLabel}, mohon periksa dan kirimkan laporan kegiatan harian beserta foto validasi lokasi hari ini.`);
        setUrl('/?tab=activity');
        break;
      case 'approval':
        setTitle('⚡ Pembaruan Persetujuan Operasional');
        setBody(`Halo ${targetLabel}, terdapat pembaruan status pada pengajuan operasional Anda di sistem DIOMS.`);
        setUrl('/?tab=approvals');
        break;
      case 'urgent':
        setTitle('⚠️ Informasi Mendesak dari Administrator');
        setBody(`Halo ${targetLabel}, ada informasi operasional penting yang memerlukan perhatian Anda segera.`);
        setUrl('/?tab=dashboard');
        break;
    }
  };

  // Send Blast Notification handler
  const handleSendBlastNotification = async () => {
    if (selectedEmails.length === 0) {
      setFeedback({
        type: 'warning',
        message: 'Pilih minimal 1 user penerima blast notifikasi.',
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

    let totalSent = 0;
    let totalFailed = 0;
    const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('g_access_token') || '' : '';

    try {
      // Loop through each selected email and dispatch push notification
      for (const email of selectedEmails) {
        const userObj = profiles.find((p) => p.email.toLowerCase() === email.toLowerCase());
        const subsFromSheet = parseSubscriptions(userObj?.pushSubscriptions);

        const payload = {
          email,
          title: title.trim(),
          body: body.trim(),
          url: url.trim() || '/?tab=dashboard',
          subscriptions: subsFromSheet.length > 0 ? subsFromSheet : undefined,
          extra: {
            fromAdmin: currentAdminEmail || 'Administrator',
            sentAt: new Date().toISOString(),
            isBlast: true,
          },
        };

        try {
          const res = await fetch('/api/push/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
            },
            body: JSON.stringify(payload),
          });

          const data = await res.json().catch(() => ({}));
          if (data.success && (data.sent > 0 || data.sent !== undefined)) {
            totalSent += data.sent || 1;
          } else {
            totalFailed += 1;
          }
        } catch (err) {
          totalFailed += 1;
        }
      }

      if (totalSent > 0) {
        setFeedback({
          type: 'success',
          message: `Berhasil Mengirim Blast Notifikasi!`,
          details: `Pesan berhasil terkirim ke ${totalSent} perangkat dari ${selectedEmails.length} user terpilih. ${
            totalFailed > 0 ? `(${totalFailed} user belum terhubung dengan perangkat/push active)` : ''
          }`,
        });
      } else {
        setFeedback({
          type: 'warning',
          message: `Notifikasi belum dapat dikirim ke user terpilih.`,
          details: `User terpilih belum mengaktifkan izin Push Notifikasi pada perangkat mereka. Minta pengguna untuk login dan mengaktifkan izin notifikasi di menu profil.`,
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: 'Gagal menghubungi server notifikasi.',
        details: err?.message || 'Pastikan koneksi internet aktif.',
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

  // Preview Card rendered directly inside Dashboard if not full view
  if (!onBack && !isFormOpen) {
    return (
      <div
        id="admin-blast-notification-card"
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
              <span className="text-[9px] font-bold bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full border border-sky-300/60 uppercase">
                Fitur Administrator
              </span>
              <span className="text-[9px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                <Smartphone className="w-3 h-3 text-emerald-600" />
                {activeSubsUsersCount} dari {profiles.length} Akun Terhubung
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
            id="admin-blast-top-back-btn"
            className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-sky-600 transition-all cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali ke Dashboard</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold bg-sky-100 text-sky-800 px-2.5 py-1 rounded-full uppercase border border-sky-200">
              Admin Tool
            </span>
            <span className="text-[10px] font-medium bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
              <Smartphone className="w-3 h-3 text-emerald-600" />
              {activeSubsUsersCount} Akun Push Active
            </span>
          </div>
        </div>
      )}

      {/* Non-Modal Form Container */}
      <div
        id="admin-blast-form-container"
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
                  Form Blast Notifikasi Pengguna
                </h3>
                <span className="text-[9px] font-bold bg-white/20 text-white px-2 py-0.5 rounded-full uppercase">
                  Administrator
                </span>
              </div>
              <p className="text-[11px] text-sky-100 font-medium mt-0.5">
                Pilih list user penerima dan tuliskan isi notifikasi yang akan dikirim secara langsung.
              </p>
            </div>
          </div>

          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              id="admin-blast-header-back-btn"
              className="px-3.5 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center gap-1.5 transition-colors cursor-pointer text-xs font-semibold shrink-0"
              title="Kembali ke Dashboard"
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
        <div className="p-4 sm:p-6 space-y-5">
          {/* Section 1: User List Selection */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-sky-600" />
                <span>1. Pilih User Penerima Blast Notifikasi:</span>
              </label>

              {/* Selection Summary Pill & Quick Actions */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 border border-sky-200">
                  Terpilih: {selectedEmails.length} dari {profiles.length} User
                </span>
                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                >
                  {filteredUsers.every((u) => selectedEmails.some((e) => e.toLowerCase() === u.email.toLowerCase()))
                    ? 'Batal Pilih Semua'
                    : 'Pilih Semua'}
                </button>
                <button
                  type="button"
                  onClick={handleSelectActivePushOnly}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors cursor-pointer"
                  title="Hanya pilih user yang sudah mengaktifkan izin Push Notifikasi"
                >
                  Pilih User Push Active
                </button>
                {selectedEmails.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 transition-colors cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Filter Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Cari berdasarkan nama, email, role, atau divisi user..."
                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent placeholder:text-slate-400"
              />
            </div>

            {/* Scrollable User List Cards */}
            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl p-2 bg-slate-50/50 space-y-1.5 custom-scrollbar">
              {filteredUsers.length > 0 ? (
                filteredUsers.map((u) => {
                  const isSelected = selectedEmails.some((e) => e.toLowerCase() === u.email.toLowerCase());
                  const subs = parseSubscriptions(u.pushSubscriptions);
                  const hasActivePush = subs.length > 0;

                  return (
                    <div
                      key={u.email}
                      onClick={() => handleToggleUser(u.email)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 select-none ${
                        isSelected
                          ? 'bg-sky-50/90 border-sky-300 shadow-xs'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Checkbox Icon */}
                        <div className="shrink-0 text-sky-600">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-sky-600" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-300" />
                          )}
                        </div>

                        {/* User Avatar */}
                        <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden">
                          {u.fotoProfile ? (
                            <img
                              src={u.fotoProfile}
                              alt={u.nama}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            u.nama.substring(0, 2).toUpperCase()
                          )}
                        </div>

                        {/* User Info */}
                        <div className="min-w-0">
                          <div className="font-bold text-slate-800 text-xs truncate flex items-center gap-1.5">
                            <span className="truncate">{u.nama}</span>
                            <span className={`text-[8px] font-bold px-1.5 py-0.1 rounded border shrink-0 ${getRoleBadgeClass(u.role)}`}>
                              {u.role}
                            </span>
                            {u.divisi && (
                              <span className="text-[8px] bg-slate-100 text-slate-600 px-1.5 py-0.1 rounded font-medium shrink-0">
                                {u.divisi}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 font-mono truncate">{u.email}</p>
                        </div>
                      </div>

                      {/* Push Active Status Badge */}
                      <div className="shrink-0">
                        {hasActivePush ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            Push Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-slate-100 text-slate-500">
                            Belum Aktif
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-4 text-center text-xs text-slate-500 font-medium">
                  Tidak ada user yang sesuai dengan kriteria pencarian "{userSearch}".
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Quick Template Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                2. Templat Cepat Isi Notifikasi:
              </label>
              <span className="text-[10px] text-slate-400">Klik untuk isi otomatis</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => applyTemplate('announcement')}
                className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-sky-100/70 hover:bg-sky-200 text-sky-800 border border-sky-200 transition-colors cursor-pointer"
              >
                📢 Pengumuman
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

          {/* Section 3: Title, Body, and URL Inputs */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Judul Blast Notifikasi:
              </label>
              <input
                type="text"
                id="admin-blast-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Misal: 🔔 Blast Notifikasi Sistem DIOMS"
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
                id="admin-blast-body-input"
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Tuliskan isi pesan blast notifikasi yang akan diterima oleh perangkat user..."
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
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 transition-all ${
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
                <div className="font-bold text-xs">{feedback.message}</div>
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
            <span>Notifikasi terenkripsi VAPID dikirim langsung ke browser &amp; HP user.</span>
          </div>

          <div className="flex items-center gap-2 justify-end">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                id="admin-blast-footer-back-btn"
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Kembali ke Dashboard</span>
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
              id="admin-send-blast-btn"
              disabled={isSending || selectedEmails.length === 0 || !title.trim() || !body.trim()}
              onClick={handleSendBlastNotification}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer ${
                isSending || selectedEmails.length === 0 || !title.trim() || !body.trim()
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-sky-600 hover:bg-sky-700 text-white shadow-sky-200 hover:shadow-md active:scale-95'
              }`}
            >
              {isSending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Mengirim Blast ({selectedEmails.length} User)...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Kirim Blast Notifikasi ({selectedEmails.length} User)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
