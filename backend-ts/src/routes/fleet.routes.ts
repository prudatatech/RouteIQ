/**
 * margixindia — Fleet health routes (staff)
 *
 * Service schedules and log, odometer correction, health scores, and the alarms list.
 * Alarms come from the telematics webhook and the rules in services/alerts.service.ts.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { cacheDeletePattern } from '../core/redis';
import { STAFF_ROLES } from '../core/ownership';
import { HttpError, sendError } from '../core/errors';
import { indianDateKey } from '../core/istDate';
import {
  acknowledgeAlert, alertSummary, listAlerts, resolveAlert, ALERT_META,
} from '../services/alerts.service';
import {
  getAlertThresholds, saveAlertThresholds, thresholdLimits, THRESHOLD_FIELDS,
} from '../services/alert-settings.service';
import { loadFleetHealth } from '../services/vehicle-health.service';
import { loadPlans, serviceStatus } from '../services/service-plans.service';

const router = Router();
const staff = [requireAuth, requireRole(...STAFF_ROLES)] as const;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD');
const optionalNumber = (label: string, opts: { int?: boolean; positive?: boolean } = {}) => {
  let n = z.number({ invalid_type_error: `${label} must be a number` });
  if (opts.int) n = n.int(`${label} must be a whole number`);
  n = opts.positive ? n.positive(`${label} must be more than 0`) : n.min(0, `${label} cannot be negative`);
  return n.nullable().optional();
};

async function requireVehicle(id: string): Promise<{ id: string; plate_number: string; odometer_km: number | null; status: string }> {
  const { data, error } = await supabase.from('vehicles').select('id, plate_number, odometer_km, status').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Vehicle not found');
  return data as { id: string; plate_number: string; odometer_km: number | null; status: string };
}

// ── Health ─────────────────────────────────────────────────

// GET /fleet/health — every vehicle's health score and what needs attention
router.get('/health', ...staff, async (req: Request, res: Response) => {
  try {
    const health = await loadFleetHealth();
    // Worst first; vehicles with no score go last
    health.sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
    res.json(health);
  } catch (e) {
    sendError(req, res, e);
  }
});

// GET /fleet/vehicles/:id/health — one vehicle with the full breakdown
router.get('/vehicles/:id/health', ...staff, async (req: Request, res: Response) => {
  try {
    const [health] = await loadFleetHealth(req.params.id);
    if (!health) throw new HttpError(404, 'Vehicle not found');
    res.json(health);
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Odometer ───────────────────────────────────────────────

// PUT /fleet/vehicles/:id/odometer — staff correct the reading; GPS keeps adding to it
router.put('/vehicles/:id/odometer', ...staff, async (req: Request, res: Response) => {
  try {
    const parsed = z.object({ odometer_km: z.number({ invalid_type_error: 'Enter the odometer reading in km' }).min(0).max(9_999_999) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    await requireVehicle(req.params.id);
    const { data, error } = await supabase
      .from('vehicles')
      .update({ odometer_km: parsed.data.odometer_km, odometer_updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('id, odometer_km, odometer_updated_at')
      .single();
    if (error) throw error;
    await cacheDeletePattern('vehicles:list:*');
    res.json(data);
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Service plans ──────────────────────────────────────────

const PlanSchema = z.object({
  item: z.string().trim().min(1, 'Enter the item to service').max(60),
  interval_km: optionalNumber('Interval in km', { int: true, positive: true }),
  interval_days: optionalNumber('Interval in days', { int: true, positive: true }),
  last_done_km: optionalNumber('Odometer at last service'),
  last_done_at: dateOnly.nullable().optional(),
}).refine(p => p.interval_km != null || p.interval_days != null, { message: 'Set how often it is due: every some km, every some days, or both' });

// GET /fleet/vehicles/:id/service-plans — items with their current status
router.get('/vehicles/:id/service-plans', ...staff, async (req: Request, res: Response) => {
  try {
    const vehicle = await requireVehicle(req.params.id);
    const plans = await loadPlans([vehicle.id]);
    const odo = vehicle.odometer_km != null ? Number(vehicle.odometer_km) : null;
    res.json(plans.map(p => serviceStatus(p, odo)).sort((a, b) => a.item.localeCompare(b.item)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// POST /fleet/vehicles/:id/service-plans — add or change an item (one plan per item)
router.post('/vehicles/:id/service-plans', ...staff, async (req: Request, res: Response) => {
  try {
    const parsed = PlanSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const vehicle = await requireVehicle(req.params.id);
    const p = parsed.data;
    const { data, error } = await supabase
      .from('vehicle_service_plans')
      .upsert({
        vehicle_id: vehicle.id,
        item: p.item,
        interval_km: p.interval_km ?? null,
        interval_days: p.interval_days ?? null,
        last_done_km: p.last_done_km ?? null,
        last_done_at: p.last_done_at ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'vehicle_id,item' })
      .select('id, vehicle_id, item, interval_km, interval_days, last_done_km, last_done_at')
      .single();
    if (error) throw error;
    res.status(201).json(serviceStatus(data, vehicle.odometer_km != null ? Number(vehicle.odometer_km) : null));
  } catch (e) {
    sendError(req, res, e);
  }
});

// DELETE /fleet/service-plans/:planId
router.delete('/service-plans/:planId', ...staff, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('vehicle_service_plans').delete().eq('id', req.params.planId).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new HttpError(404, 'Service item not found');
    res.json({ status: 'deleted' });
  } catch (e) {
    sendError(req, res, e);
  }
});

// GET /fleet/service-due — overdue and due-soon items across the fleet, most urgent first
router.get('/service-due', ...staff, async (req: Request, res: Response) => {
  try {
    const health = await loadFleetHealth();
    const rows = health.flatMap(h => h.service
      .filter(s => s.status === 'overdue' || s.status === 'due_soon')
      .map(s => ({ ...s, plate_number: h.plate_number, odometer_km: h.odometer_km })));
    rows.sort((a, b) => (a.status === b.status ? 0 : a.status === 'overdue' ? -1 : 1));
    res.json(rows);
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Service log ────────────────────────────────────────────

const LogSchema = z.object({
  item: z.string().trim().min(1, 'Enter what was serviced').max(60),
  done_at: dateOnly.optional(),
  odometer_km: optionalNumber('Odometer'),
  cost: optionalNumber('Cost'),
  note: z.string().trim().max(500).nullable().optional(),
});

// GET /fleet/vehicles/:id/service-log
router.get('/vehicles/:id/service-log', ...staff, async (req: Request, res: Response) => {
  try {
    await requireVehicle(req.params.id);
    const { data, error } = await supabase
      .from('vehicle_service_log')
      .select('id, vehicle_id, item, done_at, odometer_km, cost, note, expense_id, created_at')
      .eq('vehicle_id', req.params.id)
      .order('done_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json(data ?? []);
  } catch (e) {
    sendError(req, res, e);
  }
});

// POST /fleet/vehicles/:id/service-log — record a service.
// Moves the item's baseline forward, raises the odometer if the reading is higher, and
// records a maintenance expense when a cost is given (if the expenses table exists).
router.post('/vehicles/:id/service-log', ...staff, async (req: Request, res: Response) => {
  try {
    const parsed = LogSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const vehicle = await requireVehicle(req.params.id);
    const b = parsed.data;
    const today = indianDateKey(new Date());
    const doneAt = b.done_at ?? today;
    if (doneAt > today) throw new HttpError(400, 'The service date cannot be in the future');

    const currentOdo = vehicle.odometer_km != null ? Number(vehicle.odometer_km) : null;
    const readingKm = b.odometer_km ?? currentOdo;

    let expenseId: string | null = null;
    if (b.cost != null && b.cost > 0) {
      const { data: expense, error: expErr } = await supabase
        .from('expenses')
        .insert({
          vehicle_id: vehicle.id,
          category: 'maintenance',
          amount: b.cost,
          expense_date: doneAt,
          note: b.note ? `${b.item}: ${b.note}` : b.item,
          created_by: req.user!.user_id,
        })
        .select('id')
        .single();
      if (expErr) console.warn('Service cost was stored on the log only (no expense row):', expErr.message);
      else expenseId = expense?.id ?? null;
    }

    const { data: entry, error } = await supabase
      .from('vehicle_service_log')
      .insert({
        vehicle_id: vehicle.id,
        item: b.item,
        done_at: doneAt,
        odometer_km: readingKm,
        cost: b.cost ?? null,
        note: b.note || null,
        expense_id: expenseId,
        created_by: req.user!.user_id,
      })
      .select('id, vehicle_id, item, done_at, odometer_km, cost, note, expense_id, created_at')
      .single();
    if (error) throw error;

    // A reading higher than what we hold is the better odometer
    if (b.odometer_km != null && (currentOdo == null || b.odometer_km > currentOdo)) {
      await supabase.from('vehicles')
        .update({ odometer_km: b.odometer_km, odometer_updated_at: new Date().toISOString() })
        .eq('id', vehicle.id);
      await cacheDeletePattern('vehicles:list:*');
    }

    // Move the plan's baseline forward, unless this entry is older than the last one recorded
    const { data: plan } = await supabase
      .from('vehicle_service_plans')
      .select('id, last_done_at')
      .eq('vehicle_id', vehicle.id)
      .eq('item', b.item)
      .maybeSingle();
    let planUpdated = false;
    if (plan && (!plan.last_done_at || plan.last_done_at.slice(0, 10) <= doneAt)) {
      const { error: pErr } = await supabase
        .from('vehicle_service_plans')
        .update({ last_done_at: doneAt, last_done_km: readingKm, updated_at: new Date().toISOString() })
        .eq('id', plan.id);
      if (pErr) throw pErr;
      planUpdated = true;
    }

    // vehicle_status lets the caller offer "Return to service" when the vehicle was in maintenance
    res.status(201).json({ ...entry, expense_recorded: expenseId != null, plan_updated: planUpdated, vehicle_status: vehicle.status });
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Alarms ─────────────────────────────────────────────────

// GET /fleet/alerts?status=active|resolved|all&type=&vehicle_id=
router.get('/alerts', ...staff, async (req: Request, res: Response) => {
  try {
    const status = ['active', 'resolved', 'all'].includes(req.query.status as string) ? (req.query.status as 'active' | 'resolved' | 'all') : 'active';
    const type = typeof req.query.type === 'string' && req.query.type in ALERT_META ? req.query.type : undefined;
    const vehicleId = typeof req.query.vehicle_id === 'string' ? req.query.vehicle_id : undefined;
    res.json(await listAlerts({ status, type, vehicleId }));
  } catch (e) {
    sendError(req, res, e);
  }
});

// GET /fleet/alerts/summary — counts, test alarms left out
router.get('/alerts/summary', ...staff, async (req: Request, res: Response) => {
  try {
    res.json(await alertSummary());
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/alerts/:id/acknowledge', ...staff, async (req: Request, res: Response) => {
  try {
    const result = await acknowledgeAlert(req.params.id, req.user!.user_id);
    if (result === 'not_found') throw new HttpError(404, 'Alert not found');
    if (result === 'resolved') throw new HttpError(409, 'This alert is already resolved');
    res.json(result);
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/alerts/:id/resolve', ...staff, async (req: Request, res: Response) => {
  try {
    const result = await resolveAlert(req.params.id, req.user!.user_id);
    if (result === 'not_found') throw new HttpError(404, 'Alert not found');
    res.json(result);
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Alarm rule settings ────────────────────────────────────

router.get('/alert-settings', ...staff, async (req: Request, res: Response) => {
  try {
    res.json({
      values: await getAlertThresholds(),
      limits: Object.fromEntries(THRESHOLD_FIELDS.map(f => [f, thresholdLimits(f)])),
    });
  } catch (e) {
    sendError(req, res, e);
  }
});

router.put('/alert-settings', requireAuth, requireRole('superadmin'), async (req: Request, res: Response) => {
  try {
    const patch: Record<string, number> = {};
    for (const field of THRESHOLD_FIELDS) {
      const raw = req.body?.[field];
      if (raw === undefined) continue;
      const { min, max } = thresholdLimits(field);
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
        throw new HttpError(400, `${field.replace(/_/g, ' ')} must be a number from ${min} to ${max}`);
      }
      patch[field] = raw;
    }
    res.json({ values: await saveAlertThresholds(patch) });
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
