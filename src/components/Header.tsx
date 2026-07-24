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
        {/* Left Side / Brand */}
        <div className="flex items-center gap-2">
          <img 
            src="/DEPOTEL_rounded22.jpg" 
            alt="DEPOTEL Logo" 
            className="h-8 w-auto object-contain"
            referrerPolicy="no-referrer"
          />
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
