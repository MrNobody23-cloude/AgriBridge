import type { Role } from './permissions';

export const ROLE_WORKFLOWS: Record<Role, { title: string; duty: string; actions: Array<{ label: string; href: string }> }> = {
  FARMER: { title: 'Farm operations', duty: 'Register harvested lots, maintain your batch records, and attach crop certificates for the supply chain.', actions: [{ label: 'Register a crop batch', href: '/farmer' }, { label: 'Review your batches', href: '/farmer' }] },
  TRANSPORTER: { title: 'Domestic logistics', duty: 'Review retailer bids, verify FSSAI certificate decisions, accept a delivery, and complete the domestic handover.', actions: [{ label: 'Review retailer bids', href: '/transporter' }, { label: 'View traceability', href: '/verify' }] },
  RETAILER: { title: 'Retail traceability', duty: 'Verify provenance and freshness evidence for batches before stocking and retain traceability records.', actions: [{ label: 'Verify a batch', href: '/retailer' }, { label: 'Open traceability', href: '/verify' }] },
  CONSUMER: { title: 'Product verification', duty: 'Check a product batch to see its origin, recorded supply-chain history, certificates, and available verification evidence.', actions: [{ label: 'Verify a product', href: '/consumer' }, { label: 'Open batch verification', href: '/verify' }] },
  ADMIN: { title: 'Platform administration', duty: 'Review, update, and remove platform records; review FSSAI certificates; manage users, orders, batches, and fraud records.', actions: [{ label: 'Manage platform records', href: '/admin' }, { label: 'Review certificates and alerts', href: '/admin' }] },
};
