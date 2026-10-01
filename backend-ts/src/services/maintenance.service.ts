/**
 * Maintenance workflow: a vehicle's stay in the workshop.
 *
 *  open   Staff move a vehicle to maintenance with a reason, the expected return date, the workshop
 *         and a note. A vehicle with a pending or active route, or a load waiting or on board, is
 *         not moved unless staff choose to release that work: its routes and loads are cancelled
 *         through the same code as cancelling them by hand (shipments not yet picked up go back to
 *         the queue) and the driver is told. The vehicle's status changes through changeVehicleStatus.
 *  close  "Return to service" records the visit as a service record (final odometer, cost, parts,
 *         documents), moves the baseline of the schedule items serviced, and makes the vehicle
 *         available again.
 *
 * A breakdown raised from an SOS can be turned into a job (`sos_alert_id`).
 */
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { indianDateKey } from '../core/istDate';
import { changeVehicleStatus } from '../core/vehicles';
import { cacheDeletePattern } from '../core/redis';
import { invalidateDriverVehicles } from '../core/ownership';
import { cancelManifest, routeService } from './route.service';
import type { CargoHoldContext } from './shipment.service';
import { notificationService } from './notification.service';
import { setOdometerReading } from './odometer-sync.service';
import {
  addAttachments, AttachmentInputSchema, dateOnly, recordService, ServiceItemSchema, type AttachmentRow,
} from './service-records.service';
import { carrierStamp } from '../core/org-context';

export const MAINTENANCE_REASONS = ['scheduled_service', 'breakdown', 'accident', 'tyre', 'other'] as const;
export type MaintenanceReason = typeof MAINTENANCE_REASONS[number];

export const REASON_LABELS: Record<MaintenanceReason, string> = {
  scheduled_service: 'Scheduled service',
  breakdown: 'Breakdown',
  accident: 'Accident',
  tyre: 'Tyre',
  other: 'Other',
};

/** The headline of the service record a job produces when no other summary is given. */
const REASON_SUMMARY: Record<MaintenanceReason, string> = {
  scheduled_service: 'Scheduled service',
  breakdown: 'Breakdown repair',
  accident: 'Accident repair',
  tyre: 'Tyre work',
  other: 'Maintenance',
};

export const OpenJobSchema = z.object({
  reason_type: z.enum(MAINTENANCE_REASONS, { errorMap: () => ({ message: `Choose a reason: ${MAINTENANCE_REASONS.join(', ').replace(/_/g, ' ')}` }) }),
  expected_return_date: dateOnly.nullable().optional(),
  workshop: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** Cancel the vehicle's routes and loads so it can go. Without it, a vehicle with work is not moved. */
  release_work: z.boolean().optional(),
  sos_alert_id: z.string().uuid().nullable().optional(),
  attachments: z.array(AttachmentInputSchema).max(10).default([]),
});

