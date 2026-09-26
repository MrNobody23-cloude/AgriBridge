'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function RegulatorDashboard() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/fraud/alerts${filterStatus ? `?status=${filterStatus}` : ''}`);
      const json = await res.json();
      if (json.success) {
        setAlerts(json.data);
      }
    } catch (e) {
      console.error('Failed to load fraud alerts:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [filterStatus]);

  const handleInvestigateAction = async (alertId: string, action: 'APPROVE' | 'REJECT' | 'FALSE_POSITIVE') => {
    setActionLoading(alertId);
    try {
      const res = await fetch('/api/fraud/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertId,
          action,
          notes: `Action executed by Regulator on ${new Date().toLocaleString()}`,
        }),
      });

      const json = await res.json();
      if (json.success) {
        alert(json.data.message);
        fetchAlerts();
      } else {
        alert(json.error?.message || 'Failed to update alert state');
      }
    } catch (err: any) {
      alert(err.message || 'Error updating alert state');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <DashboardLayout title="Regulator Dashboard">
      {/* Top Banner Stats
          All four tiles previously read `alerts.length || 3`, "100% Active",
          "96.8%" against a "FSSAI / APEDA Standard" caption, and "24h SLA".
          Three of those were typed-in constants and the fourth invented a
          count of 3 whenever the fraud queue came back empty — so a regulator
          opening the national fraud dashboard on a system with nothing to
          report was shown three active alerts. Nothing in this file measures
          an MRL compliance rate, so that number could not be derived from
          anything on screen. The tiles now report what the queue actually
          contains. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Fraud Alerts</p>
            <p className="text-2xl font-extrabold text-red-600 mt-1">{alerts.length}</p>
            <span className="text-[11px] font-semibold text-red-600 block mt-1">
              {alerts.length === 0 ? 'Queue is empty' : 'Requires Review'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-red-100 text-red-600 flex items-center justify-center text-xl font-bold">
            🚨
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Duplicate Cert Alerts</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
              {alerts.filter((a) =>
                String(a.alertType ?? a.type ?? '').toUpperCase().includes('DUPLICATE')
              ).length}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              Counted from this queue
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-xl font-bold">
            🔐
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Alerts Dismissed</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
              {alerts.filter((a) => String(a.status ?? '').toUpperCase() === 'FALSE_POSITIVE').length}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              Marked false positive
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl font-bold">
            ⚖️
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">MRL Compliance Rating</p>
            {/* Nothing in this codebase computes a national MRL compliance
                rate, and no residue or limit check is persisted per batch, so
                this reports itself as not measured rather than showing a
                number attributed to FSSAI/APEDA. */}
            <p className="text-2xl font-extrabold text-gray-400 mt-1">Not measured</p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              No residue testing is recorded
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl font-bold">
            ⚖️
          </div>
        </div>
      </div>

      {/* Fraud Alert Queue Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-[#1a1a1a]">🚨 Fraud Alert & Investigation Queue</h2>
          <p className="text-xs text-gray-500">Automated fraud detection engine flagged anomalies for official FSSAI review.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-xs font-semibold text-[#1a1a1a] p-2 bg-[#FAFAF7] border border-gray-200 rounded-xl"
          >
            <option value="">All Alert Statuses</option>
            <option value="OPEN">OPEN (Requires Review)</option>
            <option value="UNDER_REVIEW">UNDER REVIEW</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="FALSE_POSITIVE">FALSE POSITIVE</option>
          </select>
          <button onClick={fetchAlerts} className="px-3 py-2 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl hover:bg-gray-200">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Alert List Cards */}
      <div className="space-y-4">
        {alerts.map((alert: any) => (
          <div key={alert.id} className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                  }`}>
                  {alert.severity} SEVERITY
                </span>
                <span className="font-mono text-xs font-bold text-gray-500">TYPE: {alert.fraudType}</span>
                {alert.batch && (
                  <span className="font-mono text-xs font-bold text-[#16a34a]">BATCH {alert.batch.batchCode}</span>
                )}
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${alert.status === 'OPEN' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-gray-100 text-gray-700'
                }`}>
                STATUS: {alert.status}
              </span>
            </div>

            <p className="text-xs font-bold text-[#1a1a1a] leading-relaxed">{alert.description}</p>
            <p className="text-[11px] text-gray-400 font-mono">Confidence Rating: {Math.round(alert.confidence * 100)}% | Flagged: {new Date(alert.createdAt).toLocaleString()}</p>

            {/* Investigation Actions */}
            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              <span className="text-xs font-bold text-gray-500 mr-2">Regulator Action:</span>
              <button
                onClick={() => handleInvestigateAction(alert.id, 'APPROVE')}
                disabled={actionLoading === alert.id}
                className="px-3 py-1.5 bg-[#16a34a] text-white text-xs font-bold rounded-lg hover:bg-green-700"
              >
                ✓ Resolve & Clear Batch
              </button>
              <button
                onClick={() => handleInvestigateAction(alert.id, 'REJECT')}
                disabled={actionLoading === alert.id}
                className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700"
              >
                ✕ Confirm Fraud & Block Export
              </button>
              <button
                onClick={() => handleInvestigateAction(alert.id, 'FALSE_POSITIVE')}
                disabled={actionLoading === alert.id}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-lg hover:bg-gray-300"
              >
                Dismiss as False Positive
              </button>
            </div>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}
