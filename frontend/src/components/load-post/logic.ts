/**
 * The Post a Load form without any screen: the draft, its totals, the checks for each step, and the
 * conversion to and from what the server sends. Plain functions so they are easy to test.
 */
import type {
  LoadDraft, LoadItemPayload, LoadPayload, ProductHandling, ProductRow, Recommendation, TempChoice,
} from '@/types/load'

export const STEP_LABELS = ['Goods & HSN', 'Products', 'Pickup & Delivery', 'Transport', 'Review'] as const
export const LAST_STEP = STEP_LABELS.length - 1
export const EWAY_THRESHOLD_INR = 50_000
export const MAX_ITEMS = 50
export const MAX_WEIGHT_KG = 60_000
/** GST rates a person may pick when entering an HSN code by hand. */
export const MANUAL_RATES = [0, 5, 12, 18, 28, 40]
export const UNITS = ['bags', 'boxes', 'cartons', 'cans', 'drums', 'pallets', 'pieces', 'rolls', 'bundles', 'kg', 'tonnes', 'litres']

export const randomId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function emptyRow(): ProductRow {
  return {
    key: randomId(), product_name: '', hsn_code: '', gst_rate: null, hsn_locked: false, rate_options: [], rate_note: null,
    category: null, quantity: '', unit: 'bags', weight_kg: '', declared_value: '', handling: [],
  }
}

export function emptyDraft(): LoadDraft {
  return {
    client_request_id: randomId(),
    step: 0,
    items: [emptyRow()],
    pickup_city: '', pickup_address: '', pickup_pincode: '', pickup_state_code: '', pickup_state_name: '',
    pickup_date: '', pickup_slot: '', pickup_contact_name: '', pickup_contact_phone: '',
    delivery_city: '', delivery_address: '', delivery_pincode: '', delivery_state_code: '', delivery_state_name: '',
    delivery_date: '', delivery_contact_name: '', delivery_contact_phone: '',
    loading_dock: false, access_restrictions: '',
    load_type: '', vehicle_class: '', capacity_t: '', transport_touched: false, temp_choice: '',
    special_handling: [], budget_inr: '', quote_requested: false, loading_help: false, unloading_help: false,
    reposted_from: null,
  }
}

/** A saved draft from an older build may miss fields; fill them from an empty one. */
export function mergeDraft(saved: Partial<LoadDraft> | null | undefined): LoadDraft {
  const base = emptyDraft()
  if (!saved || typeof saved !== 'object') return base
  const items = Array.isArray(saved.items) && saved.items.length > 0
    ? saved.items.map(i => ({ ...emptyRow(), ...i, key: i.key || randomId() }))
    : base.items
  return { ...base, ...saved, items, client_request_id: saved.client_request_id || base.client_request_id }
}

// ---------- Numbers and text ----------

const toNum = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Rupees the Indian way: ₹7,62,500. */
export const inr = (n: number | null | undefined): string =>
  `₹${Math.round(n ?? 0).toLocaleString('en-IN')}`

export const kgText = (n: number): string => `${Math.round(n).toLocaleString('en-IN')} kg`

export const rateText = (rates: number[]): string => rates.map(r => `${r}%`).join(' / ')

export function itemTotals(items: ProductRow[]) {
  const weight_kg = items.reduce((s, i) => s + toNum(i.weight_kg), 0)
  const declared_value = items.reduce((s, i) => s + toNum(i.declared_value), 0)
  return { weight_kg, declared_value, product_count: items.length }
}

export const hasHazmat = (items: ProductRow[]): boolean => items.some(i => i.handling.includes('hazmat'))
export const hasPerishable = (items: ProductRow[]): boolean => items.some(i => i.handling.includes('temperature_controlled'))

/** The live e-way counter on the Products step: the value is over ₹50,000, or any goods are hazardous. */
export function ewayLocal(items: ProductRow[]) {
  const { declared_value } = itemTotals(items)
  const hazmat = hasHazmat(items)
  return { required: declared_value > EWAY_THRESHOLD_INR || hazmat, declared_value, hazmat }
}

