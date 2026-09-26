'use client';

import React from 'react';

export interface BatchRow {
  id: string;
  crop: string;
  qty: string;
  harvestDate: string;
  trustScore: number;
  status: 'Exported' | 'In Transit' | 'Delivered' | 'Flagged' | 'Processing';
}

const defaultRows: BatchRow[] = [
  { id: 'AG-2847', crop: 'Alphonso Mango', qty: '2,400 kg', harvestDate: '12 Mar 2026', trustScore: 89, status: 'Exported' },
  { id: 'AG-2841', crop: 'Nashik Grapes', qty: '1,800 kg', harvestDate: '08 Mar 2026', trustScore: 76, status: 'In Transit' },
  { id: 'AG-2835', crop: 'Basmati Rice', qty: '5,200 kg', harvestDate: '02 Mar 2026', trustScore: 92, status: 'Delivered' },
  { id: 'AG-2829', crop: 'Kesar Saffron', qty: '120 kg', harvestDate: '24 Feb 2026', trustScore: 95, status: 'Delivered' },
  { id: 'AG-2821', crop: 'Darjeeling Tea', qty: '680 kg', harvestDate: '18 Feb 2026', trustScore: 61, status: 'Flagged' },
];

export default function BatchTable({ rows = defaultRows }: { rows?: BatchRow[] }) {
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
            {rows.map((row, idx) => {
              let scoreBadgeColor = 'bg-green-100 text-[#16a34a] border-green-200';
              if (row.trustScore < 50) scoreBadgeColor = 'bg-red-100 text-red-700 border-red-200';
              else if (row.trustScore < 80) scoreBadgeColor = 'bg-amber-100 text-amber-800 border-amber-200';

              let statusColor = 'bg-gray-100 text-gray-700';
              if (row.status === 'Exported') statusColor = 'bg-blue-100 text-blue-800';
              else if (row.status === 'In Transit') statusColor = 'bg-amber-100 text-amber-800';
              else if (row.status === 'Delivered') statusColor = 'bg-green-100 text-green-800';
              else if (row.status === 'Flagged') statusColor = 'bg-red-100 text-red-800';

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
