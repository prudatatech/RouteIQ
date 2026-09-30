/**
 * What Dispatch lists (docs/workflow-blueprint.html): shipments that need a vehicle, and trips
 * that are planned but not sent. Pure rules over rows from GET /shipments and GET /routes.
 */
import { deliveryPointsOf, isBiddingOpen, isCargoManifest } from '@/components/shipments/format'
import type { ShipmentRow } from '@/components/shipments/types'

/** A trip in one of these states still holds the shipment. A completed or cancelled one does not. */
const LIVE_TRIP_STATUSES = ['pending', 'optimizing', 'active']

/** True while a live trip has a stop for this shipment. */
export function hasLiveTrip(s: ShipmentRow): boolean {
  return deliveryPointsOf(s).some(dp => dp.route_stops?.some(rs => rs.routes && LIVE_TRIP_STATUSES.includes(rs.routes.status ?? '')))
}

/**
 * Accepted, with no trip: a shipment or a lot that is created (or came back after a failed delivery
 * and is with the sender again) and is on no live trip. A split master holds no goods, and a vendor
 * load is its own trip, so neither is listed.
 */
export function needsVehicle(s: ShipmentRow): boolean {
  if (isCargoManifest(s) || s.is_master === true) return false
  const withSender = !s.current_holder || s.current_holder === 'consignor'
  if (s.status === 'created') return !hasLiveTrip(s)
  // A failed delivery can be planned again once the goods are back with the sender
  if (s.status === 'exception') return withSender
  return false
}

/** Open to vendor bids: a vehicle comes from the bid that is accepted, so it cannot be picked here. */
export const canPickVehicle = (s: ShipmentRow) => !isBiddingOpen(s)

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/** Most urgent first: priority, then the earliest pickup, then the oldest. */
export function byUrgency(a: ShipmentRow, b: ShipmentRow, pickup: (s: ShipmentRow) => string | null): number {
  const pa = PRIORITY_RANK[a.priority ?? 'medium'] ?? 2
  const pb = PRIORITY_RANK[b.priority ?? 'medium'] ?? 2
  if (pa !== pb) return pa - pb
  const da = pickup(a) ?? '9999'
  const db = pickup(b) ?? '9999'
  if (da !== db) return da < db ? -1 : 1
  return Date.parse(a.created_at ?? '') - Date.parse(b.created_at ?? '')
}

/** A trip's origin as the trip list shows it: the optimizer, the route planner, or neither. */
export function tripSource(r: { depot_id?: string | null; plan?: { source?: string } | null }): 'optimizer' | 'planner' | 'other' {
  if (r.plan?.source === 'route_planner') return 'planner'
  return r.depot_id ? 'optimizer' : 'other'
}

export const TRIP_SOURCE_LABEL = { optimizer: 'Optimizer', planner: 'Route planner', other: 'Trip' } as const
