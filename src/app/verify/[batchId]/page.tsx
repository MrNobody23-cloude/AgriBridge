'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import TrustScoreGauge from '@/components/TrustScoreGauge';

export default function PublicVerifyPage() {
    const params = useParams();
    const batchId = params.batchId as string;

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!batchId) return;
        fetch(`/api/batches/${batchId}`)
            .then((res) => res.json())
            .then((resData) => {
                if (resData.success) {
                    setData(resData.data);
                } else {
                    setError(resData.error?.message || 'Batch not found');
                }
            })
            .catch(() => setError('Failed to connect to verification ledger'))
            .finally(() => setLoading(false));
    }, [batchId]);

    if (loading) {
        return (
            <div className="min-h-screen bg-[#FAFAF7] flex flex-col items-center justify-center p-6">
                <div className="w-12 h-12 border-4 border-[#16a34a] border-t-transparent rounded-full animate-spin"></div>
                <p className="mt-4 text-sm font-semibold text-gray-600">Verifying Blockchain Record for Batch {batchId}...</p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-[#FAFAF7] flex flex-col items-center justify-center p-6 text-center">
                <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-2xl font-bold mb-4">
                    ⚠️
                </div>
                <h1 className="text-xl font-bold text-[#1a1a1a]">Batch Record Not Found</h1>
                <p className="text-sm text-gray-500 max-w-md mt-2 mb-6">
                    The batch code <span className="font-mono font-bold text-red-600">{batchId}</span> could not be verified on the AgriBridge blockchain network.
                </p>
                <Link href="/consumer" className="px-5 py-2.5 bg-[#16a34a] text-white font-bold rounded-xl shadow-sm text-sm hover:bg-green-700">
                    Return to Consumer Verification
                </Link>
            </div>
        );
    }

    const { batch, blockchainVerification, trustDetails } = data;
    // Three states, not two. A chain that is unconfigured or unreachable has not
    // verified anything — it has also produced no evidence of tampering. Showing
    // "TAMPER WARNING" to a consumer scanning a QR code because nobody set a
    // contract address would accuse an honest farmer of counterfeiting.
    const chainStatus = blockchainVerification?.status as string | undefined;
    const isVerified = chainStatus === 'VERIFIED';
    const isTampered = chainStatus === 'TAMPERED';
    const isChainBlind = !isVerified && !isTampered;
    const badge = isVerified
        ? { bg: 'bg-green-100', fg: 'text-[#16a34a]', glyph: '✓', label: 'POLYGON VERIFIED' }
        : isTampered
          ? { bg: 'bg-red-100', fg: 'text-red-600', glyph: '✗', label: 'TAMPER WARNING' }
          : { bg: 'bg-amber-100', fg: 'text-amber-700', glyph: '?', label: 'NOT CHAIN-VERIFIED' };

    return (
        <div className="min-h-screen bg-[#FAFAF7] py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto space-y-6">
                {/* Header Badge */}
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl font-extrabold ${badge.bg} ${badge.fg}`}>
                            {badge.glyph}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-bold text-gray-400">BATCH {batch.batchCode}</span>
                                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${badge.bg} ${badge.fg}`}>
                                    {badge.label}
                                </span>
                            </div>
                            <h1 className="text-2xl font-bold text-[#1a1a1a] mt-0.5">{batch.product?.name}</h1>
                            <p className="text-xs text-gray-500">Produced by {batch.farmer?.name} ({batch.location})</p>
                        </div>
                    </div>

                    <TrustScoreGauge score={trustDetails?.finalScore || batch.trustScore} size={130} />
                </div>

                {/* AI Explainability Summary */}
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
                    <h2 className="text-base font-bold text-[#1a1a1a] flex items-center gap-2">
                        <span>🤖</span> Verified AI Quality & Authenticity Summary
                    </h2>
                    <div className="p-4 bg-[#FAFAF7] rounded-xl border border-gray-200">
                        <p className="text-xs text-gray-700 leading-relaxed font-medium">
                            {trustDetails?.plainAi || 'No trust assessment has been computed for this batch yet. Nothing below has been verified.'}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <span className="text-[11px] text-gray-400 font-medium block">Quantity</span>
                            <span className="text-sm font-bold text-[#1a1a1a]">{batch.quantity} kg</span>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <span className="text-[11px] text-gray-400 font-medium block">Harvest Date</span>
                            <span className="text-sm font-bold text-[#1a1a1a]">{new Date(batch.harvestDate).toLocaleDateString()}</span>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <span className="text-[11px] text-gray-400 font-medium block">Certificates</span>
                            <span className="text-sm font-bold text-[#16a34a]">
                                {batch.certificates?.length || 0} Verified
                            </span>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <span className="text-[11px] text-gray-400 font-medium block">Blockchain</span>
                            <span className="text-sm font-bold text-purple-600">
                                {isVerified || isTampered ? 'Polygon Amoy' : 'Not configured'}
                            </span>
                        </div>
                    </div>

                    {/* A consumer deserves to know when a check could not run, as
                        much as when one failed. */}
                    {isChainBlind && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                            <p className="text-[11px] text-amber-800 leading-relaxed">
                                {chainStatus === 'NOT_CONFIGURED'
                                    ? 'No blockchain contract is configured on this deployment, so no on-chain check was performed. The details below come from this system\'s own database and have not been independently verified.'
                                    : 'The configured blockchain could not be reached, so no on-chain check was performed. The details below come from this system\'s own database and have not been independently verified.'}
                            </p>
                        </div>
                    )}
                </div>

                {/* Cryptographic Proof */}
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-3">
                    <h2 className="text-base font-bold text-[#1a1a1a]">
                        {isVerified || isTampered ? '🔐 Immutable Cryptographic Proof' : '🔐 Batch Fingerprint (not on-chain)'}
                    </h2>
                    <div className="space-y-2 text-xs font-mono">
                        <div>
                            <span className="text-gray-400 block text-[10px]">
                                SHA-256 BATCH FINGERPRINT{isVerified || isTampered ? ' (MATCHES ON-CHAIN RECORD)' : ' (COMPUTED LOCALLY — NOT ON A CHAIN)'}:
                            </span>
                            <div className="p-2.5 bg-gray-900 text-green-400 rounded-lg overflow-x-auto text-[11px] break-all">
                                {batch.blockchainHash}
                            </div>
                        </div>
                        {batch.blockchainTransactionHash && (
                            <div>
                                <span className="text-gray-400 block text-[10px]">POLYGON TRANSACTION CODE:</span>
                                <div className="p-2.5 bg-gray-900 text-purple-300 rounded-lg overflow-x-auto text-[11px] break-all">
                                    {batch.blockchainTransactionHash}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Timeline Events */}
                <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
                    <h2 className="text-base font-bold text-[#1a1a1a]">📍 Supply Chain Audit Events</h2>
                    <div className="space-y-3">
                        {batch.events?.map((evt: any, idx: number) => (
                            <div key={evt.id || idx} className="flex gap-4 items-start p-3 bg-gray-50 rounded-xl border border-gray-100">
                                <div className="w-8 h-8 rounded-full bg-green-100 text-[#16a34a] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                                    {idx + 1}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-[#1a1a1a]">{evt.eventType}</span>
                                        <span className="text-[10px] text-gray-400">{new Date(evt.timestamp).toLocaleString()}</span>
                                    </div>
                                    <p className="text-xs text-gray-600 mt-0.5">{evt.metadata || evt.location}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Action Button */}
                <div className="text-center pt-4">
                    <Link href="/consumer" className="px-6 py-3 bg-[#16a34a] text-white font-bold rounded-xl shadow-md text-sm hover:bg-green-700 transition-all">
                        Scan Another Crop Batch →
                    </Link>
                </div>
            </div>
        </div>
    );
}
