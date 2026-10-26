'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, MapPin, Navigation, RefreshCw, ShieldCheck, Truck, KeyRound } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import OrderRouteMap from '@/components/OrderRouteMap';

/* eslint-disable @typescript-eslint/no-explicit-any -- the detail response is a compact server join over the shared Mongoose registry. */

type DeliveryOrder = { _id: string; status: string; transporterLatitude?: number | null; transporterLongitude?: number | null; lastLocationAt?: string | null; batchCode: string; retailerName: string; retailerLocation: string; retailerLatitude?: number | null; retailerLongitude?: number | null };

type Offer = {
  _id: string; batchId: string; pricePerUnit: number; currency: string; retailerLocation: string;
  latitude?: number | null; longitude?: number | null; status: string; commissionAmount?: number;
  farmerPayoutAmount?: number; grossOrderValue?: number; batch: { batchCode: string; quantity: number; unit: string; harvestDate: string; actualHarvestDate?: string; product?: { name: string }; farmer?: { name: string; phone?: string }; fssaiCertificate?: { _id: string; certificateType: string; issuer: string; expiryDate: string; verificationStatus: string; fileUrl?: string; blockchainTransactionHash?: string } | null };
  retailer?: { id: string; name: string; phone?: string } | null;
};

function mapsSearch(address: string) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`; }
function mapsDirections(offer: Offer, origin?: string) {
  const destination = offer.latitude != null && offer.longitude != null ? `${offer.latitude},${offer.longitude}` : offer.retailerLocation;
  const query = new URLSearchParams({ api: '1', destination });
  if (origin) query.set('origin', origin);
  return `https://www.google.com/maps/dir/?${query.toString()}`;
}

