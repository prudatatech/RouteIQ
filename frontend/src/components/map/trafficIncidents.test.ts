import { describe, expect, it } from 'vitest'
import { INCIDENT_CLUSTER_MAX_ZOOM, clusterIncidents, incidentDelay, incidentSince, incidentViewRequest } from './trafficIncidents'

const inc = (id: string, lat: number, lng: number, severity = 1) => ({ id, lat, lng, severity })

describe('grouping incidents', () => {
  const near = [inc('a', 19.0, 72.9, 1), inc('b', 19.001, 72.901, 3), inc('c', 19.002, 72.902, 2)]

  it('groups incidents that overlap while zoomed out, with the worst severity', () => {
    const { singles, clusters } = clusterIncidents([...near, inc('far', 28.6, 77.2)], 6)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].count).toBe(3)
    expect(clusters[0].severity).toBe(3)
    expect(clusters[0].items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c'])
    expect(singles.map((i) => i.id)).toEqual(['far'])
  })

  it('draws every incident on its own when zoomed in', () => {
    const { singles, clusters } = clusterIncidents(near, INCIDENT_CLUSTER_MAX_ZOOM)
    expect(clusters).toEqual([])
    expect(singles).toHaveLength(3)
  })

  it('never absorbs the selected incident', () => {
    const { singles, clusters } = clusterIncidents(near, 6, 'b')
    expect(singles.map((i) => i.id)).toContain('b')
    expect(clusters.flatMap((c) => c.items.map((i) => i.id))).not.toContain('b')
  })

  it('has nothing to group with fewer than two', () => {
    expect(clusterIncidents([], 3)).toEqual({ singles: [], clusters: [] })
    expect(clusterIncidents([inc('a', 1, 1)], 3).singles).toHaveLength(1)
  })
})

describe('asking for the incidents in view', () => {
  it('rounds the view outwards to a grid so a small pan repeats the request', () => {
    const a = incidentViewRequest([[72.83, 18.91], [73.02, 19.11]], 10)
    const b = incidentViewRequest([[72.8, 18.93], [73.05, 19.13]], 10)
    expect(a.bbox).toBe('72.75,18.75,73.25,19.25')
    expect(b.bbox).toBe(a.bbox)
  })

  it('asks for fresh data only when zoomed in', () => {
    expect(incidentViewRequest([[72, 18], [73, 19]], 8).refresh).toBe(false)
    expect(incidentViewRequest([[72, 18], [73, 19]], 10).refresh).toBe(true)
  })

  it('stays inside the world', () => {
    expect(incidentViewRequest([[-190, -95], [190, 95]], 2).bbox).toBe('-180.00,-90.00,180.00,90.00')
  })
})

describe('incident popup wording', () => {
  const now = Date.parse('2026-09-30T10:00:00Z')

  it('says how long ago an incident started', () => {
    expect(incidentSince('2026-09-30T09:35:00Z', now)).toBe('25 minutes ago')
    expect(incidentSince('2026-09-30T05:00:00Z', now)).toBe('5 hours ago')
  })

  it('says nothing when the start is unknown, unreadable or in the future', () => {
    expect(incidentSince(null, now)).toBeNull()
    expect(incidentSince('soon', now)).toBeNull()
    expect(incidentSince('2026-09-30T11:00:00Z', now)).toBeNull()
  })

  it('shows a delay of a minute or more', () => {
    expect(incidentDelay(1500)).toBe('+25 min')
    expect(incidentDelay(3600)).toBe('+1 h')
    expect(incidentDelay(5400)).toBe('+1 h 30 min')
    expect(incidentDelay(45)).toBeNull()
    expect(incidentDelay(null)).toBeNull()
  })
})
