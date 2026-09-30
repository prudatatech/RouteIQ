/**
 * margixindia — Parcel scans (driver app)
 *
 * A driver scans a parcel's code at pickup and at delivery. The parcel must be
 * on one of the driver's own active or pending routes (or vendor loads), and a
 * delivery scan must be for the stop the driver is standing at.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { getDriverVehicleIds } from '../core/ownership';
import { normalizeParcelCode } from '../core/parcelCode';
import { codeOf } from './cargo/consignment';

export type ScanPurpose = 'pickup' | 'delivery';
export type ScanMethod = 'camera' | 'manual';

interface ShipmentParcel {
  id: string;
  tracking_id: string;
  status: string;
}

interface StopParcel {
  stop_id: string;
  route_id: string;
  status: string;
  shipment: ShipmentParcel | null;
}

interface ManifestParcel {
  id: string;
  status: string;
  code: string;
}

/** Everything a driver can legitimately scan right now. */
export interface DriverParcels {
  stops: StopParcel[];
  manifests: ManifestParcel[];
}

const OPEN_ROUTE_STATUSES = ['active', 'pending'];
const OPEN_MANIFEST_STATUSES = ['scheduled', 'in_transit'];

/** The shipments on the driver's open routes, per stop, and their open vendor loads. */
export async function loadDriverParcels(driverId: string): Promise<DriverParcels> {
  const vehicleIds = await getDriverVehicleIds(driverId);
  if (vehicleIds.length === 0) return { stops: [], manifests: [] };

  const { data: routes, error: routeErr } = await supabase
    .from('routes')
    .select('id')
    .in('vehicle_id', vehicleIds)
    .in('status', OPEN_ROUTE_STATUSES);
  if (routeErr) throw new Error(`Route lookup failed: ${routeErr.message}`);
  const routeIds = (routes ?? []).map(r => r.id as string);

  const stops: StopParcel[] = [];
  if (routeIds.length > 0) {
    const { data: stopRows, error: stopErr } = await supabase
      .from('route_stops')
      .select('id, route_id, status, delivery_point_id')
      .in('route_id', routeIds);
    if (stopErr) throw new Error(`Stop lookup failed: ${stopErr.message}`);

    const pointIds = (stopRows ?? []).map(s => s.delivery_point_id as string).filter(Boolean);
    const shipmentByPoint = new Map<string, string>();
    if (pointIds.length > 0) {
      const { data: points } = await supabase.from('delivery_points').select('id, shipment_id').in('id', pointIds);
      for (const p of points ?? []) if (p.shipment_id) shipmentByPoint.set(p.id as string, p.shipment_id as string);
    }
    const shipmentIds = [...new Set(shipmentByPoint.values())];
    const shipments = new Map<string, ShipmentParcel>();
    if (shipmentIds.length > 0) {
      const { data: rows } = await supabase.from('shipments').select('id, tracking_id, status').in('id', shipmentIds);
      for (const s of rows ?? []) shipments.set(s.id as string, s as ShipmentParcel);
    }
    for (const s of stopRows ?? []) {
      const shipmentId = shipmentByPoint.get(s.delivery_point_id as string);
      stops.push({
        stop_id: s.id as string,
        route_id: s.route_id as string,
        status: s.status as string,
        shipment: shipmentId ? shipments.get(shipmentId) ?? null : null,
      });
    }
  }

  const { data: manifestRows, error: manifestErr } = await supabase
    .from('cargo_manifest')
    .select('id, status, parent_manifest_id, lot_label')
    .in('vehicle_id', vehicleIds)
    .in('status', OPEN_MANIFEST_STATUSES);
  if (manifestErr) throw new Error(`Load lookup failed: ${manifestErr.message}`);
  const manifests = (manifestRows ?? []).map(m => ({ id: m.id as string, status: m.status as string, code: codeOf('manifest', m) }));

  return { stops, manifests };
}

/** Tracking ID and status per shipment, for the codes the app checks scans against. */
export async function loadShipmentParcels(shipmentIds: string[]): Promise<Map<string, { tracking_id: string; status: string }>> {
  const out = new Map<string, { tracking_id: string; status: string }>();
  const ids = [...new Set(shipmentIds)];
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from('shipments').select('id, tracking_id, status').in('id', ids);
  if (error) throw new Error(`Shipment lookup failed: ${error.message}`);
  for (const s of data ?? []) out.set(s.id as string, { tracking_id: s.tracking_id as string, status: s.status as string });
  return out;
}

export interface ScanInput {
  code: unknown;
  purpose: unknown;
  stop_id?: unknown;
  method?: unknown;
  lat?: unknown;
  lng?: unknown;
}

