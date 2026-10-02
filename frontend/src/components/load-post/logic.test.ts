import { describe, expect, it } from 'vitest'
import { profileErrors } from './helpers'
import type { LoadPayload, ProductRow } from '@/types/load'
import {
  allSpecialHandling, applyRecommendation, applyRowPatch, deriveCapacity, derivedHandling, emptyDraft, emptyRow, ewayLocal, inr, itemTotals,
  LAST_STEP, phoneDigits, STEP_LABELS, taxBasisLocal, toPayload,
} from './logic'
import { mergeDraft, repostToDraft } from './draft'
import { firstInvalidStep, stepForRecommendation, validateStep } from './validate'

/** The PRD 4.3 sample load. */
const sample = (): ProductRow[] => [
  ['Wheat flour (maida)', '1101', 0, '500', 'bags', '12500', '187500'],
  ['Refined sunflower oil', '1512', 5, '200', 'cans', '4000', '320000'],
  ['Packaged spices', '0910', 5, '100', 'boxes', '800', '45000'],
  ['Soap & detergent', '3401', 18, '300', 'cartons', '3600', '210000'],
].map(([name, hsn, rate, qty, unit, kg, value]) => ({
  ...emptyRow(), product_name: name as string, hsn_code: hsn as string, gst_rate: rate as number, hsn_locked: true,
  rate_options: [rate as number], quantity: qty as string, unit: unit as string, weight_kg: kg as string, declared_value: value as string,
}))

describe('totals and the e-way counter', () => {
  it('adds up the PRD sample to 20,900 kg and ₹7,62,500, e-way required', () => {
    const items = sample()
    expect(itemTotals(items)).toEqual({ weight_kg: 20900, declared_value: 762500, product_count: 4 })
    expect(inr(762500)).toBe('₹7,62,500')
    expect(ewayLocal(items).required).toBe(true)
  })

  it('does not require an e-way bill at or below ₹50,000, unless hazardous', () => {
    const [row] = sample()
    expect(ewayLocal([{ ...row, declared_value: '50000' }]).required).toBe(false)
    expect(ewayLocal([{ ...row, declared_value: '50001' }]).required).toBe(true)
    expect(ewayLocal([{ ...row, declared_value: '100', handling: ['hazmat'] }]).required).toBe(true)
  })
})

const route = (): Partial<ReturnType<typeof emptyDraft>> => ({
  pickup_city: 'Mumbai', pickup_address: 'Dock 4', pickup_pincode: '400001', delivery_city: 'Delhi', delivery_address: 'Plot 9',
  delivery_pincode: '110001', pickup_date: '2026-10-02', pickup_contact_name: 'Ravi', pickup_contact_phone: '98200 12345',
  delivery_contact_name: 'Asha', delivery_contact_phone: '98111 22334',
  pickup_lat: 19.07, pickup_lng: 72.87, delivery_lat: 28.61, delivery_lng: 77.2,
})

