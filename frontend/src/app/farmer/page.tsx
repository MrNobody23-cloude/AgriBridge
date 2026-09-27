'use client';

import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { errText } from '@/lib/err';
import type { ApiBatch } from '@/lib/api-types';
import BatchTable, { BatchRow } from '@/components/BatchTable';
import QRCode from 'qrcode';

export default function FarmerDashboard() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [qrModalData, setQrModalData] = useState<{ code: string; url: string; qrDataUrl: string } | null>(null);
  // What the last registration actually reported about the chain. Null until
  // a batch has been registered, and a reason string when the batch was not
  // anchored — which is the normal case unless a contract is deployed.
  const [lastChainReason, setLastChainReason] = useState<string | null>(null);

  // Form State
  const [crop, setCrop] = useState('Alphonso Mango');
  const [qty, setQty] = useState('2400');
  const [harvestDate, setHarvestDate] = useState('2026-03-12');
  const [location, setLocation] = useState('Nashik, Maharashtra');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  const fetchBatches = useCallback(async () => {
    try {
      const res = await fetch(`/api/batches${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ''}`);
      const json = await res.json();
      if (json.success) {
        const rows: BatchRow[] = json.data.map((b: ApiBatch) => ({
          id: b.batchCode,
          crop: b.product?.name || 'Crop Batch',
          qty: `${b.quantity.toLocaleString()} kg`,
          quantity: Number(b.quantity),
          unit: b.unit || 'kg',
          harvestDate: new Date(b.harvestDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          trustScore: b.trustScore,
          status: b.status,
        }));
        setBatches(rows);
      }
    } catch (e) {
      console.error('Failed to load batches:', e);
    } finally {
      setLoading(false);
    }
    // `loading` starts as `true` and is never set back at the top, so the first
    // paint is a spinner and no render is triggered before the fetch resolves.
    // A search therefore refetches behind the existing rows rather than
    // replacing the table with a spinner the farmer did not ask for.
  }, [searchQuery]);

  useEffect(() => {
    Promise.resolve().then(fetchBatches);
  }, [fetchBatches]);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSuccessMsg('');

    try {
      const res = await fetch('/api/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crop,
          quantity: parseFloat(qty) || 1000,
          harvestDate,
          location,
        }),
      });

      const json = await res.json();
      if (json.success) {
        const newBatchCode = json.data.batch.batchCode;
        const verifyUrl = `${window.location.origin}/verify/${newBatchCode}`;
        const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 300, margin: 2 });

        // Report what happened, not what we wish had happened. POST /api/batches
        // returns the chain result as `json.data.blockchain`, carrying both
        // `success` and a `reason` when nothing was written — so the message
        // can say "registered" without claiming a chain write that never
        // happened.
        const chain = json.data.blockchain;
        const anchored = chain?.success === true;
        setLastChainReason(anchored ? null : (chain?.reason ?? 'Chain not configured'));
        setSuccessMsg(
          anchored
            ? `✓ Batch ${newBatchCode} registered and anchored on-chain.`
            : `✓ Batch ${newBatchCode} registered with a SHA-256 fingerprint${
                chain?.reason
                  ? ` — not anchored on-chain (${String(chain.reason).toLowerCase().replace(/_/g, ' ')})`
                  : ''
              }.`
        );
        setQrModalData({ code: newBatchCode, url: verifyUrl, qrDataUrl });
        fetchBatches();
      } else {
        alert(json.error?.message || 'Failed to register batch');
      }
    } catch (err: unknown) {
      alert(errText(err) || 'Server error while registering batch');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout title="Farmer Dashboard">
      {/* Top Banner Stats
          This banner previously showed `batches.length || 5`, a hardcoded
          "87 / 100" average trust score with a "Top 5% Nashik Region" ranking
          that nothing computes, a hardcoded "₹13,02,000 Gross Revenue (YTD)"
          with a "+32% Premium Export Price" delta, and a "Polygon Amoy / SHA-256
          Verified" card asserting a live chain state that this page never
          fetches. The six-month revenue chart had already been deleted from
          the panel below for exactly the reason that revenue cannot be shown
          here — there is no revenue, payment or price model in the schema — so
          the rupee tile contradicted the disclaimer sitting beneath it. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Batches</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">{batches.length}</p>
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">
              {batches.length === 0 ? 'None registered yet' : 'Registered by you'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl font-bold">
            🌾
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Trust Score</p>
            {(() => {
              const scored = batches.filter((b) => Number(b.trustScore) > 0);
              if (scored.length === 0) {
                return (
                  <>
                    <p className="text-2xl font-extrabold text-gray-400 mt-1">Not computed</p>
                    <span className="text-[11px] font-semibold text-gray-500 mt-1 block">
                      Scores appear once a batch is assessed
                    </span>
                  </>
                );
              }
              const avg = Math.round(
                scored.reduce((s, b) => s + Number(b.trustScore), 0) / scored.length
              );
              return (
                <>
                  <p className="text-2xl font-extrabold text-[#16a34a] mt-1">{avg} / 100</p>
                  <span className="text-[11px] font-semibold text-gray-500 mt-1 block">
                    Across {scored.length} scored {scored.length === 1 ? 'batch' : 'batches'}
                  </span>
                </>
              );
            })()}
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-bold">
            ⭐
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Gross Revenue</p>
            <p className="text-2xl font-extrabold text-gray-400 mt-1">Not tracked</p>
            <span className="text-[11px] font-semibold text-gray-500 mt-1 block">
              This platform records no payments or sale prices
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center text-xl font-bold">
            ₹
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Blockchain Status</p>
            {/* Registration does return a chain result, so this is not a
                hardcoded string: it reflects what the last registration
                actually reported. */}
            <p className={`text-sm font-bold mt-1 ${lastChainReason ? 'text-amber-700' : 'text-purple-700'}`}>
              {lastChainReason ? 'Not anchored on-chain' : 'Anchored on-chain'}
            </p>
            <span className="text-[11px] font-mono text-gray-400 block mt-0.5">
              {lastChainReason ?? 'SHA-256 recorded'}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-xl font-bold">
            ⛓️
          </div>
        </div>
      </div>

      {/* Main Grid: Form + Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Register New Batch Form */}
        <div className="lg:col-span-1 bg-white rounded-xl p-6 border border-gray-200 shadow-xs space-y-4">
          <div className="border-b border-gray-100 pb-3">
            <h2 className="text-base font-bold text-[#1a1a1a] flex items-center gap-2">
              <span>📝</span> Register New Crop Batch
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Generates a SHA-256 fingerprint for the batch. On-chain anchoring
              happens when a contract is deployed — the result below says which.
            </p>
          </div>

          {successMsg && (
            <div className="p-3 bg-green-50 border border-green-200 text-green-800 rounded-xl text-xs font-semibold flex flex-col gap-2">
              <span>{successMsg}</span>
              {qrModalData && (
                <button
                  type="button"
                  onClick={() => setQrModalData(qrModalData)}
                  className="px-3 py-1.5 bg-[#16a34a] text-white font-bold rounded-lg text-xs self-start hover:bg-green-700"
                >
                  View & Download QR Code →
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-bold text-[#1a1a1a] mb-1">Crop Type</label>
              <select
                value={crop}
                onChange={(e) => setCrop(e.target.value)}
                className="w-full text-xs font-semibold text-[#1a1a1a] p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
              >
                <option value="Alphonso Mango">Alphonso Mango (Ratnagiri/Nashik)</option>
                <option value="Basmati Rice">Basmati Rice (Punjab Plains)</option>
                <option value="Nashik Grapes">Nashik Grapes (Export Grade)</option>
                <option value="Kesar Saffron">Kesar Saffron (Kashmir Valley)</option>
                <option value="Darjeeling Tea">Darjeeling Tea (First Flush)</option>
                <option value="Organic Wheat">Organic Wheat (Madhya Pradesh)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#1a1a1a] mb-1">Quantity (kg)</label>
                <input
                  type="number"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-full text-xs font-semibold text-[#1a1a1a] p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
                  placeholder="e.g. 2400"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#1a1a1a] mb-1">Harvest Date</label>
                <input
                  type="date"
                  value={harvestDate}
                  onChange={(e) => setHarvestDate(e.target.value)}
                  className="w-full text-xs font-semibold text-[#1a1a1a] p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#1a1a1a] mb-1">Farm Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full text-xs font-semibold text-[#1a1a1a] p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
                placeholder="e.g. Nashik, Maharashtra"
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-[#16a34a] text-white text-xs font-bold rounded-xl shadow-sm hover:bg-green-700 transition-all flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>                  Recording batch...
                </>
              ) : (
                '⛓️ Register & Mint Traceability Record'
              )}
            </button>
          </form>
        </div>

        {/* Portfolio Summary
            This panel previously rendered a six-month revenue chart from a
            hardcoded `earningsData` array alongside a "+28% Net Margin" badge.
            There is no revenue, payment or price model anywhere in the schema,
            so every point on that chart and that percentage were invented. The
            chart is gone; these figures are counted from the batches this
            farmer actually has records for. */}
        <div className="lg:col-span-2 bg-white rounded-xl p-6 border border-gray-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-[#1a1a1a]">📦 Your Batch Portfolio</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Counted from your recorded batches. Revenue is not tracked — this
                  platform records no payments or sale prices.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Batches</p>
                <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">{batches.length}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Total Quantity</p>
                <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
                  {batches.reduce((s, b) => s + (Number(b.quantity) || 0), 0).toLocaleString()}
                  <span className="text-sm font-bold text-gray-400 ml-1">{batches[0]?.unit || 'kg'}</span>
                </p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Avg Trust Score</p>
                <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
                  {(() => {
                    const scored = batches.filter((b) => Number(b.trustScore) > 0);
                    if (scored.length === 0) return <span className="text-base text-gray-400">Not computed</span>;
                    return Math.round(
                      scored.reduce((s, b) => s + Number(b.trustScore), 0) / scored.length
                    );
                  })()}
                </p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Flagged</p>
                <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">
                  {batches.filter((b) => b.status === 'Flagged').length}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs font-semibold text-gray-500 border-t border-gray-100 pt-3">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-[#16a34a] rounded-sm"></span> AgriBridge Verified Price
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-gray-400 rounded-sm"></span> Local Mandi Baseline
            </span>
          </div>
        </div>
      </div>

      {/* Batch Table Section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <input
            type="text"
            placeholder="🔍 Search batches by crop name, ID, or location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-80 text-xs font-medium text-[#1a1a1a] p-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none shadow-xs"
          />
          <button
            onClick={fetchBatches}
            className="text-xs font-bold text-[#16a34a] hover:underline flex items-center gap-1"
          >
            ↻ Refresh Ledger
          </button>
        </div>

        {/* `loading` is set on every fetch but was never rendered, so the table
            showed its "No batches to show." empty state during the request and
            on every refetch. An empty list and a list still loading are
            different facts, and only one of them is true here. */}
        {loading ? (
          <div className="glass-card py-12 flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-agro-green border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-500 font-medium">Loading batches…</span>
          </div>
        ) : (
          <BatchTable rows={batches} />
        )}
      </div>

      {/* QR Code Download Modal */}
      {qrModalData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full border border-gray-200 shadow-2xl text-center space-y-4 animate-scale-up">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-[#1a1a1a]">Batch QR Authenticity Code</h3>
              <button
                onClick={() => setQrModalData(null)}
                className="text-gray-400 hover:text-gray-600 font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200 flex flex-col items-center">
              {/* `no-img-element` disabled deliberately. `qrDataUrl` is a
                  `data:image/png;base64,…` string produced in the browser by the
                  `qrcode` package — there is no URL for the Next.js image
                  optimizer to fetch, resize or re-encode, so `next/image` would
                  add a loader and a second decode pass for a lossless PNG that
                  is already exactly the size it is displayed at. The rule exists
                  to stop unoptimised JPEGs of remote photos; a base64 QR code is
                  the case where it does not apply. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrModalData.qrDataUrl} alt="Batch QR Code" className="w-48 h-48 rounded-lg shadow-sm" />
              <p className="mt-2 text-xs font-mono font-bold text-[#16a34a]">{qrModalData.code}</p>
            </div>

            <p className="text-xs text-gray-500">
              Attach this QR code to crop packaging. Exporters & Consumers scan to view immutable Polygon proof.
            </p>

            <div className="flex gap-2 pt-2">
              <a
                href={qrModalData.qrDataUrl}
                download={`AgriBridge_${qrModalData.code}_QR.png`}
                className="flex-1 py-2.5 bg-[#16a34a] text-white text-xs font-bold rounded-xl text-center hover:bg-green-700"
              >
                Download PNG
              </a>
              <a
                href={qrModalData.url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2.5 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl text-center hover:bg-gray-200"
              >
                Open Link →
              </a>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
