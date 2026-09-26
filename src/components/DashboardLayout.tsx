'use client';
import React, { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { useRouter } from 'next/navigation';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function DashboardLayout({ children, title }: DashboardLayoutProps) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data) {
            setUser(data.data);
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
  }, [router]);

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

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#FAFAF7]">
      {/* Glassmorphism background orbs */}
      <div className="fixed top-[-15%] right-[-5%] w-[45%] h-[45%] bg-blue-50 rounded-full blur-[100px] pointer-events-none opacity-60 z-0" />
      <div className="fixed bottom-[-15%] left-[-5%] w-[45%] h-[45%] bg-green-50 rounded-full blur-[100px] pointer-events-none opacity-60 z-0" />
      <div className="fixed top-[40%] left-[30%] w-[25%] h-[25%] bg-emerald-50 rounded-full blur-[80px] pointer-events-none opacity-30 z-0" />

      <div className="relative z-10 flex">
        {/* Sidebar — fixed, full height */}
        <Sidebar user={user} />

        {/* Main content area — offset by sidebar width */}
        <div className="flex-1 min-w-0 ml-[240px] transition-all duration-300">
          <TopBar title={title} user={user} />
          <main className="p-6 space-y-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
