/**
 * margixindia — the shipment page
 *
 * Everything the page at /shipments/:ref needs in one read: the shipment shaped like a row of the
 * list, and what it links to: who asked for it, its trip, vehicle, driver, lots, problems,
 * transfers, claims and invoice. `ref` is a shipment id, a tracking id (RTX-…), a vendor load's code
 * (CM-…) or id, or the id of a vendor request (the request inbox links loads by it: a request that
 * has been given a vehicle resolves to its load, one that has not is shown as the request it is).
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { manifestStopStatuses, manifestRouteStatus } from './route.service';
import { ShipmentService } from './shipment.service';
import { lotsOf } from './cargo/lots.service';
import { resolveRef, type Consignment } from './cargo/consignment';
import { OPEN_EXCEPTION_STATUSES } from './cargo/exception.service';
import { customerDisplayName } from '../core/customer-name';

export interface OverviewRequester {
  /** `customer_booking`, `vendor_load` (a vendor's posted load), `vendor_bid` (won on a backhaul window) or `staff`. */
  kind: 'customer_booking' | 'vendor_load' | 'vendor_bid' | 'staff';
  /** The booking, vendor request or bid the requester link opens. */
  id: string | null;
  name: string | null;
  status: string | null;
}

export interface OverviewTrip {
  id: string;
  status: string;
  /** `optimizer`, `planner`, `vendor_load` or `assigned` (a vehicle picked by hand). */
  source: string;
  distance_km: number | null;
  stop_count: number;
  stops_done: number;
  /** The trip stop that is this shipment's drop, and where it stands. */
  this_stop: { position: number; status: string } | null;
}

export interface ShipmentOverview {
  /** `request` is a vendor's load request that has no load yet (nothing assigned). */
  kind: 'shipment' | 'manifest' | 'request';
  code: string;
  shipment: Record<string, any>;
  requester: OverviewRequester;
  trip: OverviewTrip | null;
  vehicle: { id: string; plate_number: string | null } | null;
  driver: { id: string; name: string | null } | null;
  master: { id: string; tracking_id: string } | null;
  problems: { id: string; code: string; type: string; status: string; open: boolean; sla_due_at: string | null }[];
  transfers: { id: string; code: string; status: string }[];
  claims: { id: string; code: string; status: string; claim_type: string | null }[];
  invoice: { id: string; invoice_number: string | null; status: string; total: number | null } | null;
  /** The price the customer or vendor pays: null while nobody has set one. */
  price: number | null;
}

const TRIP_ORDER = ['active', 'pending', 'completed'];

function sourceOf(route: Record<string, any>): string {
  if (route.plan?.source === 'route_planner') return 'planner';
  if (route.depot_id) return 'optimizer';
  return 'assigned';
}

