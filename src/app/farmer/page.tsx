'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import BatchTable, { BatchRow } from '@/components/BatchTable';
import QRCode from 'qrcode';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const earningsData = [
  { month: 'Oct', earnings: 142000, baseline: 110000 },
  { month: 'Nov', earnings: 185000, baseline: 125000 },
  { month: 'Dec', earnings: 210000, baseline: 140000 },
  { month: 'Jan', earnings: 195000, baseline: 135000 },
  { month: 'Feb', earnings: 260000, baseline: 150000 },
  { month: 'Mar', earnings: 310000, baseline: 165000 },
];

export default function FarmerDashboard() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [qrModalData, setQrModalData] = useState<{ code: string; url: string; qrDataUrl: string } | null>(null);

  // Form State
  const [crop, setCrop] = useState('Alphonso Mango');
  const [qty, setQty] = useState('2400');
  const [harvestDate, setHarvestDate] = useState('2026-03-12');
  const [location, setLocation] = useState('Nashik, Maharashtra');

  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  const fetchBatches = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/batches${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ''}`);
      const json = await res.json();
      if (json.success) {
        const rows: BatchRow[] = json.data.map((b: any) => ({
          id: b.batchCode,
          crop: b.product?.name || 'Crop Batch',
          qty: `${b.quantity.toLocaleString()} kg`,
          harvestDate: new Date(b.harvestDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          trustScore: b.trustScore,
          status: b.status as any,
        }));
        setBatches(rows);
      }
    } catch (e) {
      console.error('Failed to load batches:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, [searchQuery]);

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

        setSuccessMsg(`✓ Batch ${newBatchCode} successfully registered & recorded on Polygon Blockchain!`);
        setQrModalData({ code: newBatchCode, url: verifyUrl, qrDataUrl });
        fetchBatches();
      } else {
        alert(json.error?.message || 'Failed to register batch');
      }
    } catch (err: any) {
      alert(err.message || 'Server error while registering batch');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout title="Farmer Dashboard">
      {/* Top Banner Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Batches</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">{batches.length || 5}</p>
            <span className="text-[11px] font-semibold text-[#16a34a] inline-flex items-center gap-1 mt-1">
              <span>↑</span> 100% Polygon Traceable
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl font-bold">
            🌾
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Trust Score</p>
            <p className="text-2xl font-extrabold text-[#16a34a] mt-1">87 / 100</p>
            <span className="text-[11px] font-semibold text-gray-500 mt-1 block">
              Top 5% Nashik Region
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-bold">
            ⭐
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Gross Revenue (YTD)</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">₹13,02,000</p>
            <span className="text-[11px] font-semibold text-[#16a34a] inline-flex items-center gap-1 mt-1">
              <span>↑</span> +32% Premium Export Price
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center text-xl font-bold">
            ₹
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Blockchain Status</p>
            <p className="text-sm font-bold text-purple-700 mt-1">Polygon Amoy</p>
            <span className="text-[11px] font-mono text-gray-400 block mt-0.5">SHA-256 Verified</span>
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
              Generates an immutable SHA-256 hash & records on Polygon testnet.
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
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  Recording on Blockchain...
                </>
              ) : (
                '⛓️ Register & Mint Traceability Record'
              )}
            </button>
          </form>
        </div>

        {/* Earnings Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl p-6 border border-gray-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-[#1a1a1a]">📈 Revenue Growth (AgriBridge vs Mandi Baseline)</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Direct export premiums unlocked by verified Trust Scores.
                </p>
              </div>
              <span className="text-xs font-bold text-[#16a34a] bg-green-50 px-2.5 py-1 rounded-full border border-green-200">
                +28% Net Margin
              </span>
            </div>

            <div className="h-64 mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={earningsData}>
                  <defs>
                    <linearGradient id="colorEarnings" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#16a34a" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v) => `₹${v / 1000}k`} />
                  <Tooltip formatter={(value: any) => [`₹${value.toLocaleString()}`, 'Amount']} />
                  <Area type="monotone" dataKey="earnings" stroke="#16a34a" strokeWidth={3} fillOpacity={1} fill="url(#colorEarnings)" name="AgriBridge Premium" />
                  <Area type="monotone" dataKey="baseline" stroke="#9ca3af" strokeWidth={2} strokeDasharray="5 5" fill="none" name="Standard Mandi MSP" />
                </AreaChart>
              </ResponsiveContainer>
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

        <BatchTable rows={batches} />
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
