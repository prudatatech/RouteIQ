import { describe, expect, it } from 'vitest'
import type { TrackPoint } from './format'
import {
  SPEED_BUCKETS, TRACK_SECONDS_PER_SECOND, advanceClock, comparePlan, downsampleTrack, effectiveSpeeds, findStoppages,
  haversineKm, indexAt, interpolateAt, speedBucket, speedRuns, timeOf, trackTotals,
} from './replay'

const T0 = Date.parse('2026-09-29T08:00:00Z')

/** A point `min` minutes after 8:00, `km` kilometres east of 21N 79E (about 103.6 km per degree of longitude there). */
function pt(min: number, eastKm: number, speed: number | null = null, northKm = 0): TrackPoint {
  return {
    lat: 21 + northKm / 110.57,
    lng: 79 + eastKm / (111.32 * Math.cos((21 * Math.PI) / 180)),
    at: new Date(T0 + min * 60_000).toISOString(),
    speed_kmph: speed,
    heading: null,
    accuracy: null,
  }
}

describe('downsampleTrack', () => {
  it('returns a short track untouched', () => {
    const points = [pt(0, 0), pt(1, 1), pt(2, 2)]
    expect(downsampleTrack(points, 10)).toEqual(points)
  })

  it('never returns more than the limit, and keeps both ends', () => {
    const points = Array.from({ length: 3000 }, (_, i) => pt(i, i * 0.01, null, Math.sin(i / 40)))
    const thin = downsampleTrack(points, 300)
    expect(thin.length).toBeLessThanOrEqual(300)
    expect(thin[0]).toBe(points[0])
    expect(thin[thin.length - 1]).toBe(points[points.length - 1])
    const times = thin.map(timeOf)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('keeps the corner of an L-shaped path when thinning a straight-line-heavy track', () => {
    const east = Array.from({ length: 200 }, (_, i) => pt(i, i * 0.1))
    const north = Array.from({ length: 200 }, (_, i) => pt(200 + i, 19.9, null, (i + 1) * 0.1))
    const points = [...east, ...north]
    const thin = downsampleTrack(points, 5)
    expect(thin).toContain(east[east.length - 1])
  })
})

describe('speedBucket', () => {
  it.each([
    [0, 'stopped'], [4.9, 'stopped'], [5, 'slow'], [24, 'slow'], [25, 'moderate'],
    [44, 'moderate'], [45, 'fast'], [64, 'fast'], [65, 'very-fast'], [140, 'very-fast'],
  ])('%s km/h is %s', (kmph, id) => {
    expect(speedBucket(kmph).id).toBe(id)
  })

  it('treats a missing or bad speed as stopped', () => {
    expect(speedBucket(null).id).toBe('stopped')
    expect(speedBucket(undefined).id).toBe('stopped')
    expect(speedBucket(NaN).id).toBe('stopped')
    expect(speedBucket(-3).id).toBe('stopped')
  })

  it('has buckets in rising order with a colour each', () => {
    expect(SPEED_BUCKETS.map(b => b.min)).toEqual([...SPEED_BUCKETS.map(b => b.min)].sort((a, b) => a - b))
    expect(new Set(SPEED_BUCKETS.map(b => b.color)).size).toBe(SPEED_BUCKETS.length)
  })
})

describe('effectiveSpeeds and speedRuns', () => {
  it('uses the reported speed and works out the rest from distance over time', () => {
    // 10 km in 10 minutes = 60 km/h
    const points = [pt(0, 0, 0), pt(10, 10, null), pt(20, 10.5, 33)]
    const speeds = effectiveSpeeds(points)
    expect(speeds[0]).toBe(0)
    expect(speeds[1]).toBeCloseTo(60, 0)
    expect(speeds[2]).toBe(33)
  })

  it('joins neighbouring segments of one bucket into a run, sharing end points', () => {
    const points = [pt(0, 0, 50), pt(1, 1, 50), pt(2, 2, 50), pt(3, 2.01, 1), pt(4, 2.02, 1), pt(5, 3, 70)]
    const runs = speedRuns(points, effectiveSpeeds(points))
    expect(runs.map(r => r.bucket.id)).toEqual(['fast', 'stopped', 'very-fast'])
    expect(runs[0].coordinates).toHaveLength(3)
    // A run starts where the last one ended
    expect(runs[1].coordinates[0]).toEqual(runs[0].coordinates[runs[0].coordinates.length - 1])
  })
})

describe('interpolateAt', () => {
  const points = [pt(0, 0, 0), pt(10, 10, 60), pt(20, 10, 0)]
  const times = points.map(timeOf)
  const speeds = effectiveSpeeds(points)

  it('finds the last fix at or before a time', () => {
    expect(indexAt(times, times[0] - 1)).toBe(0)
    expect(indexAt(times, times[1])).toBe(1)
    expect(indexAt(times, times[1] + 1)).toBe(1)
    expect(indexAt(times, times[2] + 999)).toBe(2)
  })

  it('is halfway along at the halfway time, heading east, at the mid speed', () => {
    const at = interpolateAt(points, times, speeds, T0 + 5 * 60_000)!
    expect(haversineKm(at, points[0])).toBeCloseTo(5, 1)
    expect(at.heading).toBeCloseTo(90, 0)
    expect(at.speedKmph).toBeCloseTo(30, 5)
    expect(at.index).toBe(0)
  })

  it('sits on the fix at a fix time and stays put in a stop', () => {
    const atFix = interpolateAt(points, times, speeds, times[1])!
    expect(atFix.lat).toBeCloseTo(points[1].lat, 8)
    const stopped = interpolateAt(points, times, speeds, T0 + 15 * 60_000)!
    expect(stopped.lng).toBeCloseTo(points[1].lng, 8)
  })

  it('stays at the ends outside the track, and has nothing for an empty one', () => {
    expect(interpolateAt(points, times, speeds, T0 - 1e6)!.lng).toBe(points[0].lng)
    expect(interpolateAt(points, times, speeds, T0 + 1e9)!.lng).toBe(points[2].lng)
    expect(interpolateAt([], [], [], T0)).toBeNull()
  })
})

describe('advanceClock', () => {
  const end = T0 + 3_600_000

  it('moves a minute of trip per second of watching at 1x', () => {
    const step = advanceClock(T0, 1000, 1, end)
    expect(step).toEqual({ time: T0 + TRACK_SECONDS_PER_SECOND * 1000, ended: false })
  })

  it('goes faster with the multiplier', () => {
    expect(advanceClock(T0, 1000, 10, end).time - T0).toBe(10 * TRACK_SECONDS_PER_SECOND * 1000)
  })

  it('stops at the end and says so', () => {
    expect(advanceClock(end - 1000, 1000, 30, end)).toEqual({ time: end, ended: true })
  })
})

describe('trackTotals', () => {
  it('counts distance, driving time and stopped time', () => {
    // 30 min driving 30 km, 30 min parked, 30 min driving 30 km
    const drive1 = [0, 5, 10, 15, 20, 25, 30].map(m => pt(m, m))
    const drive2 = [65, 70, 75, 80, 85, 90].map(m => pt(m, m - 30))
    const points = [...drive1, pt(60, 30), ...drive2]
    const t = trackTotals(points)
    expect(t.distanceKm).toBeCloseTo(60, 0)
    expect(t.spanMinutes).toBeCloseTo(90, 5)
    // The 30 minute gap while parked is more than 10 minutes so it is not driving
    expect(t.drivingMinutes).toBeCloseTo(60, 5)
    expect(t.stoppedMinutes).toBeCloseTo(30, 5)
    expect(t.averageMovingKmph).toBeCloseTo(60, 0)
  })

  it('handles a track with no movement or one point', () => {
    expect(trackTotals([pt(0, 0)]).distanceKm).toBe(0)
    expect(trackTotals([pt(0, 0), pt(5, 0)]).averageMovingKmph).toBeNull()
  })

  it('reports the top speed', () => {
    expect(trackTotals([pt(0, 0, 10), pt(1, 1, 88), pt(2, 2, 40)]).maxSpeedKmph).toBe(88)
  })
})

describe('findStoppages', () => {
  it('finds a stop at least as long as asked, with its start, end and length', () => {
    const points = [pt(0, 0), pt(5, 5), pt(10, 10), pt(12, 10.01), pt(20, 10.02), pt(35, 10.0), pt(40, 15)]
    const stops = findStoppages(points, 15)
    expect(stops).toHaveLength(1)
    expect(stops[0].kind).toBe('stopped')
    expect(stops[0].minutes).toBeCloseTo(25, 5)
    expect(stops[0].startMs).toBe(T0 + 10 * 60_000)
    expect(stops[0].endMs).toBe(T0 + 35 * 60_000)
    expect(findStoppages(points, 30)).toHaveLength(0)
  })

  it('counts a device that went quiet while the vehicle stayed put', () => {
    const points = [pt(0, 0), pt(5, 5), pt(6, 5.001), pt(66, 5.001), pt(70, 9)]
    const stops = findStoppages(points, 30)
    expect(stops).toHaveLength(1)
    // From the first fix inside the radius (minute 5) to the last (minute 66)
    expect(stops[0].minutes).toBeCloseTo(61, 5)
  })

  it('reports a long silence between two different places as lost signal, not a stop', () => {
    const points = [pt(0, 0), pt(5, 5), pt(50, 60), pt(55, 65)]
    const stops = findStoppages(points, 20)
    expect(stops).toHaveLength(1)
    expect(stops[0].kind).toBe('no_signal')
    expect(stops[0].minutes).toBeCloseTo(45, 5)
    expect(stops[0].toLng).toBe(points[2].lng)
  })

  it('finds nothing on a moving track', () => {
    const points = Array.from({ length: 30 }, (_, i) => pt(i, i))
    expect(findStoppages(points, 5)).toEqual([])
  })
})

describe('comparePlan', () => {
  // Planned: a straight road east for 20 km. Driven: the same, with a 3 km detour north in the middle
  const plan = [pt(0, 0), pt(1, 20)]
  const driven = [pt(0, 0), pt(10, 8), pt(20, 10, null, 3), pt(30, 12), pt(40, 20)]

  it('gives the extra distance and how far it strayed', () => {
    const c = comparePlan(driven, plan, 20, 26)
    expect(c.plannedKm).toBe(20)
    expect(c.deviationKm).toBe(6)
    expect(c.maxOffRouteKm).toBeCloseTo(3, 1)
    expect(c.offRouteShare).toBeGreaterThan(0)
    expect(c.offRouteShare).toBeLessThan(1)
  })

  it('has no deviation figure without a planned distance', () => {
    const c = comparePlan(driven, plan, null, 26)
    expect(c.plannedKm).toBeNull()
    expect(c.deviationKm).toBeNull()
    expect(c.maxOffRouteKm).toBeCloseTo(3, 1)
  })

  it('is on the route when it stays on it', () => {
    const c = comparePlan([pt(0, 0), pt(5, 10), pt(10, 20)], plan, 20, 20)
    expect(c.maxOffRouteKm).toBeLessThan(0.05)
    expect(c.offRouteShare).toBe(0)
    expect(c.deviationKm).toBe(0)
  })
})
