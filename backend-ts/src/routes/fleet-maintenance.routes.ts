/**
 * margixindia — Fleet maintenance routes (staff), mounted under /fleet by fleet.routes.ts.
 *
 * Maintenance jobs (move to maintenance, return to service), service record items and
 * attachments, default service plans, and the odometer auto sync.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { guardOfVehicle, guardOwned, guardVehicle } from '../core/org-guards';
import { HttpError, sendError } from '../core/errors';
import { indianDateKey } from '../core/istDate';
import { rateLimitByUser } from '../core/rate-limit';
import { serviceStatus } from '../services/service-plans.service';
import {
  addJobAttachments, closeJob, CloseJobSchema, getOpenWork, listJobs, openJob, OpenJobSchema, updateJob, UpdateJobSchema,
} from '../services/maintenance.service';
import {
  addAttachments, addServiceItems, attachmentLink, AttachmentInputSchema, createAttachmentUpload, deleteAttachment,
  deleteServiceItem, ServiceItemSchema,
} from '../services/service-records.service';
import { syncVehicleOdometer } from '../services/odometer-sync.service';

const router = Router();
const staff = [requireAuth, requireRole(...STAFF_ROLES)] as const;
// Work on one vehicle: another company's is a 404
const staffVehicle = [...staff, guardVehicle('id')] as const;

const firstIssue = (parsed: { success: false; error: z.ZodError }) => parsed.error.issues[0].message;

async function requireVehicleRow(id: string) {
  const { data, error } = await supabase.from('vehicles').select('id, plate_number, odometer_km, status').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Vehicle not found');
  return data as { id: string; plate_number: string; odometer_km: number | null; status: string };
}

// ── Maintenance jobs ───────────────────────────────────────

// GET /fleet/maintenance/jobs?status=open|closed&vehicle_id= — newest first, with plate, days in, and whether it is late
router.get('/maintenance/jobs', ...staff, async (req: Request, res: Response) => {
  try {
    const status = req.query.status === 'open' || req.query.status === 'closed' ? req.query.status : undefined;
    const vehicleId = typeof req.query.vehicle_id === 'string' ? req.query.vehicle_id : undefined;
    res.json(await listJobs({ status, vehicleId }));
  } catch (e) {
    sendError(req, res, e);
  }
});

// GET /fleet/vehicles/:id/maintenance/preview — what moving the vehicle to maintenance would interrupt
router.get('/vehicles/:id/maintenance/preview', ...staffVehicle, async (req: Request, res: Response) => {
  try {
    await requireVehicleRow(req.params.id);
    const [work, open] = await Promise.all([getOpenWork(req.params.id), listJobs({ vehicleId: req.params.id, status: 'open' })]);
    res.json({ open_work: work, open_job: open[0] ?? null });
  } catch (e) {
    sendError(req, res, e);
  }
});

// POST /fleet/vehicles/:id/maintenance — move a vehicle to maintenance (opens a job)
router.post('/vehicles/:id/maintenance', ...staffVehicle, async (req: Request, res: Response) => {
  try {
    const parsed = OpenJobSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed));
    const job = await openJob(req.params.id, parsed.data, { id: req.user!.user_id, role: req.user!.role });
    res.status(201).json(job);
  } catch (e) {
    sendError(req, res, e);
  }
});

// PATCH /fleet/maintenance/jobs/:id — change the expected return, workshop, reason or note of an open job
router.patch('/maintenance/jobs/:id', ...staff, guardOwned('vehicle_maintenance_jobs', 'id', 'Maintenance job not found'), async (req: Request, res: Response) => {
  try {
    const parsed = UpdateJobSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed));
    res.json(await updateJob(req.params.id, parsed.data));
  } catch (e) {
    sendError(req, res, e);
  }
});

// POST /fleet/maintenance/jobs/:id/close — return to service: writes the service record and frees the vehicle
router.post('/maintenance/jobs/:id/close', ...staff, guardOwned('vehicle_maintenance_jobs', 'id', 'Maintenance job not found'), async (req: Request, res: Response) => {
  try {
    const parsed = CloseJobSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed));
    res.json(await closeJob(req.params.id, parsed.data, { id: req.user!.user_id, role: req.user!.role }));
  } catch (e) {
    sendError(req, res, e);
  }
});

// POST /fleet/maintenance/jobs/:id/attachments — job card or photos for the job in progress
router.post('/maintenance/jobs/:id/attachments', ...staff, guardOwned('vehicle_maintenance_jobs', 'id', 'Maintenance job not found'), async (req: Request, res: Response) => {
  try {
    const parsed = z.object({ attachments: z.array(AttachmentInputSchema).min(1).max(10) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed));
    res.status(201).json(await addJobAttachments(req.params.id, parsed.data.attachments, req.user!.user_id));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Service record attachments ─────────────────────────────

// POST /fleet/vehicles/:id/service-attachments/upload-url — signed URL to upload one PDF, JPG or PNG
router.post('/vehicles/:id/service-attachments/upload-url', ...staffVehicle, rateLimitByUser('service-attachment-upload', 60, 60 * 60), async (req: Request, res: Response) => {
  try {
    await requireVehicleRow(req.params.id);
    res.json(await createAttachmentUpload(req.params.id, req.body?.content_type, req.body?.size));
  } catch (e) {
    sendError(req, res, e);
  }
});

// POST /fleet/service-log/:id/attachments — attach uploaded files to a record
router.post('/service-log/:id/attachments', ...staff, guardOfVehicle('vehicle_service_log', 'id', 'Service record not found'), async (req: Request, res: Response) => {
  try {
    const parsed = z.object({ attachments: z.array(AttachmentInputSchema).min(1).max(10) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed));
    const { data: log, error } = await supabase.from('vehicle_service_log').select('id, vehicle_id').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!log) throw new HttpError(404, 'Service record not found');
    res.status(201).json(await addAttachments(log.vehicle_id, { service_log_id: log.id }, parsed.data.attachments, req.user!.user_id));
  } catch (e) {
    sendError(req, res, e);
  }
});

// GET /fleet/service-attachments/:id/url?download=1 — short-lived link to view or download
router.get('/service-attachments/:id/url', ...staff, guardOfVehicle('vehicle_service_attachments', 'id', 'Attachment not found'), async (req: Request, res: Response) => {
  try {
    res.json(await attachmentLink(req.params.id, req.query.download === '1' || req.query.download === 'true'));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.delete('/service-attachments/:id', ...staff, guardOfVehicle('vehicle_service_attachments', 'id', 'Attachment not found'), async (req: Request, res: Response) => {
  try {
    await deleteAttachment(req.params.id);
    res.json({ status: 'deleted' });
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Service record items ───────────────────────────────────

// POST /fleet/service-log/:id/items — parts replaced or repairs; the record's cost becomes items plus labour
router.post('/service-log/:id/items', ...staff, guardOfVehicle('vehicle_service_log', 'id', 'Service record not found'), async (req: Request, res: Response) => {
  try {
    const parsed = z.object({ items: z.array(ServiceItemSchema).min(1).max(50) }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed));
    res.status(201).json(await addServiceItems(req.params.id, parsed.data.items));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.delete('/service-items/:id', ...staff, guardOfVehicle('vehicle_service_items', 'id', 'Item not found'), async (req: Request, res: Response) => {
  try {
    res.json(await deleteServiceItem(req.params.id));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Default service plans ──────────────────────────────────

// GET /fleet/service-plan-templates — the editable defaults (service_plan_templates)
router.get('/service-plan-templates', ...staff, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('service_plan_templates')
      .select('id, item, interval_km, interval_days, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json([...(data ?? [])].sort((a, b) => a.sort_order - b.sort_order));
  } catch (e) {
    sendError(req, res, e);
  }
});

// POST /fleet/vehicles/:id/service-plans/defaults — add every default item the vehicle does not have yet.
// Each starts from the latest service logged for it, or from today when none was logged.
router.post('/vehicles/:id/service-plans/defaults', ...staffVehicle, async (req: Request, res: Response) => {
  try {
    const vehicle = await requireVehicleRow(req.params.id);
    const [templates, plans, log] = await Promise.all([
      supabase.from('service_plan_templates').select('item, interval_km, interval_days, sort_order').eq('is_active', true),
      supabase.from('vehicle_service_plans').select('item').eq('vehicle_id', vehicle.id),
      supabase.from('vehicle_service_log').select('item, done_at, odometer_km').eq('vehicle_id', vehicle.id),
    ]);
    if (templates.error) throw templates.error;
    if (plans.error) throw plans.error;
    if (log.error) throw log.error;
    if ((templates.data ?? []).length === 0) throw new HttpError(409, 'No default service items are set up.');

    const have = new Set((plans.data ?? []).map(p => p.item.toLowerCase()));
    const missing = [...(templates.data ?? [])].filter(t => !have.has(t.item.toLowerCase())).sort((a, b) => a.sort_order - b.sort_order);
    if (missing.length === 0) throw new HttpError(409, 'This vehicle already has every default item.');

    const latest = new Map<string, { done_at: string; odometer_km: number | null }>();
    for (const l of log.data ?? []) {
      const key = String(l.item).toLowerCase();
      const seen = latest.get(key);
      if (!seen || String(l.done_at) > seen.done_at) latest.set(key, { done_at: String(l.done_at).slice(0, 10), odometer_km: l.odometer_km });
    }
    const today = indianDateKey(new Date());
    const odo = vehicle.odometer_km != null ? Number(vehicle.odometer_km) : null;
    const { data, error } = await supabase
      .from('vehicle_service_plans')
      .insert(missing.map(t => {
        const last = latest.get(t.item.toLowerCase());
        return {
          vehicle_id: vehicle.id, item: t.item, interval_km: t.interval_km, interval_days: t.interval_days,
          last_done_at: last?.done_at ?? today, last_done_km: last ? last.odometer_km : odo,
        };
      }))
      .select('id, vehicle_id, item, interval_km, interval_days, last_done_km, last_done_at');
    if (error) throw error;
    res.status(201).json((data ?? []).map(p => serviceStatus(p, odo)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Odometer auto sync ─────────────────────────────────────

// POST /fleet/vehicles/:id/odometer/sync — add the distance driven since the last update, from GPS
router.post('/vehicles/:id/odometer/sync', ...staffVehicle, async (req: Request, res: Response) => {
  try {
    res.json(await syncVehicleOdometer(req.params.id, { userId: req.user!.user_id }));
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
