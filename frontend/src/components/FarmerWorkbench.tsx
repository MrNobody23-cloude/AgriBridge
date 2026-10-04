'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Camera, CheckCircle2, ChevronRight, CircleAlert, CloudUpload, Leaf, MapPin, Package, Pencil, Plus, RefreshCw, Search, Sprout, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import DashboardLayout from '@/components/DashboardLayout';
import { useTranslation } from '@/components/LanguageProvider';
import type { ApiBatch, ApiBatchDetail, ApiEvent } from '@/lib/api-types';

type UpdateStage = 'LAND_PREPARATION' | 'SOWING' | 'GERMINATION' | 'VEGETATIVE_GROWTH' | 'FLOWERING' | 'FRUITING' | 'HARVEST_READY' | 'HARVESTED';
const stages: Array<{ value: UpdateStage; label: string }> = [
  { value: 'LAND_PREPARATION', label: 'Land preparation' }, { value: 'SOWING', label: 'Sowing / planting' },
  { value: 'GERMINATION', label: 'Germination' }, { value: 'VEGETATIVE_GROWTH', label: 'Vegetative growth' },
  { value: 'FLOWERING', label: 'Flowering' }, { value: 'FRUITING', label: 'Fruit / grain development' },
  { value: 'HARVEST_READY', label: 'Ready for harvest' }, { value: 'HARVESTED', label: 'Harvest completed' },
];

interface BatchForm { crop: string; variety: string; quantity: string; unit: string; sowingDate: string; harvestDate: string; location: string; destinationCountry: string; }
const blankForm = (): BatchForm => ({ crop: '', variety: '', quantity: '', unit: 'kg', sowingDate: '', harvestDate: '', location: '', destinationCountry: '' });
interface UpdateForm { stage: UpdateStage; notes: string; location: string; weather: string; irrigation: string; fertilizer: string; pestDisease: string; soilMoisture: string; plantHeightCm: string; growthNotes: string; observedAt: string; }
const blankUpdate = (location = ''): UpdateForm => ({ stage: 'VEGETATIVE_GROWTH', notes: '', location, weather: '', irrigation: '', fertilizer: '', pestDisease: '', soilMoisture: '', plantHeightCm: '', growthNotes: '', observedAt: new Date().toISOString().slice(0, 16) });

function toInputDate(value?: string | Date | null) { return value ? new Date(value).toISOString().slice(0, 10) : ''; }
function dataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(new Error('Could not read the selected photo.')); reader.readAsDataURL(file); }); }
function parseMetadata(event: ApiEvent): Record<string, unknown> { try { return JSON.parse(event.metadata || '{}') as Record<string, unknown>; } catch { return {}; } }

