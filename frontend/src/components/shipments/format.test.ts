import { describe, expect, it } from 'vitest'
import {
  ACTIVE_SHIPMENT_STATUSES, SHIPMENT_STATUSES, destinationOf, plateOf, isActiveShipmentStatus, pickupDateOf, pickupPlace, shipmentStatusLabel,
} from './format'

describe('shipment statuses', () => {
  it('lists every status the database has, and counts the unfinished ones as active', () => {
    expect([...SHIPMENT_STATUSES].sort()).toEqual([
      'assigned', 'at_hub', 'cancelled', 'created', 'delivered', 'exception', 'in_transit', 'lost', 'on_hold', 'out_for_delivery',
      'partially_delivered', 'picked_up', 'returned', 'returning',
    ])
    expect(ACTIVE_SHIPMENT_STATUSES).toEqual([
      'created', 'assigned', 'picked_up', 'in_transit', 'at_hub', 'out_for_delivery', 'on_hold', 'exception', 'partially_delivered', 'returning',
    ])
    expect(isActiveShipmentStatus('at_hub')).toBe(true)
    expect(isActiveShipmentStatus('returned')).toBe(false)
    expect(shipmentStatusLabel('lost')).toBe('Lost')
    expect(isActiveShipmentStatus('assigned')).toBe(true)
    expect(isActiveShipmentStatus('exception')).toBe(true)
    expect(isActiveShipmentStatus('delivered')).toBe(false)
    expect(isActiveShipmentStatus('cancelled')).toBe(false)
  })

  it('names a failed delivery for what happened', () => {
    expect(shipmentStatusLabel('exception')).toBe('Delivery failed')
    expect(shipmentStatusLabel('assigned')).toBe('Vehicle assigned')
  })
})

describe('pickup date', () => {
  it('reads the booking pickup date, then the dispatch date', () => {
    expect(pickupDateOf({ metadata: { pickup_date: '2026-09-30', dispatch_date: '2026-10-01' } })).toBe('2026-09-30')
    expect(pickupDateOf({ metadata: { dispatch_date: '2026-10-01T00:00:00Z' } })).toBe('2026-10-01')
    expect(pickupDateOf({ metadata: {} })).toBeNull()
    expect(pickupDateOf({})).toBeNull()
  })
})

describe('destination', () => {
  it('is the last delivery point', () => {
    const s = { id: '1', tracking_id: 'RTX-1', delivery_points: [{ name: 'first' }, { name: 'final' }] }
    expect(destinationOf(s)?.name).toBe('final')
  })
})

describe('pickup place', () => {
  const vendor = { vendor_profiles: { company_name: 'Acme Logistics' } }
  it('drops the vendor company that a vendor load carries as its origin name', () => {
    expect(pickupPlace({ origin_name: 'Acme Logistics', origin_address: 'Plot 4, Bhiwandi', capacity_bids: vendor }))
      .toEqual({ name: null, address: 'Plot 4, Bhiwandi' })
    expect(pickupPlace({ origin_name: ' acme logistics ', origin_address: 'Plot 4, Bhiwandi', capacity_bids: vendor }).name).toBeNull()
  })
  it('keeps the name when it is a real place, or when the address is only the company again', () => {
    expect(pickupPlace({ origin_name: 'Fab Hostels', origin_address: 'Fab Hostels, Kanakapura Road', capacity_bids: vendor }))
      .toEqual({ name: 'Fab Hostels', address: 'Fab Hostels, Kanakapura Road' })
    expect(pickupPlace({ origin_name: 'Acme Logistics', origin_address: null, capacity_bids: vendor }).name).toBe('Acme Logistics')
  })
  it('passes a shipment with no vendor through', () => {
    expect(pickupPlace({ origin_name: 'Pune hub', origin_address: 'Hadapsar' })).toEqual({ name: 'Pune hub', address: 'Hadapsar' })
  })
})

describe('plateOf', () => {
  const shipment = (stops: { status?: string; trip?: string }[]) => ({
    delivery_points: [{ route_stops: stops.map(st => ({ status: st.status ?? 'pending', routes: { status: st.trip ?? 'planned', vehicles: { plate_number: 'MH04E2E0001' } } })) }],
  }) as never

  it('shows the plate of a live stop on a live trip', () => {
    expect(plateOf(shipment([{}]))).toBe('MH04E2E0001')
  })

  it('shows no plate once the stop or the trip was cancelled (taken off its vehicle)', () => {
    expect(plateOf(shipment([{ status: 'cancelled' }]))).toBeNull()
    expect(plateOf(shipment([{ trip: 'cancelled' }]))).toBeNull()
    expect(plateOf(shipment([{ status: 'cancelled' }, {}]))).toBe('MH04E2E0001')
  })
})
