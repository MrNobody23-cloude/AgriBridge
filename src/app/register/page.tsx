'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ROLES } from '@/lib/permissions';

export default function RegisterPage() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [role, setRole] = useState('FARMER');

    // Extra details based on role
    const [farmName, setFarmName] = useState('');
    const [location, setLocation] = useState('');
    const [stateInfo, setStateInfo] = useState('');
    const [district, setDistrict] = useState('');
    const [companyDetails, setCompanyDetails] = useState('');

    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            setLoading(false);
            return;
        }

        try {
            const payload = {
                name, email, password, role,
                ...(role === ROLES.FARMER ? { farmName, location, state: stateInfo, district } : { companyDetails })
            };

            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                setError(data.error?.message || 'Registration failed');
                return;
            }
            router.push('/login');
        } catch (err) {
            setError('An error occurred during registration');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#FAFAF7] flex text-[#1a1a1a]">
            {/* Left Section - Branding */}
            <div className="hidden lg:flex w-1/3 flex-col justify-center px-10 relative overflow-hidden bg-white border-r border-gray-200">
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="w-12 h-12 rounded-xl bg-agro-green text-white text-2xl flex items-center justify-center shadow-lg">
                            🌾
                        </div>
                        <span className="text-2xl font-extrabold tracking-tight text-agro-green">AgriBridge AI</span>
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight mb-4 text-[#1a1a1a]">Join the Trust Network</h1>
                    <p className="text-gray-600 font-medium mb-12 text-sm leading-relaxed">
                        Become part of India's most secure and transparent agricultural supply chain platform powered by blockchain and AI.
                    </p>
                </div>
            </div>

            {/* Right Section - Registration Form */}
            <div className="w-full lg:w-2/3 flex items-center justify-center p-8 bg-[#FAFAF7]">
                <div className="w-full max-w-2xl glass-panel p-10 rounded-2xl">
                    <h2 className="text-2xl font-extrabold mb-2 text-[#1a1a1a]">Create Account</h2>
                    <p className="text-gray-500 text-sm mb-6 border-b border-gray-200 pb-4">Register your organization on AgriBridge AI</p>

                    <form onSubmit={handleRegister} className="space-y-5">
                        {error && (
                            <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg text-center font-medium">
                                {error}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Full Name / Contact Person</label>
                                <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-agro-green/50" placeholder="Jane Doe" required />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Email</label>
                                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-agro-green/50" placeholder="name@company.com" required />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Password</label>
                                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-agro-green/50" required />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Confirm Password</label>
                                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-agro-green/50" required />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Primary Role</label>
                            <select value={role} onChange={e => setRole(e.target.value)} className="w-full px-4 py-3 bg-white/50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-agro-green/50">
                                <option value="FARMER">Farmer</option>
                                <option value="EXPORTER">Exporter</option>
                                <option value="TRANSPORTER">Transporter</option>
                                <option value="IMPORTER">Importer</option>
                                <option value="RETAILER">Retailer</option>
                                <option value="CONSUMER">Consumer</option>
                                {/* Regulator and Admin omitted from self-service registration */}
                            </select>
                        </div>

                        {role === 'FARMER' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-green-50/50 p-4 rounded-xl border border-green-100">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Farm Name</label>
                                    <input type="text" value={farmName} onChange={e => setFarmName(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" required />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Location / Village</label>
                                    <input type="text" value={location} onChange={e => setLocation(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" required />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">District</label>
                                    <input type="text" value={district} onChange={e => setDistrict(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" required />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">State</label>
                                    <input type="text" value={stateInfo} onChange={e => setStateInfo(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" required />
                                </div>
                            </div>
                        ) : (role !== 'CONSUMER' && (
                            <div className="bg-gray-50/50 p-4 rounded-xl border border-gray-200">
                                <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide">Company / Organization Details</label>
                                <input type="text" value={companyDetails} onChange={e => setCompanyDetails(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-lg" placeholder="Company Name, License Number, etc." required />
                            </div>
                        ))}

                        <button type="submit" disabled={loading} className="w-full bg-agro-green text-white py-3.5 rounded-xl font-bold hover:bg-green-800 transition-colors shadow-lg shadow-green-900/20 disabled:opacity-70 mt-6">
                            {loading ? "Creating Account..." : "Register"}
                        </button>
                    </form>

                    <div className="mt-8 text-center text-sm font-medium text-gray-600 border-t border-gray-200 pt-6">
                        Already have an account?{' '}
                        <Link href="/login" className="font-bold text-agro-green hover:text-green-800 transition-colors">
                            Sign In
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
