/**
 * The Post a Load form without any screen: the draft, its totals, the checks for each step, and the
 * conversion to and from what the server sends. Plain functions so they are easy to test.
 */
import type {
  LoadDraft, LoadItemPayload, LoadPayload, LoadPriority, ProductRow, Recommendation, SpecialHandling, TempChoice, TempMode, VehicleClass,
} from '@/types/load'

export const STEP_LABELS = ['Pickup & delivery', 'Goods', 'Truck & price', 'Review'] as const
/** The draft layout this build writes (2: four steps). Saved drafts without it are migrated in draft.ts. */
export const DRAFT_VERSION = 2
export const LAST_STEP = STEP_LABELS.length - 1
export const EWAY_THRESHOLD_INR = 50_000
export const MAX_ITEMS = 50
export const MAX_WEIGHT_KG = 60_000
/**
 * GST rates a person may pick when entering an HSN code by hand: the GST 2.0 rates on goods (notification
 * 9/2025-Central Tax (Rate) and its amendments; docs/gst-rates.md). 12% is only the bricks rate (14/2025); the 28%
 * schedule was omitted from 1 Feb 2026 (19/2025).
 */
export const MANUAL_RATES = [0, 0.25, 1.5, 3, 5, 12, 18, 40]
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
    key: randomId(), product_name: '', hsn_code: '', gst_rate: null, rate_options: [], rate_note: null,
    category: null, quantity: '', unit: 'bags', weight_kg: '', declared_value: '', handling: [],
  }
}

export function emptyDraft(): LoadDraft {
  return {
    client_request_id: randomId(),
    v: DRAFT_VERSION,
    step: 0,
    items: [emptyRow()],
    pickup_city: '', pickup_address: '', pickup_pincode: '', pickup_state_code: '', pickup_state_name: '',
    pickup_lat: null, pickup_lng: null,
    pickup_date: '', pickup_slot: '', pickup_contact_name: '', pickup_contact_phone: '',
    delivery_city: '', delivery_address: '', delivery_pincode: '', delivery_state_code: '', delivery_state_name: '',
    delivery_lat: null, delivery_lng: null,
    priority: 'medium', delivery_contact_name: '', delivery_contact_phone: '',
    load_type: '', vehicle_class: '', vehicle_mode: 'recommend', capacity_t: '', transport_touched: false, temp_choice: '',
    special_handling: [],
    reposted_from: null,
  }
}

// ---------- Numbers and text ----------

export const PRIORITIES: { value: LoadPriority; label: string; hint: string }[] = [
  { value: 'high', label: 'High', hint: 'Urgent: sent first to the largest logistic networks' },
  { value: 'medium', label: 'Medium', hint: 'Normal booking' },
  { value: 'low', label: 'Low', hint: 'Flexible: no rush' },
]
export const isPriority = (v: unknown): v is LoadPriority => v === 'high' || v === 'medium' || v === 'low'
export const priorityLabel = (p: LoadPriority | null | undefined): string => PRIORITIES.find(x => x.value === p)?.label ?? 'Medium'

export const toNum = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Rupees the Indian way: ₹7,62,500. */
export const inr = (n: number | null | undefined): string =>
  `₹${Math.round(n ?? 0).toLocaleString('en-IN')}`

/** "₹32,000 – ₹38,000", or null when the range is missing. */
export const rangeText = (low: number | null | undefined, high: number | null | undefined): string | null =>
  typeof low === 'number' && typeof high === 'number' && high > 0 ? `${inr(low)} – ${inr(high)}` : null

export const kgText = (n: number): string => `${Math.round(n).toLocaleString('en-IN')} kg`

export const rateText = (rates: number[]): string => rates.map(r => `${r}%`).join(' / ')

export function itemTotals(items: ProductRow[]) {
  const weight_kg = items.reduce((s, i) => s + toNum(i.weight_kg), 0)
  const declared_value = items.reduce((s, i) => s + toNum(i.declared_value), 0)
  return { weight_kg, declared_value, product_count: items.length }
}

