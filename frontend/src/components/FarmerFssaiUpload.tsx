'use client';

import { useState } from 'react';

export default function FarmerFssaiUpload({ batchId, onUploaded }: { batchId: string; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [issuer, setIssuer] = useState('Food Safety and Standards Authority of India');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return setMessage('Choose a PDF, PNG, or JPEG FSSAI certificate.');
    if (file.size > 5 * 1024 * 1024) return setMessage('Certificate must be 5 MB or smaller.');
    setBusy(true); setMessage('');
    try {
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const fileBase64 = btoa(Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join(''));
      const response = await fetch('/api/certificates/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId, certificateType: 'FSSAI', issuer, issueDate, expiryDate, fileName: file.name, fileHash: hash, fileBase64 }) });
      const json = await response.json();
      if (!json.success) throw new Error(json.error?.message || 'Certificate upload failed.');
      setMessage(`FSSAI certificate recorded as ${json.data.certificate.verificationStatus}. ${json.data.blockchainTransactionHash ? `Ledger transaction: ${json.data.blockchainTransactionHash}` : 'Blockchain write is not configured or was unavailable; the application did not claim an on-chain record.'}`);
      setFile(null); onUploaded();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Certificate upload failed.'); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="mt-3 space-y-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 p-3">
    <p className="text-xs font-semibold text-slate-700">Upload FSSAI certificate for transporter and public traceability</p>
    <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] || null)} className="block w-full text-xs" required />
    <input value={issuer} onChange={(event) => setIssuer(event.target.value)} maxLength={120} placeholder="Issuing authority" className="w-full rounded-lg border px-3 py-2 text-xs" required />
    <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-500">Issue date<input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-xs" required /></label><label className="text-[10px] text-slate-500">Expiry date<input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} className="mt-1 w-full rounded-lg border px-2 py-2 text-xs" required /></label></div>
    <button disabled={busy} className="rounded-lg bg-emerald-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Uploading…' : 'Upload and record certificate'}</button>
    {message && <p role="status" className="break-words text-[11px] text-slate-600">{message}</p>}
  </form>;
}