async function tripOf(c: Consignment, row: Record<string, any>): Promise<{ trip: OverviewTrip | null; vehicleId: string | null }> {
  if (c.kind === 'manifest') {
    // A vendor load is its own trip: a pickup and a drop
    const statuses = manifestStopStatuses(String(row.status));
    const stops = [statuses.pickup, statuses.drop];
    return {
      vehicleId: c.vehicleId,
      trip: c.vehicleId || row.status !== 'scheduled' ? {
        id: c.id,
        status: manifestRouteStatus(String(row.status)),
        source: 'vendor_load',
        distance_km: null,
        stop_count: 2,
        stops_done: stops.filter(s => s === 'completed').length,
        this_stop: { position: 2, status: statuses.drop },
      } : null,
    };
  }

  const dpIds = ((row.delivery_points ?? []) as any[]).map(d => d.id).filter(Boolean);
  if (dpIds.length === 0) return { trip: null, vehicleId: c.vehicleId };
  const { data: myStops } = await supabase.from('route_stops').select('id, route_id, delivery_point_id, sequence, status').in('delivery_point_id', dpIds);
  // A stop taken off the trip (the shipment was released or cancelled) no longer links the shipment to it
  const liveStops = (myStops ?? []).filter((s: any) => s.status !== 'cancelled');
  const routeIds = [...new Set(liveStops.map((s: any) => s.route_id))];
  if (routeIds.length === 0) return { trip: null, vehicleId: c.vehicleId };
  const { data: routes } = await supabase
    .from('routes').select('id, status, vehicle_id, depot_id, plan, total_distance_km, created_at').in('id', routeIds).neq('status', 'cancelled');
  const ranked = [...(routes ?? [])].sort((a: any, b: any) => {
    const byStatus = TRIP_ORDER.indexOf(a.status) - TRIP_ORDER.indexOf(b.status);
    return byStatus || Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? '');
  });
  const route = ranked[0];
  if (!route) return { trip: null, vehicleId: c.vehicleId };

  const { data: tripStops } = await supabase.from('route_stops').select('id, delivery_point_id, sequence, status').eq('route_id', route.id);
  const ordered = [...(tripStops ?? [])].sort((a: any, b: any) => a.sequence - b.sequence);
  const mine = ordered.filter((s: any) => dpIds.includes(s.delivery_point_id));
  const last = mine[mine.length - 1];
  return {
    vehicleId: route.vehicle_id ?? c.vehicleId,
    trip: {
      id: route.id,
      status: route.status,
      source: sourceOf(route),
      distance_km: route.total_distance_km != null ? Number(route.total_distance_km) : null,
      stop_count: ordered.length,
      stops_done: ordered.filter((s: any) => s.status !== 'pending').length,
      this_stop: last ? { position: ordered.indexOf(last) + 1, status: last.status } : null,
    },
  };
}

