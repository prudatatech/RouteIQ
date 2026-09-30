import { describe, expect, it } from 'vitest'
import {
  BEFORE_COLOR, ROUTE_COLORS, buildMapContent, engineInfo, geometryKey, plansFromReorder, plansFromResult, routeColor, unassignedTitle, waypointsOf,
  type PlanNode, type ServerRoute,
} from './plan'

const node = (seq: number, lat: number, lng: number, extra: Partial<PlanNode> = {}): PlanNode => ({
  kind: 'drop', seq, shipment_id: `s${seq}`, delivery_point_id: `dp${seq}`, tracking_id: `T${seq}`, label: `Stop ${seq}`, lat, lng, ...extra,
})

const DEPOT = { lat: 21.14, lng: 79.08 }

const serverRoutes: ServerRoute[] = [
  {
    id: 'r1', vehicle_id: 'v1', total_distance_km: 40, total_duration_minutes: 90,
    plan: [node(1, 21.2, 79.1), node(2, 21.4, 79.1)],
    before: { plan: [node(1, 21.4, 79.1, { shipment_id: 's2' }), node(2, 21.2, 79.1, { shipment_id: 's1' })], total_distance_km: 55, total_duration_minutes: 110 },
    saved_km: 15, saved_minutes: 20,
  },
  { id: 'r2', vehicle_id: 'v2', plan: [node(1, 21.0, 79.0)], before: null },
  { id: 'r3', vehicle_id: 'v3', plan: [] },
]

describe('engineInfo', () => {
  it('names each engine plainly, and warns when distances are estimates', () => {
    expect(engineInfo('ml-service')?.title).toBe('ML service')
    expect(engineInfo('fallback-road-matrix', 'mapbox')?.detail).toContain('Mapbox')
    expect(engineInfo('fallback-road-matrix', 'tomtom')?.detail).toContain('TomTom')
    expect(engineInfo('fallback-estimated')).toMatchObject({ tone: 'warning', title: 'Built-in solver, estimated distances' })
  })

  it('says nothing for a result from before engines were reported', () => {
    expect(engineInfo(undefined)).toBeNull()
  })
})

describe('unassignedTitle', () => {
  it('gives each reason a short name and copes with an unknown one', () => {
    expect(unassignedTitle('exceeds_vehicle_capacity')).toBe('Too heavy for any vehicle')
    expect(unassignedTitle('fleet_capacity_full')).toBe('Vehicles are full')
    expect(unassignedTitle('nonsense' as never)).toBe('Not planned')
  })
})

describe('routeColor', () => {
  it('gives neighbouring vehicles different colours and wraps around', () => {
    expect(routeColor(0)).not.toBe(routeColor(1))
    expect(routeColor(ROUTE_COLORS.length)).toBe(routeColor(0))
    expect(new Set(ROUTE_COLORS).size).toBe(ROUTE_COLORS.length)
    expect(ROUTE_COLORS).not.toContain(BEFORE_COLOR)
  })
})

describe('plansFromResult', () => {
  const plans = plansFromResult(serverRoutes, DEPOT, id => `Truck ${id}`)

  it('makes a plan for each route that has stops', () => {
    expect(plans.map(p => p.key)).toEqual(['r1', 'r2'])
    expect(plans[0]).toMatchObject({ label: 'Truck v1', closed: true, origin: DEPOT, savedKm: 15, savedMin: 20, beforeKm: 55 })
    expect(plans[1].before).toBeNull()
  })

  it('colours each vehicle differently', () => {
    expect(plans[0].color).not.toBe(plans[1].color)
  })

  it('handles an answer with no routes', () => {
    expect(plansFromResult(undefined, null, () => '')).toEqual([])
  })
})

describe('waypointsOf', () => {
  const [plan] = plansFromResult(serverRoutes, DEPOT, () => 'v')

  it('goes out from the depot and back for a round trip', () => {
    const w = waypointsOf(plan, 'after')
    expect(w[0]).toEqual(DEPOT)
    expect(w[w.length - 1]).toEqual(DEPOT)
    expect(w).toHaveLength(4)
  })

  it('follows the booked order for before', () => {
    expect(waypointsOf(plan, 'before').map(p => p.lat)).toEqual([21.14, 21.4, 21.2, 21.14])
  })

  it('does not come back for an open route', () => {
    const w = waypointsOf({ ...plan, closed: false }, 'after')
    expect(w).toHaveLength(3)
  })
})

