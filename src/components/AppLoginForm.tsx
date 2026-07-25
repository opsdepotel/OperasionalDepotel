/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { UserProfile, Role } from '../types';
import { User, Lock, LogIn, AlertCircle, Eye, EyeOff, ShieldCheck, ShieldAlert, X, RefreshCw } from 'lucide-react';
import { validateDeviceAccessAndBind, getOrCreateDeviceId } from '../lib/deviceUtils';

interface AppLoginFormProps {
  profiles: UserProfile[];
  onLoginSuccess: (profile: UserProfile) => void;
  isLoading: boolean;
  onResetGoogle?: () => void;
  onLoginWithCredentials?: (userId: string, password: string, onError: (msg: string) => void) => void;
  externalError?: string | null;
  onClearExternalError?: () => void;
}

export const AppLoginForm: React.FC<AppLoginFormProps> = ({
  profiles,
  onLoginSuccess,
  isLoading,
  onResetGoogle,
  onLoginWithCredentials,
  externalError,
  onClearExternalError
}) => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    setDeviceId(getOrCreateDeviceId());
  }, []);

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
      onLoginWithCredentials(userId, password, (msg) => {
        triggerError(msg);
      });
    } else {
      // Find user by matching UserID and Password
      const matched = profiles.find(
        (p) =>
          p.userId?.toLowerCase() === userId.trim().toLowerCase() &&
          p.password === password
      );

      if (matched) {
        const deviceCheck = await validateDeviceAccessAndBind(matched, undefined, profiles);
        if (!deviceCheck.success) {
          triggerError(deviceCheck.errorMessage || 'Akses ditolak.');
          return;
        }
        onLoginSuccess(deviceCheck.updatedUser || matched);
      } else {
        triggerError('User ID atau Password salah. Silakan coba lagi.');
      }
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 space-y-6 animate-slide-up">
      {/* Title Header */}
      <div className="text-center space-y-1">
        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 flex items-center justify-center rounded-2xl mx-auto shadow-sm">
          <ShieldCheck className="w-6 h-6 text-indigo-600" />
        </div>
        <h2 className="font-display font-bold text-slate-800 text-base mt-2">Login Aplikasi</h2>
        <p className="text-xs text-slate-400 font-medium">
          Masuk menggunakan User ID &amp; Password Anda
        </p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {/* User ID field */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">User ID</label>
          <div className="relative">
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Masukkan User ID Anda"
              className="w-full pl-9 pr-3 py-2.5 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
              disabled={isLoading}
            />
            <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          </div>
        </div>

        {/* Password field */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Masukkan Password Anda"
              className="w-full pl-9 pr-10 py-2.5 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all outline-none"
              disabled={isLoading}
            />
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {deviceId && (
            <p className="mt-1.5 text-[11px] text-slate-400 font-medium truncate">
              Device ID: <span className="font-mono text-slate-400 select-all">{deviceId}</span>
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
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
      </form>

      {/* Switch Google Account Option */}
      {onResetGoogle && (
        <div className="pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onResetGoogle}
            className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-700 font-semibold text-[10px] rounded-xl transition-all cursor-pointer text-center uppercase tracking-wider"
          >
            Switch Google Account
          </button>
        </div>
      )}

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
