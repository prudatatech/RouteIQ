/**
 * Pure helpers for showing a posted load to staff (components/requests/PostedLoadDetails.tsx): the posting
 * columns of vendor_shipment_requests, the goods lines, and the labels the older screens read from metadata.cargo.
 */
import type { AssistTax, LoadItem } from '@/types/load'

/** The columns the Post a Load form adds to a vendor request (backend migration 20261003020000_load_posting.sql). */
export interface PostedLoadFields {
  load_number: string | null
  load_type: 'ftl' | 'ptl' | null
  vehicle_class: string | null
  capacity_t: number | string | null
  temp_min_c: number | string | null
  temp_max_c: number | string | null
  special_handling: string[] | null
  budget_inr: number | string | null
  quote_requested: boolean | null
  loading_help: boolean | null
  unloading_help: boolean | null
  pickup_city: string | null
  pickup_address: string | null
  pickup_pincode: string | null
  pickup_date: string | null
  pickup_slot: 'morning' | 'afternoon' | 'evening' | null
  pickup_contact_name: string | null
  pickup_contact_phone: string | null
  delivery_city: string | null
  delivery_address: string | null
  delivery_pincode: string | null
  delivery_date: string | null
  delivery_contact_name: string | null
  delivery_contact_phone: string | null
  loading_dock: boolean | null
  access_restrictions: string | null
  total_weight_kg: number | string | null
  total_declared_value: number | string | null
  tax_basis: 'intra' | 'inter' | 'unknown' | null
  eway_required: boolean | null
  hazmat_mixed: boolean | null
  metadata: { temp_mode?: string | null } | null
}

const HANDLING_LABEL: Record<string, string> = {
  fragile: 'Fragile', do_not_stack: 'Do not stack', this_side_up: 'This side up', hazmat: 'Hazardous', odc: 'Over-dimensional (ODC)',
  temperature_controlled: 'Temperature-controlled',
}

const label = (key: string): string => HANDLING_LABEL[key] ?? (key.replace(/[_-]+/g, ' ').trim().replace(/^./, c => c.toUpperCase()))

/**
 * Special handling as a list of labels. The form writes an object ({ fragile: true }, or {} when none), the older
 * vendor form wrote free text, and the posting column is a list of keys. Never returns anything React cannot render.
 */
export function specialHandlingLabels(value: unknown): string[] {
  if (value == null || value === false) return []
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(label))]
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).filter(([, on]) => on === true).map(([key]) => label(key))
  return []
}

/** A metadata.cargo value that is safe to render as text: a string or a number, else nothing. */
export function plainText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** The temperature the load needs, in words. Null when it needs none. */
export function temperatureText(mode: string | null | undefined, min: unknown, max: unknown): string | null {
  const lo = num(min)
  const hi = num(max)
  const range = lo !== null && hi !== null ? (lo === hi ? `${lo} °C` : `${lo} to ${hi} °C`) : null
  switch (mode) {
    case 'ambient': return 'Ambient (no cooling)'
    case 'chilled': return range ? `Chilled, ${range}` : 'Chilled'
    case 'frozen': return range ? `Frozen, ${range}` : 'Frozen'
    default: return range ? `Controlled, ${range}` : null
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The GST summary of the goods lines, by rate and line by line, in the shape the review step's GstSummary takes.
 * The basis (CGST and SGST, or IGST) is the one the server stored when the load was posted.
 */
export function taxFromItems(items: LoadItem[], basis: PostedLoadFields['tax_basis']): AssistTax {
  const lines = items.map(i => {
    const taxable = num(i.declared_value) ?? 0
    const rate = num(i.gst_rate) ?? 0
    return { product: i.product_name, hsn: i.hsn_code || null, rate, taxable, gst: round2((taxable * rate) / 100) }
  })
  const byRate = new Map<number, { rate: number; taxable: number; gst: number }>()
  for (const l of lines) {
    const row = byRate.get(l.rate) ?? { rate: l.rate, taxable: 0, gst: 0 }
    row.taxable = round2(row.taxable + l.taxable)
    row.gst = round2(row.gst + l.gst)
    byRate.set(l.rate, row)
  }
  const by_rate = [...byRate.values()].sort((a, b) => a.rate - b.rate)
  const taxable = round2(lines.reduce((s, l) => s + l.taxable, 0))
  const gst_total = round2(lines.reduce((s, l) => s + l.gst, 0))
  const intra = basis === 'intra'
  const cgst = intra ? round2(gst_total / 2) : 0
  return {
    basis: basis ?? 'unknown', pickup_state: null, delivery_state: null,
    lines, by_rate, taxable, gst_total, grand_total: round2(taxable + gst_total),
    cgst, sgst: intra ? round2(gst_total - cgst) : 0, igst: basis === 'inter' ? gst_total : 0,
  }
}
