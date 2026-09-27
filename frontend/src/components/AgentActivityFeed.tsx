'use client';

import React, { useCallback, useEffect, useState } from 'react';

export interface FeedItem {
  id: string;
  time: string;
  agent: string;
  agentType: 'fraud' | 'compliance' | 'traceability' | 'quality' | 'consumer';
  title: string;
  details: string;
  badge?: { text: string; color: 'red' | 'green' | 'amber' | 'blue' };
}

const borderColorMap = {
  traceability: 'border-l-[#16a34a]', // Green
  compliance: 'border-l-blue-600',    // Blue
  fraud: 'border-l-[#dc2626]',         // Red
  quality: 'border-l-[#d97706]',       // Amber
  consumer: 'border-l-purple-600',     // Purple
};

/**
 * Live agent activity, read from `AiAgentLog` via /api/agents/feed.
 *
 * This component previously rendered a hardcoded list of eight invented
 * entries — a 94% spoilage probability, a Japan MRL conflict — none of which
 * came from a model or the database. It now shows what the agents actually
 * logged, and says so plainly when there is nothing yet.
 */
export default function AgentActivityFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/feed', { cache: 'no-store' });
      if (!res.ok) {
        setState('error');
        return;
      }
      const json = await res.json();
      if (json.success) {
        setItems(json.data ?? []);
        setState('ready');
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    // Deferred to a microtask so the `setState` at the top of `load` does not
    // run inside the effect body; the 10s poll then refreshes in place.
    Promise.resolve().then(load);
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-[#1a1a1a] flex items-center gap-2">
          <span>📡</span> Agent Activity Log
        </h3>
        <span className="text-xs font-semibold text-gray-500 flex items-center gap-1.5">
          <span className="pulsing-dot"></span> Refreshing every 10s
        </span>
      </div>

      {state === 'loading' && (
        <p className="text-xs text-gray-500 py-8 text-center">Loading agent activity…</p>
      )}

      {state === 'error' && (
        <div className="py-8 text-center space-y-1">
          <p className="text-xs font-semibold text-gray-700">Activity log unavailable</p>
          <p className="text-[11px] text-gray-500">
            The feed endpoint did not respond. No activity is being shown.
          </p>
        </div>
      )}

      {state === 'ready' && items.length === 0 && (
        <div className="py-8 text-center space-y-1">
          <p className="text-xs font-semibold text-gray-700">No agent runs recorded yet</p>
          <p className="text-[11px] text-gray-500">
            Entries appear here once an agent completes a task.
          </p>
        </div>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
          {items.map((item) => (
            <div
              key={item.id}
              className={`p-3.5 bg-[#FAFAF7] rounded-xl border border-gray-200 border-l-4 ${
                borderColorMap[item.agentType]
              } transition-all hover:bg-white hover:shadow-xs`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-400 font-medium">[{item.time}]</span>
                  <span className="text-xs font-bold text-[#1a1a1a]">{item.agent}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                      item.badge.color === 'red'
                        ? 'bg-red-100 text-red-700'
                        : item.badge.color === 'green'
                        ? 'bg-green-100 text-green-700'
                        : item.badge.color === 'amber'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-blue-100 text-blue-700'
                    }`}
                  >
                    {item.badge.text}
                  </span>
                )}
              </div>
              <p className="text-xs font-bold text-[#1a1a1a] mt-1">{item.title}</p>
              <p className="text-[11px] text-gray-500 mt-0.5 font-mono break-words">{item.details}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
