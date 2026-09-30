import { describe, expect, it } from 'vitest'
import type { ShipmentRow } from '@/components/shipments/types'
import { byUrgency, canPickVehicle, hasLiveTrip, needsVehicle, tripSource } from './logic'

const ship = (over: Partial<ShipmentRow> = {}): ShipmentRow => ({ id: 's1', tracking_id: 'RTX-AAAA1111', status: 'created', ...over })
const withTrip = (status: string): Partial<ShipmentRow> => ({
  delivery_points: [{ id: 'dp1', route_stops: [{ routes: { vehicle_id: 'v1', status } }] }],
})

describe('needsVehicle', () => {
  it('lists a created shipment with no trip', () => {
    expect(needsVehicle(ship())).toBe(true)
  })

  it('lists a lot like any shipment, but not the master it was split from', () => {
    expect(needsVehicle(ship({ parent_shipment_id: 'm1', lot_label: 'B' }))).toBe(true)
    expect(needsVehicle(ship({ is_master: true }))).toBe(false)
  })

  it('does not list a vendor load: it is its own trip', () => {
    expect(needsVehicle(ship({ tracking_id: 'CM-ABCDEF12' }))).toBe(false)
  })

  it('does not list a shipment on a pending or active trip', () => {
    expect(needsVehicle(ship(withTrip('pending')))).toBe(false)
    expect(needsVehicle(ship(withTrip('active')))).toBe(false)
  })

  it('lists a shipment whose trip was cancelled or finished, and one that was taken off its vehicle', () => {
    expect(needsVehicle(ship(withTrip('cancelled')))).toBe(true)
    expect(needsVehicle(ship({ vehicle_id: 'v-from-an-old-log' }))).toBe(true)
  })

  it('lists a failed delivery only once the goods are back with the sender', () => {
    expect(needsVehicle(ship({ status: 'exception', current_holder: 'consignor' }))).toBe(true)
    expect(needsVehicle(ship({ status: 'exception', current_holder: null }))).toBe(true)
    expect(needsVehicle(ship({ status: 'exception', current_holder: 'vehicle' }))).toBe(false)
  })

  it('does not list a shipment that has moved on', () => {
    for (const status of ['assigned', 'in_transit', 'delivered', 'cancelled', 'on_hold']) expect(needsVehicle(ship({ status }))).toBe(false)
  })
})

describe('hasLiveTrip / canPickVehicle', () => {
  it('reads the trips on the delivery points', () => {
    expect(hasLiveTrip(ship())).toBe(false)
    expect(hasLiveTrip(ship(withTrip('optimizing')))).toBe(true)
    expect(hasLiveTrip(ship(withTrip('completed')))).toBe(false)
  })

  it('a shipment open to bids cannot be given a vehicle by hand', () => {
    expect(canPickVehicle(ship())).toBe(true)
    expect(canPickVehicle(ship({ open_bidding: true, bid_id: null }))).toBe(false)
    expect(canPickVehicle(ship({ open_bidding: true, bid_id: 'b1' }))).toBe(true)
  })
})

describe('byUrgency', () => {
  const pickup = (s: ShipmentRow) => (typeof s.metadata?.pickup_date === 'string' ? s.metadata.pickup_date : null)
  it('puts critical before low, then the earlier pickup, then the older shipment', () => {
    const rows = [
      ship({ id: 'a', priority: 'low', created_at: '2026-09-01T00:00:00Z' }),
      ship({ id: 'b', priority: 'critical', created_at: '2026-09-05T00:00:00Z' }),
      ship({ id: 'c', priority: 'medium', metadata: { pickup_date: '2026-10-05' }, created_at: '2026-09-04T00:00:00Z' }),
      ship({ id: 'd', priority: 'medium', metadata: { pickup_date: '2026-10-02' }, created_at: '2026-09-06T00:00:00Z' }),
      ship({ id: 'e', priority: 'medium', created_at: '2026-09-02T00:00:00Z' }),
    ]
    expect([...rows].sort((x, y) => byUrgency(x, y, pickup)).map(r => r.id)).toEqual(['b', 'd', 'c', 'e', 'a'])
  })
})

describe('tripSource', () => {
  it('tells the route planner from the optimizer', () => {
    expect(tripSource({ plan: { source: 'route_planner' } })).toBe('planner')
    expect(tripSource({ depot_id: 'd1', plan: null })).toBe('optimizer')
    expect(tripSource({})).toBe('other')
  })
})