describe('buildMapContent', () => {
  const plans = plansFromResult(serverRoutes, DEPOT, () => 'v')

  it('draws the old order muted and dashed under the new one, bold and coloured', () => {
    const { lines } = buildMapContent({ plans, depot: DEPOT, mode: 'both' })
    const before = lines.find(l => l.id === 'r1-before')!
    const after = lines.find(l => l.id === 'r1-after')!
    expect(before).toMatchObject({ dashed: true, color: BEFORE_COLOR })
    expect(after).toMatchObject({ color: plans[0].color })
    expect(after.dashed).toBeFalsy()
    expect(after.width!).toBeGreaterThan(before.width!)
    expect(lines.indexOf(before)).toBeLessThan(lines.indexOf(after))
  })

  it('has no old line for a route without a booked order', () => {
    const { lines } = buildMapContent({ plans, depot: DEPOT, mode: 'both' })
    expect(lines.map(l => l.id)).toEqual(['r1-before', 'r1-after', 'r2-after'])
  })

  it('shows only the order asked for', () => {
    expect(buildMapContent({ plans, depot: DEPOT, mode: 'after' }).lines.every(l => l.id.endsWith('-after'))).toBe(true)
    expect(buildMapContent({ plans, depot: DEPOT, mode: 'before' }).lines.map(l => l.id)).toEqual(['r1-before'])
  })

  it('numbers the stops of each route from 1 in its own colour', () => {
    const { stops } = buildMapContent({ plans, depot: DEPOT, mode: 'after' })
    expect(stops.filter(s => s.id.startsWith('r1-')).map(s => s.sequence)).toEqual([1, 2])
    expect(stops.find(s => s.id.startsWith('r2-'))?.color).toBe(plans[1].color)
    expect(new Set(stops.map(s => s.id)).size).toBe(stops.length)
  })

  it('numbers by the booked order, in grey, while that order is shown', () => {
    const { stops } = buildMapContent({ plans, depot: DEPOT, mode: 'before' })
    const r1 = stops.filter(s => s.id.startsWith('r1-'))
    expect(r1.map(s => s.position.lat)).toEqual([21.4, 21.2])
    expect(r1.every(s => s.color === BEFORE_COLOR)).toBe(true)
  })

  it('fades the routes that are not in focus', () => {
    const { lines } = buildMapContent({ plans, depot: DEPOT, mode: 'after', focusKey: 'r1' })
    expect(lines.find(l => l.id === 'r1-after')!.opacity).toBe(1)
    expect(lines.find(l => l.id === 'r2-after')!.opacity).toBeLessThan(0.5)
  })

  it('uses road geometry where there is some and straight lines otherwise', () => {
    const road: [number, number][] = [[79.08, 21.14], [79.09, 21.15], [79.1, 21.2]]
    const geometry = new Map([[geometryKey(plans[0], 'after'), road]])
    const { lines } = buildMapContent({ plans, depot: DEPOT, mode: 'both', geometry })
    expect(lines.find(l => l.id === 'r1-after')!.coordinates).toBe(road)
    expect(lines.find(l => l.id === 'r1-before')!.coordinates).toHaveLength(4)
  })

  it('marks the depot, and leaves it out when there is none', () => {
    expect(buildMapContent({ plans, depot: DEPOT, mode: 'after' }).points).toEqual([expect.objectContaining({ id: 'depot', kind: 'hub' })])
    expect(buildMapContent({ plans, depot: null, mode: 'after' }).points).toEqual([])
  })
})

describe('plansFromReorder', () => {
  const current = [
    { id: 'a', latitude: 21.6, longitude: 79.1, name: 'A' },
    { id: 'b', latitude: 21.2, longitude: 79.1, name: 'B' },
    { id: 'c', latitude: 21.4, longitude: 79.1, name: 'C' },
  ]
  const args = { key: 'route-1', label: 'MH12', vehicleId: 'v', origin: DEPOT, current, newSequence: ['b', 'c', 'a'], savedMin: 25 }

  it('draws the current order as before and the suggestion as after', () => {
    const plan = plansFromReorder(args)!
    expect(plan.before!.map(n => n.delivery_point_id)).toEqual(['a', 'b', 'c'])
    expect(plan.after.map(n => n.delivery_point_id)).toEqual(['b', 'c', 'a'])
    expect(plan.after.map(n => n.seq)).toEqual([1, 2, 3])
    expect(plan.closed).toBe(false)
    expect(plan.savedMin).toBe(25)
  })

  it('keeps stops the suggestion leaves out, at the end, and ignores ids it does not know', () => {
    const plan = plansFromReorder({ ...args, newSequence: ['c', 'zzz'] })!
    expect(plan.after.map(n => n.delivery_point_id)).toEqual(['c', 'a', 'b'])
  })

  it('drops stops without a location, and gives nothing when none is left', () => {
    const plan = plansFromReorder({ ...args, current: [{ id: 'a', latitude: null, longitude: null }, ...current.slice(1)], newSequence: [] })!
    expect(plan.after.map(n => n.delivery_point_id)).toEqual(['b', 'c'])
    expect(plansFromReorder({ ...args, current: [], newSequence: [] })).toBeNull()
  })
})