export default function TransporterDashboard() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [accepted, setAccepted] = useState<Offer | null>(null);
  const [origin, setOrigin] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [orderDetail, setOrderDetail] = useState<any>(null);
  const [otp, setOtp] = useState('');
  const [gps, setGps] = useState<{ latitude: number; longitude: number } | null>(null);
  const selected = offers.find((offer) => offer._id === selectedId) || null;
  const highest = useMemo(() => {
    const best = new Map<string, number>();
    for (const offer of offers) if (!best.has(offer.batchId)) best.set(offer.batchId, offer.pricePerUnit);
    return best;
  }, [offers]);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/marketplace/offers'); const json = await response.json();
      if (!json.success) throw new Error(json.error?.message || 'Could not load retailer offers.');
      setOffers(json.data || []); setSelectedId((current) => current && (json.data || []).some((item: Offer) => item._id === current) ? current : (json.data?.[0]?._id || ''));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load offers.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { Promise.resolve().then(refresh); }, [refresh]);

  const refreshOrders = useCallback(async () => { const response = await fetch('/api/marketplace/orders'); const json = await response.json(); if (json.success) setOrders(json.data || []); }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial polling synchronizes assigned deliveries from the API.
  useEffect(() => { void refreshOrders(); const timer = window.setInterval(() => void refreshOrders(), 8000); return () => window.clearInterval(timer); }, [refreshOrders]);
  const activeOrder = orders.find((order) => order._id === (selectedId || accepted?._id) && order.status !== 'DELIVERED');
  const activeOrderId = activeOrder?._id;
  const activeOrderStatus = activeOrder?.status;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads server-owned order detail whenever selected delivery state changes.
  useEffect(() => { if (!activeOrderId) { setOrderDetail(null); return; } let cancelled = false; void fetch(`/api/marketplace/orders/${activeOrderId}`).then((response) => response.json()).then((json) => { if (!cancelled && json.success) setOrderDetail(json.data); }).catch(() => {}); return () => { cancelled = true; }; }, [activeOrderId, activeOrderStatus]);

  useEffect(() => {
    if (!activeOrderId || !['IN_TRANSIT', 'DELIVERY_OTP_PENDING'].includes(activeOrderStatus || '') || !navigator.geolocation) return;
    let lastSent = 0;
    const watch = navigator.geolocation.watchPosition((position) => {
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude }; setGps(point);
      if (Date.now() - lastSent < 8000) return; lastSent = Date.now();
      void fetch(`/api/marketplace/orders/${activeOrderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'TRACK_LOCATION', ...point }) }).then(() => void refreshOrders());
    }, () => setError('Allow location access to share live delivery tracking.'), { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [activeOrderId, activeOrderStatus, refreshOrders]);

  async function transition(order: DeliveryOrder, action: string, extra: Record<string, unknown> = {}) {
    setSaving(true); setError('');
    try {
      let location = gps;
      if (['START_PICKUP', 'START_DELIVERY'].includes(action) && navigator.geolocation) location = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => reject(new Error('Enable GPS to verify you are at the pickup/delivery location.')), { enableHighAccuracy: true, timeout: 15000 }));
      const response = await fetch(`/api/marketplace/orders/${order._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(location || {}), ...extra }) }); const json = await response.json();
      if (!json.success) throw new Error(json.error?.message || 'Could not update delivery.');
      setOtp(''); await refreshOrders();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update delivery.'); }
    finally { setSaving(false); }
  }

  async function acceptOffer(offer: Offer) {
    if (!window.confirm(`Accept ${offer.retailer?.name || 'this retailer'} at ₹${offer.pricePerUnit}/${offer.batch.unit}?`)) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/marketplace/offers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerId: offer._id }) });
      const json = await response.json(); if (!json.success) throw new Error(json.error?.message || 'Offer acceptance failed.');
      setAccepted({ ...offer, ...json.data, status: 'ACCEPTED' }); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Offer acceptance failed.'); }
    finally { setSaving(false); }
  }

  function useLocation() {
    if (!navigator.geolocation) { setError('Location is not available in this browser.'); return; }
    navigator.geolocation.getCurrentPosition((position) => setOrigin(`${position.coords.latitude},${position.coords.longitude}`), () => setError('Location permission was not granted. You can enter an origin manually.'));
  }

  return <DashboardLayout title="Domestic Transport Marketplace">
    {orders.length > 0 && <section className="space-y-4">{orders.map((order) => { const detail = orderDetail?.order?._id === order._id ? orderDetail : null; const pickupExpired = detail?.order?.pickupOtpExpiresAt && new Date(detail.order.pickupOtpExpiresAt) < new Date(); const deliveryExpired = detail?.order?.deliveryOtpExpiresAt && new Date(detail.order.deliveryOtpExpiresAt) < new Date(); const pickupLocked = (detail?.order?.pickupOtpAttempts || 0) >= 5; const deliveryLocked = (detail?.order?.deliveryOtpAttempts || 0) >= 5; return <article key={order._id} className="space-y-4 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-xs text-slate-500">{order.batchCode}</p><h2 className="font-bold">Active delivery · {order.retailerName}</h2><p className="text-xs text-slate-500">{order.status.replaceAll('_', ' ')}</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{order.status}</span></div>{detail && <OrderRouteMap origin={{ latitude: detail.farmer?.latitude ?? null, longitude: detail.farmer?.longitude ?? null, address: detail.farmer?.location || detail.batch?.location || 'Farm' }} destination={{ latitude: detail.retailer?.latitude ?? order.retailerLatitude ?? null, longitude: detail.retailer?.longitude ?? order.retailerLongitude ?? null, address: detail.retailer?.location || order.retailerLocation }} live={gps || (order.transporterLatitude != null && order.transporterLongitude != null ? { latitude: order.transporterLatitude, longitude: order.transporterLongitude, updatedAt: order.lastLocationAt } : null)} />}{order.status === 'ACCEPTED' && <button disabled={saving} onClick={() => void transition(order, 'START_PICKUP')} className="rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white">At farm · initiate farmer OTP</button>}{order.status === 'PICKUP_OTP_PENDING' && <div className="flex flex-wrap gap-2"><input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="Farmer pickup OTP" className="rounded-lg border px-3" /><button disabled={saving || otp.length !== 6 || pickupLocked || pickupExpired} onClick={() => void transition(order, 'VERIFY_PICKUP', { otp })} className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-bold text-white">Verify pickup</button>{(pickupExpired || pickupLocked) && <button disabled={saving} onClick={() => void transition(order, 'START_PICKUP')} className="rounded-lg border px-3 py-2 text-xs font-bold">OTP expired/locked · reissue</button>}</div>}{order.status === 'IN_TRANSIT' && <button disabled={saving} onClick={() => void transition(order, 'START_DELIVERY')} className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white">At retailer · initiate receipt OTP</button>}{order.status === 'DELIVERY_OTP_PENDING' && <div className="flex flex-wrap gap-2"><input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="Retailer receipt OTP" className="rounded-lg border px-3" /><button disabled={saving || otp.length !== 6 || deliveryLocked || deliveryExpired} onClick={() => void transition(order, 'VERIFY_DELIVERY', { otp })} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white"><KeyRound size={14} className="mr-1 inline" />Confirm retailer receipt</button>{(deliveryExpired || deliveryLocked) && <button disabled={saving} onClick={() => void transition(order, 'START_DELIVERY')} className="rounded-lg border px-3 py-2 text-xs font-bold">OTP expired/locked · reissue</button>}</div>}</article>; })}</section>}
    <section className="grid gap-4 sm:grid-cols-3">
      {[{ label: 'Open retailer bids', value: offers.length }, { label: 'Batches with offers', value: new Set(offers.map((offer) => offer.batchId)).size }, { label: 'Top current bid', value: offers.length ? `₹${Math.max(...offers.map((offer) => offer.pricePerUnit)).toLocaleString('en-IN')} / unit` : '—' }].map((item) => <article key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p><p className="mt-2 text-2xl font-extrabold text-slate-900">{item.value}</p></article>)}
    </section>
    <section className="grid gap-5 xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)]">
      <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-bold">Retailer bids · highest first</h2><p className="mt-1 text-xs text-slate-500">Each offer includes batch, retailer and FSSAI evidence.</p></div><button onClick={() => void refresh()} className="rounded-lg border p-2" aria-label="Refresh bids"><RefreshCw size={15} /></button></div>
        {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading retailer offers…</p> : offers.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No retailer bids yet.</p> : <div className="max-h-[650px] divide-y overflow-y-auto">{offers.map((offer) => <button key={offer._id} onClick={() => setSelectedId(offer._id)} className={`w-full p-4 text-left hover:bg-emerald-50 ${selectedId === offer._id ? 'bg-emerald-50' : ''}`}><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{offer.retailer?.name || 'Retailer'} <span className="font-normal text-slate-500">· {offer.retailerLocation}</span></p><p className="mt-1 text-xs text-slate-600">{offer.batch.product?.name || 'Crop'} · {offer.batch.batchCode} · {offer.batch.quantity} {offer.batch.unit}</p></div><strong className="whitespace-nowrap text-emerald-800">₹{offer.pricePerUnit.toLocaleString('en-IN')}/{offer.batch.unit}</strong></div><p className="mt-2 text-[11px] text-slate-500">Harvest {new Date(offer.batch.actualHarvestDate || offer.batch.harvestDate).toLocaleDateString('en-IN')} · Best for batch: ₹{highest.get(offer.batchId)?.toLocaleString('en-IN')}/{offer.batch.unit}</p></button>)}</div>}
      </article>
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {!selected && !accepted ? <div className="grid min-h-60 place-items-center text-center text-sm text-slate-500">Select a retailer offer to inspect details.</div> : <>
          {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {(selected || accepted) && (() => { const offer = (selected || accepted)!; const cert = offer.batch.fssaiCertificate; const certStatus = cert?.verificationStatus; const isAccepted = offer.status === 'ACCEPTED'; const gross = offer.pricePerUnit * offer.batch.quantity; const commission = isAccepted ? offer.commissionAmount ?? gross * .04 : gross * .04; const payout = isAccepted ? offer.farmerPayoutAmount ?? gross * .96 : gross * .96; return <>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs text-slate-500">{offer.batch.batchCode}</p><h2 className="mt-1 text-xl font-extrabold">{offer.batch.product?.name || 'Crop'} delivery</h2><p className="mt-1 text-sm text-slate-600">Retailer: {offer.retailer?.name} · {offer.retailerLocation}</p></div><a href={mapsSearch(offer.retailerLocation)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold"><MapPin size={14} />Google Maps</a></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">{[['Farmer', offer.batch.farmer?.name || '—'], ['Contact', offer.retailer?.phone || offer.batch.farmer?.phone || 'Not provided'], ['Crop quantity', `${offer.batch.quantity} ${offer.batch.unit}`], ['Harvest date', new Date(offer.batch.actualHarvestDate || offer.batch.harvestDate).toLocaleDateString('en-IN')], ['Offer price', `₹${offer.pricePerUnit.toLocaleString('en-IN')} per ${offer.batch.unit}`], ['Order value', `₹${gross.toLocaleString('en-IN')}`]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-sm font-bold">{value}</p></div>)}</div>
            <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 p-4"><div className="flex items-center gap-2 font-bold text-emerald-900"><ShieldCheck size={17} />FSSAI certificate verification</div>{cert ? <><p className="mt-2 text-sm font-semibold">{cert.certificateType} · {certStatus}</p><p className="mt-1 text-xs text-slate-600">Issuer: {cert.issuer} · Expiry: {new Date(cert.expiryDate).toLocaleDateString('en-IN')}</p>{cert.fileUrl && <a className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-emerald-800 underline" href={cert.fileUrl} target="_blank" rel="noreferrer">Open certificate <ExternalLink size={12} /></a>}{cert.blockchainTransactionHash && <p className="mt-2 break-all font-mono text-[10px] text-purple-800">Ledger transaction: {cert.blockchainTransactionHash}</p>}</> : <p className="mt-2 text-sm text-amber-800">No FSSAI certificate is attached to this batch.</p>}<p className="mt-2 text-xs text-slate-600">An admin review decision is the recorded validation status. File hashing/IPFS confirms document integrity, not FSSAI issuer authenticity.</p></div>
            <div className="mt-5 rounded-xl bg-slate-900 p-4 text-white"><p className="text-xs text-slate-300">4% transporter commission · 96% farmer allocation</p><div className="mt-3 grid grid-cols-2 gap-3"><p className="text-sm">Commission <strong className="block text-lg">₹{commission.toLocaleString('en-IN')}</strong></p><p className="text-sm">Farmer share <strong className="block text-lg">₹{payout.toLocaleString('en-IN')}</strong></p></div><p className="mt-2 text-[11px] text-amber-200">Settlement is calculated and recorded; actual transfer needs a configured payment provider.</p></div>
            {isAccepted ? <div className="mt-4 space-y-3"><p className="rounded-lg bg-emerald-100 p-3 text-sm font-bold text-emerald-900">Retailer accepted. Continue with delivery navigation.</p><label className="block text-xs font-semibold text-slate-600">Route start (optional)<div className="mt-1 flex gap-2"><input value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="Current location or address" className="min-w-0 flex-1 rounded-lg border px-3 py-2" /><button onClick={useLocation} className="rounded-lg border px-3" title="Use current location"><MapPin size={15} /></button></div></label><a href={mapsDirections(offer, origin || undefined)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white"><Navigation size={16} />Navigate with Google Maps</a></div> : <button disabled={saving} onClick={() => void acceptOffer(offer)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"><Truck size={16} />{saving ? 'Accepting…' : 'Accept retailer and order'}</button>}
          </>; })()}
        </>}
      </article>
    </section>
  </DashboardLayout>;
}
