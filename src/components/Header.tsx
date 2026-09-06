/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { UserProfile, Role } from '../types';
import { RefreshCw, LogOut, Smartphone } from 'lucide-react';
import { DevicePermissionsStatus } from '../lib/devicePermissions';

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
  token?: string | null;
  permissionsStatus?: DevicePermissionsStatus | null;
  onOpenPermissions?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  userProfile,
  onOpenDiomsLogo,
  token,
  spreadsheetId,
  onRefresh,
  isRefreshing,
  onLogout,
  permissionsStatus,
  onOpenPermissions,
}) => {
  const isConnected = Boolean(token || spreadsheetId || userProfile);

  const handleLogoClick = () => {
    if (onOpenDiomsLogo) {
      onOpenDiomsLogo();
    }
  };

  const statusTitle = `DIOMS - Depotel Integrated Operation Monitoring System (${userProfile?.email || 'ops.depotel@gmail.com'})`;

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-100 shadow-sm px-4 py-2.5">
      <div className="max-w-md mx-auto flex items-center justify-between gap-2">
        {/* Left Side / Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <img 
            src="/DEPOTEL_rounded22.jpg" 
            alt="DEPOTEL Logo" 
            className="h-8 w-auto object-contain"
            referrerPolicy="no-referrer"
          />
        </div>

        {/* Right Side Controls: DIOMS Logo with Connection Indicator & Sync Button */}
        <div className="flex items-center">
          <button
            type="button"
            onClick={handleLogoClick}
            className="relative shrink-0 flex items-center justify-center p-1 rounded-xl transition-all cursor-pointer group focus:outline-none hover:opacity-85"
            title={statusTitle}
          >
            <img 
              src="/DIOMS-1.png" 
              alt="DIOMS Logo" 
              className="h-8 w-auto object-contain group-hover:scale-105 transition-transform duration-200" 
              referrerPolicy="no-referrer" 
            />

            {/* Connection Status Indicator Dot at Bottom-Right of DIOMS Logo */}
            <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center pointer-events-none">
              <span className={`relative inline-flex rounded-full h-3 w-3 ${isConnected ? 'bg-emerald-500' : 'bg-slate-400'} border-2 border-white shadow-xs`} />
            </span>
          </button>

          {/* Action Buttons Group with generous spacing from DIOMS Logo */}
          <div className="flex items-center gap-1.5 ml-3 sm:ml-4 pl-2.5 sm:pl-3 border-l border-slate-200">
            {/* Tombol Kesiapan Izin Perangkat (Hanya ditampilkan jika ada izin yang belum aktif) */}
            {onOpenPermissions && permissionsStatus && !permissionsStatus.allGranted && (
              <button
                type="button"
                onClick={onOpenPermissions}
                className="relative p-1.5 sm:p-2 rounded-xl transition-all cursor-pointer border shadow-2xs flex items-center justify-center group active:scale-95 text-amber-600 bg-amber-50/70 border-amber-200 hover:bg-amber-100 hover:text-amber-700"
                title="Kesiapan Perangkat: Ada izin belum aktif (Notifikasi, Lokasi, atau Kamera). Klik untuk mengaktifkan."
                aria-label="Kesiapan Perangkat"
                id="header-permissions-button"
              >
                <Smartphone className="w-4 h-4 text-amber-700 group-hover:text-amber-800 transition-colors" />
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 pointer-events-none">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500 border-2 border-white"></span>
                </span>
              </button>
            )}

            {/* Tombol Sinkronisasi Data di samping kanan logo DIOMS */}
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="p-1.5 sm:p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 active:scale-95 rounded-xl transition-all cursor-pointer disabled:opacity-50 border border-slate-200/80 shadow-2xs flex items-center justify-center group"
                title={isRefreshing ? 'Menyinkronkan data...' : 'Sinkronisasi Data'}
                aria-label="Sinkronisasi Data"
                id="header-sync-data-button"
              >
                <RefreshCw className={`w-4 h-4 text-slate-600 group-hover:text-blue-600 transition-colors ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
              </button>
            )}

            {/* Tombol Keluar di samping kanan tombol Sinkronisasi Data */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="p-1.5 sm:p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 active:scale-95 rounded-xl transition-all cursor-pointer border border-slate-200/80 shadow-2xs flex items-center justify-center group"
                title="Keluar"
                aria-label="Keluar"
                id="header-logout-button"
              >
                <LogOut className="w-4 h-4 text-slate-600 group-hover:text-red-600 transition-colors" />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
