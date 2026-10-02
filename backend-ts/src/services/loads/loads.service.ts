/**
 * margixindia — Load posting (docs/load-posting-design.md section 2).
 *
 * A posted load is a vendor_shipment_requests row plus its load_items, written together by the create_vendor_load RPC.
 * Everything the client sends about money, weight, tax and e-way need is recomputed here through assessLoad.
 */
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { supabase } from '../../core/supabase';
import { HttpError } from '../../core/errors';
import { GST_STATES, fromPaise, taxLines, toPaise } from '../../core/gst';
import { STAFF_ROLES } from '../../core/ownership';
import type { OrgSummary } from '../../core/org-context';
import { roadKm } from '../../utils/eta';
import { notificationService } from '../notification.service';
import { emailService, escapeHtml } from '../email.service';
import { sendLoadPosted } from '../whatsapp.service';
import { loadVehicleClasses } from '../goods/master';
import { HOLD_UNVERIFIED, assertChosenCompanies, loadVisibleToAnyCompany, notifyCompanies, quoteDeadline } from './order-routing';
import { assessLoad, type LoadAssessment } from './assess';
import { csvLine, parseCsv } from './csv';
import { LoadDraftSchema, MAX_BULK_ROWS, type LoadDraftInput } from '../../schemas/loads';

/** The same client_request_id inside this window returns the first load. */
export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
/** Marks a load whose vendor organisation is not active yet: it stays out of the companies' queue until it is. */
export { HOLD_UNVERIFIED };
export const HOLD_NOTE = 'Business verification pending. Your load is saved and goes to logistic companies once your business is verified.';

export const OPEN_NOTE = 'It is open to logistic companies serving this lane. We will notify you when one accepts.';

export interface Caller {
  userId: string;
  role: string;
  /** The vendor organisation the caller acts for (null before organisations are set up). */
  vendorOrg: OrgSummary | null;
  orgIds: string[];
  /** The active logistic companies the caller works for. */
  companyIds: string[];
  isPlatformAdmin: boolean;
  /** True when the caller has no organisation at all (organisations not set up): staff then see every load, as before. */
  noOrgs: boolean;
}

/** The caller's organisation facts, taken from what requireAuth attached to the request. */
export function callerOf(req: Request): Caller {
  const memberships = req.memberships ?? [];
  const vendorOrg = req.org?.kind === 'vendor' ? req.org : (memberships.find(m => m.org.kind === 'vendor')?.org ?? null);
  return {
    userId: req.user!.user_id,
    role: req.user!.role,
    vendorOrg,
    orgIds: memberships.map(m => m.org.id),
    companyIds: memberships.filter(m => m.org.kind === 'logistic_company' && m.org.status === 'active').map(m => m.org.id),
    isPlatformAdmin: !!req.isPlatformAdmin,
    noOrgs: !req.org && memberships.length === 0,
  };
}

const num = (v: unknown) => (v == null ? null : Number(v));

// ── Reading ─────────────────────────────────────────────────

async function itemsOf(loadId: string) {
  const { data, error } = await supabase.from('load_items').select('*').eq('load_id', loadId).order('line_no', { ascending: true });
  if (error) throw new Error(`Failed to read load items: ${error.message}`);
  return data ?? [];
}

/**
 * Whether the caller may see this load, by the same rule as the database function app.can_see_load: its vendor
 * organisation, the company it was awarded to (or the carrier of its manifest), a company's staff while it is open to
 * their company (chosen, or open to all; pending, not held, vendor organisation active), or a platform admin.
 */
