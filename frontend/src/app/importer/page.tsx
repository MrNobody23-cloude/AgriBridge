'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import type { ApiComplianceResult } from '@/lib/api-types';

interface Shipment {
  id: string;
  shipmentCode: string;
  destinationCountry: string;
  quantity: number;
  status: string;
  riskScore: number;
  createdAt: string;
  batch?: { batchCode: string; product?: { name: string } };
  complianceChecks?: Array<{ country: string; status: string; requirement: string }>;
}

export default function ImporterDashboard() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);
  // Shipment chosen for the compliance panel — persists after the detail modal closes.
  const [complianceShipment, setComplianceShipment] = useState<Shipment | null>(null);

  // Compliance check
  const [complianceCountry, setComplianceCountry] = useState('UK');
  // Empty, not a pre-filled sample code. This defaulted to
  // 'AGR-2026-UK-284701', so pressing "Run Import Screening" without
  // choosing anything screened that batch — or silently failed against a
  // batch that does not exist, depending on what was seeded.
  const [batchCodeForCompliance, setBatchCodeForCompliance] = useState('');
  const [complianceResult, setComplianceResult] = useState<ApiComplianceResult | null>(null);
  const [checkingCompliance, setCheckingCompliance] = useState(false);
  const [complianceError, setComplianceError] = useState('');

  const fetchShipments = async () => {
    try {
      const res = await fetch('/api/shipments');
      const json = await res.json();
      if (json.success) setShipments(json.data);
    } catch (e) {
      console.error('Failed to load shipments:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // `loading` initialises to `true`, so the first paint is already the
    // spinner and nothing sets it back at the top of the loader. A refresh
    // keeps the ledger on screen instead of blanking it.
    Promise.resolve().then(fetchShipments);
  }, []);

  // The shipment an operator actually clicked is the one they mean to screen,
  // so that is what the batch field follows. Previously the field kept whatever
  // it was last typed with, and defaulted to a hardcoded code.
  //
  // This is done in the click handler rather than an effect keyed on
  // `selectedShipment`: the effect was a second render that reconstructed what
  // the handler already knew, and it could only ever run *after* the modal
  // opened. Setting both values where the click happens says what is true —
  // choosing a shipment fills in its batch.
  const selectShipment = (ship: Shipment) => {
    setSelectedShipment(ship);
    setComplianceShipment(ship);
    if (ship.batch?.batchCode) {
      setBatchCodeForCompliance(ship.batch.batchCode);
      setComplianceCountry(ship.destinationCountry || 'UK');
    }
  };

  const handleCheckCompliance = async () => {
    // Screening runs against a shipment. With none selected, there is nothing
    // to screen.
    if (!batchCodeForCompliance.trim() || !complianceShipment) return;
    setCheckingCompliance(true);
    setComplianceResult(null);
    setComplianceError('');
    try {
      const res = await fetch('/api/compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipmentId: complianceShipment.shipmentCode || complianceShipment.id,
          country: complianceCountry,
          crop: complianceShipment.batch?.product?.name,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) setComplianceResult(json.data);
      else setComplianceError(json.error?.message || 'Evidence lookup failed.');
    } catch (e) {
      setComplianceError(e instanceof Error ? e.message : 'Evidence lookup failed.');
    } finally {
      setCheckingCompliance(false);
    }
  };

  const riskColor = (score: number) =>
    score < 30 ? 'text-[#16a34a] bg-green-50' : score < 60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';

  const visibleShipments = shipments.filter((shipment) => {
    const statusMatches = statusFilter === 'ALL' || shipment.status.toUpperCase() === statusFilter;
    const search = shipmentSearch.trim().toLowerCase();
    const searchMatches = !search || [shipment.shipmentCode, shipment.batch?.batchCode, shipment.batch?.product?.name, shipment.destinationCountry]
      .some((value) => value?.toLowerCase().includes(search));
    return statusMatches && searchMatches;
  });

  const exportShipmentCsv = () => {
    const rows = [
      ['Shipment', 'Batch', 'Product', 'Destination', 'Quantity', 'Status', 'Risk score', 'Compliance checks'],
      ...visibleShipments.map((s) => [s.shipmentCode, s.batch?.batchCode || '', s.batch?.product?.name || '', s.destinationCountry, String(s.quantity), s.status, String(s.riskScore), String(s.complianceChecks?.length || 0)]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'agribridge-inbound-shipments.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout title="Importer Dashboard">
      <section className="relative overflow-hidden rounded-3xl bg-[#193f59] px-6 py-7 text-white shadow-lg sm:px-8">
        <div className="absolute -right-10 -top-20 h-56 w-56 rounded-full bg-sky-300/20 blur-2xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-200">Importer workspace</p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Review every inbound record.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">Search shipment and batch feeds, inspect supporting records, and run an evidence lookup before your team makes a clearance decision.</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm"><span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">Shipment records</span><strong className="mt-1 block text-xl">{shipments.length}</strong></div>
        </div>
      </section>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Incoming Shipments</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">{shipments.length || 0}</p>
            <span className="text-[11px] font-semibold text-[#16a34a] block mt-1">Multi-Origin Tracking</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl">📦</div>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Cleared Customs</p>
            <p className="text-2xl font-extrabold text-[#16a34a] mt-1">
              {shipments.filter(s => s.status === 'Delivered').length}
            </p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">Shipment status: Delivered</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl">✅</div>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recorded Compliance Checks</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
              {shipments.reduce((total, shipment) => total + (shipment.complianceChecks?.length || 0), 0)} Checks
            </p>
            <span className="text-[11px] font-semibold text-purple-600 block mt-1">Recorded in shipment feed</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-xl">⚖️</div>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">High Risk</p>
            <p className="text-2xl font-extrabold text-red-600 mt-1">
              {shipments.filter(s => s.riskScore >= 60).length}
            </p>
            <span className="text-[11px] font-semibold text-red-600 block mt-1">Requires Review</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-red-100 text-red-600 flex items-center justify-center text-xl">🚨</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* RAG Compliance Checker */}
        <div className="lg:col-span-1 bg-white rounded-xl p-6 border border-gray-200 shadow-xs space-y-4">
          <div className="border-b border-gray-100 pb-3">
            <h2 className="text-sm font-bold text-[#1a1a1a] flex items-center gap-2">🔎 Shipment Evidence Review</h2>
            <p className="text-xs text-gray-500 mt-0.5">Review retrieved records for a shipment. This is not regulatory clearance.</p>
          </div>
          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase">Import Country</label>
              <select value={complianceCountry} onChange={(e) => setComplianceCountry(e.target.value)}
                className="w-full text-xs p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl mt-1">
                <option value="UK">United Kingdom</option>
                <option value="EU">European Union</option>
                <option value="USA">United States</option>
                <option value="UAE">United Arab Emirates</option>
                <option value="Japan">Japan</option>
                <option value="Singapore">Singapore</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase">Batch Code</label>
              <input type="text" value={batchCodeForCompliance} onChange={(e) => setBatchCodeForCompliance(e.target.value)}
                placeholder="Select a shipment above, or type a batch code"
                className="w-full text-xs p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl mt-1 font-mono" />
            </div>
            <button onClick={handleCheckCompliance}
              disabled={checkingCompliance || !batchCodeForCompliance.trim() || !complianceShipment}
              className="w-full py-2.5 bg-[#16a34a] text-white text-xs font-bold rounded-xl hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
              {checkingCompliance ? 'Looking up evidence…' : 'Review shipment evidence'}
            </button>
            {complianceError && <p role="alert" className="text-xs font-semibold text-red-600">{complianceError}</p>}
            {(!batchCodeForCompliance.trim() || !complianceShipment) && (
              <p className="text-[11px] text-gray-400">
                No shipment selected. Click a shipment in the table to fill this in.
              </p>
            )}
          </div>
          {complianceResult && (
            <div className="space-y-2 pt-2">
              <div className={`p-3 rounded-xl text-xs font-semibold ${complianceResult.passed ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                {complianceResult.passed ? '✓ Compliance Cleared' : '⚠️ Review Required'}
              </div>
              <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{complianceResult.summary}</p>
              {/* The RAG service returns sources in two shapes: a list of plain
                  strings from the retrieval path, and a list of
                  `{ title, source }` objects from the citation path
                  (`ai-service/rag/pipeline.py:210,250,260`). `src.source || src`
                  handled that by accident — an object is always truthy, so
                  `src.source` was taken and a string fell through. Narrowing
                  keeps both shapes and never renders `[object Object]`. */}
              {complianceResult.sources?.slice(0, 2).map((src, i) => (
                <p key={i} className="text-[10px] font-mono text-gray-400">
                  📄 {typeof src === 'string' ? src : (src.source || src.title)}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Shipment Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
            <div><h3 className="text-sm font-bold text-[#1a1a1a]">Inbound Shipment Ledger</h3><p className="mt-1 text-xs text-gray-500">Search shipments, inspect recorded evidence, and review exceptions.</p></div>
            <div className="flex flex-wrap gap-2">
              <input value={shipmentSearch} onChange={(e) => setShipmentSearch(e.target.value)} placeholder="Search shipment, batch, country" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs"><option value="ALL">All statuses</option>{[...new Set(shipments.map((s) => s.status))].map((status) => <option key={status} value={status.toUpperCase()}>{status}</option>)}</select>
              <button type="button" onClick={exportShipmentCsv} className="rounded-lg bg-[#1b4b34] px-3 py-2 text-xs font-bold text-white">Export CSV</button>
              <button type="button" onClick={() => { void fetchShipments(); }} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-[#16a34a]">Refresh</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1a1a1a]">
              <thead className="bg-[#FAFAF7] text-gray-500 font-semibold border-b border-gray-200 text-[11px] uppercase">
                <tr>
                  <th className="py-3 px-4">Shipment ID</th>
                  <th className="py-3 px-4">Batch / Crop</th>
                  <th className="py-3 px-4">Destination</th>
                  <th className="py-3 px-4">Qty</th>
                  <th className="py-3 px-4">Risk</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">Loading shipments...</td></tr>
                ) : visibleShipments.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">No shipments match your search and filters.</td></tr>
                ) : (
                  visibleShipments.map((ship, idx) => (
                    <tr key={ship.id || idx} className="hover:bg-gray-50 cursor-pointer" onClick={() => selectShipment(ship)}>
                      <td className="py-3 px-4 font-mono font-bold text-blue-600">{ship.shipmentCode}</td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-[#1a1a1a]">{ship.batch?.product?.name || '—'}</div>
                        <div className="font-mono text-[11px] text-[#16a34a]">{ship.batch?.batchCode}</div>
                      </td>
                      <td className="py-3 px-4 font-bold">{ship.destinationCountry}</td>
                      <td className="py-3 px-4 text-gray-600">{ship.quantity?.toLocaleString()} kg</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${riskColor(ship.riskScore)}`}>
                          {ship.riskScore}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800">{ship.status}</span>
                      </td>
                      <td className="py-3 px-4 text-[#16a34a] font-bold text-[11px]">Details →</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Shipment Detail Modal */}
      {selectedShipment && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full border border-gray-200 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-[#1a1a1a]">Shipment {selectedShipment.shipmentCode}</h3>
              <button onClick={() => setSelectedShipment(null)} className="text-gray-400 hover:text-gray-600 font-bold">✕</button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200">
                  <p className="text-gray-400 text-[10px] uppercase font-bold">Batch Code</p>
                  <p className="font-mono font-bold text-[#16a34a] mt-0.5">{selectedShipment.batch?.batchCode}</p>
                </div>
                <div className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200">
                  <p className="text-gray-400 text-[10px] uppercase font-bold">Product</p>
                  <p className="font-bold text-[#1a1a1a] mt-0.5">{selectedShipment.batch?.product?.name}</p>
                </div>
                <div className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200">
                  <p className="text-gray-400 text-[10px] uppercase font-bold">Destination</p>
                  <p className="font-bold text-[#1a1a1a] mt-0.5">{selectedShipment.destinationCountry}</p>
                </div>
                <div className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200">
                  <p className="text-gray-400 text-[10px] uppercase font-bold">Risk Score</p>
                  <p className={`font-extrabold mt-0.5 ${riskColor(selectedShipment.riskScore)}`}>{selectedShipment.riskScore} / 100</p>
                </div>
              </div>
              {selectedShipment.complianceChecks && selectedShipment.complianceChecks.length > 0 && (
                <div className="space-y-2 pt-2">
                  <p className="text-[10px] font-bold text-gray-500 uppercase">RAG Compliance Checks</p>
                  {selectedShipment.complianceChecks.map((chk, i) => (
                    <div key={i} className="flex justify-between items-center p-2 bg-[#FAFAF7] rounded-lg border border-gray-200">
                      <span className="font-semibold text-[#1a1a1a]">{chk.requirement}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${chk.status === 'PASSED' ? 'bg-green-100 text-[#16a34a]' : 'bg-amber-100 text-amber-700'}`}>{chk.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
