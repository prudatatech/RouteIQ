/**
 * Service records: what was done to a vehicle, what it cost, and the papers for it.
 *
 * A record (vehicle_service_log) has a headline ("what was done"), date, odometer and workshop.
 * Its cost is the sum of its line items (parts replaced, repairs) plus labour; when there are no
 * items and no labour the total entered by staff is the cost. Invoices, job cards and photos are
 * kept in the private storage bucket (under vehicle-service/<vehicle id>/) and listed in
 * vehicle_service_attachments.
 *
 * Used by the fleet service-log routes and by "Return to service" on a maintenance job.
 */
import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';
import { HttpError } from '../core/errors';
import { indianDateKey } from '../core/istDate';
import { cacheDeletePattern } from '../core/redis';
import { TPL_UPLOAD_CONTENT_TYPES } from './tpl.service';

export const ATTACHMENT_KINDS = ['invoice', 'job_card', 'photo', 'other'] as const;
export type AttachmentKind = typeof ATTACHMENT_KINDS[number];

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD');
const money = (label: string) => z.number({ invalid_type_error: `${label} must be a number` }).min(0, `${label} cannot be negative`).max(100_000_000, `${label} is too large`);

export const ServiceItemSchema = z.object({
  description: z.string().trim().min(1, 'Enter the part or repair').max(120),
  kind: z.enum(['part', 'repair']).default('part'),
  quantity: z.number({ invalid_type_error: 'Quantity must be a number' }).positive('Quantity must be more than 0').max(100_000).default(1),
  unit_cost: money('Unit cost'),
});
export type ServiceItemInput = z.infer<typeof ServiceItemSchema>;

export const AttachmentInputSchema = z.object({
  path: z.string().min(1).max(300),
  kind: z.enum(ATTACHMENT_KINDS).default('other'),
  file_name: z.string().trim().max(200).nullable().optional(),
  content_type: z.string().max(100).nullable().optional(),
  size_bytes: z.number().int().min(0).nullable().optional(),
});
export type AttachmentInput = z.infer<typeof AttachmentInputSchema>;

export const ServiceRecordSchema = z.object({
  item: z.string().trim().min(1, 'Enter what was done').max(60),
  done_at: dateOnly.optional(),
  odometer_km: money('Odometer').nullable().optional(),
  /** The total, used when there are no line items and no labour. */
  cost: money('Cost').nullable().optional(),
  labour_cost: money('Labour cost').nullable().optional(),
  workshop: z.string().trim().max(120).nullable().optional(),
  invoice_number: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  items: z.array(ServiceItemSchema).max(50).default([]),
  attachments: z.array(AttachmentInputSchema).max(10).default([]),
  /** Schedule items this service covers (their baseline moves forward). Defaults to `item`. */
  plan_items: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});
export type ServiceRecordInput = z.infer<typeof ServiceRecordSchema>;

const LOG_COLUMNS = 'id, vehicle_id, item, done_at, odometer_km, cost, note, expense_id, created_at, workshop, labour_cost, invoice_number, job_id';

// ── Totals ─────────────────────────────────────────────────

export function itemTotal(item: { quantity: number; unit_cost: number }): number {
  return round2(item.quantity * item.unit_cost);
}

/**
 * The cost of a record. With line items or labour it is items plus labour; otherwise the total
 * entered by staff (or null when none was given).
 */
export function recordTotal(items: { quantity: number; unit_cost: number }[], labour: number | null, entered: number | null): number | null {
  if (items.length > 0 || labour != null) {
    return round2(items.reduce((s, i) => s + itemTotal(i), 0) + (labour ?? 0));
  }
  return entered;
}

// ── Attachments ────────────────────────────────────────────

const attachmentFolder = (vehicleId: string) => `vehicle-service/${vehicleId}/`;

