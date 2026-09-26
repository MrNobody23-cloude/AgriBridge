'use client';
import React, { useRef, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Truck, Package, Store, ShieldCheck, UserCheck,
  Activity, Users, BarChart3, Link2, LogOut, ChevronRight,
  Leaf, Globe, FileText
} from 'lucide-react';
import { hasPermission, Permission, Role } from '@/lib/permissions';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  permission?: Permission;
  section?: string;
}

const allNavItems: NavItem[] = [
  // Role dashboards
  { href: '/farmer', label: 'Farm Overview', icon: Leaf, permission: 'batch:create', section: 'My Dashboard' },
  { href: '/exporter', label: 'Export Console', icon: Package, permission: 'shipment:create', section: 'My Dashboard' },
  { href: '/transporter', label: 'Logistics & IoT', icon: Truck, permission: 'iot:manage', section: 'My Dashboard' },
  { href: '/importer', label: 'Import Receipt', icon: Globe, permission: 'shipment:update', section: 'My Dashboard' },
  { href: '/retailer', label: 'Retail Info', icon: Store, permission: 'ml:predict', section: 'My Dashboard' },
  { href: '/consumer', label: 'Verify Product', icon: UserCheck, permission: 'batch:read', section: 'My Dashboard' },
  { href: '/regulator', label: 'Compliance Audit', icon: ShieldCheck, permission: 'compliance:manage', section: 'My Dashboard' },
  { href: '/admin', label: 'System Admin', icon: Users, permission: 'users:manage', section: 'My Dashboard' },

  // Shared tools
  { href: '/trust-score', label: 'Trust Score', icon: BarChart3, permission: 'batch:read', section: 'Tools' },
  { href: '/agents', label: 'AI Agents', icon: Activity, permission: 'ai:use', section: 'Tools' },
  { href: '/verify', label: 'Batch Verify', icon: Link2, permission: 'batch:read', section: 'Tools' },
  { href: '/audit', label: 'Audit Logs', icon: FileText, permission: 'audit:view', section: 'Tools' },
];

export default function Sidebar({ user }: { user: any }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;

  const userRole = user.role as Role;

  // Filter nav items based on permission
  const visibleItems = allNavItems.filter((item) =>
    item.permission ? hasPermission(userRole, item.permission) : true
  );

  // Group by section
  const sections = Array.from(new Set(visibleItems.map(i => i.section)));
  const grouped = sections.map(s => ({
    section: s,
    items: visibleItems.filter(i => i.section === s),
  }));

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  };

  const sidebarWidth = collapsed ? 'w-[70px]' : 'w-[240px]';

  return (
    <aside
      className={`${sidebarWidth} glass-panel border-r-0 border-r-white/20 min-h-screen flex flex-col justify-between py-4 shadow-xl fixed left-0 top-0 bottom-0 z-40 transition-all duration-300 overflow-hidden`}
    >
      <div className="flex flex-col h-full overflow-hidden">
        {/* Logo + Collapse button */}
        <div className="flex items-center justify-between px-3 pb-4 mb-2 border-b border-white/20">
          <Link href="/" className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 min-w-9 rounded-xl bg-agro-green flex items-center justify-center text-white shadow-lg border border-white/20 flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            {!collapsed && (
              <div className="overflow-hidden">
                <h1 className="text-sm font-extrabold text-[#1a1a1a] tracking-tight leading-tight">AgriBridge AI</h1>
                <p className="text-[9px] font-bold text-tech-blue tracking-widest uppercase">Trust Platform</p>
              </div>
            )}
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded-lg hover:bg-white/30 text-gray-500 flex-shrink-0 hidden md:flex items-center"
          >
            <ChevronRight className={`w-4 h-4 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto space-y-4 px-2 sidebar-nav">
          {grouped.map(({ section, items }) => (
            <div key={section}>
              {!collapsed && (
                <p className="px-2 mb-2 text-[9px] font-extrabold text-gray-400 uppercase tracking-widest">{section}</p>
              )}
              <div className="space-y-1">
                {items.map((item) => {
                  const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-3 px-2.5 py-2 rounded-xl text-xs font-semibold transition-all group
                        ${isActive
                          ? 'bg-white/50 text-agro-green border border-white/60 shadow-sm font-bold'
                          : 'text-gray-600 hover:bg-white/30 hover:text-[#1a1a1a]'
                        }`}
                    >
                      <Icon className={`w-4.5 h-4.5 flex-shrink-0 ${isActive ? 'text-agro-green' : 'text-gray-400 group-hover:text-gray-700'}`} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer: User info + Logout */}
        <div className="px-2 pt-3 mt-auto border-t border-white/20">
          <div className={`flex items-center gap-3 px-2 py-2 rounded-xl mb-2 bg-white/20`}>
            <div className="w-8 h-8 min-w-8 rounded-full bg-agro-green text-white font-bold text-xs flex items-center justify-center shadow-md flex-shrink-0">
              {user.name?.substring(0, 2).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="overflow-hidden flex-1">
                <p className="text-xs font-bold text-[#1a1a1a] truncate">{user.name}</p>
                <p className="text-[10px] text-gray-500 capitalize truncate">{user.role?.toLowerCase()}</p>
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title={collapsed ? 'Logout' : undefined}
            className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-xs font-semibold text-red-500 hover:bg-red-50/50 transition-colors"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>{loggingOut ? 'Logging out...' : 'Logout'}</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
