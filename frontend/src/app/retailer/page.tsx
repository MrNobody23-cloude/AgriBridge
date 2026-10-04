'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import DashboardLayout from '@/components/DashboardLayout';
import TrustScoreGauge from '@/components/TrustScoreGauge';
import RecentBatchCodes from '@/components/RecentBatchCodes';
import type { ApiBatchDetail, ApiSpoilageResult } from '@/lib/api-types';

interface Batch {
  _id?: string;
  id?: string;
  batchCode: string;
  trustScore: number;
  status: string;
  product?: { name: string };
  farmer?: { name?: string };
  quantity?: number;
  unit?: string;
  location: string;
  harvestDate: string;
}

export default function RetailerDashboard() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [batchSearch, setBatchSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [scanCode, setScanCode] = useState('');
  const [scannedBatch, setScannedBatch] = useState<ApiBatchDetail | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');

  // ML spoilage check
  const [spoilageLoading, setSpoilageLoading] = useState(false);
  const [spoilageResult, setSpoilageResult] = useState<ApiSpoilageResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [spoilageError, setSpoilageError] = useState('');

  const fetchBatches = async (offset = 0) => {
    try {
      const res = await fetch(`/api/batches?limit=100&offset=${offset}`);
      const json = await res.json();
      if (json.success) {
        const rawBatches: Batch[] = Array.isArray(json.data)
          ? json.data
          : Array.isArray(json.data?.batches)
            ? json.data.batches
            : [];
        setBatches((current) => offset > 0 ? [...current, ...rawBatches] : rawBatches);
        setBatchTotal(Number(json.data?.total ?? rawBatches.length));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // `loading` initialises to `true` and is not set again at the top of the
    // loader, so the first render is the spinner and no render is triggered
    // before the fetch resolves.
    Promise.resolve().then(() => fetchBatches());
  }, []);

  const handleScanVerify = async (code?: string) => {
    const target = code || scanCode;
    if (!target) return;
    setScanLoading(true);
    setScanError('');
    setScannedBatch(null);
    setSpoilageResult(null);
    setSpoilageError('');
    setQrDataUrl('');
    try {
      const res = await fetch(`/api/batches/${encodeURIComponent(target)}`);
      const json = await res.json();
      if (json.success) {
        setScannedBatch(json.data);
      } else {
        setScanError(json.error?.message || 'Batch not found');
      }
    } catch {
      setScanError('Network error. Please try again.');
    } finally {
      setScanLoading(false);
    }
  };

  const handleSpoilageCheck = async () => {
    if (!scannedBatch?.batchCode) return;
    setSpoilageLoading(true);
    setSpoilageError('');
    try {
      const res = await fetch('/api/ml/spoilage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: scannedBatch.batchCode }),
      });
      const json = await res.json();
      if (json.success) setSpoilageResult(json.data);
      else setSpoilageError(json.error?.message || 'No spoilage prediction was returned.');
    } catch (e) {
      setSpoilageError(e instanceof Error ? e.message : 'Spoilage check failed.');
    } finally {
      setSpoilageLoading(false);
    }
  };

  const handleGenerateQr = async () => {
    if (!scannedBatch?.batchCode) return;
    setQrLoading(true);
    try {
      const response = await fetch(`/api/batches/${encodeURIComponent(scannedBatch.batchCode)}/qr`);
      const result = await response.json();
      if (response.ok && result.success) setQrDataUrl(result.data.qrDataUrl);
      else setScanError(result.error?.message || 'Could not generate a verification QR.');
    } catch {
      setScanError('Could not generate a verification QR.');
    } finally {
      setQrLoading(false);
    }
  };

  const trustColor = (score: number) =>
    score >= 80 ? 'text-[#16a34a]' : score >= 60 ? 'text-amber-600' : 'text-red-600';

  const riskBadge = (risk: string) => {
    const map: Record<string, string> = {
      LOW: 'bg-green-100 text-[#16a34a]',
      MEDIUM: 'bg-amber-100 text-amber-700',
      HIGH: 'bg-red-100 text-red-700',
      CRITICAL: 'bg-red-200 text-red-900',
    };
    return map[risk] || 'bg-gray-100 text-gray-700';
  };

  /* The prediction is nested under `prediction`, not flat. The retailer page
     read `spoilageResult.riskLevel` / `.remainingShelfLifeDays` — names that
     exist nowhere on the response, so a successful check rendered as an empty
     risk badge and "NaN days". These two are the only paths into the result. */
  const prediction = spoilageResult?.prediction;
  const visibleBatches = batches.filter((batch) => {
    const statusMatches = statusFilter === 'ALL' || batch.status.toUpperCase() === statusFilter;
    const search = batchSearch.trim().toLowerCase();
    const searchMatches = !search || [batch.batchCode, batch.product?.name, batch.location, batch.farmer?.name]
      .some((value) => value?.toLowerCase().includes(search));
    return statusMatches && searchMatches;
  });

  const exportInventoryCsv = () => {
    const rows = [
      ['Batch', 'Product', 'Origin', 'Farmer', 'Harvest date', 'Quantity', 'Status', 'Trust score'],
      ...visibleBatches.map((b) => [b.batchCode, b.product?.name || '', b.location, b.farmer?.name || '', b.harvestDate, `${b.quantity ?? ''} ${b.unit || 'kg'}`, b.status, String(b.trustScore)]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'agribridge-retail-inventory.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout title="Retailer Dashboard">
      <section className="relative overflow-hidden rounded-3xl bg-[#4d3822] px-6 py-7 text-white shadow-lg sm:px-8">
        <div className="absolute -right-10 -top-20 h-56 w-56 rounded-full bg-amber-300/20 blur-2xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200">Retailer workspace</p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Verify what reaches the shelf.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">Look up a printed batch code, inspect traceability evidence, and request a spoilage estimate when a supported model is available.</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm"><span className="block text-[10px] font-bold uppercase tracking-wider text-white/60">Loaded / total batches</span><strong className="mt-1 block text-xl">{batches.length} / {batchTotal}</strong></div>
        </div>
      </section>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Traceable Batches</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">{batches.length}</p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">Current batch feed records</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl">🏪</div>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">QR Scan Ready</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
              {batches.length
                ? `${batches.filter((b) => Boolean(b.batchCode)).length} / ${batches.length}`
                : '–'}
            </p>
            {/* These two tiles previously read "100% / Consumer Accessible" and
                "Blockchain Backed". Neither is a measurement: every batch
                renders a QR, and no chain call happens on this page at all, so
                claiming blockchain backing was an assertion this screen could
                not have known to be true. */}
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              Batches with a batch code
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-xl">📱</div>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Trust Score</p>
            {/* Averaged over batches that actually carry a score. A batch with
                trustScore 0 has not been assessed, and averaging those in as
                zeroes would understate the ones that have — so they are
                excluded, and when nothing is scored the tile says so instead of
                falling back to a hardcoded 85. */}
            {(() => {
              const scored = batches.filter((b) => Number(b.trustScore) > 0);
              if (scored.length === 0) {
                return (
                  <>
                    <p className="text-2xl font-extrabold text-gray-400 mt-1">Not computed</p>
                    <span className="text-[11px] font-semibold text-gray-500 block mt-1">
                      No batch has been scored
                    </span>
                  </>
                );
              }
              const avg = Math.round(
                scored.reduce((s, b) => s + Number(b.trustScore), 0) / scored.length
              );
              return (
                <>
                  <p className={`text-2xl font-extrabold mt-1 ${trustColor(avg)}`}>{avg} / 100</p>
                  <span className="text-[11px] font-semibold text-gray-500 block mt-1">
                    Across {scored.length} scored {scored.length === 1 ? 'batch' : 'batches'}
                  </span>
                </>
              );
            })()}
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl">⭐</div>
        </div>
        {/* "XGBoost ML Active / Spoilage AI / Real-time Shelf Life" was
            printed unconditionally. Nothing polls the model: spoilage is
            computed on request via /api/ml/spoilage, and a 200 there means
            the service answered, not that a prediction is current. The tile
            now reports the last prediction actually made, if any. */}
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Shelf-Life Prediction</p>
            {prediction ? (
              <>
                <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
                  {prediction.estimatedRemainingDays ?? '—'}
                  <span className="text-sm font-bold text-gray-400 ml-1">days</span>
                </p>
                <span className="text-[11px] font-semibold text-purple-600 block mt-1">
                  From the last scan
                </span>
              </>
            ) : (
              <>
                <p className="text-2xl font-extrabold text-gray-400 mt-1">Not run</p>
                <span className="text-[11px] font-semibold text-gray-500 block mt-1">
                  Scan a batch to predict shelf life
                </span>
              </>
            )}
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xl">🦠</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* QR / Batch Scan */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs space-y-3">
            <h2 className="text-sm font-bold text-[#1a1a1a]">📱 Verify a Product Batch</h2>
            <p className="text-xs text-gray-500">Enter the batch code printed beside the product QR to inspect traceability and freshness data.</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleScanVerify()}
                placeholder="AGR-2026-UK-284701"
                className="flex-1 text-xs font-mono p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
              />
              <button onClick={() => handleScanVerify()} disabled={scanLoading}
                className="px-3 py-2 bg-[#16a34a] text-white text-xs font-bold rounded-xl hover:bg-green-700">
                {scanLoading ? '...' : 'Scan'}
              </button>
            </div>
            {/* Unlabelled demo scans, truncated to their last six digits so
                they were the least identifiable strings on the page. Only
                codes that resolve in the ledger are offered now. */}
            <RecentBatchCodes
              codes={batches.map((b) => b.batchCode).filter(Boolean)}
              onPick={(code) => { setScanCode(code); handleScanVerify(code); }}
            />
            {scanError && <p className="text-xs font-semibold text-red-600">⚠️ {scanError}</p>}
          </div>

          {/* Scanned batch card */}
          {scannedBatch && (
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs space-y-4 text-center">
              <div className="inline-block">
                <TrustScoreGauge score={scannedBatch.trustScoreDetails?.finalScore ?? scannedBatch.trustScore ?? 0} size={130} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#1a1a1a]">{scannedBatch.product?.name}</h3>
                <p className="text-xs font-mono text-[#16a34a]">{scannedBatch.batchCode}</p>
                <p className="text-xs text-gray-500 mt-1">
                  by {scannedBatch.farmer?.name || 'Not recorded'} · {scannedBatch.location}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">Chain check: <span className="font-bold">{scannedBatch.chainVerification?.status || 'Not returned'}</span> · {scannedBatch.events?.length || 0} recorded supply-chain events</p>
              </div>
              <div className="flex gap-2">
                <button onClick={handleGenerateQr} disabled={qrLoading} className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-bold text-[#385542]">{qrLoading ? 'Generating…' : 'Generate share QR'}</button>
                <Link href={`/verify/${encodeURIComponent(scannedBatch.batchCode)}`} className="flex-1 rounded-xl bg-[#1b4b34] py-2 text-center text-xs font-bold text-white">Full traceability</Link>
              </div>
              {qrDataUrl && <div className="rounded-xl border border-gray-100 bg-white p-3"><Image src={qrDataUrl} alt={`Verification QR for ${scannedBatch.batchCode}`} width={144} height={144} unoptimized className="mx-auto h-36 w-36" /><a href={qrDataUrl} download={`${scannedBatch.batchCode}-verify.png`} className="mt-2 block text-center text-xs font-bold text-[#16a34a]">Download QR</a></div>}
              <button onClick={handleSpoilageCheck} disabled={spoilageLoading}
                className="w-full py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700">
                {spoilageLoading ? 'Calculating estimate…' : '🦠 Request shelf-life estimate'}
              </button>
              {spoilageError && <p role="alert" className="text-left text-xs text-red-600">{spoilageError}</p>}
              {spoilageResult && (
                <div className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200 text-left space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[#1a1a1a]">Spoilage Risk</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${riskBadge(prediction?.risk ?? 'UNKNOWN')}`}>
                      {prediction?.risk ?? 'UNKNOWN'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">
                    Shelf life remaining: <span className="font-bold text-[#1a1a1a]">{prediction?.estimatedRemainingDays ?? '—'} days</span>
                  </p>
                  {prediction?.recommendation && (
                    <p className="text-[11px] text-gray-500">{prediction.recommendation}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Inventory Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
            <div><h3 className="text-sm font-bold text-[#1a1a1a]">📦 Traceable Inventory Feed</h3><p className="mt-1 text-xs text-gray-500">Inspect batch provenance and verification records; stock status is read-only here.</p></div>
            <div className="flex flex-wrap gap-2">
              <input value={batchSearch} onChange={(e) => setBatchSearch(e.target.value)} placeholder="Search batch, crop, origin" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-xs"><option value="ALL">All statuses</option>{[...new Set(batches.map((b) => b.status))].map((status) => <option key={status} value={status.toUpperCase()}>{status}</option>)}</select>
              <button type="button" onClick={exportInventoryCsv} className="rounded-lg bg-[#1b4b34] px-3 py-2 text-xs font-bold text-white">Export CSV</button>
              <button type="button" onClick={() => { void fetchBatches(); }} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-[#16a34a]">Refresh</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1a1a1a]">
              <thead className="bg-[#FAFAF7] text-gray-500 font-semibold border-b border-gray-200 text-[11px] uppercase">
                <tr>
                  <th className="py-3 px-4">Batch Code</th>
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">Origin</th>
                  <th className="py-3 px-4">Trust Score</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400">Loading inventory...</td></tr>
                ) : visibleBatches.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400">No delivered batches found.</td></tr>
                ) : (
                  visibleBatches.map((batch, idx) => (
                    <tr key={batch._id || batch.id || batch.batchCode || idx} className="hover:bg-gray-50">
                      <td className="py-3 px-4 font-mono font-bold text-[#16a34a]">{batch.batchCode}</td>
                      <td className="py-3 px-4 font-semibold text-[#1a1a1a]">{batch.product?.name}</td>
                      <td className="py-3 px-4 text-gray-600">{batch.location}</td>
                      <td className="py-3 px-4">
                        <span className={`font-extrabold ${trustColor(batch.trustScore)}`}>{batch.trustScore}</span>
                        <span className="text-gray-400"> / 100</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-[#16a34a]">{batch.status}</span>
                      </td>
                      <td className="py-3 px-4 flex space-x-2">
                        <button onClick={() => { setScanCode(batch.batchCode); handleScanVerify(batch.batchCode); }}
                          className="text-[11px] font-bold text-blue-600 hover:underline">Verify →</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && batches.length < batchTotal && <button type="button" onClick={() => { void fetchBatches(batches.length); }} className="m-4 rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold text-[#385542]">Load more batches</button>}
        </div>
      </div>
    </DashboardLayout>
  );
}
