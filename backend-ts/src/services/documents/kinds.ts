/**
 * margixindia — The kinds of shipment document on a vendor load (PRD Appendix A, docs/load-posting-design.md §3).
 */
export const DOC_KINDS = [
  'tax_invoice', 'bill_of_supply', 'delivery_challan', 'eway_bill', 'lr', 'freight_sheet', 'pod',
  'loading_report', 'unloading_report', 'damage_report', 'trip_closure',
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DOC_STATUSES = ['draft', 'final', 'expired', 'cancelled', 'superseded'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

/** What the vendor organisation may upload and keep up to date (the customer's own papers). */
export const VENDOR_KINDS: readonly DocKind[] = ['tax_invoice', 'bill_of_supply', 'delivery_challan', 'eway_bill'];

/** The invoice-like papers any one of which satisfies "invoice or challan". */
export const INVOICE_KINDS: readonly DocKind[] = ['tax_invoice', 'bill_of_supply', 'delivery_challan'];

/** Kinds the carrier generates from the load's data (a PDF is rendered from the stored fields). */
export const GENERATED_KINDS = ['lr', 'freight_sheet', 'trip_closure', 'loading_report', 'unloading_report', 'damage_report', 'pod'] as const;
export type GeneratedKind = (typeof GENERATED_KINDS)[number];

export const DOC_LABELS: Record<DocKind, string> = {
  tax_invoice: 'Tax invoice',
  bill_of_supply: 'Bill of supply',
  delivery_challan: 'Delivery challan',
  eway_bill: 'E-way bill',
  lr: 'LR / GR (lorry receipt)',
  freight_sheet: 'Freight sheet',
  pod: 'Proof of delivery',
  loading_report: 'Loading report',
  unloading_report: 'Unloading report',
  damage_report: 'Damage and shortage report',
  trip_closure: 'Trip closure report',
};

export const isDocKind = (v: unknown): v is DocKind => typeof v === 'string' && (DOC_KINDS as readonly string[]).includes(v);
export const isGeneratedKind = (v: unknown): v is GeneratedKind => typeof v === 'string' && (GENERATED_KINDS as readonly string[]).includes(v);

/** Folder of one load's files in the private bucket. */
export const loadFolder = (loadId: string) => `loads/${loadId}/`;

/** A stored path is accepted only inside the load's own folder. */
export function isLoadPath(path: unknown, loadId: string): path is string {
  return typeof path === 'string' && path.length <= 300 && path.startsWith(loadFolder(loadId)) && !path.includes('..');
}

/** Upper-case, no spaces or dashes: MH 12 AB-1234 and mh12ab1234 are the same vehicle. */
export const normalisePlate = (v: unknown): string => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
