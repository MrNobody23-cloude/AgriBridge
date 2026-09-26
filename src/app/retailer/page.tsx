'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import TrustScoreGauge from '@/components/TrustScoreGauge';
import RecentBatchCodes from '@/components/RecentBatchCodes';

interface Batch {
  id: string;
  batchCode: string;
  trustScore: number;
  status: string;
  product?: { name: string };
  farmer?: { name: string };
  location: string;
  harvestDate: string;
}

export default function RetailerDashboard() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanCode, setScanCode] = useState('');
  const [scannedBatch, setScannedBatch] = useState<any>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');

  // ML spoilage check
  const [spoilageLoading, setSpoilageLoading] = useState(false);
  const [spoilageResult, setSpoilageResult] = useState<any>(null);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/batches?status=DELIVERED');
      const json = await res.json();
      if (json.success) setBatches(json.data.slice(0, 10));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBatches(); }, []);

  const handleScanVerify = async (code?: string) => {
    const target = code || scanCode;
    if (!target) return;
    setScanLoading(true);
    setScanError('');
    setScannedBatch(null);
    setSpoilageResult(null);
    try {
      const res = await fetch(`/api/batches/${encodeURIComponent(target)}`);
      const json = await res.json();
      if (json.success) {
        setScannedBatch(json.data);
      } else {
        setScanError(json.error?.message || 'Batch not found');
      }
    } catch (e) {
      setScanError('Network error. Please try again.');
    } finally {
      setScanLoading(false);
    }
  };

  const handleSpoilageCheck = async () => {
    if (!scannedBatch?.batch) return;
    setSpoilageLoading(true);
    try {
      const res = await fetch('/api/ml/spoilage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: scannedBatch.batch.batchCode }),
      });
      const json = await res.json();
      if (json.success) setSpoilageResult(json.data);
    } catch (e) {
      console.error('Spoilage check failed:', e);
    } finally {
      setSpoilageLoading(false);
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

  return (
    <DashboardLayout title="Retailer Dashboard">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Verified Batches</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">{batches.length}</p>
            <span className="text-[11px] font-semibold text-[#16a34a] block mt-1">Ready for Shelf</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl">🏪</div>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">QR Scan Ready</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
              {batches.length
                ? `${batches.filter((b) => b.id).length} / ${batches.length}`
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
            {spoilageResult ? (
              <>
                <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
                  {spoilageResult.remainingShelfLifeDays ?? spoilageResult.remainingDays ?? '—'}
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
            <h2 className="text-sm font-bold text-[#1a1a1a]">📱 Scan Batch QR Code</h2>
            <p className="text-xs text-gray-500">Enter the batch code from product QR label to verify origin & freshness.</p>
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
              codes={['AGR-2026-UK-284701', 'AGR-2026-EU-284102', 'AGR-2026-US-283503']}
              onPick={(code) => { setScanCode(code); handleScanVerify(code); }}
            />
            {scanError && <p className="text-xs font-semibold text-red-600">⚠️ {scanError}</p>}
          </div>

          {/* Scanned batch card */}
          {scannedBatch && (
            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs space-y-4 text-center">
              <div className="inline-block">
                <TrustScoreGauge score={scannedBatch.trustDetails?.finalScore || scannedBatch.batch.trustScore} size={130} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#1a1a1a]">{scannedBatch.batch.product?.name}</h3>
                <p className="text-xs font-mono text-[#16a34a]">{scannedBatch.batch.batchCode}</p>
                <p className="text-xs text-gray-500 mt-1">
                  by {scannedBatch.batch.farmer?.name} · {scannedBatch.batch.location}
                </p>
              </div>
              <button onClick={handleSpoilageCheck} disabled={spoilageLoading}
                className="w-full py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700">
                {spoilageLoading ? 'Running XGBoost...' : '🦠 Run ML Spoilage Check'}
              </button>
              {spoilageResult && (
                <div className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200 text-left space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[#1a1a1a]">Spoilage Risk</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${riskBadge(spoilageResult.riskLevel || spoilageResult.spoilageRisk)}`}>
                      {spoilageResult.riskLevel || spoilageResult.spoilageRisk}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">
                    Shelf life remaining: <span className="font-bold text-[#1a1a1a]">{spoilageResult.remainingShelfLifeDays ?? spoilageResult.remainingDays} days</span>
                  </p>
                  {spoilageResult.recommendation && (
                    <p className="text-[11px] text-gray-500">{spoilageResult.recommendation}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Inventory Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#1a1a1a]">📦 Received Inventory</h3>
            <button onClick={fetchBatches} className="text-xs font-bold text-[#16a34a] hover:underline">↻ Refresh</button>
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
                ) : batches.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-400">No delivered batches found.</td></tr>
                ) : (
                  batches.map((batch, idx) => (
                    <tr key={batch.id || idx} className="hover:bg-gray-50">
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
                      <td className="py-3 px-4">
                        <button onClick={() => { setScanCode(batch.batchCode); handleScanVerify(batch.batchCode); }}
                          className="text-[11px] font-bold text-blue-600 hover:underline">Verify →</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
