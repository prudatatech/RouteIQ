/**
 * margixindia — Invoices
 *
 * One invoice is written when a shipment or a cargo manifest is delivered,
 * using a price that already exists in the data:
 *   - shipment: the accepted bid on it (shipments.bid_id -> capacity_bids.bid_amount),
 *     or, when there is no winning bid, the freight charge staff entered on it
 *   - cargo manifest: the agreed cost of the vendor request it carries out
 *     (cargo_manifest.vendor_request_id -> vendor_shipment_requests.cost), or, when only a
 *     rate per km was agreed, that rate times the trip's road distance
 *   - a lot of a split consignment (docs/cargo-plan.md, Lots): its freight_share, the part of the
 *     master's price that falls to it; a master is billed only for the part it kept (its own
 *     freight_share, the pieces delivered before the split), so the master's price is never
 *     billed twice
 * A shipment or lot that settles as partially_delivered (nothing left on a vehicle or at a hub) is
 * invoiced too, for its price or freight_share; the short and refused pieces are written on the
 * invoice's notes so a claim can offset it. One that still holds pieces waits until it settles.
 * Freight GST follows the issuing company's GTA option (gta_gst_option: reverse charge 5%, so none on the invoice, or
 * 5% / 18% forward charge), stored on the invoice as tax_mode. The goods' own rate is never used for the freight.
 * Every invoice is issued with a due date: the payment terms in the issuing company's Settings, 15 days by default.
 * Numbers are the issuing company's own: its prefix and its own sequence per month (nextInvoiceNumber).
 * No invoice is issued until the issuing company's profile has a name, GSTIN and state (409): the seller must be
 * on it. Delivery is never held up by this; the delivery waits under "To price" until Settings is filled in.
 * Every invoice stores who it is billed to (`bill_to`, see invoice-recipient.service.ts) and its GST in
 * integer paise: one rounding step per tax line, total = taxable value + tax lines exactly (core/gst.ts).
 * With no price no invoice is written; the delivery shows up under "unpriced
 * deliveries" in Finance instead. Money is rupees; the amount is before GST.
 */
import { supabase } from '../core/supabase';
import { haversineKm, isValidPoint, ROAD_FACTOR } from './geo';
import { formatINR } from '../core/format';
import { notificationService } from './notification.service';
import { bookingCustomer, manifestRequest } from './cargo/notify';
import { assertCanIssueInvoices, invoicePrefixFor, sellerStateCode, COMPANY_PROFILE_INCOMPLETE } from './company.service';
import { resolveScope } from './company-settings.service';
import { HttpError } from '../core/errors';
import { fromPaise, gtaTerms, taxLines, toPaise, type TaxBasis } from '../core/gst';
import { resolveBillTo, snapshotOf } from './invoice-recipient.service';
import { issuerStamp, vendorOrgOf } from '../core/org-context';

const PRICE_SOURCE_BID = 'bid';
const PRICE_SOURCE_FREIGHT = 'freight_charge';
const PRICE_SOURCE_REQUEST = 'vendor_request';
const PRICE_SOURCE_RATE = 'vendor_rate_per_km';
/** A lot (or the part a master kept) is billed for its share of the consignment's freight. */
const PRICE_SOURCE_LOT = 'lot_freight_share';

export interface InvoiceResult {
  status: 'created' | 'exists' | 'unpriced' | 'skipped';
  invoiceId?: string;
}

