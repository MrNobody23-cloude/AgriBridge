'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import type { ApiShipment, ApiComplianceResult } from '@/lib/api-types';
import { errText } from '@/lib/err';

export default function ExporterDashboard() {
  const [shipments, setShipments] = useState<ApiShipment[]>([]);
  const [batches, setBatches] = useState<Array<{ _id: string; batchCode: string; product?: { name?: string } | null; quantity: number; unit?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [batchLoading, setBatchLoading] = useState(true);
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [actionMessage, setActionMessage] = useState('');

  // Modal / Action states
  const [destinationCountry, setDestinationCountry] = useState('UK');
  // Empty, not 'AG-2847'. The field was pre-filled with a code the exporter
  // never chose, so submitting the form created a shipment against whatever
  // batch happened to match — or against nothing.
  const [batchId, setBatchId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [creatingShipment, setCreatingShipment] = useState(false);

  // RAG Compliance State
  const [complianceCountry, setComplianceCountry] = useState('UK');
  const [complianceShipmentId, setComplianceShipmentId] = useState('');
  const [ragResult, setRagResult] = useState<ApiComplianceResult | null>(null);
  const [checkingCompliance, setCheckingCompliance] = useState(false);

  // Certificate Upload State
  const [certType, setCertType] = useState('APEDA Phytosanitary Certificate');
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certIssuer, setCertIssuer] = useState('');
  const [certIssueDate, setCertIssueDate] = useState('');
  const [certExpiryDate, setCertExpiryDate] = useState('');
  const [uploadingCert, setUploadingCert] = useState(false);

  const fetchShipments = async () => {
    try {
      const res = await fetch('/api/shipments');
      const json = await res.json();
      if (json.success) {
        setShipments(json.data);
      }
    } catch (e) {
      console.error('Failed to load shipments:', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchBatches = async () => {
    try {
      const response = await fetch('/api/batches?limit=100');
      const result = await response.json();
      if (response.ok && result.success) setBatches(result.data?.batches ?? []);
    } catch (error) {
      console.error('Failed to load eligible batches:', error);
    } finally {
      setBatchLoading(false);
    }
  };

  useEffect(() => {
    // Deferred to a microtask, and `loading` is never set to `true` here. It
    // initialises to `true`, so the first paint is already a spinner; a second
    // render before the fetch resolves is the cascade this avoids. A manual
    // refresh therefore keeps the current table visible instead of blanking it
    // to "Loading shipments…" for a list the user was already reading.
    Promise.resolve().then(() => Promise.all([fetchShipments(), fetchBatches()]));
  }, []);

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchId || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) {
      setActionMessage('Select a real batch and enter a positive shipment quantity.');
      return;
    }
    setCreatingShipment(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          destinationCountry,
          quantity: Number(quantity),
        }),
      });

      const json = await res.json();
      if (json.success) {
        setActionMessage(`Shipment ${json.data.shipment.shipmentCode} created. Compliance findings are shown with their recorded sources.`);
        setComplianceShipmentId(json.data.shipment.shipmentCode);
        setComplianceCountry(destinationCountry);
        await fetchShipments();
      } else {
        alert(json.error?.message || 'Failed to create shipment');
      }
    } catch (err: unknown) {
      alert(errText(err) || 'Server error creating shipment');
    } finally {
      setCreatingShipment(false);
    }
  };

  const handleCheckRAG = async () => {
    if (!complianceShipmentId) {
      setActionMessage('Select one of your recorded shipments before looking up its evidence.');
      return;
    }
    setCheckingCompliance(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentId: complianceShipmentId, country: complianceCountry }),
      });
      const json = await res.json();
      if (json.success) {
        setRagResult(json.data);
      }
    } catch (e) {
      console.error('RAG check failed:', e);
    } finally {
      setCheckingCompliance(false);
    }
  };

  const handleUploadCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchId || !certFile || !certIssuer.trim() || !certIssueDate || !certExpiryDate) {
      setActionMessage('Choose a batch, select the certificate file, and enter the issuer shown on the certificate.');
      return;
    }
    if (certFile.size > 5 * 1024 * 1024) {
      setActionMessage('Certificate files must be 5 MB or smaller.');
      return;
    }
    setUploadingCert(true);
    setActionMessage('');
    try {
      const fileBytes = await certFile.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', fileBytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fileHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the certificate file'));
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.readAsDataURL(certFile);
      });

      const res = await fetch('/api/certificates/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          certificateType: certType,
          fileName: certFile.name,
          fileBase64,
          fileHash,
          issuer: certIssuer.trim(),
          issueDate: certIssueDate,
          expiryDate: certExpiryDate,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setActionMessage(json.data.message);
        setCertFile(null);
      } else {
        setActionMessage(json.error?.message || 'Failed to upload certificate');
      }
    } catch (err: unknown) {
      setActionMessage(errText(err) || 'Error uploading certificate');
    } finally {
      setUploadingCert(false);
    }
  };

  const visibleShipments = shipments.filter((shipment) => {
    const matchesStatus = statusFilter === 'ALL' || shipment.status?.toUpperCase() === statusFilter;
    const search = shipmentSearch.trim().toLowerCase();
    const matchesSearch = !search || [shipment.shipmentCode, shipment.destinationCountry, shipment.batch?.batchCode, shipment.batch?.product?.name]
      .some((value) => value?.toLowerCase().includes(search));
    return matchesStatus && matchesSearch;
  });

  const exportShipmentsCsv = () => {
    const rows = [
      ['Shipment', 'Batch', 'Product', 'Destination', 'Quantity', 'Unit', 'Status', 'Risk score'],
      ...visibleShipments.map((s) => [s.shipmentCode, s.batch?.batchCode || '', s.batch?.product?.name || '', s.destinationCountry, String(s.quantity), s.unit || 'kg', s.status, String(s.riskScore)]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'agribridge-export-shipments.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout title="Exporter Dashboard">
      <section className="relative overflow-hidden rounded-3xl bg-[#163f2d] px-6 py-7 text-white shadow-lg sm:px-8">
        <div className="absolute -right-10 -top-20 h-56 w-56 rounded-full bg-[#90b77c]/20 blur-2xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c8dfbb]">Exporter workspace</p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Move produce with clear records.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">Create shipments from registered batches, review available evidence, and keep certificate records tied to their source files.</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm"><span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">Your shipment feed</span><strong className="mt-1 block text-xl">{shipments.length}</strong></div>
        </div>
      </section>
      {/* Top Banner Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Banner stats
            These four tiles read `shipments.length || 6`, a fixed "98.4% RAG
            Compliance Pass" against a "UK, UAE, USA, Japan" caption, a fixed
            "14 Verified" certificate count, and a fixed "1 Flagged / MRL
            Limit Warning". None was measured: no pass rate is computed
            anywhere, no MRL limit is ever tested, and the two counts were
            constants that rendered even when the shipment list was empty.
            The tiles now count what was fetched. */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Export Shipments</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">{shipments.length}</p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              {shipments.length === 0 ? 'None recorded' : 'In this account'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold">
            🚢
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Compliance Checks Run</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
              {shipments.filter((s) => (s.complianceChecks?.length ?? 0) > 0 && s.complianceChecks!.some((c) => c.status !== 'PENDING')).length}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 mt-1 block">
              RAG runs per shipment, not a pass rate
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl font-bold">
            ⚖️
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Screened Shipments</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
              {shipments.filter((s) => (s.complianceChecks?.length ?? 0) > 0).length} / {shipments.length}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block">
              With a recorded compliance result
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-xl font-bold">
            🔐
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">High Risk Shipments</p>
            <p className="text-2xl font-extrabold text-amber-600 mt-1">
              {shipments.filter((s) => Number(s.riskScore) >= 60).length} Flagged
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              Risk score 60 or above
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl font-bold">
            🚨
          </div>
        </div>
      </div>

      {/* Main Grid: Create Shipment + RAG Checker */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Shipment Form */}
        <div className="lg:col-span-1 bg-white rounded-xl p-6 border border-gray-200 shadow-xs space-y-4">
          <div className="border-b border-gray-100 pb-3">
            <h2 className="text-base font-bold text-[#1a1a1a] flex items-center gap-2">
              <span>🚢</span> Create Export Shipment
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Link batch to international destination & trigger RAG screening.
            </p>
          </div>

          <form onSubmit={handleCreateShipment} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-[#1a1a1a] mb-1">Target Crop Batch Code</label>
              <select
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                className="w-full text-xs font-semibold text-[#1a1a1a] p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
                required
                disabled={batchLoading || batches.length === 0}
              >
                <option value="">{batchLoading ? 'Loading batches…' : batches.length ? 'Choose a registered batch' : 'No registered batches available'}</option>
                {batches.map((batch) => <option key={batch._id} value={batch.batchCode}>{batch.batchCode} · {batch.product?.name || 'Produce'} · {batch.quantity} {batch.unit || 'kg'}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#1a1a1a] mb-1">Destination Country</label>
              <select
                value={destinationCountry}
                onChange={(e) => setDestinationCountry(e.target.value)}
                className="w-full text-xs font-semibold text-[#1a1a1a] p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
              >
                <option value="UK">United Kingdom (UK)</option>
                <option value="UAE">United Arab Emirates (UAE)</option>
                <option value="USA">United States (FDA/USDA)</option>
                <option value="Japan">Japan (MHLW Positive List)</option>
                <option value="Singapore">Singapore (AVA Standard)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#1a1a1a] mb-1">Export Quantity (kg)</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full text-xs font-semibold text-[#1a1a1a] p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
                placeholder="e.g. 2400"
                required
              />
            </div>

            <button
              type="submit"
              disabled={creatingShipment}
              className="w-full py-3 px-4 bg-[#16a34a] text-white text-xs font-bold rounded-xl shadow-sm hover:bg-green-700 transition-all flex items-center justify-center gap-2"
            >
              {creatingShipment ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  RAG Screening...
                </>
              ) : (
                '🚢 Create Shipment'
              )}
            </button>
          </form>
        </div>

        {/* AI RAG Compliance Knowledge Checker */}
        <div className="lg:col-span-2 bg-white rounded-xl p-6 border border-gray-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-100 pb-3 gap-2">
            <div>
              <h2 className="text-base font-bold text-[#1a1a1a] flex items-center gap-2">
                <span>🔎</span> Shipment Evidence Review
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Review retrieved records for a shipment. This does not constitute regulatory clearance.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={complianceShipmentId}
                onChange={(e) => {
                  setComplianceShipmentId(e.target.value);
                  const selected = shipments.find((shipment) => shipment.shipmentCode === e.target.value);
                  if (selected) setComplianceCountry(selected.destinationCountry);
                }}
                aria-label="Shipment to review"
                className="text-xs font-bold text-[#1a1a1a] p-2 bg-[#FAFAF7] border border-gray-200 rounded-xl"
              >
                <option value="">Choose shipment</option>
                {shipments.map((shipment) => <option key={shipment._id} value={shipment.shipmentCode}>{shipment.shipmentCode} · {shipment.destinationCountry}</option>)}
              </select>
              <select
                value={complianceCountry}
                onChange={(e) => setComplianceCountry(e.target.value)}
                className="text-xs font-bold text-[#1a1a1a] p-2 bg-[#FAFAF7] border border-gray-200 rounded-xl"
              >
                <option value="UK">United Kingdom</option>
                <option value="UAE">United Arab Emirates</option>
                <option value="USA">United States</option>
                <option value="Japan">Japan</option>
              </select>
              <button
                onClick={handleCheckRAG}
                disabled={checkingCompliance || !complianceShipmentId}
                className="px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700"
              >
                {checkingCompliance ? 'Checking...' : 'Run RAG Check'}
              </button>
            </div>
          </div>

          {ragResult ? (
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 font-medium">
                {ragResult.summary}
              </div>
              <div className="space-y-2">
                {ragResult.checks?.map((chk, idx) => (
                  <div key={idx} className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200 text-xs flex justify-between items-center">
                    <div>
                      <span className="font-bold text-[#1a1a1a]">{chk.requirement}</span>
                      <p className="text-gray-500 text-[11px] mt-0.5">{chk.explanation}</p>
                      <span className="text-[10px] text-gray-400 font-mono">Source: {chk.source}</span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-green-100 text-[#16a34a]">
                      {chk.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-gray-500 bg-[#FAFAF7] rounded-xl border border-dashed border-gray-300">
              Select a target export country above and click &quot;Run RAG Check&quot; to test regulatory compliance.
            </div>
          )}

          {/* Certificate SHA-256 Hashing Upload */}
          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-xs font-bold text-[#1a1a1a] mb-2">Record a Certificate Document</h3>
            <form onSubmit={handleUploadCertificate} className="flex flex-col sm:flex-row gap-2">
              <select value={batchId} onChange={(e) => setBatchId(e.target.value)} required className="text-xs font-semibold p-2 bg-[#FAFAF7] border border-gray-200 rounded-xl">
                <option value="">Choose batch</option>
                {batches.map((batch) => <option key={batch._id} value={batch.batchCode}>{batch.batchCode}</option>)}
              </select>
              <select
                value={certType}
                onChange={(e) => setCertType(e.target.value)}
                className="text-xs font-semibold p-2 bg-[#FAFAF7] border border-gray-200 rounded-xl"
              >
                <option value="APEDA Phytosanitary Certificate">APEDA Phytosanitary Certificate</option>
                <option value="GLOBALG.A.P Organic Certificate">GLOBALG.A.P Organic Certificate</option>
                <option value="FSSAI Export Quality Clearance">FSSAI Export Quality Clearance</option>
              </select>
              <input
                type="file"
                onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                accept=".pdf,.png,.jpg,.jpeg"
                required
                className="text-xs text-gray-500 p-1 border border-gray-200 rounded-xl bg-white"
              />
              <input type="text" value={certIssuer} onChange={(e) => setCertIssuer(e.target.value)} placeholder="Issuer as printed" required className="min-w-0 text-xs p-2 border border-gray-200 rounded-xl" />
              <input type="date" value={certIssueDate} onChange={(e) => setCertIssueDate(e.target.value)} aria-label="Certificate issue date" required className="text-xs p-2 border border-gray-200 rounded-xl" />
              <input type="date" value={certExpiryDate} onChange={(e) => setCertExpiryDate(e.target.value)} aria-label="Certificate expiry date" required className="text-xs p-2 border border-gray-200 rounded-xl" />
              <button
                type="submit"
                disabled={uploadingCert}
                className="px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded-xl hover:bg-purple-700 shrink-0"
              >
                {uploadingCert ? 'Verifying file bytes…' : 'Upload document'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {actionMessage && <div role="status" className="rounded-xl border border-[#dfe8dc] bg-white px-4 py-3 text-sm text-[#385542]">{actionMessage}</div>}

      {/* Shipments Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3 justify-between">
          <div><h3 className="text-base font-bold text-[#1a1a1a]">Export Shipment Ledger</h3><p className="mt-1 text-xs text-gray-500">Search, filter, and export this account&apos;s shipment feed.</p></div>
          <div className="flex flex-wrap gap-2">
            <input value={shipmentSearch} onChange={(e) => setShipmentSearch(e.target.value)} placeholder="Search shipment or batch" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs"><option value="ALL">All statuses</option>{[...new Set(shipments.map((s) => s.status).filter(Boolean))].map((status) => <option key={status} value={status.toUpperCase()}>{status}</option>)}</select>
            <button type="button" onClick={exportShipmentsCsv} className="rounded-lg bg-[#1b4b34] px-3 py-2 text-xs font-bold text-white">Export CSV</button>
            <button type="button" onClick={() => { void fetchShipments(); }} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-[#16a34a]">Refresh</button>
          </div>
          <span className="text-xs font-medium text-gray-500">
            {loading ? 'Loading shipments…' : `Showing ${visibleShipments.length} of ${shipments.length}`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#1a1a1a]">
            <thead className="bg-[#FAFAF7] text-gray-500 font-semibold border-b border-gray-200 uppercase text-[11px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Shipment ID</th>
                <th className="py-3 px-4">Batch Code</th>
                <th className="py-3 px-4">Crop</th>
                <th className="py-3 px-4">Destination</th>
                <th className="py-3 px-4">Quantity</th>
                <th className="py-3 px-4">Risk Score</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleShipments.map((ship, idx) => (
                <tr key={ship._id || idx} className="hover:bg-gray-50">
                  <td className="py-3 px-4 font-mono font-bold text-blue-600">{ship.shipmentCode}</td>
                  {/* A shipment whose batch relation is missing previously
                      rendered "AG-2847 / Alphonso Mango", so a row with no
                      provenance behind it still looked like a traced export.
                      The code was invented precisely to be looked up later, and
                      a lookup of a fabricated code cannot succeed. Say the
                      link is missing instead. */}
                  <td className="py-3 px-4 font-mono font-bold text-[#16a34a]">
                    {ship.batch?.batchCode ?? <span className="text-gray-400 font-medium">No batch linked</span>}
                  </td>
                  <td className="py-3 px-4 font-semibold text-[#1a1a1a]">
                    {ship.batch?.product?.name ?? <span className="text-gray-400 font-medium">Unknown product</span>}
                  </td>
                  <td className="py-3 px-4 font-bold text-gray-700">{ship.destinationCountry}</td>
                  <td className="py-3 px-4 text-gray-600">{ship.quantity} kg</td>
                  <td className="py-3 px-4 font-extrabold text-[#16a34a]">{ship.riskScore} / 100</td>
                  <td className="py-3 px-4">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800">
                      {ship.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
