'use client';

import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import TrustScoreCard from '@/components/TrustScoreCard';

/**
 * Trust Score Explorer.
 *
 * This page previously shipped a hardcoded list of three batch codes and, on
 * any error from the API, rendered a fabricated score of 87 with five invented
 * factors labelled "Polygon Audit" and "FSSAI Verified" — including a
 * "SHAP Interpretability" panel reading values that were typed into the
 * fallback object. Nothing on screen came from the backend.
 *
 * The batch list is now fetched from /api/batches. A batch with no stored score
 * reports that fact. Nothing is invented when a request fails, and the factor
 * panel shows what each factor was measured against rather than a SHAP weight —
 * no SHAP model is fitted over the trust factors in this project, so calling
 * these SHAP values would be a false claim about the mechanism.
 */

interface Factor {
    name: string;
    score: number;
    max: number | null;
    desc: string;
    weight: number;
    observed: string;
}

interface ScoreData {
    batchId: string;
    batchCode: string;
    crop: string;
    farmerName: string;
    finalScore: number;
    riskLevel: string;
    factors: Factor[];
    unavailableFactors: { name: string; code: string; message: string }[];
    coverageMax: number;
    risks: string[];
    plainAi: string;
}

export default function TrustScorePage() {
    const [batchCode, setBatchCode] = useState('');
    const [batchOptions, setBatchOptions] = useState<string[]>([]);
    const [scoreData, setScoreData] = useState<ScoreData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Populate the selector from the real API instead of a hardcoded array.
    useEffect(() => {
        const loadBatches = async () => {
            try {
                const res = await fetch('/api/batches?limit=100');
                const json = await res.json();
                if (json.success && Array.isArray(json.data?.batches ?? json.data)) {
                    const list = json.data?.batches ?? json.data;
                    const codes: string[] = list
                        .map((b: { batchCode?: string }) => b.batchCode)
                        .filter((c: unknown): c is string => typeof c === 'string');
                    setBatchOptions(codes);
                    if (codes.length > 0) setBatchCode((prev) => prev || codes[0]);
                }
            } catch (e) {
                console.error('Failed to load batches:', e);
            }
        };
        loadBatches();
    }, []);

    const fetchScore = useCallback(async (code: string) => {
        if (!code) {
            setScoreData(null);
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            setError(null);
            const res = await fetch(`/api/trust-score/${encodeURIComponent(code)}`);
            const json = await res.json();
            if (json.success) {
                setScoreData(json.data);
            } else {
                setScoreData(null);
                setError(json?.error?.message || 'No trust score is available for this batch.');
            }
        } catch (e) {
            console.error('Failed to fetch trust score:', e);
            setScoreData(null);
            setError('Could not reach the trust score service. No score is shown.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Deferred to a microtask: `fetchScore` clears the previous score and
        // sets `loading` before it awaits, and running that inside the effect
        // body forces a cascading render. As a promise callback the state
        // change lands after the effect body has returned, which is the only
        // thing that differs — the same request is still made for `batchCode`
        // on mount and on every change.
        Promise.resolve().then(() => fetchScore(batchCode));
    }, [batchCode, fetchScore]);

    const factorScore = (name: string): number | undefined =>
        scoreData?.factors?.find((f) => f.name.includes(name))?.score;

    return (
        <DashboardLayout title="Trust Score Engine">
            <div className="glass-card p-6 flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-xl font-bold text-[#1a1a1a]">⭐ Explainable Trust Score Breakdown</h2>
                    <p className="text-xs text-gray-500 mt-1 font-medium">
                        Every factor below is measured from stored evidence. Factors with no
                        evidence contribute nothing and are listed as unavailable.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <label htmlFor="batch-select" className="text-xs font-bold text-gray-700 uppercase tracking-widest">
                        Select Batch
                    </label>
                    {batchOptions.length > 0 ? (
                        <select
                            id="batch-select"
                            value={batchCode}
                            onChange={(e) => setBatchCode(e.target.value)}
                            className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-white/60 border border-white/60"
                        >
                            {batchOptions.map((code) => (
                                <option key={code} value={code}>{code}</option>
                            ))}
                        </select>
                    ) : (
                        <span className="text-xs text-gray-500 font-medium">No batches available</span>
                    )}
                </div>
            </div>

            {loading && (
                <div className="glass-card p-10 text-center text-sm text-gray-500 font-medium">
                    Loading trust score…
                </div>
            )}

            {!loading && error && (
                <div className="glass-card p-10 text-center">
                    <div className="text-3xl mb-3">📋</div>
                    <p className="text-sm font-bold text-[#1a1a1a] mb-1">No trust score to show</p>
                    <p className="text-xs text-gray-500 max-w-md mx-auto">{error}</p>
                </div>
            )}

            {!loading && scoreData && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="flex flex-col space-y-6">
                            <TrustScoreCard
                                score={scoreData.finalScore}
                                factors={{
                                    blockchain: factorScore('Blockchain') ?? 0,
                                    certificate: factorScore('Certificate') ?? 0,
                                    coldChain: factorScore('Cold Chain') ?? 0,
                                    compliance: factorScore('Compliance') ?? 0,
                                    mlRisk: factorScore('ML') ?? 0,
                                }}
                            />

                            {/* A score computed over a narrow base must not read
                                like one computed over everything. */}
                            {scoreData.coverageMax < 100 && (
                                <div className="glass-panel p-4 border-l-4 border-l-amber-400">
                                    <h3 className="text-[10px] uppercase font-extrabold text-amber-600 tracking-widest mb-1">
                                        Partial Assessment
                                    </h3>
                                    <p className="text-xs text-[#1a1a1a] font-medium leading-relaxed">
                                        This score is calculated from {scoreData.coverageMax} of 100
                                        available points. {scoreData.unavailableFactors.length > 0
                                            ? `${scoreData.unavailableFactors.length} factor(s) had no evidence and were not scored: ${scoreData.unavailableFactors.map((u) => u.name).join(', ')}.`
                                            : 'The unavailable factors were not recorded when this score was stored.'}
                                    </p>
                                </div>
                            )}

                            {scoreData.unavailableFactors.length > 0 && (
                                <div className="glass-panel p-4">
                                    <h3 className="text-[10px] uppercase font-extrabold text-gray-500 tracking-widest mb-2">
                                        Factors Not Scored
                                    </h3>
                                    <ul className="space-y-2">
                                        {scoreData.unavailableFactors.map((u) => (
                                            <li key={u.name} className="text-xs text-gray-600">
                                                <span className="font-bold text-gray-800">{u.name}</span>
                                                <span className="font-mono text-[10px] text-gray-400 ml-2">{u.code}</span>
                                                <p className="text-[11px] text-gray-500 mt-0.5">{u.message}</p>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="glass-panel p-6 relative overflow-hidden">
                                <h3 className="text-[10px] uppercase font-extrabold text-agro-green tracking-widest mb-2">
                                    Plain-Language Summary
                                </h3>
                                <p className="text-sm text-[#1a1a1a] font-medium leading-relaxed z-10 relative">
                                    {scoreData.plainAi}
                                </p>
                                <div className="absolute right-[-10%] bottom-[-20%] text-[80px] opacity-10">🤖</div>
                            </div>
                        </div>

                        <div className="glass-card p-6 h-full flex flex-col">
                            <h3 className="text-sm font-bold uppercase tracking-wider mb-1">Factor Evidence</h3>
                            <p className="text-[11px] text-gray-500 mb-6 font-medium">
                                What each factor was measured against. These are evidence notes,
                                not SHAP values — no explainability model is fitted over these
                                factors in this system.
                            </p>
                            <div className="flex-1 flex flex-col justify-center space-y-5">
                                {scoreData.factors.length === 0 && (
                                    <p className="text-sm text-gray-500 font-medium">
                                        No factor could be scored for this batch.
                                    </p>
                                )}
                                {scoreData.factors.map((f, idx) => {
                                    const pct = f.max ? (f.score / f.max) * 100 : 0;
                                    return (
                                        <div key={idx} className="relative">
                                            <div className="flex justify-between text-xs font-bold mb-2 z-10 relative">
                                                <span>{f.name}</span>
                                                <span className="font-mono">
                                                    {f.score}/{f.max ?? '—'}
                                                </span>
                                            </div>
                                            <div className="w-full bg-black/5 h-2.5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-agro-green"
                                                    style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                                                ></div>
                                            </div>
                                            <p className="text-[10px] text-gray-500 mt-1 font-medium italic">{f.desc}</p>
                                        </div>
                                    );
                                })}
                            </div>

                            {scoreData.risks.length > 0 && (
                                <div className="mt-6 pt-4 border-t border-gray-200">
                                    <h4 className="text-[10px] uppercase font-extrabold text-gray-500 tracking-widest mb-2">
                                        Risks
                                    </h4>
                                    <ul className="space-y-1">
                                        {scoreData.risks.map((r, i) => (
                                            <li key={i} className="text-[11px] text-gray-600">• {r}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}