export async function canSeeLoad(c: Caller, row: Record<string, any>): Promise<boolean> {
  if (c.isPlatformAdmin) return true;
  if (row.vendor_id === c.userId) return true;
  if (row.vendor_org_id && c.orgIds.includes(row.vendor_org_id)) return true;
  // The company the load was awarded to sees it before it has a vehicle; staff of a company it is routed to see it too
  if (row.carrier_org_id && c.orgIds.includes(row.carrier_org_id)) return true;
  if (['superadmin', ...STAFF_ROLES].includes(c.role as any) && (await loadVisibleToAnyCompany(row, c.companyIds))) return true;
  if (c.orgIds.length) {
    const { data, error } = await supabase.from('cargo_manifest').select('id, carrier_org_id').eq('vendor_request_id', row.id);
    if (error) throw new Error(`Failed to check load access: ${error.message}`);
    if ((data ?? []).some((m: any) => m.carrier_org_id && c.orgIds.includes(m.carrier_org_id))) return true;
  }
  // Before organisations are set up, staff work every load, as they always did
  return c.noOrgs && STAFF_ROLES.includes(c.role as any);
}

/** One posted load with its items; a 404 when it does not exist or the caller may not see it. */
export async function getPostedLoad(c: Caller, id: string): Promise<{ load: Record<string, any>; items: any[] } | null> {
  const { data: row, error } = await supabase.from('vendor_shipment_requests').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read load: ${error.message}`);
  if (!row) return null;
  if (!(await canSeeLoad(c, row))) throw new HttpError(404, 'Load not found');
  return { load: row, items: await itemsOf(id) };
}

export async function listMyLoads(c: Caller, page: number, pageSize: number, status?: string) {
  const from = (page - 1) * pageSize;
  let q = supabase.from('vendor_shipment_requests')
    .select('id, load_number, status, pickup_city, delivery_city, pickup_location, drop_location, pickup_date, vehicle_class, load_type, total_weight_kg, required_capacity_kg, total_declared_value, cost, eway_required, source, created_at', { count: 'exact' });
  q = c.vendorOrg ? q.or(`vendor_org_id.eq.${c.vendorOrg.id},vendor_id.eq.${c.userId}`) : q.eq('vendor_id', c.userId);
  if (status) q = q.eq('status', status);
  const { data, error, count } = await q.order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw new Error(`Failed to list loads: ${error.message}`);
  return { items: data ?? [], total: count ?? (data ?? []).length, page, page_size: pageSize };
}

// ── Creating ────────────────────────────────────────────────

/** The line that stands for the load on older screens: the largest declared value, ties broken by weight. */
export function primaryItem<T extends { declared_value: number; weight_kg: number }>(items: T[]): T {
  return items.reduce((best, i) => (i.declared_value > best.declared_value || (i.declared_value === best.declared_value && i.weight_kg > best.weight_kg) ? i : best));
}

const validState = (code: string | null | undefined) => (code && GST_STATES[code] ? code : null);

/**
 * The vendor can reach companies: their organisation is active AND their KYC is approved. A vendor whose approved profile
 * was sent back to review (new name, GSTIN, address or documents) keeps an active organisation (nothing reverses it) but
 * is not verified until it is approved again, so a load posted meanwhile is held. Without organisations (not set up) the
 * KYC alone decides.
 */
async function vendorVerified(c: Caller): Promise<boolean> {
  const { data, error } = await supabase.from('vendor_profiles').select('kyc_status').eq('id', c.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (c.vendorOrg) return c.vendorOrg.status === 'active' && (!data || data.kyc_status === 'approved');
  return data?.kyc_status === 'approved';
}

export interface CreateOptions {
  source?: 'web' | 'app' | 'bulk' | 'api' | 'repost';
  bulkBatchId?: string;
  /** Skip the per-load WhatsApp, email and notification (a bulk upload sends one summary instead). */
  quiet?: boolean;
}

export interface CreatedLoad {
  load: Record<string, any>;
  items: any[];
  assessment: LoadAssessment;
  duplicate: boolean;
  /** Set when the load waits for the vendor's business verification. */
  status_note: string | null;
}

/** Finds the load an earlier request with the same client_request_id made in the last 10 minutes. */
async function findDuplicate(c: Caller, clientRequestId: string) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const { data, error } = await supabase.from('vendor_shipment_requests').select('*')
    .eq('vendor_id', c.userId).eq('client_request_id', clientRequestId).gte('created_at', since)
    .order('created_at', { ascending: true }).limit(1);
  if (error) throw new Error(`Failed to check for a repeat: ${error.message}`);
  return (data ?? [])[0] ?? null;
}

export async function createLoad(c: Caller, input: LoadDraftInput, opts: CreateOptions = {}): Promise<CreatedLoad> {
  const crid = input.client_request_id ?? randomUUID();
  if (input.client_request_id) {
    const first = await findDuplicate(c, input.client_request_id);
    if (first) {
      return { load: first, items: await itemsOf(first.id), assessment: await assessLoad(input), duplicate: true, status_note: first.metadata?.hold === HOLD_UNVERIFIED ? HOLD_NOTE : null };
    }
  }

  // Who may quote: chosen companies (checked), or every company serving the lane. Naming companies without a routing means chosen.
  const routing = input.routing ?? (input.company_ids.length > 0 ? 'chosen' : 'open');
  const companyIds = routing === 'chosen' ? [...new Set(input.company_ids)] : [];
  if (routing === 'chosen') await assertChosenCompanies(companyIds);

  // Never trust the client's totals, tax or e-way flag: work them out again
  const assessment = await assessLoad(input);
  const verified = await vendorVerified(c);
  const primary = primaryItem(input.items);
  const pickup = { lat: input.pickup_lat, lng: input.pickup_lng };
  const drop = { lat: input.delivery_lat, lng: input.delivery_lng };
  const km = roadKm(pickup, drop) ?? 0;

  const load = {
    vendor_id: c.userId,
    vendor_org_id: c.vendorOrg?.id ?? null,
    pickup_location: [input.pickup_address, input.pickup_city].filter(Boolean).join(', '),
    pickup_lat: input.pickup_lat,
    pickup_lng: input.pickup_lng,
    drop_location: [input.delivery_address, input.delivery_city].filter(Boolean).join(', '),
    drop_lat: input.delivery_lat,
    drop_lng: input.delivery_lng,
    required_capacity_kg: assessment.totals.weight_kg,
    // Older screens read metadata.cargo, so it carries the primary product
    metadata: {
      cargo: {
        name: primary.product_name,
        category: primary.category ?? primary.product_name,
        hsn: primary.hsn_code,
        gstRate: primary.gst_rate,
        quantity: primary.quantity,
        unit: primary.unit,
        grossWeightKg: assessment.totals.weight_kg,
        declaredValue: assessment.totals.declared_value,
        specialHandling: Object.fromEntries(input.special_handling.map(h => [h, true])),
      },
      ...(input.temp_mode ? { temp_mode: input.temp_mode } : {}),
      transporter: 'MargixIndia',
      consignor_id: c.userId,
      routing: { estimated_distance_km: Math.round(km) },
      ...(verified ? {} : { hold: HOLD_UNVERIFIED }),
    },
    load_type: input.load_type ?? assessment.suggested.load_type,
    vehicle_class: input.vehicle_class ?? null,
    capacity_t: input.capacity_t ?? assessment.suggested.capacity_t,
    temp_min_c: input.temp_min_c ?? null,
    temp_max_c: input.temp_max_c ?? null,
    special_handling: input.special_handling,
    budget_inr: input.budget_inr ?? null,
    quote_requested: input.quote_requested,
    loading_help: input.loading_help,
    unloading_help: input.unloading_help,
    pickup_city: input.pickup_city,
    pickup_address: input.pickup_address,
    pickup_pincode: input.pickup_pincode,
    pickup_state_code: validState(assessment.tax.pickup_state_code) ?? validState(input.pickup_state_code),
    pickup_date: input.pickup_date,
    pickup_slot: input.pickup_slot ?? null,
    pickup_contact_name: input.pickup_contact_name,
    pickup_contact_phone: input.pickup_contact_phone,
    delivery_city: input.delivery_city,
    delivery_address: input.delivery_address,
    delivery_pincode: input.delivery_pincode,
    delivery_state_code: validState(assessment.tax.delivery_state_code) ?? validState(input.delivery_state_code),
    delivery_date: input.delivery_date ?? null,
    delivery_contact_name: input.delivery_contact_name,
    delivery_contact_phone: input.delivery_contact_phone,
    loading_dock: input.loading_dock ?? null,
    access_restrictions: input.access_restrictions,
    total_weight_kg: assessment.totals.weight_kg,
    total_declared_value: assessment.totals.declared_value,
    tax_basis: assessment.tax.basis,
    eway_required: assessment.eway.required,
    hazmat_mixed: assessment.hazmat_mixed,
    company_ids: companyIds,
    routing,
    // The quote clock starts when the load reaches the companies: now, or when the vendor is verified
    quote_deadline: verified ? quoteDeadline(input.quote_requested) : null,
    source: opts.source ?? input.source ?? 'web',
    client_request_id: crid,
    bulk_batch_id: opts.bulkBatchId ?? null,
    reposted_from: input.reposted_from ?? null,
  };
  const items = input.items.map(i => ({
    product_name: i.product_name, hsn_code: i.hsn_code, gst_rate: i.gst_rate, quantity: i.quantity, unit: i.unit,
    weight_kg: i.weight_kg, declared_value: i.declared_value, handling: i.handling, category: i.category,
    is_hazmat: i.is_hazmat, is_perishable: i.is_perishable,
  }));

  const { data, error } = await supabase.rpc('create_vendor_load', { p: { load, items } });
  if (error) throw new Error(`Failed to post the load: ${error.message}`);
  if (!data || typeof data !== 'object' || !(data as any).id) throw new Error('Failed to post the load: no load came back');
  const { duplicate, ...row } = data as Record<string, any>;
  const note = row.metadata?.hold === HOLD_UNVERIFIED ? HOLD_NOTE : null;

  if (!duplicate && !opts.quiet) await announceLoad(c, row, verified);
  return { load: row, items: await itemsOf(row.id), assessment, duplicate: !!duplicate, status_note: note };
}

const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'to be confirmed';

/**
 * Tells the vendor (in-app, WhatsApp, email) and, when the vendor is verified, the staff. None of it can fail the post:
 * the load is already saved.
 */
async function announceLoad(c: Caller, row: Record<string, any>, verified: boolean): Promise<void> {
  const route = `${row.pickup_city ?? shortPlace(row.pickup_location)} → ${row.delivery_city ?? shortPlace(row.drop_location)}`;
  const tasks: Array<Promise<unknown>> = [
    notificationService.sendNotification(
      c.userId, 'Load posted', `Load ${row.load_number} (${route}) was posted.${' ' + (verified ? OPEN_NOTE : HOLD_NOTE)}`,
      'load_posted', { request_id: row.id, load_number: row.load_number },
    ),
  ];
  // Only the matching companies hear about it (never every staff member), and never a held load
  if (verified) tasks.push(notifyCompanies(row));
  tasks.push((async () => {
    const { data: user } = await supabase.from('users').select('phone, email').eq('id', c.userId).maybeSingle();
    const vehicle = await vehicleLabel(row.vehicle_class);
    const sent = await sendLoadPosted(user?.phone, {
      loadNumber: row.load_number, route, pickupDate: shortDate(row.pickup_date), vehicle, totalWeightKg: Number(row.total_weight_kg ?? 0), held: !verified,
    });
    // Email is the fallback when WhatsApp did not go out; a placeholder login address is not a mailbox
    const email = user?.email && !/\.margixindia\.local$/.test(user.email) ? user.email : null;
    if (!sent && email) {
      await emailService.send(email, `Load ${row.load_number} posted`,
        `<p>Your load <b>${escapeHtml(row.load_number)}</b> was posted.</p><p>From and to: ${escapeHtml(route)}<br>Pickup: ${escapeHtml(shortDate(row.pickup_date))}<br>Vehicle: ${escapeHtml(vehicle)}<br>Total weight: ${Math.round(Number(row.total_weight_kg ?? 0)).toLocaleString('en-IN')} kg</p><p>${escapeHtml(verified ? OPEN_NOTE : HOLD_NOTE)}</p>`);
    }
  })());
  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === 'rejected') console.error('[loads] notification failed:', r.reason);
}

/** The vehicle as a person reads it ("Container (32 ft / SXL)"), not the key; the key itself when the class is not in the table. */
async function vehicleLabel(key: string | null | undefined): Promise<string> {
  if (!key) return 'To be matched';
  try {
    return (await loadVehicleClasses()).find(c => c.key === key)?.name ?? key;
  } catch {
    return key;
  }
}

const shortPlace = (p: string | null | undefined) => (p ?? '').split(',')[0].trim() || 'pickup';

/** Loads held for business verification go to the matching companies once the vendor is verified; the quote clock starts then. */
export async function releaseHeldLoads(vendorId: string): Promise<number> {
  const { data, error } = await supabase.from('vendor_shipment_requests').select('*')
    .eq('vendor_id', vendorId).eq('status', 'pending');
  if (error) throw new Error(error.message);
  const held = (data ?? []).filter((r: any) => r.metadata?.hold === HOLD_UNVERIFIED);
  for (const r of held) {
    const { hold: _hold, ...metadata } = r.metadata;
    const deadline = quoteDeadline(!!r.quote_requested);
    const { error: upErr } = await supabase.from('vendor_shipment_requests').update({ metadata, quote_deadline: deadline }).eq('id', r.id);
    if (upErr) throw new Error(upErr.message);
    try {
      await notifyCompanies({ ...r, metadata, quote_deadline: deadline });
    } catch (e) {
      console.error('[loads] announcing a released load failed:', e);
    }
  }
  return held.length;
}

// ── Repost ──────────────────────────────────────────────────

/** The load as a draft for the form: same details, dates cleared, a new request id left to the client. Creates nothing. */
export async function repostDraft(c: Caller, id: string) {
  const found = await getPostedLoad(c, id);
  if (!found) throw new HttpError(404, 'Load not found');
  const { load: l, items } = found;
  return {
    source: 'repost' as const,
    reposted_from: l.id as string,
    client_request_id: null,
    items: items.map(i => ({
      product_name: i.product_name, hsn_code: i.hsn_code, gst_rate: num(i.gst_rate), quantity: num(i.quantity), unit: i.unit,
      weight_kg: num(i.weight_kg), declared_value: num(i.declared_value), handling: i.handling ?? [], category: i.category ?? null,
      is_hazmat: !!i.is_hazmat, is_perishable: !!i.is_perishable,
    })),
    pickup_city: l.pickup_city, pickup_address: l.pickup_address, pickup_pincode: l.pickup_pincode, pickup_state_code: l.pickup_state_code,
    pickup_lat: num(l.pickup_lat), pickup_lng: num(l.pickup_lng), pickup_date: null, pickup_slot: l.pickup_slot,
    pickup_contact_name: l.pickup_contact_name, pickup_contact_phone: l.pickup_contact_phone,
    delivery_city: l.delivery_city, delivery_address: l.delivery_address, delivery_pincode: l.delivery_pincode, delivery_state_code: l.delivery_state_code,
    delivery_lat: num(l.drop_lat), delivery_lng: num(l.drop_lng), delivery_date: null,
    delivery_contact_name: l.delivery_contact_name, delivery_contact_phone: l.delivery_contact_phone,
    loading_dock: l.loading_dock, access_restrictions: l.access_restrictions,
    load_type: l.load_type, vehicle_class: l.vehicle_class, capacity_t: num(l.capacity_t),
    temp_mode: l.metadata?.temp_mode ?? null, temp_min_c: num(l.temp_min_c), temp_max_c: num(l.temp_max_c), special_handling: l.special_handling ?? [],
    budget_inr: num(l.budget_inr), quote_requested: !!l.quote_requested, loading_help: !!l.loading_help, unloading_help: !!l.unloading_help,
    routing: l.routing ?? 'open', company_ids: l.company_ids ?? [],
  };
}

// ── Bulk upload ─────────────────────────────────────────────

/** Template columns, in order. One row is one load with one product. */
export const BULK_COLUMNS = [
  'product_name', 'hsn_code', 'gst_rate', 'quantity', 'unit', 'weight_kg', 'declared_value',
  'pickup_city', 'pickup_address', 'pickup_pincode', 'pickup_lat', 'pickup_lng', 'pickup_date', 'pickup_slot', 'pickup_contact_name', 'pickup_contact_phone',
  'delivery_city', 'delivery_address', 'delivery_pincode', 'delivery_lat', 'delivery_lng', 'delivery_date', 'delivery_contact_name', 'delivery_contact_phone',
  'load_type', 'vehicle_class', 'budget_inr',
] as const;

const REQUIRED_COLUMNS = [
  'product_name', 'hsn_code', 'gst_rate', 'quantity', 'unit', 'weight_kg', 'declared_value',
  'pickup_city', 'pickup_address', 'pickup_pincode', 'pickup_lat', 'pickup_lng', 'pickup_date',
  'delivery_city', 'delivery_address', 'delivery_pincode', 'delivery_lat', 'delivery_lng',
];
const NUMERIC = new Set(['gst_rate', 'quantity', 'weight_kg', 'declared_value', 'pickup_lat', 'pickup_lng', 'delivery_lat', 'delivery_lng', 'budget_inr']);
const ITEM_COLUMNS = ['product_name', 'hsn_code', 'gst_rate', 'quantity', 'unit', 'weight_kg', 'declared_value'];

export function bulkTemplateCsv(): string {
  const example = ['Cement bags', '2523', '18', '400', 'bags', '20000', '150000', 'Mumbai', 'Plot 4 MIDC Andheri', '400093', '19.1197', '72.8464', '2026-12-01', 'morning', 'Ravi', '+919800000000',
    'Delhi', 'Warehouse 2 Okhla', '110020', '28.5355', '77.2750', '2026-12-04', 'Asha', '+919800000001', 'ftl', '32ft_sxl', ''];
  return [csvLine([...BULK_COLUMNS]), csvLine(example)].join('\r\n') + '\r\n';
}

/** One CSV row (cells by column name) as a load draft, ready for the schema. */
export function rowToDraft(cells: Record<string, string>) {
  const val = (k: string) => {
    const v = (cells[k] ?? '').trim();
    if (v === '') return undefined;
    if (NUMERIC.has(k)) { const n = Number(v); return Number.isFinite(n) ? n : v; }
    return v;
  };
  const draft: Record<string, unknown> = { source: 'bulk', client_request_id: randomUUID(), special_handling: [], company_ids: [] };
  for (const k of BULK_COLUMNS) if (!ITEM_COLUMNS.includes(k)) { const v = val(k); if (v !== undefined) draft[k] = v; }
  const item: Record<string, unknown> = {};
  for (const k of ITEM_COLUMNS) { const v = val(k); if (v !== undefined) item[k] = v; }
  draft.items = [item];
  return draft;
}

export interface BulkRowError { row: number; message: string }

/** Validates the bulk file row by row; nothing is written. `row` counts data rows from 1 (the header is not a row). */
export function validateBulk(csv: string): { drafts: Array<{ row: number; draft: LoadDraftInput }>; errors: BulkRowError[]; rowCount: number } {
  const table = parseCsv(csv);
  if (table.length === 0) throw new HttpError(400, 'The file is empty');
  const header = table[0].map(h => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter(col => !header.includes(col));
  if (missing.length) throw new HttpError(400, `The file is missing these columns: ${missing.join(', ')}. Download the template and use its header row.`);
  const rows = table.slice(1);
  if (rows.length === 0) throw new HttpError(400, 'The file has no loads');
  if (rows.length > MAX_BULK_ROWS) throw new HttpError(400, `A file can have at most ${MAX_BULK_ROWS} loads (this one has ${rows.length})`);

  const drafts: Array<{ row: number; draft: LoadDraftInput }> = [];
  const errors: BulkRowError[] = [];
  rows.forEach((cells, idx) => {
    const byName: Record<string, string> = {};
    header.forEach((h, i) => { byName[h] = cells[i] ?? ''; });
    const parsed = LoadDraftSchema.safeParse(rowToDraft(byName));
    if (parsed.success) drafts.push({ row: idx + 1, draft: parsed.data });
    else {
      const issue = parsed.error.issues[0];
      const field = issue.path.length ? String(issue.path[issue.path.length - 1]) : '';
      errors.push({ row: idx + 1, message: field && !issue.message.toLowerCase().includes(field.replace(/_/g, ' ')) ? `${field}: ${issue.message}` : issue.message });
    }
  });
  return { drafts, errors, rowCount: rows.length };
}

/** Posts the valid rows as separate loads and records the batch. Returns the report. */
export async function runBulk(c: Caller, fileName: string | null, csv: string) {
  const { drafts, errors, rowCount } = validateBulk(csv);
  const { data: batch, error: batchErr } = await supabase.from('load_bulk_batches').insert({
    vendor_org_id: c.vendorOrg?.id ?? null, file_name: fileName, row_count: rowCount, status: 'processing', created_by: c.userId,
  }).select('*').single();
  if (batchErr || !batch) throw new Error(`Failed to start the batch: ${batchErr?.message ?? 'no row'}`);

  const loads: Array<{ row: number; id: string; load_number: string }> = [];
  for (const { row, draft } of drafts) {
    try {
      const made = await createLoad(c, draft, { source: 'bulk', bulkBatchId: batch.id, quiet: true });
      loads.push({ row, id: made.load.id, load_number: made.load.load_number });
    } catch (e) {
      console.error('[loads] bulk row failed:', e);
      errors.push({ row, message: 'This load could not be saved. Try it again.' });
    }
  }
  errors.sort((a, b) => a.row - b.row);

  const { data: done } = await supabase.from('load_bulk_batches')
    .update({ ok_count: loads.length, error_count: errors.length, errors, status: 'done' }).eq('id', batch.id).select('*').single();
  if (loads.length) {
    notificationService.sendNotification(c.userId, 'Bulk upload finished',
      `${loads.length} of ${rowCount} loads were posted${errors.length ? `, ${errors.length} had errors` : ''}.`, 'load_posted', { batch_id: batch.id })
      .catch(e => console.error('[loads] bulk notification failed:', e));
  }
  return { batch: done ?? { ...batch, ok_count: loads.length, error_count: errors.length, errors }, loads, errors };
}

// ── When a load becomes a manifest ──────────────────────────

/**
 * Copies a load's items to shipment_hsn against its manifest (with the taxable value, CGST, SGST and IGST), so the
 * invoice can show the real goods lines. A load without items (an older request) copies nothing. Never throws: the
 * manifest is already made, and a missed copy is logged.
 */
export async function copyItemsToManifest(load: Record<string, any>, manifestId: string): Promise<void> {
  try {
    const items = await itemsOf(load.id);
    if (!items.length) return;
    const basis = load.tax_basis === 'intra' || load.tax_basis === 'inter' ? load.tax_basis : 'unknown';
    const rows = items.map((i: any) => {
      const t = taxLines(toPaise(Number(i.declared_value) || 0), Number(i.gst_rate) || 0, basis);
      return {
        manifest_id: manifestId, load_id: load.id, hsn_code: i.hsn_code ?? '', description: i.product_name, product_name: i.product_name,
        gst_rate: num(i.gst_rate), declared_value: num(i.declared_value), taxable_amount: fromPaise(t.taxable),
        cgst: fromPaise(t.cgst), sgst: fromPaise(t.sgst), igst: fromPaise(t.igst),
        quantity: num(i.quantity), unit: i.unit ?? null, weight_kg: num(i.weight_kg),
      };
    });
    const { error } = await supabase.from('shipment_hsn').insert(rows);
    if (error) console.error(`[loads] could not copy items of load ${load.id} to manifest ${manifestId}: ${error.message}`);
  } catch (e) {
    console.error(`[loads] could not copy items of load ${load.id} to manifest ${manifestId}:`, e);
  }
}