export const UpdateJobSchema = z.object({
  reason_type: z.enum(MAINTENANCE_REASONS).optional(),
  expected_return_date: dateOnly.nullable().optional(),
  workshop: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const CloseJobSchema = z.object({
  final_odometer_km: z.number({ required_error: 'Enter the odometer reading', invalid_type_error: 'Enter the odometer reading in km' }).min(0).max(9_999_999),
  /** Needed only when the reading is lower than the one on file. */
  correction_reason: z.string().trim().max(300).nullable().optional(),
  /** What was done. Defaults to the job's reason. */
  summary: z.string().trim().min(1).max(60).optional(),
  done_at: dateOnly.optional(),
  cost: z.number().min(0).max(100_000_000).nullable().optional(),
  labour_cost: z.number().min(0).max(100_000_000).nullable().optional(),
  workshop: z.string().trim().max(120).nullable().optional(),
  invoice_number: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  items: z.array(ServiceItemSchema).max(50).default([]),
  attachments: z.array(AttachmentInputSchema).max(10).default([]),
  /** Schedule items serviced during the visit (engine oil, brake pads, ...); their baseline moves forward. */
  serviced_items: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  return_status: z.enum(['available', 'idle']).default('available'),
});

// ── Work that would be interrupted ─────────────────────────

export interface OpenWork {
  routes: { id: string; status: string; started_at: string | null }[];
  manifests: { id: string; status: string; pickup_location: string | null; drop_location: string | null }[];
  /** Shipments already picked up on the vehicle's active routes. Releasing does not undo a pickup. */
  shipments_on_board: number;
  /** Consignments (shipments and vendor loads) whose goods are on the vehicle. Releasing holds them on a cargo case. */
  cargo_on_board: number;
  /** True when there is anything that must be released first. */
  blocking: boolean;
  summary: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The routes (planned or running) and loads (waiting or on board) a vehicle has. */
export async function getOpenWork(vehicleId: string): Promise<OpenWork> {
  const [routesRes, loadsRes] = await Promise.all([
    supabase.from('routes').select('id, status, started_at').eq('vehicle_id', vehicleId).in('status', ['pending', 'active']),
    supabase.from('cargo_manifest').select('id, status, pickup_location, drop_location').eq('vehicle_id', vehicleId).in('status', ['scheduled', 'in_transit']),
  ]);
  if (routesRes.error) throw routesRes.error;
  if (loadsRes.error) throw loadsRes.error;
  const routes = (routesRes.data ?? []) as OpenWork['routes'];
  const manifests = (loadsRes.data ?? []) as OpenWork['manifests'];

  let onBoard = 0;
  const activeIds = routes.filter(r => r.status === 'active').map(r => r.id);
  if (activeIds.length > 0) {
    const { data: stops } = await supabase.from('route_stops').select('delivery_point_id').in('route_id', activeIds);
    const dpIds = [...new Set((stops ?? []).map(s => s.delivery_point_id).filter(Boolean))];
    if (dpIds.length > 0) {
      const { data: dps } = await supabase.from('delivery_points').select('shipment_id').in('id', dpIds);
      const shipmentIds = [...new Set((dps ?? []).map(d => d.shipment_id).filter(Boolean))];
      if (shipmentIds.length > 0) {
        const { data: shipments } = await supabase.from('shipments').select('id').in('id', shipmentIds).in('status', ['picked_up', 'in_transit']);
        onBoard = shipments?.length ?? 0;
      }
    }
  }

  const parts: string[] = [];
  const active = routes.filter(r => r.status === 'active').length;
  const planned = routes.length - active;
  if (active) parts.push(plural(active, 'active trip'));
  if (planned) parts.push(plural(planned, 'planned trip'));
  if (manifests.length) parts.push(plural(manifests.length, 'load'));
  const { consignmentsOnVehicle } = await import('./cargo/exception.service');
  const cargo = (await consignmentsOnVehicle(vehicleId)).length;
  if (cargo && !routes.length && !manifests.length) parts.push(plural(cargo, 'consignment') + ' on board');
  let summary = parts.length ? parts.join(', ') : 'No trips or loads';
  if (onBoard) summary += `, ${plural(onBoard, 'shipment')} already on board`;
  return { routes, manifests, shipments_on_board: onBoard, cargo_on_board: cargo, blocking: routes.length + manifests.length + cargo > 0, summary };
}

// ── Reading jobs ───────────────────────────────────────────

const JOB_COLUMNS = 'id, vehicle_id, status, reason_type, workshop, expected_return_date, note, sos_alert_id, released_work, opened_at, opened_by, opened_odometer_km, closed_at, closed_by, final_odometer_km, total_cost, close_note, service_log_id, updated_at';

/** How a job looks to the fleet: how long it has been in, and whether it is late. */
export function decorateJob<T extends { status: string; opened_at: string; expected_return_date: string | null; closed_at: string | null }>(job: T, now: Date = new Date()) {
  const today = indianDateKey(now);
  const end = job.closed_at ? new Date(job.closed_at) : now;
  const daysIn = Math.max(0, Math.round((Date.parse(indianDateKey(end)) - Date.parse(indianDateKey(new Date(job.opened_at)))) / 86_400_000));
  const late = job.status === 'open' && !!job.expected_return_date && job.expected_return_date.slice(0, 10) < today;
  const daysOverdue = late ? Math.round((Date.parse(today) - Date.parse(job.expected_return_date!.slice(0, 10))) / 86_400_000) : 0;
  return { ...job, days_in_maintenance: daysIn, is_overdue: late, days_overdue: daysOverdue };
}

export async function listJobs(filter: { status?: 'open' | 'closed'; vehicleId?: string; limit?: number } = {}) {
  let q = supabase.from('vehicle_maintenance_jobs').select(JOB_COLUMNS).order('opened_at', { ascending: false }).limit(filter.limit ?? 100);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.vehicleId) q = q.eq('vehicle_id', filter.vehicleId);
  const { data, error } = await q;
  if (error) throw error;
  const jobs = data ?? [];
  if (jobs.length === 0) return [];
  const vehicleIds = [...new Set(jobs.map(j => j.vehicle_id))];
  const [vehicles, files] = await Promise.all([
    supabase.from('vehicles').select('id, plate_number').in('id', vehicleIds),
    supabase.from('vehicle_service_attachments')
      .select('id, vehicle_id, service_log_id, job_id, kind, file_name, content_type, size_bytes, created_at')
      .in('job_id', jobs.map(j => j.id)),
  ]);
  if (vehicles.error) throw vehicles.error;
  if (files.error) throw files.error;
  const plate = new Map((vehicles.data ?? []).map(v => [v.id, v.plate_number as string]));
  return jobs.map(j => ({
    ...decorateJob(j),
    plate_number: plate.get(j.vehicle_id) ?? null,
    attachments: (files.data ?? []).filter(a => a.job_id === j.id) as AttachmentRow[],
  }));
}

async function loadJob(jobId: string) {
  const { data, error } = await supabase.from('vehicle_maintenance_jobs').select(JOB_COLUMNS).eq('id', jobId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Maintenance job not found');
  return data;
}

async function afterVehicleChange(): Promise<void> {
  await cacheDeletePattern('vehicles:list:*');
  invalidateDriverVehicles();
}

const isUnique = (e: { code?: string } | null | undefined) => e?.code === '23505';

// ── Open ───────────────────────────────────────────────────

type Actor = { id: string; role: string };

export async function openJob(vehicleId: string, input: z.infer<typeof OpenJobSchema>, actor: Actor) {
  const { data: vehicle, error: vErr } = await supabase
    .from('vehicles').select('id, plate_number, status, driver_id, odometer_km').eq('id', vehicleId).maybeSingle();
  if (vErr) throw vErr;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');
  if (vehicle.status === 'archived') throw new HttpError(409, 'This vehicle is archived. Restore it first.');

  const today = indianDateKey(new Date());
  if (input.expected_return_date && input.expected_return_date < today) {
    throw new HttpError(400, 'The expected return date cannot be in the past');
  }

  const { data: existing } = await supabase
    .from('vehicle_maintenance_jobs').select('id').eq('vehicle_id', vehicleId).eq('status', 'open').limit(1);
  if (existing && existing.length > 0) {
    throw new HttpError(409, `${vehicle.plate_number} already has an open maintenance job.`, { job_id: existing[0].id });
  }

  if (input.sos_alert_id) {
    const { data: sos } = await supabase.from('sos_alerts').select('id, vehicle_id').eq('id', input.sos_alert_id).maybeSingle();
    if (!sos) throw new HttpError(404, 'That SOS alert was not found');
    if (sos.vehicle_id !== vehicleId) throw new HttpError(400, 'That SOS alert belongs to a different vehicle');
  }

  const work = await getOpenWork(vehicleId);
  if (work.blocking && !input.release_work) {
    throw new HttpError(
      409,
      `${vehicle.plate_number} has work in progress (${work.summary}). Release its trips and loads to move it to maintenance, or wait until it finishes.`,
      { requires_release: true, open_work: work },
    );
  }

  // Release: cancel through the normal paths so shipments return to the queue and the driver hears
  // about it. Goods already on board are never stranded: they go on hold on one cargo case for the
  // vehicle (linked to the job and any SOS), and stay on the vehicle until staff plan them.
  const released: { routes: string[]; manifests: string[]; cargo_exception_id?: string } = { routes: [], manifests: [] };
  let cargoCase: { exception_id: string } | null = null;
  if (work.blocking) {
    const hold: CargoHoldContext = {
      source: 'maintenance',
      type: input.reason_type === 'accident' ? 'vehicle_accident' : input.reason_type === 'scheduled_service' || input.reason_type === 'other' ? 'other' : 'vehicle_breakdown',
      reason: `${vehicle.plate_number} was moved to maintenance (${REASON_LABELS[input.reason_type].toLowerCase()}).`,
      sosAlertId: input.sos_alert_id ?? null,
    };
    for (const r of work.routes) {
      await routeService.changeStatus(r.id, 'cancelled', { cargoHold: hold, actor });
      released.routes.push(r.id);
    }
    for (const m of work.manifests) {
      await cancelManifest(m.id, hold, actor);
      released.manifests.push(m.id);
    }
    // Anything else still on board (a failed delivery waiting for a re-attempt) joins the same case
    const { holdCargoOnVehicle } = await import('./cargo/exception.service');
    cargoCase = await holdCargoOnVehicle(vehicleId, hold, actor);
    if (cargoCase) released.cargo_exception_id = cargoCase.exception_id;
  }

  const { data: job, error } = await supabase
    .from('vehicle_maintenance_jobs')
    .insert({
      ...carrierStamp(),
      vehicle_id: vehicleId,
      status: 'open',
      reason_type: input.reason_type,
      workshop: input.workshop || null,
      expected_return_date: input.expected_return_date || null,
      note: input.note || null,
      sos_alert_id: input.sos_alert_id ?? null,
      released_work: work.blocking ? released : null,
      opened_at: new Date().toISOString(),
      opened_by: actor.id,
      opened_odometer_km: vehicle.odometer_km ?? null,
    })
    .select(JOB_COLUMNS)
    .single();
  if (error) {
    if (isUnique(error)) throw new HttpError(409, `${vehicle.plate_number} already has an open maintenance job.`);
    throw error;
  }

  try {
    await changeVehicleStatus(vehicleId, 'maintenance');
  } catch (e) {
    await supabase.from('vehicle_maintenance_jobs').delete().eq('id', job.id);
    throw e;
  }
  await afterVehicleChange();
  if (cargoCase) {
    const { linkMaintenanceJob } = await import('./cargo/exception.service');
    await linkMaintenanceJob(cargoCase.exception_id, job.id);
  }

  if (input.sos_alert_id) {
    await supabase.from('sos_alerts')
      .update({ status: 'acknowledged', updated_at: new Date().toISOString() })
      .eq('id', input.sos_alert_id).eq('status', 'active');
  }
  const attachments = await addAttachments(vehicleId, { job_id: job.id }, input.attachments, actor.id);

  if (vehicle.driver_id) {
    try {
      const back = input.expected_return_date ? ` Expected back ${input.expected_return_date}.` : '';
      await notificationService.sendNotification(
        vehicle.driver_id,
        'Vehicle moved to maintenance',
        `${vehicle.plate_number} is in maintenance (${REASON_LABELS[input.reason_type].toLowerCase()}${input.workshop ? ` at ${input.workshop}` : ''}).${back} Dispatch will tell you when it is back.`,
        'maintenance',
        { vehicle_id: vehicleId, job_id: job.id },
      );
    } catch (e) {
      console.error('[maintenance] Could not tell the driver:', e);
    }
  }

  return { ...decorateJob(job), plate_number: vehicle.plate_number, released_work: job.released_work, attachments };
}

export async function updateJob(jobId: string, patch: z.infer<typeof UpdateJobSchema>) {
  const job = await loadJob(jobId);
  if (job.status !== 'open') throw new HttpError(409, 'This maintenance job is already closed');
  const today = indianDateKey(new Date());
  if (patch.expected_return_date && patch.expected_return_date < today) {
    throw new HttpError(400, 'The expected return date cannot be in the past');
  }
  const { data, error } = await supabase
    .from('vehicle_maintenance_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId).eq('status', 'open')
    .select(JOB_COLUMNS).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, 'This maintenance job was just closed');
  return decorateJob(data);
}

// ── Close: return to service ───────────────────────────────

export async function closeJob(jobId: string, input: z.infer<typeof CloseJobSchema>, actor: Actor) {
  const job = await loadJob(jobId);
  if (job.status !== 'open') throw new HttpError(409, 'This maintenance job is already closed');

  const { data: vehicle, error: vErr } = await supabase
    .from('vehicles').select('id, plate_number, status, odometer_km').eq('id', job.vehicle_id).maybeSingle();
  if (vErr) throw vErr;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');

  // The reading is checked before anything is written: it may not go down without a reason
  const current = vehicle.odometer_km != null ? Number(vehicle.odometer_km) : null;
  if (current != null && input.final_odometer_km < current && !(input.correction_reason && input.correction_reason.trim().length >= 3)) {
    throw new HttpError(
      400,
      `${Math.round(input.final_odometer_km).toLocaleString('en-IN')} km is lower than the current ${Math.round(current).toLocaleString('en-IN')} km. Add a reason to correct the reading downwards.`,
      { requires_reason: true, current_km: current },
    );
  }

  // Claim the close so two people returning the same vehicle do not write two records
  const closedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from('vehicle_maintenance_jobs')
    .update({ status: 'closed', closed_at: closedAt, closed_by: actor.id, updated_at: closedAt })
    .eq('id', jobId).eq('status', 'open')
    .select('id').maybeSingle();
  if (claimErr) throw claimErr;
  if (!claimed) throw new HttpError(409, 'This maintenance job was just closed by someone else');

  try {
    if (current == null || input.final_odometer_km !== current) {
      await setOdometerReading(vehicle.id, input.final_odometer_km, { reason: input.correction_reason, userId: actor.id });
    }
    const summary = input.summary ?? REASON_SUMMARY[job.reason_type as MaintenanceReason] ?? 'Maintenance';
    const record = await recordService(
      {
        item: summary,
        done_at: input.done_at,
        odometer_km: input.final_odometer_km,
        cost: input.cost ?? null,
        labour_cost: input.labour_cost ?? null,
        workshop: input.workshop ?? null,
        invoice_number: input.invoice_number ?? null,
        note: input.note ?? job.note ?? null,
        items: input.items,
        attachments: input.attachments,
        plan_items: input.serviced_items,
      },
      {
        vehicle: { id: vehicle.id, plate_number: vehicle.plate_number, odometer_km: input.final_odometer_km, status: vehicle.status },
        userId: actor.id,
        jobId: job.id,
        defaultWorkshop: job.workshop,
      },
    );
    // Schedule items serviced during the visit each get a baseline (recordService covers `serviced_items`, or the headline if none)
    const { data: closed, error: closeErr } = await supabase
      .from('vehicle_maintenance_jobs')
      .update({
        final_odometer_km: input.final_odometer_km, total_cost: record.cost, close_note: input.note ?? null,
        service_log_id: record.id, workshop: input.workshop || job.workshop || null,
      })
      .eq('id', jobId).select(JOB_COLUMNS).single();
    if (closeErr) throw closeErr;

    // Only a vehicle still in maintenance goes back; one already returned by hand or put back to work is left alone
    let vehicleStatus = vehicle.status as string;
    if (vehicle.status === 'maintenance') {
      const change = await changeVehicleStatus(vehicle.id, input.return_status);
      vehicleStatus = change.status;
    }
    await afterVehicleChange();
    return { job: decorateJob(closed), service_record: record, vehicle_status: vehicleStatus };
  } catch (e) {
    // Nothing else can use the vehicle yet: reopen the job so the return can be tried again
    await supabase.from('vehicle_maintenance_jobs')
      .update({ status: 'open', closed_at: null, closed_by: null, updated_at: new Date().toISOString() })
      .eq('id', jobId);
    throw e;
  }
}

export async function addJobAttachments(jobId: string, list: z.infer<typeof AttachmentInputSchema>[], userId: string) {
  const job = await loadJob(jobId);
  return addAttachments(job.vehicle_id, { job_id: job.id }, list, userId);
}

/**
 * A vehicle taken out of maintenance by the plain status change (not "Return to service") would
 * leave its job open for good; this closes it, noting that no service record was written.
 */
export async function closeOpenJobsForVehicle(vehicleId: string, actorId: string | null): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('vehicle_maintenance_jobs')
    .update({ status: 'closed', closed_at: now, closed_by: actorId, close_note: 'Returned to service without a service record', updated_at: now })
    .eq('vehicle_id', vehicleId)
    .eq('status', 'open');
  if (error) throw error;
}
