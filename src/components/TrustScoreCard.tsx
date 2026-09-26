'use client';

import React from 'react';
import TrustScoreGauge from './TrustScoreGauge';

interface TrustScoreCardProps {
    batchId?: string;
    score: number;
    factors: {
        blockchain: number;
        certificate: number;
        coldChain: number;
        compliance: number;
        mlRisk: number;
    }
}

export default function TrustScoreCard({ score, factors }: TrustScoreCardProps) {
    let scoreLabel = 'EXCELLENT';
    let labelColor = 'text-green-700';
    if (score < 50) { scoreLabel = 'POOR'; labelColor = 'text-red-700'; }
    else if (score < 80) { scoreLabel = 'GOOD'; labelColor = 'text-amber-700'; }
    else if (score < 90) { scoreLabel = 'VERY GOOD'; labelColor = 'text-green-600'; }

    return (
        <div className="glass-card p-6 flex flex-col md:flex-row gap-8 items-center border border-white/40 shadow-xl overflow-hidden relative">
            <div className="flex flex-col items-center z-10">
                <TrustScoreGauge score={score} size={140} />
                <h3 className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest mt-4">Trust Score</h3>
                <p className={`text-sm font-extrabold tracking-wide mt-1 ${labelColor}`}>{scoreLabel}</p>
            </div>

            <div className="flex-1 w-full space-y-3 z-10">
                <FactorRow label="Blockchain Integrity" value={factors.blockchain} />
                <FactorRow label="Certificate Status" value={factors.certificate} />
                <FactorRow label="Cold Chain" value={factors.coldChain} />
                <FactorRow label="Compliance" value={factors.compliance} />
                <FactorRow label="ML Risk Analysis" value={factors.mlRisk} invert />
            </div>

            <div className="absolute top-[-50%] right-[-20%] w-[80%] h-[200%] bg-white/20 blur-[60px] pointer-events-none transform rotate-12 z-0"></div>
        </div>
    );
}

function FactorRow({ label, value, invert = false }: { label: string, value: number, invert?: boolean }) {
    // If invert is true, lower score is better (e.g. Risk)
    let indicatorColor = 'bg-agro-green';
    if (invert) {
        if (value > 50) indicatorColor = 'bg-red-500';
        else if (value > 20) indicatorColor = 'bg-amber-400';
    } else {
        if (value < 50) indicatorColor = 'bg-red-500';
        else if (value < 80) indicatorColor = 'bg-amber-400';
    }

    return (
        <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">{label}</span>
            <div className="flex items-center gap-3 w-1/2 justify-end">
                <div className="h-1.5 flex-1 bg-black/5 rounded-full overflow-hidden">
                    <div className={`h-full ${indicatorColor} rounded-full transition-all duration-700`} style={{ width: `${value}%` }}></div>
                </div>
                <span className="text-xs font-bold w-6 text-right text-[#1a1a1a]">{value}</span>
            </div>
        </div>
    );
}
