'use client';

import Link from 'next/link';
import {
  ArrowDownRight, ArrowRight, BadgeCheck, Boxes, Fingerprint, Globe2,
  Leaf, PackageCheck, ScanLine, ShieldCheck, Sprout, Store, Truck,
  UserRound, Workflow,
} from 'lucide-react';
import { LanguageSwitcher, useTranslation } from '@/components/LanguageProvider';

const roles = [
  { name: 'Farmers', detail: 'Register harvests and build a verifiable record.', icon: Sprout },
  { name: 'Exporters', detail: 'Coordinate shipments and destination compliance.', icon: Boxes },
  { name: 'Importers', detail: 'Review provenance and certificate history.', icon: Globe2 },
  { name: 'Transporters', detail: 'Record handovers and cold-chain readings.', icon: Truck },
  { name: 'Retailers', detail: 'Check stock history and freshness signals.', icon: Store },
  { name: 'Consumers', detail: 'Scan a batch and explore its recorded journey.', icon: UserRound },
];

export default function LandingPage() {
  const { t } = useTranslation();
  return (
    <main className="landing-page min-h-screen overflow-hidden">
      <header className="landing-header mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="AgriBridge AI home">
          <span className="brand-mark"><Leaf size={21} strokeWidth={2.3} /></span>
          <span>
            <span className="block text-[17px] font-extrabold tracking-tight text-[#183d2e]">AgriBridge</span>
            <span className="block text-[9px] font-bold uppercase tracking-[.2em] text-[#788777]">Trust in every harvest</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-8 text-[13px] font-semibold text-[#667568] md:flex">
          <a href="#platform" className="hover:text-[#275c3f]">{t('Platform')}</a>
          <a href="#stakeholders" className="hover:text-[#275c3f]">{t('Stakeholders')}</a>
          <a href="#journey" className="hover:text-[#275c3f]">{t('How it works')}</a>
        </nav>
        <div className="flex items-center gap-3"><LanguageSwitcher /><Link href="/login" className="landing-signin">{t('Sign in')} <ArrowRight size={15} /></Link></div>
      </header>

      <section className="landing-hero mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-12 sm:px-8 md:pt-20 lg:grid-cols-[1.02fr_.98fr] lg:gap-20 lg:pb-28">
        <div className="relative z-10">
          <div className="eyebrow"><span className="eyebrow-dot" /> A clearer path from farm to table</div>
          <h1 className="mt-7 max-w-2xl text-[clamp(3.2rem,7vw,6.3rem)] font-semibold leading-[.98] tracking-[-.065em] text-[#183d2e]">
            Good food has a <span className="hero-serif">story.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-8 text-[#68786b] sm:text-lg">
            AgriBridge brings every handover into view, connecting harvest records, shipment updates and product verification in one trusted workspace.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/login" className="landing-primary">Explore the platform <ArrowRight size={17} /></Link>
            <a href="#journey" className="landing-secondary">See how it works <ArrowDownRight size={16} /></a>
          </div>
          <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[#e4e9df] pt-6 text-xs font-medium text-[#718075]">
            <span className="inline-flex items-center gap-2"><Fingerprint size={15} className="text-[#4c7958]" /> Traceable batch records</span>
            <span className="inline-flex items-center gap-2"><ShieldCheck size={15} className="text-[#4c7958]" /> Evidence-led verification</span>
          </div>
        </div>

        <div className="hero-visual relative mx-auto w-full max-w-[590px]">
          <div className="hero-halo" />
          <div className="hero-card relative z-10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#879487]">Journey overview</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-[#1d3426]">One batch, connected</h2>
              </div>
              <span className="record-pill"><span /> Trace record</span>
            </div>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {[
                { label: 'Origin', title: 'Harvest', icon: Sprout, state: 'Recorded' },
                { label: 'Movement', title: 'In transit', icon: Truck, state: 'Updated' },
                { label: 'Destination', title: 'Verified', icon: BadgeCheck, state: 'Ready to scan' },
              ].map(({ label, title, icon: Icon, state }, index) => (
                <div className={`journey-step ${index === 2 ? 'journey-step-final' : ''}`} key={label}>
                  <div className="journey-icon"><Icon size={19} /></div>
                  <span className="mt-5 block text-[9px] font-bold uppercase tracking-[.15em] text-[#96a095]">{label}</span>
                  <span className="mt-1 block text-sm font-semibold text-[#26392b]">{title}</span>
                  <span className="mt-2 block text-[10px] font-medium text-[#768278]">{state}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between rounded-2xl bg-[#f4f6f0] px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="fingerprint-icon"><Fingerprint size={18} /></span>
                <div><p className="text-xs font-semibold text-[#304234]">A record at every step</p><p className="mt-0.5 text-[10px] text-[#788579]">Batch history is easy to follow</p></div>
              </div>
              <ScanLine size={19} className="text-[#53775b]" />
            </div>
          </div>
          <div className="floating-note"><PackageCheck size={17} /><span><strong>From harvest</strong><small>to verified product</small></span></div>
          <div className="visual-caption">A shared view across the supply chain</div>
        </div>
      </section>

      <section id="platform" className="platform-band">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-9 sm:px-8 md:grid-cols-[1.15fr_repeat(3,1fr)] md:items-center">
          <div><p className="text-[10px] font-bold uppercase tracking-[.19em] text-[#bdceb7]">Built around trust</p><p className="mt-2 max-w-xs text-sm leading-6 text-white/75">Useful signals, organized around the real journey of food.</p></div>
          {[
            { value: '8', title: 'supply chain roles' },
            { value: '6', title: 'trust factors' },
            { value: '1', title: 'connected record' },
          ].map((item) => <div className="platform-stat" key={item.title}><span>{item.value}</span><p>{item.title}</p></div>)}
        </div>
      </section>

      <section id="stakeholders" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
        <div className="section-heading">
          <div><p className="section-kicker">Made for the whole chain</p><h2>One platform. Every perspective.</h2></div>
          <p>Each participant gets a focused workspace while the product history stays connected from origin to destination.</p>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map(({ name, detail, icon: Icon }, index) => (
            <Link href="/login" className="role-card group" key={name}>
              <span className="role-index">0{index + 1}</span>
              <span className="role-icon"><Icon size={20} /></span>
              <span className="role-content"><strong>{name}</strong><small>{detail}</small></span>
              <ArrowRight size={17} className="role-arrow" />
            </Link>
          ))}
        </div>
      </section>

      <section id="journey" className="journey-section">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[.85fr_1.15fr] lg:items-center lg:py-24">
          <div>
            <p className="section-kicker">A more legible supply chain</p>
            <h2 className="mt-4 max-w-lg text-4xl font-semibold leading-tight tracking-[-.045em] text-[#183d2e] sm:text-5xl">From scattered updates to a shared story.</h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-[#708074]">AgriBridge makes it easier to follow batch events, check supporting evidence, and understand what has—and has not—been verified.</p>
            <Link href="/register" className="journey-link">Create your workspace <ArrowRight size={16} /></Link>
          </div>
          <div className="journey-list">
            {[
              { n: '01', title: 'Register a harvest', text: 'Give each batch a clear starting point and identity.', icon: Leaf },
              { n: '02', title: 'Record each handover', text: 'Bring shipment, inspection and cold-chain updates together.', icon: Workflow },
              { n: '03', title: 'Verify with context', text: 'Let partners and consumers review the available history.', icon: ScanLine },
            ].map(({ n, title, text, icon: Icon }) => (
              <div className="journey-row" key={n}><span className="journey-number">{n}</span><span className="journey-row-icon"><Icon size={18} /></span><span className="min-w-0 flex-1"><strong>{title}</strong><small>{text}</small></span><ArrowRight size={16} className="text-[#8c9a8d]" /></div>
            ))}
          </div>
        </div>
      </section>

      <footer className="landing-footer mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-xs text-[#7a897d] sm:px-8 md:flex-row md:items-center md:justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold text-[#385542]"><span className="brand-mark brand-mark-small"><Leaf size={15} /></span> AgriBridge AI</Link>
        <span>Transparent records for a more connected food system.</span>
        <Link href="/login" className="font-semibold text-[#385542] hover:text-[#1b4b34]">Sign in <ArrowRight size={13} className="inline" /></Link>
      </footer>
    </main>
  );
}
