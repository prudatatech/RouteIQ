/**
 * margixindia — Messages between a driver and dispatch (text only).
 *
 * A thread is a route (a vendor load counts as one) or a shipment. Drivers can
 * only use threads on their own vehicle's routes; staff can use any. Messages
 * written from a shipment also carry that shipment's route, so the driver sees
 * one conversation per route.
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { HttpError, sendError } from '../core/errors';
import { STAFF_ROLES, canAccessRoute, canAccessShipment, getDriverVehicleIds, isStaff } from '../core/ownership';
import { notificationService } from '../services/notification.service';

const router = Router();
router.use(requireAuth, requireRole('driver', ...STAFF_ROLES));

const MAX_BODY = 2000;
const THREAD_LIMIT = 200;
const UNREAD_LIMIT = 500;

const MESSAGE_COLUMNS = 'id, route_id, shipment_id, sender_id, sender_role, sender_name, body, created_at, read_at';

interface Message {
  id: string;
  route_id: string | null;
  shipment_id: string | null;
  sender_id: string | null;
  sender_role: string;
  sender_name: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
}

const asId = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Routes (and vendor loads) that carry a shipment. */
async function routeIdsOfShipment(shipmentId: string): Promise<string[]> {
  const ids = new Set<string>();
  const { data: points } = await supabase.from('delivery_points').select('id').eq('shipment_id', shipmentId);
  const pointIds = (points ?? []).map(p => p.id as string);
  if (pointIds.length > 0) {
    const { data: stops } = await supabase.from('route_stops').select('route_id').in('delivery_point_id', pointIds);
    for (const s of stops ?? []) ids.add(s.route_id as string);
  }
  // A vendor load is its own route
  const { data: manifest } = await supabase.from('cargo_manifest').select('id').eq('id', shipmentId).maybeSingle();
  if (manifest) ids.add(manifest.id as string);
  return [...ids];
}

/** The route a new message on a shipment belongs to: an open one first. */
async function currentRouteOfShipment(shipmentId: string): Promise<string | null> {
  const routeIds = await routeIdsOfShipment(shipmentId);
  if (routeIds.length === 0) return null;
  const { data: routes } = await supabase.from('routes').select('id, status').in('id', routeIds);
  const open = (routes ?? []).find(r => r.status === 'active' || r.status === 'pending');
  return (open?.id as string | undefined) ?? routeIds[0];
}

/** The vehicle's driver for a route or vendor load, if one is assigned. */
async function driverOfRoute(routeId: string): Promise<string | null> {
  const { data: route } = await supabase.from('routes').select('vehicle_id').eq('id', routeId).maybeSingle();
  let vehicleId = route?.vehicle_id as string | undefined;
  if (!vehicleId) {
    const { data: manifest } = await supabase.from('cargo_manifest').select('vehicle_id').eq('id', routeId).maybeSingle();
    vehicleId = manifest?.vehicle_id as string | undefined;
  }
  if (!vehicleId) return null;
  const { data: vehicle } = await supabase.from('vehicles').select('driver_id').eq('id', vehicleId).maybeSingle();
  return (vehicle?.driver_id as string | undefined) ?? null;
}

interface Thread {
  routeId: string | null;
  shipmentId: string | null;
}

/** Reads and authorises the thread named in a query or body. */
async function requireThread(req: Request, source: Record<string, unknown>): Promise<Thread> {
  const routeId = asId(source.route_id);
  const shipmentId = asId(source.shipment_id);
  if (!routeId && !shipmentId) throw new HttpError(400, 'route_id or shipment_id is required');
  if (routeId && !(await canAccessRoute(req.user!, routeId))) throw new HttpError(403, 'Not authorized for this trip');
  if (shipmentId && !(await canAccessShipment(req.user!, shipmentId))) throw new HttpError(403, 'Not authorized for this shipment');
  return { routeId, shipmentId };
}

async function withTrackingIds(messages: Message[]) {
  const shipmentIds = [...new Set(messages.map(m => m.shipment_id).filter((v): v is string => !!v))];
  const tracking = new Map<string, string>();
  if (shipmentIds.length > 0) {
    const { data } = await supabase.from('shipments').select('id, tracking_id').in('id', shipmentIds);
    for (const s of data ?? []) tracking.set(s.id as string, s.tracking_id as string);
  }
  return messages.map(m => ({ ...m, shipment_tracking_id: m.shipment_id ? tracking.get(m.shipment_id) ?? null : null }));
}

const byTime = (a: Message, b: Message) => a.created_at.localeCompare(b.created_at);

/** The routes a driver is working on now, plus their vendor loads. */
async function driverOpenRouteIds(driverId: string): Promise<string[]> {
  const vehicleIds = await getDriverVehicleIds(driverId);
  if (vehicleIds.length === 0) return [];
  const { data: routes } = await supabase.from('routes').select('id').in('vehicle_id', vehicleIds).in('status', ['active', 'pending']);
  const { data: manifests } = await supabase.from('cargo_manifest').select('id').in('vehicle_id', vehicleIds).in('status', ['scheduled', 'in_transit']);
  return [...(routes ?? []), ...(manifests ?? [])].map(r => r.id as string);
}

