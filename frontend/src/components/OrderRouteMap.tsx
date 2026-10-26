'use client';

type Point = { latitude: number | null; longitude: number | null; address: string };

export default function OrderRouteMap({ origin, destination, live }: { origin: Point; destination: Point; live?: { latitude: number; longitude: number; updatedAt?: string | null } | null }) {
  const originQuery = origin.latitude !== null && origin.longitude !== null ? `${origin.latitude},${origin.longitude}` : origin.address;
  const destinationQuery = destination.latitude !== null && destination.longitude !== null ? `${destination.latitude},${destination.longitude}` : destination.address;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originQuery)}&destination=${encodeURIComponent(destinationQuery)}&travelmode=driving`;
  const point = live || (origin.latitude !== null && origin.longitude !== null ? { latitude: origin.latitude, longitude: origin.longitude } : null);
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const googleEmbed = mapsKey && origin.latitude !== null && origin.longitude !== null && destination.latitude !== null && destination.longitude !== null
    ? `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(mapsKey)}&origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&mode=driving`
    : null;
  const osmEmbed = point ? `https://www.openstreetmap.org/export/embed.html?bbox=${point.longitude - 0.025}%2C${point.latitude - 0.018}%2C${point.longitude + 0.025}%2C${point.latitude + 0.018}&layer=mapnik&marker=${point.latitude}%2C${point.longitude}` : null;

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-700">Farm pickup → Retail shop</p><p className="mt-1 text-[11px] text-slate-500">{origin.address} → {destination.address}</p></div><a href={mapsUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">Open Google Maps route</a></div>
    {googleEmbed || osmEmbed ? <iframe title="Farm-to-retailer route and transporter position" src={googleEmbed || osmEmbed || ''} className="h-72 w-full border-0" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : <div className="grid h-72 place-items-center bg-slate-50 p-6 text-center"><div><p className="font-bold text-slate-800">Map location is not available yet</p><p className="mt-2 text-xs leading-5 text-slate-500">Farmer and retailer must capture GPS on login to show the route preview. Google Maps directions remain available from the address link.</p></div></div>}
    <div className="flex flex-wrap justify-between gap-2 p-3 text-[11px] text-slate-600"><span>Farm: {origin.latitude !== null && origin.longitude !== null ? `${origin.latitude.toFixed(5)}, ${origin.longitude.toFixed(5)}` : 'Address routing'}</span><span>Retailer: {destination.latitude !== null && destination.longitude !== null ? `${destination.latitude.toFixed(5)}, ${destination.longitude.toFixed(5)}` : 'Address routing'}</span>{live && <span className="font-semibold text-emerald-700">Live transporter: {live.latitude.toFixed(5)}, {live.longitude.toFixed(5)}{live.updatedAt ? ` · ${new Date(live.updatedAt).toLocaleTimeString()}` : ''}</span>}</div>
  </section>;
}
