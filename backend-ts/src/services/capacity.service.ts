import axios from 'axios';
import { supabase } from '../core/supabase';
import { v4 as uuidv4 } from 'uuid';
import { HttpError } from '../core/errors';
import { formatINR, formatKg } from '../core/format';
import { isDispatchable } from '../core/vehicles';
import { notificationService } from './notification.service';
import { pricingService } from './pricing.service';
import { haversineKm, isValidPoint, LatLng, ROAD_FACTOR } from './geo';
import { placeMatchesSide } from '../utils/corridor-match';
import { toPoint, travelMinutes } from '../utils/eta';

/** Notifications are informative; a failure must not undo the bid operation. */
function notify(send: () => Promise<unknown>) {
  send().catch((e) => console.error('[capacity] Notification failed:', e));
}

/** A PostgREST to-one embed arrives as an object (or, for some relationships, a one-element array). */
function one<T>(embed: T | T[] | null | undefined): T | null {
  return (Array.isArray(embed) ? embed[0] : embed) ?? null;
}

/** How long a bidding window stays open when nobody says otherwise: the same for drivers, staff and the wizard. */
export const DEFAULT_WINDOW_MINUTES = 30;
/** A vendor can bid on a truck that is at most this far away by road, unless it is in the vendor's own city. */
export const GEOFENCE_KM = 50;
/** Pending bids on a window that closed this long ago are expired and their vendors told. */
export const STALE_BID_HOURS = 24;
/** Time on site at the vendor's pickup, added before the truck leaves for the drop-off. */
const PICKUP_SERVICE_MINUTES = 20;

export type WindowTrigger = 'mid_route' | 'return_trip' | 'superadmin_dispatch';

const point = toPoint;

/**
 * What a vendor sees of an open window: enough to decide and bid, nothing that
 * identifies or locates the vehicle or its driver (no plate, phone or position).
 */
function toVendorWindow(w: any) {
  const v = one<any>(w.vehicles);
  return {
    id: w.id,
    trigger_type: w.trigger_type ?? null,
    opens_at: w.opens_at,
    closes_at: w.closes_at,
    floor_price: w.floor_price,
    vehicles: v
      ? { vehicle_type: v.vehicle_type ?? null, available_capacity_kg: v.available_capacity_kg ?? null }
      : null,
  };
}

/**
 * Whether a truck is close enough for this vendor to bid on: within the geofence
 * by road, or in the vendor's own city. A truck whose position is unknown is not
 * hidden (that is a data gap, not distance); a vendor without a location sees none.
 */
function truckIsNearVendor(vehicle: any, vendor: any): boolean {
  const vendorAt = point(vendor?.latitude, vendor?.longitude);
  if (!isValidPoint(vendorAt)) return false;
  const truckAt = point(vehicle?.latitude, vehicle?.longitude);
  if (!isValidPoint(truckAt)) return true;
  if (vendor?.city && placeMatchesSide(vehicle?.current_location_name, vendor.city)) return true;
  return haversineKm(truckAt, vendorAt) * ROAD_FACTOR <= GEOFENCE_KM;
}

/**
 * Tells the vendors who would see a newly opened window (a truck within the geofence, or in their own
 * city) that space is on offer. The same rule as listOpenWindowsForVendors, so a vendor is only told
 * about windows they can bid on. Vendors without a location are not told: they could not bid.
 * The plate is never included. A vendor is told once per window.
 */
async function notifyVendorsOfWindow(window: { id: string; closes_at: string; floor_price?: number | null; trigger_type?: string | null }, vehicleId: string): Promise<number> {
  const [{ data: vehicle }, { data: vendors, error }] = await Promise.all([
    supabase.from('vehicles').select('vehicle_type, latitude, longitude, current_location_name, available_capacity_kg').eq('id', vehicleId).maybeSingle(),
    supabase.from('vendor_profiles').select('id, latitude, longitude, city').eq('kyc_status', 'approved'),
  ]);
  if (error) throw new Error(`Failed to load vendors: ${error.message}`);
  const desc = vehicle?.vehicle_type ? `A ${vehicle.vehicle_type}` : 'A truck';
  const space = vehicle?.available_capacity_kg ? ` with ${formatKg(Number(vehicle.available_capacity_kg))} free` : '';
  let told = 0;
  for (const v of vendors ?? []) {
    if (!truckIsNearVendor(vehicle, v)) continue;
    const sent = await notificationService.sendNotificationOnce(
      v.id,
      'Space on a return trip',
      `${desc}${space} is heading back near you. Place a bid before it closes.`,
      'return_trip_opened',
      { window_id: window.id, closes_at: window.closes_at, trigger_type: window.trigger_type ?? null },
      'window_id',
    );
    if (sent) told += 1;
  }
  return told;
}

/** A vendor's own bid; the plate is shown only once the vendor has won the window (needed for handover). */
function toVendorBid(b: any) {
  const w = one<any>(b.capacity_windows);
  const v = one<any>(w?.vehicles);
  const { capacity_windows: _omit, ...bid } = b;
  return {
    ...bid,
    capacity_windows: w
      ? {
          trigger_type: w.trigger_type ?? null,
          vehicles: v
            ? { vehicle_type: v.vehicle_type ?? null, ...(b.status === 'won' ? { plate_number: v.plate_number ?? null } : {}) }
            : null,
        }
      : null,
  };
}

/** What a vehicle can still carry: what it reports as free, else its rated capacity less what it carries. */
export function freeCapacityKg(vehicle: { capacity_kg?: unknown; current_load_kg?: unknown; available_capacity_kg?: unknown }): number {
  if (vehicle.available_capacity_kg != null) return Number(vehicle.available_capacity_kg) || 0;
  const rated = Number(vehicle.capacity_kg);
  return Number.isFinite(rated) && rated > 0 ? Math.max(0, rated - (Number(vehicle.current_load_kg) || 0)) : 0;
}

/** The window a vehicle is offering space through right now, if any. */
async function findOpenWindow(vehicleId: string) {
  const { data, error } = await supabase
    .from('capacity_windows').select('id, closes_at')
    .eq('vehicle_id', vehicleId).eq('status', 'open').is('winning_bid_id', null)
    .gt('closes_at', new Date().toISOString());
  if (error) throw new Error(`Failed to check existing windows: ${error.message}`);
  return (data ?? [])[0] ?? null;
}

export interface OpenWindowInput {
  vehicleId: string;
  triggerType: WindowTrigger;
  /** The lowest acceptable price for the whole load. Staff enter it; without one, each bid is checked against the pricing engine for its own weight. */
  floorPrice?: number | null;
  durationMinutes?: number;
  /** A start and end chosen by the caller (the shipment wizard); they replace `durationMinutes`. */
  opensAt?: Date | string | null;
  closesAt?: Date | string | null;
  /** A shipment the window is opened for (kept as the standby load; a winning bid gets its own shipment). */
  shipmentId?: string | null;
  createdBy?: string | null;
  /** Tell the vendors near the truck (default). The driver's matching toggle turns it off when its own broadcast covers them. */
  notifyVendors?: boolean;
}

