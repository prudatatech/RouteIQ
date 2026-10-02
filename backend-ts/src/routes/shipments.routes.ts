/**
 * margixindia — Shipment Routes
 * Ports: backend/app/api/v1/endpoints/shipments.py
 */
import { withDriverLicenceStatus } from '../services/people-docs.service';
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES, canAccessShipment, isStaff } from '../core/ownership';
import { ShipmentCreateSchema, ShipmentEditSchema } from '../schemas';
import { CUSTODY_ONLY_SHIPMENT_STATUSES, DRIVER_SHIPMENT_STATUSES, OPERATING_VEHICLE_STATUSES, SHIPMENT_PATCH_STATUSES } from '../core/transitions';
import { parseCoordinate, parseOptionalText } from '../core/validate';
import { rateLimitByIp } from '../core/rate-limit';
import { ShipmentService } from '../services/shipment.service';
import { getDirections } from '../services/directions.service';
import { SecurityService } from '../services/security.service';
import { sendError } from '../core/errors';
import { rateDelivery } from '../services/driver-performance.service';
import { getProofOfDelivery } from '../services/pod.service';
import { isPlaceholderPlate } from '../core/vehicles';
import { assertShipmentVisible, shipmentOverview } from '../services/shipment-overview.service';
import { OWNED, scopeQuery } from '../core/org-scope';
import { assertVehicleVisible, guardShipment } from '../core/org-guards';

const router = Router();

// ── POST / ─────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('superadmin', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const parsed = ShipmentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }
    const shipment = await ShipmentService.createShipment(parsed.data, { id: req.user!.user_id, role: req.user!.role });
    res.status(201).json(shipment);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET / ──────────────────────────────────────────────────
