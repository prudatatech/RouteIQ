/**
 * margixindia — Shipment Service
 * Ports: backend/app/services/shipment_service.py
 */
import { assertDriverDispatchable } from './people-docs.service';
import { HttpError } from '../core/errors';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../core/supabase';
import { formatISTDate } from '../core/format';
import { manifestParcelCode } from '../core/parcelCode';
import { SecurityService } from './security.service';
import { InvoiceService } from './invoice.service';
import { OPERATING_VEHICLE_STATUSES, SHIPMENT_TRANSITIONS, assertTransition } from '../core/transitions';
import { finalDeliveryPoint, sortDeliveryPoints } from '../core/destination';
import { notificationService } from './notification.service';
import type { Shipment, ShipmentLog, Parcel, DeliveryPoint } from '../db/types';
import type { ShipmentCreate } from '../schemas';

const getDist = (lat1: number, lon1: number, lat2: number, lon2: number): string => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return "Pending";
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 1.3).toString();
};

const getETA = (distance: string, createdAt: string): string => {
  if (distance === "Pending" || !createdAt) return "Pending Routing...";
  const dist = parseInt(distance);
  if (isNaN(dist)) return "Pending Routing...";

  // Assume average speed of 40 km/h + 2 hours loading time
  const travelHours = (dist / 40) + 2;

  const date = new Date(createdAt);
  date.setTime(date.getTime() + travelHours * 60 * 60 * 1000);

  return formatISTDate(date);
};

/** Average road speed used for the public arrival estimate (straight-line distance). */
const ETA_AVERAGE_SPEED_KMPH = 40;

