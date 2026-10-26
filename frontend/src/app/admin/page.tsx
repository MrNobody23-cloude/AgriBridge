'use client';

import { useCallback, useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

const collections = ['users', 'batches', 'certificates', 'orders', 'inventory', 'fraud', 'shipments', 'events', 'audit'] as const;
type RecordRow = Record<string, unknown> & { id: string; _id: string };

export default function AdminDashboard() {
  const [collection, setCollection] = useState<string>('users');
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await fetch(`/api/admin/records?collection=${collection}`); const json = await response.json(); if (!json.success) throw new Error(json.error?.message || 'Could not load records.'); setRecords(json.data || []); setSelected(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load records.'); } finally { setLoading(false); }
  }, [collection]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch synchronizes the record list with the selected collection.
  useEffect(() => { void refresh(); }, [refresh]);
  function choose(record: RecordRow) { setSelected(record); setDraft(JSON.stringify(record, null, 2)); setMessage(''); }
  async function mutate(method: 'PATCH' | 'DELETE') {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      let body: Record<string, unknown>;
      if (method === 'DELETE') { if (!window.confirm(`Permanently delete this ${collection} record?`)) return; body = { collection, id: selected.id || selected._id }; }
      else { const parsed = JSON.parse(draft) as Record<string, unknown>; body = { collection, id: selected.id || selected._id, changes: parsed }; }
      const response = await fetch('/api/admin/records', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const json = await response.json(); if (!json.success) throw new Error(json.error?.message || 'Record action failed.');
      setMessage(method === 'DELETE' ? 'Record deleted.' : 'Record updated and audit logged.'); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Record action failed.'); }
  }
  async function reviewCertificate(decision: 'VERIFIED' | 'REJECTED') {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/certificates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ certificateId: selected.id || selected._id, decision, notes: reviewNotes }) });
      const json = await response.json(); if (!json.success) throw new Error(json.error?.message || 'Certificate review failed.');
      setMessage(`Certificate ${decision.toLowerCase()} and ledger/audit event recorded.`); setReviewNotes(''); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Certificate review failed.'); }
  }
  return <DashboardLayout title="Administration · full record access">
    <section className="rounded-2xl bg-gradient-to-r from-slate-950 to-emerald-950 p-6 text-white"><p className="text-xs font-bold uppercase tracking-widest text-emerald-200">Administrative control</p><h1 className="mt-2 text-2xl font-extrabold">Review and manage platform records</h1><p className="mt-2 max-w-3xl text-sm text-white/70">Admins can inspect all records, edit supported fields, delete mutable records, and review certificates. Trace events and audit records remain append-only for accountability.</p></section>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <section className="grid gap-5 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.15fr)]"><article className="overflow-hidden rounded-2xl border bg-white"><div className="flex items-center gap-2 border-b p-4"><select value={collection} onChange={(e) => setCollection(e.target.value)} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm">{collections.map((name) => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}</select><button onClick={() => void refresh()} className="rounded-lg border px-3 py-2 text-sm">Refresh</button></div><div className="max-h-[70vh] divide-y overflow-y-auto">{loading ? <p className="p-8 text-center text-sm text-slate-500">Loading records…</p> : records.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No records found.</p> : records.map((record) => <button key={record.id || record._id} onClick={() => choose(record)} className={`w-full p-3 text-left hover:bg-emerald-50 ${selected?.id === record.id ? 'bg-emerald-50' : ''}`}><p className="truncate text-sm font-bold">{String(record.name || record.batchCode || record.certificateType || record.status || record._id)}</p><p className="mt-1 truncate font-mono text-[10px] text-slate-500">{String(record.email || record.id || record._id)}</p></button>)}</div><p className="border-t p-3 text-[11px] text-slate-500">Showing up to 200 recent records. Use record details for supported edits.</p></article>
      <article className="space-y-3 rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold">Record editor</h2><p className="text-xs text-slate-500">Fields are allowlisted by record type and changes are written to audit log.</p></div>{selected && <div className="flex gap-2"><button disabled={['events', 'audit'].includes(collection)} onClick={() => void mutate('PATCH')} className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Save edits</button><button disabled={['events', 'audit'].includes(collection)} onClick={() => void mutate('DELETE')} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Delete</button></div>}</div>{selected ? <><textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} className="min-h-[55vh] w-full rounded-xl border bg-slate-950 p-4 font-mono text-xs leading-5 text-emerald-100" />{collection === 'certificates' && selected.verificationStatus === 'PENDING' && <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-900">Certificate review · decisions are recorded on the batch timeline and audit trail</p><textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} minLength={10} maxLength={1000} placeholder="Review evidence and explain the decision (10–1000 characters)" className="w-full rounded-lg border bg-white p-2 text-sm" /><div className="flex gap-2"><button disabled={reviewNotes.trim().length < 10} onClick={() => void reviewCertificate('VERIFIED')} className="rounded-lg bg-emerald-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Verify certificate</button><button disabled={reviewNotes.trim().length < 10} onClick={() => void reviewCertificate('REJECTED')} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Reject certificate</button></div></div>}<p className="text-[11px] text-slate-500">Only API allowlisted fields change. Immutable events and audit entries cannot be edited or deleted.</p></> : <div className="grid min-h-72 place-items-center rounded-xl border border-dashed text-sm text-slate-500">Choose a record to inspect and manage.</div>}</article></section>
  </DashboardLayout>;
}
