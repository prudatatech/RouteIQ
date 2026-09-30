/**
 * margixindia — Finance routes (staff): invoices, expenses, fuel price and profit and loss.
 */
import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { manifestParcelCode } from '../core/parcelCode';
import { settings } from '../core/config';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { HttpError, sendError } from '../core/errors';
import { resolveIndianDateRange, indianDateKey } from '../core/istDate';
import { InvoiceService } from '../services/invoice.service';
import { auditService } from '../services/audit.service';
import { rateLimitByUser } from '../core/rate-limit';
import { TPL_UPLOAD_CONTENT_TYPES } from '../services/tpl.service';
import {
  EXPENSE_CATEGORIES, ExpenseCategory, getFinanceSettings, getFinanceSummary, getUnpricedDeliveries, selectIn, setFuelPrice,
} from '../services/finance.service';

const router = Router();
// Money is for admin and superadmin; managers run operations only
router.use(requireAuth, requireRole('admin'));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const rangeFrom = (req: Request) => resolveIndianDateRange(req.query.from, req.query.to, 30);

// ── GET /summary — profit and loss for the range ───────────
router.get('/summary', async (req: Request, res: Response) => {
  try {
    res.json(await getFinanceSummary(rangeFrom(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── GET /unpriced — delivered with no invoice ──────────────
router.get('/unpriced', async (req: Request, res: Response) => {
  try {
    res.json(await getUnpricedDeliveries(rangeFrom(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Invoices ───────────────────────────────────────────────
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const { start, end } = rangeFrom(req);
    let query = supabase
      .from('invoices')
      .select('id, invoice_number, shipment_id, manifest_id, vendor_id, amount, gst_rate, gst_amount, total, status, issued_at, paid_at, price_source')
      .gte('issued_at', start.toISOString())
      .lt('issued_at', end.toISOString())
      .order('issued_at', { ascending: false });
    const status = req.query.status;
    if (typeof status === 'string' && ['issued', 'paid', 'void'].includes(status)) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to list invoices: ${error.message}`);
    const rows = data ?? [];

    const [shipments, manifests, vendors] = await Promise.all([
      selectIn<{ id: string; tracking_id: string }>('shipments', 'id', rows.map((r: any) => r.shipment_id), 'id, tracking_id'),
      selectIn<{ id: string }>('cargo_manifest', 'id', rows.map((r: any) => r.manifest_id), 'id'),
      selectIn<{ id: string; company_name: string }>('vendor_profiles', 'id', rows.map((r: any) => r.vendor_id), 'id, company_name'),
    ]);
    const tracking = new Map(shipments.map(s => [s.id, s.tracking_id]));
    const manifestIds = new Set(manifests.map(m => m.id));
    const companies = new Map(vendors.map(v => [v.id, v.company_name]));

    res.json(rows.map((r: any) => ({
      ...r,
      reference: r.shipment_id ? (tracking.get(r.shipment_id) ?? null) : (manifestIds.has(r.manifest_id) ? manifestParcelCode(String(r.manifest_id)) : null),
      vendor_name: r.vendor_id ? (companies.get(r.vendor_id) ?? null) : null,
    })));
  } catch (e) {
    sendError(req, res, e);
  }
});

/** Creates the invoice for a delivery that has a price but was delivered before invoicing existed. */
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const { shipment_id: shipmentId, manifest_id: manifestId } = req.body ?? {};
    if ((typeof shipmentId === 'string') === (typeof manifestId === 'string')) {
      throw new HttpError(400, 'Give either a shipment or a manifest');
    }
    const { data: delivered } = typeof shipmentId === 'string'
      ? await supabase.from('shipments').select('status').eq('id', shipmentId).maybeSingle()
      : await supabase.from('cargo_manifest').select('status').eq('id', manifestId).maybeSingle();
    if (!delivered) throw new HttpError(404, 'Delivery not found');
    if (delivered.status !== 'delivered') throw new HttpError(409, 'Only delivered shipments can be invoiced');

    const result = typeof shipmentId === 'string'
      ? await InvoiceService.createForShipment(shipmentId)
      : await InvoiceService.createForManifest(manifestId);
    if (result.status === 'unpriced' || result.status === 'skipped') {
      throw new HttpError(422, 'This delivery has no price on record, so there is nothing to invoice');
    }
    res.status(result.status === 'created' ? 201 : 200).json(result);
  } catch (e) {
    sendError(req, res, e);
  }
});

async function moveInvoice(req: Request, res: Response, to: 'paid' | 'void') {
  try {
    const patch = to === 'paid'
      ? { status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : { status: 'void', voided_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    // Paid needs an issued invoice; void needs one that is not paid yet
    const { data, error } = await supabase
      .from('invoices')
      .update(patch)
      .eq('id', req.params.id)
      .eq('status', 'issued')
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`Failed to update invoice: ${error.message}`);
    if (!data) {
      const { data: existing } = await supabase.from('invoices').select('status').eq('id', req.params.id).maybeSingle();
      if (!existing) throw new HttpError(404, 'Invoice not found');
      throw new HttpError(409, `Invoice is already ${existing.status}`);
    }
    await auditService.record('staff-console', req.user!, `invoice_${to}`, { invoice_id: data.id, invoice_number: data.invoice_number ?? null, total: data.total ?? null });
    res.json(data);
  } catch (e) {
    sendError(req, res, e);
  }
}
router.put('/invoices/:id/pay', (req, res) => moveInvoice(req, res, 'paid'));
router.put('/invoices/:id/void', (req, res) => moveInvoice(req, res, 'void'));

// ── Expenses ───────────────────────────────────────────────
interface ExpenseInput {
  vehicle_id: string | null;
  route_id: string | null;
  category: ExpenseCategory;
  amount: number;
  expense_date: string;
  litres: number | null;
  note: string | null;
  receipt_path: string | null;
}

async function parseExpense(body: any, partial: boolean): Promise<Partial<ExpenseInput>> {
  const out: Partial<ExpenseInput> = {};
  const has = (k: string) => body && body[k] !== undefined;

  if (!partial || has('category')) {
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(body?.category)) throw new HttpError(400, 'Choose a category: fuel, maintenance, toll, driver or other');
    out.category = body.category;
  }
  if (!partial || has('amount')) {
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e10) throw new HttpError(400, 'Enter an amount greater than zero');
    out.amount = Math.round(amount * 100) / 100;
  }
  if (!partial || has('expense_date')) {
    if (!validDate(body?.expense_date)) throw new HttpError(400, 'Enter the date of the expense');
    if (body.expense_date > indianDateKey(new Date())) throw new HttpError(400, 'The expense date cannot be in the future');
    out.expense_date = body.expense_date;
  }
  if (has('litres')) {
    if (body.litres === null || body.litres === '') out.litres = null;
    else {
      const litres = Number(body.litres);
      if (!Number.isFinite(litres) || litres <= 0) throw new HttpError(400, 'Litres must be greater than zero');
      out.litres = Math.round(litres * 100) / 100;
    }
  }
  if (has('note')) {
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > 500) throw new HttpError(400, 'The note can be at most 500 characters');
    out.note = note || null;
  }
  if (has('receipt_path')) {
    if (body.receipt_path === null || body.receipt_path === '') out.receipt_path = null;
    else if (typeof body.receipt_path === 'string' && /^expenses\/[\w-]+\/[\w.-]+$/.test(body.receipt_path)) out.receipt_path = body.receipt_path;
    else throw new HttpError(400, 'Receipt was not uploaded correctly. Upload it again.');
  }
  for (const [key, table, label] of [['vehicle_id', 'vehicles', 'Vehicle'], ['route_id', 'routes', 'Route']] as const) {
    if (!has(key)) continue;
    const id = body[key];
    if (id === null || id === '') { out[key] = null; continue; }
    if (typeof id !== 'string') throw new HttpError(400, `${label} is not valid`);
    const { data } = await supabase.from(table).select('id').eq('id', id).maybeSingle();
    if (!data) throw new HttpError(400, `${label} not found`);
    out[key] = id;
  }
  return out;
}

router.get('/expenses', async (req: Request, res: Response) => {
  try {
    const { start, end } = rangeFrom(req);
    const fromKey = indianDateKey(start);
    const toKey = indianDateKey(new Date(end.getTime() - 1));
    let query = supabase
      .from('expenses')
      .select('id, vehicle_id, route_id, category, amount, expense_date, litres, note, receipt_path, created_at')
      .gte('expense_date', fromKey)
      .lte('expense_date', toKey)
      .order('expense_date', { ascending: false });
    if (typeof req.query.category === 'string' && (EXPENSE_CATEGORIES as readonly string[]).includes(req.query.category)) {
      query = query.eq('category', req.query.category);
    }
    if (typeof req.query.vehicle_id === 'string' && req.query.vehicle_id) query = query.eq('vehicle_id', req.query.vehicle_id);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to list expenses: ${error.message}`);
    const rows = data ?? [];
    const vehicles = await selectIn<{ id: string; plate_number: string }>('vehicles', 'id', rows.map((r: any) => r.vehicle_id), 'id, plate_number');
    const plates = new Map(vehicles.map(v => [v.id, v.plate_number]));
    res.json(rows.map((r: any) => ({ ...r, plate_number: r.vehicle_id ? (plates.get(r.vehicle_id) ?? null) : null })));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/expenses', async (req: Request, res: Response) => {
  try {
    const input = await parseExpense(req.body, false);
    const { data, error } = await supabase
      .from('expenses')
      .insert({ vehicle_id: null, route_id: null, litres: null, note: null, receipt_path: null, ...input, created_by: req.user!.user_id })
      .select('*')
      .single();
    if (error || !data) throw new Error(`Failed to save expense: ${error?.message}`);
    res.status(201).json(data);
  } catch (e) {
    sendError(req, res, e);
  }
});

// Signed upload URL for an optional receipt (private bucket, expenses/ folder)
router.post('/expenses/receipt-upload', rateLimitByUser('expense-receipt-upload', 60, 60 * 60), async (req: Request, res: Response) => {
  try {
    const extension = typeof req.body?.content_type === 'string' ? TPL_UPLOAD_CONTENT_TYPES[req.body.content_type.toLowerCase()] : undefined;
    if (!extension) throw new HttpError(415, 'Upload a PDF, JPG or PNG file');
    const bytes = Number(req.body?.size);
    if (!Number.isInteger(bytes) || bytes <= 0) throw new HttpError(400, 'File size is required');
    if (bytes > settings.EXPENSE_RECEIPT_MAX_BYTES) {
      throw new HttpError(413, `Receipt must be at most ${Math.floor(settings.EXPENSE_RECEIPT_MAX_BYTES / 1024 / 1024)} MB`);
    }
    const path = `expenses/${crypto.randomUUID()}/receipt_${crypto.randomUUID()}.${extension}`;
    const { data, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Failed to create upload URL: ${error?.message}`);
    res.json({ path: data.path, token: data.token, signed_url: data.signedUrl, bucket: settings.KYC_DOCUMENTS_BUCKET });
  } catch (e) {
    sendError(req, res, e);
  }
});

router.put('/expenses/:id', async (req: Request, res: Response) => {
  try {
    const input = await parseExpense(req.body, true);
    if (!Object.keys(input).length) throw new HttpError(400, 'Nothing to update');
    const { data, error } = await supabase
      .from('expenses')
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`Failed to update expense: ${error.message}`);
    if (!data) throw new HttpError(404, 'Expense not found');
    res.json(data);
  } catch (e) {
    sendError(req, res, e);
  }
});

router.delete('/expenses/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('expenses').delete().eq('id', req.params.id).select('id, receipt_path').maybeSingle();
    if (error) throw new Error(`Failed to delete expense: ${error.message}`);
    if (!data) throw new HttpError(404, 'Expense not found');
    await auditService.record('staff-console', req.user!, 'expense_deleted', { expense_id: data.id });
    if (data.receipt_path) {
      // Best effort: the row is gone either way
      await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).remove([data.receipt_path]).catch(() => undefined);
    }
    res.status(204).end();
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/expenses/:id/receipt-url', async (req: Request, res: Response) => {
  try {
    const { data } = await supabase.from('expenses').select('receipt_path').eq('id', req.params.id).maybeSingle();
    if (!data?.receipt_path) throw new HttpError(404, 'This expense has no receipt');
    const { data: signed, error } = await supabase.storage.from(settings.KYC_DOCUMENTS_BUCKET).createSignedUrl(data.receipt_path, 600);
    if (error || !signed) throw new Error(`Failed to create receipt link: ${error?.message}`);
    res.json({ url: signed.signedUrl });
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── Settings: fuel price (editable) and rate per km (read only here) ──
router.get('/settings', async (req: Request, res: Response) => {
  try {
    res.json(await getFinanceSettings());
  } catch (e) {
    sendError(req, res, e);
  }
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const price = Number(req.body?.fuel_price_per_litre);
    if (!Number.isFinite(price) || price <= 0 || price > 1000) throw new HttpError(400, 'Enter a fuel price per litre between ₹0 and ₹1,000');
    const before = await getFinanceSettings();
    await setFuelPrice(Math.round(price * 100) / 100);
    await auditService.record('staff-console', req.user!, 'fuel_price_changed', { from: before.fuel_price_per_litre, to: Math.round(price * 100) / 100 });
    res.json(await getFinanceSettings());
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
