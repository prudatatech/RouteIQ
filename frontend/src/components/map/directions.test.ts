import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()
const get = vi.fn()
vi.mock('@/services/api', () => ({ api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } }))

import { directionsAvailable, fetchDrivingRoute, resetRoutingStatus, fetchFreeFlowSeconds, fetchTrackedRoute, parseDirectionsResponse } from './directions'

const line: [number, number][] = [[77, 28], [77.1, 28], [77.2, 28], [77.3, 28], [77.4, 28]]

const answer = (over: Record<string, unknown> = {}) => ({
  data: {
    coordinates: line, distance_meters: 12000, duration_seconds: 900,
    congestion: ['low', 'heavy', 'severe', 'unknown'], segment_meters: [1000, 2000, 3000, 4000], segment_seconds: [100, 200, 300, 400],
    ...over,
  },
})
const httpError = (status: number) => Object.assign(new Error(`status ${status}`), { response: { status } })

describe('backend directions response', () => {
  it('maps the snake_case answer to a DrivingRoute', () => {
    const route = parseDirectionsResponse(answer().data)
    expect(route).toEqual({
      coordinates: line, durationSeconds: 900, distanceMeters: 12000,
      congestion: ['low', 'heavy', 'severe', 'unknown'], segmentMeters: [1000, 2000, 3000, 4000], segmentSeconds: [100, 200, 300, 400],
    })
  })

  it('leaves congestion empty when the provider sent none, so the route stays one colour', () => {
    const route = parseDirectionsResponse({ coordinates: line, distance_meters: 20, duration_seconds: 10 })
    expect(route!.congestion).toEqual([])
    expect(route!.segmentMeters).toEqual([0, 0, 0, 0])
  })

  it('cuts an annotation longer than the geometry and treats unknown words as unknown', () => {
    const route = parseDirectionsResponse({ coordinates: line, congestion: ['low', 'low', 'low', 'weird', 'heavy', 'heavy'] })
    expect(route!.congestion).toEqual(['low', 'low', 'low', 'unknown'])
  })

  it('returns null when there is no line', () => {
    expect(parseDirectionsResponse({})).toBeNull()
    expect(parseDirectionsResponse(null)).toBeNull()
    expect(parseDirectionsResponse({ coordinates: [[77, 28]] })).toBeNull()
  })
})