router.get('/', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const skip = parseInt(req.query.skip as string) || 0;
    const limit = parseInt(req.query.limit as string) || 100;
    const shipments = await ShipmentService.listShipments(skip, limit);
    res.json(shipments);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /track/:tracking_id (PUBLIC — the tracking id is the secret, like a courier's) ──
// Anyone with the id can track it (the public /track page and mobile links rely on
// this), so the response carries no vendor, driver or contact details.
router.get('/track/:tracking_id', rateLimitByIp('shipment-track', 60, 60), async (req: Request, res: Response) => {
  try {
    const info = await ShipmentService.getPublicTracking(req.params.tracking_id);
    if (!info) {
      res.status(404).json({ detail: 'Shipment with this tracking ID not found' });
      return;
    }

    res.json(info);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /track/:tracking_id/route (PUBLIC — the road line from the vehicle to its next stop) ──
// The public tracking page has no sign-in, so it cannot call POST /routing/directions. Instead of an
// open directions proxy (anyone could route any two points on our provider quota), this takes NO
// coordinates: the server finds the vehicle and the next stop of that one shipment itself, so it can only
// ever draw the line the tracking page already shows. Rate limited per IP; identical lines are cached.
router.get('/track/:tracking_id/route', rateLimitByIp('track-route', 30, 60), async (req: Request, res: Response) => {
  try {
    const info = await ShipmentService.getPublicTracking(req.params.tracking_id);
    if (!info) {
      res.status(404).json({ detail: 'Shipment with this tracking ID not found' });
      return;
    }
    const drop = info.destination;
    // A load (CM-) heads for its pickup until it is in transit; a shipment always heads for its drop
    const toPickup = String(info.tracking_id).startsWith('CM-') && info.status !== 'in_transit';
    const stop = toPickup && info.origin_lat != null && info.origin_lng != null
      ? { lat: Number(info.origin_lat), lng: Number(info.origin_lng) }
      : drop?.lat != null && drop?.lng != null ? { lat: Number(drop.lat), lng: Number(drop.lng) } : null;
    const vehicle = info.vehicle?.lat != null && info.vehicle?.lng != null
      ? { lat: Number(info.vehicle.lat), lng: Number(info.vehicle.lng) }
      : null;
    const finished = info.status === 'delivered' || info.status === 'cancelled';
    if (!vehicle || !stop || finished) {
      res.status(404).json({ detail: 'There is no route to show for this shipment right now.' });
      return;
    }
    const { cached: _cached, ...directions } = await getDirections([vehicle, stop], true);
    res.json(directions);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /:ref/overview ─────────────────────────────────────
// The shipment page: the shipment with its trip, vehicle, driver, requester, problems, transfers,
// claims and invoice. `ref` is an id, a tracking id (RTX-…) or a load code (CM-…).
router.get('/:ref/overview', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await shipmentOverview(req.params.ref, true));
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /:shipment_id ──────────────────────────────────────
router.get('/:shipment_id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!(await canAccessShipment(req.user!, req.params.shipment_id))) {
      res.status(403).json({ detail: 'Not authorized for this shipment' });
      return;
    }
    // Staff see their organisation's shipments only; drivers and vendors passed their own access check above
    if (isStaff(req.user)) await assertShipmentVisible(req.params.shipment_id);
    const shipment = await ShipmentService.getShipment(req.params.shipment_id);
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PUT /:shipment_id/metadata ─────────────────────────────
router.put('/:shipment_id/metadata', requireAuth, requireRole('superadmin', 'admin'), guardShipment(), async (req: Request, res: Response) => {
  try {
    const metadata = req.body;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      res.status(400).json({ detail: 'Metadata body is required' });
      return;
    }
    if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > 50 * 1024) {
      res.status(400).json({ detail: 'The load details are too large' });
      return;
    }

    const shipment = await ShipmentService.updateShipmentMetadata(
      req.params.shipment_id, metadata
    );
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PATCH /:shipment_id (status update with POD) ───────────
router.patch('/:shipment_id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!(await canAccessShipment(req.user!, req.params.shipment_id))) {
      res.status(403).json({ detail: 'Not authorized for this shipment' });
      return;
    }
    // The web client sends these as query params; accept either location
    const input = { ...req.query, ...(req.body || {}) } as Record<string, unknown>;
    const status = input.status as string;
    const lat = parseCoordinate(input.lat, 'lat', 90) ?? undefined;
    const lng = parseCoordinate(input.lng, 'lng', 180) ?? undefined;
    const receivedBy = parseOptionalText(input.received_by, 'received_by', 200);
    const signatureData = typeof input.signature_data === 'string' && input.signature_data.length <= 400_000 ? input.signature_data : undefined;
    if (input.signature_data !== undefined && signatureData === undefined) {
      res.status(400).json({ detail: 'The signature is too large' });
      return;
    }

    // Vendors follow their shipments but never move them; drivers pick up, staff also cancel
    if (!isStaff(req.user) && req.user!.role !== 'driver') {
      res.status(403).json({ detail: 'Only drivers and dispatch can change a shipment\'s status' });
      return;
    }
    if (req.user!.role === 'driver' && status && !(DRIVER_SHIPMENT_STATUSES as readonly string[]).includes(status)) {
      res.status(403).json({ detail: 'Drivers mark a pickup here; deliveries and the rest go through the cargo custody events', use: 'cargo_custody' });
      return;
    }
    // Movement after pickup is a custody event (with pieces, evidence and holder), never a raw status write
    if ((CUSTODY_ONLY_SHIPMENT_STATUSES as readonly string[]).includes(status)) {
      res.status(409).json({
        detail: 'This status is recorded through a cargo custody event (POST /api/v1/cargo/custody) or a cargo case action, with the pieces and proof it needs.',
        use: 'cargo_custody',
      });
      return;
    }
    if (!status || !(SHIPMENT_PATCH_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({ detail: 'Invalid status value' });
      return;
    }

    // A pickup is the custody pickup: the goods go on the vehicle, counted from the booking
    if (status === 'picked_up') {
      const { resolveRef, assertCanAct } = await import('../services/cargo/consignment');
      const { recordCustody } = await import('../services/cargo/custody.service');
      const c = await resolveRef({ shipment_id: req.params.shipment_id });
      await assertCanAct(req.user!, c);
      await recordCustody(c, { kind: 'pickup', lat: lat ?? null, lng: lng ?? null, notes: 'Marked picked up' }, { id: req.user!.user_id, role: req.user!.role }, { via: 'system' });
      res.json(await ShipmentService.getShipment(req.params.shipment_id));
      return;
    }

    const shipment = await ShipmentService.updateShipmentStatus(
      req.params.shipment_id, status, lat, lng, receivedBy, signatureData,
      { id: req.user!.user_id, role: req.user!.role }
    );
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /:shipment_id/history (staff) ──────────────────────
// Ordered status timeline from the tamper-evident `shipment_logs` chain, with
// who made each change (when known) and a short note. See
// ShipmentTracker's public tracking response for the customer-safe cut.
// POST /:shipment_id/rating — staff rate the driver after delivery (1 to 5, optional note)
router.post('/:shipment_id/rating', requireAuth, requireRole('superadmin', 'admin', 'manager'), guardShipment(), async (req: Request, res: Response) => {
  try {
    const { rating, note } = req.body ?? {};
    res.json(await rateDelivery(req.params.shipment_id, Number(rating), typeof note === 'string' ? note : null, req.user!.user_id));
  } catch (e: any) {
    sendError(req, res, e);
  }
});

router.get('/:shipment_id/history', requireAuth, requireRole(...STAFF_ROLES), guardShipment(), async (req: Request, res: Response) => {
  try {
    const events = await ShipmentService.getShipmentHistory(req.params.shipment_id);
    if (!events) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json({ events });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /:shipment_id/proof — receiver, delivery photo and signature (staff) ──
// The photo and signature come back as signed links that stop working after 10 minutes.
router.get('/:shipment_id/proof', requireAuth, requireRole(...STAFF_ROLES), guardShipment(), async (req: Request, res: Response) => {
  try {
    const proof = await getProofOfDelivery(req.params.shipment_id);
    if (!proof) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json(proof);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /:shipment_id/verify ───────────────────────────────
router.get('/:shipment_id/verify', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!(await canAccessShipment(req.user!, req.params.shipment_id))) {
      res.status(403).json({ detail: 'Not authorized for this shipment' });
      return;
    }
    const shipment = await ShipmentService.getShipment(req.params.shipment_id);
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    const isValid = SecurityService.verifyChain(shipment.logs || []);
    res.json({
      shipment_id: req.params.shipment_id,
      is_valid: isValid,
      log_count: (shipment.logs || []).length,
      last_status: shipment.status,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── DELETE /:shipment_id ───────────────────────────────────
router.delete('/:shipment_id', requireAuth, requireRole('superadmin', 'admin', 'manager'), guardShipment(), async (req: Request, res: Response) => {
  try {
    const success = await ShipmentService.deleteShipment(req.params.shipment_id);
    if (!success) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json({ message: 'Shipment deleted successfully' });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PATCH /:shipment_id/edit ───────────────────────────────
router.patch('/:shipment_id/edit', requireAuth, requireRole('superadmin', 'admin', 'manager'), guardShipment(), async (req: Request, res: Response) => {
  try {
    const parsed = ShipmentEditSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }
    const shipment = await ShipmentService.updateShipment(req.params.shipment_id, parsed.data);
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /:shipment_id/assign-options ───────────────────────
router.get('/:shipment_id/assign-options', requireAuth, requireRole('superadmin', 'admin', 'manager'), guardShipment(), async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode as string;
    const shipment = await ShipmentService.getShipment(req.params.shipment_id);
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found' });
      return;
    }

    // Vehicles that take part in dispatch (not in maintenance or archived), never a TEMP-/DRFT- placeholder
    const { data: vehicles, error } = await scopeQuery(supabase.from('vehicles').select('*'), OWNED.carrier).in('status', [...OPERATING_VEHICLE_STATUSES]);
    if (error) throw error;

    let options = (vehicles || []).filter((v: any) => !isPlaceholderPlate(v.plate_number));

    if (mode === 'near' && shipment.origin_lat && shipment.origin_lng) {
      // Calculate haversine distance
      const toRad = (value: number) => (value * Math.PI) / 180;
      const calcDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371; // km
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      options = options.map(v => {
        if (v.latitude && v.longitude) {
          const dist = calcDist(shipment.origin_lat!, shipment.origin_lng!, v.latitude, v.longitude);
          return { ...v, distance_km: dist };
        }
        return { ...v, distance_km: 999999 };
      });
      options.sort((a, b) => (a.distance_km || 0) - (b.distance_km || 0));
    }

    res.json(await withDriverLicenceStatus(options));
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /:shipment_id/assign ──────────────────────────────
router.post('/:shipment_id/assign', requireAuth, requireRole('superadmin', 'admin', 'manager'), guardShipment(), async (req: Request, res: Response) => {
  try {
    const { vehicle_id, dispatch } = req.body;
    if (!vehicle_id) {
      res.status(400).json({ detail: 'vehicle_id is required' });
      return;
    }
    // The vehicle must be the company's too
    await assertVehicleVisible(vehicle_id);
    const shipment = await ShipmentService.assignDriver(req.params.shipment_id, vehicle_id, { id: req.user!.user_id, role: req.user!.role }, { dispatch: dispatch === true });
    if (!shipment) {
      res.status(404).json({ detail: 'Shipment not found or could not be assigned' });
      return;
    }
    res.json(shipment);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
