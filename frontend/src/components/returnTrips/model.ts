/** Return trips: the shapes the console works with, and the pure helpers over them (no network here). */

/** How many recent return trips the page loads. */
export const WINDOW_LIMIT = 100
/** Driver confirmations listed on the Bids to decide tab. */
export const CONFIRMATION_LIMIT = 50

export interface WindowVehicle {
  id: string
  plate_number: string | null
  vehicle_type: string | null
  capacity_kg: number | null
  available_capacity_kg: number | null
  current_location_name: string | null
}

export interface CapacityWindow {
  id: string
  vehicle_id: string
  opens_at: string
  closes_at: string
  floor_price: number | null
  winning_bid_id: string | null
  trigger_type: string | null
  status: string | null
  vehicles: WindowVehicle | null
}

/** What an awarded bid created: the shipment and the trip it was added to. */
export interface AwardedLoad {
  shipment_id: string
  tracking_id: string | null
  route_id: string | null
}

export interface Bid {
  id: string
  window_id: string
  vendor_id: string
  bid_amount: number
  submitted_at: string | null
  status: string
  eway_bill_ref: string | null
  weight_kg: number | null
  load_configuration: string | null
  rejection_reason: string | null
  delivery_points: { name: string | null; address: string | null } | null
  vendor: { company_name: string | null; city: string | null; has_location: boolean } | null
  awarded: AwardedLoad | null
}

/** The trip a truck is on (or about to start), where its spare space is. */
export interface Trip {
  id: string
  destination: string | null
}

export interface DriverConfirmation {
  id: string
  prompted_at: string
  delivered_at: string | null
  action: string | null
  vehicles: { id: string | null; plate_number: string | null } | null
  route_stops: { route_id: string | null; delivery_points: { name: string | null; address: string | null } | null } | null
}

export interface Board {
  windows: CapacityWindow[]
  bids: Bid[]
  /** The current trip of each truck with a return trip, by vehicle id. */
  trips: Record<string, Trip>
}

export type WindowState = 'open' | 'decide' | 'awarded' | 'closed' | 'upcoming' | 'cancelled'

export const triggerLabel: Record<string, string> = {
  mid_route: 'Space during a trip',
  return_trip: 'Empty return trip',
  end_of_route: 'Empty return trip',
  superadmin_dispatch: 'Opened by an admin',
}

export function windowState(w: CapacityWindow, bids: Bid[], now: number): WindowState {
  if (w.status === 'cancelled') return 'cancelled'
  if (w.winning_bid_id) return 'awarded'
  if (new Date(w.opens_at).getTime() > now) return 'upcoming'
  if (new Date(w.closes_at).getTime() > now) return 'open'
  if (bids.some(b => b.status === 'pending')) return 'decide'
  return 'closed'
}

export const shortPlace = (p: string | null | undefined) => (p ?? '').split(',')[0].trim()

/** "Pune to Nashik" for a truck on a trip, "Near Pune" when it has none, or null when nothing is known. */
export function laneText(vehicle: WindowVehicle | null, trip: Trip | null | undefined): string | null {
  const from = shortPlace(vehicle?.current_location_name)
  const to = shortPlace(trip?.destination)
  if (from && to && from !== to) return `${from} to ${to}`
  if (from) return `Near ${from}`
  if (to) return `Heading to ${to}`
  return null
}

/** "12 min" or "2 h 5 min" until `iso`, or null once it has passed. */
export function timeLeft(iso: string, now: number): string | null {
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours >= 48) return `${Math.floor(hours / 24)} days`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export const vendorName = (b: Bid) => b.vendor?.company_name || 'Unnamed vendor'
