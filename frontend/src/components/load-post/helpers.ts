/**
 * Pure helpers for the Post a Load steps. They live outside the component files so those export only components
 * (fast refresh needs that).
 */
import type { ResolvedPlace } from '@/services/geocoding'
import type { BusinessProfile, HsnHit, ProductHandling, ProductRow, Recommendation, VehicleClass } from '@/types/load'
import { checkGstin } from '@/utils/gstin'
import { MANUAL_RATES, rateText, toNum } from './logic'

/** The city, pin code and full address a chosen place gives. Anything the geocoder lacks is left as typed. */
export function placeToFields(place: ResolvedPlace): { city?: string; pincode?: string; address: string } {
  const pin = place.parts?.pincode?.replace(/\D/g, '')
  const city = place.parts?.city || place.parts?.district || place.address.split(',')[0]?.trim()
  return { address: place.address, city: city || undefined, pincode: pin && pin.length === 6 ? pin : undefined }
}

export const emptyProfile = (): BusinessProfile => ({
  full_name: '', business_name: '', account_type: 'customer', gstin: '', address: '', pincode: '', email: '', business_type: '', monthly_loads: '',
})

/** What is missing in the business profile, by field. GSTIN is required for a Business Partner. */
export function profileErrors(p: BusinessProfile): Record<string, string> {
  const e: Record<string, string> = {}
  if (!p.full_name.trim()) e.full_name = 'Enter your full name.'
  if (!p.business_name.trim()) e.business_name = 'Enter your business name.'
  if (p.account_type === 'business_partner' && !p.gstin.trim()) e.gstin = 'A GSTIN is required for a Business Partner.'
  else if (p.gstin.trim()) {
    const check = checkGstin(p.gstin)
    if (!check.valid) e.gstin = check.message ?? 'Check the GSTIN.'
  }
  if (!p.address.trim()) e.address = 'Enter your business address.'
  if (!/^\d{6}$/.test(p.pincode.trim())) e.pincode = 'Enter the 6-digit pin code.'
  // Email is optional (it is how documents reach you without WhatsApp), but a typed one must be real
  if (p.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email.trim())) e.email = 'Enter a valid email.'
  return e
}

/** What picking a search result does to a row: fill the code and rate (both stay editable), and flag hazardous or perishable goods. */
export function applyHsnHit(row: ProductRow, hit: HsnHit): Partial<ProductRow> {
  const handling = new Set<ProductHandling>(row.handling)
  if (hit.is_hazmat) handling.add('hazmat')
  if (hit.is_perishable) handling.add('temperature_controlled')
  const typed = row.product_name.trim()
  return {
    product_name: typed.length >= 3 ? typed : hit.description,
    hsn_code: hit.hsn_code,
    rate_options: hit.gst_rates,
    rate_note: hit.rate_note,
    gst_rate: hit.gst_rates.length === 1 ? hit.gst_rates[0] : null,
    category: hit.category,
    handling: Array.from(handling),
  }
}

export const capacityText = (v: VehicleClass): string => {
  if (v.min_t != null && v.max_t != null) return `${v.min_t}–${v.max_t} T`
  if (v.max_t != null) return `up to ${v.max_t} T`
  return 'by volume'
}

/** A product with everything the form asks for: name, HSN code, rate, quantity and weight. */
export const productComplete = (r: ProductRow): boolean =>
  r.product_name.trim().length >= 3 && !!r.hsn_code.trim() && r.gst_rate !== null && toNum(r.quantity) > 0 && toNum(r.weight_kg) > 0

/** The GST rates to offer for a product: the code's own rates first, then the other GST 2.0 rates. */
export function rateChoices(options: number[], current: number | null): number[] {
  const own = Array.from(new Set(options))
  const others = [...MANUAL_RATES, ...(current !== null ? [current] : [])].filter((r, n, all) => all.indexOf(r) === n && !own.includes(r))
  return [...own, ...others.sort((a, b) => a - b)]
}

export interface ProductNote { key: string; severity: 'info' | 'warn'; message: string }

const PRODUCT_CODES = ['multi_rate', 'hsn_ambiguous']

/** Which product (0-based) a server recommendation is about: its item_index, the index in its fix, or the HSN code in the message. */
function recommendationIndex(rec: Recommendation, items: ProductRow[]): number | null {
  if (typeof rec.item_index === 'number') return rec.item_index
  const m = /^items\.(\d+)\./.exec(rec.action?.field ?? '')
  if (m) return Number(m[1])
  const hsn = /HSN (\d{4,8})/.exec(rec.message)?.[1]
  if (hsn) {
    const found = items.findIndex(i => i.hsn_code.trim() === hsn)
    if (found >= 0) return found
  }
  return null
}

/** True for a recommendation that is shown beside a product instead of in the step's list. */
export const isProductRecommendation = (rec: Recommendation): boolean => PRODUCT_CODES.includes(rec.code)

/**
 * The notes for one product, shown in its own card or summary row: the server's multi-rate and HSN suggestions that are
 * about this product, or (when the server has not said yet) the line the form can write itself for a code with several rates.
 */
export function productNotes(row: ProductRow, index: number, items: ProductRow[], recs: Recommendation[]): ProductNote[] {
  const notes: ProductNote[] = recs
    .filter(r => isProductRecommendation(r) && recommendationIndex(r, items) === index)
    .map(r => ({ key: `${r.code}-${r.message}`, severity: r.severity, message: r.message }))
  if (row.rate_options.length > 1 && !notes.some(n => n.key.startsWith('multi_rate'))) {
    notes.push({
      key: 'local-multi-rate', severity: row.gst_rate === null ? 'warn' : 'info',
      message: `HSN ${row.hsn_code} has more than one GST rate (${rateText(row.rate_options)}). ${row.gst_rate === null ? 'Select the one that applies to this product.' : `You chose ${row.gst_rate}%.`}`,
    })
  }
  return notes
}