// ── GET /messages/unread — unread count, and per thread for staff ──
router.get('/unread', async (req: Request, res: Response) => {
  try {
    let rows: Message[] = [];
    if (isStaff(req.user)) {
      const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('sender_role', 'driver')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(UNREAD_LIMIT);
      if (error) throw new Error(`Failed to load messages: ${error.message}`);
      rows = (data ?? []) as Message[];
    } else {
      const routeIds = await driverOpenRouteIds(req.user!.user_id);
      if (routeIds.length > 0) {
        const { data, error } = await supabase
          .from('messages')
          .select(MESSAGE_COLUMNS)
          .in('route_id', routeIds)
          .neq('sender_role', 'driver')
          .is('read_at', null)
          .order('created_at', { ascending: false })
          .limit(UNREAD_LIMIT);
        if (error) throw new Error(`Failed to load messages: ${error.message}`);
        rows = (data ?? []) as Message[];
      }
    }

    const threads = new Map<string, { route_id: string | null; shipment_id: string | null; count: number; last_body: string; last_at: string; sender_name: string | null }>();
    for (const m of [...rows].sort(byTime).reverse()) {
      const key = m.route_id ? `r:${m.route_id}` : `s:${m.shipment_id}`;
      const t = threads.get(key);
      if (t) t.count += 1;
      else threads.set(key, { route_id: m.route_id, shipment_id: m.shipment_id, count: 1, last_body: m.body, last_at: m.created_at, sender_name: m.sender_name });
    }
    res.json({ total: rows.length, threads: [...threads.values()] });
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── GET /messages?route_id= | shipment_id= — one conversation, oldest first ──
router.get('/', async (req: Request, res: Response) => {
  try {
    const { routeId, shipmentId } = await requireThread(req, req.query);
    const found = new Map<string, Message>();

    if (routeId) {
      const { data, error } = await supabase.from('messages').select(MESSAGE_COLUMNS).eq('route_id', routeId).order('created_at', { ascending: false }).limit(THREAD_LIMIT);
      if (error) throw new Error(`Failed to load messages: ${error.message}`);
      for (const m of (data ?? []) as Message[]) found.set(m.id, m);
    }
    if (shipmentId) {
      const { data, error } = await supabase.from('messages').select(MESSAGE_COLUMNS).eq('shipment_id', shipmentId).order('created_at', { ascending: false }).limit(THREAD_LIMIT);
      if (error) throw new Error(`Failed to load messages: ${error.message}`);
      for (const m of (data ?? []) as Message[]) found.set(m.id, m);
      // What the driver wrote on the route that carries this shipment belongs to the same conversation
      const routeIds = await routeIdsOfShipment(shipmentId);
      if (routeIds.length > 0) {
        const { data: onRoute, error: routeErr } = await supabase.from('messages').select(MESSAGE_COLUMNS).in('route_id', routeIds).order('created_at', { ascending: false }).limit(THREAD_LIMIT);
        if (routeErr) throw new Error(`Failed to load messages: ${routeErr.message}`);
        for (const m of (onRoute ?? []) as Message[]) found.set(m.id, m);
      }
    }

    const messages = [...found.values()].sort(byTime).slice(-THREAD_LIMIT);
    res.json({ messages: await withTrackingIds(messages) });
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── POST /messages — send a message ────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const thread = await requireThread(req, req.body ?? {});
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) throw new HttpError(400, 'Write a message first');
    if (body.length > MAX_BODY) throw new HttpError(400, `A message can be at most ${MAX_BODY} characters`);

    const staffSender = isStaff(req.user);
    let routeId = thread.routeId;
    if (!routeId && thread.shipmentId) routeId = await currentRouteOfShipment(thread.shipmentId);
    if (!routeId && !staffSender) throw new HttpError(409, 'This shipment is not on one of your trips');
    if (!routeId) throw new HttpError(409, 'This shipment is not on a trip yet, so there is no driver to message');

    const { data: sender } = await supabase.from('users').select('full_name').eq('id', req.user!.user_id).maybeSingle();
    const { data: created, error } = await supabase
      .from('messages')
      .insert({
        route_id: routeId,
        shipment_id: thread.shipmentId,
        sender_id: req.user!.user_id,
        sender_role: staffSender ? req.user!.role : 'driver',
        sender_name: (sender?.full_name as string | undefined) ?? null,
        body,
      })
      .select(MESSAGE_COLUMNS)
      .single();
    if (error || !created) throw new Error(`Failed to send message: ${error?.message}`);

    if (staffSender) {
      // Best effort: the message is saved either way
      try {
        const driverId = await driverOfRoute(routeId);
        if (driverId) {
          await notificationService.sendNotification(driverId, 'Message from dispatch', body.slice(0, 140), 'dispatch_message', { route_id: routeId });
        }
      } catch (e) {
        console.warn('[messages] could not notify the driver:', e);
      }
    }

    res.status(201).json(created);
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── POST /messages/read — mark the other side's messages in a thread read ──
router.post('/read', async (req: Request, res: Response) => {
  try {
    const { routeId, shipmentId } = await requireThread(req, req.body ?? {});
    const staffReader = isStaff(req.user);
    const now = new Date().toISOString();

    const mark = async (column: 'route_id' | 'shipment_id', ids: string[]) => {
      if (ids.length === 0) return 0;
      let query = supabase.from('messages').update({ read_at: now }).in(column, ids).is('read_at', null);
      // A driver reads what dispatch wrote; staff read what drivers wrote
      query = staffReader ? query.eq('sender_role', 'driver') : query.neq('sender_role', 'driver');
      const { data, error } = await query.select('id');
      if (error) throw new Error(`Failed to mark messages read: ${error.message}`);
      return data?.length ?? 0;
    };

    let updated = 0;
    if (routeId) updated += await mark('route_id', [routeId]);
    if (shipmentId) {
      updated += await mark('shipment_id', [shipmentId]);
      updated += await mark('route_id', await routeIdsOfShipment(shipmentId));
    }
    res.json({ updated });
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
