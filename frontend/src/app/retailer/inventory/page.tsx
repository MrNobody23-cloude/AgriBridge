'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Boxes, CircleDollarSign, PackageCheck, RefreshCw, Search, TrendingUp } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';

type SaleRecord = { soldAt: string; quantity: number; unitPrice: number; amount: number };
type InventoryItem = {
  _id: string;
  crop: string;
  batchCode: string;
  quantityAvailable: number;
  quantitySold: number;
  quantityReceived: number;
  unit: string;
  purchasePricePerUnit: number;
  retailPricePerUnit: number | null;
  receivedAt: string;
  status: string;
  salesLog?: SaleRecord[];
};

const currency = (amount: number) => `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const quantity = (amount: number) => amount.toLocaleString('en-IN', { maximumFractionDigits: 3 });

export default function RetailerInventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [saleDrafts, setSaleDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestActive = useRef(false);

  const refreshInventory = useCallback(async (manual = false) => {
    if (requestActive.current) return;
    requestActive.current = true;
    if (manual) setRefreshing(true);
    try {
      const response = await fetch('/api/retailer/inventory', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error?.message || 'Unable to load inventory.');
      setItems(Array.isArray(json.data) ? json.data : []);
      setLastUpdated(new Date());
      setError((current) => current.startsWith('Could not refresh') ? '' : current);
    } catch (cause) {
      setError(cause instanceof Error ? `Could not refresh inventory: ${cause.message}` : 'Could not refresh inventory.');
    } finally {
      requestActive.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshInventory();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshInventory();
    }, 8000);
    const onFocus = () => void refreshInventory();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshInventory]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => item.crop.toLowerCase().includes(term) || item.batchCode.toLowerCase().includes(term));
  }, [items, search]);

  const stats = useMemo(() => {
    const availableByUnit = new Map<string, number>();
    let stockCost = 0;
    let salesValue = 0;
    for (const item of items) {
      availableByUnit.set(item.unit, (availableByUnit.get(item.unit) || 0) + item.quantityAvailable);
      stockCost += item.quantityAvailable * item.purchasePricePerUnit;
      salesValue += (item.salesLog || []).reduce((sum, sale) => sum + sale.amount, 0);
    }
    return {
      availableByUnit: [...availableByUnit.entries()],
      stockCost,
      salesValue,
      inStock: items.filter((item) => item.quantityAvailable > 0).length,
      soldOut: items.filter((item) => item.quantityAvailable <= 0).length,
    };
  }, [items]);

  async function savePrice(item: InventoryItem) {
    const retailPricePerUnit = Number(priceDrafts[item._id] ?? item.retailPricePerUnit);
    if (!Number.isFinite(retailPricePerUnit) || retailPricePerUnit <= 0) {
      setError('Enter a retail price greater than zero.');
      return;
    }
    setSaving(item._id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/retailer/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryId: item._id, action: 'PRICE', retailPricePerUnit }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error?.message || 'Could not save the retail price.');
      setItems((current) => current.map((entry) => entry._id === item._id ? { ...entry, ...json.data } : entry));
      setPriceDrafts((current) => { const next = { ...current }; delete next[item._id]; return next; });
      setMessage(`Retail price saved for ${item.crop} · ${item.batchCode}.`);
      void refreshInventory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the retail price.');
    } finally {
      setSaving(null);
    }
  }

  async function recordSale(item: InventoryItem) {
    const saleQuantity = Number(saleDrafts[item._id]);
    if (!Number.isFinite(saleQuantity) || saleQuantity <= 0 || saleQuantity > item.quantityAvailable) {
      setError(`Enter a sale quantity greater than zero and no more than ${quantity(item.quantityAvailable)} ${item.unit}.`);
      return;
    }
    if (!item.retailPricePerUnit || item.retailPricePerUnit <= 0) {
      setError('Set a retail price before recording a sale.');
      return;
    }
    setSaving(item._id);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/retailer/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryId: item._id, action: 'SELL', quantity: saleQuantity }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error?.message || 'Could not record the sale.');
      setItems((current) => current.map((entry) => entry._id === item._id ? { ...entry, ...json.data } : entry));
      setSaleDrafts((current) => ({ ...current, [item._id]: '' }));
      setMessage(`Sale recorded · ${currency(json.data.saleValue)}.`);
      void refreshInventory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the sale.');
      void refreshInventory();
    } finally {
      setSaving(null);
    }
  }

  return (
    <DashboardLayout title="Retail Inventory">
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/retailer" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:underline"><ArrowLeft size={16} /> Retailer dashboard</Link>
            <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">Inventory management</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">Track received stock, set selling prices and record sales. Inventory updates automatically while this page is open.</p>
          </div>
          <button onClick={() => void refreshInventory(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-60"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh</button>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Inventory summary">
          <SummaryCard icon={<Boxes size={18} />} label="Inventory batches" value={String(items.length)} detail={`${stats.inStock} in stock · ${stats.soldOut} sold out`} />
          <SummaryCard icon={<PackageCheck size={18} />} label="Available stock" value={stats.availableByUnit.length ? stats.availableByUnit.map(([unit, amount]) => `${quantity(amount)} ${unit}`).join(' · ') : '0'} detail="Quantities shown by unit" />
          <SummaryCard icon={<CircleDollarSign size={18} />} label="Stock at purchase cost" value={currency(stats.stockCost)} detail="Available quantity × purchase price" />
          <SummaryCard icon={<TrendingUp size={18} />} label="Recorded sales" value={currency(stats.salesValue)} detail="Total value in the sales ledger" />
        </section>

        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-extrabold text-slate-900">Stock items</h2><p className="text-xs text-slate-500">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-IN')}` : 'Waiting for inventory data'} · refreshes every 8 seconds</p></div>
            <label className="relative w-full sm:w-72"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search crop or batch" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm" /></label>
          </div>

          {loading ? <div className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500">Loading inventory…</div> : filteredItems.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><Boxes size={28} className="mx-auto text-emerald-700" /><p className="mt-3 font-bold text-slate-800">{items.length ? 'No matching inventory' : 'No stock received yet'}</p><p className="mt-1 text-sm text-slate-500">{items.length ? 'Try a different crop or batch code.' : 'Stock is added here after a transporter confirms delivery with the receipt OTP.'}</p></div> : <div className="grid gap-4 xl:grid-cols-2">
            {filteredItems.map((item) => {
              const isSaving = saving === item._id;
              const soldOut = item.quantityAvailable <= 0;
              const recentSales = (item.salesLog || []).slice().reverse();
              return <article key={item._id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><p className="font-mono text-xs text-slate-500">{item.batchCode}</p><h3 className="mt-1 truncate text-lg font-extrabold text-slate-900">{item.crop}</h3><p className="mt-1 text-xs text-slate-500">Received {new Date(item.receivedAt).toLocaleDateString('en-IN')} · Purchase {currency(item.purchasePricePerUnit)}/{item.unit}</p></div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${soldOut ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-800'}`}>{soldOut ? 'Sold out' : `${quantity(item.quantityAvailable)} ${item.unit} available`}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <StockValue label="Received" value={`${quantity(item.quantityReceived)} ${item.unit}`} />
                  <StockValue label="Sold" value={`${quantity(item.quantitySold)} ${item.unit}`} />
                  <StockValue label="Retail price" value={item.retailPricePerUnit ? `${currency(item.retailPricePerUnit)}/${item.unit}` : 'Not set'} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2"><label htmlFor={`price-${item._id}`} className="block text-xs font-bold text-slate-600">Retail price per {item.unit}</label><div className="flex gap-2"><input id={`price-${item._id}`} type="number" min="0.01" step="0.01" value={priceDrafts[item._id] ?? item.retailPricePerUnit ?? ''} onChange={(event) => setPriceDrafts((current) => ({ ...current, [item._id]: event.target.value }))} placeholder="Enter price" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" /><button disabled={isSaving} onClick={() => void savePrice(item)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-50">Save price</button></div></div>
                  <div className="space-y-2"><label htmlFor={`sale-${item._id}`} className="block text-xs font-bold text-slate-600">Record a sale</label><div className="flex gap-2"><input id={`sale-${item._id}`} type="number" min="0.01" step="0.01" max={item.quantityAvailable} value={saleDrafts[item._id] || ''} onChange={(event) => setSaleDrafts((current) => ({ ...current, [item._id]: event.target.value }))} placeholder={`Qty (${item.unit})`} disabled={soldOut} className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm disabled:bg-slate-100" /><button disabled={isSaving || soldOut || !item.retailPricePerUnit} onClick={() => void recordSale(item)} className="inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><PackageCheck size={14} /> Record</button></div></div>
                </div>

                {recentSales.length > 0 && <details className="border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-bold text-slate-600">Sales ledger · {recentSales.length} recorded</summary><ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">{recentSales.map((sale, index) => <li key={`${sale.soldAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="text-slate-600">{new Date(sale.soldAt).toLocaleString('en-IN')} · {quantity(sale.quantity)} {item.unit} × {currency(sale.unitPrice)}</span><strong className="text-slate-800">{currency(sale.amount)}</strong></li>)}</ul></details>}
              </article>;
            })}
          </div>}
        </section>
      </div>
    </DashboardLayout>
  );
}

function SummaryCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-emerald-800">{icon}<span className="text-xs font-bold text-slate-500">{label}</span></div><p className="mt-3 break-words text-xl font-extrabold text-slate-900">{value}</p><p className="mt-1 text-[11px] text-slate-500">{detail}</p></article>;
}

function StockValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg bg-slate-50 p-2.5"><p className="text-slate-500">{label}</p><p className="mt-1 truncate font-bold text-slate-800" title={value}>{value}</p></div>;
}
