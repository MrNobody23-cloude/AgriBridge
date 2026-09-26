'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setError(data.error?.message || 'Invalid credentials');
                return;
            }
            // Navigate based on role
            const userRole = data.data.user.role.toLowerCase();
            router.push(`/${userRole}`);
            router.refresh();
        } catch (err) {
            setError('An error occurred during login');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#FAFAF7] flex text-[#1a1a1a]">
            {/* Left Section - Branding */}
            <div className="hidden lg:flex w-1/2 flex-col justify-center px-16 relative overflow-hidden bg-white">
                <div className="absolute inset-0 z-0 opacity-20 pointer-events-none" style={{
                    backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%2316a34a\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")'
                }}></div>
                {/* Abstract Data Stream Background */}
                <div className="absolute bottom-0 left-0 w-full h-1/2 bg-gradient-to-t from-green-50 to-transparent"></div>

                <div className="relative z-10 max-w-lg">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 rounded-xl bg-agro-green text-white text-xl flex items-center justify-center shadow-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                        </div>
                        <div>
                            <span className="text-2xl font-extrabold tracking-tight text-agro-green">AgriBridge AI</span>
                        </div>
                    </div>

                    <h1 className="text-4xl font-extrabold tracking-tight mb-4 text-[#1a1a1a]">
                        Agricultural Trust Intelligence
                    </h1>

                    <p className="text-lg text-gray-600 font-medium mb-12">
                        Building a more transparent, intelligent and trustworthy agricultural supply chain.
                    </p>

                    <div className="space-y-6">
                        <div className="flex items-center gap-4 p-4 glass-card">
                            <div className="w-10 h-10 rounded-xl bg-agro-green/10 text-agro-green flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 22h20"/><path d="M12 2v20"/><path d="M2 12h20"/></svg></div>
                            <div className="flex-1"><p className="font-bold text-sm">Farm Traceability</p><p className="text-xs text-gray-500">Immutable origin records</p></div>
                        </div>
                        <div className="flex items-center gap-4 p-4 glass-card ml-8">
                            <div className="w-10 h-10 rounded-xl bg-tech-blue/10 text-tech-blue flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div>
                            <div className="flex-1"><p className="font-bold text-sm">Blockchain Verification</p><p className="text-xs text-gray-500">Cryptographically secured</p></div>
                        </div>
                        <div className="flex items-center gap-4 p-4 glass-card ml-16 relative overflow-hidden">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></div>
                            <div className="flex-1"><p className="font-bold text-sm">Agentic AI Monitoring</p><p className="text-xs text-gray-500">Real-time risk analysis</p></div>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pulsing-dot opacity-50"></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Section - Login Form */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[#FAFAF7] relative">
                {/* Decorative Elements */}
                <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-green-200 rounded-full blur-[100px] opacity-30"></div>

                <div className="w-full max-w-md glass-panel p-10 rounded-2xl relative z-10">
                    <h2 className="text-3xl font-extrabold mb-2 text-center text-[#1a1a1a]">Sign In</h2>
                    <p className="text-center text-gray-500 text-sm mb-8">Access your customized workspace</p>

                    <form onSubmit={handleLogin} className="space-y-5">
                        {error && (
                            <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg text-center font-medium">
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-agro-green/50 focus:border-agro-green transition-all"
                                placeholder="name@company.com"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-agro-green/50 focus:border-agro-green transition-all"
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        <div className="flex items-center justify-between text-sm">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" className="w-4 h-4 text-agro-green focus:ring-agro-green/50 rounded border-gray-300" />
                                <span className="font-medium text-gray-600">Remember me</span>
                            </label>

                            <a href="#" className="font-bold text-agro-green hover:text-green-800 transition-colors">
                                Forgot password?
                            </a>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-agro-green text-white py-3.5 rounded-xl font-bold hover:bg-green-800 transition-colors shadow-lg shadow-green-900/20 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Authenticating...
                                </>
                            ) : "Login to Workspace"}
                        </button>
                    </form>

                    <div className="mt-8 text-center text-sm font-medium text-gray-600 border-t border-gray-200 pt-6">
                        Don't have an account?{' '}
                        <Link href="/register" className="font-bold text-agro-green hover:text-green-800 transition-colors">
                            Create account
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
