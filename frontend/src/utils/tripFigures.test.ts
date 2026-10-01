import { describe, expect, it } from 'vitest'
import { distanceWithBasis, tripCarries, tripCode, tripFigures, type TripLike } from './tripFigures'

const trip = (over: Partial<TripLike> = {}): TripLike => ({
  id: '4afb4ec7-1111-4222-8333-444455556666', status: 'completed', total_distance_km: 846.9, total_duration_minutes: 1285,
  started_at: '2026-09-30T08:00:00Z', completed_at: '2026-09-30T11:10:00Z',
  route_stops: [{ sequence: 1, shipment: { id: 's1', tracking_id: 'RTX-1-A' } }], ...over,
})

describe('trip number and what it carries', () => {
  it('numbers a trip TR- and a vendor load CM-', () => {
    expect(tripCode(trip())).toBe('TR-4AFB4EC7')
    expect(tripCode(trip({ is_manifest: true, id: 'abcdef12-0000-4000-8000-000000000000' }))).toBe('CM-ABCDEF12')
  })

  it('lists each shipment or lot once, in stop order', () => {
    const t = trip({
      route_stops: [
        { sequence: 3, shipment: { id: 'c', tracking_id: 'RTX-1-C' } },
        { sequence: 1, shipment: { id: 'a', tracking_id: 'RTX-1-A' } },
        { sequence: 2, shipment: { id: 'a2', tracking_id: 'RTX-1-A' } },
        { sequence: 4, shipment: null },
      ],
    })
    expect(tripCarries(t)).toEqual(['RTX-1-A', 'RTX-1-C'])
    expect(tripCarries(trip({ is_manifest: true, id: 'abcdef12-0000-4000-8000-000000000000' }))).toEqual(['CM-ABCDEF12'])
  })
})

describe('distance and time of a trip', () => {
  it('shows how long a completed trip took, with the planned distance labelled', () => {
    expect(tripFigures(trip())).toEqual({ kind: 'actual', distanceKm: 846.9, durationMinutes: 190, distanceIsPlanned: true })
  })

  it('falls back to the plan, labelled, when the start or finish is not known', () => {
    expect(tripFigures(trip({ started_at: null }))).toEqual({ kind: 'planned', distanceKm: 846.9, durationMinutes: 1285, distanceIsPlanned: true })
    expect(tripFigures(trip({ completed_at: '2026-09-30T07:00:00Z' })).kind).toBe('planned')
  })

  it('shows the plan as the ETA while a trip is open', () => {
    expect(tripFigures(trip({ status: 'active', started_at: '2026-09-30T08:00:00Z', completed_at: null }))).toEqual({ kind: 'planned', distanceKm: 846.9, durationMinutes: 1285, distanceIsPlanned: false })
  })

  it('hides distance and ETA for a cancelled trip with no stops, but not one that had stops', () => {
    expect(tripFigures(trip({ status: 'cancelled', route_stops: [], total_distance_km: 1849.5 }))).toEqual({ kind: 'none' })
    expect(tripFigures(trip({ status: 'cancelled', started_at: null, completed_at: null }))).toMatchObject({ kind: 'planned', distanceIsPlanned: true })
  })

  it('shows nothing when there is nothing to measure', () => {
    expect(tripFigures(trip({ status: 'pending', total_distance_km: 0, total_duration_minutes: 0, route_stops: [] }))).toEqual({ kind: 'none' })
  })
})

describe('distanceWithBasis', () => {
  const km = (n: number) => `${n} km`
  it('says how the distance was worked out', () => {
    expect(distanceWithBasis(289.3, 'actual', km)).toBe('289.3 km')
    expect(distanceWithBasis(289.3, 'planned', km)).toBe('289.3 km (planned)')
    expect(distanceWithBasis(289.3, 'estimated', km)).toBe('289.3 km (straight line)')
  })
  it('shows a dash with no distance or no basis to trust', () => {
    expect(distanceWithBasis(0, 'planned', km)).toBe('—')
    expect(distanceWithBasis(null, 'actual', km)).toBe('—')
    expect(distanceWithBasis(50, 'none', km)).toBe('—')
  })
})