describe('the four steps', () => {
  it('are Route and dates, Goods, Truck and price, Review, and the review is last', () => {
    expect([...STEP_LABELS]).toEqual(['Route & dates', 'Goods', 'Truck & price', 'Review'])
    expect(LAST_STEP).toBe(3)
  })

  it('step 0 wants 6-digit pin codes, picked places, a date from today, and both contacts', () => {
    const d = emptyDraft()
    const e = validateStep(d, 0, '2026-10-02')
    expect(Object.keys(e)).toEqual(expect.arrayContaining([
      'pickup_city', 'pickup_pincode', 'delivery_pincode', 'pickup_date', 'pickup_contact_phone', 'delivery_contact_name', 'delivery_contact_phone', 'pickup_lat', 'delivery_lat',
    ]))
    Object.assign(d, route(), { pickup_date: '2026-10-01' })
    expect(Object.keys(validateStep(d, 0, '2026-10-02'))).toEqual(['pickup_date'])
    expect(validateStep(d, 0, '2026-10-02').pickup_date).toMatch(/past/)
    d.pickup_date = '2026-10-02'
    expect(validateStep(d, 0, '2026-10-02')).toEqual({})
  })

  it('the receiver name and mobile are required, because the driver and the proof of delivery need them', () => {
    const d = { ...emptyDraft(), ...route(), delivery_contact_name: '', delivery_contact_phone: '' }
    expect(Object.keys(validateStep(d, 0, '2026-10-02')).sort()).toEqual(['delivery_contact_name', 'delivery_contact_phone'])
    d.delivery_contact_name = 'Asha'
    d.delivery_contact_phone = '12345'
    expect(Object.keys(validateStep(d, 0, '2026-10-02'))).toEqual(['delivery_contact_phone'])
  })

  it('step 1 is the one goods step: name, HSN, rate, quantity and weight for every product', () => {
    const d = emptyDraft()
    expect(Object.keys(validateStep(d, 1))).toEqual(expect.arrayContaining(['product_name_0', 'quantity_0', 'weight_kg_0']))
    d.items[0].product_name = 'cement'
    expect(Object.keys(validateStep(d, 1))).toContain('hsn_code_0')
    d.items[0].hsn_code = '2523'
    expect(Object.keys(validateStep(d, 1))).toContain('gst_rate_0')
    d.items = sample()
    d.items[2].weight_kg = ''
    expect(Object.keys(validateStep(d, 1))).toEqual(['weight_kg_2'])
    d.items[2].weight_kg = '800'
    expect(validateStep(d, 1)).toEqual({})
  })

  it('step 2 requires a temperature when anything is temperature-controlled', () => {
    const d = emptyDraft()
    Object.assign(d, { load_type: 'ftl', vehicle_class: 'reefer' })
    d.items[0].handling = ['temperature_controlled']
    expect(Object.keys(validateStep(d, 2))).toEqual(['temp_choice'])
    d.temp_choice = '2_8'
    expect(validateStep(d, 2)).toEqual({})
  })

  it('a vehicle is needed for a full truck load only, and a part load without one is sent as null', () => {
    const d = { ...emptyDraft(), load_type: 'ftl' as const }
    expect(Object.keys(validateStep(d, 2))).toEqual(['vehicle_class'])
    const ptl = { ...d, load_type: 'ptl' as const }
    expect(validateStep(ptl, 2)).toEqual({})
    expect(toPayload(ptl).vehicle_class).toBeNull()
    expect(toPayload({ ...ptl, vehicle_class: 'mini' }).vehicle_class).toBe('mini')
  })

  it('pricing: quotes need no price, booking at my price needs a budget', () => {
    const d = emptyDraft()
    expect(d.quote_requested).toBe(true)
    Object.assign(d, { load_type: 'ptl' })
    expect(validateStep(d, 2)).toEqual({})
    const direct = { ...d, quote_requested: false }
    expect(validateStep(direct, 2).budget_inr).toMatch(/price you will pay/)
    expect(validateStep({ ...direct, budget_inr: '0' }, 2).budget_inr).toBeTruthy()
    expect(validateStep({ ...direct, budget_inr: '18000' }, 2)).toEqual({})
    expect(toPayload({ ...direct, budget_inr: '18000' })).toMatchObject({ quote_requested: false, budget_inr: 18000 })
    expect(toPayload({ ...d, budget_inr: '' })).toMatchObject({ quote_requested: true, budget_inr: null })
    expect(toPayload({ ...d, budget_inr: '15000' })).toMatchObject({ quote_requested: true, budget_inr: 15000 })
  })

  it('chosen companies need at least one company', () => {
    expect(validateStep({ ...emptyDraft(), load_type: 'ptl', routing: 'chosen' }, 2).company_ids).toBeTruthy()
  })

  it('maps each recommendation to its step', () => {
    for (const c of ['same_city', 'same_day_pickup', 'interstate_igst']) expect(stepForRecommendation(c)).toBe(0)
    for (const c of ['hsn_ambiguous', 'multi_rate', 'no_value', 'bulk_template', 'eway_required', 'hazmat_permit']) expect(stepForRecommendation(c)).toBe(1)
    for (const c of ['weight_over_18t', 'ptl_heavy', 'perishable_reefer', 'budget_below_estimate', 'mini_truck_interstate']) expect(stepForRecommendation(c)).toBe(2)
  })

  it('finds the first step with a problem', () => {
    expect(firstInvalidStep(emptyDraft())).toBe(0)
    const d = { ...emptyDraft(), ...route(), items: sample(), load_type: 'ptl' as const }
    expect(firstInvalidStep(d, '2026-10-02')).toBeNull()
    expect(firstInvalidStep({ ...d, items: [emptyRow()] }, '2026-10-02')).toBe(1)
    expect(firstInvalidStep({ ...d, quote_requested: false }, '2026-10-02')).toBe(2)
  })

  it('accepts Indian mobile numbers in common spellings', () => {
    expect(phoneDigits('+91 98200 12345')).toBe('9820012345')
    expect(phoneDigits('09820012345')).toBe('9820012345')
    expect(phoneDigits('12345')).toBeNull()
  })

  it('compares the two states for CGST + SGST or IGST', () => {
    expect(taxBasisLocal({ pickup_state_code: '27', delivery_state_code: '07' })).toBe('inter')
    expect(taxBasisLocal({ pickup_state_code: '27', delivery_state_code: '27' })).toBe('intra')
    expect(taxBasisLocal({ pickup_state_code: '27', delivery_state_code: '' })).toBe('unknown')
  })
})

