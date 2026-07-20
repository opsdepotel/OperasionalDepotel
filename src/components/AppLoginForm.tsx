/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { UserProfile, Role } from '../types';
import { User, Lock, LogIn, AlertCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react';

interface AppLoginFormProps {
  profiles: UserProfile[];
  onLoginSuccess: (profile: UserProfile) => void;
  isLoading: boolean;
  onResetGoogle?: () => void;
  onLoginWithCredentials?: (userId: string, password: string, onError: (msg: string) => void) => void;
}

export const AppLoginForm: React.FC<AppLoginFormProps> = ({
  profiles,
  onLoginSuccess,
  isLoading,
  onResetGoogle,
  onLoginWithCredentials
}) => {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!userId.trim()) {
      setError('User ID wajib diisi.');
      return;
    }
    if (!password.trim()) {
      setError('Password wajib diisi.');
      return;
    }

    if (onLoginWithCredentials) {
      onLoginWithCredentials(userId, password, (msg) => setError(msg));
    } else {
      // Find user by matching UserID and Password
      const matched = profiles.find(
        (p) =>
          p.userId?.toLowerCase() === userId.trim().toLowerCase() &&
          p.password === password
      );

      if (matched) {
        onLoginSuccess(matched);
      } else {
        setError('User ID atau Password salah. Silakan coba lagi.');
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
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:bg-slate-300 transition-all cursor-pointer"
        >
          <LogIn className="w-4 h-4" />
          <span>{isLoading ? 'Memproses...' : 'Masuk Aplikasi'}</span>
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
    </div>
  );
};
