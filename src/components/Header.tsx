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
}

export const Header: React.FC<HeaderProps> = ({
  onOpenDiomsLogo
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

        {/* Right Side / DIOMS Logo */}
        <button
          type="button"
          onClick={onOpenDiomsLogo}
          className="shrink-0 flex items-center hover:opacity-85 transition-opacity cursor-pointer group focus:outline-none"
          title="Klik untuk memperbesar logo DIOMS"
        >
          <img 
            src="/DIOMS-1.png" 
            alt="DIOMS Logo" 
            className="h-8 w-auto object-contain group-hover:scale-105 transition-transform duration-200" 
            referrerPolicy="no-referrer" 
          />
        </button>
      </div>
    </header>
  );
};
