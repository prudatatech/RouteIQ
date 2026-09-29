/**
 * margixindia — Invoices
 *
 * One invoice is written when a shipment or a cargo manifest is delivered,
 * using a price that already exists in the data:
 *   - shipment: the accepted bid on it (shipments.bid_id -> capacity_bids.bid_amount),
 *     or, when there is no winning bid, the freight charge staff entered on it
 *   - cargo manifest: the agreed cost of the vendor request it carries out
 *     (cargo_manifest.vendor_request_id -> vendor_shipment_requests.cost), or, when only a
 *     rate per km was agreed, that rate times the trip's road distance; GST is the rate the
 *     vendor entered on the request
 * With no price no invoice is written; the delivery shows up under "unpriced
 * deliveries" in Finance instead. Money is rupees; the amount is before GST.
 */
import { supabase } from '../core/supabase';
import { haversineKm, isValidPoint, ROAD_FACTOR } from './geo';

const round2 = (n: number) => Math.round(n * 100) / 100;
const PRICE_SOURCE_BID = 'bid';
const PRICE_SOURCE_FREIGHT = 'freight_charge';
const PRICE_SOURCE_REQUEST = 'vendor_request';
const PRICE_SOURCE_RATE = 'vendor_rate_per_km';

export interface InvoiceResult {
  status: 'created' | 'exists' | 'unpriced' | 'skipped';
  invoiceId?: string;
}

/** GST rate for a shipment from its HSN lines: the single rate, or the highest when goods differ. */
async function shipmentGstRate(shipmentId: string): Promise<number> {
  const { data, error } = await supabase.from('shipment_hsn').select('gst_rate').eq('shipment_id', shipmentId);
  if (error) throw new Error(`Failed to read GST lines: ${error.message}`);
  const rates = (data ?? []).map((r: any) => Number(r.gst_rate)).filter(r => Number.isFinite(r) && r > 0);
  return rates.length ? Math.max(...rates) : 0;
}

/** Next INV-YYYYMM-#### number for the current IST month. */
async function nextInvoiceNumber(now: Date): Promise<string> {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  const prefix = `INV-${ist.getUTCFullYear()}${String(ist.getUTCMonth() + 1).padStart(2, '0')}-`;
  const { data, error } = await supabase.from('invoices').select('invoice_number').like('invoice_number', `${prefix}%`);
  if (error) throw new Error(`Failed to read invoice numbers: ${error.message}`);
  let max = 0;
  for (const row of data ?? []) {
    const num = String(row.invoice_number ?? '');
    if (!num.startsWith(prefix)) continue;
    const seq = Number(num.slice(prefix.length));
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

interface NewInvoice {
  shipment_id?: string;
  manifest_id?: string;
  vendor_id: string | null;
  amount: number;
  gst_rate: number;
  price_source: string;
}

/** Inserts the invoice, retrying with a fresh number if two deliveries raced for the same one. */
async function insertInvoice(input: NewInvoice): Promise<string> {
  const amount = round2(input.amount);
  const gstAmount = round2((amount * input.gst_rate) / 100);
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = new Date();
    const { data, error } = await supabase
      .from('invoices')
      .insert({
        ...input,
        invoice_number: await nextInvoiceNumber(now),
        amount,
        gst_amount: gstAmount,
        total: round2(amount + gstAmount),
        currency: 'INR',
        status: 'issued',
        issued_at: now.toISOString(),
      })
      .select('id')
      .single();
    if (!error && data) return data.id;
    // 23505: unique violation. Either the number was taken (retry) or the delivery already has an invoice.
    if (error?.code !== '23505') throw new Error(`Failed to create invoice: ${error?.message}`);
    const column = input.shipment_id ? 'shipment_id' : 'manifest_id';
    const { data: existing } = await supabase.from('invoices').select('id').eq(column, input[column]!).neq('status', 'void').maybeSingle();
    if (existing) return existing.id;
  }
  throw new Error('Failed to create invoice: could not get a free invoice number');
}

export const InvoiceService = {
  /** Invoice for a delivered shipment, priced from its accepted bid. Safe to call twice. */
  async createForShipment(shipmentId: string): Promise<InvoiceResult> {
    const { data: existing } = await supabase.from('invoices').select('id').eq('shipment_id', shipmentId).neq('status', 'void').maybeSingle();
    if (existing) return { status: 'exists', invoiceId: existing.id };

    const { data: shipment, error } = await supabase.from('shipments').select('id, bid_id, freight_charge').eq('id', shipmentId).maybeSingle();
    if (error) throw new Error(`Failed to read shipment: ${error.message}`);
    if (!shipment) return { status: 'skipped' };

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
      gst_rate: await shipmentGstRate(shipmentId),
      price_source: priceSource,
    });
    return { status: 'created', invoiceId };
  },

  /** Invoice for a delivered vendor-load manifest, priced from the request's agreed cost. Safe to call twice. */
  async createForManifest(manifestId: string): Promise<InvoiceResult> {
    const { data: existing } = await supabase.from('invoices').select('id').eq('manifest_id', manifestId).neq('status', 'void').maybeSingle();
    if (existing) return { status: 'exists', invoiceId: existing.id };

    const { data: manifest, error } = await supabase
      .from('cargo_manifest')
      .select('id, vendor_request_id, pickup_lat, pickup_lng, drop_lat, drop_lng')
      .eq('id', manifestId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read manifest: ${error.message}`);
    // A manifest made from a won bid is invoiced through its shipment, not here
    if (!manifest || !manifest.vendor_request_id) return { status: 'skipped' };

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

    // The GST rate the vendor entered with the cargo details
    const enteredGst = Number(request.metadata?.cargo?.gstRate);
    const gstRate = Number.isFinite(enteredGst) && enteredGst > 0 && enteredGst <= 100 ? enteredGst : 0;

    const invoiceId = await insertInvoice({
      manifest_id: manifestId,
      vendor_id: request.vendor_id ?? null,
      amount,
      gst_rate: gstRate,
      price_source: priceSource,
    });
    return { status: 'created', invoiceId };
  },

  /**
   * Same as createForShipment, for delivery paths: a billing problem is logged
   * and never fails the delivery. The invoice can be missed but not the POD.
   */
  async onShipmentDelivered(shipmentId: string): Promise<void> {
    try {
      await InvoiceService.createForShipment(shipmentId);
    } catch (e) {
      console.error(`[invoice] shipment ${shipmentId}:`, e);
    }
  },

  async onManifestDelivered(manifestId: string): Promise<void> {
    try {
      await InvoiceService.createForManifest(manifestId);
    } catch (e) {
      console.error(`[invoice] manifest ${manifestId}:`, e);
    }
  },
};