async function requesterOf(c: Consignment, row: Record<string, any>): Promise<{ requester: OverviewRequester; requestCost: number | null }> {
  const staff: OverviewRequester = { kind: 'staff', id: null, name: null, status: null };
  // A lot is asked for by whoever asked for its master
  const ownerId = c.parentId ?? c.id;

  if (c.kind === 'manifest') {
    let requestId: string | null = row.vendor_request_id ?? null;
    if (!requestId && c.parentId) {
      const { data: parent } = await supabase.from('cargo_manifest').select('vendor_request_id').eq('id', c.parentId).maybeSingle();
      requestId = parent?.vendor_request_id ?? null;
    }
    if (!requestId) return { requester: staff, requestCost: null };
    const { data: request } = await supabase.from('vendor_shipment_requests').select('id, vendor_id, status, cost').eq('id', requestId).maybeSingle();
    if (!request) return { requester: staff, requestCost: null };
    const { data: vendor } = await supabase.from('vendor_profiles').select('company_name').eq('id', request.vendor_id).maybeSingle();
    return {
      requester: { kind: 'vendor_load', id: request.id, name: vendor?.company_name ?? null, status: request.status ?? null },
      requestCost: request.cost != null ? Number(request.cost) : null,
    };
  }

  const { data: booking } = await supabase.from('customer_bookings').select('id, customer_id, status').eq('shipment_id', ownerId).maybeSingle();
  if (booking) {
    const { data: customer } = await supabase.from('customers').select('full_name, company_name, phone').eq('id', booking.customer_id).maybeSingle();
    return {
      requester: { kind: 'customer_booking', id: booking.id, name: customer ? customerDisplayName(customer) : null, status: booking.status ?? null },
      requestCost: null,
    };
  }
  const bidId = (c.parentId ? null : row.bid_id) ?? null;
  if (bidId) {
    const { data: bid } = await supabase.from('capacity_bids').select('id, vendor_id, status').eq('id', bidId).maybeSingle();
    if (bid) {
      const { data: vendor } = await supabase.from('vendor_profiles').select('company_name').eq('id', bid.vendor_id).maybeSingle();
      return { requester: { kind: 'vendor_bid', id: bid.id, name: vendor?.company_name ?? null, status: bid.status ?? null }, requestCost: null };
    }
  }
  return { requester: staff, requestCost: null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A vendor request that no vehicle has been given yet, shaped like a row of the shipment list. */
async function requestOverview(request: Record<string, any>): Promise<ShipmentOverview> {
  const [{ data: vendor }, { data: vehicle }] = await Promise.all([
    supabase.from('vendor_profiles').select('company_name').eq('id', request.vendor_id).maybeSingle(),
    request.assigned_vehicle_id
      ? supabase.from('vehicles').select('id, plate_number, driver_id, driver_name').eq('id', request.assigned_vehicle_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);
  const cost = request.cost != null ? Number(request.cost) : null;
  const code = `VR-${String(request.id).substring(0, 8).toUpperCase()}`;
  return {
    kind: 'request',
    code,
    shipment: {
      id: request.id,
      tracking_id: code,
      status: request.status,
      origin_name: request.pickup_location ?? null,
      origin_address: request.pickup_location ?? null,
      origin_lat: request.pickup_lat ?? null,
      origin_lng: request.pickup_lng ?? null,
      total_weight_kg: request.required_capacity_kg ?? null,
      freight_charge: cost,
      metadata: request.metadata ?? {},
      created_at: request.created_at ?? null,
      delivery_points: [{ id: `${request.id}_dp`, name: request.drop_location ?? null, address: request.drop_location ?? null, latitude: request.drop_lat ?? null, longitude: request.drop_lng ?? null }],
      vehicle_id: vehicle?.id ?? null,
      driver_name: vehicle?.driver_name ?? null,
    },
    requester: { kind: 'vendor_load', id: request.id, name: vendor?.company_name ?? null, status: request.status ?? null },
    trip: null,
    vehicle: vehicle ? { id: vehicle.id, plate_number: vehicle.plate_number ?? null } : null,
    driver: vehicle?.driver_id ? { id: vehicle.driver_id, name: vehicle.driver_name ?? null } : null,
    master: null,
    problems: [],
    transfers: [],
    claims: [],
    invoice: null,
    price: cost,
  };
}

/**
 * The consignment a reference names. An id that is a vendor request resolves to that request's
 * load once there is one (the master, when the load was split); until then it is the request itself.
 */
async function findOverviewTarget(ref: string): Promise<{ consignment: Consignment } | { request: Record<string, any> }> {
  try {
    return { consignment: await resolveRef(ref) };
  } catch (e) {
    if (!(e instanceof HttpError) || e.status !== 404 || !UUID.test(ref.trim())) throw e;
  }
  const { data: request } = await supabase.from('vendor_shipment_requests').select('*').eq('id', ref.trim()).maybeSingle();
  if (!request) throw new HttpError(404, 'Shipment not found');
  const { data: loads } = await supabase.from('cargo_manifest').select('id, parent_manifest_id, created_at').eq('vendor_request_id', request.id);
  const load = [...(loads ?? [])].sort((a: any, b: any) => Number(!!a.parent_manifest_id) - Number(!!b.parent_manifest_id) || Date.parse(a.created_at ?? '') - Date.parse(b.created_at ?? ''))[0];
  return load ? { consignment: await resolveRef({ manifest_id: load.id }) } : { request };
}

/** The consignment (and, for a master, its lots) as one shipment page reads it. */
export async function shipmentOverview(ref: string): Promise<ShipmentOverview> {
  const target = await findOverviewTarget(ref);
  if ('request' in target) return requestOverview(target.request);
  const c = target.consignment;
  const row = await ShipmentService.getListRow(c.kind, c.id);
  if (!row) throw new HttpError(404, 'Shipment not found');

  const idColumn = c.kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  const lotIds = c.isMaster ? (await lotsOf(c.kind, c.id)).map(l => l.id) : [];
  const ids = [c.id, ...lotIds];

  const [{ trip, vehicleId }, { requester, requestCost }] = await Promise.all([tripOf(c, row), requesterOf(c, row)]);

  // Who drives: the trip's vehicle, else the one the shipment names
  const vid = vehicleId ?? row.vehicle_id ?? null;
  const { data: vehicle } = vid
    ? await supabase.from('vehicles').select('id, plate_number, driver_id, driver_name').eq('id', vid).maybeSingle()
    : { data: null };
  const driver = vehicle?.driver_id
    ? { id: vehicle.driver_id as string, name: (vehicle.driver_name as string | null) ?? (row.driver_name as string | null) ?? null }
    : null;

  // The trip's vehicle is the shipment's vehicle (a master has none: its lots do)
  if (!c.isMaster && vehicle) {
    row.vehicle_id = vehicle.id;
    row.driver_name = driver?.name ?? row.driver_name ?? null;
  }

  let master: ShipmentOverview['master'] = null;
  if (c.parentId && c.kind === 'shipment') {
    const { data } = await supabase.from('shipments').select('id, tracking_id').eq('id', c.parentId).maybeSingle();
    if (data) master = { id: data.id, tracking_id: data.tracking_id };
  }

  // Problems and transfers touch the shipment through their items
  const [{ data: exItems }, { data: trItems }, { data: claimRows }, { data: invoiceRows }] = await Promise.all([
    supabase.from('cargo_exception_items').select('exception_id').in(idColumn, ids),
    supabase.from('cargo_transfer_items').select('transfer_id').in(idColumn, ids),
    supabase.from('cargo_claims').select('id, code, status, claim_type, created_at').in(idColumn, ids),
    supabase.from('invoices').select('id, invoice_number, status, total, amount, created_at').in(idColumn, [c.id, ...(c.parentId ? [c.parentId] : [])]),
  ]);
  const exceptionIds = [...new Set((exItems ?? []).map((i: any) => i.exception_id))];
  const transferIds = [...new Set((trItems ?? []).map((i: any) => i.transfer_id))];
  const [{ data: exceptions }, { data: transfers }] = await Promise.all([
    exceptionIds.length ? supabase.from('cargo_exceptions').select('id, code, type, status, sla_due_at, created_at').in('id', exceptionIds) : Promise.resolve({ data: [] as any[] }),
    transferIds.length ? supabase.from('cargo_transfers').select('id, code, status').in('id', transferIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const isOpen = (status: string) => (OPEN_EXCEPTION_STATUSES as readonly string[]).includes(status);
  const problems = [...(exceptions ?? [])]
    .sort((a: any, b: any) => Number(isOpen(b.status)) - Number(isOpen(a.status)) || Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''))
    .map((e: any) => ({ id: e.id, code: e.code, type: e.type, status: e.status, open: isOpen(e.status), sla_due_at: e.sla_due_at ?? null }));

  const invoice = [...(invoiceRows ?? [])]
    .filter((i: any) => i.status !== 'void')
    .sort((a: any, b: any) => Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? ''))[0];

  const shipmentPrice = row.freight_share ?? row.freight_charge;
  const price = c.kind === 'manifest' ? requestCost : shipmentPrice != null ? Number(shipmentPrice) : null;

  return {
    kind: c.kind,
    code: c.code,
    shipment: row,
    requester,
    trip,
    vehicle: vehicle ? { id: vehicle.id, plate_number: vehicle.plate_number ?? null } : null,
    driver,
    master,
    problems,
    transfers: (transfers ?? []).map((t: any) => ({ id: t.id, code: t.code, status: t.status })),
    claims: (claimRows ?? []).map((k: any) => ({ id: k.id, code: k.code, status: k.status, claim_type: k.claim_type ?? null })),
    invoice: invoice
      ? { id: invoice.id, invoice_number: invoice.invoice_number ?? null, status: invoice.status, total: invoice.total != null ? Number(invoice.total) : invoice.amount != null ? Number(invoice.amount) : null }
      : null,
    price,
  };
}
