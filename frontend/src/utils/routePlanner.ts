import type { AvoidOptions, OpenLoad, OpenLoadPoint, PlanRequest, PlannedRoute, RouteLeg, StopKind } from '@/services/routing'
import type { ResolvedPlace } from '@/services/geocoding'
import { formatDate, formatDateTime, formatKg, formatKm, formatMinutes, formatRupees, formatTime } from '@/utils/display'

/** Helpers for the route planner page. Pure functions, so they can be tested without a browser. */

/** Most stops between the start and the end (the server checks the same limit). */
export const MAX_STOPS = 20
/** Google Maps opens at most this many stops between the start and the end. */
export const GOOGLE_MAX_WAYPOINTS = 9

export interface PlannerStop {
  /** Stable key for the list, so reordering keeps each row's identity. */
  key: string
  name: string
  address: string
  lat: number
  lng: number
  /** The shipment or load the stop came from; a drop must come after its pickup. */
  shipment_id?: string | null
  kind?: StopKind
  /** A shipment's own delivery point, reused when the route is created. */
  delivery_point_id?: string | null
  /** Weight of the shipment or load the stop came from. */
  weight_kg?: number | null
}

let keyCounter = 0
export const newStopKey = () => `stop-${++keyCounter}`

/** The short name of an address: everything before the first comma. */
export const shortName = (address: string) => address.split(',')[0].trim() || address

export function stopFromPlace(place: ResolvedPlace): PlannerStop {
  return { key: newStopKey(), name: shortName(place.address), address: place.address, lat: place.lat, lng: place.lng, kind: 'stop' }
}

function stopFromPoint(load: OpenLoad, point: OpenLoadPoint, kind: StopKind): PlannerStop {
  return {
    key: newStopKey(),
    name: point.name,
    address: point.address ?? point.name,
    lat: point.lat,
    lng: point.lng,
    kind,
    shipment_id: load.id,
    delivery_point_id: kind === 'drop' ? point.delivery_point_id : null,
    weight_kg: load.weight_kg,
  }
}

/** Stops for a shipment or load: its pickup first, then its drops in order. */
export function stopsFromLoad(load: OpenLoad, part: 'all' | 'pickup' | 'drops' = 'all'): PlannerStop[] {
  const out: PlannerStop[] = []
  if (load.pickup && part !== 'drops') out.push(stopFromPoint(load, load.pickup, 'pickup'))
  if (part !== 'pickup') for (const drop of load.drops) out.push(stopFromPoint(load, drop, 'drop'))
  return out
}

/** Total weight of the distinct shipments and loads the stops came from. */
export function loadWeightOfStops(stops: PlannerStop[]): number {
  const seen = new Map<string, number>()
  for (const s of stops) if (s.shipment_id && s.weight_kg && s.weight_kg > 0) seen.set(s.shipment_id, s.weight_kg)
  return [...seen.values()].reduce((a, b) => a + b, 0)
}

/** A copy of the list with one item moved. Out-of-range moves return the list unchanged. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** The stops in a new order (indexes into `stops`, as the server returns it). */
export function applyOrder<T>(stops: readonly T[], order: readonly number[]): T[] {
  if (order.length !== stops.length || new Set(order).size !== stops.length || order.some(i => i < 0 || i >= stops.length)) return [...stops]
  return order.map(i => stops[i])
}

/** A sentence naming the first drop that comes before its pickup, or null when the order is fine. */
export function pickupDropWarning(stops: readonly PlannerStop[]): string | null {
  for (let i = 0; i < stops.length; i++) {
    const drop = stops[i]
    if (drop.kind !== 'drop' || !drop.shipment_id) continue
    const pickupAfter = stops.findIndex((p, j) => j > i && p.kind === 'pickup' && p.shipment_id === drop.shipment_id)
    if (pickupAfter !== -1) return `${drop.name} comes before its pickup (${stops[pickupAfter].name}).`
  }
  return null
}

export interface PlannerInput {
  origin: { lat: number; lng: number; address: string } | null
  destination: { lat: number; lng: number; address: string } | null
  stops: PlannerStop[]
  vehicleId: string
  loadKg: string
  kerbKg: string
  /** '' to leave now, otherwise a datetime-local value in India time. */
  departLocal: string
  avoid: AvoidOptions
}

