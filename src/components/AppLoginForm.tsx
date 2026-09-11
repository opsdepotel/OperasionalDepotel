/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { UserProfile, Role } from '../types';
import { User, Lock, LogIn, AlertCircle, Eye, EyeOff, ShieldCheck, ShieldAlert, X, RefreshCw, Smartphone, CheckCircle2, Globe, AlertTriangle } from 'lucide-react';
import { validateDeviceAccessAndBind, getOrCreateDeviceId, getOrCreateDeviceIdAsync, getInAppBrowserInfo, detectPrivateBrowsing, InAppBrowserInfo, requestPersistentStorage } from '../lib/deviceUtils';
import { mergeUserProfiles, findMatchingUser } from '../lib/googleApi';
import { DevicePermissionsStatus } from '../lib/devicePermissions';

interface AppLoginFormProps {
  profiles: UserProfile[];
  onLoginSuccess: (profile: UserProfile) => void;
  isLoading: boolean;
  onResetGoogle?: () => void;
  onLoginWithCredentials?: (userId: string, password: string, onError: (msg: string) => void) => void;
  externalError?: string | null;
  onClearExternalError?: () => void;
  hasSharedReceipt?: boolean;
  permissionsStatus?: DevicePermissionsStatus | null;
  onOpenPermissions?: () => void;
}

