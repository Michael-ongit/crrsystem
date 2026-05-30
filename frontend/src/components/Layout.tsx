// components/Layout.tsx - Main layout with sidebar and navigation
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { User, UserRole } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  currentUser: User | null;
  currentRole: UserRole;
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({
  children,
  currentUser,
  currentRole,
  onLogout,
}) => {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const fullAccessRoles = [UserRole.ADMIN, UserRole.PLANNING_MANAGER];
  const operationalAccessRoles = [...fullAccessRoles, UserRole.HQ_PROJECT_COORDINATOR];
  const dashboardRoles = [...operationalAccessRoles, UserRole.PROJECT_MANAGER];

  const navItems = [
    {
      label: 'Execution',
      path: '/execution',
      allowedRoles: [UserRole.EXECUTION, ...operationalAccessRoles],
      icon: 'EX',
    },
    {
      label: 'Planning',
      path: '/planning',
      allowedRoles: [UserRole.PLANNING, ...operationalAccessRoles],
      icon: 'PL',
    },
    {
      label: 'Production',
      path: '/production',
      allowedRoles: [UserRole.PRODUCTION, ...operationalAccessRoles],
      icon: 'PR',
    },
    {
      label: 'Dispatch Summary',
      path: '/dispatch-summary',
      allowedRoles: [UserRole.EXECUTION, ...operationalAccessRoles],
      icon: 'DS',
    },
    {
      label: 'Dashboard',
      path: '/dashboard',
      allowedRoles: dashboardRoles,
      icon: 'DB',
    },
    {
      label: 'Admin',
      path: '/admin',
      allowedRoles: fullAccessRoles,
      icon: 'AD',
    },
  ];

  const visibleNavItems = navItems.filter((item) =>
    item.allowedRoles.includes(currentRole)
  );

  return (
    <div className="flex h-screen bg-gray-100">
      <aside
        className={`relative flex flex-col bg-[#134377] text-white shadow-lg transition-all duration-300 ease-out ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        <div className="h-20 flex items-center justify-between gap-2 border-b border-white/15 px-4">
          {!isCollapsed && (
            <h1 className="text-sm font-bold leading-tight">
              Concrete Requisition & Reconciliation System
            </h1>
          )}
          <button
            type="button"
            onClick={() => setIsCollapsed((value) => !value)}
            className={`group ml-auto flex h-8 items-center justify-center rounded-md border border-white/20 bg-white/10 text-white transition-all duration-200 ease-out hover:bg-white/20 hover:shadow-sm ${
              isCollapsed ? 'w-8' : 'w-8'
            }`}
            aria-label={isCollapsed ? 'Expand side panel' : 'Collapse side panel'}
            title={isCollapsed ? 'Expand side panel' : 'Collapse side panel'}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded bg-white/15 text-xs font-bold" aria-hidden="true">
              {isCollapsed ? '>' : '<'}
            </span>
          </button>
        </div>

        {!isCollapsed ? (
          <Link
            to="/profile"
            className={`block border-b border-white/15 p-4 transition-colors ${
              location.pathname === '/profile' ? 'bg-white/15' : 'hover:bg-white/10'
            }`}
          >
            <p className="text-sm font-semibold">{currentUser?.name}</p>
            <p className="text-xs text-white/75">{currentRole}</p>
            <p className="text-xs text-white/60 truncate">{currentUser?.email}</p>
          </Link>
        ) : (
          <Link
            to="/profile"
            title="Profile"
            className={`mx-auto mt-4 flex h-10 w-10 items-center justify-center rounded-md border border-white/20 text-xs font-bold transition-colors ${
              location.pathname === '/profile' ? 'bg-white text-[#134377]' : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            {(currentUser?.name || currentUser?.email || 'U').slice(0, 2).toUpperCase()}
          </Link>
        )}

        <nav className="flex-1 p-4 space-y-2">
          {visibleNavItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              title={isCollapsed ? item.label : undefined}
              className={`flex items-center rounded-lg transition-all duration-200 ease-out ${
                isCollapsed ? 'justify-center px-2 py-3' : 'px-4 py-2'
              } ${
                location.pathname === item.path
                  ? 'bg-white text-[#134377]'
                  : 'text-white/85 hover:bg-white/10'
              }`}
            >
              <span className={`text-xs font-bold tracking-wide ${isCollapsed ? '' : 'mr-2'}`}>
                {item.icon}
              </span>
              {!isCollapsed && item.label}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-white/15">
          <button
            onClick={onLogout}
            title={isCollapsed ? 'Sign out' : undefined}
            className={`w-full rounded text-sm transition bg-[#134377] text-white/90 hover:bg-white/10 ${
              isCollapsed ? 'px-2 py-3 text-center' : 'px-3 py-2 text-left'
            }`}
          >
            {isCollapsed ? 'Out' : 'Sign out'}
          </button>
        </div>

        {!isCollapsed && (
          <div className="p-4 text-xs text-white/70 border-t border-white/15">
            <p>dev mode</p>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="px-6 pb-6 pt-4 lg:px-8 lg:pb-8 lg:pt-5">{children}</div>
      </main>
    </div>
  );
};

export default Layout;