export interface ScanResult {
  ok: true;
  purpose: ScanPurpose;
  kind: 'shipment' | 'manifest';
  shipment_id: string | null;
  manifest_id: string | null;
  tracking_id: string;
  stop_id: string | null;
  /** The parcel had already been picked up (or verified); nothing changed. */
  already: boolean;
  status: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function recordScan(row: {
  shipment_id?: string | null;
  manifest_id?: string | null;
  stop_id?: string | null;
  driver_id: string;
  purpose: ScanPurpose;
  method: ScanMethod;
  lat: number | null;
  lng: number | null;
}): Promise<void> {
  const { error } = await supabase.from('parcel_scans').insert({
    shipment_id: row.shipment_id ?? null,
    manifest_id: row.manifest_id ?? null,
    stop_id: row.stop_id ?? null,
    driver_id: row.driver_id,
    purpose: row.purpose,
    method: row.method,
    latitude: row.lat,
    longitude: row.lng,
  });
  if (error) throw new Error(`Failed to record scan: ${error.message}`);
}

export async function scanParcel(driverId: string, input: ScanInput): Promise<ScanResult> {
  const code = normalizeParcelCode(input.code);
  if (!code) throw new HttpError(400, 'A code is required');
  if (input.purpose !== 'pickup' && input.purpose !== 'delivery') {
    throw new HttpError(400, 'purpose must be pickup or delivery');
  }
  const purpose: ScanPurpose = input.purpose;
  const method: ScanMethod = input.method === 'manual' ? 'manual' : 'camera';
  const stopId = typeof input.stop_id === 'string' && input.stop_id ? input.stop_id : null;
  const lat = num(input.lat);
  const lng = num(input.lng);
  if (purpose === 'delivery' && !stopId) throw new HttpError(400, 'stop_id is required to verify a delivery');

  const parcels = await loadDriverParcels(driverId);

  // Shipment on one of the driver's routes
  const shipmentStops = parcels.stops.filter(s => {
    if (!s.shipment) return false;
    return normalizeParcelCode(s.shipment.tracking_id) === code || s.shipment.id.toUpperCase() === code;
  });
  if (shipmentStops.length > 0) {
    const shipment = shipmentStops[0].shipment!;
    if (purpose === 'delivery') {
      const stop = shipmentStops.find(s => s.stop_id === stopId);
      if (!stop) throw new HttpError(409, 'This parcel is for a different stop');
      if (shipment.status === 'cancelled') throw new HttpError(409, 'This shipment was cancelled');
      await recordScan({ shipment_id: shipment.id, stop_id: stopId, driver_id: driverId, purpose, method, lat, lng });
      return { ok: true, purpose, kind: 'shipment', shipment_id: shipment.id, manifest_id: null, tracking_id: shipment.tracking_id, stop_id: stopId, already: false, status: shipment.status };
    }

    if (stopId && !shipmentStops.some(s => s.stop_id === stopId)) throw new HttpError(409, 'This parcel is for a different stop');
    if (shipment.status === 'cancelled' || shipment.status === 'delivered') {
      throw new HttpError(409, `This shipment is already ${shipment.status}`);
    }
    // The scan is the custody pickup: the goods go on the driver's vehicle, counted from the booking
    const { recordCustody } = await import('./cargo/custody.service');
    const picked = await recordCustody(
      { shipment_id: shipment.id },
      { kind: 'pickup', lat, lng, notes: `Parcel scan (${method})` },
      { id: driverId, role: 'driver' },
      { via: 'parcel_scan', logMetadata: { via: 'parcel_scan', scan_method: method } },
    );
    if (picked.already) {
      return { ok: true, purpose, kind: 'shipment', shipment_id: shipment.id, manifest_id: null, tracking_id: shipment.tracking_id, stop_id: stopId, already: true, status: shipment.status };
    }
    await recordScan({ shipment_id: shipment.id, stop_id: stopId, driver_id: driverId, purpose, method, lat, lng });
    return { ok: true, purpose, kind: 'shipment', shipment_id: shipment.id, manifest_id: null, tracking_id: shipment.tracking_id, stop_id: stopId, already: false, status: 'picked_up' };
  }

  // Vendor load (cargo manifest)
  const manifest = parcels.manifests.find(m => m.code === code || m.id.toUpperCase() === code);
  if (manifest) {
    const expectedStop = `${manifest.id}_${purpose === 'pickup' ? 'pickup' : 'drop'}`;
    if (stopId && stopId !== expectedStop) throw new HttpError(409, 'This parcel is for a different stop');
    // Completing the pickup stop is what loads the vehicle and moves the load in transit, so a scan only verifies it.
    await recordScan({ manifest_id: manifest.id, stop_id: expectedStop, driver_id: driverId, purpose, method, lat, lng });
    return { ok: true, purpose, kind: 'manifest', shipment_id: null, manifest_id: manifest.id, tracking_id: manifest.code, stop_id: expectedStop, already: false, status: manifest.status };
  }

  throw new HttpError(404, 'This parcel is not on your route');
}

/** True when the driver scanned this shipment at its delivery stop. */
export async function wasDeliveryScanned(shipmentId: string, driverId: string, stopId: string): Promise<boolean> {
  const { data } = await supabase
    .from('parcel_scans')
    .select('id')
    .eq('shipment_id', shipmentId)
    .eq('driver_id', driverId)
    .eq('stop_id', stopId)
    .eq('purpose', 'delivery')
    .limit(1);
  return !!data && data.length > 0;
}
