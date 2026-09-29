import type { Tone } from '@/components/ui'
import type { DeliveryPoint, ShipmentRow, VehicleOption } from './types'

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type Priority = (typeof PRIORITIES)[number]

export const priorityTone: Record<string, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
}

/** Statuses a shipment moves through (backend ShipmentUpdateSchema.status). */
export const SHIPMENT_STATUSES = ['created', 'picked_up', 'in_transit', 'delivered', 'cancelled'] as const

/**
 * Statuses that mean the shipment is still on its way rather than finished.
 * The single source of truth for "active" so the Dashboard and Shipments tabs agree.
 */
export const ACTIVE_SHIPMENT_STATUSES = ['created', 'picked_up', 'in_transit'] as const

export function isActiveShipmentStatus(status?: string | null): boolean {
  return !!status && (ACTIVE_SHIPMENT_STATUSES as readonly string[]).includes(status)
}

/**
 * Cargo manifests from vendor bids are merged into the shipments list with a CM- ID.
 * They live in another table, so shipment actions (status, edit, assign, delete) do not apply.
 */
export const isCargoManifest = (s: Pick<ShipmentRow, 'tracking_id'>) => s.tracking_id?.startsWith('CM-') ?? false

export function deliveryPointsOf(s: ShipmentRow): DeliveryPoint[] {
  if (s.delivery_points && s.delivery_points.length > 0) return s.delivery_points
  return s.delivery_point ? [s.delivery_point] : []
}

/** The final drop. The server stores extra stops first and the destination last. */
export function destinationOf(s: ShipmentRow): DeliveryPoint | null {
  const points = deliveryPointsOf(s)
  return points.length > 0 ? points[points.length - 1] : null
}

export function plateOf(s: ShipmentRow): string | null {
  for (const dp of deliveryPointsOf(s)) {
    const plate = dp.route_stops?.find(rs => rs.routes?.vehicles?.plate_number)?.routes?.vehicles?.plate_number
    if (plate) return plate
  }
  return null
}

export function formatDate(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

export const formatKg = (kg?: number | null) =>
  kg == null ? null : `${Number(kg).toLocaleString('en-IN', { maximumFractionDigits: 1 })} kg`

export const formatRupees = (amount?: number | null) =>
  amount == null ? null : `₹${Number(amount).toLocaleString('en-IN')}`

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
