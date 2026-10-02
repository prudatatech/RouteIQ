/**
 * Every type of the Post a Load flow, in one place: the public lookups, the assist answer, the
 * posted load and the business profile. The shapes follow docs/load-posting-design.md (sections 1
 * and 2). When the backend contract changes, this file and the calls in services/api.ts are the
 * only places to edit.
 */

// ---------- Public lookups ----------

export interface HsnHit {
  hsn_code: string
  description: string
  category: string | null
  /** One rate, or several for a multi-rate code. */
  gst_rates: number[]
  rate_note: string | null
  is_hazmat: boolean
  is_perishable: boolean
}

export interface PincodeInfo {
  pincode: string
  state_code: string
  state_name: string
  district?: string | null
  city?: string | null
}

export interface VehicleClass {
  key: string
  name: string
  min_t: number | null
  max_t: number | null
  best_for: string | null
  notes: string | null
  interstate_ok: boolean
  is_reefer: boolean
  is_open: boolean
  is_tanker: boolean
  sort: number
}

export interface GoodsCategory {
  key: string
  name: string
  examples: string | null
  hsn_range: string | null
  default_rates: number[]
  eway_threshold_inr: number
  is_hazmat: boolean
  is_perishable: boolean
  recommended_vehicle_class: string | null
}

// ---------- The form (the draft) ----------

export type ProductHandling = 'fragile' | 'temperature_controlled' | 'hazmat'
export type SpecialHandling = 'fragile' | 'do_not_stack' | 'this_side_up' | 'hazmat' | 'odc'
export type LoadType = 'ftl' | 'ptl'
export type PickupSlot = 'morning' | 'afternoon' | 'evening'
/** The temperature choice on the Transport step. Empty until chosen. */
export type TempChoice = '' | '2_8' | 'minus18' | 'ambient'

/** One product row as typed. Numbers are kept as text while the person types. */
export interface ProductRow {
  /** Stable key for the row, never sent. */
  key: string
  product_name: string
  hsn_code: string
  /** The chosen rate in percent, or null until chosen. */
  gst_rate: number | null
  /** True when the code and rate came from the HSN search (they are read-only). */
  hsn_locked: boolean
  /** The rates the code allows. More than one means the person must choose. */
  rate_options: number[]
  rate_note: string | null
  category: string | null
  quantity: string
  unit: string
  weight_kg: string
  declared_value: string
  handling: ProductHandling[]
}

/**
 * The whole form. Field names that the server also uses keep the server's names, so a
 * recommendation's `action.field` applies to the draft directly.
 */
export interface LoadDraft {
  /** A UUID made when the form opened; the server returns the first load for a repeated id. */
  client_request_id: string
  step: number
  items: ProductRow[]

  pickup_city: string
  pickup_address: string
  pickup_pincode: string
  pickup_state_code: string
  pickup_state_name: string
  pickup_date: string
  pickup_slot: '' | PickupSlot
  pickup_contact_name: string
  pickup_contact_phone: string

  delivery_city: string
  delivery_address: string
  delivery_pincode: string
  delivery_state_code: string
  delivery_state_name: string
  delivery_date: string
  delivery_contact_name: string
  delivery_contact_phone: string

  loading_dock: boolean
  access_restrictions: string

  load_type: '' | LoadType
  vehicle_class: string
  capacity_t: string
  /** False while the suggestion still fills load type, vehicle and capacity; true once the person changed one. */
  transport_touched: boolean
  temp_choice: TempChoice
  special_handling: SpecialHandling[]
  budget_inr: string
  quote_requested: boolean
  loading_help: boolean
  unloading_help: boolean

  /** Set on a repost: the load this one copies. */
  reposted_from: string | null
}

// ---------- Posting ----------

export interface LoadItemPayload {
  product_name: string
  hsn_code: string
  gst_rate: number
  quantity: number
  unit: string
  weight_kg: number
  declared_value: number | null
  handling: ProductHandling[]
  category: string | null
  is_hazmat: boolean
  is_perishable: boolean
}

