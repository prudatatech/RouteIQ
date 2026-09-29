import { describe, expect, it } from 'vitest'
import {
  ACTIVE_SHIPMENT_STATUSES, SHIPMENT_STATUSES, destinationOf, formatDate, isActiveShipmentStatus, pickupDateOf, shipmentStatusLabel,
} from './format'

describe('shipment statuses', () => {
  it('lists every status the database has, and counts the unfinished ones as active', () => {
    expect([...SHIPMENT_STATUSES].sort()).toEqual(['assigned', 'cancelled', 'created', 'delivered', 'exception', 'in_transit', 'picked_up'])
    expect(ACTIVE_SHIPMENT_STATUSES).toEqual(['created', 'assigned', 'picked_up', 'in_transit', 'exception'])
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

  it('shows a bare date as the same India calendar day', () => {
    expect(formatDate('2026-09-30')).toContain('30')
    expect(formatDate('2026-09-30')).toContain('2026')
  })
})

describe('destination', () => {
  it('is the last delivery point', () => {
    const s = { id: '1', tracking_id: 'RTX-1', delivery_points: [{ name: 'first' }, { name: 'final' }] }
    expect(destinationOf(s)?.name).toBe('final')
  })
})
