'use client';

import { useState } from 'react';
import FarmerWorkbench from '@/components/FarmerWorkbench';
import FarmerAutomationDashboard from '@/components/FarmerAutomationDashboard';

type DashboardView = 'farm' | 'telegram';

/**
 * Keep both farmer experiences available while avoiding two dashboard shells
 * being rendered at once. The crop-tracking workbench and the Telegram/n8n
 * marketplace dashboard remain separate, fully functional implementations.
 */
export default function FarmerPage() {
  const [activeView, setActiveView] = useState<DashboardView>('farm');

  return (
    <div className="min-h-screen">
      <nav
        aria-label="Farmer dashboard views"
        className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
          <span className="mr-2 text-sm font-bold text-slate-700">Farmer dashboard:</span>
          <button
            type="button"
            aria-pressed={activeView === 'farm'}
            onClick={() => setActiveView('farm')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeView === 'farm'
                ? 'bg-emerald-800 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Crop Tracking Workbench
          </button>
          <button
            type="button"
            aria-pressed={activeView === 'telegram'}
            onClick={() => setActiveView('telegram')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              activeView === 'telegram'
                ? 'bg-emerald-800 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Crop Listing Dashboard
          </button>
        </div>
      </nav>

      {activeView === 'farm' ? <FarmerWorkbench /> : <FarmerAutomationDashboard />}
    </div>
  );
}
