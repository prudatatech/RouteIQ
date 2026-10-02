/**
 * Drafts in and out of the form: an older saved draft brought up to the current layout, and a repost of an earlier
 * load. Plain functions, no screen.
 */
import type { LoadDraft, LoadPayload, ProductHandling, ProductRow, SpecialHandling, TempChoice, TempMode } from '@/types/load'
import { DRAFT_VERSION, emptyDraft, emptyRow, isPriority, randomId, LAST_STEP } from './logic'

/** Where an unversioned saved step (the five-step form) lands in the four-step form. */
export const OLD_STEP_MAP: Record<number, number> = { 0: 1, 1: 1, 2: 0, 3: 2, 4: 3 }

/** Fields an earlier draft may carry that the form no longer asks for. They are dropped, never sent. */
const LEGACY_FIELDS = [
  'budget_inr', 'quote_requested', 'routing', 'company_ids', 'delivery_date', 'loading_dock', 'access_restrictions',
  'loading_help', 'unloading_help',
] as const

const LOAD_LEVEL: SpecialHandling[] = ['do_not_stack', 'this_side_up', 'odc']

/**
 * Fragile and hazmat live on the products only. A load-level fragile or hazmat flag (an older draft or load) moves
 * to the first product, so nothing the person had set is lost.
 */
export function normalizeHandling(items: ProductRow[], special: SpecialHandling[]): { items: ProductRow[]; special: SpecialHandling[] } {
  const next = items.map(i => ({ ...i, handling: [...i.handling] }))
  if (next.length > 0) {
    for (const flag of ['fragile', 'hazmat'] as const) {
      if (special.includes(flag) && !next.some(i => i.handling.includes(flag))) next[0].handling.push(flag as ProductHandling)
    }
  }
  return { items: next, special: special.filter(s => LOAD_LEVEL.includes(s)) }
}

/** A saved draft from an older build may miss fields and use the old steps; bring it to the current layout. */
export function mergeDraft(saved: Partial<LoadDraft> | null | undefined): LoadDraft {
  const base = emptyDraft()
  if (!saved || typeof saved !== 'object') return base
  const rawItems = Array.isArray(saved.items) && saved.items.length > 0
    ? saved.items.map(i => ({ ...emptyRow(), ...i, key: i.key || randomId() }))
    : base.items
  const merged: LoadDraft = { ...base, ...saved, items: rawItems, client_request_id: saved.client_request_id || base.client_request_id }
  if (saved.v !== DRAFT_VERSION) {
    const old = Number.isInteger(saved.step) ? (saved.step as number) : 0
    merged.step = OLD_STEP_MAP[old] ?? 0
  }
  // The price, quote, company, delivery date and site fields are gone: ignore what an old draft has in them.
  for (const k of LEGACY_FIELDS) delete (merged as unknown as Record<string, unknown>)[k]
  if (!isPriority(merged.priority)) merged.priority = 'medium'
  // Recommend unless the person had chosen a vehicle themselves.
  merged.vehicle_mode = saved.vehicle_mode === 'recommend' || saved.vehicle_mode === 'manual'
    ? saved.vehicle_mode
    : saved.transport_touched && saved.vehicle_class ? 'manual' : 'recommend'
  merged.items = merged.items.map(i => { const { hsn_locked: _gone, ...row } = i as ProductRow & { hsn_locked?: boolean }; return row })
  merged.v = DRAFT_VERSION
  merged.step = Math.min(Math.max(merged.step, 0), LAST_STEP)
  const fixed = normalizeHandling(merged.items, Array.isArray(merged.special_handling) ? merged.special_handling : [])
  return { ...merged, items: fixed.items, special_handling: fixed.special }
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

function tempChoiceOf(min: number | null | undefined, max: number | null | undefined, mode?: TempMode | null): TempChoice {
  if (mode === 'ambient') return 'ambient'
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
    rate_options: i.gst_rate !== undefined && i.gst_rate !== null ? [i.gst_rate] : [],
    category: i.category ?? null,
    quantity: str(i.quantity),
    unit: i.unit || 'bags',
    weight_kg: str(i.weight_kg),
    declared_value: str(i.declared_value),
    handling: (i.handling ?? []) as ProductHandling[],
  }))
  const fixed = normalizeHandling(items.length > 0 ? items : base.items, (payload.special_handling ?? []) as SpecialHandling[])
  return {
    ...base,
    items: fixed.items,
    pickup_city: str(payload.pickup_city), pickup_address: str(payload.pickup_address), pickup_pincode: str(payload.pickup_pincode),
    pickup_state_code: str(payload.pickup_state_code), pickup_lat: payload.pickup_lat ?? null, pickup_lng: payload.pickup_lng ?? null,
    pickup_slot: payload.pickup_slot ?? '',
    pickup_contact_name: str(payload.pickup_contact_name), pickup_contact_phone: str(payload.pickup_contact_phone),
    delivery_city: str(payload.delivery_city), delivery_address: str(payload.delivery_address), delivery_pincode: str(payload.delivery_pincode),
    delivery_state_code: str(payload.delivery_state_code), delivery_lat: payload.delivery_lat ?? null, delivery_lng: payload.delivery_lng ?? null,
    delivery_contact_name: str(payload.delivery_contact_name), delivery_contact_phone: str(payload.delivery_contact_phone),
    priority: isPriority(payload.priority) ? payload.priority : 'medium',
    load_type: payload.load_type ?? '', vehicle_class: str(payload.vehicle_class), vehicle_mode: payload.vehicle_class ? 'manual' : 'recommend', capacity_t: str(payload.capacity_t),
    transport_touched: !!(payload.load_type || payload.vehicle_class),
    temp_choice: tempChoiceOf(payload.temp_min_c, payload.temp_max_c, payload.temp_mode),
    special_handling: fixed.special,
    // The pickup date is cleared on purpose: the person picks a new one.
    pickup_date: '',
    reposted_from: repostedFrom ?? payload.reposted_from ?? null,
  }
}