export const hasHazmat = (items: ProductRow[]): boolean => items.some(i => i.handling.includes('hazmat'))
export const hasPerishable = (items: ProductRow[]): boolean => items.some(i => i.handling.includes('temperature_controlled'))

/** Whether an e-Way Bill is needed: the value is over ₹50,000, or any goods are hazardous. */
export function ewayLocal(items: ProductRow[]) {
  const { declared_value } = itemTotals(items)
  const hazmat = hasHazmat(items)
  return { required: declared_value > EWAY_THRESHOLD_INR || hazmat, declared_value, hazmat }
}

// ---------- One source of truth for handling ----------

/** Fragile and hazardous are set on the products; the load shows them read-only and sends them with the rest. */
export function derivedHandling(items: ProductRow[]): ('fragile' | 'hazmat')[] {
  const out: ('fragile' | 'hazmat')[] = []
  if (items.some(i => i.handling.includes('fragile'))) out.push('fragile')
  if (hasHazmat(items)) out.push('hazmat')
  return out
}

/** The load-level list (do not stack, this side up, ODC) plus what the products say, without duplicates. */
export function allSpecialHandling(d: Pick<LoadDraft, 'special_handling' | 'items'>): SpecialHandling[] {
  return Array.from(new Set<SpecialHandling>([...d.special_handling, ...derivedHandling(d.items)]))
}

// ---------- Weight from quantity ----------

/** The weight a quantity in kg or tonnes already tells, as text; null for any other unit or no quantity. */
export function weightFromQuantity(row: Pick<ProductRow, 'quantity' | 'unit'>): string | null {
  if (row.unit !== 'kg' && row.unit !== 'tonnes') return null
  const q = toNum(row.quantity)
  if (q <= 0) return null
  return String(Math.round(q * (row.unit === 'tonnes' ? 1000 : 1) * 1000) / 1000)
}

/**
 * A row edit. With the unit kg or tonnes the weight follows the quantity while it is empty or still the value it
 * filled itself; a weight the person typed is never overwritten.
 */
export function applyRowPatch(prev: ProductRow, patch: Partial<ProductRow>): ProductRow {
  const next = { ...prev, ...patch }
  if (patch.weight_kg !== undefined) return next
  const follows = prev.weight_kg === '' || prev.weight_kg === weightFromQuantity(prev)
  const auto = weightFromQuantity(next)
  if (follows && auto !== null) next.weight_kg = auto
  return next
}

// ---------- Capacity ----------

/**
 * The capacity sent as capacity_t and shown read-only: the server's suggestion for the weight; once the person picks a
 * vehicle themselves, that vehicle's size. With nothing to go on: null.
 */
