import { describe, expect, it } from 'vitest'
import { CLUSTER_MAX_ZOOM, CLUSTER_THRESHOLD, clusterVehicles } from './cluster'
import type { MapVehicle } from './types'

const vehicle = (i: number, lat: number, lng: number): MapVehicle => ({
  id: `v${i}`, position: { lat, lng }, status: 'on_route', label: `MH01AB${i}`,
})

/** Many vehicles packed into a small area, so they fall into the same grid cell at low zoom. */
const crowd = (n: number) => Array.from({ length: n }, (_, i) => vehicle(i, 19.07 + i * 0.0001, 72.87 + i * 0.0001))

describe('clusterVehicles', () => {
  it('leaves small fleets alone', () => {
    const result = clusterVehicles(crowd(CLUSTER_THRESHOLD), 8)
    expect(result.clusters).toHaveLength(0)
    expect(result.singles).toHaveLength(CLUSTER_THRESHOLD)
  })

  it('groups a large fleet when zoomed out', () => {
    const result = clusterVehicles(crowd(CLUSTER_THRESHOLD + 10), 8)
    expect(result.clusters.length).toBeGreaterThan(0)
    const total = result.clusters.reduce((n, c) => n + c.count, 0) + result.singles.length
    expect(total).toBe(CLUSTER_THRESHOLD + 10)
  })

  it('shows every vehicle individually once zoomed in', () => {
    const result = clusterVehicles(crowd(CLUSTER_THRESHOLD + 10), CLUSTER_MAX_ZOOM)
    expect(result.clusters).toHaveLength(0)
    expect(result.singles).toHaveLength(CLUSTER_THRESHOLD + 10)
  })

  it('never absorbs the selected vehicle', () => {
    const result = clusterVehicles(crowd(CLUSTER_THRESHOLD + 10), 8, 'v3')
    expect(result.singles.some(v => v.id === 'v3')).toBe(true)
    expect(result.clusters.reduce((n, c) => n + c.count, 0) + result.singles.length).toBe(CLUSTER_THRESHOLD + 10)
  })
})