describe('draft and payload', () => {
  it('makes a request id once and keeps it in the draft', () => {
    const d = emptyDraft()
    expect(d.client_request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(mergeDraft(JSON.parse(JSON.stringify(d))).client_request_id).toBe(d.client_request_id)
  })

  it('fills fields that an older saved draft lacks', () => {
    const merged = mergeDraft({ pickup_city: 'Pune' })
    expect(merged.pickup_city).toBe('Pune')
    expect(merged.items).toHaveLength(1)
  })

  it('sends numbers as numbers and phones in +91 form', () => {
    const d = emptyDraft()
    d.items = sample()
    d.pickup_contact_phone = '98200 12345'
    d.capacity_t = '22'
    d.temp_choice = '2_8'
    const p = toPayload(d)
    expect(p.items[1]).toMatchObject({ hsn_code: '1512', gst_rate: 5, weight_kg: 4000, declared_value: 320000 })
    expect(p.pickup_contact_phone).toBe('+919820012345')
    expect(p.capacity_t).toBe(22)
    expect([p.temp_min_c, p.temp_max_c]).toEqual([2, 8])
    expect(p.client_request_id).toBe(d.client_request_id)
  })

  it('sends ambient as its own mode with no range, so a perishable load can be ambient', () => {
    const d = emptyDraft()
    d.items = sample()
    d.items[0].handling = ['temperature_controlled']
    d.temp_choice = 'ambient'
    expect(validateStep({ ...d, load_type: 'ftl', vehicle_class: 'reefer', capacity_t: '5' }, 2)).toEqual({})
    const ambient = toPayload(d)
    expect(ambient).toMatchObject({ temp_mode: 'ambient', temp_min_c: null, temp_max_c: null })
    expect(ambient.items[0].is_perishable).toBe(true)
    d.temp_choice = '2_8'
    expect(toPayload(d)).toMatchObject({ temp_mode: 'chilled', temp_min_c: 2, temp_max_c: 8 })
    d.temp_choice = 'minus18'
    expect(toPayload(d)).toMatchObject({ temp_mode: 'frozen', temp_min_c: -18, temp_max_c: -18 })
    d.temp_choice = ''
    expect(toPayload(d)).toMatchObject({ temp_mode: null, temp_min_c: null })
  })

  it('a repost of an ambient load comes back as ambient', () => {
    const draft = repostToDraft({ items: [], temp_mode: 'ambient', temp_min_c: null, temp_max_c: null } as Partial<LoadPayload>)
    expect(draft.temp_choice).toBe('ambient')
    expect(repostToDraft({ temp_mode: 'chilled', temp_min_c: 2, temp_max_c: 8 } as Partial<LoadPayload>).temp_choice).toBe('2_8')
  })

  it('sends the coordinates and a number for a blank declared value', () => {
    const d = emptyDraft()
    Object.assign(d, { pickup_lat: 19.07, pickup_lng: 72.87, delivery_lat: 28.61, delivery_lng: 77.2 })
    d.items = [{ ...sample()[0], declared_value: '' }]
    const p = toPayload(d)
    expect([p.pickup_lat, p.pickup_lng, p.delivery_lat, p.delivery_lng]).toEqual([19.07, 72.87, 28.61, 77.2])
    expect(p.items[0].declared_value).toBe(0)
  })

  it('applies a recommendation fix to the draft', () => {
    const d = emptyDraft()
    const next = applyRecommendation(d, { field: 'load_type', value: 'ftl' })
    expect(next.load_type).toBe('ftl')
    expect(next.transport_touched).toBe(true)
    expect(applyRecommendation(d, { field: 'budget_inr', value: 18000 }).budget_inr).toBe('18000')
    expect(applyRecommendation(d, { field: 'items', value: 'x' })).toBe(d)
  })
})

describe('handling has one source of truth', () => {
  it('derives fragile and hazmat from the products and sends the union without duplicates', () => {
    const d = emptyDraft()
    d.items = sample()
    d.items[0].handling = ['fragile', 'temperature_controlled']
    d.items[1].handling = ['fragile', 'hazmat']
    d.special_handling = ['do_not_stack', 'fragile']
    expect(derivedHandling(d.items)).toEqual(['fragile', 'hazmat'])
    expect(allSpecialHandling(d)).toEqual(['do_not_stack', 'fragile', 'hazmat'])
    expect(toPayload(d).special_handling).toEqual(['do_not_stack', 'fragile', 'hazmat'])
    expect(toPayload({ ...d, items: sample(), special_handling: [] }).special_handling).toEqual([])
  })
})

describe('capacity is derived, not typed', () => {
  const van = { key: 'v', name: 'Eicher', min_t: 5, max_t: 9, best_for: null, notes: null, interstate_ok: true, is_reefer: false, is_open: false, is_tanker: false, sort: 1 }
  it('follows the server suggestion, then the vehicle size, and a chosen vehicle wins once picked', () => {
    expect(deriveCapacity(16, undefined, false)).toBe(16)
    expect(deriveCapacity(null, van, false)).toBe(9)
    expect(deriveCapacity(undefined, { ...van, max_t: null }, false)).toBe(5)
    expect(deriveCapacity(16, van, false)).toBe(16)
    expect(deriveCapacity(16, van, true)).toBe(9)
    expect(deriveCapacity(null, undefined, true)).toBeNull()
  })
})

describe('weight from quantity', () => {
  const row = (quantity: string, unit: string, weight_kg = '') => ({ ...emptyRow(), quantity, unit, weight_kg })
  it('fills the weight for kg and tonnes, and follows the quantity until the person types a weight', () => {
    let r = applyRowPatch(row('', 'kg'), { quantity: '250' })
    expect(r.weight_kg).toBe('250')
    r = applyRowPatch(r, { quantity: '2500' })
    expect(r.weight_kg).toBe('2500')
    r = applyRowPatch(r, { unit: 'tonnes', quantity: '3' })
    expect(r.weight_kg).toBe('3000')
    r = applyRowPatch(r, { weight_kg: '2900' })
    r = applyRowPatch(r, { quantity: '4' })
    expect(r.weight_kg).toBe('2900')
  })
  it('leaves other units alone', () => {
    expect(applyRowPatch(row('', 'bags'), { quantity: '10' }).weight_kg).toBe('')
    expect(applyRowPatch(row('10', 'bags'), { unit: 'kg' }).weight_kg).toBe('10')
  })
})

describe('old saved drafts', () => {
  it('map the five-step form (no version) to the four steps', () => {
    const at = (step: number) => mergeDraft({ step, pickup_city: 'Pune' } as never).step
    expect([0, 1, 2, 3, 4].map(at)).toEqual([1, 1, 0, 2, 3])
    expect(mergeDraft({ step: 4 } as never).v).toBe(2)
  })
  it('keep the step of a version 2 draft', () => {
    expect(mergeDraft({ v: 2, step: 2 } as never).step).toBe(2)
  })
  it('move load-level fragile and hazmat onto the product and keep the price mode meaningful', () => {
    const old = { step: 3, items: [{ ...emptyRow(), product_name: 'Glass' }], special_handling: ['fragile', 'odc'], quote_requested: false, budget_inr: '' }
    const d = mergeDraft(old as never)
    expect(d.items[0].handling).toEqual(['fragile'])
    expect(d.special_handling).toEqual(['odc'])
    expect(d.quote_requested).toBe(true)
    expect(mergeDraft({ ...old, budget_inr: '9000' } as never).quote_requested).toBe(false)
  })
})

describe('repost', () => {
  const payload: Partial<LoadPayload> = {
    items: [{ product_name: 'Cement', hsn_code: '2523', gst_rate: 18, quantity: 100, unit: 'bags', weight_kg: 5000, declared_value: 40000, handling: [], category: 'construction', is_hazmat: false, is_perishable: false }],
    pickup_city: 'Mumbai', pickup_address: 'Dock 4', pickup_pincode: '400001', pickup_date: '2026-10-05', pickup_slot: 'morning',
    pickup_contact_name: 'Ravi', pickup_contact_phone: '+919820012345', pickup_lat: 19.07, pickup_lng: 72.87, delivery_lat: 28.61, delivery_lng: 77.2,
    delivery_city: 'Delhi', delivery_address: 'Plot 9', delivery_pincode: '110001', delivery_date: '2026-10-09',
    load_type: 'ftl', vehicle_class: 'sxl_32', capacity_t: 16, budget_inr: 90000,
  }

  it('keeps everything except the dates, and starts a new request', () => {
    const d = repostToDraft(payload, 'load-1')
    expect(d.pickup_date).toBe('')
    expect(d.delivery_date).toBe('')
    expect(d.pickup_city).toBe('Mumbai')
    expect(d.delivery_pincode).toBe('110001')
    expect(d.items[0]).toMatchObject({ product_name: 'Cement', hsn_code: '2523', gst_rate: 18, hsn_locked: true, weight_kg: '5000' })
    expect(d.vehicle_class).toBe('sxl_32')
    expect(d.capacity_t).toBe('16')
    expect(d.budget_inr).toBe('90000')
    expect(d.quote_requested).toBe(false)
    expect([d.v, d.step]).toEqual([2, 0])
    expect(d.reposted_from).toBe('load-1')
    expect([d.pickup_lat, d.delivery_lng]).toEqual([19.07, 77.2])
    expect(toPayload(d).source).toBe('repost')
  })

  it('moves a load-level fragile flag onto the product and asks for quotes when no price was named', () => {
    const d = repostToDraft({ ...payload, budget_inr: null, special_handling: ['fragile', 'do_not_stack'] })
    expect(d.items[0].handling).toEqual(['fragile'])
    expect(d.special_handling).toEqual(['do_not_stack'])
    expect(d.quote_requested).toBe(true)
  })
})

describe('the business profile (PRD section 9)', () => {
  const profile = { full_name: 'Vik', business_name: 'Acme', account_type: 'customer' as const, gstin: '', address: '4 MIDC', pincode: '400093', email: '', business_type: '' as const, monthly_loads: '' as const }

  it('needs the business name for everyone, and leaves email optional', () => {
    expect(profileErrors(profile)).toEqual({})
    expect(profileErrors({ ...profile, business_name: ' ' })).toEqual({ business_name: 'Enter your business name.' })
    expect(profileErrors({ ...profile, account_type: 'business_partner', business_name: '' })).toMatchObject({ business_name: 'Enter your business name.' })
    expect(profileErrors({ ...profile, email: 'not-an-email' })).toEqual({ email: 'Enter a valid email.' })
    expect(profileErrors({ ...profile, email: 'vik@example.test' })).toEqual({})
  })
})
