'use client';

import React, { useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import TrustScoreGauge from '@/components/TrustScoreGauge';
import type { ApiBatchDetail } from '@/lib/api-types';
import RecentBatchCodes from '@/components/RecentBatchCodes';
import Link from 'next/link';

export default function ConsumerPage() {
  // Empty by default. This was pre-filled with 'AGR-2026-UK-284701' and the
  // chat silently fell back to the same code whenever the field was cleared,
  // so a consumer who typed nothing still got an answer about a specific
  // batch — one they never chose, and one that may not exist.
  const [searchCode, setSearchCode] = useState('');
  const [batchData, setBatchData] = useState<ApiBatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // AI Chat Bot State
  const [chatMessages, setChatMessages] = useState<Array<{ sender: 'user' | 'bot'; text: string }>>([
    { sender: 'bot', text: 'Hello! I am your Consumer Trust AI Assistant. Ask me anything about crop origins, organic certifications, or blockchain proof.' },
  ]);
  const [userQuery, setUserQuery] = useState('');
  const [chatting, setChatting] = useState(false);

  const handleVerify = async (codeToSearch?: string) => {
    const targetCode = codeToSearch || searchCode;
    if (!targetCode) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/batches/${targetCode}`);
      const json = await res.json();

      if (json.success) {
        setBatchData(json.data);
      } else {
        setError(json.error?.message || 'Batch code not found in blockchain registry');
        setBatchData(null);
      }
    } catch {
      setError('Connection failed. Please check network.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendQuery = async (queryText?: string) => {
    const q = queryText || userQuery;
    if (!q) return;

    // The assistant answers about one batch, so there must be one. It used
    // to substitute a hardcoded code when the field was empty, which meant
    // the "verified" answer on screen was about a batch the consumer never
    // looked up.
    const batchCode = searchCode.trim();
    if (!batchCode) {
      setError('Enter a batch ID above before asking a question — the assistant answers about a specific batch.');
      return;
    }

    const newMsgs = [...chatMessages, { sender: 'user' as const, text: q }];
    setChatMessages(newMsgs);
    setUserQuery('');
    setChatting(true);

    try {
      const res = await fetch('/api/consumer/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: batchCode, query: q }),
      });

      const json = await res.json();
      if (json.success) {
        setChatMessages([...newMsgs, { sender: 'bot', text: json.data.answer }]);
      } else {
        setChatMessages([...newMsgs, { sender: 'bot', text: 'Apologies, I encountered an issue retrieving verified answers.' }]);
      }
    } catch {
      setChatMessages([...newMsgs, { sender: 'bot', text: 'Network connection issue.' }]);
    } finally {
      setChatting(false);
    }
  };

  return (
    <DashboardLayout title="Consumer Verification">
      {/* Top Banner Search */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-xs space-y-4">
        <div className="max-w-xl mx-auto text-center space-y-2">
          <h2 className="text-xl font-extrabold text-[#1a1a1a]">🔍 Verify Agricultural Product Authenticity</h2>
          <p className="text-xs text-gray-500">
            Scan your package QR code or enter the batch ID below to verify Polygon blockchain hashes & farmer origin.
          </p>

          <div className="flex gap-2 pt-2">
            <input
              type="text"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value.toUpperCase())}
              placeholder="Enter Batch ID (e.g. AG-2835, AG-2847)"
              className="flex-1 text-sm font-mono font-bold text-[#16a34a] p-3 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none uppercase"
            />
            <button
              onClick={() => handleVerify()}
              disabled={loading}
              className="px-6 py-3 bg-[#16a34a] text-white text-xs font-bold rounded-xl shadow-sm hover:bg-green-700 transition-all shrink-0"
            >
              {loading ? 'Verifying...' : 'Verify Batch →'}
            </button>
          </div>

          {/* Unlabelled sample codes. A visitor could not tell these from a
              list of real batches, so an empty ledger still looked populated
              — the "no results" state was the one thing a verifier most needs
              to trust. They are now called what they are, and each one is
              only offered if it actually exists in the ledger. */}
          <RecentBatchCodes
            codes={['AGR-2026-UK-284701', 'AGR-2026-EU-284102', 'AGR-2026-US-283503']}
            onPick={(code) => {
              setSearchCode(code);
              handleVerify(code);
            }}
          />
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold text-center">
          ⚠️ {error}
        </div>
      )}

      {/* Main Grid: Verified Batch Info + AI Chat */}
      {batchData && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Batch Trust Score & Origin */}
          <div className="lg:col-span-1 bg-white rounded-2xl p-6 border border-gray-200 shadow-xs space-y-5 text-center">
            <div className="inline-block p-2 bg-green-50 rounded-2xl border border-green-100">
              <TrustScoreGauge score={batchData.trustScoreDetails?.finalScore ?? batchData.trustScore ?? 0} size={150} />
            </div>

            <div>
              {/* This badge read "✓ POLYGON BLOCKCHAIN VERIFIED" for every
                  batch the API returned, including those whose chain status
                  is NOT_CONFIGURED, UNREACHABLE or NOT_FOUND. The API already
                  returns `chainVerification`; the badge now reports it, and
                  a chain that could not be checked is not shown as verified. */}
              {(() => {
                const chain = batchData.chainVerification;
                const verified = chain?.status === 'VERIFIED';
                const tampered = chain?.status === 'TAMPERED';
                const styles = tampered
                  ? 'bg-red-100 text-red-700'
                  : verified
                    ? 'bg-green-100 text-[#16a34a]'
                    : 'bg-amber-100 text-amber-800';
                const label = tampered
                  ? '⚠ ON-CHAIN RECORD MISMATCH'
                  : verified
                    ? '✓ POLYGON BLOCKCHAIN VERIFIED'
                    : `CHAIN ${String(chain?.status || 'UNVERIFIED').replace(/_/g, ' ')}`;
                return (
                  <>
                    <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full ${styles}`}>
                      {label}
                    </span>
                    {!verified && !tampered && (
                      <p className="text-[10px] text-gray-400 mt-1.5">
                        {chain?.reason
                          ? chain.reason
                          : 'The chain status could not be established, so no verification is claimed.'}
                      </p>
                    )}
                  </>
                );
              })()}
              <h3 className="text-lg font-bold text-[#1a1a1a] mt-2">{batchData.product?.name}</h3>
              <p className="text-xs text-gray-500 font-mono">Batch Code: {batchData.batchCode}</p>
            </div>

            <div className="p-3 bg-[#FAFAF7] rounded-xl border border-gray-200 text-left text-xs space-y-1.5 font-medium">
              <p><span className="text-gray-400">Farmer:</span> <span className="font-bold text-[#1a1a1a]">{batchData.farmer?.name}</span></p>
              <p><span className="text-gray-400">Origin:</span> <span className="font-bold text-[#1a1a1a]">{batchData.location}</span></p>
              <p><span className="text-gray-400">Harvest Date:</span> <span className="font-bold text-[#1a1a1a]">{new Date(batchData.harvestDate).toLocaleDateString()}</span></p>
            </div>

            <Link
              href={`/verify/${batchData.batchCode}`}
              target="_blank"
              className="block w-full py-2.5 bg-gray-900 text-white text-xs font-bold rounded-xl hover:bg-black text-center"
            >
              View Full Certificate & Hashes →
            </Link>
          </div>

          {/* Right Column: Interactive AI Q&A Bot */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-6 border border-gray-200 shadow-xs flex flex-col justify-between space-y-4">
            <div className="border-b border-gray-100 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#1a1a1a] flex items-center gap-2">
                  <span>🤖</span> Consumer Trust AI Assistant
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {/* Claimed the answers were "grounded in verified
                      blockchain audit records" for every batch, including one
                      whose chain status is NOT_CONFIGURED or UNREACHABLE. */}
                  Answers are drawn from the ledger record for {batchData.batchCode}
                  {batchData.chainVerification?.status === 'VERIFIED'
                    ? ', which is anchored on-chain.'
                    : '.'}
                </p>
              </div>
              {/* "Online" was printed unconditionally. Nothing here probes the
                  Python service; whether the assistant can answer is only known
                  once a question has been sent. */}
            </div>

            {/* Chat Box */}
            <div className="h-64 overflow-y-auto space-y-3 p-3 bg-[#FAFAF7] rounded-xl border border-gray-200">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-md p-3 rounded-2xl text-xs font-medium ${msg.sender === 'user'
                      ? 'bg-[#16a34a] text-white rounded-br-none'
                      : 'bg-white border border-gray-200 text-[#1a1a1a] rounded-bl-none shadow-xs'
                      }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatting && (
                <div className="flex justify-start">
                  <div className="p-3 bg-white border border-gray-200 text-xs text-gray-400 rounded-2xl rounded-bl-none animate-pulse">
                    AI Agent is verifying blockchain logs...
                  </div>
                </div>
              )}
            </div>

            {/* Question Suggestion Chips */}
            <div className="flex flex-wrap gap-2">
              {[
                'Is this Basmati Rice authentic?',
                'Is this crop certified organic?',
                'Who is the farmer who grew this?',
              ].map((chip) => (
                <button
                  key={chip}
                  onClick={() => handleSendQuery(chip)}
                  className="text-[11px] font-semibold text-[#16a34a] bg-green-50 border border-green-200 px-3 py-1 rounded-full hover:bg-green-100"
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Query Input Form */}
            <div className="flex gap-2">
              <input
                type="text"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendQuery()}
                placeholder="Ask about pesticide screening, certifications, or harvest..."
                className="flex-1 text-xs font-medium text-[#1a1a1a] p-3 bg-[#FAFAF7] border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#16a34a] focus:outline-none"
              />
              <button
                onClick={() => handleSendQuery()}
                disabled={chatting}
                className="px-5 py-3 bg-[#16a34a] text-white text-xs font-bold rounded-xl hover:bg-green-700 shrink-0"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