export default function FarmerWorkbench() {
  const { t, language } = useTranslation();
  const [batches, setBatches] = useState<ApiBatch[]>([]);
  const [selected, setSelected] = useState<ApiBatchDetail | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState<BatchForm>(blankForm());
  const [editForm, setEditForm] = useState<BatchForm>(blankForm());
  const [progress, setProgress] = useState<UpdateForm>(blankUpdate());
  const [photo, setPhoto] = useState<File | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: '100' });
      if (search.trim()) query.set('q', search.trim());
      const response = await fetch(`/api/batches?${query}`);
      const json = await response.json();
      if (!json.success) throw new Error(json.error?.message || 'Could not load your batch portfolio.');
      setBatches(Array.isArray(json.data?.batches) ? json.data.batches : []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load batch portfolio.'); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { Promise.resolve().then(refresh); }, [refresh]);

  const openBatch = async (batchCode: string) => {
    setError('');
    try {
      const response = await fetch(`/api/batches/${encodeURIComponent(batchCode)}`);
      const json = await response.json();
      if (!json.success) throw new Error(json.error?.message || 'Could not load batch details.');
      setSelected(json.data as ApiBatchDetail);
      const detail = json.data as ApiBatchDetail;
      setProgress(blankUpdate(detail.location || ''));
      setEditForm({ crop: detail.product?.name || '', variety: detail.variety || '', quantity: String(detail.quantity || ''), unit: detail.unit || 'kg', sowingDate: toInputDate(detail.sowingDate), harvestDate: toInputDate(detail.harvestDate), location: detail.location || '', destinationCountry: detail.destinationCountry || '' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load batch details.'); }
  };

  const saveNewBatch = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, quantity: Number(form.quantity) }) });
      const json = await response.json();
      if (!json.success) throw new Error(json.error?.message || 'Could not register the crop batch.');
      const code = json.data?.batch?.batchCode;
      setNotice(t('Batch registered successfully.') + (code ? ` ${code}` : ''));
      setForm(blankForm()); setShowCreate(false); await refresh(); if (code) await openBatch(code);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not register batch.'); }
    finally { setSaving(false); }
  };

  const saveBatchEdits = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/batches/${encodeURIComponent(selected.batchCode)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editForm, quantity: Number(editForm.quantity) }) });
      const json = await response.json();
      if (!json.success) throw new Error(json.error?.message || 'Could not update batch details.');
      setNotice(t('Batch information saved.')); setShowEdit(false); await refresh(); await openBatch(selected.batchCode);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save batch changes.'); }
    finally { setSaving(false); }
  };

  const saveProgress = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected) return;
    setSaving(true); setError(''); setNotice('');
    try {
      let imageBase64: string | undefined;
      if (photo) imageBase64 = await dataUrl(photo);
      const response = await fetch(`/api/batches/${encodeURIComponent(selected.batchCode)}/updates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...progress, soilMoisture: progress.soilMoisture || undefined, plantHeightCm: progress.plantHeightCm || undefined, imageBase64, imageMimeType: photo?.type, imageName: photo?.name }) });
      const json = await response.json();
      if (!json.success) throw new Error(json.error?.message || 'Could not save crop update.');
      setNotice(t('Crop progress update recorded.')); setPhoto(null); await openBatch(selected.batchCode); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save crop update.'); }
    finally { setSaving(false); }
  };

  const visibleBatches = useMemo(() => batches, [batches]);
  const totals = useMemo(() => ({ quantity: batches.reduce((sum, batch) => sum + Number(batch.quantity || 0), 0), stages: batches.filter((batch) => batch.harvestStage === 'HARVESTED').length, flagged: batches.filter((batch) => batch.status === 'Flagged').length }), [batches]);
  const canEditAnchored = !selected?.blockchainTransactionHash;
  const events = selected?.events || [];
  const certificates = (selected?.certificates || []) as Array<{ _id?: string; certificateType?: string; verificationStatus?: string; issuer?: string; expiryDate?: string; fileUrl?: string }>;
  const shipments = (selected?.shipments || []) as Array<{ _id?: string; shipmentCode?: string; status?: string; destinationCountry?: string; quantity?: number }>;
  const fraudAlerts = selected?.fraudAlerts || [];

  const setBatchField = (key: keyof BatchForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const setEditField = (key: keyof BatchForm, value: string) => setEditForm((current) => ({ ...current, [key]: value }));
  const field = (label: string, value: string, onChange: (value: string) => void, opts: { type?: string; required?: boolean; disabled?: boolean; placeholder?: string; step?: string } = {}) => <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">{t(label)}{opts.required && <span className="text-rose-500"> *</span>}</span><input type={opts.type || 'text'} value={value} onChange={(event) => onChange(event.target.value)} required={opts.required} disabled={opts.disabled} placeholder={opts.placeholder} step={opts.step} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 disabled:bg-slate-100" /></label>;

  return <DashboardLayout title="Farmer Overview">
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#143d2b] via-[#1f6542] to-[#2b8152] p-6 text-white shadow-lg sm:p-8">
      <div className="absolute -right-8 -top-12 h-56 w-56 rounded-full border-[28px] border-white/5" /><div className="absolute bottom-[-80px] right-[18%] h-52 w-52 rounded-full bg-lime-300/10 blur-2xl" />
      <div className="relative flex flex-wrap items-end justify-between gap-5"><div className="max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-lime-100"><Sprout size={14} />{t('Farm to harvest, one clear record.')}</div><h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t('Your farm, documented at every stage.')}</h1><p className="mt-2 text-sm leading-6 text-white/75">{t('Create a crop batch, record field activity over time, attach real photos and keep the complete harvest history together.')}</p></div><button onClick={() => { setForm(blankForm()); setShowCreate(true); }} className="inline-flex items-center gap-2 rounded-xl bg-lime-300 px-4 py-3 text-sm font-extrabold text-[#173d2b] shadow-sm hover:bg-lime-200"><Plus size={17} />{t('Register crop batch')}</button></div>
    </section>

    {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><CircleAlert size={17} className="mt-0.5 shrink-0" />{error}<button onClick={() => setError('')} className="ml-auto"><X size={16} /></button></div>}
    {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')} className="ml-auto"><X size={16} /></button></div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[{ label: 'Registered batches', value: batches.length, icon: Package }, { label: 'Harvested batches', value: totals.stages, icon: CheckCircle2 }, { label: 'Portfolio quantity', value: `${totals.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${batches[0]?.unit || 'kg'}`, icon: Leaf }, { label: 'Flagged for review', value: totals.flagged, icon: CircleAlert }].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t(label)}</span><Icon size={17} className="text-emerald-700" /></div><p className="mt-3 text-2xl font-extrabold text-slate-900">{value}</p></div>)}
    </section>

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.88fr)]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5"><div><h2 className="font-bold text-slate-900">{t('My crop portfolio')}</h2><p className="mt-1 text-xs text-slate-500">{t('Select a batch to see its records and add the next update.')}</p></div><div className="flex gap-2"><label className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search crop, batch or location')} className="w-48 rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-emerald-500" /></label><button onClick={() => void refresh()} aria-label={t('Refresh batches')} className="rounded-xl border border-slate-200 px-3 text-slate-600 hover:bg-slate-50"><RefreshCw size={15} /></button></div></div>
        <div className="max-h-[650px] divide-y divide-slate-100 overflow-y-auto">
          {loading ? <div className="p-10 text-center text-sm text-slate-500">{t('Loading your batches…')}</div> : visibleBatches.length === 0 ? <div className="p-10 text-center"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Leaf size={22} /></div><p className="font-semibold text-slate-800">{t('No crop batches yet')}</p><p className="mt-1 text-xs text-slate-500">{t('Register your first crop to start its farm record.')}</p></div> : visibleBatches.map((batch) => <button key={batch._id} onClick={() => void openBatch(batch.batchCode)} className={`flex w-full items-center gap-3 p-4 text-left transition hover:bg-emerald-50/60 ${selected?._id === batch._id ? 'bg-emerald-50' : ''}`}>
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800"><Leaf size={19} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-bold text-slate-900">{batch.product?.name || t('Crop batch')}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{(batch.harvestStage || 'REGISTERED').replaceAll('_', ' ')}</span></div><p className="mt-1 truncate font-mono text-[11px] text-slate-500">{batch.batchCode} · {batch.location}</p><p className="mt-1 text-[11px] text-slate-500">{Number(batch.quantity).toLocaleString()} {batch.unit || 'kg'} · {t('Expected harvest')}: {batch.harvestDate ? new Date(batch.harvestDate).toLocaleDateString(language) : '—'}</p></div><ChevronRight size={17} className="shrink-0 text-slate-400" />
          </button>)}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        {!selected ? <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center"><div><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-lime-100 text-emerald-800"><Package size={22} /></div><p className="font-bold text-slate-800">{t('Your batch record')}</p><p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{t('Choose a crop batch from your portfolio to review its details, field notes, timeline and photos.')}</p></div></div> : <>
          <article className="rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold text-emerald-800">{selected.batchCode}</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">{selected.product?.name || t('Crop batch')}</h2><p className="mt-1 text-xs text-slate-500">{selected.variety || t('Variety not added')} · {selected.harvestStage?.replaceAll('_', ' ') || t('Registered')}</p></div><button onClick={() => setShowEdit(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"><Pencil size={14} />{t('Edit details')}</button></div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">{[{ label: 'Quantity', value: `${Number(selected.quantity).toLocaleString()} ${selected.unit || 'kg'}` }, { label: 'Farm location', value: selected.location || '—' }, { label: 'Sowing date', value: selected.sowingDate ? new Date(selected.sowingDate).toLocaleDateString(language) : '—' }, { label: 'Expected harvest', value: selected.harvestDate ? new Date(selected.harvestDate).toLocaleDateString(language) : '—' }, { label: 'Actual harvest', value: selected.actualHarvestDate ? new Date(selected.actualHarvestDate).toLocaleDateString(language) : t('Not harvested') }, { label: 'Trust score', value: selected.trustScore ? `${selected.trustScore}/100` : t('Not computed') }].map((item) => <div key={item.label} className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">{t(item.label)}</span><p className="mt-1 font-bold text-slate-800">{item.value}</p></div>)}</div>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><MapPin size={14} />{t('Blockchain')}: <span className={selected.blockchainTransactionHash ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>{selected.blockchainTransactionHash ? t('Anchored') : t('Not anchored')}</span><span className="truncate font-mono">{selected.blockchainTransactionHash || ''}</span></div>
          </article>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4"><h3 className="font-bold text-slate-900">{t('Record crop progress')}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{t('Add periodic crop-care information. Photos are pinned to IPFS and linked from the permanent batch timeline.')}</p></div>
            <form onSubmit={saveProgress} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">{t('Crop stage')} *</span><select required value={progress.stage} onChange={(event) => setProgress((value) => ({ ...value, stage: event.target.value as UpdateStage }))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">{stages.map((stage) => <option key={stage.value} value={stage.value}>{t(stage.label)}</option>)}</select></label>{field('Update time', progress.observedAt, (value) => setProgress((current) => ({ ...current, observedAt: value })), { type: 'datetime-local', required: true })}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {field('Field location', progress.location, (value) => setProgress((current) => ({ ...current, location: value })), { required: true })}
                {field('Weather / conditions', progress.weather, (value) => setProgress((current) => ({ ...current, weather: value })))}
                {field('Irrigation', progress.irrigation, (value) => setProgress((current) => ({ ...current, irrigation: value })))}
                {field('Fertilizer / treatment', progress.fertilizer, (value) => setProgress((current) => ({ ...current, fertilizer: value })))}
                {field('Pest or disease observations', progress.pestDisease, (value) => setProgress((current) => ({ ...current, pestDisease: value })))}
                {field('Soil moisture (%)', progress.soilMoisture, (value) => setProgress((current) => ({ ...current, soilMoisture: value })), { type: 'number', step: '0.1' })}
                {field('Plant height (cm)', progress.plantHeightCm, (value) => setProgress((current) => ({ ...current, plantHeightCm: value })), { type: 'number', step: '0.1' })}
              </div>
              <label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">{t('Field notes')}</span><textarea value={progress.notes} onChange={(event) => setProgress((current) => ({ ...current, notes: event.target.value }))} rows={2} maxLength={2000} placeholder={t('What changed since the last update?')} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" /></label>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-3"><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { const selectedFile = event.target.files?.[0] || null; if (selectedFile && selectedFile.size > 4 * 1024 * 1024) { setError(t('Photo must be 4 MB or smaller.')); setPhoto(null); } else { setPhoto(selectedFile); setError(''); } }} /><div className="grid h-9 w-9 place-items-center rounded-lg bg-white text-emerald-700"><Camera size={17} /></div><div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-700">{t('Add progress photo')}</p><p className="truncate text-[11px] text-slate-500">{photo?.name || t('JPEG, PNG or WebP · up to 4 MB')}</p></div><CloudUpload size={16} className="text-emerald-700" /></label>
              <button disabled={saving} className="w-full rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? t('Saving update…') : t('Save progress update')}</button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-bold text-slate-900">{t('Batch timeline')}</h3><p className="mt-1 text-xs text-slate-500">{events.length} {t('recorded updates')}</p></div><CalendarDays size={17} className="text-emerald-700" /></div>
            {events.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">{t('No timeline updates recorded yet.')}</p> : <ol className="max-h-96 space-y-3 overflow-y-auto">{[...events].reverse().map((event) => { const meta = parseMetadata(event); const measurements = (meta.measurements || {}) as Record<string, unknown>; return <li key={event._id} className="relative border-l-2 border-emerald-200 pb-1 pl-4"><span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-emerald-700" /><p className="text-[10px] font-semibold text-slate-400">{event.timestamp ? new Date(event.timestamp).toLocaleString(language) : ''}</p><p className="mt-0.5 text-xs font-bold text-slate-800">{String(meta.stage || event.eventType).replaceAll('_', ' ')}</p>{event.location && <p className="mt-0.5 text-[11px] text-slate-500">{event.location}</p>}{typeof meta.notes === 'string' && meta.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{meta.notes}</p>}{Object.keys(measurements).length > 0 && <p className="mt-1 text-[11px] text-slate-500">{Object.entries(measurements).map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}: ${value}`).join(' · ')}</p>}{typeof meta.imageUrl === 'string' && <a href={meta.imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><Camera size={13} />{t('View field photo')}</a>}</li>; })}</ol>}
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="font-bold text-slate-900">{t('Certificates')} <span className="ml-1 text-xs font-medium text-slate-400">{certificates.length}</span></h3>{certificates.length === 0 ? <p className="mt-2 text-xs text-slate-500">{t('No certificates attached.')}</p> : <ul className="mt-3 space-y-2">{certificates.map((certificate, index) => <li key={certificate._id || index} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 p-2.5"><div><p className="text-xs font-bold text-slate-800">{certificate.certificateType || t('Certificate')}</p><p className="mt-0.5 text-[10px] text-slate-500">{certificate.issuer || t('Issuer not recorded')} · {certificate.verificationStatus || 'PENDING'}</p>{certificate.expiryDate && <p className="text-[10px] text-slate-500">{t('Expires')}: {new Date(certificate.expiryDate).toLocaleDateString(language)}</p>}</div>{certificate.fileUrl && <a href={certificate.fileUrl} target="_blank" rel="noreferrer" aria-label={t('Open certificate')}><ExternalLink size={14} className="text-emerald-700" /></a>}</li>)}</ul>}</article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="font-bold text-slate-900">{t('Shipments and alerts')}</h3>{shipments.length === 0 && fraudAlerts.length === 0 ? <p className="mt-2 text-xs text-slate-500">{t('No shipment or fraud alert is linked to this batch.')}</p> : <ul className="mt-3 space-y-2">{shipments.map((shipment, index) => <li key={shipment._id || index} className="rounded-lg bg-slate-50 p-2.5 text-xs"><p className="font-bold text-slate-800">{shipment.shipmentCode || t('Shipment')} · {shipment.status}</p><p className="mt-0.5 text-[10px] text-slate-500">{shipment.destinationCountry || '—'} · {shipment.quantity ?? '—'} {selected.unit || 'kg'}</p></li>)}{fraudAlerts.map((alert, index) => <li key={alert._id || index} className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900"><strong>{alert.severity} · {alert.status}</strong><p className="mt-0.5">{alert.description}</p></li>)}</ul>}</article>
          </section>

          <details className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4 text-xs text-slate-700"><summary className="cursor-pointer font-bold text-sky-950">{t('How is the trust score calculated?')}</summary><p className="mt-3 leading-5">{t('The score uses up to six evidence factors: blockchain verification (20 points), certificate status (20), cold-chain readings (20), regulatory compliance checks (10), recorded ML quality (10), and chain-of-custody event coverage (30). Factors without evidence are excluded from the denominator, so the score is normalized across only the available evidence. Missing evidence is listed separately; it does not earn points.')}</p><p className="mt-2 leading-5">{t('A high score based on a small amount of evidence is a partial assessment, not proof that the whole batch is safe or legally compliant.')}</p><Link href="/trust-score" className="mt-2 inline-block font-bold text-sky-800 underline">{t('Open score details')}</Link></details>
        </>}
      </div>
    </section>

    {showCreate && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm"><div className="my-6 w-full max-w-2xl rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><h2 className="text-lg font-extrabold text-slate-900">{t('Register a crop batch')}</h2><p className="mt-1 text-xs text-slate-500">{t('Start the traceability record at planting. Enter your expected harvest date.')}</p></div><button onClick={() => setShowCreate(false)} aria-label={t('Close')}><X size={19} /></button></div><form onSubmit={saveNewBatch} className="grid gap-4 p-5 sm:grid-cols-2">
      {field('Crop type', form.crop, (value) => setBatchField('crop', value), { required: true, placeholder: t('Type any crop name') })}{field('Variety / cultivar', form.variety, (value) => setBatchField('variety', value))}{field('Quantity', form.quantity, (value) => setBatchField('quantity', value), { type: 'number', required: true, step: '0.01' })}<label className="block space-y-1.5"><span className="text-xs font-semibold text-slate-600">{t('Unit')}</span><select value={form.unit} onChange={(event) => setBatchField('unit', event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option>kg</option><option>tonne</option><option>quintal</option><option>crate</option><option>piece</option></select></label>
      {field('Sowing / planting date', form.sowingDate, (value) => setBatchField('sowingDate', value), { type: 'date' })}{field('Expected harvest date', form.harvestDate, (value) => setBatchField('harvestDate', value), { type: 'date', required: true })}<div className="sm:col-span-2">{field('Farm location', form.location, (value) => setBatchField('location', value), { required: true })}</div><div className="sm:col-span-2">{field('Planned destination (optional)', form.destinationCountry, (value) => setBatchField('destinationCountry', value))}</div>
      <p className="sm:col-span-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">{t('Crop, quantity, expected harvest date and location form the initial batch fingerprint. After that fingerprint is written to a configured blockchain, those original fields cannot be edited.')}</p><button disabled={saving} className="sm:col-span-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? t('Registering…') : t('Register batch and open its portfolio')}</button>
    </form></div></div>}

    {showEdit && selected && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm"><div className="my-6 w-full max-w-xl rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><h2 className="font-extrabold text-slate-900">{t('Edit batch information')}</h2><p className="mt-1 text-xs text-slate-500">{t('Edits are validated and recorded as attributable batch events.')}</p></div><button onClick={() => setShowEdit(false)} aria-label={t('Close')}><X size={19} /></button></div><form onSubmit={saveBatchEdits} className="grid gap-4 p-5 sm:grid-cols-2">
      {field('Crop type', editForm.crop, (value) => setEditField('crop', value), { required: true, disabled: !canEditAnchored })}{field('Variety / cultivar', editForm.variety, (value) => setEditField('variety', value), { disabled: !canEditAnchored })}{field('Quantity', editForm.quantity, (value) => setEditField('quantity', value), { type: 'number', required: true, step: '0.01', disabled: !canEditAnchored })}{field('Unit', editForm.unit, (value) => setEditField('unit', value), { required: true, disabled: !canEditAnchored })}{field('Sowing date', editForm.sowingDate, (value) => setEditField('sowingDate', value), { type: 'date', disabled: !canEditAnchored })}{field('Expected harvest', editForm.harvestDate, (value) => setEditField('harvestDate', value), { type: 'date', required: true, disabled: !canEditAnchored })}<div className="sm:col-span-2">{field('Farm location', editForm.location, (value) => setEditField('location', value), { required: true, disabled: !canEditAnchored })}</div><div className="sm:col-span-2">{field('Planned destination', editForm.destinationCountry, (value) => setEditField('destinationCountry', value), { disabled: !canEditAnchored })}</div>
      {!canEditAnchored && <p className="sm:col-span-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">{t('The original fingerprint is anchored on-chain, so registration details are locked. Add corrections as a dated field update.')}</p>}<button disabled={saving} className="sm:col-span-2 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? t('Saving…') : t('Save changes')}</button>
    </form></div></div>}
  </DashboardLayout>;
}
