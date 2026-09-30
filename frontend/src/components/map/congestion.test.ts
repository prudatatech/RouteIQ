import { describe, expect, it } from 'vitest'
import { alignCongestion, congestionFeatures, congestionRuns, normalizeCongestion, summarizeCongestion, type CongestionLevel } from './congestion'
import { parseDrivingRoute } from './directions'

const line: [number, number][] = [[77, 28], [77.1, 28], [77.2, 28], [77.3, 28], [77.4, 28]]

describe('congestion levels', () => {
  it('accepts the levels Mapbox sends and treats anything else as unknown', () => {
    expect(normalizeCongestion('heavy')).toBe('heavy')
    expect(normalizeCongestion('severe')).toBe('severe')
    expect(normalizeCongestion('gridlock')).toBe('unknown')
    expect(normalizeCongestion(undefined)).toBe('unknown')
    expect(normalizeCongestion(3)).toBe('unknown')
  })

  it('gives one level per segment, padding or cutting a list that does not fit', () => {
    expect(alignCongestion(['low', 'heavy'], 3)).toEqual(['low', 'heavy'])
    expect(alignCongestion(['low'], 4)).toEqual(['low', 'unknown', 'unknown'])
    expect(alignCongestion(['low', 'heavy', 'severe', 'low'], 3)).toEqual(['low', 'heavy'])
    expect(alignCongestion(null, 3)).toEqual(['unknown', 'unknown'])
    expect(alignCongestion(['low'], 1)).toEqual([])
    expect(alignCongestion(['low'], 0)).toEqual([])
  })
})

describe('congestion runs', () => {
  it('merges neighbouring segments of the same level and shares the joining point', () => {
    const levels: CongestionLevel[] = ['low', 'low', 'heavy', 'severe']
    const runs = congestionRuns(line, levels)
    expect(runs.map((r) => r.level)).toEqual(['low', 'heavy', 'severe'])
    expect(runs[0].coordinates).toEqual([[77, 28], [77.1, 28], [77.2, 28]])
    // the next run starts where the last one ended, so the line has no gap
    expect(runs[1].coordinates[0]).toEqual(runs[0].coordinates[runs[0].coordinates.length - 1])
    expect(runs[2].coordinates).toEqual([[77.3, 28], [77.4, 28]])
  })

  it('keeps every segment of the line exactly once across the runs', () => {
    const levels: CongestionLevel[] = ['low', 'moderate', 'low', 'moderate']
    const runs = congestionRuns(line, levels)
    expect(runs).toHaveLength(4)
    const segments = runs.reduce((n, r) => n + r.coordinates.length - 1, 0)
    expect(segments).toBe(line.length - 1)
  })

  it('handles lines with nothing to colour', () => {
    expect(congestionRuns([], [])).toEqual([])
    expect(congestionRuns([[77, 28]], [])).toEqual([])
  })

  it('reads missing levels as unknown', () => {
    expect(congestionRuns(line, ['heavy']).map((r) => r.level)).toEqual(['heavy', 'unknown'])
  })

  it('builds GeoJSON features carrying the level', () => {
    const fc = congestionFeatures(line, ['low', 'low', 'heavy', 'heavy'])
    expect(fc.features.map((f) => f.properties)).toEqual([{ level: 'low' }, { level: 'heavy' }])
    expect(fc.features[0].geometry.type).toBe('LineString')
  })
})

describe('congestion summary', () => {
  it('adds up the slow, queuing and stopped distance', () => {
    const s = summarizeCongestion(['low', 'moderate', 'heavy', 'severe', 'unknown'], [1000, 200, 300, 400, 5000])
    expect(s.metres).toEqual({ low: 1000, moderate: 200, heavy: 300, severe: 400 })
    expect(s.slowMetres).toBe(900)
    expect(s.known).toBe(true)
  })

  it('says when there is no traffic data at all', () => {
    expect(summarizeCongestion(['unknown', 'unknown'], [10, 10]).known).toBe(false)
    expect(summarizeCongestion([], undefined)).toMatchObject({ slowMetres: 0, known: false })
  })
})

describe('Mapbox directions response', () => {
  const geometry = { coordinates: line }

  it('joins the per-leg annotations into per-segment arrays', () => {
    const route = parseDrivingRoute({
      routes: [{
        geometry, duration: 900, distance: 12000,
        legs: [
          { annotation: { congestion: ['low', 'heavy'], duration: [100, 200], distance: [1000, 2000] } },
          { annotation: { congestion: ['severe', 'unknown'], duration: [300, 400], distance: [3000, 4000] } },
        ],
      }],
    })
    expect(route).not.toBeNull()
    expect(route!.congestion).toEqual(['low', 'heavy', 'severe', 'unknown'])
    expect(route!.segmentSeconds).toEqual([100, 200, 300, 400])
    expect(route!.segmentMeters).toEqual([1000, 2000, 3000, 4000])
    expect(route!.durationSeconds).toBe(900)
  })

  it('leaves congestion empty when the response has no annotation, so the route stays one colour', () => {
    const route = parseDrivingRoute({ routes: [{ geometry, duration: 10, distance: 20, legs: [{}] }] })
    expect(route!.congestion).toEqual([])
    expect(route!.segmentMeters).toEqual([0, 0, 0, 0])
  })

  it('returns null when no route was found', () => {
    expect(parseDrivingRoute({ routes: [] })).toBeNull()
    expect(parseDrivingRoute({})).toBeNull()
  })

  it('cuts an annotation that is longer than the geometry', () => {
    const route = parseDrivingRoute({
      routes: [{ geometry, duration: 1, distance: 1, legs: [{ annotation: { congestion: ['low', 'low', 'low', 'low', 'heavy', 'heavy'] } }] }],
    })
    expect(route!.congestion).toHaveLength(4)
  })
})