const numberFrom = (text: string, min: 'zero' | 'above-zero'): number | null => {
  const n = Number(text.trim())
  return text.trim() !== '' && Number.isFinite(n) && (min === 'zero' ? n >= 0 : n > 0) ? n : null
}

/** "2026-10-01T09:00" typed as India time, as an ISO instant. Null when empty or not a date. */
export function istInputToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+05:30`)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** An instant as a datetime-local value in India time ("2026-10-01T09:00"). */
export function isoToIstInput(ms: number): string {
  const d = new Date(ms + 5.5 * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** The request for the server, or null while the start or end is missing. */
export function toPlanRequest(input: PlannerInput): PlanRequest | null {
  if (!input.origin || !input.destination) return null
  return {
    origin: { lat: input.origin.lat, lng: input.origin.lng, name: shortName(input.origin.address) },
    destination: { lat: input.destination.lat, lng: input.destination.lng, name: shortName(input.destination.address) },
    stops: input.stops.map(s => ({ id: s.key, lat: s.lat, lng: s.lng, name: s.name, kind: s.kind ?? 'stop', shipment_id: s.shipment_id ?? null })),
    vehicle_id: input.vehicleId || null,
    load_kg: numberFrom(input.loadKg, 'zero'),
    kerb_weight_kg: numberFrom(input.kerbKg, 'above-zero'),
    departure_at: istInputToIso(input.departLocal),
    avoid: input.avoid,
  }
}

/** Same request, same key: used to tell when the inputs changed after a plan was made. */
export const requestKey = (req: PlanRequest): string => JSON.stringify(req)

/** Arrival time (ISO) at each point of the trip: the start is the departure, then each leg adds its time. */
export function pointTimes(departureIso: string, legs: readonly RouteLeg[]): string[] {
  const start = Date.parse(departureIso)
  if (!Number.isFinite(start)) return []
  let t = start
  const out = [new Date(start).toISOString()]
  for (const leg of legs) {
    t += leg.travel_minutes * 60_000
    out.push(new Date(t).toISOString())
  }
  return out
}

/** A time in India: "9:00 am", or with the date when it falls on another day than `reference`. */
export function formatArrival(iso: string, reference: string): string {
  return formatDate(iso) === formatDate(reference) ? formatTime(iso) : formatDateTime(iso)
}

export type RouteTag = 'Fastest' | 'Shortest' | 'Alternative'

/** Names each route: the quickest is Fastest, the one with the fewest km Shortest (when a different route). */
export function tagRoutes(routes: readonly Pick<PlannedRoute, 'travel_minutes' | 'distance_km'>[]): RouteTag[] {
  if (routes.length === 0) return []
  let fastest = 0
  let shortest = 0
  routes.forEach((r, i) => {
    if (r.travel_minutes < routes[fastest].travel_minutes) fastest = i
    if (r.distance_km < routes[shortest].distance_km) shortest = i
  })
  return routes.map((_, i) => (i === fastest ? 'Fastest' : i === shortest ? 'Shortest' : 'Alternative'))
}

interface Coord { lat: number; lng: number }

export interface GoogleMapsLink { url: string; omitted: number }

/** A Google Maps directions link (start, stops in order, end). Maps takes at most 9 stops; the rest are counted in `omitted`. */
export function googleMapsUrl(origin: Coord, destination: Coord, stops: readonly Coord[], avoid: AvoidOptions): GoogleMapsLink {
  const at = (c: Coord) => `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`
  const kept = stops.slice(0, GOOGLE_MAX_WAYPOINTS)
  const params = new URLSearchParams({ api: '1', origin: at(origin), destination: at(destination), travelmode: 'driving' })
  if (kept.length > 0) params.set('waypoints', kept.map(at).join('|'))
  const avoids = [avoid.tolls && 'tolls', avoid.highways && 'highways', avoid.ferries && 'ferries'].filter(Boolean)
  if (avoids.length > 0) params.set('avoid', avoids.join('|'))
  return { url: `https://www.google.com/maps/dir/?${params.toString()}`, omitted: Math.max(0, stops.length - kept.length) }
}

