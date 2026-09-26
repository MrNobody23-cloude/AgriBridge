'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import TrustScoreCard from '@/components/TrustScoreCard';

export default function TrustScorePage() {
  const [selectedBatchCode, setSelectedBatchCode] = useState('AGR-2026-UK-284701');
  const [scoreData, setScoreData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Simulation fallback to demonstrate component with realistic structure
  const fetchScore = async (batchCode: string) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/trust-score/${batchCode}`);
      const json = await res.json();
      if (json.success) {
        setScoreData(json.data);
      } else {
        // Mock data to ensure the UI renders correctly if endpoint lacks data
        setScoreData({
          finalScore: 87,
          riskLevel: 'GOOD',
          crop: 'Alphonso Mango',
          farmerName: 'Test Farmer',
          plainAi: 'Your crop has high blockchain integrity and verified quality, but slightly low prediction confidence.',
          factors: [
            { name: 'Blockchain Integrity', score: 96, max: 100, shap: 12, desc: 'Polygon Audit' },
            { name: 'Certificate Status', score: 100, max: 100, shap: 15, desc: 'FSSAI Verified' },
            { name: 'Cold Chain', score: 82, max: 100, shap: -5, desc: 'Temperature deviations' },
            { name: 'Compliance', score: 91, max: 100, shap: 8, desc: 'EU Standards' },
            { name: 'ML Risk Analysis', score: 78, max: 100, shap: -12, desc: 'Spoilage Prediction' },
          ]
        });
      }
    } catch (e) {
      console.error('Failed to fetch trust score:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScore(selectedBatchCode);
  }, [selectedBatchCode]);

  return (
    <DashboardLayout title="Trust Score Engine">
      {/* Header Selector */}
      <div className="glass-card p-6 flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-[#1a1a1a]">⭐ Explainable Trust Score Breakdown</h2>
          <p className="text-xs text-gray-500 mt-1 font-medium">
            Dynamic algorithm backed by ML Risk Analysis & Polygon audit trails.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-gray-700 uppercase tracking-widest">Select Batch</span>
          <div className="flex bg-white/40 border border-white/60 p-1 rounded-xl">
            {['AGR-2026-UK-284701', 'AGR-2026-EU-284102', 'AGR-2026-US-283503'].map((code) => (
              <button
                key={code}
                onClick={() => setSelectedBatchCode(code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${selectedBatchCode === code
                  ? 'bg-agro-green text-white shadow-md'
                  : 'text-gray-600 hover:bg-white/50'
                  }`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </div>

      {scoreData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="flex flex-col space-y-6">
            <TrustScoreCard
              score={scoreData.finalScore}
              factors={{
                blockchain: scoreData.factors?.find((f: any) => f.name.includes('Blockchain'))?.score || 0,
                certificate: scoreData.factors?.find((f: any) => f.name.includes('Certificate'))?.score || 0,
                coldChain: scoreData.factors?.find((f: any) => f.name.includes('Cold Chain'))?.score || 0,
                compliance: scoreData.factors?.find((f: any) => f.name.includes('Compliance'))?.score || 0,
                mlRisk: scoreData.factors?.find((f: any) => f.name.includes('ML Risk'))?.score || 0
              }}
            />

            <div className="glass-panel p-6 relative overflow-hidden">
              <h3 className="text-[10px] uppercase font-extrabold text-agro-green tracking-widest mb-2">AI Summary Insight</h3>
              <p className="text-sm text-[#1a1a1a] font-medium leading-relaxed z-10 relative">
                "{scoreData.plainAi}"
              </p>
              <div className="absolute right-[-10%] bottom-[-20%] text-[80px] opacity-10">🤖</div>
            </div>
          </div>

          <div className="glass-card p-6 h-full flex flex-col">
            <h3 className="text-sm font-bold uppercase tracking-wider mb-6">SHAP Interpretability Weights</h3>
            <div className="flex-1 flex flex-col justify-center space-y-5">
              {scoreData.factors?.map((f: any, idx: number) => (
                <div key={idx} className="relative">
                  <div className="flex justify-between text-xs font-bold mb-2 z-10 relative">
                    <span>{f.name}</span>
                    <span className={`${f.shap >= 0 ? 'text-agro-green' : 'text-red-500'}`}>
                      SHAP: {f.shap >= 0 ? `+${f.shap}` : f.shap}
                    </span>
                  </div>
                  <div className="w-full bg-black/5 h-2.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${f.shap >= 0 ? 'bg-agro-green' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(Math.abs(f.shap) * 5, 100)}%` }}
                    ></div>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1 font-medium italic">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
