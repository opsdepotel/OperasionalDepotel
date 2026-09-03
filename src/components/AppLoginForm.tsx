/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { UserProfile, Role } from '../types';
import { User, Lock, LogIn, AlertCircle, Eye, EyeOff, ShieldCheck, ShieldAlert, X, RefreshCw } from 'lucide-react';
import { validateDeviceAccessAndBind, getOrCreateDeviceId } from '../lib/deviceUtils';
import { mergeUserProfiles, findMatchingUser, defaultUsers } from '../lib/googleApi';

interface AppLoginFormProps {
  profiles: UserProfile[];
  onLoginSuccess: (profile: UserProfile) => void;
  isLoading: boolean;
  onResetGoogle?: () => void;
  onLoginWithCredentials?: (userId: string, password: string, onError: (msg: string) => void) => void;
  externalError?: string | null;
  onClearExternalError?: () => void;
  hasSharedReceipt?: boolean;
}

export const AppLoginForm: React.FC<AppLoginFormProps> = ({
  profiles,
  onLoginSuccess,
  isLoading,
  onResetGoogle,
  onLoginWithCredentials,
  externalError,
  onClearExternalError,
  hasSharedReceipt
}) => {
  const [rememberMe, setRememberMe] = useState<boolean>(() => {
    return localStorage.getItem('op_app_remember_me') === 'true';
  });
  const [userId, setUserId] = useState(() => {
    const isRemembered = localStorage.getItem('op_app_remember_me') === 'true';
    return isRemembered ? localStorage.getItem('op_app_saved_user_id') || '' : '';
  });
  const [password, setPassword] = useState(() => {
    const isRemembered = localStorage.getItem('op_app_remember_me') === 'true';
    return isRemembered ? localStorage.getItem('op_app_saved_password') || '' : '';
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    setDeviceId(getOrCreateDeviceId());
  }, []);

  const saveRememberMeState = (uid: string, pwd: string, shouldRemember: boolean) => {
    if (shouldRemember) {
      localStorage.setItem('op_app_remember_me', 'true');
      localStorage.setItem('op_app_saved_user_id', uid.trim());
      localStorage.setItem('op_app_saved_password', pwd);
    } else {
      localStorage.removeItem('op_app_remember_me');
      localStorage.removeItem('op_app_saved_user_id');
      localStorage.removeItem('op_app_saved_password');
    }
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
      saveRememberMeState(userId, password, rememberMe);
      onLoginWithCredentials(userId, password, (msg) => {
        triggerError(msg);
      });
    } else {
      // Find user by matching UserID/Email and Password against merged candidate profiles
      const candidateProfiles = mergeUserProfiles(profiles, defaultUsers);
      const matched = findMatchingUser(candidateProfiles, userId, password);

      if (matched) {
        const deviceCheck = await validateDeviceAccessAndBind(matched, undefined, candidateProfiles);
        if (!deviceCheck.success) {
          triggerError(deviceCheck.errorMessage || 'Akses ditolak.');
          return;
        }
        saveRememberMeState(userId, password, rememberMe);
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

        {/* Checkmark Ingat Saya */}
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
                if (!checked) {
                  localStorage.removeItem('op_app_remember_me');
                  localStorage.removeItem('op_app_saved_user_id');
                  localStorage.removeItem('op_app_saved_password');
                } else if (userId.trim()) {
                  localStorage.setItem('op_app_remember_me', 'true');
                  localStorage.setItem('op_app_saved_user_id', userId.trim());
                  localStorage.setItem('op_app_saved_password', password);
                }
              }}
              className="w-4 h-4 rounded text-amber-600 border-slate-300 focus:ring-amber-500 cursor-pointer accent-amber-600 transition-all"
            />
            <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-800 transition-colors">
              Ingat saya
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