export interface PlanTextInput {
  vehicle: string | null
  departureIso: string
  points: { name: string }[]
  route: Pick<PlannedRoute, 'distance_km' | 'travel_minutes' | 'traffic_delay_minutes' | 'toll_km' | 'legs' | 'arrival_at'>
  fuel: { litres: number | null; cost: number | null } | null
  provider: 'tomtom' | 'mapbox'
  truckAware: boolean
  mapsUrl: string
}

/** The plan as plain text for a message or a note. */
export function planText(p: PlanTextInput): string {
  const times = pointTimes(p.departureIso, p.route.legs)
  const last = p.points.length - 1
  const lines = [
    `Route plan: ${p.points[0]?.name ?? 'Start'} to ${p.points[last]?.name ?? 'End'}`,
    ...(p.vehicle ? [`Vehicle: ${p.vehicle}`] : []),
    `Leaves: ${formatDateTime(p.departureIso)}`,
    '',
    ...p.points.map((pt, i) => {
      if (i === 0) return `1. ${pt.name} (start)`
      const at = times[i] ?? (i === last ? p.route.arrival_at : null)
      return `${i + 1}. ${pt.name}${at ? `, arrive ${formatArrival(at, p.departureIso)}` : ''}${i === last ? ' (end)' : ''}`
    }),
    '',
    `Total: ${formatKm(p.route.distance_km)}, ${formatMinutes(p.route.travel_minutes)}` +
      (p.route.traffic_delay_minutes ? `, traffic delay ${formatMinutes(p.route.traffic_delay_minutes)}` : '') +
      (p.route.toll_km ? `, tolls ${formatKm(p.route.toll_km)}` : ''),
  ]
  if (p.fuel?.litres != null) {
    lines.push(`Fuel: about ${p.fuel.litres.toLocaleString('en-IN')} L${p.fuel.cost != null ? ` (${formatRupees(p.fuel.cost)})` : ''}`)
  }
  if (!p.truckAware) lines.push('Note: this route does not consider truck restrictions.')
  lines.push('', `Open in Google Maps: ${p.mapsUrl}`)
  return lines.join('\n')
}

/** Clear message from a routing API error. Unlike other calls the server's own text is kept for 5xx (503 = not set up). */
export function routingErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { detail?: unknown } }; code?: string } | null
  const status = e?.response?.status
  const detail = e?.response?.data?.detail
  if (status === 429) return 'Too many requests. Wait a minute and try again.'
  if (typeof detail === 'string' && detail && status !== 500) return detail
  if (!status && e?.code === 'ERR_NETWORK') return 'You appear to be offline. Check your connection and try again.'
  return fallback
}

/** "1 h 5 min" or "45 min" for a saving, with a sign word. */
export const describeSaving = (km: number, minutes: number): string => {
  const parts: string[] = []
  if (minutes > 0) parts.push(`${formatMinutes(minutes)} sooner`)
  else if (minutes < 0) parts.push(`${formatMinutes(-minutes)} longer`)
  if (km > 0) parts.push(`${formatKm(km)} less`)
  else if (km < 0) parts.push(`${formatKm(-km)} more`)
  return parts.length > 0 ? parts.join(' and ') : 'no change in time or distance'
}

/** One line for the truck limits that were sent to the routing service. */
export function truckProfileText(profile: { weight_kg: number | null; length_m: number | null; width_m: number | null; height_m: number | null } | null): string | null {
  if (!profile) return null
  const parts: string[] = []
  if (profile.weight_kg) parts.push(formatKg(profile.weight_kg))
  if (profile.length_m) parts.push(`${profile.length_m} m long`)
  if (profile.width_m) parts.push(`${profile.width_m} m wide`)
  if (profile.height_m) parts.push(`${profile.height_m} m high`)
  return parts.length > 0 ? parts.join(', ') : null
}

/** Position of the middle of a traffic section, for a marker. */
export function sectionMidpoint(coordinates: readonly [number, number][]): { lat: number; lng: number } | null {
  if (coordinates.length === 0) return null
  const [lng, lat] = coordinates[Math.floor(coordinates.length / 2)]
  return { lat, lng }
}