/** A signed upload URL for one file (PDF, JPG or PNG). The client uploads straight to storage, then sends the path back. */
export async function createAttachmentUpload(vehicleId: string, contentType: unknown, size: unknown) {
  const extension = typeof contentType === 'string' ? TPL_UPLOAD_CONTENT_TYPES[contentType.toLowerCase()] : undefined;
  if (!extension) throw new HttpError(415, 'Upload a PDF, JPG or PNG file');
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
  if (bytes > settings.SERVICE_ATTACHMENT_MAX_BYTES) {
    throw new HttpError(413, `A file must be at most ${Math.floor(settings.SERVICE_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`);
  }
  const path = `${attachmentFolder(vehicleId)}${crypto.randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`Failed to create upload URL: ${error?.message}`);
  return { path: data.path, token: data.token, signed_url: data.signedUrl, bucket: settings.KYC_DOCUMENTS_BUCKET };
}

/** Only files uploaded through this vehicle's upload URL can be attached to its records. */
function assertOwnPaths(vehicleId: string, list: AttachmentInput[]): void {
  for (const a of list) {
    if (!a.path.startsWith(attachmentFolder(vehicleId)) || a.path.includes('..')) {
      throw new HttpError(400, 'That file was not uploaded for this vehicle. Upload it again.');
    }
  }
}

export interface AttachmentRow {
  id: string;
  vehicle_id: string;
  service_log_id: string | null;
  job_id: string | null;
  kind: AttachmentKind;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}
const ATTACHMENT_COLUMNS = 'id, vehicle_id, service_log_id, job_id, kind, file_name, content_type, size_bytes, created_at';

export async function addAttachments(
  vehicleId: string,
  parent: { service_log_id?: string | null; job_id?: string | null },
  list: AttachmentInput[],
  userId: string | null,
): Promise<AttachmentRow[]> {
  if (list.length === 0) return [];
  assertOwnPaths(vehicleId, list);
  const { data, error } = await supabase
    .from('vehicle_service_attachments')
    .insert(list.map(a => ({
      vehicle_id: vehicleId,
      service_log_id: parent.service_log_id ?? null,
      job_id: parent.job_id ?? null,
      kind: a.kind,
      file_path: a.path,
      file_name: a.file_name ?? null,
      content_type: a.content_type ?? null,
      size_bytes: a.size_bytes ?? null,
      uploaded_by: userId,
    })))
    .select(ATTACHMENT_COLUMNS);
  if (error) throw error;
  return (data ?? []) as AttachmentRow[];
}

/** A short-lived link to view or download one attachment. */
export async function attachmentLink(attachmentId: string, download: boolean): Promise<{ url: string; file_name: string | null }> {
  const { data, error } = await supabase
    .from('vehicle_service_attachments').select('id, file_path, file_name').eq('id', attachmentId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Attachment not found');
  const { data: signed, error: signErr } = await supabase.storage
    .from(settings.KYC_DOCUMENTS_BUCKET)
    .createSignedUrl(data.file_path, 600, download ? { download: data.file_name || true } : undefined);
  if (signErr || !signed) throw new Error(`Failed to create the file link: ${signErr?.message}`);
  return { url: signed.signedUrl, file_name: data.file_name ?? null };
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  const { data, error } = await supabase
    .from('vehicle_service_attachments').delete().eq('id', attachmentId).select('id, file_path').maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Attachment not found');
  // Best effort: the row is gone either way
  await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).remove([data.file_path]).catch(() => undefined);
}

// ── Records ────────────────────────────────────────────────

export interface ServiceItemRow {
  id: string;
  service_log_id: string;
  description: string;
  kind: 'part' | 'repair';
  quantity: number;
  unit_cost: number;
  total_cost: number;
}
const ITEM_COLUMNS = 'id, service_log_id, description, kind, quantity, unit_cost, total_cost';

/** The service history of a vehicle, newest first, each record with its items and attachments. */
export async function listServiceLog(vehicleId: string, limit = 100) {
  const { data, error } = await supabase
    .from('vehicle_service_log')
    .select(LOG_COLUMNS)
    .eq('vehicle_id', vehicleId)
    .order('done_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const entries = data ?? [];
  if (entries.length === 0) return [];
  const ids = entries.map(e => e.id);
  const [items, files] = await Promise.all([
    supabase.from('vehicle_service_items').select(ITEM_COLUMNS).in('service_log_id', ids).order('created_at', { ascending: true }),
    supabase.from('vehicle_service_attachments').select(ATTACHMENT_COLUMNS).in('service_log_id', ids).order('created_at', { ascending: true }),
  ]);
  if (items.error) throw items.error;
  if (files.error) throw files.error;
  return entries.map(e => ({
    ...e,
    items: (items.data ?? []).filter(i => i.service_log_id === e.id),
    attachments: (files.data ?? []).filter(a => a.service_log_id === e.id),
  }));
}

export interface RecordServiceContext {
  vehicle: { id: string; plate_number: string; odometer_km: number | null; status: string };
  userId: string | null;
  /** Set when the record closes a maintenance job. */
  jobId?: string | null;
  /** Fall back to this workshop when the record names none (the job's). */
  defaultWorkshop?: string | null;
}

/**
 * Write one service record: the cost as a maintenance expense, its line items and attachments,
 * a higher odometer reading, and the baseline of every schedule item it covers.
 */
export async function recordService(input: ServiceRecordInput, ctx: RecordServiceContext) {
  const { vehicle, userId } = ctx;
  const today = indianDateKey(new Date());
  const doneAt = input.done_at ?? today;
  if (doneAt > today) throw new HttpError(400, 'The service date cannot be in the future');
  assertOwnPaths(vehicle.id, input.attachments);

  const currentOdo = vehicle.odometer_km != null ? Number(vehicle.odometer_km) : null;
  const readingKm = input.odometer_km ?? currentOdo;
  const labour = input.labour_cost ?? null;
  const total = recordTotal(input.items, labour, input.cost ?? null);
  const workshop = input.workshop || ctx.defaultWorkshop || null;

  let expenseId: string | null = null;
  if (total != null && total > 0) {
    const { data: expense, error: expErr } = await supabase
      .from('expenses')
      .insert({
        vehicle_id: vehicle.id,
        category: 'maintenance',
        amount: total,
        expense_date: doneAt,
        note: input.note ? `${input.item}: ${input.note}` : input.item,
        created_by: userId,
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
      item: input.item,
      done_at: doneAt,
      odometer_km: readingKm,
      cost: total,
      labour_cost: labour,
      workshop,
      invoice_number: input.invoice_number || null,
      note: input.note || null,
      expense_id: expenseId,
      job_id: ctx.jobId ?? null,
      created_by: userId,
    })
    .select(LOG_COLUMNS)
    .single();
  if (error) {
    if (expenseId) await supabase.from('expenses').delete().eq('id', expenseId);
    throw error;
  }

  let items: ServiceItemRow[] = [];
  let attachments: AttachmentRow[] = [];
  try {
    if (input.items.length > 0) {
      const { data: rows, error: itemErr } = await supabase
        .from('vehicle_service_items')
        .insert(input.items.map(i => ({
          service_log_id: entry.id, vehicle_id: vehicle.id, description: i.description, kind: i.kind,
          quantity: i.quantity, unit_cost: i.unit_cost, total_cost: itemTotal(i),
        })))
        .select(ITEM_COLUMNS);
      if (itemErr) throw itemErr;
      items = (rows ?? []) as ServiceItemRow[];
    }
    attachments = await addAttachments(vehicle.id, { service_log_id: entry.id, job_id: ctx.jobId ?? null }, input.attachments, userId);
  } catch (e) {
    // Do not leave a record without the parts it was written with
    await supabase.from('vehicle_service_log').delete().eq('id', entry.id);
    if (expenseId) await supabase.from('expenses').delete().eq('id', expenseId);
    throw e;
  }

  // A reading higher than what we hold is the better odometer
  if (input.odometer_km != null && (currentOdo == null || input.odometer_km > currentOdo)) {
    await supabase.from('vehicles')
      .update({ odometer_km: input.odometer_km, odometer_updated_at: new Date().toISOString(), odometer_source: 'manual' })
      .eq('id', vehicle.id);
    await cacheDeletePattern('vehicles:list:*');
  }

  // Move each covered schedule item's baseline forward, unless this entry is older than the last one recorded
  const covered = [...new Set(input.plan_items && input.plan_items.length > 0 ? input.plan_items : [input.item])];
  const { data: plans } = await supabase
    .from('vehicle_service_plans')
    .select('id, item, last_done_at')
    .eq('vehicle_id', vehicle.id)
    .in('item', covered);
  let planUpdated = false;
  for (const plan of plans ?? []) {
    if (plan.last_done_at && String(plan.last_done_at).slice(0, 10) > doneAt) continue;
    const { error: pErr } = await supabase
      .from('vehicle_service_plans')
      .update({ last_done_at: doneAt, last_done_km: readingKm, updated_at: new Date().toISOString() })
      .eq('id', plan.id);
    if (pErr) throw pErr;
    planUpdated = true;
  }

  return { ...entry, items, attachments, expense_recorded: expenseId != null, plan_updated: planUpdated, vehicle_status: vehicle.status };
}

/** Keep a record's cost (and its expense) equal to its items plus labour after the items change. */
async function refreshRecordCost(logId: string): Promise<{ cost: number | null }> {
  const { data: log, error } = await supabase
    .from('vehicle_service_log')
    .select('id, vehicle_id, item, done_at, cost, labour_cost, expense_id, note')
    .eq('id', logId)
    .maybeSingle();
  if (error) throw error;
  if (!log) throw new HttpError(404, 'Service record not found');
  const { data: rows, error: itemErr } = await supabase.from('vehicle_service_items').select('quantity, unit_cost, total_cost').eq('service_log_id', logId);
  if (itemErr) throw itemErr;
  const items = (rows ?? []).map(r => ({ quantity: Number(r.quantity), unit_cost: Number(r.unit_cost) }));
  const labour = num(log.labour_cost);
  const total = recordTotal(items, labour, num(log.cost));
  const patch: Record<string, unknown> = { cost: total };

  if (total != null && total > 0) {
    if (log.expense_id) {
      await supabase.from('expenses').update({ amount: total, updated_at: new Date().toISOString() }).eq('id', log.expense_id);
    } else {
      const { data: expense, error: expErr } = await supabase.from('expenses').insert({
        vehicle_id: log.vehicle_id, category: 'maintenance', amount: total, expense_date: String(log.done_at).slice(0, 10),
        note: log.note ? `${log.item}: ${log.note}` : log.item,
      }).select('id').single();
      if (expErr) console.warn('Service cost was stored on the log only (no expense row):', expErr.message);
      else patch.expense_id = expense?.id ?? null;
    }
  } else if (log.expense_id) {
    await supabase.from('expenses').delete().eq('id', log.expense_id);
    patch.expense_id = null;
  }
  const { error: uErr } = await supabase.from('vehicle_service_log').update(patch).eq('id', logId);
  if (uErr) throw uErr;
  return { cost: total };
}

/** Add parts or repairs to an existing record; its cost follows. */
export async function addServiceItems(logId: string, items: ServiceItemInput[]) {
  const { data: log, error } = await supabase.from('vehicle_service_log').select('id, vehicle_id').eq('id', logId).maybeSingle();
  if (error) throw error;
  if (!log) throw new HttpError(404, 'Service record not found');
  const { data, error: insErr } = await supabase
    .from('vehicle_service_items')
    .insert(items.map(i => ({
      service_log_id: logId, vehicle_id: log.vehicle_id, description: i.description, kind: i.kind,
      quantity: i.quantity, unit_cost: i.unit_cost, total_cost: itemTotal(i),
    })))
    .select(ITEM_COLUMNS);
  if (insErr) throw insErr;
  const { cost } = await refreshRecordCost(logId);
  return { items: (data ?? []) as ServiceItemRow[], cost };
}

export async function deleteServiceItem(itemId: string) {
  const { data, error } = await supabase.from('vehicle_service_items').delete().eq('id', itemId).select('id, service_log_id').maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Item not found');
  const { cost } = await refreshRecordCost(data.service_log_id);
  return { service_log_id: data.service_log_id as string, cost };
}
