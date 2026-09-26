'use client';

import React, { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { Users, Shield, Activity, AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react';

interface SysUser {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
}

export default function AdminDashboard() {
    const [users, setUsers] = useState<SysUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [statsLoading, setStatsLoading] = useState(true);

    const fetchUsers = async () => {
        try {
            const res = await fetch('/api/admin/users');
            const json = await res.json();
            if (json.success) setUsers(json.data || []);
        } catch (e) {
            console.error('Failed to fetch users:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
        // Simulate stats for now
        setTimeout(() => setStatsLoading(false), 400);
    }, []);

    const roleBadgeColor: Record<string, string> = {
        FARMER: 'bg-green-100 text-green-700',
        EXPORTER: 'bg-blue-100 text-blue-700',
        TRANSPORTER: 'bg-amber-100 text-amber-700',
        IMPORTER: 'bg-purple-100 text-purple-700',
        RETAILER: 'bg-pink-100 text-pink-700',
        CONSUMER: 'bg-gray-100 text-gray-700',
        REGULATOR: 'bg-orange-100 text-orange-700',
        ADMIN: 'bg-red-100 text-red-700',
    };

    const statCards = [
        { label: 'Total Users', value: users.length || '–', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50/80' },
        { label: 'Active Sessions', value: '–', icon: Activity, color: 'text-agro-green', bg: 'bg-green-50/80' },
        { label: 'Fraud Alerts', value: '12', icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50/80' },
        { label: 'Secure Routes', value: '24', icon: Shield, color: 'text-purple-600', bg: 'bg-purple-50/80' },
    ];

    return (
        <DashboardLayout title="System Administration">
            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {statCards.map((s, idx) => (
                    <div key={idx} className="glass-card p-5 flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
                            <s.icon className={`w-5 h-5 ${s.color}`} />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{s.label}</p>
                            <p className={`text-2xl font-extrabold ${s.color} mt-0.5`}>{s.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* User Management Table */}
            <div className="glass-card overflow-hidden">
                <div className="px-6 py-4 border-b border-white/40 flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-bold text-[#1a1a1a]">Platform Users</h2>
                        <p className="text-[11px] text-gray-500 mt-0.5">All registered accounts across all roles</p>
                    </div>
                    <button
                        onClick={() => { setLoading(true); fetchUsers(); }}
                        className="flex items-center gap-1.5 text-xs font-bold text-agro-green hover:text-green-800 transition-colors"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Refresh
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-white/20 border-b border-white/40">
                            <tr className="text-[10px] uppercase font-extrabold tracking-wider text-gray-500">
                                <th className="py-3 px-5">Name</th>
                                <th className="py-3 px-5">Email</th>
                                <th className="py-3 px-5">Role</th>
                                <th className="py-3 px-5">Joined</th>
                                <th className="py-3 px-5 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/30">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="py-12 text-center text-sm text-gray-500 font-medium">
                                        <div className="flex items-center justify-center gap-2">
                                            <span className="w-4 h-4 border-2 border-agro-green border-t-transparent rounded-full animate-spin"></span>
                                            Loading users...
                                        </div>
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="py-12 text-center text-sm text-gray-500 italic">
                                        No users found. The database may not be configured.
                                    </td>
                                </tr>
                            ) : (
                                users.map((u) => (
                                    <tr key={u.id} className="hover:bg-white/20 transition-colors">
                                        <td className="py-3.5 px-5 font-bold text-[#1a1a1a]">{u.name}</td>
                                        <td className="py-3.5 px-5 text-gray-600 font-mono">{u.email}</td>
                                        <td className="py-3.5 px-5">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${roleBadgeColor[u.role] || 'bg-gray-100 text-gray-600'}`}>
                                                {u.role}
                                            </span>
                                        </td>
                                        <td className="py-3.5 px-5 text-gray-500">
                                            {new Date(u.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </td>
                                        <td className="py-3.5 px-5 text-right">
                                            <button className="text-agro-green text-xs font-bold hover:underline inline-flex items-center gap-0.5">
                                                Manage <ChevronRight className="w-3 h-3" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* RBAC Policy Overview */}
            <div className="glass-card p-6">
                <h2 className="text-base font-bold mb-4">RBAC Policy Matrix</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {['FARMER', 'EXPORTER', 'TRANSPORTER', 'IMPORTER', 'RETAILER', 'CONSUMER', 'REGULATOR', 'ADMIN'].map((role) => (
                        <div key={role} className={`${roleBadgeColor[role]} px-3 py-2.5 rounded-xl border border-white/60`}>
                            <p className="text-[10px] uppercase font-extrabold tracking-wider">{role}</p>
                            <p className="text-xs font-semibold mt-0.5 opacity-80">
                                {role === 'FARMER' ? '3 permissions'
                                    : role === 'EXPORTER' ? '6 permissions'
                                        : role === 'TRANSPORTER' ? '4 permissions'
                                            : role === 'IMPORTER' ? '5 permissions'
                                                : role === 'RETAILER' ? '4 permissions'
                                                    : role === 'CONSUMER' ? '3 permissions'
                                                        : role === 'REGULATOR' ? '8 permissions'
                                                            : '14 permissions'}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </DashboardLayout>
    );
}
