'use client';

import React, { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import AgentActivityFeed from '@/components/AgentActivityFeed';

interface AgentRegistryEntry {
  agent: string;
  label: string;
  status: 'OK' | 'UNAVAILABLE';
  modelLoaded: boolean;
  algorithm?: string | null;
  sklearnVersion?: string | null;
  reason?: string | null;
  requiredFeatures?: string[];
  evaluation?: Record<string, unknown> | null;
}

interface RegistryPayload {
  serviceReachable: boolean;
  agents: AgentRegistryEntry[];
  totalAgents: number;
  availableAgents: number;
  message?: string;
}

const ICONS: Record<string, string> = {
  traceability: '🔍',
  quality: '⭐',
  spoilage: '🦠',
  fraud: '🚨',
  compliance: '⚖️',
  trust: '👤',
};

const DESCRIPTIONS: Record<string, string> = {
  traceability: 'Custody chain continuity & physical plausibility',
  quality: 'Storage conditions to produce quality score',
  spoilage: 'Transit spoilage risk from cold-chain telemetry',
  fraud: 'Transaction, certificate and custody anomalies',
  compliance: 'EU Reg. 396/2005 MRL & certification screening',
  trust: 'Consumer authenticity verdict over the five above',
};

export default function AgentsPage() {
  const [registry, setRegistry] = useState<RegistryPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRegistry = async () => {
    try {
      const res = await fetch('/api/agents/trained', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setRegistry(json.data as RegistryPayload);
      } else {
        setRegistry({
          serviceReachable: false,
          agents: [],
          totalAgents: 6,
          availableAgents: 0,
          message: json.error?.message || 'Agent registry could not be read.',
        });
      }
    } catch {
      setRegistry({
        serviceReachable: false,
        agents: [],
        totalAgents: 6,
        availableAgents: 0,
        message: 'The Agents API could not be reached.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // `loading` initialises to `true`, so the first paint is already the
    // placeholder and the loader never has to set it back at the top. The poll
    // then refreshes the registry in place every 15s.
    Promise.resolve().then(loadRegistry);
    const interval = setInterval(loadRegistry, 15000);
    return () => clearInterval(interval);
  }, []);

  const available = registry?.availableAgents ?? 0;
  const total = registry?.totalAgents ?? 6;
  const unreachable = registry ? !registry.serviceReachable : false;

  return (
    <DashboardLayout title="AI Agent Command Center">
      {/* Top Banner Stats — every number here is a count the backend returned */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="glass-card p-5 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Models Loaded</p>
            <p className="text-2xl font-extrabold text-[#16a34a] mt-1">
              {loading ? '—' : `${available} of ${total}`}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              SHA-256 verified artifacts
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-white/50 border border-white/60 text-[#16a34a] flex items-center justify-center text-xl font-bold">
            🤖
          </div>
        </div>

        <div className="glass-card p-5 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AI Service</p>
            <p className={`text-2xl font-extrabold mt-1 ${unreachable ? 'text-[#dc2626]' : 'text-[#1a1a1a]'}`}>
              {loading ? '—' : unreachable ? 'Offline' : 'Connected'}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              {unreachable ? 'Status cannot be confirmed' : 'localhost:8000'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-white/50 border border-white/60 text-blue-700 flex items-center justify-center text-xl font-bold">
            ⚡
          </div>
        </div>
      </div>

      {unreachable && (
        <div className="glass-card p-4 mb-6 border-l-4 border-l-amber-500">
          <p className="text-sm font-bold text-[#1a1a1a]">Agent status unavailable</p>
          <p className="text-xs text-gray-600 mt-1">
            {registry?.message ??
              'The AI microservice did not respond, so no agent can be reported as running.'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold">Agent Status</h2>
            <p className="text-[11px] text-gray-500">
              An agent shows <span className="font-semibold text-[#16a34a]">Ready</span> only when its
              artifact passed its checksum and the model is loaded.
            </p>
          </div>

          {loading ? (
            <div className="glass-card p-8 text-center text-sm text-gray-500">
              Checking agent status…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(registry?.agents ?? []).map((entry) => (
                <AgentCard key={entry.agent} entry={entry} />
              ))}
            </div>
          )}

          {unreachable && (
            <div className="glass-card p-5">
              <p className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">
                Not configured
              </p>
              <p className="text-xs text-gray-600">
                The six trained agents cannot be reported on while the AI service is offline. Start it
                with <code className="font-mono text-[11px] bg-white/60 px-1.5 py-0.5 rounded">uvicorn main:app</code>{' '}
                in <code className="font-mono text-[11px] bg-white/60 px-1.5 py-0.5 rounded">ai-service/</code>.
              </p>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <AgentActivityFeed />
        </div>
      </div>
    </DashboardLayout>
  );
}

function AgentCard({ entry }: { entry: AgentRegistryEntry }) {
  const ready = entry.modelLoaded;
  return (
    <div className="glass-card p-4 flex flex-col space-y-3 relative overflow-hidden">
      {ready && (
        <div className="absolute top-0 right-0 w-16 h-16 bg-blue-100 rounded-full blur-[20px] opacity-20 pointer-events-none"></div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <span className="text-xl">{ICONS[entry.agent] || '🤖'}</span>
          {entry.label}
        </div>
        {ready ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase font-bold text-agro-green bg-green-50/50 px-2.5 py-1 rounded-full border border-green-200 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-agro-green"></span> Ready
          </span>
        ) : (
          <span className="text-[10px] uppercase font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-300 shrink-0">
            Not configured
          </span>
        )}
      </div>

      <p className="text-[11px] font-bold text-gray-500">
        {DESCRIPTIONS[entry.agent] ?? entry.algorithm}
      </p>

      <div className="bg-white/40 rounded-lg p-3 space-y-2 border border-white/50">
        {ready ? (
          <>
            <Row label="Algorithm" value={entry.algorithm ?? '—'} />
            <Row
              label="Trained on"
              value={entry.sklearnVersion ? `scikit-learn ${entry.sklearnVersion}` : 'not recorded'}
            />
            <Row label="Inputs" value={`${entry.requiredFeatures?.length ?? 0} features`} />
            {entry.evaluation && <Metrics evaluation={entry.evaluation} />}
          </>
        ) : (
          <p className="text-[11px] text-gray-600 leading-relaxed break-words">
            {entry.reason ?? 'No artifact recorded for this agent.'}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-3 text-[11px]">
      <span className="text-gray-500 uppercase font-semibold shrink-0">{label}</span>
      <span className="font-mono text-gray-800 text-right break-words">{value}</span>
    </div>
  );
}

/**
 * Offline evaluation numbers read from the committed metrics JSON. They describe
 * how the model scored on its own held-out set — not a live prediction, and
 * not something the service recomputes per request.
 */
function Metrics({ evaluation }: { evaluation: Record<string, unknown> }) {
  const entries = Object.entries(evaluation)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .slice(0, 4);

  if (entries.length === 0) return null;

  return (
    <div className="pt-2 border-t border-white/50">
      <span className="text-gray-500 uppercase font-semibold text-[11px] block mb-1">
        Held-out evaluation
      </span>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between text-[10px]">
            <span className="text-gray-500">{k.replace(/_/g, ' ')}</span>
            <span className="font-mono font-semibold text-gray-800">
              {typeof v === 'number' ? v.toFixed(3) : String(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
