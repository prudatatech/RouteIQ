import { describe, expect, it } from 'vitest'
import type { AssignableVehicle, AssignSubject } from '../assignVehicle'
import { etaCandidates, nearbyVehicles, widerRadius, NEARBY_VEHICLE_RADIUS_KM } from './nearbyVehicles'

// Pickup in Thane; one degree of latitude is about 111 km.
const pickup = { lat: 19.2, lng: 73.0 }
const subject: AssignSubject = { label: 'New shipment', pickup, weightKg: 500 }
const at = (km: number) => ({ latitude: pickup.lat + km / 111, longitude: pickup.lng })

const vehicle = (id: string, over: Partial<AssignableVehicle> = {}): AssignableVehicle => ({
  id, plate_number: `MH04-${id}`, vehicle_type: 'truck', status: 'available', capacity_kg: 5000, current_load_kg: 0,
  available_capacity_kg: 5000, driver_id: 'd1', ...at(10), ...over,
})

const fleet = [
  vehicle('far', at(200)),
  vehicle('mid', at(100)),
  vehicle('near', at(5)),
  vehicle('edge', at(59)),
  vehicle('nodriver', { ...at(2), driver_id: null }),
  vehicle('nopos', { latitude: null, longitude: null }),
  vehicle('zero', { latitude: 0, longitude: 0 }),
  vehicle('archived', { ...at(1), status: 'archived' }),
]
const ids = (list: { vehicle: { id: string } }[]) => list.map(a => a.vehicle.id)

describe('the vehicles offered near the pickup', () => {
  it('is 60 km by default', () => {
    expect(NEARBY_VEHICLE_RADIUS_KM).toBe(60)
  })

  it('shows only vehicles within the radius, nearest first, blocked ones last with their reason', () => {
    const r = nearbyVehicles(fleet, subject)
    expect(ids(r.nearby)).toEqual(['near', 'edge', 'nodriver'])
    expect(r.nearby[2].blockedReason).toBe('No driver')
    expect(r.nearby.every(a => a.distanceKm !== null && a.distanceKm <= 60)).toBe(true)
    expect(r.fartherCount).toBe(2)
  })

  it('puts vehicles with no known position apart, and leaves out drafts', () => {
    const r = nearbyVehicles(fleet, subject)
    expect(ids(r.unknown).sort()).toEqual(['nopos', 'zero'])
    expect(ids([...r.nearby, ...r.unknown])).not.toContain('archived')
  })

  it('keeps the rules that block a vehicle', () => {
    const blocked = (over: Partial<AssignableVehicle>) => nearbyVehicles([vehicle('x', over)], subject).nearby[0].blockedReason
    expect(blocked({ status: 'maintenance' })).toBe('In maintenance')
    expect(blocked({ status: 'pending_approval' })).toBe('Waiting for approval')
    expect(blocked({ driver_id: null })).toBe('No driver')
    expect(blocked({ available_capacity_kg: 100 })).toMatch(/Only 100 kg free/)
    expect(blocked({})).toBeNull()
  })

  it('widens to 150 km and then to every vehicle with a position', () => {
    expect(ids(nearbyVehicles(fleet, subject, 150).nearby)).toEqual(['near', 'edge', 'mid', 'nodriver'])
    const all = nearbyVehicles(fleet, subject, null)
    expect(ids(all.nearby)).toEqual(['near', 'edge', 'mid', 'far', 'nodriver'])
    expect(all.fartherCount).toBe(0)
    expect(all.unknown).toHaveLength(2)
  })

  it('counts a vehicle exactly at the radius as near', () => {
    const r = nearbyVehicles([vehicle('on', at(60))], subject, 60.5)
    expect(ids(r.nearby)).toEqual(['on'])
  })

  it('keeps the chosen vehicle listed even when it is beyond the radius', () => {
    const r = nearbyVehicles(fleet, subject, 60, { keepId: 'far' })
    expect(ids(r.nearby)).toContain('far')
    expect(r.fartherCount).toBe(1)
  })

  it('has an empty nearby list, and a count to offer, when everything is farther away', () => {
    const r = nearbyVehicles([vehicle('far', at(200)), vehicle('mid', at(100))], subject)
    expect(r.nearby).toEqual([])
    expect(r.fartherCount).toBe(2)
  })

  it('lists every vehicle, with no distance, before a pickup is chosen', () => {
    const r = nearbyVehicles(fleet, { ...subject, pickup: null })
    expect(r.hasPickup).toBe(false)
    expect(r.unknown).toEqual([])
    expect(r.fartherCount).toBe(0)
    expect(ids(r.nearby)).toHaveLength(7)
  })
})

describe('widening the list', () => {
  it('goes 60 km, 150 km, everything, then stops', () => {
    expect(widerRadius(60)).toBe(150)
    expect(widerRadius(150)).toBeNull()
    expect(widerRadius(null)).toBeUndefined()
  })

  it('skips steps that are not wider than a different base radius', () => {
    expect(widerRadius(200, 200)).toBeNull()
    expect(widerRadius(30, 30)).toBe(150)
  })
})

describe('which vehicles get a drive-time lookup', () => {
  it('takes the nearest ones that can be chosen, at most the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => vehicle(`v${i}`, at(i + 1)))
    const r = nearbyVehicles([...many, vehicle('blocked', { ...at(0.5), driver_id: null })], subject)
    const picked = etaCandidates(r.nearby)
    expect(picked).toHaveLength(8)
    expect(ids(picked)[0]).toBe('v0')
    expect(ids(picked)).not.toContain('blocked')
    expect(etaCandidates(r.nearby, 3)).toHaveLength(3)
  })
})