/** The Indian calendar month an invoice number is counted in, as YYYYMM. */
const monthOf = (now: Date): string => {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return `${ist.getUTCFullYear()}${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** The highest number taken under `PREFIX-YYYYMM-`, read from the invoices themselves. */
async function highestIssued(prefix: string): Promise<number> {
  const { data, error } = await supabase.from('invoices').select('invoice_number').like('invoice_number', `${prefix}%`);
  if (error) throw new Error(`Failed to read invoice numbers: ${error.message}`);
  let max = 0;
  for (const row of data ?? []) {
    const num = String(row.invoice_number ?? '');
    if (!num.startsWith(prefix)) continue;
    const seq = Number(num.slice(prefix.length));
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return max;
}

/**
 * The next `PREFIX-YYYYMM-####` number for the issuing company: its own prefix (organizations.profile.invoice_prefix) and
 * its own sequence per month. The sequence comes from public.next_invoice_number(), one atomic upsert-increment of the
 * company's counter row, so two invoices issued at the same moment never get the same number.
 *
 * Without a company (organisations not set up yet) it is the old `INV-YYYYMM-####`, one sequence for everyone, found by
 * reading the invoices; the same reading stands in when the counter function does not exist yet (before the migration
 * ran), where the unique invoice_number plus the retry in insertInvoice keep numbers distinct.
 */
async function nextInvoiceNumber(issuerId: string | null, now: Date): Promise<string> {
  const period = monthOf(now);
  const prefix = issuerId ? await invoicePrefixFor(issuerId) : 'INV';
  const stem = `${prefix}-${period}-`;
  if (issuerId) {
    const { data, error } = await supabase.rpc('next_invoice_number', { p_org: issuerId, p_prefix: prefix, p_period: period });
    const seq = Number(data);
    if (!error && Number.isInteger(seq) && seq > 0) return `${stem}${String(seq).padStart(4, '0')}`;
    // Only "the function is not there" falls back; any other failure must not hand out a number
    if (error && !['PGRST202', '42883', '42P01'].includes(String(error.code))) throw new Error(`Failed to get an invoice number: ${error.message}`);
  }
  return `${stem}${String((await highestIssued(stem)) + 1).padStart(4, '0')}`;
}

/**
 * The company that issues an invoice: the one carrying the shipment or load (the invoice is theirs even when a
 * platform admin delivers it), else the company the request acts for, else the default company. Null before
 * the organisations migration has run.
 */
async function issuerOf(input: { shipment_id?: string; manifest_id?: string }): Promise<string | null> {
  const table = input.shipment_id ? 'shipments' : input.manifest_id ? 'cargo_manifest' : null;
  const id = input.shipment_id ?? input.manifest_id;
  if (table && id) {
    const { data } = await supabase.from(table).select('carrier_org_id').eq('id', id).maybeSingle();
    if (data?.carrier_org_id) return data.carrier_org_id as string;
  }
  return issuerStamp().issuer_org_id ?? (await resolveScope());
}

interface NewInvoice {
  shipment_id?: string;
  manifest_id?: string;
  vendor_request_id?: string;
  vendor_id: string | null;
  amount: number;
  price_source: string;
  /** Free text on the invoice, e.g. the pieces short or refused on a partial delivery. */
  notes?: string | null;
}

interface InvoiceRow {
  id: string;
  invoice_number?: string | null;
  shipment_id?: string | null;
  manifest_id?: string | null;
  vendor_request_id?: string | null;
  vendor_id?: string | null;
  total?: number | null;
  amount?: number | null;
}

/**
 * Who is told about an invoice, with the ids their app needs to open it: the customer whose booking
 * this shipment is (booking_id), and the vendor it is billed to (request_id for a load, bid_id for
 * space they won). A 3PL partner is not invoiced: they are paid for the order (tpl_order_paid).
 */
async function invoiceAudience(inv: InvoiceRow): Promise<Array<{ userId: string; ids: Record<string, string> }>> {
  const base: Record<string, string> = { invoice_id: inv.id };
  if (inv.shipment_id) base.shipment_id = inv.shipment_id;
  if (inv.manifest_id) base.manifest_id = inv.manifest_id;
  const out: Array<{ userId: string; ids: Record<string, string> }> = [];

  if (inv.shipment_id) {
    const customer = await bookingCustomer(inv.shipment_id);
    if (customer) out.push({ userId: customer.customer_id, ids: { ...base, booking_id: customer.booking_id } });
  }
  if (inv.vendor_id) {
    const ids: Record<string, string> = { ...base };
    let requestId = inv.vendor_request_id ?? null;
    if (!requestId && inv.manifest_id) requestId = (await manifestRequest(inv.manifest_id))?.request_id ?? null;
    if (requestId) ids.request_id = requestId;
    if (inv.shipment_id) {
      const { data: shipment } = await supabase.from('shipments').select('bid_id').eq('id', inv.shipment_id).maybeSingle();
      if (shipment?.bid_id) ids.bid_id = shipment.bid_id;
    }
    out.push({ userId: inv.vendor_id, ids });
  }
  return out;
}

/** Tells the requester an invoice was issued or paid. Once per invoice and event; never fails the caller. */
export async function announceInvoice(invoiceId: string, event: 'issued' | 'paid'): Promise<void> {
  try {
    const { data: inv } = await supabase
      .from('invoices').select('id, invoice_number, shipment_id, manifest_id, vendor_request_id, vendor_id, total, amount').eq('id', invoiceId).maybeSingle();
    if (!inv) return;
    const label = inv.invoice_number ?? 'Your invoice';
    const money = formatINR(inv.total ?? inv.amount);
    const [title, body, type] = event === 'issued'
      ? [`Invoice ${label} issued`, `${label} is ready${money ? `: ${money}` : ''}. You can view and download it.`, 'invoice_issued']
      : [`Invoice ${label} paid`, `We received your payment${money ? ` of ${money}` : ''} for ${label}. Thank you.`, 'invoice_paid'];
    for (const { userId, ids } of await invoiceAudience(inv as InvoiceRow)) {
      await notificationService.sendNotificationOnce(userId, title, body, type, { ...ids, invoice_number: inv.invoice_number ?? null }, 'invoice_id', 24 * 365);
    }
  } catch (e) {
    console.error(`[invoice] could not notify about invoice ${invoiceId} (${event}):`, e);
  }
}

/** Inserts the invoice, retrying with a fresh number if two deliveries raced for the same one. */
async function insertInvoice(input: NewInvoice): Promise<string> {
  // The seller is the company issuing it: its GSTIN and state decide the GST split, its bank and terms are on the invoice
  const issuerId = await issuerOf(input);
  const company = await assertCanIssueInvoices(issuerId);
  const billTo = await resolveBillTo(input).catch(() => null);
  const sellerState = sellerStateCode(company);
  const buyerState = billTo?.state_code ?? null;
  // Freight is taxed at the transporter's rate (the company's GTA option), never at the rate of the goods it carries
  const taxMode = company.gta_gst_option;
  const gstRate = gtaTerms(taxMode).rate;
  const basis: TaxBasis = !(gstRate > 0) ? 'none' : sellerState && buyerState ? (sellerState === buyerState ? 'intra' : 'inter') : 'unknown';
  const lines = taxLines(toPaise(input.amount), gstRate, basis);
  const amount = fromPaise(lines.taxable);
  const gstAmount = fromPaise(lines.tax);
  const termsDays = company.payment_terms_days;
  const snapshot = billTo ? snapshotOf(billTo) : null;
  const { notes, ...fields } = input;
  // The issuing company, and the vendor organisation it bills when the invoice is for a vendor
  const billToOrg = (await vendorOrgOf(input.vendor_id)).vendor_org_id;
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = new Date();
    const { data, error } = await supabase
      .from('invoices')
      .insert({
        ...(issuerId ? { issuer_org_id: issuerId } : {}),
        ...(billToOrg ? { bill_to_org_id: billToOrg } : {}),
        ...fields,
        gst_rate: gstRate,
        tax_mode: taxMode,
        ...(notes ? { notes } : {}),
        invoice_number: await nextInvoiceNumber(issuerId, now),
        amount,
        gst_amount: gstAmount,
        total: fromPaise(lines.total),
        ...(snapshot ? { bill_to: snapshot } : {}),
        currency: 'INR',
        status: 'issued',
        issued_at: now.toISOString(),
        due_date: new Date(now.getTime() + termsDays * 86_400_000).toISOString(),
      })
      .select('id')
      .single();
    if (!error && data) {
      await announceInvoice(data.id, 'issued');
      return data.id;
    }
    // 23505: unique violation. Either the number was taken (retry) or the delivery already has an invoice.
    if (error?.code !== '23505') throw new Error(`Failed to create invoice: ${error?.message}`);
    const column = input.shipment_id ? 'shipment_id' : input.manifest_id ? 'manifest_id' : 'vendor_request_id';
    const { data: existing } = await supabase.from('invoices').select('id').eq(column, input[column]!).neq('status', 'void').maybeSingle();
    if (existing) return existing.id;
  }
  throw new Error('Failed to create invoice: could not get a free invoice number');
}