export function deriveCapacity(suggested: number | null | undefined, vehicle: VehicleClass | undefined, touched: boolean): number | null {
  const own = vehicle ? (vehicle.max_t ?? vehicle.min_t ?? null) : null
  if (touched && own !== null) return own
  return suggested ?? own
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

/** Ambient is a mode of its own with no range: the server asks for a range only for chilled, frozen and custom. */
export const TEMP_RANGES: Record<Exclude<TempChoice, ''>, { min: number | null; max: number | null; label: string; mode: TempMode }> = {
  '2_8': { min: 2, max: 8, label: '2–8 °C', mode: 'chilled' },
  minus18: { min: -18, max: -18, label: '−18 °C', mode: 'frozen' },
  ambient: { min: null, max: null, label: 'Ambient', mode: 'ambient' },
}

/** Without the server's suggestion: heavy loads fill a truck. */
export const localLoadType = (weightKg: number): 'ftl' | 'ptl' => (weightKg >= 7_000 ? 'ftl' : 'ptl')

// ---------- Draft to server ----------

/**
 * The address sent: the place the search picked (its full formatted address). When there is none, one made from the
 * city, pin code and state. The server wants 1 to 500 characters.
 */
export function addressOf(d: LoadDraft, side: 'pickup' | 'delivery'): string {
  const picked = d[`${side}_address`].trim()
  const text = picked || [d[`${side}_city`].trim(), d[`${side}_pincode`].trim(), d[`${side}_state_name`].trim()].filter(Boolean).join(', ')
  return text.slice(0, 500)
}

export function toPayload(d: LoadDraft): LoadPayload {
  const temp = d.temp_choice ? TEMP_RANGES[d.temp_choice] : null
  const items: LoadItemPayload[] = d.items.map(i => ({
    product_name: i.product_name.trim(),
    hsn_code: i.hsn_code.trim(),
    gst_rate: i.gst_rate ?? 0,
    quantity: toNum(i.quantity),
    unit: i.unit,
    weight_kg: toNum(i.weight_kg),
    // The server needs a number; no value entered is 0
    declared_value: toNum(i.declared_value),
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
    pickup_address: addressOf(d, 'pickup'),
    pickup_pincode: d.pickup_pincode.trim(),
    pickup_state_code: d.pickup_state_code || null,
    pickup_lat: d.pickup_lat,
    pickup_lng: d.pickup_lng,
    pickup_date: d.pickup_date || null,
    pickup_slot: d.pickup_slot || null,
    pickup_contact_name: d.pickup_contact_name.trim(),
    pickup_contact_phone: pickupPhone ? `+91${pickupPhone}` : d.pickup_contact_phone.trim(),
    delivery_city: d.delivery_city.trim(),
    delivery_address: addressOf(d, 'delivery'),
    delivery_pincode: d.delivery_pincode.trim(),
    delivery_state_code: d.delivery_state_code || null,
    delivery_lat: d.delivery_lat,
    delivery_lng: d.delivery_lng,
    delivery_date: null,
    priority: d.priority,
    delivery_contact_name: d.delivery_contact_name.trim() || null,
    delivery_contact_phone: deliveryPhone ? `+91${deliveryPhone}` : d.delivery_contact_phone.trim() || null,
    loading_dock: false,
    access_restrictions: null,
    load_type: d.load_type || null,
    vehicle_class: d.vehicle_class || null,
    capacity_t: d.capacity_t === '' ? null : toNum(d.capacity_t),
    temp_mode: temp ? temp.mode : null,
    temp_min_c: temp ? temp.min : null,
    temp_max_c: temp ? temp.max : null,
    special_handling: allSpecialHandling(d),
    // Companies book at any price in the recommended range: no budget, no quote round, open to every company.
    budget_inr: null,
    quote_requested: false,
    loading_help: false,
    unloading_help: false,
    routing: 'open',
  }
}

// ---------- Recommendations ----------

const SIMPLE_FIELDS = new Set(['load_type', 'vehicle_class', 'pickup_date', 'pickup_slot', 'pickup_city', 'delivery_city', 'temp_choice'])

/** Applies a recommendation's one-click fix to the draft. Unknown fields are ignored. */
export function applyRecommendation(d: LoadDraft, action: NonNullable<Recommendation['action']>): LoadDraft {
  if (!SIMPLE_FIELDS.has(action.field)) return d
  const next = { ...d, [action.field]: String(action.value) } as LoadDraft
  if (['load_type', 'vehicle_class'].includes(action.field)) next.transport_touched = true
  if (action.field === 'vehicle_class') next.vehicle_mode = 'manual'
  return next
}

/** The label of a fix button. */
export function actionLabel(action: NonNullable<Recommendation['action']>, vehicleName?: string): string {
  switch (action.field) {
    case 'load_type': return `Switch to ${String(action.value).toUpperCase()}`
    case 'vehicle_class': return vehicleName ? `Use ${vehicleName}` : 'Use this vehicle'
    default: return 'Apply'
  }
}
