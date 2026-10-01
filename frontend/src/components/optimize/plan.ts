import type { MapLine, MapPoint, MapRouteStop } from '@/components/map'
import type { Tone } from '@/components/ui/status'

/**
 * What the optimizer returns, and how it is turned into things the map can draw.
 * All of it is plain data in, plain data out, so it is tested without a browser.
 */

export type OptimizerEngine = 'ml-service' | 'fallback-road-matrix' | 'fallback-estimated'
export type UnassignedReason = 'no_vehicle' | 'exceeds_vehicle_capacity' | 'fleet_capacity_full' | 'time_window' | 'no_location'
export type CompareMode = 'after' | 'before' | 'both'

export interface LatLng { lat: number; lng: number }

/** One stop of a plan, as the server reports it. */
export interface PlanNode {
  kind: 'pickup' | 'drop'
  seq: number
  shipment_id: string
  delivery_point_id: string | null
  tracking_id: string | null
  label: string | null
  lat: number
  lng: number
}

export interface UnassignedShipment {
  shipment_id: string
  tracking_id: string | null
  weight_kg: number
  reason: UnassignedReason
  message: string
}

/** A route in the optimizer's answer, with the order chosen and the order the stops were booked in. */
export interface ServerRoute {
  id?: string
  vehicle_id?: string | null
  total_distance_km?: number | null
  total_duration_minutes?: number | null
  plan?: PlanNode[] | null
  before?: { plan: PlanNode[]; total_distance_km: number; total_duration_minutes: number } | null
  saved_km?: number | null
  saved_minutes?: number | null
}

/** One route to draw: where it starts, and the stops before and after optimizing. */
export interface RoutePlan {
  key: string
  vehicleId: string | null
  label: string
  color: string
  origin: LatLng | null
  /** Comes back to the origin (a depot round trip). A reroute from the vehicle's position does not. */
  closed: boolean
  after: PlanNode[]
  before: PlanNode[] | null
  afterKm: number | null
  afterMin: number | null
  beforeKm: number | null
  beforeMin: number | null
  savedKm: number | null
  savedMin: number | null
}

/* ── Colours ────────────────────────────────────────────────────────────── */

/** Distinct on white and for colour-blind viewers (Okabe-Ito based), one per vehicle. */
export const ROUTE_COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#B8860B', '#56B4E9', '#7C3AED', '#0F766E'] as const
/** The order the stops were booked in: muted and dashed. */
export const BEFORE_COLOR = '#71717A'

export const routeColor = (index: number): string => ROUTE_COLORS[index % ROUTE_COLORS.length]

/* ── Wording ────────────────────────────────────────────────────────────── */

export interface EngineInfo {
  title: string
  detail: string
  tone: Tone
}

export function engineInfo(engine: OptimizerEngine | undefined, _matrixSource?: string | null): EngineInfo | null {
  switch (engine) {
    case 'ml-service':
      return { title: 'Planning service', detail: 'Planned by the trip planning service.', tone: 'success' }
    case 'fallback-road-matrix':
      return {
        title: 'Built-in planner, road distances',
        detail: 'The planning service was not reachable, so the trips were planned here using road distances and times.',
        tone: 'info',
      }
    case 'fallback-estimated':
      return {
        title: 'Built-in planner, estimated distances',
        detail: 'The planning service was not reachable and road distances are not available, so distances are estimates. Treat the kilometres as approximate.',
        tone: 'warning',
      }
    default:
      return null
  }
}

const UNASSIGNED_TITLES: Record<UnassignedReason, string> = {
  exceeds_vehicle_capacity: 'Too heavy for any vehicle',
  fleet_capacity_full: 'Vehicles are full',
  no_vehicle: 'No vehicle',
  time_window: 'Time window',
  no_location: 'No location',
}

export const unassignedTitle = (reason: UnassignedReason): string => UNASSIGNED_TITLES[reason] ?? 'Not planned'

/* ── Building plans ─────────────────────────────────────────────────────── */

const validPoint = (p: Partial<LatLng> | null | undefined): p is LatLng =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0)

/** The plans of a fresh optimization, one per saved route. Vehicles keep their colour by position in the answer. */
export function plansFromResult(routes: ServerRoute[] | undefined, depot: LatLng | null, vehicleLabel: (vehicleId: string) => string): RoutePlan[] {
  return (routes ?? []).flatMap((r, i) => {
    if (!r.plan || r.plan.length === 0) return []
    const vehicleId = r.vehicle_id ?? null
    return [{
      key: r.id ?? `route-${i}`,
      vehicleId,
      label: vehicleId ? vehicleLabel(vehicleId) : `Trip ${i + 1}`,
      color: routeColor(i),
      origin: depot,
      closed: true,
      after: r.plan,
      before: r.before?.plan ?? null,
      afterKm: r.total_distance_km ?? null,
      afterMin: r.total_duration_minutes ?? null,
      beforeKm: r.before?.total_distance_km ?? null,
      beforeMin: r.before?.total_duration_minutes ?? null,
      savedKm: r.saved_km ?? null,
      savedMin: r.saved_minutes ?? null,
    }]
  })
}

export interface StopPoint {
  id: string
  latitude?: number | null
  longitude?: number | null
  name?: string | null
  address?: string | null
}

/**
 * A reroute of a route's remaining stops: `current` in the order driven now, `newSequence` the
 * delivery point ids in the suggested order. Stops the sequence does not mention keep their place at the end.
 */
