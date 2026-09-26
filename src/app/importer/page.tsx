'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

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
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);

  // Compliance check
  const [complianceCountry, setComplianceCountry] = useState('UK');
  const [batchCodeForCompliance, setBatchCodeForCompliance] = useState('AGR-2026-UK-284701');
  const [complianceResult, setComplianceResult] = useState<any>(null);
  const [checkingCompliance, setCheckingCompliance] = useState(false);

  const fetchShipments = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/shipments');
      const json = await res.json();
      if (json.success) setShipments(json.data);
    } catch (e) {
      console.error('Failed to load shipments:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchShipments(); }, []);

  const handleCheckCompliance = async () => {
    setCheckingCompliance(true);
    try {
      const res = await fetch('/api/compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: complianceCountry, batchId: batchCodeForCompliance }),
      });
      const json = await res.json();
      if (json.success) setComplianceResult(json.data);
    } catch (e) {
      console.error('Compliance check failed:', e);
    } finally {
      setCheckingCompliance(false);
    }
  };

  const riskColor = (score: number) =>
    score < 30 ? 'text-[#16a34a] bg-green-50' : score < 60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';

  return (
    <DashboardLayout title="Importer Dashboard">
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
            <span className="text-[11px] font-semibold text-gray-500 block mt-1">Blockchain Verified</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-green-100 text-[#16a34a] flex items-center justify-center text-xl">✅</div>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">RAG Compliance</p>
            <p className="text-2xl font-extrabold text-[#1a1a1a] mt-1">8 Standards</p>
            <span className="text-[11px] font-semibold text-purple-600 block mt-1">APEDA · EU · US FDA · UAE</span>
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
            <h2 className="text-sm font-bold text-[#1a1a1a] flex items-center gap-2">🤖 Import Compliance Check</h2>
            <p className="text-xs text-gray-500 mt-0.5">Verify your country&apos;s MRL & phytosanitary standards via RAG.</p>
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
                className="w-full text-xs p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl mt-1 font-mono" />
            </div>
            <button onClick={handleCheckCompliance} disabled={checkingCompliance}
              className="w-full py-2.5 bg-[#16a34a] text-white text-xs font-bold rounded-xl hover:bg-green-700">
              {checkingCompliance ? 'Running RAG Check...' : '⚖️ Run Import Screening'}
            </button>
          </div>
          {complianceResult && (
            <div className="space-y-2 pt-2">
              <div className={`p-3 rounded-xl text-xs font-semibold ${complianceResult.passed ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                {complianceResult.passed ? '✓ Compliance Cleared' : '⚠️ Review Required'}
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{complianceResult.summary}</p>
              {complianceResult.sources?.slice(0, 2).map((src: any, i: number) => (
                <p key={i} className="text-[10px] font-mono text-gray-400">📄 {src.source || src}</p>
              ))}
            </div>
          )}
        </div>

        {/* Shipment Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#1a1a1a]">Inbound Shipment Ledger</h3>
            <button onClick={fetchShipments} className="text-xs font-bold text-[#16a34a] hover:underline">↻ Refresh</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1a1a1a]">
              <thead className="bg-[#FAFAF7] text-gray-500 font-semibold border-b border-gray-200 text-[11px] uppercase">
                <tr>
                  <th className="py-3 px-4">Shipment ID</th>
                  <th className="py-3 px-4">Batch / Crop</th>
                  <th className="py-3 px-4">Origin Country</th>
                  <th className="py-3 px-4">Qty</th>
                  <th className="py-3 px-4">Risk</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">Loading shipments...</td></tr>
                ) : shipments.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">No inbound shipments found.</td></tr>
                ) : (
                  shipments.map((ship, idx) => (
                    <tr key={ship.id || idx} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedShipment(ship)}>
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
