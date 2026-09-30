import { describe, expect, it } from 'vitest'
import { assessVehicle, assessVehicles, blockedReasonOf, documentWarnings, type AssignableVehicle, type AssignSubject } from './assignVehicle'

const vehicle = (over: Partial<AssignableVehicle> = {}): AssignableVehicle => ({
  id: 'v1', plate_number: 'MH04AB1234', vehicle_type: 'truck', status: 'available', capacity_kg: 5000, current_load_kg: 1000,
  available_capacity_kg: 4000, driver_id: 'd1', driver_name: 'Ravi', latitude: 19.3, longitude: 73.06, ...over,
})
const subject: AssignSubject = { label: 'RTX-1', pickup: { lat: 19.3, lng: 73.06 }, weightKg: 1500 }
const NOW = Date.parse('2026-09-30T12:00:00+05:30')

describe('which vehicles are blocked', () => {
  it('lets a vehicle with a driver, in service and with room, through', () => {
    expect(blockedReasonOf(vehicle(), 1500)).toBeNull()
  })

  it('blocks a vehicle with no driver', () => {
    expect(blockedReasonOf(vehicle({ driver_id: null }), 100)).toBe('No driver')
  })

  it.each([
    ['maintenance', 'In maintenance'],
    ['archived', 'Archived'],
    ['pending_approval', 'Waiting for approval'],
  ])('blocks a vehicle that is %s', (status, reason) => {
    expect(blockedReasonOf(vehicle({ status }), 100)).toBe(reason)
  })

  it('calls a vehicle staff rejected by that name', () => {
    expect(blockedReasonOf(vehicle({ status: 'archived', review_decision: 'rejected' }), 100)).toBe('Rejected')
  })

  it('blocks a vehicle without room for the goods, and reads free space from capacity when it is not reported', () => {
    expect(blockedReasonOf(vehicle({ available_capacity_kg: 300 }), 1500)).toMatch(/Only 300 kg free/)
    expect(blockedReasonOf(vehicle({ available_capacity_kg: null, capacity_kg: 2000, current_load_kg: 1800 }), 500)).toMatch(/Only 200 kg free/)
    expect(blockedReasonOf(vehicle({ available_capacity_kg: null, capacity_kg: null }), 500)).toBeNull()
  })
})

describe('document warnings', () => {
  it('flags expired and soon-to-expire papers and ignores the rest', () => {
    const w = documentWarnings(vehicle({ insurance_expiry: '2026-09-01', permit_expiry: '2026-10-10', puc_expiry: '2027-03-01', rc_expiry: null }), NOW)
    expect(w).toEqual(['Insurance expired', 'Permit expires in 11 days'])
  })
})

describe('assessing vehicles', () => {
  it('measures the distance to the pickup only when both positions are known', () => {
    expect(assessVehicle(vehicle({ latitude: 18.52, longitude: 73.85 }), subject, new Map(), NOW).distanceKm).toBeGreaterThan(100)
    expect(assessVehicle(vehicle({ latitude: null, longitude: null }), subject, new Map(), NOW).distanceKm).toBeNull()
    expect(assessVehicle(vehicle(), { ...subject, pickup: null }, new Map(), NOW).distanceKm).toBeNull()
  })

  it('counts open problems and warns about a licence class', () => {
    const a = assessVehicle(vehicle({ driver_dispatch_issues: ['licence_class', 'licence_missing'] }), subject, new Map([['v1', 2]]), NOW)
    expect(a.problems).toBe(2)
    expect(a.warnings).toEqual(["Licence class does not cover this vehicle"])
  })

  it('lists choosable vehicles nearest first, then the blocked ones, and leaves out drafts', () => {
    const list = assessVehicles([
      vehicle({ id: 'far', plate_number: 'B', latitude: 18.52, longitude: 73.85 }),
      vehicle({ id: 'blocked', plate_number: 'A', driver_id: null }),
      vehicle({ id: 'near', plate_number: 'C' }),
      vehicle({ id: 'draft', plate_number: 'TEMP-9F3' }),
    ], subject, new Map(), NOW)
    expect(list.map(a => a.vehicle.id)).toEqual(['near', 'far', 'blocked'])
  })
})
