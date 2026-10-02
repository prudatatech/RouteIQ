import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'
import { vendorAPI } from '@/services/api'
import { CONFIRMATION_LIMIT, WINDOW_LIMIT, type AwardedLoad, type Bid, type Board, type CapacityWindow, type DriverConfirmation, type Trip } from './model'

export * from './model'

export const returnTripKeys = {
  board: ['return-trips', 'board'] as const,
  confirmations: ['return-trips', 'confirmations'] as const,
}

interface RouteRow {
  id: string
  vehicle_id: string
  route_stops: { sequence: number; delivery_points: { name: string | null } | null }[] | null
}

const stopIdOf = (metadata: unknown) => (metadata as { drop_stop_id?: string } | null)?.drop_stop_id

async function loadBoard(): Promise<Board> {
  const { data: windows, error: wErr } = await supabase
    .from('capacity_windows')
    .select('id, vehicle_id, opens_at, closes_at, floor_price, winning_bid_id, trigger_type, status, vehicles(id, plate_number, vehicle_type, capacity_kg, available_capacity_kg, current_location_name)')
    .order('opens_at', { ascending: false })
    .limit(WINDOW_LIMIT)
  if (wErr) throw wErr
  const windowList = (windows ?? []) as unknown as CapacityWindow[]
  if (windowList.length === 0) return { windows: windowList, bids: [], trips: {} }

  const { data: bids, error: bErr } = await supabase
    .from('capacity_bids')
    .select('id, window_id, vendor_id, bid_amount, submitted_at, status, eway_bill_ref, weight_kg, load_configuration, rejection_reason, delivery_points(name, address)')
    .in('window_id', windowList.map(w => w.id))
    .order('bid_amount', { ascending: false })
  if (bErr) throw bErr
  const bidRows = (bids ?? []) as unknown as Omit<Bid, 'vendor' | 'awarded'>[]

  const vendorIds = [...new Set(bidRows.map(b => b.vendor_id))]
  const vendors = new Map<string, NonNullable<Bid['vendor']>>()
  if (vendorIds.length > 0) {
    for (const p of await vendorAPI.basic(vendorIds)) {
      vendors.set(p.id, { company_name: p.company_name, city: p.city, has_location: p.has_location })
    }
  }

  // What each awarded bid created: its shipment, and the trip its drop-off stop is on
  const awarded = new Map<string, AwardedLoad>()
  const wonIds = bidRows.filter(b => b.status === 'won').map(b => b.id)
  if (wonIds.length > 0) {
    const { data: shipments, error: sErr } = await supabase
      .from('shipments').select('id, bid_id, tracking_id, metadata').in('bid_id', wonIds)
    if (sErr) throw sErr
    const stopIds = (shipments ?? []).map(s => stopIdOf(s.metadata)).filter((id): id is string => !!id)
    const routeByStop = new Map<string, string>()
    if (stopIds.length > 0) {
      const { data: stops, error: rErr } = await supabase.from('route_stops').select('id, route_id').in('id', stopIds)
      if (rErr) throw rErr
      for (const s of stops ?? []) if (s.route_id) routeByStop.set(s.id, s.route_id)
    }
    for (const s of shipments ?? []) {
      const stopId = stopIdOf(s.metadata)
      awarded.set(s.bid_id, { shipment_id: s.id, tracking_id: s.tracking_id, route_id: stopId ? routeByStop.get(stopId) ?? null : null })
    }
  }

  // The trip each truck with a return trip is on now: where it is going
  const trips: Record<string, Trip> = {}
  const vehicleIds = [...new Set(windowList.map(w => w.vehicle_id))]
  const { data: routes, error: tErr } = await supabase
    .from('routes')
    .select('id, vehicle_id, created_at, route_stops(sequence, delivery_points(name))')
    .in('vehicle_id', vehicleIds)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false })
  if (tErr) throw tErr
  for (const r of (routes ?? []) as unknown as RouteRow[]) {
    if (trips[r.vehicle_id]) continue
    const last = [...(r.route_stops ?? [])].sort((a, b) => b.sequence - a.sequence)[0]
    trips[r.vehicle_id] = { id: r.id, destination: last?.delivery_points?.name ?? null }
  }

  return {
    windows: windowList,
    bids: bidRows.map(b => ({ ...b, vendor: vendors.get(b.vendor_id) ?? null, awarded: awarded.get(b.id) ?? null })),
    trips,
  }
}

export function useReturnTripsBoard() {
  return useQuery({ queryKey: returnTripKeys.board, queryFn: loadBoard })
}

async function loadConfirmations(): Promise<DriverConfirmation[]> {
  const { data, error } = await supabase
    .from('driver_confirmations')
    .select('id, prompted_at, delivered_at, action, vehicles(id, plate_number), route_stops(route_id, delivery_points(name, address))')
    .order('prompted_at', { ascending: false })
    .limit(CONFIRMATION_LIMIT)
  if (error) throw error
  return (data ?? []) as unknown as DriverConfirmation[]
}

export function useDriverConfirmations() {
  return useQuery({ queryKey: returnTripKeys.confirmations, queryFn: loadConfirmations })
}