/** The pin code's state, so the form can say CGST + SGST or IGST before the server answers. */
export function taxBasisLocal(d: Pick<LoadDraft, 'pickup_state_code' | 'delivery_state_code'>): 'intra' | 'inter' | 'unknown' {
  if (!d.pickup_state_code || !d.delivery_state_code) return 'unknown'
  return d.pickup_state_code === d.delivery_state_code ? 'intra' : 'inter'
}

export const todayIso = (now: Date = new Date()): string => {
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

export const isWeekend = (iso: string): boolean => {
  const d = new Date(`${iso}T00:00:00`)
  return !Number.isNaN(d.getTime()) && (d.getDay() === 0 || d.getDay() === 6)
}

/** Ten digits starting 6 to 9; "+91" and spaces are allowed. Returns the ten digits, or null. */
export function phoneDigits(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '')
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

export const TEMP_RANGES: Record<Exclude<TempChoice, ''>, { min: number | null; max: number | null; label: string }> = {
  '2_8': { min: 2, max: 8, label: '2–8 °C' },
  minus18: { min: -18, max: -18, label: '−18 °C' },
  ambient: { min: null, max: null, label: 'Ambient' },
}

/** Without the server's suggestion: heavy loads fill a truck. */
export const localLoadType = (weightKg: number): 'ftl' | 'ptl' => (weightKg >= 7_000 ? 'ftl' : 'ptl')

// ---------- Draft to server ----------

export function toPayload(d: LoadDraft): LoadPayload {
  const temp = d.temp_choice ? TEMP_RANGES[d.temp_choice] : null
  const items: LoadItemPayload[] = d.items.map(i => ({
    product_name: i.product_name.trim(),
    hsn_code: i.hsn_code.trim(),
    gst_rate: i.gst_rate ?? 0,
    quantity: toNum(i.quantity),
    unit: i.unit,
    weight_kg: toNum(i.weight_kg),
    declared_value: i.declared_value === '' ? null : toNum(i.declared_value),
    handling: i.handling,
    category: i.category,
    is_hazmat: i.handling.includes('hazmat'),
    is_perishable: i.handling.includes('temperature_controlled'),
  }))
  const pickupPhone = phoneDigits(d.pickup_contact_phone)
  const deliveryPhone = phoneDigits(d.delivery_contact_phone)
  return {
    client_request_id: d.client_request_id,
    source: d.reposted_from ? 'repost' : 'web',
    reposted_from: d.reposted_from,
    items,
    pickup_city: d.pickup_city.trim(),
    pickup_address: d.pickup_address.trim(),
    pickup_pincode: d.pickup_pincode.trim(),
    pickup_state_code: d.pickup_state_code || null,
    pickup_date: d.pickup_date || null,
    pickup_slot: d.pickup_slot || null,
    pickup_contact_name: d.pickup_contact_name.trim(),
    pickup_contact_phone: pickupPhone ? `+91${pickupPhone}` : d.pickup_contact_phone.trim(),
    delivery_city: d.delivery_city.trim(),
    delivery_address: d.delivery_address.trim(),
    delivery_pincode: d.delivery_pincode.trim(),
    delivery_state_code: d.delivery_state_code || null,
    delivery_date: d.delivery_date || null,
    delivery_contact_name: d.delivery_contact_name.trim() || null,
    delivery_contact_phone: deliveryPhone ? `+91${deliveryPhone}` : d.delivery_contact_phone.trim() || null,
    loading_dock: d.loading_dock,
    access_restrictions: d.access_restrictions.trim() || null,
    load_type: d.load_type || null,
    vehicle_class: d.vehicle_class || null,
    capacity_t: d.capacity_t === '' ? null : toNum(d.capacity_t),
    temp_min_c: temp ? temp.min : null,
    temp_max_c: temp ? temp.max : null,
    special_handling: d.special_handling,
    budget_inr: d.budget_inr === '' ? null : toNum(d.budget_inr),
    quote_requested: d.quote_requested,
    loading_help: d.loading_help,
    unloading_help: d.unloading_help,
  }
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

function tempChoiceOf(min: number | null | undefined, max: number | null | undefined): TempChoice {
  if (min === 2 && max === 8) return '2_8'
  if (min === -18) return 'minus18'
  return ''
}

/**
 * A repost: everything from an earlier load except the dates, with a fresh request id so it posts
 * as a new load. `payload` is what POST /vendor/loads/:id/repost returns.
 */
export function repostToDraft(payload: Partial<LoadPayload>, repostedFrom: string | null = null): LoadDraft {
  const base = emptyDraft()
  const items: ProductRow[] = (payload.items ?? []).map(i => ({
    ...emptyRow(),
    product_name: str(i.product_name),
    hsn_code: str(i.hsn_code),
    gst_rate: i.gst_rate ?? null,
    hsn_locked: !!i.hsn_code && i.gst_rate !== undefined && i.gst_rate !== null,
    rate_options: i.gst_rate !== undefined && i.gst_rate !== null ? [i.gst_rate] : [],
    category: i.category ?? null,
    quantity: str(i.quantity),
    unit: i.unit || 'bags',
    weight_kg: str(i.weight_kg),
    declared_value: str(i.declared_value),
    handling: (i.handling ?? []) as ProductHandling[],
  }))
  return {
    ...base,
    items: items.length > 0 ? items : base.items,
    pickup_city: str(payload.pickup_city), pickup_address: str(payload.pickup_address), pickup_pincode: str(payload.pickup_pincode),
    pickup_state_code: str(payload.pickup_state_code), pickup_slot: payload.pickup_slot ?? '',
    pickup_contact_name: str(payload.pickup_contact_name), pickup_contact_phone: str(payload.pickup_contact_phone),
    delivery_city: str(payload.delivery_city), delivery_address: str(payload.delivery_address), delivery_pincode: str(payload.delivery_pincode),
    delivery_state_code: str(payload.delivery_state_code),
    delivery_contact_name: str(payload.delivery_contact_name), delivery_contact_phone: str(payload.delivery_contact_phone),
    loading_dock: !!payload.loading_dock, access_restrictions: str(payload.access_restrictions),
    load_type: payload.load_type ?? '', vehicle_class: str(payload.vehicle_class), capacity_t: str(payload.capacity_t),
    transport_touched: !!(payload.load_type || payload.vehicle_class),
    temp_choice: tempChoiceOf(payload.temp_min_c, payload.temp_max_c),
    special_handling: payload.special_handling ?? [],
    budget_inr: str(payload.budget_inr), quote_requested: !!payload.quote_requested,
    loading_help: !!payload.loading_help, unloading_help: !!payload.unloading_help,
    // The dates are cleared on purpose: the person picks new ones.
    pickup_date: '', delivery_date: '',
    reposted_from: repostedFrom ?? payload.reposted_from ?? null,
  }
}

// ---------- Checks ----------

export type StepErrors = Record<string, string>

const pinOk = (v: string) => /^\d{6}$/.test(v.trim())

/** What is missing or wrong on one step, in plain words. Empty means the step is fine. */
export function validateStep(d: LoadDraft, step: number, today: string = todayIso()): StepErrors {
  const e: StepErrors = {}
  if (step === 0) {
    const first = d.items[0]
    if (!first || first.product_name.trim().length < 3) e.product_name_0 = 'Describe your goods (at least 3 characters).'
    else if (!first.hsn_code.trim()) e.hsn_code_0 = 'Pick your goods from the list, or enter the HSN code.'
    else if (first.gst_rate === null) e.gst_rate_0 = 'Select the applicable GST rate.'
  }
  if (step === 1) {
    d.items.forEach((i, n) => {
      if (i.product_name.trim().length < 2) e[`product_name_${n}`] = 'Enter the product name.'
      if (!i.hsn_code.trim()) e[`hsn_code_${n}`] = 'Add the HSN code.'
      else if (i.gst_rate === null) e[`gst_rate_${n}`] = 'Select the applicable GST rate.'
      if (toNum(i.quantity) <= 0) e[`quantity_${n}`] = 'Enter the quantity.'
      if (toNum(i.weight_kg) <= 0) e[`weight_kg_${n}`] = 'Enter the weight in kg.'
    })
    if (d.items.length > MAX_ITEMS) e.items = `A load can have at most ${MAX_ITEMS} products.`
    if (itemTotals(d.items).weight_kg > MAX_WEIGHT_KG) e.items = 'A load can weigh at most 60 tonnes. Split it into two loads.'
  }
  if (step === 2) {
    const side = (p: 'pickup' | 'delivery', required: boolean) => {
      if (!d[`${p}_city`].trim()) e[`${p}_city`] = 'Enter the city.'
      if (!d[`${p}_address`].trim()) e[`${p}_address`] = 'Enter the full address with a landmark.'
      if (!pinOk(d[`${p}_pincode`])) e[`${p}_pincode`] = 'Enter the 6-digit pin code.'
      if (required) {
        if (!d.pickup_contact_name.trim()) e.pickup_contact_name = 'Who will be at the loading point?'
        if (!phoneDigits(d.pickup_contact_phone)) e.pickup_contact_phone = 'Enter a 10-digit mobile number.'
      }
    }
    side('pickup', true)
    side('delivery', false)
    if (!d.pickup_date) e.pickup_date = 'Choose the pickup date.'
    else if (d.pickup_date < today) e.pickup_date = 'The pickup date cannot be in the past.'
    if (d.delivery_date && d.pickup_date && d.delivery_date < d.pickup_date) e.delivery_date = 'Delivery cannot be before pickup.'
    if (d.delivery_contact_phone.trim() && !phoneDigits(d.delivery_contact_phone)) e.delivery_contact_phone = 'Enter a 10-digit mobile number.'
  }
  if (step === 3) {
    if (!d.load_type) e.load_type = 'Choose full or part truck load.'
    if (!d.vehicle_class) e.vehicle_class = 'Choose a vehicle type.'
    if (toNum(d.capacity_t) <= 0) e.capacity_t = 'Enter the capacity in tonnes.'
    if (hasPerishable(d.items) && !d.temp_choice) e.temp_choice = 'Choose the temperature your goods need.'
  }
  return e
}

/** Every step's problems at once, for the Submit Load click. Returns the first step with a problem, or null. */
export function firstInvalidStep(d: LoadDraft, today: string = todayIso()): number | null {
  for (let s = 0; s <= 3; s += 1) if (Object.keys(validateStep(d, s, today)).length > 0) return s
  return null
}

// ---------- Recommendations ----------

/** Which step shows a recommendation, next to the field it concerns. */
export function stepForRecommendation(code: string): number {
  switch (code) {
    case 'hsn_ambiguous': case 'multi_rate': return 0
    case 'no_value': case 'bulk_template': case 'eway_required': case 'hazmat_permit': return 1
    case 'same_city': case 'same_day_pickup': case 'interstate_igst': return 2
    default: return 3
  }
}

const SIMPLE_FIELDS = new Set([
  'load_type', 'vehicle_class', 'capacity_t', 'budget_inr', 'pickup_date', 'pickup_slot', 'delivery_date',
  'pickup_city', 'delivery_city', 'temp_choice',
])

/** Applies a recommendation's one-click fix to the draft. Unknown fields are ignored. */
export function applyRecommendation(d: LoadDraft, action: NonNullable<Recommendation['action']>): LoadDraft {
  if (!SIMPLE_FIELDS.has(action.field)) return d
  const next = { ...d, [action.field]: String(action.value) } as LoadDraft
  if (['load_type', 'vehicle_class', 'capacity_t'].includes(action.field)) next.transport_touched = true
  return next
}

/** The label of a fix button. */
export function actionLabel(action: NonNullable<Recommendation['action']>, vehicleName?: string): string {
  switch (action.field) {
    case 'budget_inr': return `Use ${inr(Number(action.value))}`
    case 'load_type': return `Switch to ${String(action.value).toUpperCase()}`
    case 'vehicle_class': return vehicleName ? `Use ${vehicleName}` : 'Use this vehicle'
    case 'capacity_t': return `Use ${action.value} t`
    default: return 'Apply'
  }
}