export function plansFromReorder(args: {
  key: string
  label: string
  vehicleId: string | null
  origin: LatLng | null
  current: StopPoint[]
  newSequence: string[]
  savedMin?: number | null
}): RoutePlan | null {
  const byId = new Map(args.current.map(s => [s.id, s]))
  const toNodes = (ids: string[]): PlanNode[] => ids
    .flatMap(id => (byId.has(id) ? [byId.get(id)!] : []))
    .filter(s => validPoint({ lat: Number(s.latitude), lng: Number(s.longitude) }))
    .map((s, i) => ({
      kind: 'drop' as const,
      seq: i + 1,
      shipment_id: s.id,
      delivery_point_id: s.id,
      tracking_id: null,
      label: s.name || s.address || null,
      lat: Number(s.latitude),
      lng: Number(s.longitude),
    }))
  const currentIds = args.current.map(s => s.id)
  const wanted = args.newSequence.filter(id => byId.has(id))
  const after = toNodes([...wanted, ...currentIds.filter(id => !wanted.includes(id))])
  const before = toNodes(currentIds)
  if (after.length === 0) return null
  return {
    key: args.key,
    vehicleId: args.vehicleId,
    label: args.label,
    color: routeColor(0),
    origin: args.origin,
    closed: false,
    after,
    before,
    afterKm: null,
    afterMin: null,
    beforeKm: null,
    beforeMin: null,
    savedKm: null,
    savedMin: args.savedMin ?? null,
  }
}

interface RouteStopLike {
  delivery_point_id?: string | null
  sequence?: number
  status?: string | null
  delivery_points?: Omit<StopPoint, 'id'> & { id?: string } | (Omit<StopPoint, 'id'> & { id?: string })[] | null
}

/** The pending stops of a saved route, in the order driven now, as points a reorder can be drawn from. */
export function pendingStopPoints(stops: RouteStopLike[] | null | undefined): StopPoint[] {
  return [...(stops ?? [])]
    .filter(s => (s.status ?? 'pending') === 'pending')
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .flatMap(s => {
      const dp = Array.isArray(s.delivery_points) ? s.delivery_points[0] : s.delivery_points
      const id = s.delivery_point_id ?? dp?.id
      return id && dp ? [{ id, latitude: dp.latitude, longitude: dp.longitude, name: dp.name, address: dp.address }] : []
    })
}

/* ── Map content ────────────────────────────────────────────────────────── */

const toPair = (p: LatLng): [number, number] => [p.lng, p.lat]

/** Waypoints of one order: origin, the stops, and back to the origin when the route is a round trip. */
export function waypointsOf(plan: RoutePlan, order: 'after' | 'before'): LatLng[] {
  const nodes = (order === 'before' ? plan.before : plan.after) ?? []
  const path: LatLng[] = nodes.map(n => ({ lat: n.lat, lng: n.lng }))
  if (plan.origin && validPoint(plan.origin)) {
    return plan.closed ? [plan.origin, ...path, plan.origin] : [plan.origin, ...path]
  }
  return path
}

export const geometryKey = (plan: RoutePlan, order: 'after' | 'before') => `${plan.key}:${order}`

export interface MapContent {
  lines: MapLine[]
  stops: MapRouteStop[]
  points: MapPoint[]
}

/**
 * The lines, numbered stops and depot marker for the routes.
 * `geometry` holds road lines by geometryKey; an order without one is drawn straight between its stops.
 * `focusKey` fades every other route.
 */
export function buildMapContent(args: {
  plans: RoutePlan[]
  depot: LatLng | null
  depotLabel?: string
  mode: CompareMode
  focusKey?: string | null
  geometry?: ReadonlyMap<string, [number, number][]>
}): MapContent {
  const { plans, depot, mode, focusKey, geometry } = args
  const lines: MapLine[] = []
  const stops: MapRouteStop[] = []

  // Old orders first so the new ones are drawn over them
  for (const order of ['before', 'after'] as const) {
    if (mode !== 'both' && mode !== order) continue
    for (const plan of plans) {
      if (order === 'before' && (!plan.before || plan.before.length === 0)) continue
      const faded = focusKey != null && focusKey !== plan.key
      const coordinates = geometry?.get(geometryKey(plan, order)) ?? waypointsOf(plan, order).map(toPair)
      lines.push(order === 'before'
        ? { id: `${plan.key}-before`, coordinates, color: BEFORE_COLOR, width: 3, dashed: true, opacity: faded ? 0.15 : 0.75 }
        : { id: `${plan.key}-after`, coordinates, color: plan.color, width: 5, opacity: faded ? 0.25 : 1 })
    }
  }

  // Numbers follow the order on show; with both on show, the new order
  for (const plan of plans) {
    const nodes = mode === 'before' && plan.before ? plan.before : plan.after
    const muted = mode === 'before'
    for (const n of nodes) {
      stops.push({
        id: `${plan.key}-${n.kind}-${n.seq}`,
        sequence: n.seq,
        position: { lat: n.lat, lng: n.lng },
        label: `${n.kind === 'pickup' ? 'Pickup' : 'Drop'}${n.tracking_id ? ` ${n.tracking_id}` : ''}${n.label ? `, ${n.label}` : ''}`,
        color: muted ? BEFORE_COLOR : plan.color,
      })
    }
  }

  const points: MapPoint[] = depot && validPoint(depot)
    ? [{ id: 'depot', kind: 'hub', position: depot, label: args.depotLabel ?? 'Depot' }]
    : []
  return { lines, stops, points }
}
