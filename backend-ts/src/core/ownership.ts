/**
 * margixindia — Resource ownership checks
 *
 * Staff (admin, manager, superadmin) can access every resource. Drivers can
 * access resources tied to a vehicle they drive; vendors those tied to
 * their own bids or shipment requests.
 */
import { Request, Response, NextFunction } from 'express';
import { supabase } from './supabase';
import { TokenData } from './auth';
import { HttpError } from './errors';

/** Roles with fleet-wide access. Pass to requireRole(...STAFF_ROLES); superadmin always passes. */
export const STAFF_ROLES = ['admin', 'manager'] as const;

export function isStaff(user: TokenData | undefined): boolean {
  return !!user && (user.role === 'superadmin' || (STAFF_ROLES as readonly string[]).includes(user.role));
}

const VEHICLE_CACHE_TTL_MS = 30 * 1000;
const driverVehicleCache = new Map<string, { ids: string[]; expiresAt: number }>();

/** IDs of the vehicles assigned to a driver (cached 30s). */
export async function getDriverVehicleIds(driverId: string): Promise<string[]> {
  const cached = driverVehicleCache.get(driverId);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;

  const { data, error } = await supabase.from('vehicles').select('id').eq('driver_id', driverId);
  if (error) throw new Error(`Vehicle lookup failed: ${error.message}`);
  const ids = (data ?? []).map(v => v.id as string);
  driverVehicleCache.set(driverId, { ids, expiresAt: Date.now() + VEHICLE_CACHE_TTL_MS });
  return ids;
}

/** Drop a driver's cached vehicle list, e.g. after reassigning a vehicle. */
export function invalidateDriverVehicles(driverId?: string): void {
  if (driverId) driverVehicleCache.delete(driverId);
  else driverVehicleCache.clear();
}

async function driverOwnsVehicle(user: TokenData, vehicleId: string | null | undefined): Promise<boolean> {
  if (!vehicleId || user.role !== 'driver') return false;
  return (await getDriverVehicleIds(user.user_id)).includes(vehicleId);
}

export async function canAccessVehicle(user: TokenData, vehicleId: string): Promise<boolean> {
  return isStaff(user) || driverOwnsVehicle(user, vehicleId);
}

/** Routes, including cargo manifests that the driver app treats as routes. */
export async function canAccessRoute(user: TokenData, routeId: string): Promise<boolean> {
  if (isStaff(user)) return true;
  if (user.role !== 'driver') return false;

  const { data: route } = await supabase.from('routes').select('vehicle_id').eq('id', routeId).maybeSingle();
  if (route) return driverOwnsVehicle(user, route.vehicle_id);

  const { data: manifest } = await supabase.from('cargo_manifest').select('vehicle_id').eq('id', routeId).maybeSingle();
  return driverOwnsVehicle(user, manifest?.vehicle_id);
}

export async function canAccessRouteStop(user: TokenData, stopId: string): Promise<boolean> {
  if (isStaff(user)) return true;
  const { data: stop } = await supabase.from('route_stops').select('route_id').eq('id', stopId).maybeSingle();
  return !!stop && canAccessRoute(user, stop.route_id);
}

export async function canAccessManifest(user: TokenData, manifestId: string): Promise<boolean> {
  if (isStaff(user)) return true;
  const { data: manifest } = await supabase
    .from('cargo_manifest')
    .select('vehicle_id, vendor_request_id')
    .eq('id', manifestId)
    .maybeSingle();
  if (!manifest) return false;
  if (user.role === 'driver') return driverOwnsVehicle(user, manifest.vehicle_id);
  if (user.role === 'vendor' && manifest.vendor_request_id) {
    const { data: request } = await supabase
      .from('vendor_shipment_requests')
      .select('vendor_id')
      .eq('id', manifest.vendor_request_id)
      .maybeSingle();
    return request?.vendor_id === user.user_id;
  }
  return false;
}

/**
 * Shipments, vendor shipment requests and cargo manifests share the
 * shipment endpoints, so all three ID kinds are checked.
 */
export async function canAccessShipment(user: TokenData, shipmentId: string): Promise<boolean> {
  if (isStaff(user)) return true;

  if (user.role === 'vendor') {
    const { data: shipment } = await supabase
      .from('shipments')
      .select('capacity_bids(vendor_id)')
      .eq('id', shipmentId)
      .maybeSingle();
    const bid = shipment?.capacity_bids as { vendor_id?: string } | { vendor_id?: string }[] | null | undefined;
    const bidVendor = Array.isArray(bid) ? bid[0]?.vendor_id : bid?.vendor_id;
    if (bidVendor === user.user_id) return true;

    const { data: request } = await supabase
      .from('vendor_shipment_requests')
      .select('vendor_id')
      .eq('id', shipmentId)
      .maybeSingle();
    if (request) return request.vendor_id === user.user_id;
  }

  if (user.role === 'driver') {
    const vehicleIds = await getDriverVehicleIds(user.user_id);
    if (vehicleIds.length === 0) return false;

    const { data: points } = await supabase.from('delivery_points').select('id').eq('shipment_id', shipmentId);
    const pointIds = (points ?? []).map(p => p.id);
    if (pointIds.length > 0) {
      const { data: stops } = await supabase
        .from('route_stops')
        .select('routes(vehicle_id)')
        .in('delivery_point_id', pointIds);
      for (const stop of stops ?? []) {
        const route = stop.routes as { vehicle_id?: string } | { vehicle_id?: string }[] | null;
        const vehicleId = Array.isArray(route) ? route[0]?.vehicle_id : route?.vehicle_id;
        if (vehicleId && vehicleIds.includes(vehicleId)) return true;
      }
    }

    const { data: request } = await supabase
      .from('vendor_shipment_requests')
      .select('assigned_vehicle_id')
      .eq('id', shipmentId)
      .maybeSingle();
    if (request) return vehicleIds.includes(request.assigned_vehicle_id);
  }

  return canAccessManifest(user, shipmentId);
}

export async function canAccessConfirmation(user: TokenData, confirmationId: string): Promise<boolean> {
  if (isStaff(user)) return true;
  const { data } = await supabase.from('driver_confirmations').select('vehicle_id').eq('id', confirmationId).maybeSingle();
  return driverOwnsVehicle(user, data?.vehicle_id);
}

/**
 * Middleware factory: 403 unless the caller may access the vehicle whose id
 * `getVehicleId` extracts from the request. Runs after requireAuth.
 */
export function requireVehicleAccess(getVehicleId: (req: Request) => string | undefined) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const vehicleId = getVehicleId(req);
    if (!vehicleId) {
      res.status(400).json({ detail: 'vehicle_id is required' });
      return;
    }
    try {
      if (await canAccessVehicle(req.user!, vehicleId)) {
        next();
        return;
      }
      res.status(403).json({ detail: 'Not authorized for this vehicle' });
    } catch (e) {
      next(e);
    }
  };
}

/**
 * A trip dispatch assigned without sending stays pending: the driver cannot see, accept or start it
 * until dispatch sends it (which makes it active). A vendor load is not a trip of this kind.
 */
export async function assertTripSent(routeId: string): Promise<void> {
  const { data: route } = await supabase.from('routes').select('status').eq('id', routeId).maybeSingle();
  if (route?.status === 'pending') throw new HttpError(409, 'Dispatch has not sent this trip yet.');
}
