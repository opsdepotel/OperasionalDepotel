/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { UserProfile, Role } from '../types';
import { LogOut, RefreshCw, Settings } from 'lucide-react';

interface HeaderProps {
  userProfile: UserProfile | null;
  role: Role;
  onRoleChange: (newRole: Role) => void;
  onLogout: () => void;
  spreadsheetId: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenSettings?: () => void;
  activeView?: string;
}

export const Header: React.FC<HeaderProps> = ({
  userProfile,
  role,
  onRoleChange,
  onLogout,
  spreadsheetId,
  onRefresh,
  isRefreshing,
  onOpenSettings,
  activeView
}) => {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-100 shadow-sm px-4 py-3">
      <div className="max-w-md mx-auto flex items-center justify-between">
        {/* Brand & App Name */}
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-indigo-100">
            <span className="font-display font-bold text-white text-base tracking-wider">OP</span>
          </div>
          <div>
            <h1 className="font-display font-bold text-slate-800 text-sm leading-tight">Operasional</h1>
            <p className="text-xs text-slate-400 font-medium font-display leading-none mt-0.5">
              {userProfile?.nama ? `User: ${userProfile.nama}` : userProfile?.userId ? `User: ${userProfile.userId}` : 'Perusahaan'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Settings / Profile Button */}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className={`p-2 rounded-xl transition-all cursor-pointer ${
                activeView === 'profile-settings'
                  ? 'text-indigo-600 bg-indigo-50 font-bold'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
              title="Pengaturan Profil & Sandi"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all cursor-pointer"
            title="Sinkronisasi Data"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
          </button>

          {/* User Sign Out */}
          <button
            onClick={onLogout}
            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
            title="Keluar"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
