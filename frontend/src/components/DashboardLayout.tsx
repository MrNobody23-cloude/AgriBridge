'use client';
import React, { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@/lib/session';
import { dashboardForRole, ROLE_BY_DASHBOARD } from '@/lib/role-routes';
import { usePathname } from 'next/navigation';
import { ROLE_WORKFLOWS } from '@/lib/role-workflows';
import Link from 'next/link';
import { useTranslation } from '@/components/LanguageProvider';

function translateStaticTree(node: React.ReactNode, translate: (text: string) => string): React.ReactNode {
  if (typeof node === 'string') {
    const leading = node.match(/^\s*/)?.[0] || '';
    const trailing = node.match(/\s*$/)?.[0] || '';
    const content = node.trim();
    return content ? `${leading}${translate(content)}${trailing}` : node;
  }
  if (Array.isArray(node)) return node.map((child) => translateStaticTree(child, translate));
  if (!React.isValidElement(node)) return node;

  const element = node as React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
  const props = { ...element.props };
  for (const key of ['placeholder', 'title', 'aria-label']) {
    if (typeof props[key] === 'string') props[key] = translate(props[key] as string);
  }
  if (props.children !== undefined) props.children = translateStaticTree(props.children, translate);
  return React.cloneElement(element, props);
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function DashboardLayout({ children, title }: DashboardLayoutProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data) {
            const sessionUser = data.data as SessionUser;
            const requiredRole = ROLE_BY_DASHBOARD[pathname];
            if (requiredRole && sessionUser.role !== requiredRole) {
              router.replace(dashboardForRole(sessionUser.role));
              return;
            }
            setUser(sessionUser);
          } else {
            router.push('/login');
          }
        } else {
          router.push('/login');
        }
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-agro-green flex items-center justify-center text-white text-lg shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          </div>
          <p className="text-sm font-semibold text-gray-500 animate-pulse">Loading AgriBridge...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;
  const workflow = ROLE_WORKFLOWS[user.role as keyof typeof ROLE_WORKFLOWS];
  const localizedChildren = translateStaticTree(children, t);

  return (
    <div className="dashboard-shell min-h-screen relative overflow-hidden bg-[#FAFAF7]">
      {/* Glassmorphism background orbs */}
      <div className="fixed top-[-15%] right-[-5%] w-[45%] h-[45%] bg-blue-50 rounded-full blur-[100px] pointer-events-none opacity-60 z-0" />
      <div className="fixed bottom-[-15%] left-[-5%] w-[45%] h-[45%] bg-green-50 rounded-full blur-[100px] pointer-events-none opacity-60 z-0" />
      <div className="fixed top-[40%] left-[30%] w-[25%] h-[25%] bg-emerald-50 rounded-full blur-[80px] pointer-events-none opacity-30 z-0" />

      <div className="relative z-10 flex">
        {/* Sidebar — fixed, full height */}
        <Sidebar user={user} />

        {/* Main content area — offset by sidebar width */}
        <div className="dashboard-content flex-1 min-w-0 ml-[240px] transition-all duration-300">
          <TopBar title={title} user={user} />
          <main className="dashboard-main p-6 space-y-6">
            {workflow && <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-100 bg-white/90 px-5 py-4 shadow-sm" aria-label="Role responsibilities">
              <div className="max-w-3xl"><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-emerald-700">{t(workflow.title)}</p><p className="mt-1 text-sm text-gray-600">{t(workflow.duty)}</p></div>
              <div className="flex flex-wrap gap-2">{workflow.actions.map((action) => <Link key={action.label} href={action.href} className="rounded-lg border border-emerald-100 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50">{t(action.label)}</Link>)}</div>
            </section>}
            {localizedChildren}
          </main>
        </div>
      </div>
    </div>
  );
}
