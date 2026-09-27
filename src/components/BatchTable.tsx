'use client';

import React from 'react';
import type { BatchStatus } from '@/lib/api-types';

export interface BatchRow {
  id: string;
  crop: string;
  qty: string;
  /** Raw numeric quantity and unit, for aggregation. `qty` is display-only. */
  quantity?: number;
  unit?: string;
  harvestDate: string;
  trustScore: number;
  status: BatchStatus;
}

/**
 * This table previously defaulted to five invented batches (Alphonso Mango at
 * 89/100, Darjeeling Tea at 61/100, and so on) whenever the `rows` prop was
 * omitted. A missing prop is now an empty table, never a fabricated one — a
 * screen showing real crops and invented trust scores is the exact failure
 * this project is supposed to prevent.
 */
export default function BatchTable({ rows = [] }: { rows?: BatchRow[] }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-base font-bold text-[#1a1a1a]">Recent Crop Batches</h3>
        <span className="text-xs font-medium text-gray-500">Showing {rows.length} batches</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-[#1a1a1a]">
          <thead className="bg-white/10 text-gray-500 font-semibold border-b border-gray-200/50 uppercase text-[11px] tracking-wider">
            <tr>
              <th className="py-3 px-4">Batch ID</th>
              <th className="py-3 px-4">Crop</th>
              <th className="py-3 px-4">Quantity</th>
              <th className="py-3 px-4">Harvest Date</th>
              <th className="py-3 px-4">Trust Score</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100/50">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 px-4 text-center text-gray-500 font-medium">
                  No batches to show.
                </td>
              </tr>
            )}
            {rows.map((row, idx) => {
              let scoreBadgeColor = 'bg-green-100 text-[#16a34a] border-green-200';
              if (row.trustScore < 50) scoreBadgeColor = 'bg-red-100 text-red-700 border-red-200';
              else if (row.trustScore < 80) scoreBadgeColor = 'bg-amber-100 text-amber-800 border-amber-200';

              let statusColor = 'bg-gray-100 text-gray-700';
              if (row.status === 'Exported') statusColor = 'bg-blue-100 text-blue-800';
              else if (row.status === 'In Transit') statusColor = 'bg-amber-100 text-amber-800';
              else if (row.status === 'Delivered') statusColor = 'bg-green-100 text-green-800';
              else if (row.status === 'Flagged') statusColor = 'bg-red-100 text-red-800';
              else if (row.status === 'Registered') statusColor = 'bg-indigo-100 text-indigo-800';

              return (
                <tr key={row.id} className={idx % 2 === 0 ? 'bg-white/30 hover:bg-white/50 transition-colors' : 'bg-transparent hover:bg-white/40 transition-colors'}>
                  <td className="py-3 px-4 font-mono font-bold text-agro-green">{row.id}</td>
                  <td className="py-3 px-4 font-semibold text-[#1a1a1a]">{row.crop}</td>
                  <td className="py-3 px-4 text-gray-600">{row.qty}</td>
                  <td className="py-3 px-4 text-gray-600">{row.harvestDate}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-extrabold text-[11px] border ${scoreBadgeColor}`}>
                      {row.trustScore}/100
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${statusColor}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button className="text-xs font-semibold text-[#16a34a] hover:text-green-800 hover:underline">
                      View →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