export const AppLoginForm: React.FC<AppLoginFormProps> = ({
  profiles,
  onLoginSuccess,
  isLoading,
  onResetGoogle,
  onLoginWithCredentials,
  externalError,
  onClearExternalError,
  hasSharedReceipt,
  permissionsStatus,
  onOpenPermissions,
}) => {
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    return localStorage.getItem('op_app_remember_me') === 'true';
  });
  const [userId, setUserId] = useState(() => {
    const isRemembered = localStorage.getItem('op_app_remember_me') === 'true';
    return isRemembered ? localStorage.getItem('op_app_saved_user_id') || '' : '';
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [inAppInfo, setInAppInfo] = useState<InAppBrowserInfo | null>(null);
  const [isPrivateMode, setIsPrivateMode] = useState<boolean>(false);

  useEffect(() => {
    // 1. Initial async fetch with IndexedDB fallback recovery
    getOrCreateDeviceIdAsync().then((devId) => {
      if (devId) setDeviceId(devId);
    }).catch(() => {
      setDeviceId(getOrCreateDeviceId());
    });

    // 2. Detect In-App browser (WhatsApp, IG, etc.)
    const info = getInAppBrowserInfo();
    if (info.isInApp) {
      setInAppInfo(info);
    }

    // 3. Detect Safari Private Browsing mode
    detectPrivateBrowsing().then((isPvt) => {
      if (isPvt) setIsPrivateMode(true);
    }).catch(() => {});

    // Security audit: Clean up any legacy plaintext password stored in localStorage
    try {
      localStorage.removeItem('op_app_saved_password');
    } catch {}

    // 4. Request persistent storage from browser via navigator.storage.persist()
    requestPersistentStorage().catch(() => {});
  }, []);

  const saveRememberMeState = (uid: string, shouldRemember: boolean) => {
    try {
      if (shouldRemember) {
        localStorage.setItem('op_app_remember_me', 'true');
        localStorage.setItem('op_app_saved_user_id', uid.trim());
      } else {
        localStorage.removeItem('op_app_remember_me');
        localStorage.removeItem('op_app_saved_user_id');
      }
      localStorage.removeItem('op_app_saved_password');
    } catch {}
  };

  const activeError = externalError || error;
  const isModalOpen = (showRejectModal || !!externalError) && !!activeError;

  const handleCloseModal = () => {
    setShowRejectModal(false);
    setError(null);
    if (onClearExternalError) {
      onClearExternalError();
    }
  };

  const triggerError = (msg: string) => {
    setError(msg);
    setShowRejectModal(true);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setShowRejectModal(false);

    if (!userId.trim()) {
      triggerError('User ID wajib diisi.');
      return;
    }
    if (!password.trim()) {
      triggerError('Password wajib diisi.');
      return;
    }

    if (onLoginWithCredentials) {
      saveRememberMeState(userId, rememberMe);
      onLoginWithCredentials(userId, password, (msg) => {
        triggerError(msg);
      });
    } else {
      // Find user by matching UserID/Email and Password against merged candidate profiles
      const candidateProfiles = mergeUserProfiles(profiles);
      const matched = findMatchingUser(candidateProfiles, userId, password);

      if (matched) {
        const deviceCheck = await validateDeviceAccessAndBind(matched, undefined, candidateProfiles);
        if (!deviceCheck.success) {
          triggerError(deviceCheck.errorMessage || 'Akses ditolak.');
          return;
        }
        saveRememberMeState(userId, rememberMe);
        onLoginSuccess(deviceCheck.updatedUser || matched);
      } else {
        triggerError('User ID atau Password salah. Silakan coba lagi.');
      }
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl shadow-slate-200/50 p-6 sm:p-8 space-y-6 animate-slide-up max-w-md mx-auto">
      {/* Title Header */}
      <div className="text-center space-y-1.5">
        <div className="w-12 h-12 bg-amber-50 border border-amber-200/60 text-amber-600 flex items-center justify-center rounded-2xl mx-auto shadow-sm">
          <ShieldCheck className="w-6 h-6 text-amber-600" />
        </div>
        <h2 className="font-display font-bold text-slate-800 text-lg mt-2">Login Aplikasi</h2>
        <p className="text-xs text-slate-500 font-medium">
          Masuk menggunakan User ID &amp; Password Anda
        </p>
      </div>

      {hasSharedReceipt && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-2xl p-3.5 text-xs space-y-1 shadow-sm animate-pulse">
          <div className="font-bold flex items-center gap-1.5 text-blue-800">
            <span>📌 Bukti Transfer Diterima dari Share!</span>
          </div>
          <p className="text-[11px] text-blue-700 leading-relaxed">
            Gambar resi telah disimpan. Silakan login menggunakan akun <strong>Finance</strong> untuk memproses OCR &amp; pencocokan transaksi otomatis.
          </p>
        </div>
      )}

      {/* Device Readiness Status Banner */}
      {permissionsStatus && !permissionsStatus.allGranted && onOpenPermissions && (
        <div className="bg-amber-50/80 border border-amber-200/90 rounded-2xl p-3 text-xs flex items-center justify-between gap-2.5 shadow-2xs animate-fade-in">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 shadow-2xs">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-amber-950 text-xs truncate">Kesiapan Perangkat Belum Lengkap</p>
              <p className="text-[11px] text-amber-800 truncate">Notifikasi, GPS, atau Kamera belum aktif</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenPermissions}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs rounded-xl transition-all shrink-0 cursor-pointer shadow-xs"
          >
            Aktifkan
          </button>
        </div>
      )}

      {/* In-App Browser Warning (WhatsApp / IG / etc.) */}
      {inAppInfo?.isInApp && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl p-3.5 text-xs space-y-1.5 shadow-xs animate-fade-in" id="in-app-browser-banner">
          <div className="font-bold flex items-center gap-1.5 text-amber-900">
            <Globe className="w-4 h-4 text-amber-700 shrink-0" />
            <span>Terdeteksi Membuka Lewat {inAppInfo.name}</span>
          </div>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            In-App browser memiliki penyimpanan sementara yang dapat mereset Device ID saat aplikasi ditutup.
            {inAppInfo.isIos ? (
              <span> Disarankan ketuk ikon bagikan (Share) di pojok bawah lalu pilih <strong>Buka di Safari (Open in Safari)</strong> atau <strong>Tambahkan ke Layar Utama</strong>.</span>
            ) : (
              <span> Disarankan ketuk menu titik tiga lalu pilih <strong>Buka di Browser (Chrome)</strong>.</span>
            )}
          </p>
        </div>
      )}

      {/* Safari Private Browsing Warning */}
      {isPrivateMode && (
        <div className="bg-rose-50 border border-rose-300 text-rose-900 rounded-2xl p-3.5 text-xs space-y-1.5 shadow-xs animate-fade-in" id="private-browsing-banner">
          <div className="font-bold flex items-center gap-1.5 text-rose-900">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Peringatan: Tab Pribadi (Private Browsing)</span>
          </div>
          <p className="text-[11px] text-rose-800 leading-relaxed">
            Browser Anda sedang dalam mode Tab Pribadi. Penyimpanan lokal akan dihapus saat tab ditutup sehingga Device ID akan berubah dan akun Anda dapat terkunci. Silakan buka aplikasi pada <strong>Tab Biasa</strong>.
          </p>
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {/* User ID field */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">User ID</label>
          <div className="relative">
            <input
              type="text"
              id="login-user-id-input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Masukkan User ID Anda"
              className="w-full pl-10 pr-3 py-2.5 text-xs bg-slate-50/70 border border-slate-200 rounded-xl focus:border-amber-500 focus:bg-white focus:ring-1 focus:ring-amber-500/30 transition-all outline-none text-slate-900 font-medium"
              disabled={isLoading}
              required
            />
            <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          </div>
        </div>

        {/* Password field */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              id="login-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Masukkan Password Anda"
              className="w-full pl-10 pr-10 py-2.5 text-xs bg-slate-50/70 border border-slate-200 rounded-xl focus:border-amber-500 focus:bg-white focus:ring-1 focus:ring-amber-500/30 transition-all outline-none text-slate-900 font-medium"
              disabled={isLoading}
              required
            />
            <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Checkmark Ingat Saya (User ID saja) */}
        <div className="flex items-center justify-between pt-0.5">
          <label 
            htmlFor="remember-me-checkbox" 
            className="inline-flex items-center gap-2.5 cursor-pointer select-none group"
          >
            <input
              type="checkbox"
              id="remember-me-checkbox"
              checked={rememberMe}
              onChange={(e) => {
                const checked = e.target.checked;
                setRememberMe(checked);
                try {
                  if (!checked) {
                    localStorage.removeItem('op_app_remember_me');
                    localStorage.removeItem('op_app_saved_user_id');
                  } else if (userId.trim()) {
                    localStorage.setItem('op_app_remember_me', 'true');
                    localStorage.setItem('op_app_saved_user_id', userId.trim());
                  }
                  localStorage.removeItem('op_app_saved_password');
                } catch {}
              }}
              className="w-4 h-4 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer accent-amber-600 transition-all"
            />
            <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-800 transition-colors">
              Ingat User ID
            </span>
          </label>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          id="login-submit-button"
          disabled={isLoading}
          className="w-full py-2.5 sm:py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-600/25 disabled:bg-slate-300 disabled:shadow-none transition-all cursor-pointer"
        >
          {isLoading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin text-white" />
              <span>Memverifikasi...</span>
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              <span>Masuk Aplikasi</span>
            </>
          )}
        </button>

        {deviceId && (
          <p className="text-[10px] text-slate-400 font-mono text-center pt-1 truncate select-all">
            Device ID: {deviceId}
          </p>
        )}
      </form>

      {/* Popup Notifikasi Login Ditolak */}
      {isModalOpen && activeError && (
        <div className="fixed inset-0 bg-slate-900/15 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 animate-fade-in">
          <div
            className="bg-white rounded-3xl shadow-2xl border border-slate-200/80 max-w-sm w-full p-6 text-center space-y-4 animate-scale-up relative ring-1 ring-slate-900/5"
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={handleCloseModal}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner ring-8 ring-red-50/60">
              <ShieldAlert className="w-8 h-8 text-red-600" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-800">Login Ditolak</h3>
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">
                Akses Tidak Diizinkan
              </p>
            </div>

            <div className="bg-red-50/80 border border-red-200/80 rounded-2xl p-3.5 text-left flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-slate-700 text-xs font-medium leading-relaxed">{activeError}</p>
            </div>

            <button
              type="button"
              onClick={handleCloseModal}
              className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md shadow-red-200 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Tutup &amp; Coba Lagi</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
