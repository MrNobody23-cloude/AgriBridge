'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, MapPin, RefreshCw, Search, Sprout, Boxes, ArrowRight } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import OrderRouteMap from '@/components/OrderRouteMap';

type DeliveryOrder = { _id: string; status: string; batchCode: string; crop: string; quantity: number; unit: string; farmLocation: string; retailerLocation: string; retailerLatitude: number | null; retailerLongitude: number | null; transporterLatitude: number | null; transporterLongitude: number | null; lastLocationAt: string | null };
type MarketBatch = {
  _id: string; batchCode: string; quantity: number; unit: string; harvestDate: string; actualHarvestDate?: string;
  location: string; status: string; harvestStage?: string; product?: { name: string } | null;
  farmer?: { id: string; name: string; phone?: string; farmerProfile?: { farmName?: string; location?: string; district?: string; state?: string } | null } | null;
  fssaiCertificate?: { certificateType: string; verificationStatus: string; issuer: string; expiryDate: string; fileUrl?: string } | null;
  myOffer?: { _id: string; status: string; pricePerUnit: number; retailerLocation: string } | null;
  market: { count: number; highBid: number | null };
};

function googleMap(location: string) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`; }

export default function RetailerDashboard() {
  const [batches, setBatches] = useState<MarketBatch[]>([]);
  const [search, setSearch] = useState('');
  const [farmLocationFilter, setFarmLocationFilter] = useState('');
  const [retailerLocation, setRetailerLocation] = useState('');
  const [retailerCoordinates, setRetailerCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [priceByBatch, setPriceByBatch] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await fetch(`/api/marketplace/offers${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`); const json = await response.json(); if (!json.success) throw new Error(json.error?.message || 'Unable to load farmer batches.'); setBatches(json.data || []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load marketplace.'); }
    finally { setLoading(false); }
  }, [search]);
  useEffect(() => { Promise.resolve().then(refresh); }, [refresh]);
  const refreshOperations = useCallback(async () => {
    const ordersResponse = await fetch('/api/marketplace/orders', { cache: 'no-store' });
    const ordersJson = await ordersResponse.json();
    if (ordersJson.success) setOrders(ordersJson.data || []);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch and polling synchronize live delivery data.
  useEffect(() => { void refreshOperations(); const timer = window.setInterval(() => void refreshOperations(), 8000); return () => window.clearInterval(timer); }, [refreshOperations]);
  const nearby = useMemo(() => {
    const needle = farmLocationFilter.trim().toLowerCase();
    if (!needle) return batches;
    const matches = batches.filter((batch) => [batch.location, batch.farmer?.farmerProfile?.location, batch.farmer?.farmerProfile?.district, batch.farmer?.farmerProfile?.state].some((place) => place?.toLowerCase().includes(needle)));
    return matches;
  }, [batches, farmLocationFilter]);

  async function offerPrice(batch: MarketBatch) {
    const amount = Number(priceByBatch[batch._id]);
    if (!retailerLocation.trim()) { setError('Enter your retailer location before making an offer.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter a valid positive price per unit in INR.'); return; }
    setSaving(batch._id); setError(''); setMessage('');
    try {
      const response = await fetch('/api/marketplace/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: batch.batchCode, pricePerUnit: amount, retailerLocation, ...(retailerCoordinates || {}) }) });
      const json = await response.json(); if (!json.success) throw new Error(json.error?.message || 'Could not submit offer.');
      setMessage(`Offer submitted for ${batch.batchCode}. Transporters can now compare it with other retailer bids.`); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not submit offer.'); }
    finally { setSaving(null); }
  }

  return <DashboardLayout title="Retailer Crop Marketplace">
    <Link href="/retailer/inventory" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm transition hover:border-emerald-400 hover:shadow-md sm:p-6">
      <span className="flex min-w-0 items-center gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Boxes size={22} /></span><span><strong className="block text-base font-extrabold text-slate-900">Inventory management</strong><span className="mt-1 block text-sm text-slate-600">Manage stock, update retail prices and record sales.</span></span></span>
      <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-bold text-white">Open inventory <ArrowRight size={16} /></span>
    </Link>
    <section className="space-y-3"><div><h2 className="text-lg font-extrabold">Deliveries & live tracking</h2><p className="text-xs text-slate-500">This page refreshes transporter location every 8 seconds while an order is moving.</p></div>{orders.length === 0 ? <p className="rounded-xl bg-white p-5 text-sm text-slate-500">Accepted orders will appear here.</p> : orders.map((order) => <RetailerDelivery key={order._id} order={order} />)}</section>
    <section className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-lime-50 p-5 sm:p-7"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">Direct farm sourcing · India</p><h1 className="mt-2 text-2xl font-extrabold text-slate-900">Find a crop. Make an offer.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Browse farmer batches, compare expected harvest dates and certificate status, then submit your INR bid. Transporters see open offers ranked by price.</p></div><div className="rounded-2xl bg-white/80 p-4"><p className="text-xs text-slate-500">Available batches</p><p className="mt-1 text-2xl font-extrabold">{nearby.length}</p></div></div></section>

    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]"><label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find crop or batch code" className="w-full rounded-xl border border-slate-200 py-3 pl-9 pr-3 text-sm" /></label><input value={farmLocationFilter} onChange={(event) => setFarmLocationFilter(event.target.value)} placeholder="Filter nearby farms by district / state" className="rounded-xl border border-slate-200 px-3 py-3 text-sm" /><div className="flex gap-2"><input value={retailerLocation} onChange={(event) => { setRetailerCoordinates(null); setRetailerLocation(event.target.value); }} placeholder="Your store / dispatch location" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-3 text-sm" /><button type="button" title="Use current location for retailer bids" onClick={() => navigator.geolocation?.getCurrentPosition((position) => { setRetailerCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude }); setRetailerLocation(`${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`); }, () => setError('Location permission was not granted.'))} className="rounded-xl border px-3"><MapPin size={16} /></button></div><button onClick={() => void refresh()} className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold"><RefreshCw size={15} />Refresh</button></div><p className="mt-2 text-[11px] text-slate-500">Nearby matching uses farmer district, state and location text. Your store coordinates, when shared, are included in bids for accurate Google Maps navigation.</p>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}</section>

    {loading ? <div className="rounded-2xl bg-white p-12 text-center text-sm text-slate-500">Loading farmer batches…</div> : nearby.length === 0 ? <div className="rounded-2xl border border-dashed p-12 text-center"><Sprout className="mx-auto text-emerald-700" /><p className="mt-3 font-bold">No farmer batches found</p><p className="mt-1 text-sm text-slate-500">Try a different crop or location.</p></div> : <section className="grid gap-4 lg:grid-cols-2">{nearby.map((batch) => {
      const profile = batch.farmer?.farmerProfile; const farmLocation = [profile?.farmName, profile?.location || batch.location, profile?.district, profile?.state].filter(Boolean).join(', '); const cert = batch.fssaiCertificate; const offered = batch.myOffer; const certStatus = cert?.verificationStatus;
      return <article key={batch._id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs text-slate-500">{batch.batchCode}</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">{batch.product?.name || 'Crop batch'}</h2><p className="mt-1 text-sm text-slate-600">{batch.harvestStage?.replaceAll('_', ' ') || batch.status}</p></div><a href={googleMap(farmLocation)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold"><MapPin size={14} />Farm map <ExternalLink size={12} /></a></div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{[['Farmer', batch.farmer?.name || '—'], ['Quantity', `${batch.quantity} ${batch.unit}`], ['Expected harvest', new Date(batch.harvestDate).toLocaleDateString('en-IN')], ['Harvested', batch.actualHarvestDate ? new Date(batch.actualHarvestDate).toLocaleDateString('en-IN') : 'Not yet harvested'], ['Farm location', farmLocation || batch.location], ['FSSAI', cert ? certStatus || 'PENDING' : 'Not uploaded']].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-2.5"><p className="text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-800">{value}</p></div>)}</div>
        <div className="mt-3 rounded-xl border border-slate-100 p-3"><div className="flex justify-between text-xs"><span className="text-slate-500">Open offers for batch</span><strong>{batch.market.count} · highest ₹{batch.market.highBid?.toLocaleString('en-IN') || '—'}/{batch.unit}</strong></div>{cert && <><p className="mt-2 text-xs text-slate-600">{cert.certificateType} · {cert.issuer} · Expires {new Date(cert.expiryDate).toLocaleDateString('en-IN')}</p>{cert.fileUrl && <a href={cert.fileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-bold text-emerald-800 underline">Open FSSAI document</a>}</>}</div>
        {offered?.status === 'ACCEPTED' ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Your offer accepted · ₹{offered.pricePerUnit}/{batch.unit}</p> : <div className="mt-4"><label className="mb-1 block text-xs font-semibold text-slate-600">Your offer · INR per {batch.unit}<div className="mt-1 flex gap-2"><span className="grid place-items-center rounded-lg border bg-slate-50 px-3">₹</span><input type="number" min="0.01" step="0.01" value={priceByBatch[batch._id] ?? (offered?.pricePerUnit ? String(offered.pricePerUnit) : '')} onChange={(event) => setPriceByBatch((current) => ({ ...current, [batch._id]: event.target.value }))} className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-sm" placeholder="Enter your bid per unit" /><button disabled={saving === batch._id} onClick={() => void offerPrice(batch)} className="rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{saving === batch._id ? 'Submitting…' : offered ? 'Update offer' : 'Submit offer'}</button></div></label>{offered?.status === 'OPEN' && <p className="text-[11px] text-emerald-700">Current offer: ₹{offered.pricePerUnit}/{batch.unit} · available to transporters</p>}</div>}
      </article>;
    })}</section>}
  </DashboardLayout>;
}

function RetailerDelivery({ order }: { order: DeliveryOrder }) {
  const [detail, setDetail] = useState<{ order: { _id: string }; recipientOtp?: string; farmer?: { latitude?: number | null; longitude?: number | null; location?: string }; retailer?: { latitude?: number | null; longitude?: number | null; location?: string } } | null>(null);
  useEffect(() => { let cancelled = false; void fetch(`/api/marketplace/orders/${order._id}`).then((r) => r.json()).then((j) => { if (!cancelled && j.success) setDetail(j.data); }); return () => { cancelled = true; }; }, [order._id, order.status]);
  return <article className="space-y-3 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">{order.crop} · {order.batchCode}</h3><p className="text-xs text-slate-500">{order.quantity} {order.unit} · {order.status.replaceAll('_', ' ')}</p></div>{order.status === 'DELIVERED' && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">Received</span>}</div>{detail && <OrderRouteMap origin={{ latitude: detail.farmer?.latitude ?? null, longitude: detail.farmer?.longitude ?? null, address: detail.farmer?.location || order.farmLocation || 'Farm' }} destination={{ latitude: detail.retailer?.latitude ?? order.retailerLatitude, longitude: detail.retailer?.longitude ?? order.retailerLongitude, address: detail.retailer?.location || order.retailerLocation }} live={order.transporterLatitude != null && order.transporterLongitude != null ? { latitude: order.transporterLatitude, longitude: order.transporterLongitude, updatedAt: order.lastLocationAt } : null} />}{order.status === 'DELIVERY_OTP_PENDING' && <div className="rounded-xl bg-amber-50 p-3"><p className="text-xs text-amber-900">Give this one-time code to the transporter at your shop: <strong className="ml-1 font-mono text-lg">{detail?.recipientOtp || 'Loading…'}</strong></p><p className="mt-1 text-[11px] text-amber-800">The transporter enters it to confirm your receipt.</p></div>}</article>;
}