/** The body of POST /vendor/loads and POST /public/loads/assist, and the answer of a repost. */
export interface LoadPayload {
  client_request_id: string
  source: 'web' | 'repost'
  reposted_from?: string | null
  items: LoadItemPayload[]

  pickup_city: string
  pickup_address: string
  pickup_pincode: string
  pickup_state_code: string | null
  pickup_date: string | null
  pickup_slot: PickupSlot | null
  pickup_contact_name: string
  pickup_contact_phone: string

  delivery_city: string
  delivery_address: string
  delivery_pincode: string
  delivery_state_code: string | null
  delivery_date: string | null
  delivery_contact_name: string | null
  delivery_contact_phone: string | null

  loading_dock: boolean
  access_restrictions: string | null

  load_type: LoadType | null
  vehicle_class: string | null
  capacity_t: number | null
  temp_min_c: number | null
  temp_max_c: number | null
  special_handling: SpecialHandling[]
  budget_inr: number | null
  quote_requested: boolean
  loading_help: boolean
  unloading_help: boolean
}

export interface PostedLoad {
  id: string
  load_number: string
  status?: string
}

// ---------- Assist ----------

export type RecommendationCode =
  | 'hsn_ambiguous' | 'multi_rate' | 'weight_over_18t' | 'ptl_heavy' | 'interstate_igst' | 'eway_required'
  | 'perishable_reefer' | 'hazmat_permit' | 'same_city' | 'same_day_pickup' | 'no_value' | 'bulk_template'
  | 'budget_below_estimate'

export interface Recommendation {
  code: RecommendationCode | string
  severity: 'info' | 'warn'
  message: string
  action?: { field: string; value: string | number | boolean }
}

export interface TaxLine { product: string; hsn: string; rate: number; taxable: number; gst: number }
export interface TaxByRate { rate: number; taxable: number; gst: number }

export interface AssistTax {
  basis: 'intra' | 'inter' | 'unknown'
  pickup_state: string | null
  delivery_state: string | null
  lines: TaxLine[]
  by_rate: TaxByRate[]
  taxable: number
  cgst: number
  sgst: number
  igst: number
  gst_total: number
  grand_total: number
}

export interface AssistResult {
  totals: { weight_kg: number; declared_value: number; product_count: number }
  eway: { required: boolean; threshold: number; reason: string }
  tax: AssistTax
  hazmat_mixed: boolean
  perishable: boolean
  suggested: { load_type: LoadType; vehicle_class: string; capacity_t: number }
  estimate: { low: number; high: number; distance_km: number; label: string } | null
  recommendations: Recommendation[]
}

// ---------- My loads ----------

export interface LoadSummary {
  id: string
  load_number: string
  status: string
  pickup_city: string | null
  delivery_city: string | null
  pickup_date: string | null
  vehicle_class: string | null
  total_weight_kg: number | null
  created_at: string | null
}

export interface LoadListPage {
  items: LoadSummary[]
  total?: number
  page?: number
}

/** A goods line on a posted load, as GET /vendor/loads/:id returns it. */
export interface LoadItem {
  id?: string
  line_no?: number
  product_name: string
  hsn_code: string
  gst_rate: number | null
  quantity: number | null
  unit: string | null
  weight_kg: number | null
  declared_value: number | null
}

// ---------- Business profile and sign-in ----------

export type AccountType = 'customer' | 'business_partner'
export type BusinessType = '' | 'manufacturer' | 'trader' | 'distributor' | 'retailer' | 'exporter' | 'other'
export type MonthlyLoads = '' | '1-5' | '6-20' | '21-50' | '50+'

export interface BusinessProfile {
  full_name: string
  business_name: string
  account_type: AccountType
  gstin: string
  address: string
  pincode: string
  email: string
  business_type: BusinessType
  monthly_loads: MonthlyLoads
  /** Server-computed: every required field is present. */
  complete?: boolean
}

export interface VendorSession {
  session: { access_token: string; refresh_token: string }
}
