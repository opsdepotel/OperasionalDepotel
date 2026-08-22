/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { UserProfile, Role } from '../types';
import { Download, CloudUpload } from 'lucide-react';

interface HeaderProps {
  userProfile?: UserProfile | null;
  role?: Role;
  onRoleChange?: (newRole: Role) => void;
  onLogout?: () => void;
  spreadsheetId?: string | null;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onOpenSettings?: () => void;
  activeView?: string;
  onOpenDiomsLogo?: () => void;
  isTokenExpired?: boolean;
  token?: string | null;
  onRenewToken?: () => void;
  isInstallable?: boolean;
  onInstallPwa?: () => void;
  isOnlineNet?: boolean;
  pendingOfflineCount?: number;
  isSyncingOffline?: boolean;
  onSyncOffline?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  userProfile,
  onOpenDiomsLogo,
  isTokenExpired,
  token,
  onRenewToken,
  isInstallable,
  onInstallPwa,
  isOnlineNet = true,
  pendingOfflineCount = 0,
  isSyncingOffline = false,
  onSyncOffline
}) => {
  const isGoogleConnected = Boolean(token && !isTokenExpired);

  const handleLogoClick = () => {
    if (!isGoogleConnected) {
      if (onRenewToken) {
        onRenewToken();
      } else if (onOpenDiomsLogo) {
        onOpenDiomsLogo();
      }
    } else {
      if (onOpenDiomsLogo) {
        onOpenDiomsLogo();
      }
    }
  };

  const statusTitle = !isGoogleConnected
    ? 'Sesi Google Expired / Terputus! Klik logo DIOMS untuk memperbarui koneksi (1-Klik Connect)'
    : `Koneksi Google Terhubung (${userProfile?.email || 'ops.depotel@gmail.com'}). Klik untuk memperbesar logo DIOMS`;

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-100 shadow-sm px-4 py-2">
      <div className="max-w-md mx-auto flex items-center justify-between gap-2">
        {/* Left Side / Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <img 
            src="/DEPOTEL_rounded22.jpg" 
            alt="DEPOTEL Logo" 
            className="h-7 sm:h-8 w-auto object-contain"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Right Side Controls */}
        <div className="flex items-center gap-2">
          {/* PWA Install Button */}
          {isInstallable && onInstallPwa && (
            <button
              type="button"
              onClick={onInstallPwa}
              className="py-1 px-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-[11px] font-bold flex items-center gap-1.5 transition-all shadow-xs shrink-0 cursor-pointer"
              title="Install Aplikasi DIOMS ke Layar Utama HP"
            >
              <Download className="w-3.5 h-3.5 text-indigo-600 animate-bounce" />
              <span className="hidden sm:inline">Install App</span>
            </button>
          )}

          {/* Pending Offline Sync Button */}
          {pendingOfflineCount > 0 && onSyncOffline && (
            <button
              type="button"
              onClick={onSyncOffline}
              disabled={isSyncingOffline || !isOnlineNet || !isGoogleConnected}
              className={`py-1 px-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[10px] font-extrabold flex items-center gap-1 transition-all shadow-xs cursor-pointer disabled:opacity-50 shrink-0 ${
                isSyncingOffline ? 'animate-pulse' : ''
              }`}
              title={`${pendingOfflineCount} Data Offline Belum Ter-upload. Klik untuk Sinkronisasi.`}
            >
              <CloudUpload className={`w-3 h-3 ${isSyncingOffline ? 'animate-spin' : ''}`} />
              <span>{pendingOfflineCount} Sync</span>
            </button>
          )}

          {/* DIOMS Logo with Google Connection Indicator */}
          <button
            type="button"
            onClick={handleLogoClick}
            className={`relative shrink-0 flex items-center justify-center p-1 rounded-xl transition-all cursor-pointer group focus:outline-none ${
              !isGoogleConnected
                ? 'bg-amber-50 border border-amber-300 ring-2 ring-amber-300/60 ring-offset-1 animate-pulse hover:bg-amber-100'
                : 'hover:opacity-85'
            }`}
            title={statusTitle}
          >
            <img 
              src="/DIOMS-1.png" 
              alt="DIOMS Logo" 
              className="h-7 sm:h-8 w-auto object-contain group-hover:scale-105 transition-transform duration-200" 
              referrerPolicy="no-referrer" 
            />

            {/* Google Connection Status Indicator Dot at Bottom-Right of DIOMS Logo */}
            <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center pointer-events-none">
              {!isGoogleConnected ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500 border-2 border-white shadow-xs" />
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-white shadow-xs" />
              )}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};