/** What a partial delivery left unbilled, in words for the invoice notes. Null when nothing was short or refused. */
export function partialDeliveryNote(row: { pieces_total?: unknown; pieces_delivered?: unknown; pieces_short?: unknown; pieces_returned?: unknown }): string | null {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const short = n(row.pieces_short);
  const refused = n(row.pieces_returned);
  const delivered = n(row.pieces_delivered);
  const total = row.pieces_total == null ? delivered + short + refused : n(row.pieces_total);
  const parts = [`${delivered} of ${total} pieces delivered`];
  if (short > 0) parts.push(`${short} short`);
  if (refused > 0) parts.push(`${refused} refused or returned`);
  return `Partial delivery: ${parts.join(', ')}. A claim for the missing pieces can offset this invoice.`;
}

/** A delivery whose invoice could not be issued: an incomplete company profile is expected, anything else is logged as an error. */
function logIssueFailure(what: string, e: unknown): void {
  if (e instanceof HttpError && e.extra?.code === COMPANY_PROFILE_INCOMPLETE) {
    console.warn(`[invoice] ${what} not invoiced yet: ${e.message}`);
    return;
  }
  console.error(`[invoice] ${what}:`, e);
}

export const InvoiceService = {
  /**
   * Invoice for a delivered shipment (or one that settled as partially_delivered), priced from its
   * accepted bid, freight charge or lot share. Safe to call twice: a shipment is never invoiced twice.
   */
  async createForShipment(shipmentId: string): Promise<InvoiceResult> {
    const { data: existing } = await supabase.from('invoices').select('id').eq('shipment_id', shipmentId).neq('status', 'void').maybeSingle();
    if (existing) return { status: 'exists', invoiceId: existing.id };

    const { data: shipment, error } = await supabase
      .from('shipments').select('id, status, bid_id, freight_charge, is_master, parent_shipment_id, freight_share, pieces_total, pieces_delivered, pieces_short, pieces_returned').eq('id', shipmentId).maybeSingle();
    if (error) throw new Error(`Failed to read shipment: ${error.message}`);
    if (!shipment) return { status: 'skipped' };

    // A partial delivery is billed once nothing of it is left on a vehicle, at a hub, returning or held
    let notes: string | null = null;
    if (shipment.status === 'partially_delivered') {
      const { consignmentSettled } = await import('./cargo/lots.service');
      if (!(await consignmentSettled('shipment', shipmentId))) return { status: 'skipped' };
      notes = partialDeliveryNote(shipment);
    }

    // Lots and masters: the share of the freight that is theirs, and the vendor of the master's won bid
    if (shipment.is_master || shipment.parent_shipment_id) {
      const share = Number(shipment.freight_share ?? (shipment.parent_shipment_id ? shipment.freight_charge : 0));
      if (!Number.isFinite(share) || share <= 0) return { status: shipment.is_master ? 'skipped' : 'unpriced' };
      let lotVendor: string | null = null;
      const masterId = shipment.parent_shipment_id ?? shipment.id;
      const { data: master } = await supabase.from('shipments').select('bid_id').eq('id', masterId).maybeSingle();
      if (master?.bid_id) {
        const { data: bid } = await supabase.from('capacity_bids').select('vendor_id, status').eq('id', master.bid_id).maybeSingle();
        if (bid?.status === 'won') lotVendor = bid.vendor_id ?? null;
      }
      const lotInvoice = await insertInvoice({
        shipment_id: shipmentId,
        vendor_id: lotVendor,
        amount: share,
        price_source: PRICE_SOURCE_LOT,
        notes,
      });
      return { status: 'created', invoiceId: lotInvoice };
    }

    // A won bid sets the price; without one, the freight charge entered on the shipment does
    let vendorId: string | null = null;
    let amount = NaN;
    let priceSource = PRICE_SOURCE_BID;
    if (shipment.bid_id) {
      const { data: bid, error: bidErr } = await supabase
        .from('capacity_bids')
        .select('id, vendor_id, bid_amount, status')
        .eq('id', shipment.bid_id)
        .maybeSingle();
      if (bidErr) throw new Error(`Failed to read bid: ${bidErr.message}`);
      if (bid && bid.status === 'won') {
        amount = Number(bid.bid_amount);
        vendorId = bid.vendor_id ?? null;
      }
    }
    if (!(amount > 0)) {
      amount = Number(shipment.freight_charge);
      vendorId = null;
      priceSource = PRICE_SOURCE_FREIGHT;
    }
    if (!Number.isFinite(amount) || amount <= 0) return { status: 'unpriced' };

    const invoiceId = await insertInvoice({
      shipment_id: shipmentId,
      vendor_id: vendorId,
      amount,
      price_source: priceSource,
      notes,
    });
    return { status: 'created', invoiceId };
  },

  /** Invoice for a delivered vendor-load manifest, priced from the request's agreed cost. Safe to call twice. */
  async createForManifest(manifestId: string): Promise<InvoiceResult> {
    const { data: existing } = await supabase.from('invoices').select('id').eq('manifest_id', manifestId).neq('status', 'void').maybeSingle();
    if (existing) return { status: 'exists', invoiceId: existing.id };

    const { data: manifest, error } = await supabase
      .from('cargo_manifest')
      .select('id, vendor_request_id, pickup_lat, pickup_lng, drop_lat, drop_lng, is_master, parent_manifest_id, freight_share')
      .eq('id', manifestId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read manifest: ${error.message}`);
    // A manifest made from a won bid is invoiced through its shipment, not here
    if (!manifest || !manifest.vendor_request_id) return { status: 'skipped' };

    // A load lot is billed for its freight share; a master only for the part it kept
    if (manifest.is_master || manifest.parent_manifest_id) {
      const share = Number(manifest.freight_share ?? 0);
      if (!Number.isFinite(share) || share <= 0) return { status: manifest.is_master ? 'skipped' : 'unpriced' };
      const { data: req } = await supabase.from('vendor_shipment_requests').select('vendor_id, metadata').eq('id', manifest.vendor_request_id).maybeSingle();
      const lotInvoice = await insertInvoice({
        manifest_id: manifestId,
        vendor_id: req?.vendor_id ?? null,
        amount: share,
        price_source: PRICE_SOURCE_LOT,
      });
      return { status: 'created', invoiceId: lotInvoice };
    }

    const { data: request, error: reqErr } = await supabase
      .from('vendor_shipment_requests')
      .select('id, vendor_id, cost, cost_per_km, metadata')
      .eq('id', manifest.vendor_request_id)
      .maybeSingle();
    if (reqErr) throw new Error(`Failed to read vendor request: ${reqErr.message}`);
    if (!request) return { status: 'unpriced' };

    // An agreed cost wins; with only a rate per km, the price is that rate over the trip's road distance
    let amount = Number(request.cost);
    let priceSource = PRICE_SOURCE_REQUEST;
    if (!Number.isFinite(amount) || amount <= 0) {
      const rate = Number(request.cost_per_km);
      const from = { lat: Number(manifest.pickup_lat), lng: Number(manifest.pickup_lng) };
      const to = { lat: Number(manifest.drop_lat), lng: Number(manifest.drop_lng) };
      if (!(rate > 0) || !isValidPoint(from) || !isValidPoint(to)) return { status: 'unpriced' };
      amount = rate * Math.round(haversineKm(from, to) * ROAD_FACTOR);
      priceSource = PRICE_SOURCE_RATE;
    }
    if (!Number.isFinite(amount) || amount <= 0) return { status: 'unpriced' };

    const invoiceId = await insertInvoice({
      manifest_id: manifestId,
      vendor_id: request.vendor_id ?? null,
      amount,
      price_source: priceSource,
    });
    return { status: 'created', invoiceId };
  },

  /**
   * Invoice for a vendor load a 3PL partner delivered (there is no cargo manifest for it), priced from
   * the request's agreed cost: the price staff agreed with the vendor, not what the partner charges.
   * Without a price no invoice is written. Safe to call twice.
   */
  async createForRequest(requestId: string): Promise<InvoiceResult> {
    const { data: existing } = await supabase.from('invoices').select('id').eq('vendor_request_id', requestId).neq('status', 'void').maybeSingle();
    if (existing) return { status: 'exists', invoiceId: existing.id };

    const { data: request, error } = await supabase
      .from('vendor_shipment_requests').select('id, vendor_id, cost, status').eq('id', requestId).maybeSingle();
    if (error) throw new Error(`Failed to read vendor request: ${error.message}`);
    if (!request) return { status: 'skipped' };
    const amount = Number(request.cost);
    if (!Number.isFinite(amount) || amount <= 0) return { status: 'unpriced' };

    const invoiceId = await insertInvoice({
      vendor_request_id: requestId,
      vendor_id: request.vendor_id ?? null,
      amount,
      price_source: PRICE_SOURCE_REQUEST,
    });
    return { status: 'created', invoiceId };
  },

  /**
   * Same as createForShipment, for delivery paths: a billing problem is logged
   * and never fails the delivery. The invoice can be missed but not the POD.
   */
  async onShipmentDelivered(shipmentId: string): Promise<void> {
    // Also called for a shipment that settled as partially_delivered (see createForShipment)
    try {
      await InvoiceService.createForShipment(shipmentId);
    } catch (e) {
      logIssueFailure(`shipment ${shipmentId}`, e);
    }
  },

  async onRequestDelivered(requestId: string): Promise<void> {
    try {
      await InvoiceService.createForRequest(requestId);
    } catch (e) {
      logIssueFailure(`request ${requestId}`, e);
    }
  },

  async onManifestDelivered(manifestId: string): Promise<void> {
    try {
      await InvoiceService.createForManifest(manifestId);
    } catch (e) {
      logIssueFailure(`load ${manifestId}`, e);
    }
  },
};
