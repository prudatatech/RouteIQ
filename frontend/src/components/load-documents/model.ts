import { gstinError } from '@/utils/gstin'
import type {
  CheckStatus, DocumentKind, DocumentStatus, GenerateKind, LoadDocument, Settlement, UploadKind,
} from '@/types/loadDocuments'
import type { Tone } from '@/components/ui'

export type PanelRole = 'vendor' | 'carrier' | 'platform'

export const KIND_LABELS: Record<DocumentKind, string> = {
  tax_invoice: 'Tax invoice',
  bill_of_supply: 'Bill of supply',
  delivery_challan: 'Delivery challan',
  eway_bill: 'E-way bill',
  lr: 'LR / GR (lorry receipt)',
  freight_sheet: 'Freight sheet',
  pod: 'Proof of delivery',
  loading_report: 'Loading report',
  unloading_report: 'Unloading report',
  damage_report: 'Damage / shortage report',
  trip_closure: 'Trip closure report',
}

/** Order the groups are shown in: what the vendor brings, what the carrier produces, then delivery. */
export const KIND_ORDER: DocumentKind[] = [
  'tax_invoice', 'bill_of_supply', 'delivery_challan', 'eway_bill',
  'lr', 'freight_sheet', 'loading_report', 'pod', 'unloading_report', 'damage_report', 'trip_closure',
]

export const UPLOAD_KINDS: UploadKind[] = ['tax_invoice', 'bill_of_supply', 'delivery_challan', 'eway_bill']

export const GENERATE_ACTIONS: { kind: GenerateKind; label: string }[] = [
  { kind: 'lr', label: 'Generate LR / GR' },
  { kind: 'freight_sheet', label: 'Generate freight sheet' },
  { kind: 'loading_report', label: 'Loading report' },
  { kind: 'pod', label: 'Proof of delivery' },
  { kind: 'unloading_report', label: 'Unloading report' },
  { kind: 'damage_report', label: 'Damage report' },
  { kind: 'trip_closure', label: 'Trip closure report' },
]

export const CHECK_LABELS: Record<CheckStatus, { label: string; tone: Tone }> = {
  ok: { label: 'In order', tone: 'success' },
  expiring: { label: 'Expiring soon', tone: 'warning' },
  missing: { label: 'Missing', tone: 'danger' },
  expired: { label: 'Expired', tone: 'danger' },
  inconsistent: { label: 'Does not match', tone: 'warning' },
  not_required: { label: 'Not needed', tone: 'neutral' },
}

export const DOC_STATUS: Record<DocumentStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  final: { label: 'Final', tone: 'success' },
  expired: { label: 'Expired', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  superseded: { label: 'Replaced', tone: 'neutral' },
}

export const canUpload = (role: PanelRole) => role === 'vendor' || role === 'carrier'
export const canGenerate = (role: PanelRole) => role === 'carrier'
export const canCloseTrip = (role: PanelRole) => role === 'carrier'

/** Documents grouped by kind in display order; kinds with none are left out. */
export function groupByKind(docs: LoadDocument[]): { kind: DocumentKind; docs: LoadDocument[] }[] {
  return KIND_ORDER
    .map(kind => ({ kind, docs: docs.filter(d => d.kind === kind).sort((a, b) => b.version - a.version) }))
    .filter(g => g.docs.length > 0)
}

/** The proof of delivery that counts for closing: a final one. */
export const finalPod = (docs: LoadDocument[]): LoadDocument | undefined =>
  docs.find(d => d.kind === 'pod' && d.status === 'final')

/** Why the trip cannot be closed yet, or null when it can. */
export function closeBlockedReason(settlement: Settlement | null, docs: LoadDocument[]): string | null {
  if (!settlement) return 'Open the settlement first.'
  if (settlement.status === 'closed') return 'This trip is already closed.'
  if (!finalPod(docs)) return 'A final proof of delivery is needed before the trip can be closed.'
  return null
}

// ── Upload form ──────────────────────────────────────────

export interface UploadValues {
  kind: UploadKind
  number: string
  doc_date: string
  // invoice / challan
  seller_name: string
  seller_gstin: string
  buyer_name: string
  buyer_gstin: string
  from_address: string
  to_address: string
  total_value: string
  // e-way bill
  valid_until: string
  linked_document: string
  transporter_id: string
  transporter_name: string
  vehicle_number: string
  distance_km: string
}

