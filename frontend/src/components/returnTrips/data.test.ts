import { describe, expect, it } from 'vitest'
import { laneText, timeLeft, windowState, type Bid, type CapacityWindow, type WindowVehicle } from './model'

const NOW = new Date('2026-09-30T10:00:00Z').getTime()
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()

const window = (over: Partial<CapacityWindow> = {}): CapacityWindow => ({
  id: 'w1', vehicle_id: 'v1', opens_at: at(-30), closes_at: at(30), floor_price: 1000, winning_bid_id: null,
  trigger_type: 'return_trip', status: 'open', vehicles: null, ...over,
})
const bid = (status: string): Bid => ({
  id: 'b1', window_id: 'w1', vendor_id: 'u1', bid_amount: 1500, submitted_at: at(-5), status, eway_bill_ref: null,
  weight_kg: 500, load_configuration: null, rejection_reason: null, delivery_points: null, vendor: null, awarded: null,
})

describe('windowState', () => {
  it('follows the clock and the bids', () => {
    expect(windowState(window(), [], NOW)).toBe('open')
    expect(windowState(window({ opens_at: at(10) }), [], NOW)).toBe('upcoming')
    expect(windowState(window({ closes_at: at(-1) }), [], NOW)).toBe('closed')
    expect(windowState(window({ closes_at: at(-1) }), [bid('pending')], NOW)).toBe('decide')
    expect(windowState(window({ winning_bid_id: 'b1' }), [bid('won')], NOW)).toBe('awarded')
    expect(windowState(window({ status: 'cancelled' }), [], NOW)).toBe('cancelled')
  })
})

describe('laneText', () => {
  const truck = (place: string | null): WindowVehicle => ({
    id: 'v1', plate_number: 'MH12AB1234', vehicle_type: null, capacity_kg: 1000, available_capacity_kg: 400, current_location_name: place,
  })

  it('names where the truck is and where its trip ends', () => {
    expect(laneText(truck('Pune, Maharashtra'), { id: 't1', destination: 'Nashik, Maharashtra' })).toBe('Pune to Nashik')
  })

  it('falls back to what is known', () => {
    expect(laneText(truck('Pune, Maharashtra'), null)).toBe('Near Pune')
    expect(laneText(truck('Pune'), { id: 't1', destination: 'Pune' })).toBe('Near Pune')
    expect(laneText(truck(null), { id: 't1', destination: 'Nashik' })).toBe('Heading to Nashik')
    expect(laneText(truck(null), null)).toBeNull()
    expect(laneText(null, undefined)).toBeNull()
  })
})

describe('timeLeft', () => {
  it('reads in minutes, then hours, then days', () => {
    expect(timeLeft(at(12), NOW)).toBe('12 min')
    expect(timeLeft(at(60), NOW)).toBe('1 h')
    expect(timeLeft(at(125), NOW)).toBe('2 h 5 min')
    expect(timeLeft(at(60 * 72), NOW)).toBe('3 days')
  })

  it('is null once it has passed', () => {
    expect(timeLeft(at(-1), NOW)).toBeNull()
    expect(timeLeft('not a date', NOW)).toBeNull()
  })
})