describe('fetchDrivingRoute', () => {
  beforeEach(() => { post.mockReset(); get.mockReset(); resetRoutingStatus() })

  it('makes no directions call when the server says routing is off, and asks the status once', async () => {
    get.mockResolvedValue({ data: { available: false } })
    expect(await fetchDrivingRoute([{ lat: 21, lng: 77 }, { lat: 21.1, lng: 77.4 }])).toBeNull()
    expect(await fetchDrivingRoute([{ lat: 22, lng: 77 }, { lat: 22.1, lng: 77.4 }])).toBeNull()
    expect(post).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/routing/status')
  })

  it('still asks for directions when the status cannot be read (a driver)', async () => {
    get.mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }))
    post.mockResolvedValue(answer())
    expect(await fetchDrivingRoute([{ lat: 23, lng: 77 }, { lat: 23.1, lng: 77.4 }])).not.toBeNull()
  })

  it('does not depend on a browser map token', () => {
    expect(directionsAvailable).toBe(true)
  })

  it('asks the backend with the waypoints and traffic on', async () => {
    post.mockResolvedValue(answer())
    const route = await fetchDrivingRoute([{ lat: 28, lng: 77 }, { lat: 28.1, lng: 77.4 }])
    expect(post).toHaveBeenCalledWith('/routing/directions', { waypoints: [{ lat: 28, lng: 77 }, { lat: 28.1, lng: 77.4 }], traffic: true })
    expect(route!.durationSeconds).toBe(900)
  })

  it('needs two waypoints and sends at most 25', async () => {
    expect(await fetchDrivingRoute([{ lat: 1, lng: 1 }])).toBeNull()
    expect(post).not.toHaveBeenCalled()
    post.mockResolvedValue(answer())
    await fetchDrivingRoute(Array.from({ length: 30 }, (_, i) => ({ lat: 20 + i * 0.01, lng: 70 })))
    expect(post.mock.calls[0][1].waypoints).toHaveLength(25)
  })

  it('shares one request between concurrent callers and answers repeats from memory', async () => {
    post.mockResolvedValue(answer())
    const wp = [{ lat: 21, lng: 71 }, { lat: 21.5, lng: 71.5 }]
    const [a, b] = await Promise.all([fetchDrivingRoute(wp), fetchDrivingRoute(wp)])
    expect(a).toBe(b)
    await fetchDrivingRoute(wp)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('gives null, not an error, when the server has no provider (503) or no route (404)', async () => {
    post.mockRejectedValueOnce(httpError(503))
    expect(await fetchDrivingRoute([{ lat: 22, lng: 72 }, { lat: 22.5, lng: 72.5 }])).toBeNull()
    post.mockRejectedValueOnce(httpError(404))
    expect(await fetchDrivingRoute([{ lat: 23, lng: 73 }, { lat: 23.5, lng: 73.5 }])).toBeNull()
  })

  it('rejects on other failures and does not cache them', async () => {
    const wp = [{ lat: 24, lng: 74 }, { lat: 24.5, lng: 74.5 }]
    post.mockRejectedValueOnce(httpError(502))
    await expect(fetchDrivingRoute(wp)).rejects.toBeDefined()
    post.mockResolvedValue(answer())
    expect(await fetchDrivingRoute(wp)).not.toBeNull()
  })

  it('a caller that aborts stops waiting without cancelling the shared request', async () => {
    let resolve!: (v: unknown) => void
    post.mockReturnValue(new Promise(r => { resolve = r }))
    const wp = [{ lat: 25, lng: 75 }, { lat: 25.5, lng: 75.5 }]
    const ctrl = new AbortController()
    const aborted = fetchDrivingRoute(wp, ctrl.signal)
    const other = fetchDrivingRoute(wp)
    ctrl.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    resolve(answer())
    expect(await other).not.toBeNull()
    expect(post).toHaveBeenCalledTimes(1)
  })
})

describe('fetchFreeFlowSeconds', () => {
  beforeEach(() => { post.mockReset(); resetRoutingStatus() })

  it('asks for the route without traffic and returns its duration, cached at a coarse key', async () => {
    post.mockResolvedValue(answer({ duration_seconds: 700 }))
    expect(await fetchFreeFlowSeconds([{ lat: 26.001, lng: 76 }, { lat: 26.5, lng: 76.5 }])).toBe(700)
    expect(post.mock.calls[0][1].traffic).toBe(false)
    expect(await fetchFreeFlowSeconds([{ lat: 26.002, lng: 76.001 }, { lat: 26.501, lng: 76.5 }])).toBe(700)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('is null when the server has no provider', async () => {
    post.mockRejectedValue(httpError(503))
    expect(await fetchFreeFlowSeconds([{ lat: 27, lng: 77 }, { lat: 27.5, lng: 77.5 }])).toBeNull()
  })
})

describe('fetchTrackedRoute', () => {
  beforeEach(() => { get.mockReset() })

  it('asks the public tracking route by id and is cached per position key', async () => {
    get.mockResolvedValue(answer())
    const route = await fetchTrackedRoute('CM-ABCD1234', 'k1')
    expect(get).toHaveBeenCalledWith('/shipments/track/CM-ABCD1234/route')
    expect(route!.coordinates).toHaveLength(5)
    await fetchTrackedRoute('CM-ABCD1234', 'k1')
    expect(get).toHaveBeenCalledTimes(1)
    await fetchTrackedRoute('CM-ABCD1234', 'k2')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('is null when there is no route to show', async () => {
    get.mockRejectedValue(httpError(404))
    expect(await fetchTrackedRoute('RTX-NONE', 'k')).toBeNull()
  })
})
