/**
 * Pure helpers for the Post a Load steps. They live outside the component files so those export only components
 * (fast refresh needs that).
 */
import type { ResolvedPlace } from '@/services/geocoding'
import type { BusinessProfile, HsnHit, ProductHandling, ProductRow, VehicleClass } from '@/types/load'
import { checkGstin } from '@/utils/gstin'

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

/** What picking a search result does to a row: fill and lock the code and rate, and flag hazardous or perishable goods. */
export function applyHsnHit(row: ProductRow, hit: HsnHit): Partial<ProductRow> {
  const handling = new Set<ProductHandling>(row.handling)
  if (hit.is_hazmat) handling.add('hazmat')
  if (hit.is_perishable) handling.add('temperature_controlled')
  const typed = row.product_name.trim()
  return {
    product_name: typed.length >= 3 ? typed : hit.description,
    hsn_code: hit.hsn_code,
    hsn_locked: true,
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
