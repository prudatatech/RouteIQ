import { describe, expect, it } from 'vitest'
import { canApprove, canChange, canPay, payoutSummary, rateOn, tripRef, typeLabel, type PayEntry, type PayRate } from './driverPay'

const rate = (over: Partial<PayRate>): PayRate => ({
  id: 'r', vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 10, effective_from: '2026-01-01', active: true, superseded_on: null, state: 'current', ...over,
})
const entry = (over: Partial<PayEntry>): PayEntry => ({
  id: 'e', driver_id: 'd1', driver_name: 'Ravi', vehicle_id: 'v', plate_number: 'MH12', vehicle_type: 'truck', route_id: null, manifest_id: null,
  trip_date: '2026-09-10', km: 100, km_source: 'planned', per_trip_amount: 500, per_km_amount: 10, adjustments: [], amount: 1500,
  rate_missing: false, status: 'earned', void_reason: null, payout_id: null, paid_at: null, ...over,
})

describe('rateOn', () => {
  const rates = [rate({ id: 'a' }), rate({ id: 'b', effective_from: '2026-09-15' }), rate({ id: 'c', effective_from: '2026-09-20', active: false }), rate({ id: 'd', vehicle_type: 'van' })]
  it('is the latest start on or before the date, ignoring withdrawn rates and other types', () => {
    expect(rateOn(rates, 'truck', '2026-09-14')?.id).toBe('a')
    expect(rateOn(rates, 'truck', '2026-09-30')?.id).toBe('b')
    expect(rateOn(rates, 'van', '2026-09-30')?.id).toBe('d')
    expect(rateOn(rates, 'bike', '2026-09-30')).toBeNull()
    expect(rateOn(rates, 'truck', '2025-12-31')).toBeNull()
  })
})

describe('what can be done to an entry', () => {
  it('approves earned entries that have a rate', () => {
    expect(canApprove(entry({}))).toBe(true)
    expect(canApprove(entry({ rate_missing: true, amount: 0 }))).toBe(false)
    expect(canApprove(entry({ status: 'approved' }))).toBe(false)
  })
  it('pays approved entries, and changes only unpaid ones', () => {
    expect(canPay(entry({ status: 'approved' }))).toBe(true)
    expect(canPay(entry({}))).toBe(false)
    expect(canChange(entry({ status: 'paid' }))).toBe(false)
    expect(canChange(entry({ status: 'void' }))).toBe(false)
    expect(canChange(entry({ status: 'approved' }))).toBe(true)
  })
})

describe('payoutSummary', () => {
  it('adds the amounts and says whether one driver is paid', () => {
    const one = payoutSummary([entry({ amount: 1200.5 }), entry({ id: 'f', amount: 800 })])
    expect(one).toEqual({ total: 2000.5, driverIds: ['d1'], single: true })
    expect(payoutSummary([entry({}), entry({ id: 'g', driver_id: 'd2' })]).single).toBe(false)
  })
})

describe('labels', () => {
  it('names the trip and the vehicle type', () => {
    expect(tripRef(entry({ route_id: 'abcd1234-0000' }))).toBe('TR-ABCD1234')
    expect(tripRef(entry({ manifest_id: 'ffee0011-0000' }))).toBe('CM-FFEE0011')
    expect(typeLabel('truck')).toBe('Truck')
    expect(typeLabel(null)).toBe('Unknown type')
  })
})
