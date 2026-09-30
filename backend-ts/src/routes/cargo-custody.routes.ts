/**
 * margixindia — Cargo custody, exceptions, transfers, hubs and claims (docs/cargo-plan.md)
 *
 * Mounted under /api/v1/cargo next to cargo.routes.ts. Bodies are validated with zod, every
 * POST is idempotent (an `idempotency_key` or `Idempotency-Key` header replays the first
 * answer), and writes are compare-and-set on status inside the services.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../core/auth';
import { HttpError, sendError } from '../core/errors';
import { idempotent } from '../core/idempotency';
import { rateLimitByUser } from '../core/rate-limit';
import { STAFF_ROLES, getDriverVehicleIds, isStaff, requireVehicleAccess } from '../core/ownership';
import { supabase } from '../core/supabase';
import {
  CONDITIONS, RefSchema, assertCanAct, assertCanView, driverVehicleId, resolveRef, type Actor,
} from '../services/cargo/consignment';
import {
  CUSTODY_KINDS, createCustodyUploadUrl, recordCustody, timelineOf, whereIs, type CustodyInput,
} from '../services/cargo/custody.service';
import { sendDeliveryOtp } from '../services/cargo/otp.service';
import {
  createManualException, exceptionAction, getException, listExceptions, reliefVehicles,
} from '../services/cargo/exception.service';
import {
  assertCanSeeTransfer, cancelTransfer, getTransfer, handoverIn, handoverOut, listTransfers, planTransfer, setEwayPartB,
} from '../services/cargo/transfer.service';
import { hubInventory, listHubs } from '../services/cargo/hub.service';
import { claimDocumentUploadUrl, createClaim, getClaim, listClaims, updateClaim } from '../services/cargo/claim.service';
import { vehicleOnBoard } from '../services/cargo/onboard.service';
import { LotEwaySchema, MergeSchema, SplitSchema, lotsOverview, mergeLots, setLotEway, splitConsignment } from '../services/cargo/lots.service';
import { notifyStaffSafe } from '../services/cargo/notify';

const router = Router();

const actorOf = (req: Request): Actor => ({ id: req.user!.user_id, role: req.user!.role });
const UUID = z.string().uuid();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, `${path}${issue.message}`);
  }
  return parsed.data;
}

const count = z.number().int().min(0).max(100_000);

const CustodySchema = z.object({
  ref: RefSchema,
  kind: z.enum(CUSTODY_KINDS),
  pieces: count.nullable().optional(),
  weight_kg: z.number().min(0).max(100_000).nullable().optional(),
  condition: z.enum(CONDITIONS).nullable().optional(),
  seal_number: z.string().trim().max(60).nullable().optional(),
  photo_paths: z.array(z.string().max(300)).max(10).optional(),
  signature_path: z.string().max(300).nullable().optional(),
  receiver_name: z.string().trim().max(200).nullable().optional(),
  otp: z.string().trim().max(12).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  pieces_refused: count.nullable().optional(),
  pieces_short: count.nullable().optional(),
  pieces_damaged: count.nullable().optional(),
  reason: z.string().trim().max(300).nullable().optional(),
  depot_id: UUID.nullable().optional(),
  vehicle_id: UUID.nullable().optional(),
  next_status: z.enum(['in_transit', 'out_for_delivery']).nullable().optional(),
});

// ── Where is it / timeline ──────────────────────────────────
router.get('/where/:ref', requireAuth, async (req: Request, res: Response) => {
  try {
    const c = await resolveRef(req.params.ref);
    const { redacted } = await assertCanView(req.user!, c);
    res.json(await whereIs(c, { redacted, user: req.user! }));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/timeline/:ref', requireAuth, async (req: Request, res: Response) => {
  try {
    const c = await resolveRef(req.params.ref);
    const { redacted } = await assertCanView(req.user!, c);
    res.json(await timelineOf(c, { redacted, user: req.user! }));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Custody events (drivers for their own vehicle, staff) ───
router.post('/custody', requireAuth, requireRole('driver', ...STAFF_ROLES), idempotent('cargo-custody'), async (req: Request, res: Response) => {
  try {
    const body = parse(CustodySchema, req.body);
    const c = await resolveRef(body.ref);
    await assertCanAct(req.user!, c);
    const { ref: _ref, ...input } = body;
    res.status(201).json(await recordCustody(c, input as CustodyInput, actorOf(req), { via: 'api' }));
  } catch (e) {
    sendError(req, res, e);
  }
});

const UploadSchema = z.object({
  ref: RefSchema.optional(),
  transfer_id: UUID.optional(),
  kind: z.enum(['photo', 'signature']),
  content_type: z.string().max(60),
  size: z.number().int().positive(),
}).refine(v => !!v.ref !== !!v.transfer_id, { message: 'Name either the shipment (ref) or the transfer (transfer_id)' });

// A signed upload URL for custody photos and signatures (in the consignment's or transfer's folder)
router.post('/custody/upload-url', requireAuth, requireRole('driver', ...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const body = parse(UploadSchema, req.body);
    let owner: string;
    if (body.ref) {
      const c = await resolveRef(body.ref);
      await assertCanAct(req.user!, c);
      owner = c.id;
    } else {
      await assertCanSeeTransfer(req.user!, body.transfer_id!);
      owner = body.transfer_id!;
    }
    res.json(await createCustodyUploadUrl(owner, body));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Delivery OTP (staff) ────────────────────────────────────
router.post('/otp/send', requireAuth, requireRole(...STAFF_ROLES), rateLimitByUser('cargo-otp-send', 30, 60 * 60), idempotent('cargo-otp-send'), async (req: Request, res: Response) => {
  try {
    const { ref } = parse(z.object({ ref: RefSchema }), req.body);
    res.json(await sendDeliveryOtp(await resolveRef(ref), actorOf(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Exceptions ──────────────────────────────────────────────
router.get('/exceptions', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const q = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : undefined);
    res.json(await listExceptions({
      status: q('status'), type: q('type'), severity: q('severity'), vehicle_id: q('vehicle_id'), ref: q('ref'),
      overdue: q('overdue') === 'true' || q('overdue') === '1',
    }));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/exceptions/:id', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await getException(parse(UUID, req.params.id)));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/exceptions', requireAuth, requireRole('driver', ...STAFF_ROLES), idempotent('cargo-exception'), async (req: Request, res: Response) => {
  try {
    const driverVehicleIds = isStaff(req.user) ? undefined : await getDriverVehicleIds(req.user!.user_id);
    res.status(201).json(await createManualException(req.body ?? {}, actorOf(req), { driverVehicleIds }));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/exceptions/:id/actions', requireAuth, requireRole(...STAFF_ROLES), idempotent('cargo-exception-action'), async (req: Request, res: Response) => {
  try {
    res.json(await exceptionAction(parse(UUID, req.params.id), req.body ?? {}, actorOf(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/exceptions/:id/relief-vehicles', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await reliefVehicles(parse(UUID, req.params.id)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Transfers ───────────────────────────────────────────────
router.post('/transfers', requireAuth, requireRole(...STAFF_ROLES), idempotent('cargo-transfer'), async (req: Request, res: Response) => {
  try {
    res.status(201).json(await planTransfer(req.body ?? {}, actorOf(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/transfers', requireAuth, requireRole('driver', ...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await listTransfers({ status: typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined }, req.user!));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/transfers/:id', requireAuth, requireRole('driver', ...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const id = parse(UUID, req.params.id);
    await assertCanSeeTransfer(req.user!, id);
    res.json(await getTransfer(id));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/transfers/:id/handover-out', requireAuth, requireRole('driver', ...STAFF_ROLES), idempotent('cargo-handover-out'), async (req: Request, res: Response) => {
  try {
    res.json(await handoverOut(parse(UUID, req.params.id), req.body ?? {}, req.user!));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/transfers/:id/handover-in', requireAuth, requireRole('driver', ...STAFF_ROLES), idempotent('cargo-handover-in'), async (req: Request, res: Response) => {
  try {
    res.json(await handoverIn(parse(UUID, req.params.id), req.body ?? {}, req.user!));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/transfers/:id/cancel', requireAuth, requireRole(...STAFF_ROLES), idempotent('cargo-transfer-cancel'), async (req: Request, res: Response) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) || null : null;
    res.json(await cancelTransfer(parse(UUID, req.params.id), reason));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/transfers/:id/eway', requireAuth, requireRole(...STAFF_ROLES), idempotent('cargo-transfer-eway'), async (req: Request, res: Response) => {
  try {
    res.json(await setEwayPartB(parse(UUID, req.params.id), req.body?.eway_part_b_ref));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Lots (docs/cargo-plan.md, Lots) ─────────────────────────
// Split one consignment into lots: by hand, at a hub (cross-dock), or the rest after a partial delivery
router.post('/lots/split', requireAuth, requireRole(...STAFF_ROLES), idempotent('cargo-lots-split'), async (req: Request, res: Response) => {
  try {
    const body = parse(SplitSchema, req.body);
    const c = await resolveRef(body.ref);
    res.status(201).json(await splitConsignment(c, { reason: body.reason, lots: body.lots, note: body.note ?? null }, actorOf(req), { via: 'api' }));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/lots/merge', requireAuth, requireRole(...STAFF_ROLES), idempotent('cargo-lots-merge'), async (req: Request, res: Response) => {
  try {
    const body = parse(MergeSchema, req.body);
    res.json(await mergeLots(body.refs, actorOf(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// A lot's own e-way bill reference
router.post('/lots/eway', requireAuth, requireRole(...STAFF_ROLES), idempotent('cargo-lots-eway'), async (req: Request, res: Response) => {
  try {
    const body = parse(LotEwaySchema, req.body);
    res.json(await setLotEway(await resolveRef(body.ref), body.eway_bill_ref));
  } catch (e) {
    sendError(req, res, e);
  }
});

// The master and its lots, from the master or any lot
router.get('/lots/:ref', requireAuth, async (req: Request, res: Response) => {
  try {
    const c = await resolveRef(req.params.ref);
    const { redacted } = await assertCanView(req.user!, c);
    res.json(await lotsOverview(c, { redacted, user: req.user! }));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Hubs ────────────────────────────────────────────────────
router.get('/hubs', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await listHubs());
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/hubs/:depot_id/inventory', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await hubInventory(parse(UUID, req.params.depot_id)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Claims ──────────────────────────────────────────────────
router.post('/claims', requireAuth, requireRole('customer', 'vendor', ...STAFF_ROLES), idempotent('cargo-claim'), async (req: Request, res: Response) => {
  try {
    res.status(201).json(await createClaim(req.body ?? {}, actorOf(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/claims', requireAuth, requireRole('customer', 'vendor', ...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const q = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? String(req.query[k]) : undefined);
    res.json(await listClaims({ status: q('status'), ref: q('ref'), limit: q('limit'), cursor: q('cursor') }, req.user!));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/claims/:id', requireAuth, requireRole('customer', 'vendor', ...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await getClaim(parse(UUID, req.params.id), req.user!));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/claims/:id/documents-upload-url', requireAuth, requireRole('customer', 'vendor', ...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await claimDocumentUploadUrl(parse(UUID, req.params.id), req.body ?? {}, req.user!));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.patch('/claims/:id', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await updateClaim(parse(UUID, req.params.id), req.body ?? {}));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Vehicle cargo ───────────────────────────────────────────
router.get('/vehicles/:vehicle_id/on-board', requireAuth, requireVehicleAccess(req => req.params.vehicle_id), async (req: Request, res: Response) => {
  try {
    res.json(await vehicleOnBoard(req.params.vehicle_id));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Driver ──────────────────────────────────────────────────
router.get('/driver/on-board', requireAuth, requireRole('driver'), async (req: Request, res: Response) => {
  try {
    const board = await vehicleOnBoard(await driverVehicleId(req.user!.user_id));
    res.json({ ...board, items: board.items.map(i => ({ ...i, expected_condition: i.condition })) });
  } catch (e) {
    sendError(req, res, e);
  }
});

const RejectedSchema = z.object({
  action: z.string().trim().min(1).max(80),
  error: z.string().trim().min(1).max(500),
  payload_summary: z.string().trim().max(500).nullable().optional(),
});

// The offline queue reports an action the server refused, so dispatch can follow it up
router.post('/driver/rejected-action', requireAuth, requireRole('driver'), rateLimitByUser('driver-rejected-action', 30, 60 * 60), idempotent('driver-rejected-action'), async (req: Request, res: Response) => {
  try {
    const body = parse(RejectedSchema, req.body);
    const { data: vehicle } = await supabase.from('vehicles').select('id, plate_number, driver_name').eq('driver_id', req.user!.user_id).limit(1).maybeSingle();
    await notifyStaffSafe(
      'Driver action refused',
      `${vehicle?.driver_name ?? 'A driver'}${vehicle?.plate_number ? ` on ${vehicle.plate_number}` : ''} could not ${body.action.replace(/[_-]/g, ' ')}: ${body.error}${body.payload_summary ? ` (${body.payload_summary})` : ''}`.slice(0, 700),
      'driver_action_rejected',
      { driver_id: req.user!.user_id, vehicle_id: vehicle?.id ?? null, action: body.action },
    );
    res.status(201).json({ reported: true });
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
