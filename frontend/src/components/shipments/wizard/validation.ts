import type { DraftShipmentData } from '@/store/draftStore'
import { dropsBalance, gstinError, phoneError } from '@/components/cargo/lots'

export const STEPS = [
  { id: 'route', label: 'Trip' },
  { id: 'cargo', label: 'Cargo' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'review', label: 'Review' },
] as const
export type StepId = (typeof STEPS)[number]['id']

type DropField = 'place' | 'consignee_name' | 'consignee_phone' | 'consignee_gstin' | 'pieces' | 'weight_kg' | 'declared_value'

export type FieldErrors = Partial<Record<
  'origin' | 'destination' | 'scheduled_date' | 'total_items' | 'total_weight_kg' | 'length_cm' | 'width_cm' | 'height_cm' |
  'vehicle' | 'asking_price' | 'freight_charge' | 'declared_value' | 'drops' | 'drops_split',
  string
>> & {
  /** One drop's field: `drop:<drop id>:<field>`. */
  [key: `drop:${string}:${DropField}`]: string | undefined
}

export const dropError = (errors: FieldErrors, id: string, field: DropField) => errors[`drop:${id}:${field}`]

export const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The declared value as a number, or null when not entered (or not a valid amount). */
export function declaredValueOf(d: Pick<DraftShipmentData, 'declared_value'>): number | null {
  if (!d.declared_value || !d.declared_value.trim()) return null
  const v = Number(d.declared_value)
  return Number.isFinite(v) && v >= 0 ? v : null
}

/** The pieces split of a multi-drop draft, against the booked totals. */
export function draftDropsBalance(d: DraftShipmentData) {
  return dropsBalance(
    { pieces: Number(d.total_items) || 0, weight_kg: Number(d.total_weight_kg) || 0, declared_value: declaredValueOf(d) },
    (d.drops ?? []).map(x => ({ pieces: x.pieces, weight_kg: x.weight_kg, declared_value: x.declared_value })),
  )
}

/** The most drops one shipment takes (POST /shipments `drops[]`); each becomes a lot. */
export const MAX_DROPS = 26

/** Problems that stop the user leaving a step. Empty when the step is complete. */
export function validateStep(step: StepId, d: DraftShipmentData): FieldErrors {
  const e: FieldErrors = {}
  const drops = d.drops ?? []
  if (step === 'route') {
    if (!d.origin_lat || !d.origin_lng) e.origin = 'Choose a pickup address from the suggestions.'
    if (d.multi_drop) {
      if (drops.length < 2) e.drops = 'Add at least two drops, or deliver to one destination.'
      else if (drops.length > MAX_DROPS) e.drops = `A shipment can have at most ${MAX_DROPS} drops. Book another shipment for the rest.`
      for (const x of drops) {
        if (!x.lat || !x.lng) e[`drop:${x.id}:place`] = 'Choose the drop address from the suggestions.'
        if (!x.consignee_name.trim()) e[`drop:${x.id}:consignee_name`] = 'Enter who receives this drop.'
        const phone = phoneError(x.consignee_phone)
        if (phone) e[`drop:${x.id}:consignee_phone`] = phone
        const gstin = gstinError(x.consignee_gstin)
        if (gstin) e[`drop:${x.id}:consignee_gstin`] = gstin
      }
    } else if (!d.dest_lat || !d.dest_lng) {
      e.destination = 'Choose a destination from the suggestions.'
    }
    if (d.plan_for_later) {
      if (!d.scheduled_date) e.scheduled_date = 'Choose a dispatch date.'
      else if (d.scheduled_date < todayIso()) e.scheduled_date = 'The dispatch date cannot be in the past.'
    }
  }
  if (step === 'cargo') {
    if (!Number.isInteger(Number(d.total_items)) || Number(d.total_items) < 1) e.total_items = 'Enter a whole number of 1 or more.'
    if (!(Number(d.total_weight_kg) > 0)) e.total_weight_kg = 'Enter a weight above 0.'
    if (!(Number(d.length_cm) > 0)) e.length_cm = 'Enter a length above 0.'
    if (!(Number(d.width_cm) > 0)) e.width_cm = 'Enter a width above 0.'
    if (!(Number(d.height_cm) > 0)) e.height_cm = 'Enter a height above 0.'
    if (d.freight_charge && !(Number(d.freight_charge) >= 0)) e.freight_charge = 'Enter a price of 0 or more, or leave it empty.'
    if (d.declared_value && d.declared_value.trim() && declaredValueOf(d) == null) e.declared_value = 'Enter a value of 0 or more, or leave it empty.'
    if (d.multi_drop && drops.length >= 2) {
      const balance = draftDropsBalance(d)
      balance.rows.forEach((r, i) => {
        const id = drops[i].id
        if (r.errors.pieces) e[`drop:${id}:pieces`] = r.errors.pieces
        if (r.errors.weight_kg) e[`drop:${id}:weight_kg`] = r.errors.weight_kg
        if (r.errors.declared_value) e[`drop:${id}:declared_value`] = r.errors.declared_value
      })
      if (balance.problems.length > 0) e.drops_split = balance.problems.join(' ')
    }
  }
  if (step === 'vehicle' && d.open_bidding && d.multi_drop) {
    e.vehicle = 'A shipment with several drops can’t be opened to vendor bids. Assign a vehicle, or book one shipment per drop.'
  } else if (step === 'vehicle' && d.open_bidding) {
    if (!d.selectedVehicleId) e.vehicle = 'Choose the vehicle whose spare space vendors will bid on.'
    if (d.asking_price && !(Number(d.asking_price) > 0)) e.asking_price = 'Enter a price above 0, or leave it empty.'
  }
  return e
}

/** First step with a problem, so Review can send the user back to it. */
export function firstInvalidStep(d: DraftShipmentData): StepId | null {
  for (const s of STEPS) {
    if (Object.keys(validateStep(s.id, d)).length > 0) return s.id
  }
  return null
}
