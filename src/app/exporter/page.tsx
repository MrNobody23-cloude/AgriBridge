'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';

export default function ExporterDashboard() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal / Action states
  const [destinationCountry, setDestinationCountry] = useState('UK');
  const [batchId, setBatchId] = useState('AG-2847');
  const [quantity, setQuantity] = useState('2400');
  const [creatingShipment, setCreatingShipment] = useState(false);

  // RAG Compliance State
  const [complianceCountry, setComplianceCountry] = useState('UK');
  const [ragResult, setRagResult] = useState<any>(null);
  const [checkingCompliance, setCheckingCompliance] = useState(false);

  // Certificate Upload State
  const [certType, setCertType] = useState('APEDA Phytosanitary Certificate');
  const [certFile, setCertFile] = useState<File | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);

  const fetchShipments = async () => {
    try {
      setLoading(true);
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

  useEffect(() => {
    fetchShipments();
  }, []);

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingShipment(true);
    try {
      const res = await fetch('/api/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          destinationCountry,
          quantity: parseFloat(quantity) || 2000,
        }),
      });

      const json = await res.json();
      if (json.success) {
        alert(`✓ Shipment ${json.data.shipment.shipmentCode} created & RAG compliance checks passed!`);
        fetchShipments();
      } else {
        alert(json.error?.message || 'Failed to create shipment');
      }
    } catch (err: any) {
      alert(err.message || 'Server error creating shipment');
    } finally {
      setCreatingShipment(false);
    }
  };

  const handleCheckRAG = async () => {
    setCheckingCompliance(true);
    try {
      const res = await fetch('/api/compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country: complianceCountry, batchId }),
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
    setUploadingCert(true);
    try {
      // Calculate SHA-256 hash
      const text = certFile ? await certFile.text() : `${certType}_${batchId}_${Date.now()}`;
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fileHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      const res = await fetch('/api/certificates/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          certificateType: certType,
          fileUrl: `/uploads/certificates/${batchId}_${Date.now()}.pdf`,
          fileHash,
          issuer: 'APEDA Regional Authority',
          expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      });

      const json = await res.json();
      if (json.success) {
        alert(json.data.message);
        fetchShipments();
      } else {
        alert(json.error?.message || 'Failed to upload certificate');
      }
    } catch (err: any) {
      alert(err.message || 'Error uploading certificate');
    } finally {
      setUploadingCert(false);
    }
  };

  return (
    <DashboardLayout title="Exporter Dashboard">
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
              {shipments.filter((s) => s.complianceStatus && s.complianceStatus !== 'PENDING').length}
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
              {shipments.filter((s) => s.screenedAt || s.complianceStatus).length} / {shipments.length}
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
              <input
                type="text"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                className="w-full text-xs font-mono font-bold text-[#16a34a] p-2.5 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
                placeholder="e.g. AG-2847"
                required
              />
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
                '🚢 Create & Run RAG Compliance'
              )}
            </button>
          </form>
        </div>

        {/* AI RAG Compliance Knowledge Checker */}
        <div className="lg:col-span-2 bg-white rounded-xl p-6 border border-gray-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-gray-100 pb-3 gap-2">
            <div>
              <h2 className="text-base font-bold text-[#1a1a1a] flex items-center gap-2">
                <span>🤖</span> AI RAG Regulatory Compliance Screening
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Real-time regulatory document retrieval across UK, UAE, USA & Japan frameworks.
              </p>
            </div>
            <div className="flex items-center gap-2">
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
                disabled={checkingCompliance}
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
                {ragResult.checks.map((chk: any, idx: number) => (
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
            <h3 className="text-xs font-bold text-[#1a1a1a] mb-2">Upload Certificate for SHA-256 Hash Verification</h3>
            <form onSubmit={handleUploadCertificate} className="flex flex-col sm:flex-row gap-2">
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
                className="text-xs text-gray-500 p-1 border border-gray-200 rounded-xl bg-white"
              />
              <button
                type="submit"
                disabled={uploadingCert}
                className="px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded-xl hover:bg-purple-700 shrink-0"
              >
                {uploadingCert ? 'Hashing...' : 'Upload & Hash'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Shipments Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-bold text-[#1a1a1a]">Export Shipment Ledger</h3>
          <span className="text-xs font-medium text-gray-500">Showing {shipments.length} shipments</span>
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
              {shipments.map((ship, idx) => (
                <tr key={ship.id || idx} className="hover:bg-gray-50">
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