export const capacityService = {
  /**
   * Open capacity windows as vendors see them (see toVendorWindow). Only windows that are
   * open right now; with a `vendorId`, only those within that vendor's geofence.
   */
  async listOpenWindowsForVendors(vendorId?: string) {
    let vendor: any = null;
    if (vendorId) {
      const { data, error } = await supabase.from('vendor_profiles').select('latitude, longitude, city').eq('id', vendorId).maybeSingle();
      if (error) throw new Error(`Failed to load vendor: ${error.message}`);
      vendor = data;
    }
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('capacity_windows')
      .select('id, trigger_type, opens_at, closes_at, floor_price, vehicles(vehicle_type, available_capacity_kg, latitude, longitude, current_location_name)')
      .eq('status', 'open')
      .lte('opens_at', nowIso)
      .gt('closes_at', nowIso)
      .is('winning_bid_id', null)
      .order('opens_at', { ascending: false });
    if (error) throw new Error(`Failed to load open windows: ${error.message}`);
    // The mock and the database agree on the filters above; this keeps the rule in one readable place too
    const open = (data ?? []).filter((w: any) => new Date(w.opens_at).getTime() <= Date.now() && new Date(w.closes_at).getTime() > Date.now());
    return (vendorId ? open.filter((w: any) => truckIsNearVendor(one<any>(w.vehicles), vendor)) : open).map(toVendorWindow);
  },

  /**
   * A vendor's bids, newest first (see toVendorBid).
   */
  async listVendorBids(vendorId: string) {
    const { data, error } = await supabase
      .from('capacity_bids')
      .select('*, capacity_windows!capacity_bids_window_id_fkey(trigger_type, vehicles(vehicle_type, plate_number))')
      .eq('vendor_id', vendorId)
      .order('submitted_at', { ascending: false });
    if (error) throw new Error(`Failed to load bids: ${error.message}`);
    return (data ?? []).map(toVendorBid);
  },

  /**
   * Submit a bid for a capacity window. The vendor needs a pickup location on their profile;
   * the truck must be within the geofence; the bid must reach the minimum bid (staff's price for
   * the window, or the pricing engine's low price for this load).
   */
  async submitBid(data: { vendor_id: string; window_id: string; bid_amount: number; eway_bill_ref: string; dropoff_point_id: string; weight_kg: number; load_configuration: string }) {
    const bidAmount = Number(data.bid_amount);
    const weightKg = Number(data.weight_kg);
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) throw new HttpError(400, 'bid_amount must be a positive number');
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw new HttpError(400, 'weight_kg must be a positive number');

    const { data: window, error: windowErr } = await supabase
      .from('capacity_windows')
      .select('id, opens_at, closes_at, floor_price, status, winning_bid_id, vehicles(plate_number, latitude, longitude, current_location_name, available_capacity_kg)')
      .eq('id', data.window_id)
      .maybeSingle();
    if (windowErr) throw new Error(`Failed to load window ${data.window_id}: ${windowErr.message}`);
    if (!window) throw new HttpError(404, 'Window not found');

    const now = Date.now();
    if (window.status !== 'open' || window.winning_bid_id || new Date(window.closes_at).getTime() <= now || new Date(window.opens_at).getTime() > now) {
      throw new HttpError(409, 'This capacity window is not open for bids');
    }
    const windowVehicle = window.vehicles as any;
    if (windowVehicle?.available_capacity_kg != null && weightKg > Number(windowVehicle.available_capacity_kg)) {
      throw new HttpError(400, `Load of ${weightKg} kg exceeds the ${windowVehicle.available_capacity_kg} kg available on this vehicle`);
    }

    // A rejected, lost or expired bid does not stop the vendor from bidding again; a pending one does
    const { data: existing, error: existingErr } = await supabase
      .from('capacity_bids')
      .select('id')
      .eq('window_id', data.window_id)
      .eq('vendor_id', data.vendor_id)
      .eq('status', 'pending')
      .limit(1);
    if (existingErr) throw new Error(`Failed to check existing bids: ${existingErr.message}`);
    if (existing && existing.length > 0) throw new HttpError(409, 'You already have a pending bid on this window');

    const { data: vendor, error: vendorErr } = await supabase.from('vendor_profiles').select('latitude, longitude, city').eq('id', data.vendor_id).maybeSingle();
    if (vendorErr) throw new Error(`Failed to load vendor: ${vendorErr.message}`);
    const vendorAt = point(vendor?.latitude, vendor?.longitude);
    if (!isValidPoint(vendorAt)) {
      throw new HttpError(400, 'Add your pickup location to your company profile before bidding, so the truck knows where to come');
    }

    // Geofencing: the truck must be close to the vendor, or in the vendor's own city
    const truckAt = point(windowVehicle?.latitude, windowVehicle?.longitude);
    if (isValidPoint(truckAt) && !(vendor?.city && placeMatchesSide(windowVehicle?.current_location_name, vendor.city))) {
      const straightKm = haversineKm(truckAt, vendorAt);
      let drivingKm = Math.round(straightKm * ROAD_FACTOR * 10) / 10;
      let etaMins = travelMinutes(truckAt, vendorAt) ?? 0;
      if (drivingKm > GEOFENCE_KM && straightKm <= GEOFENCE_KM) {
        // The estimate says too far but the straight line says close: ask the routing service
        try {
          const osrm = await axios.get(`https://router.project-osrm.org/route/v1/driving/${truckAt.lng},${truckAt.lat};${vendorAt.lng},${vendorAt.lat}?overview=false`, { timeout: 5000 });
          const route = osrm.data?.routes?.[0];
          if (route) {
            drivingKm = Math.round(route.distance / 1000 * 10) / 10;
            etaMins = Math.round(route.duration / 60);
          }
        } catch (e: any) {
          console.warn('[capacity] Routing service unavailable, using the distance estimate:', e.message);
        }
      }
      if (drivingKm > GEOFENCE_KM) {
        throw new HttpError(400, `Geofencing lock: The physical driving distance is ${drivingKm}km (ETA: ${etaMins} mins), which exceeds the ${GEOFENCE_KM}km limit from your location.`);
      }
    }

    // Minimum bid: staff's price for the window, else what the pricing engine says this load is worth
    let minimum: number | null = window.floor_price != null ? Number(window.floor_price) : null;
    if (minimum === null) {
      const { data: drop } = await supabase.from('delivery_points').select('latitude, longitude').eq('id', data.dropoff_point_id).maybeSingle();
      const dropAt = point(drop?.latitude, drop?.longitude);
      if (isValidPoint(dropAt)) minimum = await pricingService.minimumFor(vendorAt, dropAt, weightKg, { userId: data.vendor_id, role: 'vendor' });
    }
    if (minimum !== null && bidAmount < minimum) {
      throw new HttpError(400, `Bid is below the minimum bid of ${formatINR(Math.round(minimum))}`);
    }

    const { data: bid, error } = await supabase.from('capacity_bids').insert({
      vendor_id: data.vendor_id,
      window_id: data.window_id,
      bid_amount: bidAmount,
      eway_bill_ref: data.eway_bill_ref,
      dropoff_point_id: data.dropoff_point_id,
      weight_kg: weightKg,
      load_configuration: data.load_configuration,
      status: 'pending'
    }).select().single();

    if (error) throw new Error(error.message);

    notify(() => notificationService.notifyStaff(
      'New bid',
      `A vendor bid ${formatINR(bidAmount)} for ${formatKg(weightKg)} on ${windowVehicle?.plate_number ?? 'a vehicle'}.`,
      'capacity_bid',
      { bid_id: bid.id, window_id: data.window_id }
    ));
    return bid;
  },

  /**
   * The driver turns backhaul matching on or off. On: a bidding window opens on the
   * vehicle's free capacity (or the one already open stays) and vendors along the way are told.
   * Off: the open window closes, so the flag and the window can never disagree.
   */
  async toggleMatching(vehicleId: string, enabled: boolean) {
    if (!enabled) {
      const { data: open, error } = await supabase
        .from('capacity_windows').select('id').eq('vehicle_id', vehicleId).eq('status', 'open').is('winning_bid_id', null);
      if (error) throw new Error(`Failed to check existing windows: ${error.message}`);
      for (const w of open ?? []) await this.endWindow(w.id, 'closed');
      const { error: flagErr } = await supabase.from('vehicles').update({ bidding_window_open: false, bidding_window_closes_at: null }).eq('id', vehicleId);
      if (flagErr) throw new Error(flagErr.message);
      return;
    }

    // Hook into the vendor passing route broadcast system. With the truck's position known that
    // broadcast tells the vendors along the route, so the window itself stays quiet.
    const { data: vehicle } = await supabase.from('vehicles').select('latitude, longitude').eq('id', vehicleId).maybeSingle();
    if (!(await findOpenWindow(vehicleId))) {
      await this.openWindow({ vehicleId, triggerType: 'return_trip', notifyVendors: !(vehicle?.latitude && vehicle?.longitude) });
    }
    let routeId;
    const { data: routes } = await supabase.from('routes').select('id').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }).limit(1);

    if (routes && routes.length > 0) {
      routeId = routes[0].id;
    } else {
      const { data: newRoute } = await supabase.from('routes').insert({
        id: uuidv4(),
        vehicle_id: vehicleId,
        status: 'active',
        total_distance_km: 0,
        total_duration_minutes: 0,
        estimated_fuel_liters: 0,
        weather_condition: 'clear',
        traffic_delay_minutes: 0,
        waypoints: []
      }).select().single();
      routeId = newRoute?.id;
    }

    if (routeId && vehicle?.latitude && vehicle?.longitude) {
      // Where the truck is heading: its last stop still to do, if it has a route with stops
      const { data: stops } = await supabase
        .from('route_stops').select('sequence, delivery_points(latitude, longitude)')
        .eq('route_id', routeId).eq('status', 'pending').order('sequence', { ascending: false }).limit(1);
      const last = one<any>((stops ?? [])[0]?.delivery_points);
      const dest = point(last?.latitude, last?.longitude);
      import('./vendor.service').then(({ vendorService }) => {
        vendorService.matchRouteToVendors(
          routeId,
          vehicleId,
          vehicle.latitude!,
          vehicle.longitude!,
          isValidPoint(dest) ? dest.lat : null,
          isValidPoint(dest) ? dest.lng : null,
        ).catch(console.error);
      });
    }
  },

  /**
   * The one way a bidding window is opened: by the driver's toggle, the driver's
   * "open backhaul" button, the return-trip screen and the staff console or wizard.
   * The vehicle must be in an operating status with free capacity and not already
   * be offering space. Opens now for DEFAULT_WINDOW_MINUTES unless told otherwise.
   */
  async openWindow(input: OpenWindowInput) {
    const { vehicleId, triggerType, shipmentId } = input;
    const floorPrice = input.floorPrice ?? null;
    if (floorPrice !== null && (!Number.isFinite(floorPrice) || floorPrice < 0)) throw new HttpError(400, 'floor_price must be zero or more');
    const opensAt = input.opensAt ? new Date(input.opensAt) : new Date();
    if (Number.isNaN(opensAt.getTime())) throw new HttpError(400, 'The window start is not a valid date and time');
    let closesAt: Date;
    if (input.closesAt) {
      closesAt = new Date(input.closesAt);
      if (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= opensAt.getTime()) throw new HttpError(400, 'The window must end after it starts');
    } else {
      const durationMinutes = input.durationMinutes ?? DEFAULT_WINDOW_MINUTES;
      if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 24 * 60) {
        throw new HttpError(400, 'duration_minutes must be a whole number from 5 to 1440');
      }
      closesAt = new Date(opensAt.getTime() + durationMinutes * 60_000);
    }

    const { data: vehicle, error: vehicleErr } = await supabase
      .from('vehicles').select('id, plate_number, status, capacity_kg, current_load_kg, available_capacity_kg').eq('id', vehicleId).maybeSingle();
    if (vehicleErr) throw new Error(`Failed to load vehicle: ${vehicleErr.message}`);
    if (!vehicle) throw new HttpError(404, 'Vehicle not found');
    if (!isDispatchable(vehicle)) {
      throw new HttpError(409, `This vehicle is ${vehicle.status === 'maintenance' || vehicle.status === 'archived' ? `in ${vehicle.status}` : 'not ready for dispatch'} and can't offer space.`);
    }
    if (freeCapacityKg(vehicle) <= 0) throw new HttpError(400, 'This vehicle has no free capacity to offer');

    if (shipmentId) {
      const { data: shipment, error: shipmentErr } = await supabase.from('shipments').select('id').eq('id', shipmentId).maybeSingle();
      if (shipmentErr) throw new Error(`Failed to load shipment: ${shipmentErr.message}`);
      if (!shipment) throw new HttpError(404, 'Shipment not found');
    }

    if (await findOpenWindow(vehicleId)) throw new HttpError(409, 'This vehicle already has an open bidding window');

    const { data: window, error } = await supabase.from('capacity_windows').insert({
      vehicle_id: vehicleId,
      opens_at: opensAt.toISOString(),
      closes_at: closesAt.toISOString(),
      floor_price: floorPrice,
      trigger_type: triggerType,
      status: 'open',
      fallback_shipment_id: shipmentId || null,
      ...(input.createdBy ? { created_by: input.createdBy } : {}),
    }).select().single();
    if (error) throw new Error(error.message);

    const { error: flagErr } = await supabase
      .from('vehicles').update({ bidding_window_open: true, bidding_window_closes_at: closesAt.toISOString() }).eq('id', vehicleId);
    if (flagErr) console.error(`[capacity] Failed to flag vehicle ${vehicleId} as bidding: ${flagErr.message}`);
    if (input.notifyVendors !== false && opensAt.getTime() <= Date.now() + 60_000) {
      notify(() => notifyVendorsOfWindow(window, vehicleId));
    }
    return window;
  },

  /**
   * Kept for callers that still use the old name (the shipment wizard): the same as openWindow,
   * with the times given as text. The capacity argument is ignored: a window offers what the vehicle has free.
   * Those callers do not wait for or catch the result, so a refusal (vehicle busy, already bidding) is
   * logged and returns null instead of becoming an unhandled rejection.
   */
  async openBackhaulWindow(
    vehicleId: string,
    _availableCapacityKg: number,
    triggerType: WindowTrigger,
    customOpensAt?: string,
    customClosesAt?: string,
    customFloorPrice?: number,
    sourceShipmentId?: string,
  ) {
    try {
      return await this.openWindow({
        vehicleId, triggerType, opensAt: customOpensAt, closesAt: customClosesAt,
        floorPrice: customFloorPrice ?? null, shipmentId: sourceShipmentId,
      });
    } catch (e) {
      console.error(`[capacity] Could not open a window on vehicle ${vehicleId}:`, e instanceof Error ? e.message : e);
      return null;
    }
  },

  /**
   * Staff open a bidding window on a vehicle from the console: they choose the
   * minimum bid and how long it stays open. The capacity offered is what the vehicle has free.
   */
  async openWindowForStaff(input: { vehicleId: string; floorPrice: number; durationMinutes: number; shipmentId?: string | null; createdBy?: string | null }) {
    if (!Number.isFinite(input.floorPrice) || input.floorPrice < 0) throw new HttpError(400, 'floor_price must be zero or more');
    return this.openWindow({
      vehicleId: input.vehicleId,
      triggerType: 'superadmin_dispatch',
      floorPrice: input.floorPrice,
      durationMinutes: input.durationMinutes,
      shipmentId: input.shipmentId,
      createdBy: input.createdBy,
    });
  },

  /**
   * Windows for the console: recent first, with the vehicle, the linked shipment and how many bids wait.
   */
  async listWindowsForStaff(limit = 50) {
    const { data, error } = await supabase
      .from('capacity_windows')
      .select('id, vehicle_id, opens_at, closes_at, floor_price, winning_bid_id, fallback_shipment_id, trigger_type, status, resolved_at, vehicles(plate_number, vehicle_type, available_capacity_kg)')
      .order('opens_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Failed to load windows: ${error.message}`);
    const windows = data ?? [];
    const ids = windows.map((w: any) => w.id);
    const shipmentIds = windows.map((w: any) => w.fallback_shipment_id).filter(Boolean);

    const [bids, shipments] = await Promise.all([
      ids.length
        ? supabase.from('capacity_bids').select('id, window_id, status').in('window_id', ids)
        : Promise.resolve({ data: [], error: null } as any),
      shipmentIds.length
        ? supabase.from('shipments').select('id, tracking_id').in('id', shipmentIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (bids.error) throw new Error(`Failed to load bid counts: ${bids.error.message}`);
    if (shipments.error) throw new Error(`Failed to load linked shipments: ${shipments.error.message}`);

    const counts = new Map<string, { total: number; pending: number }>();
    for (const b of bids.data ?? []) {
      const c = counts.get(b.window_id) ?? { total: 0, pending: 0 };
      c.total += 1;
      if (b.status === 'pending') c.pending += 1;
      counts.set(b.window_id, c);
    }
    const tracking = new Map((shipments.data ?? []).map((s: any) => [s.id, s.tracking_id]));

    const now = Date.now();
    return windows.map((w: any) => ({
      ...w,
      vehicles: one(w.vehicles),
      // A window past its end that the scheduler has not closed yet counts as closed
      state: w.status !== 'open' ? w.status : (w.winning_bid_id || new Date(w.closes_at).getTime() <= now ? 'closed' : 'open'),
      bid_count: counts.get(w.id)?.total ?? 0,
      pending_bid_count: counts.get(w.id)?.pending ?? 0,
      shipment_tracking_id: w.fallback_shipment_id ? tracking.get(w.fallback_shipment_id) ?? null : null,
    }));
  },

  /**
   * Ends a window. Safe to call twice: only a window that is still 'open' is changed.
   *   - 'closed': stops new bids. Pending bids stay for staff to approve or reject
   *     (they expire STALE_BID_HOURS later if nobody decides).
   *   - 'cancelled': stops new bids and turns pending bids down.
   * Returns null when the window was already closed or cancelled.
   */
  async endWindow(windowId: string, mode: 'closed' | 'cancelled') {
    const nowIso = new Date().toISOString();
    const { data: window, error } = await supabase
      .from('capacity_windows')
      .update({ status: mode, resolved_at: nowIso, closes_at: nowIso })
      .eq('id', windowId)
      .eq('status', 'open')
      .select('id, vehicle_id, winning_bid_id')
      .maybeSingle();
    if (error) throw new Error(`Failed to end window ${windowId}: ${error.message}`);
    if (!window) return null;

    // The vehicle stops advertising unless a different window is still running for it
    const { data: others } = await supabase
      .from('capacity_windows').select('id')
      .eq('vehicle_id', window.vehicle_id).eq('status', 'open').is('winning_bid_id', null)
      .gt('closes_at', nowIso);
    if (!others || others.length === 0) {
      const { error: flagErr } = await supabase
        .from('vehicles').update({ bidding_window_open: false, bidding_window_closes_at: null }).eq('id', window.vehicle_id);
      if (flagErr) console.error(`[capacity] Failed to clear bidding flag on ${window.vehicle_id}: ${flagErr.message}`);
    }

    if (mode === 'cancelled') {
      const { data: turnedDown, error: bidErr } = await supabase
        .from('capacity_bids')
        .update({ status: 'rejected', rejection_reason: 'The bidding window was cancelled' })
        .eq('window_id', windowId)
        .eq('status', 'pending')
        .select('id, vendor_id, bid_amount');
      if (bidErr) throw new Error(`Failed to reject bids on window ${windowId}: ${bidErr.message}`);
      for (const bid of turnedDown ?? []) {
        notify(() => notificationService.sendNotification(
          bid.vendor_id, 'Rejected',
          `Your bid of ${formatINR(bid.bid_amount)} was not accepted. The bidding window was cancelled.`,
          'bid_rejected', { bid_id: bid.id },
        ));
      }
    }
    return window;
  },

  /**
   * Scheduler step for one window: closes it, and tells staff if bids are waiting
   * for a decision. Idempotent (see endWindow); returns false if it was already ended.
   */
  async resolveWindow(windowId: string) {
    const closed = await this.endWindow(windowId, 'closed');
    if (!closed) return false;
    const { data: pending } = await supabase
      .from('capacity_bids').select('id').eq('window_id', windowId).eq('status', 'pending');
    if (pending && pending.length > 0) {
      notify(() => notificationService.notifyStaff(
        'Bidding window closed',
        `A bidding window has closed with ${pending.length} bid${pending.length === 1 ? '' : 's'} waiting for your decision.`,
        'capacity_window_closed',
        { window_id: windowId },
      ));
    }
    return true;
  },

  /**
   * Bids nobody decided: pending bids on a window that closed more than STALE_BID_HOURS ago
   * become `expired` and their vendors are told, so a bid is never left pending forever.
   * Returns how many expired.
   */
  async expireStaleBids() {
    const cutoff = new Date(Date.now() - STALE_BID_HOURS * 3600_000).toISOString();
    const { data: windows, error } = await supabase
      .from('capacity_windows').select('id, resolved_at').eq('status', 'closed').lt('resolved_at', cutoff);
    if (error) throw new Error(`Failed to load closed windows: ${error.message}`);
    const old = (windows ?? []).filter((w: any) => w.resolved_at && w.resolved_at < cutoff).map((w: any) => w.id);
    if (old.length === 0) return 0;
    const { data: expired, error: bidErr } = await supabase
      .from('capacity_bids')
      .update({ status: 'expired', rejection_reason: 'The bidding window closed before this bid was decided' })
      .in('window_id', old)
      .eq('status', 'pending')
      .select('id, vendor_id, bid_amount');
    if (bidErr) throw new Error(`Failed to expire bids: ${bidErr.message}`);
    for (const bid of expired ?? []) {
      notify(() => notificationService.sendNotification(
        bid.vendor_id, 'Expired',
        `Your bid of ${formatINR(bid.bid_amount)} expired: the bidding window closed before it was decided. You can bid again on a new window.`,
        'bid_expired', { bid_id: bid.id },
      ));
    }
    return (expired ?? []).length;
  },

  /**
   * Scheduler: closes every open window whose end time has passed, then expires bids that
   * waited too long. Returns how many windows it closed.
   */
  async resolveExpiredWindows() {
    const { data, error } = await supabase
      .from('capacity_windows')
      .select('id')
      .eq('status', 'open')
      .lte('closes_at', new Date().toISOString());
    if (error) throw new Error(`Failed to load expired windows: ${error.message}`);
    let closed = 0;
    for (const w of data ?? []) {
      try {
        if (await this.resolveWindow(w.id)) closed += 1;
      } catch (e: any) {
        console.error(`[capacity] Failed to close window ${w.id}: ${e.message}`);
      }
    }
    try {
      await this.expireStaleBids();
    } catch (e: any) {
      console.error(`[capacity] Failed to expire stale bids: ${e.message}`);
    }
    return closed;
  },

  /**
   * Staff approve a bid: the vendor wins the truck's space.
   *   - checks first (no writes): the vendor has a pickup location, the vehicle has room
   *   - the bid and window are claimed; the other pending bids lose
   *   - the vehicle's free capacity drops by the bid's weight
   *   - a NEW shipment is made for the bid (the window's standby shipment is left alone),
   *     carrying the e-way bill and load configuration
   *   - a cargo manifest and a route with two stops, pickup at the vendor and then the drop-off,
   *     each with a planned arrival, plus the driver's confirmation prompt
   * If a step fails, what was written is undone and the bid goes back to pending.
   */
  async approveBid(bidId: string) {
    // 0. Read and check before changing anything
    const { data: pre, error: preErr } = await supabase.from('capacity_bids').select('*').eq('id', bidId).maybeSingle();
    if (preErr) throw new Error(`Failed to load bid ${bidId}: ${preErr.message}`);
    if (!pre) throw new HttpError(404, 'Bid not found');
    if (pre.status !== 'pending') throw new HttpError(409, `Bid is already ${pre.status}`);

    const [{ data: vendor }, { data: preWindow }] = await Promise.all([
      supabase.from('vendor_profiles').select('company_name, address, city, latitude, longitude').eq('id', pre.vendor_id).maybeSingle(),
      supabase.from('capacity_windows').select('id, vehicle_id, status, winning_bid_id, fallback_shipment_id').eq('id', pre.window_id).maybeSingle(),
    ]);
    const pickupAt = point(vendor?.latitude, vendor?.longitude);
    if (!isValidPoint(pickupAt)) {
      // Tell the vendor how to fix it, once per bid
      notify(() => notificationService.sendNotificationOnce(
        pre.vendor_id,
        'Add your pickup location',
        'Your bid could not be awarded because your company profile has no pickup location. Add it so the truck knows where to come.',
        'vendor_profile_incomplete',
        { bid_id: bidId, window_id: pre.window_id, missing: 'location' },
        'bid_id',
      ));
      throw new HttpError(400, "This vendor has no pickup location on their profile, so the truck can't be routed to them. The vendor has been asked to add one.", {
        code: 'vendor_location_missing',
        vendor_id: pre.vendor_id,
        vendor_name: vendor?.company_name ?? null,
      });
    }
    if (preWindow?.status === 'cancelled') throw new HttpError(409, 'This bidding window was cancelled');
    const { data: vehicle } = preWindow
      ? await supabase.from('vehicles').select('id, latitude, longitude, available_capacity_kg, current_location_name, driver_id').eq('id', preWindow.vehicle_id).maybeSingle()
      : { data: null };
    const weightKg = Number(pre.weight_kg) || 0;
    if (vehicle?.available_capacity_kg != null && weightKg > Number(vehicle.available_capacity_kg)) {
      throw new HttpError(409, `This bid is for ${weightKg} kg but the vehicle has only ${vehicle.available_capacity_kg} kg free now`);
    }

    // 1. Claim the bid: only a pending bid can be approved, and only once.
    // The conditional update is atomic per row, so concurrent approvals
    // (double clicks, retries) cannot both proceed.
    const { data: bid, error: claimErr } = await supabase
      .from('capacity_bids')
      .update({ status: 'won' })
      .eq('id', bidId)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (claimErr) throw new Error(`Failed to claim bid ${bidId}: ${claimErr.message}`);
    if (!bid) {
      const { data: existing } = await supabase.from('capacity_bids').select('status').eq('id', bidId).maybeSingle();
      if (!existing) throw new HttpError(404, 'Bid not found');
      throw new HttpError(409, `Bid is already ${existing.status}`);
    }

    const windowId = bid.window_id;

    // 2. Claim the window for this bid; another bid may already have won it
    const nowIso = new Date().toISOString();
    const { data: window, error: windowErr } = await supabase
      .from('capacity_windows')
      .update({ winning_bid_id: bidId, status: 'closed', resolved_at: nowIso })
      .eq('id', windowId)
      .is('winning_bid_id', null)
      .neq('status', 'cancelled')
      .select('*')
      .maybeSingle();
    if (windowErr || !window) {
      // Release the claim: retryable on a database error, lost if another bid won
      await supabase.from('capacity_bids').update({ status: windowErr ? 'pending' : 'lost' }).eq('id', bidId);
      if (windowErr) throw new Error(`Failed to claim window ${windowId}: ${windowErr.message}`);
      throw new HttpError(409, 'Another bid has already won this window');
    }

    // 3. Remaining pending bids on the window lose
    const { data: losingBids, error: loseErr } = await supabase
      .from('capacity_bids')
      .update({ status: 'lost' })
      .eq('window_id', windowId)
      .eq('status', 'pending')
      .select('id, vendor_id');
    if (loseErr) throw new Error(`Failed to close other bids: ${loseErr.message}`);

    // Everything below is undone (newest first) if a step fails
    const undo: Array<() => Promise<unknown>> = [
      async () => { await supabase.from('capacity_bids').update({ status: 'pending' }).eq('id', bidId); },
      async () => {
        await supabase.from('capacity_windows')
          .update({ winning_bid_id: null, status: preWindow?.status ?? 'open', resolved_at: null }).eq('id', windowId);
      },
      async () => {
        const ids = (losingBids ?? []).map((b: any) => b.id);
        if (ids.length) await supabase.from('capacity_bids').update({ status: 'pending' }).in('id', ids);
      },
    ];

    try {
      // 4. The space the bid takes is no longer free (only its weight, not the whole truck)
      const freeBefore = Number(vehicle?.available_capacity_kg) || 0;
      const { error: capErr } = await supabase.from('vehicles')
        .update({ available_capacity_kg: Math.max(0, freeBefore - weightKg) }).eq('id', window.vehicle_id);
      if (capErr) throw new Error(`Failed to update vehicle capacity: ${capErr.message}`);
      undo.push(async () => { await supabase.from('vehicles').update({ available_capacity_kg: freeBefore }).eq('id', window.vehicle_id); });

      // 5. A separate shipment for this bid, in the vendor's name. The window's standby shipment is not touched.
      const vendorOriginName = vendor?.company_name || 'Vendor pickup';
      const vendorOriginAddress = vendor?.address || vendor?.city || vendorOriginName;
      let standbyPriority: string | null = null;
      if (window.fallback_shipment_id) {
        const { data: standby } = await supabase.from('shipments').select('priority').eq('id', window.fallback_shipment_id).maybeSingle();
        standbyPriority = standby?.priority ?? null;
      }
      const { data: shipment, error: shipErr } = await supabase.from('shipments').insert({
        tracking_id: 'RTX-' + bid.id.slice(0, 7).toUpperCase(),
        status: 'assigned',
        ...(standbyPriority ? { priority: standbyPriority } : {}),
        origin_name: vendorOriginName,
        origin_address: vendorOriginAddress,
        origin_lat: pickupAt.lat,
        origin_lng: pickupAt.lng,
        total_items: 1,
        total_weight_kg: bid.weight_kg,
        bid_id: bid.id,
        metadata: {
          source: 'capacity_bid',
          window_id: windowId,
          eway_bill_ref: bid.eway_bill_ref ?? null,
          load_configuration: bid.load_configuration ?? null,
        },
      }).select('id').single();
      if (shipErr || !shipment) throw new Error(`Failed to create shipment for bid ${bid.id}: ${shipErr?.message}`);
      const shipmentId: string = shipment.id;
      undo.push(async () => { await supabase.from('shipments').delete().eq('id', shipmentId); });

      // The vendor's drop-off point belongs to the new shipment
      let drop: { id: string; name: string | null; address: string | null; latitude: number | null; longitude: number | null } | null = null;
      if (bid.dropoff_point_id) {
        const { data: dp } = await supabase.from('delivery_points')
          .update({ shipment_id: shipmentId }).eq('id', bid.dropoff_point_id)
          .select('id, name, address, latitude, longitude').maybeSingle();
        drop = dp ?? null;
        undo.push(async () => { await supabase.from('delivery_points').update({ shipment_id: null }).eq('id', bid.dropoff_point_id); });
      }

      // 6. The manifest that shows the load on the dashboard and on the driver's screen
      const { data: manifest, error: manifestErr } = await supabase.from('cargo_manifest').insert({
        vehicle_id: window.vehicle_id,
        pickup_location: vendorOriginAddress,
        pickup_lat: pickupAt.lat,
        pickup_lng: pickupAt.lng,
        drop_location: drop ? (drop.address || drop.name || '') : '',
        drop_lat: drop?.latitude ?? null,
        drop_lng: drop?.longitude ?? null,
        capacity_kg: bid.weight_kg,
        status: 'scheduled'
      }).select('id').single();
      if (manifestErr || !manifest) throw new Error(`Failed to create manifest for bid ${bid.id}: ${manifestErr?.message}`);
      undo.push(async () => { await supabase.from('cargo_manifest').delete().eq('id', manifest.id); });

      // 7. Route stops: pickup at the vendor, then the drop-off, with planned arrivals
      let stopIds: { pickupStopId: string; dropStopId: string; pickupPointId: string } | null = null;
      if (drop) {
        let { data: route } = await supabase.from('routes')
          .select('id')
          .eq('vehicle_id', window.vehicle_id)
          .in('status', ['pending', 'active'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!route) {
          const routeId = uuidv4();
          const { error: routeErr } = await supabase.from('routes').insert({
            id: routeId,
            vehicle_id: window.vehicle_id,
            status: 'active',
            total_distance_km: 0,
            total_duration_minutes: 0,
            estimated_fuel_liters: 0,
            weather_condition: 'clear',
            traffic_delay_minutes: 0,
            waypoints: []
          });
          if (routeErr) throw new Error(`Failed to create route for vehicle ${window.vehicle_id}: ${routeErr.message}`);
          route = { id: routeId };
          undo.push(async () => { await supabase.from('routes').delete().eq('id', routeId); });
        }

        const { data: pendingStops } = await supabase.from('route_stops')
          .select('id, sequence')
          .eq('route_id', route.id)
          .eq('status', 'pending')
          .order('sequence', { ascending: true });

        let insertSequence = 1;
        if (pendingStops && pendingStops.length > 0) {
          // The new pickup and drop-off go in front of what is still to do; the rest moves back by two
          insertSequence = pendingStops[0].sequence;
          for (const stop of [...pendingStops].reverse()) {
            await supabase.from('route_stops').update({ sequence: stop.sequence + 2 }).eq('id', stop.id);
          }
          undo.push(async () => {
            for (const stop of pendingStops) await supabase.from('route_stops').update({ sequence: stop.sequence }).eq('id', stop.id);
          });
        } else {
          const { data: allStops } = await supabase.from('route_stops')
            .select('sequence')
            .eq('route_id', route.id)
            .order('sequence', { ascending: false })
            .limit(1);
          if (allStops && allStops.length > 0) insertSequence = allStops[0].sequence + 1;
        }

        // Planned arrival: from the truck to the vendor, then the time on site, then on to the drop-off
        const truckAt = point(vehicle?.latitude, vehicle?.longitude);
        const toPickup = travelMinutes(truckAt, pickupAt);
        const pickupArrival = toPickup === null ? null : new Date(Date.now() + toPickup * 60_000);
        const toDrop = travelMinutes(pickupAt, point(drop.latitude, drop.longitude));
        const dropArrival = pickupArrival && toDrop !== null
          ? new Date(pickupArrival.getTime() + (PICKUP_SERVICE_MINUTES + toDrop) * 60_000)
          : null;

        const { data: pickupPoint, error: ppErr } = await supabase.from('delivery_points').insert({
          name: `Pickup: ${vendorOriginName}`,
          address: vendorOriginAddress,
          latitude: pickupAt.lat,
          longitude: pickupAt.lng,
          demand_kg: 0,
        }).select('id').single();
        if (ppErr || !pickupPoint) throw new Error(`Failed to add the pickup point: ${ppErr?.message}`);
        undo.push(async () => { await supabase.from('delivery_points').delete().eq('id', pickupPoint.id); });

        const pickupStopId = uuidv4();
        const dropStopId = uuidv4();
        const { error: stopErr } = await supabase.from('route_stops').insert([
          { id: pickupStopId, route_id: route.id, delivery_point_id: pickupPoint.id, sequence: insertSequence, status: 'pending', planned_arrival_at: pickupArrival?.toISOString() ?? null },
          { id: dropStopId, route_id: route.id, delivery_point_id: drop.id, sequence: insertSequence + 1, status: 'pending', planned_arrival_at: dropArrival?.toISOString() ?? null },
        ]);
        if (stopErr) throw new Error(`Failed to add route stops: ${stopErr.message}`);
        undo.push(async () => { await supabase.from('route_stops').delete().in('id', [pickupStopId, dropStopId]); });
        stopIds = { pickupStopId, dropStopId, pickupPointId: pickupPoint.id };

        // Trigger driver confirmation for the new stops (prompted on the drop-off, which the shipment owns)
        const { error: confErr } = await supabase.from('driver_confirmations').insert({
          route_stop_id: dropStopId,
          vehicle_id: window.vehicle_id,
          prompted_at: new Date().toISOString()
        });
        if (confErr) throw new Error(`Failed to create driver confirmation: ${confErr.message}`);
      }

      // Keep where things went, so a flagged stop can be taken back
      await supabase.from('shipments').update({
        metadata: {
          source: 'capacity_bid',
          window_id: windowId,
          eway_bill_ref: bid.eway_bill_ref ?? null,
          load_configuration: bid.load_configuration ?? null,
          manifest_id: manifest.id,
          ...(stopIds ? { pickup_point_id: stopIds.pickupPointId, pickup_stop_id: stopIds.pickupStopId, drop_stop_id: stopIds.dropStopId } : {}),
        },
      }).eq('id', shipmentId);

      // 8. The window is over: the vehicle stops advertising
      await supabase.from('vehicles').update({ bidding_window_open: false, bidding_window_closes_at: null }).eq('id', window.vehicle_id);

      notify(() => notificationService.sendNotification(
        bid.vendor_id,
        'Approved',
        `Your bid of ${formatINR(bid.bid_amount)} for ${formatKg(bid.weight_kg)} was approved. The truck has been routed to your pickup.`,
        'bid_accepted',
        { bid_id: bid.id, shipment_id: shipmentId, window_id: windowId }
      ));
      if (vehicle?.driver_id) {
        notify(() => notificationService.sendNotification(
          vehicle.driver_id,
          'New pickup added',
          `A pickup at ${vendorOriginName} and a drop-off were added to your route.`,
          'cargo_assigned',
          { vehicle_id: window.vehicle_id, shipment_id: shipmentId }
        ));
      }
      for (const lost of losingBids ?? []) {
        notify(() => notificationService.sendNotification(
          lost.vendor_id,
          'Not selected',
          'Another bid was accepted for this truck. Watch Live Corridors for new capacity.',
          'bid_lost',
          { bid_id: lost.id }
        ));
      }

      return { ...bid, shipment_id: shipmentId };
    } catch (e) {
      // Undo newest first; keep going if an undo step fails
      for (const step of undo.reverse()) {
        try { await step(); } catch (undoErr) { console.error('[capacity] Undo after failed approval failed:', undoErr); }
      }
      throw e;
    }
  },

  /**
   * Inner timer start (client acks delivery of prompt)
   */
  async ackStopDelivery(confirmationId: string) {
    // Only the first acknowledgement counts, and not once the driver has answered
    const { error } = await supabase
      .from('driver_confirmations')
      .update({ delivered_at: new Date().toISOString() })
      .eq('id', confirmationId)
      .is('delivered_at', null)
      .is('action', null);

    if (error) throw new Error(error.message);
  },

  /**
   * Superadmin manually rejects a backhaul bid
   */
  async rejectBid(bidId: string, reason: string) {
    const { data: bid, error: rejectErr } = await supabase
      .from('capacity_bids')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', bidId)
      .eq('status', 'pending')
      .select('id, vendor_id, bid_amount')
      .maybeSingle();
    if (rejectErr) throw new Error(`Failed to reject bid ${bidId}: ${rejectErr.message}`);
    if (!bid) {
      const { data: existing } = await supabase.from('capacity_bids').select('status').eq('id', bidId).maybeSingle();
      if (!existing) throw new HttpError(404, 'Bid not found');
      throw new HttpError(409, `Bid is already ${existing.status}`);
    }

    notify(() => notificationService.sendNotification(
      bid.vendor_id,
      'Rejected',
      `Your bid of ${formatINR(bid.bid_amount)} was not accepted. Reason: ${reason}`,
      'bid_rejected',
      { bid_id: bid.id }
    ));
    return { id: bidId, status: 'rejected', rejection_reason: reason };
  },

  /**
   * The driver flags a prompted stop. Staff are told; if the stop belongs to an awarded
   * bid, the award is taken back (see revokeAward) so the vendor is not left waiting for a truck
   * that is not coming.
   */
  async flagStop(confirmationId: string) {
    await this.answerConfirmation(confirmationId, 'flagged');
    try {
      await this.handleFlaggedStop(confirmationId);
    } catch (e) {
      console.error('[capacity] Handling a flagged stop failed:', e);
    }
  },

  /** What follows a driver flagging a stop: tell staff, and take back an awarded bid. */
  async handleFlaggedStop(confirmationId: string) {
    const { data: conf } = await supabase.from('driver_confirmations').select('id, route_stop_id, vehicle_id').eq('id', confirmationId).maybeSingle();
    if (!conf) return;
    const { data: vehicle } = await supabase.from('vehicles').select('plate_number').eq('id', conf.vehicle_id).maybeSingle();
    const plate = vehicle?.plate_number ?? 'a vehicle';

    const { data: stop } = await supabase.from('route_stops').select('id, delivery_point_id').eq('id', conf.route_stop_id).maybeSingle();
    const { data: dp } = stop?.delivery_point_id
      ? await supabase.from('delivery_points').select('id, shipment_id').eq('id', stop.delivery_point_id).maybeSingle()
      : { data: null };
    const { data: shipment } = dp?.shipment_id
      ? await supabase.from('shipments').select('id, tracking_id, bid_id, metadata').eq('id', dp.shipment_id).maybeSingle()
      : { data: null };

    if (!shipment?.bid_id) {
      notify(() => notificationService.notifyStaff(
        'Driver flagged a stop',
        `The driver of ${plate} flagged a stop that was added to the route. Please check it.`,
        'stop_flagged', { confirmation_id: confirmationId, route_stop_id: conf.route_stop_id },
      ));
      return;
    }
    const revoked = await this.revokeAward(shipment.bid_id, 'The driver could not take this stop');
    notify(() => notificationService.notifyStaff(
      'Driver flagged an awarded stop',
      revoked
        ? `The driver of ${plate} flagged the stop for ${shipment.tracking_id}. The award was cancelled and the bidding window is open again.`
        : `The driver of ${plate} flagged the stop for ${shipment.tracking_id}. Please check it.`,
      'stop_flagged', { confirmation_id: confirmationId, bid_id: shipment.bid_id, window_id: revoked?.windowId ?? null },
    ));
  },

  /**
   * Takes back a won bid: the bid is rejected with the reason, its shipment cancelled, its manifest and
   * route stops removed, the vehicle's space given back, and the window opened again for
   * DEFAULT_WINDOW_MINUTES with the bids that lost to it back under review. The vendor is told.
   * Returns null when the bid is not a won bid.
   */
  async revokeAward(bidId: string, reason: string): Promise<{ windowId: string } | null> {
    const { data: bid } = await supabase
      .from('capacity_bids')
      .update({ status: 'rejected', rejection_reason: reason })
      .eq('id', bidId).eq('status', 'won')
      .select('id, vendor_id, window_id, weight_kg, bid_amount')
      .maybeSingle();
    if (!bid) return null;

    const { data: shipment } = await supabase.from('shipments').select('id, metadata').eq('bid_id', bidId).maybeSingle();
    const meta = (shipment?.metadata ?? {}) as Record<string, string | undefined>;
    if (shipment) {
      await supabase.from('shipments').update({ status: 'cancelled' }).eq('id', shipment.id);
      await supabase.from('delivery_points').update({ shipment_id: null }).eq('shipment_id', shipment.id);
    }
    const stopIds = [meta.pickup_stop_id, meta.drop_stop_id].filter(Boolean) as string[];
    if (stopIds.length > 0) {
      await supabase.from('driver_confirmations').delete().in('route_stop_id', stopIds);
      await supabase.from('route_stops').delete().in('id', stopIds);
    }
    if (meta.pickup_point_id) await supabase.from('delivery_points').delete().eq('id', meta.pickup_point_id);
    if (meta.manifest_id) await supabase.from('cargo_manifest').delete().eq('id', meta.manifest_id);

    const { data: window } = await supabase
      .from('capacity_windows').select('id, vehicle_id').eq('id', bid.window_id).maybeSingle();
    if (window) {
      const { data: vehicle } = await supabase.from('vehicles').select('available_capacity_kg, capacity_kg').eq('id', window.vehicle_id).maybeSingle();
      const cap = Number(vehicle?.capacity_kg) || Infinity;
      const freed = Math.min(cap, (Number(vehicle?.available_capacity_kg) || 0) + (Number(bid.weight_kg) || 0));
      const closesAt = new Date(Date.now() + DEFAULT_WINDOW_MINUTES * 60_000).toISOString();
      await supabase.from('capacity_windows')
        .update({ winning_bid_id: null, status: 'open', resolved_at: null, opens_at: new Date().toISOString(), closes_at: closesAt })
        .eq('id', window.id);
      await supabase.from('vehicles')
        .update({ available_capacity_kg: freed, bidding_window_open: true, bidding_window_closes_at: closesAt }).eq('id', window.vehicle_id);
      const { data: back } = await supabase
        .from('capacity_bids').update({ status: 'pending' }).eq('window_id', window.id).eq('status', 'lost').select('id, vendor_id');
      for (const b of back ?? []) {
        notify(() => notificationService.sendNotification(
          b.vendor_id, 'Your bid is back under review',
          'The bid that won this truck was cancelled, so your bid is being considered again.',
          'bid_reopened', { bid_id: b.id },
        ));
      }
    }

    notify(() => notificationService.sendNotification(
      bid.vendor_id, 'Bid cancelled',
      `Your accepted bid of ${formatINR(bid.bid_amount)} was cancelled: ${reason}. You can bid again on other trucks.`,
      'bid_rejected', { bid_id: bid.id },
    ));
    return { windowId: bid.window_id };
  },

  /**
   * The driver answers a stop prompt: 'confirmed' (accepts the new stop) or
   * 'flagged' (sends it back to dispatch). Only a prompt still waiting for an
   * answer can be answered, so a driver cannot undo an answer, and one the
   * timeout already accepted stays accepted.
   */
  async answerConfirmation(confirmationId: string, action: 'confirmed' | 'flagged') {
    const { data, error } = await supabase
      .from('driver_confirmations')
      .update({ responded_at: new Date().toISOString(), action })
      .eq('id', confirmationId)
      .is('action', null)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      const { data: existing } = await supabase.from('driver_confirmations').select('action').eq('id', confirmationId).maybeSingle();
      if (!existing) throw new HttpError(404, 'This prompt no longer exists');
      throw new HttpError(409, 'This prompt was already answered');
    }
  },

  /**
   * Background CRON to check for 2-min inner and 15-min outer timeouts
   */
  async checkConfirmationsTimeout() {
    const now = Date.now();

    const { data: pending, error } = await supabase
      .from('driver_confirmations')
      .select('id, prompted_at, delivered_at')
      .is('responded_at', null)
      .is('action', null);
    if (error) throw new Error(`Failed to load pending confirmations: ${error.message}`);

    for (const conf of pending ?? []) {
      // Inner timer: 2 min after the prompt reached the app; outer: 15 min after it was sent
      const action = conf.delivered_at
        ? (now - new Date(conf.delivered_at).getTime() >= 2 * 60_000 ? 'auto_accepted' : null)
        : (now - new Date(conf.prompted_at).getTime() >= 15 * 60_000 ? 'auto_accepted_offline' : null);
      if (!action) continue;

      // Only if the driver has not answered in the meantime
      const { error: updateErr } = await supabase
        .from('driver_confirmations')
        .update({ action })
        .eq('id', conf.id)
        .is('action', null);
      if (updateErr) console.error(`[capacity] Failed to auto-resolve confirmation ${conf.id}: ${updateErr.message}`);
    }
  }
};
