/**
 * margixindia — Backhaul pooling routes
 * Open loads, pooling plans, return-load matching, cargo alerts and delivery confirmation.
 *
 * Every figure returned here is either read from the database or measured
 * (road distances from Mappls, stop order from the ML optimiser). Nothing is
 * priced from made-up rates.
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { OWNED, scopeQuery } from '../core/org-scope';
import { assertShipmentVisible, assertVehicleVisible, guardOwned } from '../core/org-guards';
import { sendError, HttpError } from '../core/errors';
import { logFallback, mlPost } from '../services/optimizer/ml-client';
import { orderDropsInProcess } from '../services/optimizer/pooling';
import { MapplsService } from '../services/mappls.service';
import { resolveAlert } from '../services/alerts.service';
import { idempotent } from '../core/idempotency';
import { OWNED, assertVisible } from '../core/org-scope';
import { cargoFolder, isPathIn, recordCustody } from '../services/cargo/custody.service';

const router = Router();

/**
 * Fetch a real depot to use as the reference point for pooling/backhaul
 * distance math. Returns null when no depot is configured — callers must
 * treat that as "cannot compute" rather than falling back to a guessed
 * location.
 */
async function getReferenceDepot(): Promise<{ id: string; name: string; latitude: number; longitude: number } | null> {
  // The company's own depot only: another company's yard is not a reference point for its trips
  const { data } = await scopeQuery(supabase
    .from('depots')
    .select('id, name, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null), OWNED.carrier)
    .limit(1)
    .maybeSingle();
  return data || null;
}

/** A shipment that is waiting for a vehicle, shaped for pooling and matching. */
export interface OpenLoad {
  id: string;
  tracking_id: string;
  status: string;
  priority: string | null;
  shipper: string | null;
  origin: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  destination: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  stops: number;
  /** Null when the shipment has no recorded weight. */
  weight_kg: number | null;
  created_at: string;
}

/**
 * Shipments that are created but not yet on any route. When `ids` is given,
 * only those shipments are returned (still only if they are open).
 */
async function loadOpenLoads(ids?: string[]): Promise<OpenLoad[]> {
  // Only the active company's own shipments (a platform admin acting as the platform sees every company's)
  let query = scopeQuery(supabase
    .from('shipments')
    .select('id, tracking_id, status, priority, origin_name, origin_address, origin_lat, origin_lng, total_weight_kg, created_at, delivery_points!delivery_points_shipment_id_fkey(id, name, address, latitude, longitude)')
    .eq('status', 'created')
    .neq('is_master', true), OWNED.carrier)
    .order('created_at', { ascending: false });
  query = ids ? query.in('id', ids) : query.limit(100);

  const { data: shipments, error } = await query;
  if (error) throw error;
  const rows = shipments || [];

  // Drop shipments whose delivery points are already on a route.
  const dpIds = rows.flatMap((s: any) => (s.delivery_points || []).map((dp: any) => dp.id));
  const routed = new Set<string>();
  if (dpIds.length > 0) {
    const { data: stops, error: stopsErr } = await supabase
      .from('route_stops')
      .select('delivery_point_id')
      .in('delivery_point_id', dpIds);
    if (stopsErr) throw stopsErr;
    (stops || []).forEach((s: any) => routed.add(s.delivery_point_id));
  }

  // Drop shipments someone else already holds: a 3PL partner has (or is being offered) the
  // load, or a bidding window on a vehicle is open for it.
  const held = new Set<string>();
  const rowIds = rows.map((s: any) => s.id);
  if (rowIds.length > 0) {
    const [orders, offers, windows] = await Promise.all([
      supabase.from('tpl_orders').select('shipment_id').in('shipment_id', rowIds).neq('status', 'cancelled'),
      supabase.from('tpl_offers').select('shipment_id').in('shipment_id', rowIds).eq('status', 'offered'),
      supabase.from('capacity_windows').select('fallback_shipment_id').in('fallback_shipment_id', rowIds).eq('status', 'open').is('winning_bid_id', null),
    ]);
    if (orders.error) throw orders.error;
    if (offers.error) throw offers.error;
    if (windows.error) throw windows.error;
    (orders.data || []).forEach((o: any) => held.add(o.shipment_id));
    (offers.data || []).forEach((o: any) => held.add(o.shipment_id));
    (windows.data || []).forEach((w: any) => held.add(w.fallback_shipment_id));
  }

  return rows
    .filter((s: any) => !held.has(s.id))
    .filter((s: any) => !(s.delivery_points || []).some((dp: any) => routed.has(dp.id)))
    .map((s: any) => {
      const points: any[] = s.delivery_points || [];
      const dest = points.find(dp => dp.latitude != null && dp.longitude != null) ?? points[0] ?? null;
      return {
        id: s.id,
        tracking_id: s.tracking_id,
        status: s.status,
        priority: s.priority ?? null,
        shipper: s.origin_name ?? null,
        origin: s.origin_address ?? null,
        origin_lat: s.origin_lat ?? null,
        origin_lng: s.origin_lng ?? null,
        destination: dest ? (dest.address || dest.name || null) : null,
        dest_lat: dest?.latitude ?? null,
        dest_lng: dest?.longitude ?? null,
        stops: points.length,
        weight_kg: typeof s.total_weight_kg === 'number' && s.total_weight_kg > 0 ? s.total_weight_kg : null,
        created_at: s.created_at,
      };
    });
}

/** Mappls returns the matrix under `results`; older responses put it at the top level. */
function matrixDistances(matrix: any): number[][] | null {
  const d = matrix?.results?.distances ?? matrix?.distances;
  return Array.isArray(d) ? d : null;
}

const km = (metres: number) => Math.round((metres / 1000) * 10) / 10;

// ── GET /shipments ─────────────────────────────────────────
router.get('/shipments', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { data, error } = await scopeQuery(supabase.from('shipments').select('*'), OWNED.carrier);
    if (error) throw error;
    res.json(data || []);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /open-loads ────────────────────────────────────────
router.get('/open-loads', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await loadOpenLoads());
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /security-alerts ───────────────────────────────────
router.get('/security-alerts', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { data: alerts, error } = await scopeQuery(supabase
      .from('maintenance_alerts')
      .select('*, vehicles(plate_number)')
      .eq('is_resolved', false), OWNED.carrier)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(
      (alerts || []).map((a: any) => ({
        id: a.id,
        timestamp: a.created_at,
        vehicle_id: a.vehicle_id,
        plate_number: a.vehicles?.plate_number || null,
        type: a.alert_type,
        severity: a.severity,
        message: a.description,
        status: 'active',
      }))
    );
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /resolve-alert/:alert_id ──────────────────────────
// Kept for older clients; the console resolves alarms with POST /fleet/alerts/:id/resolve.
router.post('/resolve-alert/:alert_id', requireAuth, requireRole(...STAFF_ROLES), guardOwned('maintenance_alerts', 'alert_id', 'Alert not found'), async (req: Request, res: Response) => {
  try {
    const result = await resolveAlert(req.params.alert_id, req.user!.user_id);
    if (result === 'not_found') {
      res.status(404).json({ detail: 'Alert not found' });
      return;
    }
    res.json({
      status: 'success',
      alert: { id: result.id, status: 'resolved', resolved_at: result.resolved_at },
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /optimize-pooling ─────────────────────────────────
// Body: { shipment_ids: string[], vehicle_id: string }
// Plans one run from the depot that drops every selected load, and compares its
// road distance with sending a separate round trip to each drop.
router.post('/optimize-pooling', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const ids: unknown = req.body?.shipment_ids;
    const vehicleId: unknown = req.body?.vehicle_id;
    if (!Array.isArray(ids) || ids.length < 2 || !ids.every(id => typeof id === 'string')) {
      throw new HttpError(400, 'Choose at least two loads to pool.');
    }
    if (typeof vehicleId !== 'string' || !vehicleId) {
      throw new HttpError(400, 'Choose the vehicle that will carry the pooled loads.');
    }

    await assertVehicleVisible(vehicleId);
    const { data: vehicle, error: vehicleErr } = await supabase
      .from('vehicles')
      .select('id, plate_number, capacity_kg')
      .eq('id', vehicleId)
      .maybeSingle();
    if (vehicleErr) throw vehicleErr;
    if (!vehicle) throw new HttpError(404, 'Vehicle not found');
    if (!vehicle.capacity_kg) throw new HttpError(422, `Vehicle ${vehicle.plate_number} has no capacity recorded.`);

    const loads = await loadOpenLoads(ids as string[]);
    if (loads.length !== ids.length) {
      throw new HttpError(409, 'Some of the chosen loads are no longer open. Refresh the list and try again.');
    }
    const incomplete = loads.filter(l => l.dest_lat == null || l.dest_lng == null || l.weight_kg == null);
    if (incomplete.length > 0) {
      throw new HttpError(422, `These loads need a drop location and weight before they can be pooled: ${incomplete.map(l => l.tracking_id).join(', ')}`);
    }
    const totalWeightKg = loads.reduce((s, l) => s + (l.weight_kg || 0), 0);
    if (totalWeightKg > vehicle.capacity_kg) {
      throw new HttpError(422, `The chosen loads weigh ${totalWeightKg.toLocaleString('en-IN')} kg, more than ${vehicle.plate_number} can carry (${vehicle.capacity_kg.toLocaleString('en-IN')} kg).`);
    }

    const depot = await getReferenceDepot();
    if (!depot) throw new HttpError(422, 'No depot is set up, so a pooled trip cannot be planned.');

    // Stop order from the ML optimiser
    let stopIds: string[] | null = null;
    try {
      const ml: any = await mlPost('/optimize', {
        locations: [
          { id: 'depot', lat: depot.latitude, lng: depot.longitude, demand_kg: 0 },
          ...loads.map(l => ({ id: l.id, lat: l.dest_lat, lng: l.dest_lng, demand_kg: l.weight_kg })),
        ],
        vehicles: [{ id: vehicle.id, capacity_kg: vehicle.capacity_kg, start_lat: depot.latitude, start_lng: depot.longitude }],
        algorithm: 'ortools',
      }, { timeoutMs: 10_000, probe: true });
      const seq = ml?.routes?.[0]?.stop_ids;
      if (Array.isArray(seq)) stopIds = seq.filter((id: string) => id !== 'depot');
    } catch (e) {
      logFallback('pooling optimize', e, 'the in-process solver');
    }
    if (!stopIds || stopIds.length !== loads.length) {
      const local = await orderDropsInProcess(
        { lat: depot.latitude, lng: depot.longitude },
        { id: vehicle.id, capacityKg: vehicle.capacity_kg },
        loads.map(l => ({ id: l.id, lat: l.dest_lat as number, lng: l.dest_lng as number, weightKg: l.weight_kg || 0 })),
      );
      stopIds = local?.order ?? null;
    }
    if (!stopIds || stopIds.length !== loads.length) {
      res.status(502).json({ detail: 'The trip optimiser is not available right now. Try again shortly.' });
      return;
    }

    const ordered = stopIds.map(id => loads.find(l => l.id === id)!);
    const depotCoord = `${depot.longitude},${depot.latitude}`;

    // Road distances from Mappls
    let separateKm: number | null = null;
    let pooledKm: number | null = null;
    try {
      const dropCoords = loads.map(l => `${l.dest_lng},${l.dest_lat}`);
      const sep = matrixDistances(await MapplsService.getDistanceMatrix([depotCoord, ...dropCoords], [0], loads.map((_, i) => i + 1)));
      if (sep?.[0]) separateKm = km(sep[0].reduce((sum, d) => sum + d, 0) * 2);

      const runCoords = [depotCoord, ...ordered.map(l => `${l.dest_lng},${l.dest_lat}`)];
      const legs = runCoords.length - 1;
      const run = matrixDistances(await MapplsService.getDistanceMatrix(
        runCoords,
        Array.from({ length: legs }, (_, i) => i),
        Array.from({ length: legs }, (_, i) => i + 1),
      ));
      // Row i is source i, column i is destination i + 1: the leg from stop i to stop i + 1.
      if (run && run.length === legs) pooledKm = km(run.reduce((sum, row, i) => sum + (row?.[i] ?? 0), 0));
    } catch (e: any) {
      console.warn('Mappls distance matrix error (pooling):', e.message);
    }
    if (separateKm == null || pooledKm == null) {
      res.status(502).json({ detail: 'Road distances are not available right now. Try again shortly.' });
      return;
    }

    res.json({
      vehicle: { id: vehicle.id, plate_number: vehicle.plate_number, capacity_kg: vehicle.capacity_kg },
      depot: { id: depot.id, name: depot.name },
      total_weight_kg: totalWeightKg,
      separate_trips_distance_km: separateKm,
      pooled_distance_km: pooledKm,
      distance_saved_km: Math.round((separateKm - pooledKm) * 10) / 10,
      stops: ordered.map((l, i) => ({
        sequence: i + 1,
        shipment_id: l.id,
        tracking_id: l.tracking_id,
        destination: l.destination,
        weight_kg: l.weight_kg,
      })),
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /backhaul-match ───────────────────────────────────
// Body: { opportunity_id: string, available_capacity_kg: number }
// Checks whether an open load fits the space left on a returning truck and how
// far the truck has to drive from the depot to pick it up and drop it.
router.post('/backhaul-match', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const opportunityId = req.body?.opportunity_id;
    const availableCapacityKg = Number(req.body?.available_capacity_kg);
    if (typeof opportunityId !== 'string' || !opportunityId) throw new HttpError(400, 'Choose a load to match.');
    if (!Number.isFinite(availableCapacityKg) || availableCapacityKg <= 0) {
      throw new HttpError(400, 'Enter the space left on the truck in kg.');
    }

    const [load] = await loadOpenLoads([opportunityId]);
    if (!load) {
      res.status(404).json({ detail: 'This load is no longer open.' });
      return;
    }
    if (load.weight_kg == null) {
      throw new HttpError(422, `Load ${load.tracking_id} has no weight recorded, so it cannot be matched.`);
    }

    if (load.weight_kg > availableCapacityKg) {
      res.json({
        status: 'rejected',
        opportunity_id: load.id,
        tracking_id: load.tracking_id,
        weight_kg: load.weight_kg,
        reason: `The load weighs ${load.weight_kg.toLocaleString('en-IN')} kg but only ${availableCapacityKg.toLocaleString('en-IN')} kg of space is left.`,
      });
      return;
    }

    if (load.origin_lat == null || load.origin_lng == null || load.dest_lat == null || load.dest_lng == null) {
      throw new HttpError(422, `Load ${load.tracking_id} is missing a pickup or drop location.`);
    }

    const depot = await getReferenceDepot();
    if (!depot) throw new HttpError(422, 'No depot is set up, so the extra distance cannot be worked out.');

    let depotToPickupKm: number | null = null;
    let pickupToDropKm: number | null = null;
    try {
      const coords = [
        `${depot.longitude},${depot.latitude}`,
        `${load.origin_lng},${load.origin_lat}`,
        `${load.dest_lng},${load.dest_lat}`,
      ];
      const d = matrixDistances(await MapplsService.getDistanceMatrix(coords, [0, 1], [1, 2]));
      // Row 0 → column 0 is depot → pickup; row 1 → column 1 is pickup → drop.
      if (typeof d?.[0]?.[0] === 'number' && typeof d?.[1]?.[1] === 'number') {
        depotToPickupKm = km(d[0][0]);
        pickupToDropKm = km(d[1][1]);
      }
    } catch (e: any) {
      console.warn('Mappls distance matrix error (backhaul-match):', e.message);
    }

    if (depotToPickupKm == null || pickupToDropKm == null) {
      res.status(502).json({ detail: 'Road distances are not available right now. Try again shortly.' });
      return;
    }

    res.json({
      status: 'accepted',
      opportunity_id: load.id,
      tracking_id: load.tracking_id,
      shipper: load.shipper,
      weight_kg: load.weight_kg,
      remaining_capacity_kg: availableCapacityKg - load.weight_kg,
      depot_to_pickup_km: depotToPickupKm,
      pickup_to_drop_km: pickupToDropKm,
      added_distance_km: Math.round((depotToPickupKm + pickupToDropKm) * 10) / 10,
      waypoints: [
        { role: 'start', name: depot.name },
        { role: 'pickup', name: load.origin || load.shipper || load.tracking_id },
        { role: 'drop', name: load.destination || load.tracking_id },
      ],
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /verify-pod — staff confirms a delivery ────────────
// Needs evidence: a photo (photo_paths, uploaded with /cargo/custody/upload-url), the delivery
// OTP, or a written reason that is logged. Recorded as a custody delivery like any other.
router.post('/verify-pod', requireAuth, requireRole(...STAFF_ROLES), idempotent('verify-pod'), async (req: Request, res: Response) => {
  try {
    const trackingId = typeof req.body.tracking_id === 'string' ? req.body.tracking_id.trim() : '';
    const recipientName = typeof req.body.recipient_name === 'string' ? req.body.recipient_name.trim() : '';
    if (!trackingId || !recipientName) {
      res.status(400).json({ detail: 'Tracking ID and recipient name are required' });
      return;
    }
    const photoPaths = Array.isArray(req.body.photo_paths) ? req.body.photo_paths : [];
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (photoPaths.length === 0 && !otp && reason.length < 3) {
      res.status(400).json({ detail: 'Add evidence of the delivery: a photo, the delivery code, or a reason of at least 3 characters' });
      return;
    }

    // Staff may deliver goods nobody picked up, with a reason; the pickup is back-filled and flagged
    const allowWithoutPickup = req.body.allow_without_pickup === true;
    const pickupReason = typeof req.body.pickup_reason === 'string' ? req.body.pickup_reason.trim() : '';
    if (allowWithoutPickup && pickupReason.length < 3) {
      res.status(400).json({ detail: 'Give a reason (pickup_reason, at least 3 characters) for delivering without a recorded pickup' });
      return;
    }

    const { data: shipment, error } = await supabase
      .from('shipments')
      .select('id, status')
      .eq('tracking_id', trackingId)
      .maybeSingle();
    if (error) throw error;
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    await assertShipmentVisible(shipment.id); // another company's shipment is a 404, like one that does not exist
    if (shipment.status === 'delivered' || shipment.status === 'cancelled') {
      res.status(409).json({ detail: `Shipment is already ${shipment.status}` });
      return;
    }
    // Photos must be this shipment's own uploads (POST /cargo/custody/upload-url with its ref)
    if (photoPaths.length > 10 || photoPaths.some((p: unknown) => !isPathIn(p, [cargoFolder(shipment.id)]))) {
      res.status(400).json({ detail: 'photo_paths must be uploads for this shipment (at most 10)' });
      return;
    }

    await recordCustody(
      { shipment_id: shipment.id },
      {
        kind: 'delivery', receiver_name: recipientName, photo_paths: photoPaths, otp: otp || null,
        reason: reason || null, notes: reason ? `Proof of delivery confirmed by staff: ${reason}` : 'Proof of delivery confirmed by staff',
      },
      { id: req.user!.user_id, role: req.user!.role },
      { via: 'verify_pod', ...(allowWithoutPickup ? { backfillPickup: { reason: pickupReason } } : {}) },
    );

    res.json({
      status: 'delivered',
      tracking_id: trackingId,
      recipient_name: recipientName,
      delivered_at: new Date().toISOString(),
      confirmed_by: req.user!.user_id,
    });
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
