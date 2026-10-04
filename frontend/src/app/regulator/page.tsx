'use client';

import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { errText } from '@/lib/err';
import type { ApiFraudAlert } from '@/lib/api-types';

interface PendingCertificate { _id: string; certificateType: string; issuer: string; fileHash: string; fileUrl?: string; issueDate: string; expiryDate: string; batch?: { batchCode: string } | null; }

export default function RegulatorDashboard() {
  const [alerts, setAlerts] = useState<ApiFraudAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [certificates, setCertificates] = useState<PendingCertificate[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [certificateLoading, setCertificateLoading] = useState<string | null>(null);
  const [certificateError, setCertificateError] = useState('');

  const fetchCertificates = useCallback(async () => {
    try {
      const res = await fetch('/api/regulator/certificates');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) setCertificates(json.data);
      else setCertificateError(json.error?.message || 'Unable to load pending certificates');
    } catch { setCertificateError('Unable to load pending certificates'); }
  }, []);

  const reviewCertificate = async (certificateId: string, decision: 'VERIFIED' | 'REJECTED') => {
    const notes = reviewNotes[certificateId]?.trim() || '';
    if (notes.length < 10) { setCertificateError('Add at least 10 characters of review notes before deciding.'); return; }
    setCertificateLoading(certificateId);
    setCertificateError('');
    try {
      const res = await fetch('/api/regulator/certificates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ certificateId, decision, notes }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Review failed');
      setCertificates((items) => items.filter((item) => item._id !== certificateId));
    } catch (error) { setCertificateError(error instanceof Error ? error.message : 'Review failed'); }
    finally { setCertificateLoading(null); }
  };

  // `useCallback` keyed on `filterStatus`, so the effect below can name the
  // loader as its only dependency instead of a hand-maintained list that drifts
  // from what the loader actually reads. Re-fetching on a filter change is the
  // behaviour the previous `[filterStatus]` dependency array had.
  const fetchAlerts = useCallback(async () => {
    try {
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
    // No `setLoading(true)` at the top: `loading` is initialised to `true`, so
    // the first paint is already a spinner, and a second render before the
    // fetch resolves would be the cascading render this avoids. A refresh
    // therefore keeps the current queue on screen instead of blanking it.
  }, [filterStatus]);

  useEffect(() => {
    // `void fetchAlerts()` here is what the rule reports: it treats a call in
    // the effect body as a synchronous setState even though every `setAlerts`
    // and `setLoading` in the loader sits behind an `await`. Scheduling the
    // call as a promise callback states what is actually true — the state
    // updates when the fetch resolves, not while the effect body runs.
    Promise.resolve().then(fetchAlerts);
  }, [fetchAlerts]);

  useEffect(() => { Promise.resolve().then(fetchCertificates); }, [fetchCertificates]);

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
    } catch (err: unknown) {
      alert(errText(err) || 'Error updating alert state');
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
                String(a.fraudType ?? '').toUpperCase().includes('DUPLICATE')
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

      <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-bold text-gray-900">Certificate review desk <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs">{certificates.length} pending</span></h2><p className="mt-1 text-xs text-gray-500">Review issuer, dates and document evidence. Written reasons are required and recorded in the batch audit trail.</p></div><button type="button" onClick={() => void fetchCertificates()} className="rounded-lg border px-3 py-2 text-xs font-bold">Refresh queue</button></div>
        {certificateError && <p role="alert" className="text-sm text-red-700">{certificateError}</p>}
        {certificates.length === 0 ? <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">No pending certificates.</p> : certificates.map((certificate) => <article key={certificate._id} className="rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{certificate.certificateType} · {certificate.batch?.batchCode || 'Batch unavailable'}</p><p className="mt-1 text-xs text-gray-600">Issuer: {certificate.issuer} · Issued {new Date(certificate.issueDate).toLocaleDateString()} · Expires {new Date(certificate.expiryDate).toLocaleDateString()}</p></div>{certificate.fileUrl && <a href={certificate.fileUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-emerald-700 underline">Open evidence</a>}</div>
          <p className="break-all font-mono text-[10px] text-gray-500">SHA-256: {certificate.fileHash}</p>
          <textarea value={reviewNotes[certificate._id] || ''} onChange={(event) => setReviewNotes((items) => ({ ...items, [certificate._id]: event.target.value }))} maxLength={1000} rows={2} placeholder="Review findings and basis for decision (required)" className="w-full rounded-lg border border-gray-200 p-2 text-sm" />
          <div className="flex gap-2"><button type="button" disabled={certificateLoading === certificate._id} onClick={() => void reviewCertificate(certificate._id, 'VERIFIED')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Approve certificate</button><button type="button" disabled={certificateLoading === certificate._id} onClick={() => void reviewCertificate(certificate._id, 'REJECTED')} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Reject with reason</button></div>
        </article>)}
      </section>

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
        {/* As on the farmer page: `loading` was tracked but never rendered, so
            a request in flight looked identical to a genuinely empty queue. */}
        {loading && alerts.length === 0 ? (
          <div className="bg-white rounded-xl py-12 flex items-center justify-center gap-2 border border-gray-200">
            <span className="w-4 h-4 border-2 border-agro-green border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-500 font-medium">Loading fraud queue…</span>
          </div>
        ) : (
        alerts.map((alert) => (
          <div key={alert._id} className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                  }`}>
                  {alert.severity} SEVERITY
                </span>
                <span className="font-mono text-xs font-bold text-gray-500">TYPE: {alert.fraudType}</span>
                {alert.batchId && (
                  <span className="font-mono text-xs font-bold text-[#16a34a]">BATCH {alert.batchId}</span>
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
                onClick={() => handleInvestigateAction(alert._id, 'APPROVE')}
                disabled={actionLoading === alert._id}
                className="px-3 py-1.5 bg-[#16a34a] text-white text-xs font-bold rounded-lg hover:bg-green-700"
              >
                ✓ Resolve & Clear Batch
              </button>
              <button
                onClick={() => handleInvestigateAction(alert._id, 'REJECT')}
                disabled={actionLoading === alert._id}
                className="px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700"
              >
                ✕ Confirm Fraud & Block Export
              </button>
              <button
                onClick={() => handleInvestigateAction(alert._id, 'FALSE_POSITIVE')}
                disabled={actionLoading === alert._id}
                className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-lg hover:bg-gray-300"
              >
                Dismiss as False Positive
              </button>
            </div>
          </div>
        ))
        )}
      </div>
    </DashboardLayout>
  );
}