/** Straight-line arrival estimate in minutes, or null when a position is missing. */
function estimateEtaMinutes(fromLat?: number | null, fromLng?: number | null, toLat?: number | null, toLng?: number | null): number | null {
  if (fromLat == null || fromLng == null || toLat == null || toLng == null) return null;
  const R = 6371;
  const dLat = ((toLat - fromLat) * Math.PI) / 180;
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((fromLat * Math.PI) / 180) * Math.cos((toLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.round((km / ETA_AVERAGE_SPEED_KMPH) * 60));
}

/** Who made a status change, when it is known. Never fabricated — only set from `req.user`. */
export interface LogActor {
  id: string;
  role: string;
}

/** One event in a shipment's status history, for staff. */
export interface ShipmentHistoryEvent {
  status: string;
  at: string;
  actor: { id: string; name: string | null; role: string | null } | null;
  note: string | null;
  location: { lat: number; lng: number } | null;
}

/** The public-safe cut of a history event: status and time only. */
export interface PublicHistoryEvent {
  status: string;
  at: string;
}

/** Vehicles that have a route stop for any of these delivery points. */
async function vehiclesOnStopsOf(dpIds: string[]): Promise<string[]> {
  if (dpIds.length === 0) return [];
  const { data: stops } = await supabase.from('route_stops').select('route_id').in('delivery_point_id', dpIds);
  const routeIds = Array.from(new Set((stops || []).map((st: any) => st.route_id)));
  if (routeIds.length === 0) return [];
  const { data: routes } = await supabase.from('routes').select('vehicle_id').in('id', routeIds);
  return Array.from(new Set((routes || []).map((r: any) => r.vehicle_id).filter(Boolean)));
}

/**
 * Starts a pending route through the route service, so the vehicle goes on_route,
 * planned arrivals are stamped and the driver is told. A route that cannot be started
 * (the vehicle went into maintenance meanwhile) stays pending for dispatch to start.
 */
async function dispatchRoute(routeId: string): Promise<void> {
  try {
    const { routeService } = await import('./route.service');
    await routeService.changeStatus(routeId, 'active');
  } catch (e) {
    console.error(`[shipment] route ${routeId} could not be dispatched:`, e);
  }
}

/**
 * The one way a shipment becomes `assigned`: whether dispatch picked a vehicle, the shipment
 * was created with one, a customer booking was assigned or the optimizer planned it.
 * Follows the transition rules (a failed delivery can be assigned again), writes the status
 * log with the vehicle and route, and moves the linked customer booking to `assigned`.
 * The caller has already checked the vehicle and created the route stops.
 */
export async function markAssigned(
  shipment: { id: string; status: string; origin_lat?: number | null; origin_lng?: number | null },
  vehicle: { id: string },
  route: { id: string },
  actor?: LogActor | null,
): Promise<void> {
  if (shipment.status !== 'assigned') {
    assertTransition(SHIPMENT_TRANSITIONS, 'shipment', shipment.status, 'assigned');
    const { data: moved, error } = await supabase
      .from('shipments')
      .update({ status: 'assigned' })
      .eq('id', shipment.id)
      .eq('status', shipment.status)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Failed to assign shipment: ${error.message}`);
    if (!moved) throw new HttpError(409, 'This shipment was just changed by someone else. Refresh and try again.');
  }
  await ShipmentService.recordShipmentLog(
    shipment.id, 'assigned', shipment.origin_lat, shipment.origin_lng,
    { vehicle_id: vehicle.id, route_id: route.id }, actor,
  );
  try {
    const { onShipmentStatus } = await import('./customer-bookings.service');
    await onShipmentStatus(shipment.id, 'assigned', { vehicle_id: vehicle.id });
  } catch (e) {
    console.error('Failed to update the customer booking:', e);
  }
}

/**
 * Called when a route is cancelled or deleted: its shipments that have not been picked up go
 * back to `created` (logged, the customer booking back to `confirmed`) and their stops on
 * that route are cancelled, so they can be assigned again. Shipments already picked up,
 * in transit, failed or delivered are left as they are. Returns the ids released.
 */
export async function releaseShipmentsFromRoute(routeId: string, actor?: LogActor | null): Promise<string[]> {
  const { data: route } = await supabase.from('routes').select('vehicle_id').eq('id', routeId).maybeSingle();
  const { data: stops, error } = await supabase.from('route_stops').select('id, delivery_point_id, status').eq('route_id', routeId);
  if (error) throw new Error(`Failed to read the route's stops: ${error.message}`);
  const dpIds = Array.from(new Set((stops || []).map((st: any) => st.delivery_point_id)));
  if (dpIds.length === 0) return [];

  const { data: dps } = await supabase.from('delivery_points').select('id, shipment_id').in('id', dpIds);
  const shipmentIds = Array.from(new Set((dps || []).map((dp: any) => dp.shipment_id).filter(Boolean))) as string[];
  if (shipmentIds.length === 0) return [];
  const { data: shipments } = await supabase.from('shipments').select('id, status, origin_lat, origin_lng').in('id', shipmentIds);

  const released: string[] = [];
  for (const shipment of shipments || []) {
    if (shipment.status !== 'assigned') continue;
    const { data: moved } = await supabase
      .from('shipments')
      .update({ status: 'created' })
      .eq('id', shipment.id)
      .eq('status', 'assigned')
      .select('id')
      .maybeSingle();
    if (!moved) continue;
    released.push(shipment.id);
    await ShipmentService.recordShipmentLog(
      shipment.id, 'created', shipment.origin_lat, shipment.origin_lng,
      { released_from_route: routeId, reason: 'route_cancelled' }, actor,
    );
    try {
      const { onShipmentStatus } = await import('./customer-bookings.service');
      await onShipmentStatus(shipment.id, 'created');
    } catch (e) {
      console.error('Failed to update the customer booking:', e);
    }
    const releasedDpIds = (dps || []).filter((dp: any) => dp.shipment_id === shipment.id).map((dp: any) => dp.id);
    await supabase.from('route_stops').update({ status: 'cancelled' }).eq('route_id', routeId).in('delivery_point_id', releasedDpIds).eq('status', 'pending');
  }
  if (released.length > 0 && route?.vehicle_id) await ShipmentService.recalculateVehicleCapacity(route.vehicle_id);
  return released;
}

/** The vehicle classes the database knows (vehicles.vehicle_type). */
const VEHICLE_CLASSES = ['truck', 'van', 'bike', 'car'] as const;

export class ShipmentService {
  /**
   * Records a tamper-evident log for a shipment status change.
   */
  static async recordShipmentLog(
    shipmentId: string,
    status: string,
    lat?: number | null,
    lng?: number | null,
    metadata?: Record<string, any>,
    actor?: LogActor | null
  ): Promise<ShipmentLog> {
    // 1. Fetch last log to get previous hash and index
    const { data: lastLogs } = await supabase
      .from('shipment_logs')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('index', { ascending: false })
      .limit(1);

    const lastLog = lastLogs?.[0];
    const prevHash = lastLog?.log_hash || '0'.repeat(64);
    const newIndex = lastLog ? lastLog.index + 1 : 0;

    // 2. Prepare data for hashing. The actor (who made this change) is folded into
    // the metadata so it's part of the tamper-evident hash chain too — never a
    // separate, unverified field.
    const fullMetadata = actor ? { ...(metadata || {}), actor_id: actor.id, actor_role: actor.role } : metadata || {};
    const timestamp = new Date().toISOString();
    const data = {
      shipment_id: shipmentId,
      status,
      location_lat: lat ?? null,
      location_lng: lng ?? null,
      timestamp,
      index: newIndex,
      metadata: fullMetadata,
    };

    // 3. Generate hash
    const newHash = SecurityService.generateHash(data, prevHash);

    // 4. Insert log
    const { data: inserted, error } = await supabase
      .from('shipment_logs')
      .insert({
        id: uuidv4(),
        shipment_id: shipmentId,
        status,
        location_lat: lat ?? null,
        location_lng: lng ?? null,
        timestamp,
        index: newIndex,
        previous_hash: prevHash,
        log_hash: newHash,
        metadata_json: fullMetadata,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record shipment log: ${error.message}`);
    return inserted as ShipmentLog;
  }

  /**
   * Kilograms of load a vehicle is carrying or has been given: shipments that are
   * created, assigned, picked up, in transit or failed (exception) and still on one of
   * its pending or active routes. `excludeShipmentId` leaves one shipment out, for
   * checking whether it would fit.
   */
  static async activeLoadKg(vehicleId: string, excludeShipmentId?: string): Promise<number> {
    const { data: routes } = await supabase
      .from('routes')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .in('status', ['active', 'pending']);
    if (!routes || routes.length === 0) return 0;

    // A failed stop belongs to an exception shipment whose load is still on the vehicle
    const { data: stops } = await supabase
      .from('route_stops')
      .select('delivery_point_id')
      .in('route_id', routes.map((r: any) => r.id))
      .in('status', ['pending', 'failed']);
    if (!stops || stops.length === 0) return 0;

    const { data: dps } = await supabase
      .from('delivery_points')
      .select('shipment_id')
      .in('id', stops.map((s: any) => s.delivery_point_id));
    const shipmentIds = Array.from(new Set((dps || []).map((dp: any) => dp.shipment_id).filter((id: any) => id && id !== excludeShipmentId)));
    if (shipmentIds.length === 0) return 0;

    const { data: shipments } = await supabase
      .from('shipments')
      .select('total_weight_kg')
      .in('id', shipmentIds as string[])
      .in('status', [...ShipmentService.LOAD_STATUSES]);
    return (shipments || []).reduce((sum: number, s: any) => sum + (Number(s.total_weight_kg) || 0), 0);
  }

  /** Shipment statuses whose weight counts against the vehicle carrying them. */
  static readonly LOAD_STATUSES = ['created', 'assigned', 'picked_up', 'in_transit', 'exception'] as const;

  /**
   * Recalculates available capacity for a specific vehicle based on active shipments.
   * A vehicle in maintenance or archived is never moved, and one with a running route
   * stays on_route; only a vehicle stuck on_route with nothing left to run is freed.
   */
  static async recalculateVehicleCapacity(vehicleId: string): Promise<void> {
    if (!vehicleId) return;

    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('capacity_kg')
      .eq('id', vehicleId)
      .single();
    if (!vehicle) return;

    const totalLoad = await ShipmentService.activeLoadKg(vehicleId);
    const available = Math.max(0, vehicle.capacity_kg - totalLoad);

    await supabase
      .from('vehicles')
      .update({ available_capacity_kg: available, capacity_updated_at: new Date().toISOString() })
      .eq('id', vehicleId);

    if (available === vehicle.capacity_kg) {
      const { data: running } = await supabase.from('routes').select('id').eq('vehicle_id', vehicleId).eq('status', 'active').limit(1);
      if (!running || running.length === 0) {
        await supabase.from('vehicles').update({ status: 'available' }).eq('id', vehicleId).eq('status', 'on_route');
      }
    }
  }

  /**
   * The one check every way of putting a shipment on a vehicle goes through: the vehicle
   * must be in service, be the type the load asks for, and have room for it.
   */
  static async assertVehicleCanTake(vehicleId: string, weightKg: number, requiredType?: string | null, excludeShipmentId?: string): Promise<void> {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, status, vehicle_type, capacity_kg')
      .eq('id', vehicleId)
      .maybeSingle();
    if (!vehicle) throw new HttpError(404, 'Vehicle not found');
    if (!(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(vehicle.status))) {
      throw new HttpError(409, `That vehicle is in ${vehicle.status} and can't take a shipment.`);
    }
    // Vehicles have a plain class (truck, van, ...); a booking may name a marketing model instead
    // ("Tata Ace"), which cannot be compared, so only a class is enforced (capacity covers the rest).
    const isClass = !!requiredType && (VEHICLE_CLASSES as readonly string[]).includes(requiredType.toLowerCase());
    if (isClass && vehicle.vehicle_type && String(vehicle.vehicle_type).toLowerCase() !== requiredType!.toLowerCase()) {
      throw new HttpError(409, `This load needs a ${requiredType}, and that vehicle is a ${vehicle.vehicle_type}.`);
    }
    // Blocks only when the driver_document_enforcement setting is 'block'
    await assertDriverDispatchable(vehicleId);
    const capacity = Number(vehicle.capacity_kg);
    if (weightKg > 0 && capacity > 0) {
      const free = capacity - (await ShipmentService.activeLoadKg(vehicleId, excludeShipmentId));
      if (weightKg > free) {
        throw new HttpError(409, `That vehicle has ${Math.max(0, Math.round(free))} kg free and this load is ${Math.round(weightKg)} kg.`);
      }
    }
  }

  /**
   * Create a new shipment with parcels.
   */
  static async createShipment(shipmentIn: ShipmentCreate, actor?: LogActor | null): Promise<Shipment> {
    const trackingId = shipmentIn.tracking_id || `RTX-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`;

    // A load put on a vehicle at creation must fit that vehicle, like any other assignment
    if (shipmentIn.vehicle_id && !shipmentIn.open_bidding) {
      await ShipmentService.assertVehicleCanTake(shipmentIn.vehicle_id, Number(shipmentIn.total_weight_kg) || 0);
    }

    // 1. Insert shipment
    const shipmentId = uuidv4();
    const { data: dbShipment, error: shipErr } = await supabase
      .from('shipments')
      .insert({
        id: shipmentId,
        tracking_id: trackingId,
        priority: shipmentIn.priority,
        status: 'created',
        origin_name: shipmentIn.origin_name,
        origin_address: shipmentIn.origin_address,
        origin_lat: shipmentIn.origin_lat,
        origin_lng: shipmentIn.origin_lng,
        total_items: shipmentIn.total_items,
        total_weight_kg: shipmentIn.total_weight_kg,
        freight_charge: shipmentIn.freight_charge ?? null,
        metadata: shipmentIn.metadata ?? {},
      })
      .select()
      .single();

    if (shipErr?.code === '23505') throw new HttpError(409, `Tracking ID ${trackingId} is already in use`);
    if (shipErr || !dbShipment) throw new Error(`Failed to create shipment: ${shipErr?.message}`);

    // 2. Insert parcels
    let totalWeight = 0;
    if (shipmentIn.parcels && shipmentIn.parcels.length > 0) {
      const parcelRows = shipmentIn.parcels.map((p) => ({
        id: uuidv4(),
        shipment_id: dbShipment.id,
        weight_kg: p.weight_kg,
        length_cm: p.length_cm,
        width_cm: p.width_cm,
        height_cm: p.height_cm,
        category: p.category,
        is_hazardous: p.is_hazardous,
        is_fragile: p.is_fragile,
      }));
      await supabase.from('parcels').insert(parcelRows);
      totalWeight = shipmentIn.parcels.reduce((sum, p) => sum + p.weight_kg, 0);
    }

    // 3. Handle delivery points (stops)
    const createdDpIds: string[] = [];
    const dpRows = [];

    let totalDemand = totalWeight || shipmentIn.total_weight_kg || 0.0;
    const allStopsCount = (shipmentIn.dest_lat ? 1 : 0) + (shipmentIn.stops?.length || 0);
    const demandPerStop = allStopsCount > 0 ? totalDemand / allStopsCount : 0;

    // Additional stops
    if (shipmentIn.stops && shipmentIn.stops.length > 0) {
      shipmentIn.stops.forEach((stop: any) => {
        const isUUID = typeof stop.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stop.id);
        const id = isUUID ? stop.id : uuidv4();
        createdDpIds.push(id);
        dpRows.push({
          id,
          name: shipmentIn.open_bidding ? 'Pending Vendor Bid' : (stop.name || 'New Location'),
          address: shipmentIn.open_bidding ? 'Awaiting Marketplace Match' : (stop.address || 'Unknown Address'),
          latitude: stop.lat || 0.0,
          longitude: stop.lng || 0.0,
          demand_kg: demandPerStop,
          shipment_id: dbShipment.id,
          status: 'pending',
        });
      });
    }

    // Primary destination
    if (shipmentIn.dest_lat && shipmentIn.dest_lng) {
      const isUUID = typeof shipmentIn.delivery_point_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shipmentIn.delivery_point_id);
      const dpId = isUUID ? shipmentIn.delivery_point_id : uuidv4();
      createdDpIds.push(dpId);
      dpRows.push({
        id: dpId,
        name: shipmentIn.open_bidding ? 'Pending Vendor Bid' : (shipmentIn.dest_name || 'New Location'),
        address: shipmentIn.open_bidding ? 'Awaiting Marketplace Match' : (shipmentIn.dest_address || 'Unknown Address'),
        latitude: shipmentIn.dest_lat,
        longitude: shipmentIn.dest_lng,
        demand_kg: demandPerStop,
        shipment_id: dbShipment.id,
        status: 'pending',
      });
    }
    
    if (dpRows.length > 0) {
      // Rising timestamps keep the creation order exact: the last point is the final drop
      const base = Date.now();
      dpRows.forEach((row: any, i: number) => { row.created_at = new Date(base + i).toISOString(); });
      await supabase.from('delivery_points').upsert(dpRows);
    }

    // 4. Create Route if vehicle_id is provided
    let routeIdForVehicle: string | null = null;
    if (shipmentIn.vehicle_id && createdDpIds.length > 0) {
      let initialDistKm = 0;
      let currLat = shipmentIn.origin_lat || 0;
      let currLng = shipmentIn.origin_lng || 0;
      const R = 6371; // Earth radius in km
      
      if (currLat && currLng) {
        for (const dp of dpRows) {
          if (!dp.latitude || !dp.longitude) continue;
          const dLat = (dp.latitude - currLat) * Math.PI / 180;
          const dLng = (dp.longitude - currLng) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(currLat * Math.PI / 180) * Math.cos(dp.latitude * Math.PI / 180) *
                    Math.sin(dLng/2) * Math.sin(dLng/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          initialDistKm += R * c;
          currLat = dp.latitude;
          currLng = dp.longitude;
        }
      }

      const initialDurationMins = Math.round((initialDistKm / 40.0 * 60) + (dpRows.length * 15));
      const initialFuelLiters = parseFloat((initialDistKm / 4.0).toFixed(1));

      const routeId = uuidv4();
      routeIdForVehicle = routeId;
      // A bidding shipment only holds the vehicle's spare capacity open and never runs on it,
      // so its route starts active as before. Every other route is created pending and
      // dispatched through the route service once the shipment is marked assigned.
      const { data: dbRoute } = await supabase.from('routes').insert({
        id: routeId,
        vehicle_id: shipmentIn.vehicle_id,
        status: shipmentIn.open_bidding ? 'active' : 'pending',
        total_distance_km: parseFloat(initialDistKm.toFixed(1)),
        total_duration_minutes: initialDurationMins,
        estimated_fuel_liters: initialFuelLiters,
        weather_condition: 'clear',
        traffic_delay_minutes: 0,
        waypoints: [],
      }).select().single();

      if (dbRoute || routeId) {
        if (!shipmentIn.open_bidding) {
          const routeStops = createdDpIds.map((dpId, index) => ({
            id: uuidv4(),
            route_id: dbRoute?.id || routeId,
            delivery_point_id: dpId,
            sequence: index + 1,
            status: 'pending'
          }));
          await supabase.from('route_stops').insert(routeStops);
        }

        // Trigger background dynamic route matching for vendors
        const lastStop = shipmentIn.stops && shipmentIn.stops.length > 0 ? shipmentIn.stops[shipmentIn.stops.length - 1] : null;
        if (shipmentIn.origin_lat && shipmentIn.origin_lng && lastStop?.lat && lastStop?.lng) {
          import('./vendor.service').then(({ vendorService }) => {
            vendorService.matchRouteToVendors(
              dbRoute?.id || routeId,
              shipmentIn.vehicle_id!,
              shipmentIn.origin_lat!,
              shipmentIn.origin_lng!,
              lastStop!.lat,
              lastStop!.lng
            ).catch(console.error);
          });
        }

        // Open Superadmin Bidding Window if requested
        if (shipmentIn.open_bidding && shipmentIn.vehicle_id) {
          const { data: vehicle } = await supabase.from('vehicles').select('capacity_kg, available_capacity_kg').eq('id', shipmentIn.vehicle_id).single();
          if (vehicle) {
            const remainingCap = vehicle.available_capacity_kg ?? vehicle.capacity_kg ?? 0;
            if (remainingCap > 0) {
              import('./capacity.service').then(({ capacityService }) => {
                capacityService.openBackhaulWindow(
                  shipmentIn.vehicle_id!,
                  remainingCap,
                  'superadmin_dispatch',
                  shipmentIn.bidding_opens_at || undefined,
                  shipmentIn.bidding_closes_at || undefined,
                  shipmentIn.asking_price ? Number(shipmentIn.asking_price) : undefined,
                  dbShipment.id
                );
              });
            }
          }
        }
      }
    }

    // 5. Create tamper-evident log
    await ShipmentService.recordShipmentLog(dbShipment.id, 'created', null, null, undefined, actor);

    // 5.5 A shipment created with a vehicle is assigned to it and its route dispatched
    if (shipmentIn.vehicle_id && !shipmentIn.open_bidding && createdDpIds.length > 0) {
      await markAssigned(
        { id: dbShipment.id, status: 'created', origin_lat: shipmentIn.origin_lat ?? null, origin_lng: shipmentIn.origin_lng ?? null },
        { id: shipmentIn.vehicle_id },
        { id: routeIdForVehicle! },
        actor,
      );
      await dispatchRoute(routeIdForVehicle!);
    }

    // 6. Recalculate vehicle capacity if vehicle assigned
    if (shipmentIn.vehicle_id) {
      await ShipmentService.recalculateVehicleCapacity(shipmentIn.vehicle_id);
    }

    // 6.5 Run Matching Engine (Availability Scoring & Cascade)
    // Run asynchronously to not block the shipment creation response
    import('./matching.service').then(({ matchingService }) => {
      matchingService.cascadeEscalation(dbShipment.id).catch((err) => {
        console.error('Matching Engine failed to run on new shipment:', err);
      });
    });

    // 7. Return full shipment
    const shipment = await ShipmentService.getShipment(dbShipment.id);
    if (!shipment) throw new Error('Failed to retrieve created shipment');
    return shipment;
  }

  /**
   * Assign a driver/vehicle to an existing shipment. Also puts a failed delivery
   * (exception) back on a vehicle. The route is created pending and dispatched through
   * the route service, so the vehicle goes on_route and the driver is told.
   */
  static async assignDriver(shipmentId: string, vehicleId: string, actor?: LogActor | null): Promise<Shipment | null> {
    const shipment = await this.getShipment(shipmentId);
    if (!shipment) throw new HttpError(404, 'Shipment not found');
    if (!shipment.delivery_points || shipment.delivery_points.length === 0) throw new HttpError(400, 'Shipment has no delivery points');
    if (['picked_up', 'in_transit', 'delivered', 'cancelled'].includes(String(shipment.status))) {
      throw new HttpError(409, `This shipment is ${String(shipment.status).replace('_', ' ')} and can't be assigned to a vehicle.`);
    }
    await ShipmentService.assertVehicleCanTake(
      vehicleId,
      Number(shipment.total_weight_kg) || 0,
      (shipment as any).required_vehicle_type ?? null,
      shipmentId,
    );

    // Clean up any existing route stops for these delivery points
    const deliveryPoints = sortDeliveryPoints(shipment.delivery_points);
    const dpIds = deliveryPoints.map(dp => dp.id);
    const previousVehicles = await vehiclesOnStopsOf(dpIds);
    await supabase.from('route_stops').delete().in('delivery_point_id', dpIds);
    // A failed stop is tried again, so its delivery point is pending once more
    await supabase.from('delivery_points').update({ status: 'pending' }).in('id', dpIds);

    // Find active or pending route for this vehicle
    const { data: existingRoutes } = await supabase
      .from('routes')
      .select('id, status')
      .eq('vehicle_id', vehicleId)
      .in('status', ['pending', 'active'])
      .order('created_at', { ascending: false })
      .limit(1);

    let routeId = existingRoutes?.[0]?.id;
    let routeStatus: string | undefined = existingRoutes?.[0]?.status;

    if (!routeId) {
      // Create new route, pending until it is dispatched below
      routeId = uuidv4();
      routeStatus = 'pending';
      const { error: routeErr } = await supabase.from('routes').insert({
        id: routeId,
        vehicle_id: vehicleId,
        status: 'pending',
        total_distance_km: 0,
        total_duration_minutes: 0,
        estimated_fuel_liters: 0,
        weather_condition: 'clear',
        traffic_delay_minutes: 0,
        waypoints: [],
      });
      if (routeErr) throw new Error(`Failed to create route: ${routeErr.message}`);
    }

    // Add route stops after any the route already has
    const { data: taken } = await supabase.from('route_stops').select('sequence').eq('route_id', routeId);
    const firstSequence = (taken || []).reduce((max: number, r: any) => Math.max(max, Number(r.sequence) || 0), 0) + 1;
    const routeStops = deliveryPoints.map((dp, index) => ({
      id: uuidv4(),
      route_id: routeId,
      delivery_point_id: dp.id,
      sequence: firstSequence + index,
      status: 'pending'
    }));
    const { error: stopErr } = await supabase.from('route_stops').insert(routeStops);

    if (stopErr) throw new Error(`Failed to create route stops: ${stopErr.message}`);

    await markAssigned(
      { id: shipmentId, status: String(shipment.status), origin_lat: shipment.origin_lat ?? null, origin_lng: shipment.origin_lng ?? null },
      { id: vehicleId },
      { id: routeId },
      actor,
    );
    if (routeStatus === 'pending') await dispatchRoute(routeId);

    // Optionally trigger vendor match
    const lastStop = finalDeliveryPoint<any>(deliveryPoints)!;
    if (shipment.origin_lat && shipment.origin_lng && lastStop.latitude && lastStop.longitude) {
      import('./vendor.service').then(({ vendorService }) => {
        vendorService.matchRouteToVendors(
          routeId,
          vehicleId,
          shipment.origin_lat!,
          shipment.origin_lng!,
          lastStop.latitude,
          lastStop.longitude
        ).catch(console.error);
      });
    }

    await this.recalculateVehicleCapacity(vehicleId);
    for (const previous of previousVehicles) {
      if (previous !== vehicleId) await this.recalculateVehicleCapacity(previous);
    }

    return this.getShipment(shipmentId);
  }

  /**
   * Get a single shipment with relations.
   */
  static async getShipment(shipmentId: string): Promise<Shipment | null> {
    const { data, error } = await supabase
      .from('shipments')
      .select('*, parcels(*), delivery_points!delivery_points_shipment_id_fkey(*), shipment_logs(*), capacity_bids(bid_amount, eway_bill_ref, load_configuration, vendor_profiles(company_name, city), capacity_windows!capacity_bids_window_id_fkey(trigger_type))')
      .eq('id', shipmentId)
      .maybeSingle();

    if (error || !data) {
      // Fallback 1: Check if it's a vendor shipment request
      const { data: vendorData, error: vendorError } = await supabase
        .from('vendor_shipment_requests')
        .select('*')
        .eq('id', shipmentId)
        .maybeSingle();

      if (!vendorError && vendorData) {
        let vMeta: any = vendorData.metadata || {};
        if (Object.keys(vMeta).length === 0) {
          // No manifest details were captured for this request; show only what the record itself says
          vMeta = {
            grossWeight: vendorData.required_capacity_kg ? `${vendorData.required_capacity_kg} KG` : "",
            dispatch_date: new Date(vendorData.created_at).toISOString().split('T')[0],
          };
        } else if (vMeta.consignee || vMeta.cargo) {
          vMeta = {
            consigneeName: vMeta.consignee?.name || "",
            consigneeContact: vMeta.consignee?.contact || "",
            consigneeEmail: vMeta.consignee?.email || "",
            productCategory: vMeta.cargo?.category || "",
            productName: vMeta.cargo?.name || "",
            brand: vMeta.cargo?.brand || "",
            modelVariant: vMeta.cargo?.modelVariant || "",
            packagingType: vMeta.cargo?.packagingType || "",
            noOfPackages: vMeta.cargo?.noOfPackages || "",
            quantity: vMeta.cargo?.quantity || "",
            unit: vMeta.cargo?.unit || "",
            grossWeight: vMeta.cargo?.grossWeightKg ? `${vMeta.cargo.grossWeightKg} KG` : "",
            declaredValue: vMeta.cargo?.declaredValue || "",
            specialHandling: vMeta.cargo?.specialHandling || {},
            remarks: vMeta.cargo?.remarks || "",
            dispatch_date: new Date(vendorData.created_at).toISOString().split('T')[0],
            reporting_date: new Date(new Date(vendorData.created_at).getTime() + 86400000).toISOString().split('T')[0],
            eta_details: {
              eta_text: getETA(getDist(vendorData.pickup_lat, vendorData.pickup_lng, vendorData.drop_lat, vendorData.drop_lng), vendorData.created_at),
              distance_km: getDist(vendorData.pickup_lat, vendorData.pickup_lng, vendorData.drop_lat, vendorData.drop_lng)
            },
            is_long_haul: false
          };
        }

        // ALWAYS inject fresh eta_details regardless of metadata format
        const vendorDistKm = getDist(vendorData.pickup_lat, vendorData.pickup_lng, vendorData.drop_lat, vendorData.drop_lng);
        const vendorEtaText = getETA(vendorDistKm, vendorData.created_at);
        vMeta.eta_details = {
          eta_text: vendorEtaText,
          distance_km: vendorDistKm
        };

        return {
          id: vendorData.id,
          tracking_id: 'VR-' + vendorData.id.substring(0, 8).toUpperCase(),
          status: vendorData.status,
          metadata: vMeta,
          pickup_location: { address: vendorData.pickup_location, lat: vendorData.pickup_lat, lng: vendorData.pickup_lng },
          drop_location: { address: vendorData.drop_location, lat: vendorData.drop_lat, lng: vendorData.drop_lng },
          origin_lat: vendorData.pickup_lat,
          origin_lng: vendorData.pickup_lng,
          delivery_points: [{
            latitude: vendorData.drop_lat,
            longitude: vendorData.drop_lng,
            name: 'Drop Point',
            address: vendorData.drop_location,
          }],
          created_at: vendorData.created_at,
        } as any;
      }

      // Fallback 2: Check if it's a cargo manifest
      const { data: manifestData, error: manifestError } = await supabase
        .from('cargo_manifest')
        .select('*')
        .eq('id', shipmentId)
        .maybeSingle();

      if (manifestError || !manifestData) return null;

      // Check if there is an active/recent route for this manifest's vehicle to get REAL system ETA/Distance
      let realDistKm = getDist(manifestData.pickup_lat, manifestData.pickup_lng, manifestData.drop_lat, manifestData.drop_lng);
      let realEtaText = getETA(realDistKm, manifestData.created_at);

      if (manifestData.vehicle_id) {
        const { data: route } = await supabase
          .from('routes')
          .select('total_distance_km, total_duration_minutes, created_at')
          .eq('vehicle_id', manifestData.vehicle_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (route && route.total_distance_km) {
          realDistKm = route.total_distance_km.toString();
          const routeStart = new Date(route.created_at || manifestData.created_at);
          routeStart.setTime(routeStart.getTime() + (route.total_duration_minutes || 0) * 60 * 1000);
          realEtaText = formatISTDate(routeStart);
        }
      }

      // If it's a cargo manifest, fetch its parent vendor request for metadata if it exists
      let metadata: any = {};
      if (manifestData.vendor_request_id) {
        const { data: parentReq } = await supabase
          .from('vendor_shipment_requests')
          .select('metadata')
          .eq('id', manifestData.vendor_request_id)
          .maybeSingle();
        if (parentReq?.metadata) metadata = parentReq.metadata;
      }

      if (!metadata || Object.keys(metadata || {}).length === 0) {
        // No manifest details were captured; show only what the manifest itself records
        metadata = {
          grossWeight: manifestData.capacity_kg ? `${manifestData.capacity_kg} KG` : "",
          dispatch_date: new Date(manifestData.created_at).toISOString().split('T')[0],
          eta_details: {
            eta_text: realEtaText,
            distance_km: realDistKm
          },
        };
      } else if (metadata.consignee || metadata.cargo) {
        metadata = {
          consigneeName: metadata.consignee?.name || "",
          consigneeContact: metadata.consignee?.contact || "",
          consigneeEmail: metadata.consignee?.email || "",
          productCategory: metadata.cargo?.category || "",
          productName: metadata.cargo?.name || "",
          brand: metadata.cargo?.brand || "",
          modelVariant: metadata.cargo?.modelVariant || "",
          packagingType: metadata.cargo?.packagingType || "",
          noOfPackages: metadata.cargo?.noOfPackages || "",
          quantity: metadata.cargo?.quantity || "",
          unit: metadata.cargo?.unit || "",
          grossWeight: metadata.cargo?.grossWeightKg ? `${metadata.cargo.grossWeightKg} KG` : "",
          declaredValue: metadata.cargo?.declaredValue || "",
          specialHandling: metadata.cargo?.specialHandling || {},
          remarks: metadata.cargo?.remarks || "",
          dispatch_date: new Date(manifestData.created_at).toISOString().split('T')[0],
          reporting_date: new Date(new Date(manifestData.created_at).getTime() + 86400000).toISOString().split('T')[0],
          eta_details: {
            eta_text: realEtaText,
            distance_km: realDistKm
          },
          is_long_haul: false
        };
      }

      // ALWAYS inject fresh eta_details regardless of metadata format
      metadata.eta_details = {
        eta_text: realEtaText,
        distance_km: realDistKm
      };

      return {
        id: manifestData.id,
        tracking_id: manifestParcelCode(manifestData.id),
        vendor_request_id: manifestData.vendor_request_id ?? null,
        status: manifestData.status,
        metadata: metadata,
        pickup_location: { address: manifestData.pickup_location, lat: manifestData.pickup_lat, lng: manifestData.pickup_lng },
        drop_location: { address: manifestData.drop_location, lat: manifestData.drop_lat, lng: manifestData.drop_lng },
        origin_lat: manifestData.pickup_lat,
        origin_lng: manifestData.pickup_lng,
        delivery_points: [{
          latitude: manifestData.drop_lat,
          longitude: manifestData.drop_lng,
          name: 'Drop Point',
          address: manifestData.drop_location,
        }],
        created_at: manifestData.created_at,
      } as any;
    }

    // Map to our interface shape
    const shipment: Shipment = {
      ...data,
      delivery_points: sortDeliveryPoints(data.delivery_points),
      parcels: data.parcels || [],
      logs: data.shipment_logs || [],
      is_verified: SecurityService.verifyChain(data.shipment_logs || []),
      capacity_bids: data.capacity_bids || null,
    };
    return shipment;
  }

  /**
   * List shipments with relations.
   */
  static async listShipments(skip: number = 0, limit: number = 100): Promise<Shipment[]> {
    const { data, error } = await supabase
      .from('shipments')
      .select('*, parcels(*), delivery_points!delivery_points_shipment_id_fkey(*, route_stops(routes(vehicle_id, status, vehicles(plate_number, users(full_name))))), shipment_logs(*), capacity_bids(bid_amount, eway_bill_ref, load_configuration, vendor_profiles(company_name, city), capacity_windows!capacity_bids_window_id_fkey(trigger_type))')
      .order('created_at', { ascending: false })
      .range(skip, skip + limit - 1);

    if (error || !data) return [];

    // A shipment opened for vendor bidding has a capacity window pointing back at it
    // (see createShipment -> openBackhaulWindow). shipments has no bidding columns.
    const biddingByShipment = new Map<string, any>();
    if (data.length > 0) {
      const { data: windows } = await supabase
        .from('capacity_windows')
        .select('fallback_shipment_id, floor_price, opens_at, closes_at, winning_bid_id')
        .eq('trigger_type', 'superadmin_dispatch')
        .in('fallback_shipment_id', data.map((d: any) => d.id));
      for (const w of windows || []) {
        if (w.fallback_shipment_id) biddingByShipment.set(w.fallback_shipment_id, w);
      }
    }

    const mappedShipments = data.map((d: any) => {
      const bidWindow = biddingByShipment.get(d.id);
      const deliveryPoints = sortDeliveryPoints(d.delivery_points);
      // Any stop with a route tells which vehicle carries it, whichever point it is on
      const activeRouteStop = deliveryPoints
        .flatMap((dp: any) => dp.route_stops || [])
        .find((rs: any) => rs.routes && rs.routes.status !== 'cancelled');
      const vehicleInfo = activeRouteStop?.routes?.vehicles;
      let vehicleId = activeRouteStop?.routes?.vehicle_id || null;
      let driverName = vehicleInfo?.users?.full_name || null;

      if (!vehicleId && d.shipment_logs) {
        const assignedLog = d.shipment_logs.find((l: any) => l.status === 'assigned' && l.metadata_json?.vehicle_id);
        if (assignedLog) {
          vehicleId = assignedLog.metadata_json.vehicle_id;
        }
      }

      return {
        ...d,
        delivery_points: deliveryPoints,
        parcels: d.parcels || [],
        logs: d.shipment_logs || [],
        is_verified: SecurityService.verifyChain(d.shipment_logs || []),
        capacity_bids: d.capacity_bids || null,
        vehicle_id: vehicleId,
        driver_name: driverName,
        open_bidding: !!bidWindow,
        asking_price: bidWindow?.floor_price ?? null,
        bidding_opens_at: bidWindow?.opens_at ?? null,
        bidding_closes_at: bidWindow?.closes_at ?? null,
      };
    });

    // Fetch Cargo Manifests to show them in the unified list
    const { data: manifests } = await supabase
      .from('cargo_manifest')
      .select('*, vehicles(plate_number, users(full_name))')
      .order('created_at', { ascending: false })
      .limit(limit);

    const mappedManifests = (manifests || []).map((m: any) => ({
      id: m.id,
      tracking_id: manifestParcelCode(m.id),
      vendor_request_id: m.vendor_request_id ?? null,
      status: m.status === 'scheduled' ? 'created' : m.status, // maps scheduled to created
      priority: 'high',
      // cargo_manifest only stores lat/lng plus one address string per point, so the
      // pickup and drop address are used as both the name and address the UI reads.
      origin_name: m.pickup_location || null,
      origin_address: m.pickup_location || null,
      origin_lat: m.pickup_lat,
      origin_lng: m.pickup_lng,
      total_weight_kg: m.capacity_kg,
      delivery_point: {
        id: m.id + '_dp',
        name: m.drop_location || null,
        address: m.drop_location || null,
        latitude: m.drop_lat,
        longitude: m.drop_lng,
        demand_kg: m.capacity_kg
      },
      parcels: [],
      logs: [],
      is_verified: true,
      vehicle_id: m.vehicle_id,
      driver_name: m.vehicles?.users?.full_name || 'Driver Assigned',
      created_at: m.created_at,
      updated_at: m.created_at,
    }));

    // Combine and re-sort by created_at descending
    const combined = [...mappedShipments, ...mappedManifests].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return combined;
  }

  /**
   * Update shipment metadata (dates, consignee, cargo details).
   */
  static async updateShipmentMetadata(
    shipmentId: string,
    metadata: any
  ): Promise<Shipment | null> {
    const { error } = await supabase
      .from('shipments')
      .update({ metadata })
      .eq('id', shipmentId);

    if (error) {
      // Try vendor_shipment_requests
      const { error: vendorError } = await supabase
        .from('vendor_shipment_requests')
        .update({ metadata })
        .eq('id', shipmentId);

      if (vendorError) {
        // Try cargo_manifest parent request
        const { data: manifest } = await supabase
          .from('cargo_manifest')
          .select('vendor_request_id')
          .eq('id', shipmentId)
          .maybeSingle();

        if (manifest?.vendor_request_id) {
          await supabase
            .from('vendor_shipment_requests')
            .update({ metadata })
            .eq('id', manifest.vendor_request_id);
        } else {
          return null;
        }
      }
    }
    return await this.getShipment(shipmentId);
  }

  private static async deliveryPointIds(shipmentId: string): Promise<string[]> {
    const { data } = await supabase.from('delivery_points').select('id').eq('shipment_id', shipmentId);
    return (data || []).map((dp: any) => dp.id);
  }

  /**
   * When dispatch cancels, un-assigns or delivers a shipment, its stops that are still
   * pending on a route are closed (cancelled, or completed for a delivery), the route is
   * finished if nothing is left to do on it, and the driver is told. Returns the vehicles
   * affected. A driver completing their own stop has already closed it, so nothing changes.
   */
  private static async closeRouteStops(shipmentId: string, status: string, actor?: LogActor | null): Promise<Set<string>> {
    const vehicles = new Set<string>();
    if (status !== 'cancelled' && status !== 'delivered' && status !== 'created') return vehicles;
    // A driver delivering settles their own stop (complete-stop), and the route with it
    if (status === 'delivered' && actor?.role === 'driver') return vehicles;

    const { data: dps } = await supabase.from('delivery_points').select('id, name').eq('shipment_id', shipmentId);
    const dpIds = (dps || []).map((dp: any) => dp.id);
    if (dpIds.length === 0) return vehicles;
    const { data: pending } = await supabase
      .from('route_stops')
      .select('id, route_id')
      .in('delivery_point_id', dpIds)
      .eq('status', 'pending');
    if (!pending || pending.length === 0) return vehicles;

    const now = new Date().toISOString();
    const stopPatch = status === 'delivered' ? { status: 'completed', actual_arrival_at: now } : { status: 'cancelled' };
    await supabase.from('route_stops').update(stopPatch).in('id', pending.map((st: any) => st.id)).eq('status', 'pending');

    const routeIds = Array.from(new Set(pending.map((st: any) => st.route_id))) as string[];
    const { data: routes } = await supabase.from('routes').select('id, status, vehicle_id').in('id', routeIds);
    const destination = finalDeliveryPoint<any>(dps as any[])?.name || 'the drop-off';
    const byStaff = actor?.role !== 'driver';

    for (const route of routes || []) {
      if (route.vehicle_id) vehicles.add(route.vehicle_id);

      // Nothing left to do on the route: finish it (or cancel it when no stop was ever completed)
      if (['pending', 'active'].includes(String(route.status))) {
        const { data: open } = await supabase.from('route_stops').select('id').eq('route_id', route.id).eq('status', 'pending').limit(1);
        if (!open || open.length === 0) {
          const { data: done } = await supabase.from('route_stops').select('id').eq('route_id', route.id).eq('status', 'completed').limit(1);
          try {
            const { routeService } = await import('./route.service');
            await routeService.changeStatus(route.id, done && done.length > 0 ? 'completed' : 'cancelled');
          } catch (e) {
            console.error(`[shipment] route ${route.id} could not be closed:`, e);
          }
        }
      }

      // Tell the driver, unless the driver is the one who made the change
      if (byStaff && route.vehicle_id) {
        try {
          const { data: vehicle } = await supabase.from('vehicles').select('driver_id').eq('id', route.vehicle_id).maybeSingle();
          if (vehicle?.driver_id) {
            const text =
              status === 'delivered' ? ['Delivery marked done', `Dispatch marked the delivery to ${destination} as delivered.`]
              : status === 'created' ? ['Delivery removed', `Dispatch took the delivery to ${destination} off your route.`]
              : actor?.role === 'customer' ? ['Delivery cancelled', `The customer cancelled the delivery to ${destination}.`]
              : ['Delivery cancelled', `Dispatch cancelled the delivery to ${destination}.`];
            await notificationService.sendNotification(vehicle.driver_id, text[0], text[1], 'shipment_' + (status === 'delivered' ? 'delivered' : 'cancelled'), { shipment_id: shipmentId, route_id: route.id });
          }
        } catch (e) {
          console.warn('Failed to tell the driver about the change:', e);
        }
      }
    }
    return vehicles;
  }

  /**
   * Update shipment status with optional POD data.
   */
  static async updateShipmentStatus(
    shipmentId: string,
    status: string,
    lat?: number | null,
    lng?: number | null,
    receivedBy?: string | null,
    signatureData?: string | null,
    actor?: LogActor | null,
    extraMetadata?: Record<string, any>,
    /** Storage paths of the proof-of-delivery photo and signature, already uploaded. */
    proofFiles?: { photo_url?: string | null; signature_url?: string | null }
  ): Promise<Shipment | null> {
    const { data: current, error: currentErr } = await supabase
      .from('shipments')
      .select('status')
      .eq('id', shipmentId)
      .maybeSingle();
    if (currentErr || !current) return null;

    // Asking for the status it already has succeeds without logging or billing twice;
    // anything else must follow the allowed transitions (delivered and cancelled are final).
    if (current.status === status) return ShipmentService.getShipment(shipmentId);
    assertTransition(SHIPMENT_TRANSITIONS, 'shipment', String(current.status), status);

    const updateData: Record<string, any> = { status };
    if (receivedBy) updateData.received_by = receivedBy;
    if (signatureData) updateData.signature_data = signatureData;
    if (proofFiles?.photo_url) updateData.photo_url = proofFiles.photo_url;
    if (proofFiles?.signature_url) updateData.signature_url = proofFiles.signature_url;

    // Applies only while the shipment is still in the status we just read
    const { data: moved, error } = await supabase
      .from('shipments')
      .update(updateData)
      .eq('id', shipmentId)
      .eq('status', current.status)
      .select('id')
      .maybeSingle();

    if (error) return null;
    if (!moved) throw new HttpError(409, 'This shipment was just changed by someone else. Refresh and try again.');

    // Record tamper-evident log
    const metadata: Record<string, any> = { ...(extraMetadata || {}) };
    if (status === 'delivered') {
      metadata.received_by = receivedBy;
      metadata.signature_captured = !!signatureData || !!proofFiles?.signature_url;
      metadata.photo_captured = !!proofFiles?.photo_url;
    }
    await ShipmentService.recordShipmentLog(shipmentId, status, lat, lng, metadata, actor);

    // Bill the delivery (complete-stop, status updates and verify-pod all end up here)
    if (status === 'delivered') await InvoiceService.onShipmentDelivered(shipmentId);

    // Keep a customer's booking (and their notifications) in step with the shipment
    try {
      const { onShipmentStatus } = await import('./customer-bookings.service');
      await onShipmentStatus(shipmentId, status);
    } catch (e) {
      console.error('Failed to update the customer booking:', e);
    }

    // A cancelled, delivered or un-assigned shipment leaves its route: close its pending
    // stops, tell the driver, and free the vehicle's capacity.
    const vehicles = await ShipmentService.closeRouteStops(shipmentId, status, actor);
    if (vehicles.size === 0) {
      for (const v of await vehiclesOnStopsOf(await ShipmentService.deliveryPointIds(shipmentId))) vehicles.add(v);
    }
    for (const vehicleId of vehicles) await ShipmentService.recalculateVehicleCapacity(vehicleId);

    // Note: Automatic backhaul bidding was disabled in favor of Driver-triggered bidding.
    // The driver will now trigger `openBackhaulWindow` from the driver app.

    return ShipmentService.getShipment(shipmentId);
  }

  /**
   * Update specific shipment fields.
   */
  static async updateShipment(shipmentId: string, updateData: Record<string, any>): Promise<Shipment | null> {
    if (updateData.freight_charge !== undefined && updateData.freight_charge !== null) {
      const charge = Number(updateData.freight_charge);
      if (!Number.isFinite(charge) || charge < 0 || charge > 99_999_999.99) throw new HttpError(400, 'freight_charge must be zero or more');
      updateData = { ...updateData, freight_charge: Math.round(charge * 100) / 100 };
    }

    // Only the details a dispatcher edits; status, tracking id, proof of delivery and the
    // like change through their own rules (updateShipmentStatus, assignDriver).
    const filtered: Record<string, any> = {};
    for (const [key, value] of Object.entries(updateData)) {
      // A price can be cleared (null); the other details cannot be emptied
      if (value !== undefined && (value !== null || key === 'freight_charge') && ShipmentService.EDITABLE_FIELDS.includes(key)) {
        filtered[key] = value;
      }
    }

    if (Object.keys(filtered).length === 0) {
      return ShipmentService.getShipment(shipmentId);
    }

    const { data: existing } = await supabase.from('shipments').select('status').eq('id', shipmentId).maybeSingle();
    if (!existing) return null;
    if (['delivered', 'cancelled'].includes(String(existing.status))) {
      throw new HttpError(409, `This shipment is ${existing.status} and can't be edited.`);
    }

    const { error } = await supabase
      .from('shipments')
      .update(filtered)
      .eq('id', shipmentId);

    if (error) return null;
    return ShipmentService.getShipment(shipmentId);
  }

  /** Columns the edit endpoint may change. */
  static readonly EDITABLE_FIELDS = ['priority', 'total_items', 'total_weight_kg', 'freight_charge'];

  /** Statuses past which a shipment has already moved and can no longer be deleted. */
  private static readonly UNDELETABLE_STATUSES = ['picked_up', 'in_transit', 'delivered'];

  /**
   * Delete a shipment and all related data.
   *
   * Refuses once the shipment has been picked up, is in transit or has been
   * delivered — deleting real movement history is how it goes missing from
   * the record. Cancel it instead (before pickup) so the trail stays intact.
   */
  static async deleteShipment(shipmentId: string): Promise<boolean> {
    // Check existence
    const { data: existing } = await supabase
      .from('shipments')
      .select('id, status')
      .eq('id', shipmentId)
      .single();

    if (!existing) return false;

    if (ShipmentService.UNDELETABLE_STATUSES.includes(existing.status)) {
      throw new HttpError(
        409,
        `This shipment is ${existing.status.replace('_', ' ')} and can't be deleted. Cancel it instead, or leave it as-is.`
      );
    }

    // 1. Get delivery point
    const { data: dps } = await supabase
      .from('delivery_points')
      .select('id')
      .eq('shipment_id', shipmentId);

    const vehiclesToRecalculate = new Set<string>();

    // 2. Delete route stops linked to delivery points
    if (dps && dps.length > 0) {
      const dpIds = dps.map((dp: any) => dp.id);

      // Get vehicles to recalculate capacity later
      const { data: stops } = await supabase.from('route_stops').select('route_id').in('delivery_point_id', dpIds);
      if (stops && stops.length > 0) {
        const routeIds = stops.map((s: any) => s.route_id);
        const { data: routes } = await supabase.from('routes').select('vehicle_id').in('id', routeIds);
        routes?.forEach((r: any) => {
          if (r.vehicle_id) vehiclesToRecalculate.add(r.vehicle_id);
        });
      }

      await supabase.from('route_stops').delete().in('delivery_point_id', dpIds);
    }

    // 3. Delete invoices/payments
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id')
      .eq('shipment_id', shipmentId);

    if (invoices && invoices.length > 0) {
      const invoiceIds = invoices.map((inv: any) => inv.id);
      await supabase.from('payments').delete().in('invoice_id', invoiceIds);
      await supabase.from('invoices').delete().eq('shipment_id', shipmentId);
    }

    // 4. Delete parcels and logs
    await supabase.from('parcels').delete().eq('shipment_id', shipmentId);
    await supabase.from('shipment_logs').delete().eq('shipment_id', shipmentId);

    // 5. Unlink delivery points to prevent FK constraint violation from capacity_bids
    if (dps && dps.length > 0) {
      await supabase.from('delivery_points').update({ shipment_id: null }).eq('shipment_id', shipmentId);
    }

    // 5.5 Remove from capacity windows to avoid FK constraint violation
    await supabase.from('capacity_windows').update({ fallback_shipment_id: null }).eq('fallback_shipment_id', shipmentId);

    // 6. Delete shipment
    await supabase.from('shipments').delete().eq('id', shipmentId);

    // 7. Recalculate vehicle capacity
    for (const vid of vehiclesToRecalculate) {
      await ShipmentService.recalculateVehicleCapacity(vid);
    }

    return true;
  }

  /**
   * Full status history for staff: every hash-chained `shipment_logs` entry for
   * this shipment, oldest first, with the actor (if one was recorded) and a
   * short plain-language note. When a shipment predates status logging (or was
   * never logged, e.g. some cargo-manifest flows) this falls back to whatever
   * the record itself says — created and, if it has since moved on, its
   * current status — and never invents a step in between.
   *
   * Returns null when no shipment, cargo manifest or vendor request exists
   * with this id.
   */
  static async getShipmentHistory(shipmentId: string): Promise<ShipmentHistoryEvent[] | null> {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('status, created_at, updated_at, received_by')
      .eq('id', shipmentId)
      .maybeSingle();

    if (shipment) {
      const { data: logs } = await supabase
        .from('shipment_logs')
        .select('*')
        .eq('shipment_id', shipmentId)
        .order('index', { ascending: true });

      return ShipmentService.buildHistoryEvents(logs || [], shipment);
    }

    // Not a shipment row — try the vendor/manifest tables so the drawer can still
    // show something for loads booked through those flows (they carry no
    // shipment_logs of their own).
    const { data: manifest } = await supabase
      .from('cargo_manifest')
      .select('status, created_at, updated_at')
      .eq('id', shipmentId)
      .maybeSingle();
    if (manifest) return ShipmentService.buildHistoryEvents([], manifest);

    const { data: vendorRequest } = await supabase
      .from('vendor_shipment_requests')
      .select('status, created_at, updated_at')
      .eq('id', shipmentId)
      .maybeSingle();
    if (vendorRequest) return ShipmentService.buildHistoryEvents([], vendorRequest);

    return null;
  }

  /** Builds the staff-facing history from real `shipment_logs` rows, resolving actor names. */
  private static async buildHistoryEvents(
    logs: ShipmentLog[],
    record: { status: string; created_at: string; updated_at?: string | null; received_by?: string | null }
  ): Promise<ShipmentHistoryEvent[]> {
    if (logs.length > 0) {
      logs = [...logs].sort((a, b) => a.index - b.index);
      const actorIds = Array.from(
        new Set(logs.map(l => l.metadata_json?.actor_id).filter((id): id is string => typeof id === 'string'))
      );
      let usersById = new Map<string, { full_name: string | null; role: string | null }>();
      if (actorIds.length > 0) {
        const { data: users } = await supabase.from('users').select('id, full_name, role').in('id', actorIds);
        usersById = new Map((users || []).map((u: any) => [u.id, { full_name: u.full_name ?? null, role: u.role ?? null }]));
      }

      return logs.map((log): ShipmentHistoryEvent => {
        const meta = log.metadata_json || {};
        const actorId: string | undefined = meta.actor_id;
        const actor = actorId
          ? { id: actorId, name: usersById.get(actorId)?.full_name ?? null, role: meta.actor_role ?? usersById.get(actorId)?.role ?? null }
          : null;

        let note: string | null = null;
        if (meta.received_by) note = `Received by ${meta.received_by}`;
        else if (log.status === 'assigned' && meta.vehicle_id) note = 'Vehicle assigned';

        return {
          status: log.status,
          at: log.timestamp,
          actor,
          note,
          location: log.location_lat != null && log.location_lng != null ? { lat: log.location_lat, lng: log.location_lng } : null,
        };
      });
    }

    // No log entries exist for this record — show only what the record itself
    // confirms: it was created, and, if it has moved past "created" since,
    // its current status. Nothing in between is guessed at.
    const events: ShipmentHistoryEvent[] = [
      { status: 'created', at: record.created_at, actor: null, note: null, location: null },
    ];
    if (record.status && record.status !== 'created' && record.updated_at) {
      events.push({
        status: record.status,
        at: record.updated_at,
        actor: null,
        note: record.received_by ? `Received by ${record.received_by}` : null,
        location: null,
      });
    }
    return events;
  }

  /** Status + time only — what the public tracking page is allowed to show. */
  private static toPublicHistory(events: ShipmentHistoryEvent[]): PublicHistoryEvent[] {
    return events.map(e => ({ status: e.status, at: e.at }));
  }

  /**
   * Public tracking — no auth required.
   */
  static async getPublicTracking(trackingId: string): Promise<Record<string, any> | null> {
    if (trackingId.startsWith('CM-')) {
      // Tracking IDs are minted as 'CM-' + the first 8 hex chars of the manifest's
      // UUID, uppercased (see listShipments / createManifest above). Those 8 chars
      // are exactly the UUID's first hyphen-delimited segment, so a valid tracking
      // id maps to a contiguous, indexed range on the `id` primary key — no need to
      // load every manifest row to prefix-match it client-side.
      const manifestIdPrefix = trackingId.substring(3).toLowerCase();
      if (!/^[0-9a-f]{8}$/.test(manifestIdPrefix)) return null;

      const { data: manifest } = await supabase
        .from('cargo_manifest')
        .select('*, vehicles(*)')
        .gte('id', `${manifestIdPrefix}-0000-0000-0000-000000000000`)
        .lte('id', `${manifestIdPrefix}-ffff-ffff-ffff-ffffffffffff`)
        .limit(1)
        .maybeSingle();

      if (!manifest) return null;

      const trackingInfo: Record<string, any> = {
        id: manifest.id,
        tracking_id: trackingId,
        status: manifest.status === 'scheduled' ? 'created' : manifest.status,
        priority: null,
        total_items: null,
        total_weight_kg: manifest.capacity_kg,
        origin_name: manifest.pickup_location,
        origin_address: manifest.pickup_location,
        origin_lat: manifest.pickup_lat,
        origin_lng: manifest.pickup_lng,
        destination: {
          name: manifest.drop_location,
          address: manifest.drop_location,
          lat: manifest.drop_lat,
          lng: manifest.drop_lng
        },
        vehicle: null,
        eta_minutes: null,
      };

      if (manifest.vehicles) {
        const v = manifest.vehicles;
        trackingInfo.vehicle = {
          id: v.id,
          plate_number: v.plate_number,
          type: v.vehicle_type,
          status: v.status,
          lat: v.latitude,
          lng: v.longitude,
        };

        // Next stop: pickup until the load is in transit, then the drop.
        const target = manifest.status === 'in_transit'
          ? { lat: manifest.drop_lat, lng: manifest.drop_lng }
          : { lat: manifest.pickup_lat, lng: manifest.pickup_lng };
        trackingInfo.eta_minutes = estimateEtaMinutes(v.latitude, v.longitude, target.lat, target.lng);
      }

      const manifestEvents = await ShipmentService.buildHistoryEvents([], { ...manifest, status: trackingInfo.status });
      trackingInfo.history = ShipmentService.toPublicHistory(manifestEvents);

      return trackingInfo;
    }

    const { data: shipment } = await supabase
      .from('shipments')
      .select('*, delivery_points!delivery_points_shipment_id_fkey(*), shipment_logs(*)')
      .eq('tracking_id', trackingId)
      .single();

    if (!shipment) return null;

    const dp = finalDeliveryPoint<any>(shipment.delivery_points);

    const trackingInfo: Record<string, any> = {
      id: shipment.id,
      tracking_id: shipment.tracking_id,
      status: shipment.status,
      priority: shipment.priority,
      total_items: shipment.total_items,
      total_weight_kg: shipment.total_weight_kg,
      origin_name: shipment.origin_name,
      origin_address: shipment.origin_address,
      origin_lat: shipment.origin_lat,
      origin_lng: shipment.origin_lng,
      destination: dp
        ? { name: dp.name, address: dp.address, lat: dp.latitude, lng: dp.longitude }
        : null,
      vehicle: null,
      eta_minutes: null,
    };

    // Find the vehicle via the route stops of any of its points, preferring a route that is running
    const pointIds = (shipment.delivery_points || []).map((p: any) => p.id);
    if (dp && pointIds.length > 0) {
      const { data: routeStops } = await supabase
        .from('route_stops')
        .select('*, routes(*, vehicles(*))')
        .in('delivery_point_id', pointIds);

      const usable = (routeStops || []).filter((st: any) => st.routes && st.routes.status !== 'cancelled');
      const stop = usable.find((st: any) => ['active', 'pending'].includes(st.routes.status)) ?? usable[0];
      if (stop?.routes) {
        const route = stop.routes;
        const vehicle = route.vehicles;
        if (vehicle) {
          trackingInfo.vehicle = {
            id: vehicle.id,
            plate_number: vehicle.plate_number,
            type: vehicle.vehicle_type,
            status: vehicle.status,
            lat: vehicle.latitude,
            lng: vehicle.longitude,
          };
        }
        // The route's total duration is not an arrival time; estimate from where the
        // vehicle is now to this shipment's drop point instead.
        if (route.status === 'active' && vehicle) {
          trackingInfo.eta_minutes = estimateEtaMinutes(vehicle.latitude, vehicle.longitude, dp.latitude, dp.longitude);
        }
      }
    }

    const shipmentEvents = await ShipmentService.buildHistoryEvents(shipment.shipment_logs || [], shipment);
    trackingInfo.history = ShipmentService.toPublicHistory(shipmentEvents);

    return trackingInfo;
  }
}
