/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { UserProfile, Role } from '../types';

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
}

export const Header: React.FC<HeaderProps> = ({
  userProfile,
  onOpenDiomsLogo,
  token,
}) => {
  const isConnected = Boolean(token || userProfile);

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

        {/* Right Side Controls: DIOMS Logo with Connection Indicator */}
        <div className="flex items-center gap-2.5">
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
        </div>
      </div>
    </header>
  );
};
