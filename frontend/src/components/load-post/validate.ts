/** What each step of the Post a Load form needs, in plain words, and where a server suggestion is shown. */
import { MAX_CHOSEN_COMPANIES } from '@/types/routing'
import type { LoadDraft } from '@/types/load'
import { hasPerishable, itemTotals, LAST_STEP, MAX_ITEMS, MAX_WEIGHT_KG, phoneDigits, toNum, todayIso } from './logic'

export type StepErrors = Record<string, string>

const pinOk = (v: string) => /^\d{6}$/.test(v.trim())

/** Step 0: both ends of the trip, the dates and the two people the driver deals with. */
function routeErrors(d: LoadDraft, today: string): StepErrors {
  const e: StepErrors = {}
  for (const p of ['pickup', 'delivery'] as const) {
    if (!d[`${p}_city`].trim()) e[`${p}_city`] = 'Enter the city.'
    if (!d[`${p}_address`].trim()) e[`${p}_address`] = 'Enter the address line with a landmark.'
    if (!pinOk(d[`${p}_pincode`])) e[`${p}_pincode`] = 'Enter the 6-digit pin code.'
    if (d[`${p}_lat`] === null || d[`${p}_lng`] === null) e[`${p}_lat`] = `Search and pick the ${p} address so we can place it on the map.`
  }
  if (!d.pickup_contact_name.trim()) e.pickup_contact_name = 'Who will be at the loading point?'
  if (!phoneDigits(d.pickup_contact_phone)) e.pickup_contact_phone = 'Enter a 10-digit mobile number.'
  if (!d.delivery_contact_name.trim()) e.delivery_contact_name = 'Who receives the goods? The driver and the proof of delivery need a name.'
  if (!phoneDigits(d.delivery_contact_phone)) e.delivery_contact_phone = 'Enter the receiver’s 10-digit mobile number.'
  if (!d.pickup_date) e.pickup_date = 'Choose the pickup date.'
  else if (d.pickup_date < today) e.pickup_date = 'The pickup date cannot be in the past.'
  if (d.delivery_date && d.pickup_date && d.delivery_date < d.pickup_date) e.delivery_date = 'Delivery cannot be before pickup.'
  return e
}

/** Step 1: every product has a name, an HSN code and rate, a quantity and a weight. */
function goodsErrors(d: LoadDraft): StepErrors {
  const e: StepErrors = {}
  d.items.forEach((i, n) => {
    if (i.product_name.trim().length < 3) e[`product_name_${n}`] = 'Describe your goods (at least 3 characters).'
    else if (!i.hsn_code.trim()) e[`hsn_code_${n}`] = 'Pick your goods from the list, or enter the HSN code.'
    else if (i.gst_rate === null) e[`gst_rate_${n}`] = 'Select the applicable GST rate.'
    if (toNum(i.quantity) <= 0) e[`quantity_${n}`] = 'Enter the quantity.'
    if (toNum(i.weight_kg) <= 0) e[`weight_kg_${n}`] = 'Enter the weight in kg.'
  })
  if (d.items.length > MAX_ITEMS) e.items = `A load can have at most ${MAX_ITEMS} products.`
  if (itemTotals(d.items).weight_kg > MAX_WEIGHT_KG) e.items = 'A load can weigh at most 60 tonnes. Split it into two loads.'
  return e
}

/** Step 2: the truck (a vehicle is needed for a full load only), the temperature, the price and who sees the load. */
function truckErrors(d: LoadDraft): StepErrors {
  const e: StepErrors = {}
  if (!d.load_type) e.load_type = 'Choose full or part truck load.'
  if (d.load_type === 'ftl' && !d.vehicle_class) e.vehicle_class = 'Choose a vehicle type for a full truck load.'
  if (hasPerishable(d.items) && !d.temp_choice) e.temp_choice = 'Choose the temperature your goods need.'
  if (!d.quote_requested && !(toNum(d.budget_inr) > 0)) e.budget_inr = 'Enter the price you will pay, or choose to get quotes instead.'
  if (d.routing === 'chosen' && d.company_ids.length === 0) e.company_ids = 'Choose at least one logistic company, or open the load to all companies.'
  if (d.routing === 'chosen' && d.company_ids.length > MAX_CHOSEN_COMPANIES) e.company_ids = `Choose at most ${MAX_CHOSEN_COMPANIES} companies.`
  return e
}

/** What is missing or wrong on one step. Empty means the step is fine. The review step has nothing of its own. */
export function validateStep(d: LoadDraft, step: number, today: string = todayIso()): StepErrors {
  if (step === 0) return routeErrors(d, today)
  if (step === 1) return goodsErrors(d)
  if (step === 2) return truckErrors(d)
  return {}
}

/** Every step's problems at once, for the Submit Load click. Returns the first step with a problem, or null. */
export function firstInvalidStep(d: LoadDraft, today: string = todayIso()): number | null {
  for (let s = 0; s < LAST_STEP; s += 1) if (Object.keys(validateStep(d, s, today)).length > 0) return s
  return null
}

/** Which step shows a recommendation, next to the field it concerns. */
export function stepForRecommendation(code: string): number {
  switch (code) {
    case 'same_city': case 'same_day_pickup': case 'interstate_igst': return 0
    case 'hsn_ambiguous': case 'multi_rate': case 'no_value': case 'bulk_template': case 'eway_required': case 'hazmat_permit': return 1
    default: return 2
  }
}
