import { describe, expect, it } from 'vitest'
import type { CongestionLevel } from './congestion'
import { buildLiveEta, describeVsPlan, planStatus } from './liveEta'
import { remainingStops } from './tripStops'

const now = Date.parse('2026-09-30T10:00:00Z')
const base = { durationSeconds: 3600, distanceMeters: 42_100, segmentMeters: [30_000, 2_000, 10_100] }
const mixed: CongestionLevel[] = ['low', 'heavy', 'unknown']

describe('live ETA', () => {
  it('works out arrival, traffic delay and the slow stretch', () => {
    const eta = buildLiveEta({ ...base, congestion: mixed }, 2700, '2026-09-30T10:40:00Z', now)
    expect(eta.arrivalAt.toISOString()).toBe('2026-09-30T11:00:00.000Z')
    expect(eta.remainingMeters).toBe(42_100)
    expect(eta.trafficDelaySeconds).toBe(900)
    expect(eta.freeFlowSeconds).toBe(2700)
    expect(eta.slowMeters).toBe(2000)
    expect(eta.minutesVsPlan).toBe(20)
  })

  it('reports no delay when traffic adds less than a minute or the free-flow time is unknown', () => {
    expect(buildLiveEta({ ...base, congestion: [] }, 3560, null, now).trafficDelaySeconds).toBe(0)
    expect(buildLiveEta({ ...base, congestion: [] }, null, null, now).trafficDelaySeconds).toBe(0)
    // faster than free flow is not a negative delay
    expect(buildLiveEta({ ...base, congestion: [] }, 4000, null, now).trafficDelaySeconds).toBe(0)
  })

  it('has no plan comparison without a usable planned arrival', () => {
    expect(buildLiveEta({ ...base, congestion: [] }, null, null, now).minutesVsPlan).toBeNull()
    expect(buildLiveEta({ ...base, congestion: [] }, null, 'not a date', now).minutesVsPlan).toBeNull()
  })

  it('has no slow-stretch figure when Mapbox has no traffic data', () => {
    expect(buildLiveEta({ ...base, congestion: [] }, null, null, now).slowMeters).toBeNull()
    expect(buildLiveEta({ ...base, congestion: ['unknown', 'unknown', 'unknown'] }, null, null, now).slowMeters).toBeNull()
  })

  it('is ahead of plan when the arrival is before the planned time', () => {
    const eta = buildLiveEta({ ...base, congestion: [] }, null, '2026-09-30T11:30:00Z', now)
    expect(eta.minutesVsPlan).toBe(-30)
    expect(describeVsPlan(eta.minutesVsPlan!)).toBe('30 min ahead of plan')
  })
})

describe('plan status', () => {
  it('is on time within five minutes either way', () => {
    expect(planStatus(0)).toBe('on_time')
    expect(planStatus(5)).toBe('on_time')
    expect(planStatus(-5)).toBe('on_time')
    expect(planStatus(6)).toBe('late')
    expect(planStatus(-6)).toBe('early')
  })

  it('words it plainly', () => {
    expect(describeVsPlan(2)).toBe('On plan')
    expect(describeVsPlan(12)).toBe('12 min behind plan')
    expect(describeVsPlan(75)).toBe('1 h 15 min behind plan')
    expect(describeVsPlan(-120)).toBe('2 h ahead of plan')
  })
})

describe('remaining stops', () => {
  const dp = (lat: number | null, lng: number | null) => ({ latitude: lat, longitude: lng })

  it('keeps pending stops in order with their planned arrival, and skips done ones', () => {
    const stops = remainingStops([
      { sequence: 3, status: 'pending', planned_arrival_at: '2026-09-30T13:00:00Z', delivery_points: dp(19.2, 72.9) },
      { sequence: 1, status: 'completed', delivery_points: dp(19.0, 72.8) },
      { sequence: 2, status: 'pending', delivery_points: [dp(19.1, 72.85)] },
      { sequence: 4, status: 'failed', delivery_points: dp(19.3, 73) },
    ])
    expect(stops.map((s) => s.position)).toEqual([{ lat: 19.1, lng: 72.85 }, { lat: 19.2, lng: 72.9 }])
    expect(stops[1].plannedArrivalAt).toBe('2026-09-30T13:00:00Z')
  })

  it('leaves out stops with no real position instead of guessing', () => {
    expect(remainingStops([
      { sequence: 1, status: 'pending', delivery_points: dp(null, null) },
      { sequence: 2, status: 'pending', delivery_points: dp(0, 0) },
      { sequence: 3, status: 'pending', delivery_points: null },
    ])).toEqual([])
    expect(remainingStops(undefined)).toEqual([])
  })
})
