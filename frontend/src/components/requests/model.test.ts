import { describe, expect, it } from 'vitest'
import type { CustomerBooking } from '@/services/api'
import { customerRow, inboxLink, priceText, primaryLabel, shipmentHref, stageCounts, stageFromOldTab, vendorRow, type VendorRequest } from './model'

const booking = (over: Partial<CustomerBooking> = {}): CustomerBooking => ({
  id: 'b1', customer_id: 'c1', pickup_name: 'Bhiwandi, MH', pickup_address: 'Bhiwandi, Maharashtra', drop_name: 'Pune, MH', drop_address: 'Pune, Maharashtra',
  weight_kg: 800, load_type: 'full', vehicle_type: null, pickup_date: '2026-10-02', quoted_price: 12000, status: 'requested', shipment_id: null,
  tracking_id: null, vehicle_id: null, cancelled_by: null, cancel_reason: null, created_at: '2026-09-30T04:00:00Z',
  customer: { name: 'Asha Rao', phone: '+919800000001', company: null }, ...over,
})

const load = (over: Partial<VendorRequest> = {}): VendorRequest => ({
  id: 'r1234567-0000', vendor_id: 'v1', pickup_location: 'Bhiwandi, MH', pickup_lat: 19.3, pickup_lng: 73.06, drop_location: 'Pune, MH', drop_lat: 18.5, drop_lng: 73.8,
  required_capacity_kg: 400, status: 'pending', created_at: '2026-09-30T04:00:00Z', updated_at: null, assigned_vehicle_id: null, cost: null, cost_per_km: null,
  rejection_reason: null, metadata: { offered_price_inr: 9000, cargo: { noOfPackages: 12 } }, vendor: { company_name: 'Acme Traders', city: 'Thane' }, ...over,
})

describe('customer bookings in the inbox', () => {
  it('walks from accept to assign to open shipment', () => {
    expect(customerRow(booking())).toMatchObject({ stage: 'accept', action: 'accept', priceKind: 'quoted' })
    expect(customerRow(booking({ status: 'confirmed', shipment_id: 's1', tracking_id: 'RTX-1' }))).toMatchObject({ stage: 'accepted', action: 'assign', shipmentId: 's1' })
    expect(customerRow(booking({ status: 'assigned', vehicle_id: 'v9', shipment_id: 's1' }))).toMatchObject({ stage: 'progress', action: 'open' })
    expect(customerRow(booking({ status: 'delivered', shipment_id: 's1' }))).toMatchObject({ stage: 'done' })
    expect(customerRow(booking({ status: 'cancelled' }))).toMatchObject({ stage: 'closed', action: null })
  })

  it('names a failed delivery for what happened', () => {
    expect(customerRow(booking({ status: 'in_transit', shipment_status: 'exception' })).statusLabel).toBe('Delivery failed')
  })
})

describe('vendor loads in the inbox', () => {
  it('needs accepting with a price before a vehicle', () => {
    expect(vendorRow(load())).toMatchObject({ stage: 'accept', action: 'accept', price: 9000, priceKind: 'offered', pieces: 12 })
    expect(vendorRow(load({ status: 'approved', cost: 9500 }))).toMatchObject({ stage: 'accepted', action: 'assign', price: 9500, priceKind: 'agreed' })
    expect(vendorRow(load({ status: 'escalated' }))).toMatchObject({ stage: 'accepted', action: null })
    expect(vendorRow(load({ status: 'assigned', assigned_vehicle_id: 'veh1' }))).toMatchObject({ stage: 'progress', action: 'open' })
    expect(vendorRow(load({ status: 'rejected' }))).toMatchObject({ stage: 'closed' })
  })

  it('links to the shipment page once a vehicle is on the load', () => {
    expect(shipmentHref(vendorRow(load({ status: 'approved' })))).toBeNull()
    expect(shipmentHref(vendorRow(load({ status: 'assigned', assigned_vehicle_id: 'veh1' })))).toBe('/shipments/r1234567-0000')
    expect(shipmentHref(customerRow(booking({ status: 'confirmed', shipment_id: 's1' })))).toBe('/shipments/s1')
  })
})

describe('words on the row', () => {
  it('says what the price is', () => {
    expect(priceText({ price: 12000, priceKind: 'quoted' })).toContain('quoted')
    expect(priceText({ price: null, priceKind: 'none' })).toBe('Not priced')
    expect(primaryLabel({ action: 'accept' })).toBe('Accept and price')
    expect(primaryLabel({ action: 'assign' })).toBe('Assign vehicle')
    expect(primaryLabel({ action: 'open' })).toBe('Open shipment')
  })

  it('counts every stage', () => {
    const rows = [customerRow(booking()), vendorRow(load()), vendorRow(load({ id: 'r2', status: 'approved' }))]
    expect(stageCounts(rows)).toEqual({ accept: 2, accepted: 1, progress: 0, done: 0, closed: 0, all: 3 })
  })
})

describe('old links land on the right filter', () => {
  it('maps old tabs and keeps ?open=', () => {
    expect(stageFromOldTab('customer', 'active')).toBe('progress')
    expect(stageFromOldTab('vendor', 'assigned')).toBe('progress')
    expect(stageFromOldTab('vendor', 'nonsense')).toBeNull()
    expect(inboxLink('vendor', '?open=abc')).toBe('/requests?source=vendor&open=abc')
    expect(inboxLink('customer', '?tab=cancelled&q=asha')).toBe('/requests?source=customer&tab=closed&q=asha')
    expect(inboxLink('customer', '')).toBe('/requests?source=customer')
  })
})