export const emptyUpload = (kind: UploadKind = 'tax_invoice'): UploadValues => ({
  kind, number: '', doc_date: '', seller_name: '', seller_gstin: '', buyer_name: '', buyer_gstin: '',
  from_address: '', to_address: '', total_value: '', valid_until: '', linked_document: '', transporter_id: '',
  transporter_name: '', vehicle_number: '', distance_km: '',
})

export type UploadErrors = Partial<Record<keyof UploadValues, string>>

export const EWAY_RE = /^\d{12}$/

export function validateUpload(v: UploadValues): UploadErrors {
  const e: UploadErrors = {}
  const num = v.number.trim()
  if (v.kind === 'eway_bill') {
    if (!num) e.number = 'Enter the 12-digit e-way bill number.'
    else if (!EWAY_RE.test(num)) e.number = 'The e-way bill number is exactly 12 digits.'
    if (!v.doc_date) e.doc_date = 'Enter the date it was generated.'
    if (!v.valid_until) e.valid_until = 'Enter the date it is valid until.'
    else if (v.doc_date && v.valid_until < v.doc_date) e.valid_until = 'Valid until cannot be before the generation date.'
    if (v.distance_km && !(Number(v.distance_km) > 0)) e.distance_km = 'Enter the distance in kilometres.'
  } else {
    if (!num) e.number = 'Enter the document number.'
    if (!v.doc_date) e.doc_date = 'Enter the document date.'
    if (v.seller_gstin.trim()) {
      const g = gstinError(v.seller_gstin)
      if (g) e.seller_gstin = g
    }
    if (v.buyer_gstin.trim()) {
      const g = gstinError(v.buyer_gstin)
      if (g) e.buyer_gstin = g
    }
    if (v.total_value && !(Number(v.total_value) >= 0)) e.total_value = 'Enter the value in rupees.'
  }
  return e
}

const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, val]) => val !== '' && val !== undefined && val !== null))

/**
 * The `fields` of the document as the API takes them (backend schemas.ts). The e-way bill's validity is not a field:
 * it goes in the top-level `valid_until`.
 */
export function uploadFields(v: UploadValues): Record<string, unknown> {
  if (v.kind === 'eway_bill') {
    return clean({
      ewb_number: v.number.trim(),
      generated_on: v.doc_date,
      linked_document_number: v.linked_document.trim(),
      transporter_id: v.transporter_id.trim().toUpperCase(),
      transporter_name: v.transporter_name.trim(),
      vehicle_number: v.vehicle_number.trim().toUpperCase().replace(/\s+/g, ''),
      approx_distance_km: v.distance_km ? Math.round(Number(v.distance_km)) : '',
    })
  }
  return clean({
    seller_name: v.seller_name.trim(),
    seller_gstin: v.seller_gstin.trim().toUpperCase(),
    buyer_name: v.buyer_name.trim(),
    buyer_gstin: v.buyer_gstin.trim().toUpperCase(),
    dispatch_from: v.from_address.trim(),
    ship_to: v.to_address.trim(),
    total_value: v.total_value ? Number(v.total_value) : '',
  })
}

/** Form values for an existing document, so it can be corrected. */
export function valuesFromDocument(d: LoadDocument): UploadValues {
  const f = d.fields as Record<string, unknown>
  const s = (k: string) => (f[k] === undefined || f[k] === null ? '' : String(f[k]))
  return {
    ...emptyUpload(d.kind as UploadKind),
    number: d.number ?? '',
    doc_date: d.doc_date?.slice(0, 10) ?? '',
    seller_name: s('seller_name'), seller_gstin: s('seller_gstin'), buyer_name: s('buyer_name'), buyer_gstin: s('buyer_gstin'),
    from_address: s('dispatch_from'), to_address: s('ship_to'), total_value: s('total_value'),
    valid_until: (d.valid_until ?? '').slice(0, 10),
    linked_document: s('linked_document_number'), transporter_id: s('transporter_id'), transporter_name: s('transporter_name'),
    vehicle_number: s('vehicle_number'), distance_km: s('approx_distance_km'),
  }
}
