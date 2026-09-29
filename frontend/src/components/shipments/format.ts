import type { Tone } from '@/components/ui'
import { statusToLabel } from '@/components/ui/status'
import type { DeliveryPoint, ShipmentRow, VehicleOption } from './types'

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type Priority = (typeof PRIORITIES)[number]

export const priorityTone: Record<string, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
}

/** Every status a shipment can have (the database enum), in the order a load moves through them. */
export const SHIPMENT_STATUSES = ['created', 'assigned', 'picked_up', 'in_transit', 'exception', 'delivered', 'cancelled'] as const

/** What dispatch sees for a status; a failed delivery (`exception`) is named for what happened. */
export function shipmentStatusLabel(status?: string | null): string {
  return status === 'exception' ? 'Delivery failed' : statusToLabel(status)
}

/**
 * Statuses that mean the shipment is still on its way rather than finished.
 * The single source of truth for "active" so the Dashboard and Shipments tabs agree.
 */
export const ACTIVE_SHIPMENT_STATUSES = ['created', 'assigned', 'picked_up', 'in_transit', 'exception'] as const

export function isActiveShipmentStatus(status?: string | null): boolean {
  return !!status && (ACTIVE_SHIPMENT_STATUSES as readonly string[]).includes(status)
}

/**
 * Cargo manifests from vendor bids are merged into the shipments list with a CM- ID.
 * They live in another table, so shipment actions (status, edit, assign, delete) do not apply.
 */
/** The tracking ID printed for a cargo manifest: CM- and the first 8 characters of its id (same rule as the server). */
export const manifestTrackingId = (manifestId: string) => `CM-${manifestId.slice(0, 8).toUpperCase()}`

export const isCargoManifest = (s: Pick<ShipmentRow, 'tracking_id'>) => s.tracking_id?.startsWith('CM-') ?? false

export function deliveryPointsOf(s: ShipmentRow): DeliveryPoint[] {
  if (s.delivery_points && s.delivery_points.length > 0) return s.delivery_points
  return s.delivery_point ? [s.delivery_point] : []
}

/**
 * The final drop: the last delivery point. The server stores extra stops first and the destination
 * last and returns them in that order; public tracking and the optimizer use the same rule.
 */
export function destinationOf(s: ShipmentRow): DeliveryPoint | null {
  const points = deliveryPointsOf(s)
  return points.length > 0 ? points[points.length - 1] : null
}

/** The date the load is to be picked up: a customer booking's pickup date, or the dispatch date entered on the manifest. */
export function pickupDateOf(s: Pick<ShipmentRow, 'metadata'>): string | null {
  const meta = s.metadata
  const value = meta?.pickup_date ?? meta?.dispatch_date
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
}

export function plateOf(s: ShipmentRow): string | null {
  for (const dp of deliveryPointsOf(s)) {
    const plate = dp.route_stops?.find(rs => rs.routes?.vehicles?.plate_number)?.routes?.vehicles?.plate_number
    if (plate) return plate
  }
  return null
}

/** The server uses 999999 for "position unknown". */
export const knownDistance = (v: Pick<VehicleOption, 'distance_km'>) =>
  v.distance_km != null && v.distance_km < 99999 ? v.distance_km : null

export const freeCapacityKg = (v: VehicleOption) =>
  v.available_capacity_kg ?? Math.max(0, (v.capacity_kg ?? 0) - (v.current_load_kg ?? 0))

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Error text from an API failure, falling back to a plain message. */
export function apiErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  return fallback
}

/** True while a shipment is open to vendor bids and no bid has been accepted yet. */
export const isBiddingOpen = (s: { open_bidding?: boolean | null; bid_id?: string | null }) => !!s.open_bidding && !s.bid_id
