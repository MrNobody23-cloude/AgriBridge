'use client';
import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Search, User, LogOut, Settings } from 'lucide-react';
import type { SessionUser } from '@/lib/session';
import { LanguageSwitcher, useTranslation } from '@/components/LanguageProvider';

const pageTitles: Record<string, string> = {
  '/farmer': 'Farmer Overview',
  '/exporter': 'Export Console',
  '/transporter': 'Logistics & IoT',
  '/importer': 'Import Receipt',
  '/retailer': 'Retail Information',
  '/consumer': 'Consumer Verification',
  '/regulator': 'Compliance & Audit',
  '/admin': 'System Administrator',
  '/agents': 'AI Insights',
  '/trust-score': 'Trust Analysis',
};

export default function TopBar({ title: propTitle, user }: { title?: string; user?: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const title = propTitle || pageTitles[pathname] || 'Dashboard';
  const { t } = useTranslation();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [aiStatus, setAiStatus] = useState<'checking' | 'healthy' | 'down'>('checking');

  // Ask the health endpoint rather than assuming the AI service is up. The
  // badge stays amber — not red, not green — whenever the answer is unknown.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/health');
        const json = await res.json();
        if (cancelled) return;
        const status = json?.data?.services?.ml?.status;
        setAiStatus(status === 'healthy' ? 'healthy' : 'down');
      } catch {
        if (!cancelled) setAiStatus('down');
      }
    };
    check();
    const timer = setInterval(check, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const handleLogout = async () => {
    // `router.push` rather than `window.location.href`. The eslint rule
    // `no-location-assign-relative-destination` is not a style preference here:
    // assigning a *relative* href to `window.location` is how a logout silently
    // fails to navigate, and it throws away the client-side router that the rest
    // of the app is already using. A full `router.refresh()` afterwards clears
    // the server component cache so the old session is not still rendered.
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // The cookie is cleared server-side on a successful logout. If the request
      // itself failed, navigate anyway — the login page is the safe destination
      // either way, and staying put would show a stale authenticated shell.
    }
    router.push('/login');
    router.refresh();
  };

  return (
    <header className="dashboard-topbar h-16 glass-header px-6 flex items-center justify-between sticky top-0 z-30 transition-all rounded-b-2xl mx-6 mt-2">
      {/* Breadcrumb & Title */}
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <span className="font-medium hidden sm:inline">AgriBridge AI</span>
        <span className="hidden sm:inline">/</span>
        <span className="font-bold text-[#1a1a1a] text-sm">{t(title)}</span>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        {/* Search Bar */}
        <div className="relative hidden md:block">
          <input
            type="text"
            placeholder={t('Search trace, batch...')}
            className="w-56 pl-9 pr-4 py-1.5 text-xs bg-white/40 border border-white/60 rounded-full text-[#1a1a1a] placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-agro-green/50 backdrop-blur-md"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
        </div>

        {/* AI Tracker & Notifications
            This badge previously read "AI Operational" with a pulsing green dot
            on every page, unconditionally. Nothing was fetched and nothing was
            checked, so it asserted that the Python ML service was up on a
            machine where it was not running. It now asks /api/health and
            reports what came back; while the answer is in flight it says
            nothing rather than guessing. */}
        <div className="flex items-center gap-3">
          <div
            className={`hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold shadow-xs ${
              aiStatus === 'healthy'
                ? 'bg-white/50 border border-green-200/50 text-agro-green'
                : aiStatus === 'checking'
                  ? 'bg-white/50 border border-gray-200/50 text-gray-500'
                  : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}
          >
            {aiStatus === 'healthy' && <span className="pulsing-dot"></span>}
            {aiStatus === 'healthy'
              ? t('AI Operational')
              : aiStatus === 'checking'
                ? t('Checking AI…')
                : t('AI Not Running')}
          </div>

          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2 rounded-full hover:bg-white/40 transition-colors"
            >
              <Bell className="w-4 h-4 text-gray-700" />
              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
            {showNotifications && (
              <div className="absolute right-0 mt-3 w-80 glass-card p-3 space-y-2 z-50 animate-feed-slide-in">
                <div className="flex items-center justify-between border-b border-gray-200/50 pb-2">
                  <span className="text-xs font-bold text-[#1a1a1a]">{t('Updates')}</span>
                </div>
                <div className="text-xs text-gray-500 py-2 text-center">{t('No new notifications.')}</div>
              </div>
            )}
          </div>
        </div>

        {/* User Dropdown */}
        <div className="relative border-l border-white/30 pl-3">
          <button onClick={() => setShowUserDropdown(!showUserDropdown)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-full bg-gray-100 border border-white text-gray-700 flex items-center justify-center shadow-xs overflow-hidden">
              <User className="w-4 h-4" />
            </div>
            <div className="hidden md:flex flex-col text-left">
              <span className="text-xs font-bold text-[#1a1a1a] leading-none mb-1">{user?.name || 'User'}</span>
              <span className="text-[10px] uppercase font-bold text-agro-green leading-none">{user?.role || 'Guest'}</span>
            </div>
          </button>

          {showUserDropdown && (
            <div className="absolute right-0 mt-3 w-48 glass-card py-2 z-50 animate-feed-slide-in shadow-xl">
              <div className="px-4 py-2 border-b border-gray-200/50 mb-1">
                <p className="text-xs font-bold text-[#1a1a1a] truncate">{user?.email}</p>
              </div>
              <button className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-white/40 flex items-center gap-2 font-medium">
                <Settings className="w-3.5 h-3.5" /> {t('Settings')}
              </button>
              <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium">
                <LogOut className="w-3.5 h-3.5" /> {t('Logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
