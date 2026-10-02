/**
 * margixindia — Guards for work on one record, by organisation (docs/tenancy-design.md §5, Phase 2)
 *
 * org-scope.ts limits what a list reads; these limit what an action may touch. Each one costs nothing when
 * nothing is scoped (before organisations are set up, outside a request, or for a platform admin acting as
 * the platform) and is a 404 (never a 403, so ids cannot be probed) for a record another company runs.
 *
 * Rows without an owner column of their own (a fuel log, a service plan, a share link, a stop) are checked
 * through the vehicle or trip they belong to.
 */
import type { NextFunction, Request, Response } from 'express';
import { supabase } from './supabase';
import { registerClearable } from './memo';
import { HttpError } from './errors';
import { OWNED, assertVisible, orgFilter, scopeQuery } from './org-scope';
import { isUuid } from './validate';

export const assertVehicleVisible = (id: string | null | undefined, notFound = 'Vehicle not found'): Promise<void> =>
  id ? assertVisible('vehicles', id, OWNED.carrier, notFound) : Promise.resolve();

/** A trip, or a vendor load that the apps treat as one (a cargo manifest). */
export async function assertTripVisible(id: string, notFound = 'Trip not found'): Promise<void> {
  if (!orgFilter(OWNED.carrier)) return;
  for (const table of ['routes', 'cargo_manifest']) {
    const { data, error } = await scopeQuery(supabase.from(table).select('id').eq('id', id), OWNED.carrier).maybeSingle();
    if (error) throw new Error(`Failed to check ${table}: ${error.message}`);
    if (data) return;
  }
  throw new HttpError(404, notFound);
}

/** A shipment or a vendor load (a vendor's own too). An id that is neither (a vendor request) is left to the handler. */
export async function assertShipmentVisible(id: string, notFound = 'Shipment not found'): Promise<void> {
  if (!orgFilter(OWNED.carrierAndVendor)) return;
  for (const table of ['shipments', 'cargo_manifest']) {
    const { data, error } = await scopeQuery(supabase.from(table).select('id').eq('id', id), OWNED.carrierAndVendor).maybeSingle();
    if (error) throw new Error(`Failed to check ${table}: ${error.message}`);
    if (data) return;
  }
  for (const table of ['shipments', 'cargo_manifest']) {
    const { data } = await supabase.from(table).select('id').eq('id', id).maybeSingle();
    if (data) throw new HttpError(404, notFound);
  }
}

/** A row that belongs to a vehicle (`vehicle_id`): visible when the vehicle is. A missing row is the handler's 404. */
export async function assertOfVisibleVehicle(table: string, id: string, notFound: string, idColumn = 'id'): Promise<void> {
  if (!orgFilter(OWNED.carrier)) return;
  const { data, error } = await supabase.from(table).select('vehicle_id').eq(idColumn, id).maybeSingle();
  if (error) throw new Error(`Failed to check ${table}: ${error.message}`);
  if (!data) throw new HttpError(404, notFound);
  await assertVehicleVisible((data as { vehicle_id: string | null }).vehicle_id, notFound);
}

/** The ids of the vehicles the active organisation runs, or null for no limit. */
export async function visibleVehicleIds(): Promise<Set<string> | null> {
  if (!orgFilter(OWNED.carrier)) return null;
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await scopeQuery(supabase.from('vehicles').select('id'), OWNED.carrier).order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read vehicles: ${error.message}`);
    for (const v of data ?? []) ids.add((v as { id: string }).id);
    if (!data || data.length < PAGE) break;
  }
  return ids;
}

/** The company that runs a row (its carrier_org_id), for work done on the row's behalf outside a request. */
export async function carrierOf(table: string, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabase.from(table).select('carrier_org_id').eq('id', id).maybeSingle();
  return (data as { carrier_org_id?: string | null } | null)?.carrier_org_id ?? null;
}

/** Who runs a vehicle changes almost never, and every location ping asks: remembered for a short while. */
const VEHICLE_OWNER_TTL_MS = 60_000;
const vehicleOwners = new Map<string, { owner: string | null; expiresAt: number }>();
registerClearable({ clear: () => vehicleOwners.clear() });

/** The company that runs a vehicle (null when it has none yet). */
export async function carrierOfVehicle(vehicleId: string | null | undefined): Promise<string | null> {
  if (!vehicleId) return null;
  const hit = vehicleOwners.get(vehicleId);
  if (hit && hit.expiresAt > Date.now()) return hit.owner;
  const owner = await carrierOf('vehicles', vehicleId);
  vehicleOwners.set(vehicleId, { owner, expiresAt: Date.now() + VEHICLE_OWNER_TTL_MS });
  return owner;
}

// ── Middleware: put after requireAuth, so the active organisation is known ──

type Guard = (req: Request, res: Response, next: NextFunction) => void;

const guard = (check: (req: Request) => Promise<void>): Guard => (req, res, next) => {
  check(req).then(() => next(), next);
};

/** 404 unless the vehicle named by the route parameter is one the active company runs. */
export const guardVehicle = (param = 'id'): Guard => guard(async req => {
  if (!isUuid(req.params[param])) throw new HttpError(404, 'Vehicle not found');
  await assertVehicleVisible(req.params[param]);
});

/** 404 unless the row `table` named by the route parameter belongs to a vehicle the active company runs. */
export const guardOfVehicle = (table: string, param: string, notFound: string): Guard =>
  guard(async req => {
    if (!isUuid(req.params[param])) throw new HttpError(404, notFound); // an id that cannot exist, not a database error
    await assertOfVisibleVehicle(table, req.params[param], notFound);
  });

/** 404 unless the row `table` named by the route parameter carries the active company's carrier_org_id. */
export const guardOwned = (table: string, param: string, notFound: string): Guard =>
  guard(async req => {
    if (!isUuid(req.params[param])) throw new HttpError(404, notFound);
    await assertVisible(table, req.params[param], OWNED.carrier, notFound);
  });

/** 404 unless the shipment (or vendor load) named by the route parameter is one the active company runs. */
export const guardShipment = (param = 'shipment_id'): Guard => guard(req => assertShipmentVisible(req.params[param]));

/** 404 unless the trip (or vendor load) named by the route parameter is one the active company runs. */
export const guardTrip = (param = 'route_id'): Guard => guard(req => assertTripVisible(req.params[param]));

/** The company that runs what a row points at: its vehicle, shipment or vendor load (the first that has an owner). */
export async function carrierOfLinks(links: { vehicle_id?: string | null; from_vehicle_id?: string | null; shipment_id?: string | null; manifest_id?: string | null }): Promise<string | null> {
  return (await carrierOfVehicle(links.vehicle_id ?? links.from_vehicle_id))
    ?? (links.shipment_id ? await carrierOf('shipments', links.shipment_id) : null)
    ?? (links.manifest_id ? await carrierOf('cargo_manifest', links.manifest_id) : null);
}
