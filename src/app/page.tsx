'use client';

import React from 'react';
import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FAFAF7] text-[#1a1a1a]">
      {/* Top Header */}
      <header className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#16a34a] text-white text-2xl flex items-center justify-center shadow-xs">
            🌾
          </div>
          <div>
            <span className="text-lg font-extrabold tracking-tight text-[#1a1a1a]">AgriBridge AI</span>
            <span className="block text-[10px] font-bold text-[#16a34a] uppercase tracking-wider">Bharat Trust Platform</span>
          </div>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-gray-700">
          <a href="#roles" className="hover:text-[#16a34a] transition-colors">Roles</a>
          <a href="#how-it-works" className="hover:text-[#16a34a] transition-colors">How it Works</a>
          <a href="#tech" className="hover:text-[#16a34a] transition-colors">Technology</a>
        </nav>
        <Link
          href="/login"
          className="px-5 py-2.5 bg-[#16a34a] hover:bg-green-700 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-green-200"
        >
          Enter Platform →
        </Link>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-12 lg:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Left Column */}
        <div className="lg:col-span-6 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-100 border border-green-200 rounded-full text-xs font-bold text-[#16a34a]">
            <span>🌱</span> Built Specifically for Indian Agriculture
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight text-[#1a1a1a] tracking-tight">
            India's Agricultural <br />
            Supply Chain <br />
            <span className="text-[#16a34a]">Finally Has a Brain.</span>
          </h1>
          <p className="text-base text-gray-600 leading-relaxed font-medium max-w-xl">
            AgriBridge AI combines Blockchain, Agentic AI, and Machine Learning to protect 50M+ Indian farmers from supply chain fraud, ensure food safety, and give consumers verifiable trust — from Nashik to New York.
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <Link
              href="/login"
              className="px-6 py-3.5 bg-[#16a34a] hover:bg-green-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-green-200 text-sm flex items-center gap-2"
            >
              Enter Platform →
            </Link>
            <a
              href="#how-it-works"
              className="px-6 py-3.5 bg-white border-2 border-gray-200 hover:border-[#16a34a] text-[#1a1a1a] font-bold rounded-xl transition-all text-sm flex items-center gap-2 shadow-2xs"
            >
              Watch How It Works 🎬
            </a>
          </div>
        </div>

        {/* Right Column: Signature Supply Chain Visual */}
        <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-gray-200 shadow-md space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <span className="text-xs font-extrabold text-[#1a1a1a] uppercase tracking-wider flex items-center gap-2">
              <span className="pulsing-dot"></span> Live Polygon Blockchain Supply Chain
            </span>
            <span className="text-[11px] font-mono text-gray-400">Block #1849204</span>
          </div>

          {/* Connected Nodes */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 relative">
            {[
              { icon: '🌾', title: 'Farm', desc: 'Rajesh Kumar, Nashik', hash: '0x7f3a...89a2' },
              { icon: '⚖️', title: 'Mandi', desc: 'APMC Nashik Hub', hash: '0x3b1c...90e1' },
              { icon: '📦', title: 'Exporter', desc: 'AgriPro Global Ltd', hash: '0x9d4e...11c4' },
              { icon: '🚢', title: 'Shipping', desc: 'JNPT Port to Dubai', hash: '0x5a2f...33b8' },
              { icon: '🏪', title: 'Retailer', desc: 'Al Maya Supermarket', hash: '0x1c8b...44a9' },
              { icon: '👤', title: 'Consumer', desc: 'Verified Authenticity', hash: '0x8e9d...77f1' },
            ].map((node, i) => (
              <div
                key={i}
                className="bg-[#FAFAF7] p-3 rounded-xl border border-gray-200 hover:border-[#16a34a] transition-all relative group shadow-2xs"
              >
                <div className="text-2xl mb-1">{node.icon}</div>
                <p className="text-xs font-extrabold text-[#1a1a1a]">{node.title}</p>
                <p className="text-[10px] text-gray-500 font-medium truncate">{node.desc}</p>
                <div className="mt-2 pt-1 border-t border-gray-200 flex items-center justify-between">
                  <span className="text-[9px] font-mono text-[#16a34a] font-bold">{node.hash}</span>
                  <span className="text-[9px] text-green-700 font-bold">✓</span>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-green-50 p-3 rounded-xl border border-green-200 flex items-center justify-between text-xs">
            <span className="font-bold text-green-900 flex items-center gap-1.5">
              <span>🤖</span> Agentic AI Monitoring: <strong>Active 24/7</strong>
            </span>
            <span className="font-bold text-[#16a34a]">99.2% Fraud Proof</span>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section className="bg-[#16a34a] text-white py-6 shadow-md">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div>
            <p className="text-2xl sm:text-3xl font-extrabold tracking-tight">₹2.3Cr</p>
            <p className="text-xs font-medium text-green-100 uppercase tracking-wider mt-0.5">Farmer Earnings Protected</p>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-extrabold tracking-tight">2.3M</p>
            <p className="text-xs font-medium text-green-100 uppercase tracking-wider mt-0.5">Batches on Blockchain</p>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-extrabold tracking-tight">99.2%</p>
            <p className="text-xs font-medium text-green-100 uppercase tracking-wider mt-0.5">Fraud Detection Rate</p>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-extrabold tracking-tight">47</p>
            <p className="text-xs font-medium text-green-100 uppercase tracking-wider mt-0.5">Export Countries</p>
          </div>
        </div>
      </section>

      {/* Role Selection Section */}
      <section id="roles" className="max-w-7xl mx-auto px-6 py-16 space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-3xl font-extrabold text-[#1a1a1a] tracking-tight">Who are you in the supply chain?</h2>
          <p className="text-sm text-gray-600 font-medium">
            AgriBridge AI provides specialized dashboards engineered for each stakeholder.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              emoji: '🌾',
              role: 'Farmer',
              desc: 'Register batches, track earnings, get AI quality advice',
              href: '/login',
            },
            {
              emoji: '📦',
              role: 'Exporter',
              desc: 'Verify compliance, detect fraud, manage shipments',
              href: '/login',
            },
            {
              emoji: '🚢',
              role: 'Importer',
              desc: 'Validate certificates, verify authenticity',
              href: '/login',
            },
            {
              emoji: '🏪',
              role: 'Retailer',
              desc: 'Prioritize batches, reduce food waste',
              href: '/login',
            },
            {
              emoji: '👤',
              role: 'Consumer',
              desc: "Scan QR, verify your food's journey",
              href: '/login',
            },
            {
              emoji: '🏛️',
              role: 'Regulator',
              desc: 'Monitor fraud alerts, audit supply chains',
              href: '/login',
            },
          ].map((card, i) => (
            <Link
              key={i}
              href={card.href}
              className="bg-white p-6 rounded-xl border border-gray-200 hover:border-[#16a34a] hover:shadow-md transition-all group flex flex-col justify-between"
            >
              <div>
                <div className="text-4xl mb-3">{card.emoji}</div>
                <h3 className="text-lg font-bold text-[#1a1a1a] group-hover:text-[#16a34a] transition-colors flex items-center justify-between">
                  {card.role}
                  <span className="text-base text-gray-400 group-hover:text-[#16a34a] group-hover:translate-x-1 transition-all">→</span>
                </h3>
                <p className="text-xs text-gray-600 mt-2 font-medium leading-relaxed">{card.desc}</p>
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs font-bold text-[#16a34a]">
                <span>Enter Dashboard</span>
                <span>→</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Technology Pillars */}
      <section id="tech" className="bg-white py-16 border-y border-gray-200">
        <div className="max-w-7xl mx-auto px-6 space-y-10">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-3xl font-extrabold text-[#1a1a1a] tracking-tight">Technology Pillars</h2>
            <p className="text-sm text-gray-600 font-medium">Under the hood of India's most advanced agritech trust engine</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: '🔗',
                title: 'Blockchain (Polygon)',
                desc: 'Immutable record of every supply chain event',
              },
              {
                icon: '🤖',
                title: 'Agentic AI (LangGraph)',
                desc: '7 autonomous agents monitoring 24/7',
              },
              {
                icon: '🧠',
                title: 'Machine Learning',
                desc: 'Predicts spoilage, fraud, and quality risks',
              },
              {
                icon: '📚',
                title: 'RAG Compliance',
                desc: 'Evidence-based regulatory guidance for 47 countries',
              },
            ].map((pillar, i) => (
              <div key={i} className="bg-[#FAFAF7] p-6 rounded-xl border border-gray-200 hover:border-[#16a34a] transition-all">
                <div className="text-3xl mb-3">{pillar.icon}</div>
                <h3 className="text-sm font-extrabold text-[#1a1a1a]">{pillar.title}</h3>
                <p className="text-xs text-gray-600 mt-2 font-medium leading-relaxed">{pillar.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-6 py-16 space-y-10">
        <div className="text-center max-w-xl mx-auto space-y-2">
          <h2 className="text-3xl font-extrabold text-[#1a1a1a] tracking-tight">How It Works</h2>
          <p className="text-sm text-gray-600 font-medium">4 seamless steps from farm harvest to consumer trust</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { step: '1', icon: '🌾', title: 'Farm Registration', desc: 'Farmer registers batch → Smart contract created on Polygon' },
            { step: '2', icon: '🤖', title: 'AI Monitoring', desc: '7 Agentic AI agents monitor transactions, cold chain, and compliance' },
            { step: '3', icon: '📊', title: 'Trust Scoring', desc: 'Real-time trust score calculated and updated at every stage' },
            { step: '4', icon: '📱', title: 'Consumer QR Scan', desc: 'Consumer scans QR code to verify complete authenticated history' },
          ].map((item, i) => (
            <div key={i} className="bg-white p-6 rounded-xl border border-gray-200 relative shadow-2xs">
              <div className="w-8 h-8 rounded-full bg-green-100 text-[#16a34a] font-extrabold text-xs flex items-center justify-center mb-3">
                {item.step}
              </div>
              <div className="text-2xl mb-2">{item.icon}</div>
              <h3 className="text-sm font-bold text-[#1a1a1a]">{item.title}</h3>
              <p className="text-xs text-gray-600 mt-1.5 font-medium leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1a1a1a] text-white py-12 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#16a34a] text-white text-xl flex items-center justify-center">🌾</div>
            <div>
              <span className="font-extrabold text-base text-white">AgriBridge AI</span>
              <p className="text-xs text-gray-400">Bharat Agricultural Trust Intelligence</p>
            </div>
          </div>
          <p className="text-xs text-gray-400">© 2026 AgriBridge AI Platform. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
