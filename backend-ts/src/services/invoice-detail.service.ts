/**
 * margixindia — One invoice, complete: the document (seller, buyer, lines, GST split, total in words)
 * and what it links to (shipment, requester, trip). Built only from records that exist: the invoice
 * row, the company profile staff entered in Settings, the vendor or customer, and the shipment's
 * own HSN lines. Anything not on record comes back null (or listed in `seller_gaps`), never guessed.
 *
 * Read by staff (`GET /invoices/:id`), and rendered to PDF for staff and for the invoice's owner
 * (`GET /invoices/:id/pdf`, see invoice-pdf.service.ts).
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { isStaff } from '../core/ownership';
import type { TokenData } from '../core/auth';
import { indianDateKey } from '../core/istDate';
import { rupeesInWords } from '../core/words';
import { finalDeliveryPoint } from '../core/destination';
import { getCompanyProfile, companyGaps, type CompanyProfile } from './company.service';
import { bookingCustomer, manifestRequest } from './cargo/notify';
import { shipmentOverview } from './shipment-overview.service';

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 86_400_000;

/** GST state codes (the first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

export interface InvoiceRecord {
  id: string;
  invoice_number: string | null;
  shipment_id: string | null;
  manifest_id: string | null;
  vendor_request_id: string | null;
  vendor_id: string | null;
  amount: number | null;
  gst_rate: number | null;
  gst_amount: number | null;
  total: number | null;
  status: string;
  issued_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  voided_at: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  void_reason: string | null;
  price_source: string | null;
}

export const INVOICE_COLUMNS =
  'id, invoice_number, shipment_id, manifest_id, vendor_request_id, vendor_id, amount, gst_rate, gst_amount, total, status, issued_at, due_date, paid_at, voided_at, payment_method, payment_reference, void_reason, price_source';

/**
 * The due date shown for an invoice: the one saved on issue, or (for invoices issued before due dates
 * existed) the issue date plus the payment terms in Settings.
 */
export function effectiveDueDate(inv: Pick<InvoiceRecord, 'due_date' | 'issued_at'>, termsDays: number): string | null {
  if (inv.due_date) return inv.due_date;
  if (!inv.issued_at) return null;
  const issued = Date.parse(inv.issued_at);
  return Number.isFinite(issued) ? new Date(issued + termsDays * DAY_MS).toISOString() : null;
}

/** An issued invoice is overdue once its due day (an India calendar day) is over. */
export function overdueDays(inv: Pick<InvoiceRecord, 'status'>, dueDate: string | null, now = new Date()): number {
  if (inv.status !== 'issued' || !dueDate) return 0;
  const due = Date.parse(indianDateKey(new Date(dueDate)));
  const today = Date.parse(indianDateKey(now));
  return today > due ? Math.round((today - due) / DAY_MS) : 0;
}

export interface InvoiceParty {
  kind: 'vendor' | 'customer' | 'unknown';
  id: string | null;
  name: string | null;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  state_code: string | null;
  state: string | null;
}

export interface InvoiceTax {
  /** `intra`: CGST and SGST. `inter`: IGST. `unknown`: the states are not both on record. */
  basis: 'intra' | 'inter' | 'unknown' | 'none';
  rate: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  note: string | null;
}

export interface InvoiceDetail extends InvoiceRecord {
  due_date: string | null;
  overdue: boolean;
  days_overdue: number;
  payment_terms_days: number;
  seller: CompanyProfile & { state_code: string | null; state_name: string | null };
  seller_gaps: string[];
  buyer: InvoiceParty;
  lines: Array<{ description: string; sac_code: string | null; quantity: number; unit_price: number; amount: number }>;
  goods: Array<{ hsn_code: string | null; description: string | null; gst_rate: number | null }>;
  tax: InvoiceTax;
  total_in_words: string;
  links: {
    /** The consignment the page /shipments/:id opens: a shipment, a vendor load or a vendor request. */
    shipment: { id: string; code: string } | null;
    manifest_id: string | null;
    request_id: string | null;
    requester: { kind: string; id: string | null; name: string | null } | null;
    trip: { id: string; status: string } | null;
  };
}

/** The state a GSTIN was issued in, from its first two digits. */
const stateOf = (gstin: string | null) => {
  const code = gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
  return { code, name: code ? (GST_STATES[code] ?? null) : null };
};

export function computeTax(amount: number, rate: number, gstAmount: number, sellerState: string | null, buyerState: string | null): InvoiceTax {
  if (!(rate > 0) || !(gstAmount > 0)) return { basis: 'none', rate: 0, cgst: 0, sgst: 0, igst: 0, total: 0, note: null };
  if (sellerState && buyerState) {
    if (sellerState === buyerState) {
      const cgst = round2(gstAmount / 2);
      return { basis: 'intra', rate, cgst, sgst: round2(gstAmount - cgst), igst: 0, total: gstAmount, note: null };
    }
    return { basis: 'inter', rate, cgst: 0, sgst: 0, igst: gstAmount, total: gstAmount, note: null };
  }
  return {
    basis: 'unknown', rate, cgst: 0, sgst: 0, igst: 0, total: gstAmount,
    note: !sellerState
      ? 'The company GSTIN is not set in Settings, so the tax is shown as one GST amount.'
      : 'The buyer has no GSTIN on record, so the place of supply is not known and the tax is shown as one GST amount.',
  };
}

async function buyerOf(inv: InvoiceRecord): Promise<InvoiceParty> {
  const unknown: InvoiceParty = { kind: 'unknown', id: null, name: null, gstin: null, address: null, phone: null, email: null, state_code: null, state: null };

  if (inv.vendor_id) {
    const [{ data: profile }, { data: user }] = await Promise.all([
      supabase.from('vendor_profiles').select('id, company_name, gst_number, address, city').eq('id', inv.vendor_id).maybeSingle(),
      supabase.from('users').select('email, phone').eq('id', inv.vendor_id).maybeSingle(),
    ]);
    const gstin = profile?.gst_number ? String(profile.gst_number).trim().toUpperCase() : null;
    const { code, name } = stateOf(gstin);
    return {
      kind: 'vendor', id: inv.vendor_id, name: profile?.company_name ?? null, gstin,
      address: [profile?.address, profile?.city].filter(Boolean).join(', ') || null,
      phone: user?.phone ?? null, email: user?.email ?? null, state_code: code, state: name,
    };
  }

  if (inv.shipment_id) {
    const owner = await bookingCustomer(inv.shipment_id);
    if (owner) {
      const { data: customer } = await supabase.from('customers').select('id, full_name, company_name, phone').eq('id', owner.customer_id).maybeSingle();
      return {
        ...unknown, kind: 'customer', id: owner.customer_id, name: customer?.company_name || customer?.full_name || null,
        phone: customer?.phone ?? null,
      };
    }
  }
  return unknown;
}

/** The customer, or vendor, that may open this invoice (never anyone else). */
export async function invoiceOwnerId(inv: Pick<InvoiceRecord, 'shipment_id' | 'manifest_id' | 'vendor_id' | 'vendor_request_id'>): Promise<string | null> {
  if (inv.vendor_id) return inv.vendor_id;
  if (inv.shipment_id) return (await bookingCustomer(inv.shipment_id))?.customer_id ?? null;
  if (inv.manifest_id) return (await manifestRequest(inv.manifest_id))?.vendor_id ?? null;
  return null;
}

/**
 * Loads an invoice a user may open: admin and superadmin any; a vendor or customer only their own.
 * Anyone else gets the same 404 as a missing invoice, so ids cannot be probed.
 */
export async function loadInvoiceFor(id: string, user: TokenData): Promise<InvoiceRecord> {
  const { data, error } = await supabase.from('invoices').select(INVOICE_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read invoice: ${error.message}`);
  if (!data) throw new HttpError(404, 'Invoice not found');
  const inv = data as InvoiceRecord;

  const finance = user.role === 'superadmin' || user.role === 'admin';
  if (finance) return inv;
  if (isStaff(user)) throw new HttpError(403, 'Invoices are for admins');
  if ((user.role === 'vendor' || user.role === 'customer') && (await invoiceOwnerId(inv)) === user.user_id) return inv;
  throw new HttpError(404, 'Invoice not found');
}

export async function buildInvoiceDetail(inv: InvoiceRecord): Promise<InvoiceDetail> {
  const company = await getCompanyProfile();
  const sellerState = stateOf(company.gstin);
  const buyer = await buyerOf(inv);

  const ref = inv.shipment_id ?? inv.manifest_id ?? inv.vendor_request_id;
  let overview: Awaited<ReturnType<typeof shipmentOverview>> | null = null;
  if (ref) {
    try {
      overview = await shipmentOverview(ref);
    } catch (e) {
      // A deleted or unreadable shipment must not hide the invoice itself
      if (!(e instanceof HttpError) || e.status !== 404) console.error(`[invoice] overview for ${inv.id}:`, e);
    }
  }

  const row = overview?.shipment ?? null;
  const drop = row ? finalDeliveryPoint<{ created_at?: string | null; name?: string | null; address?: string | null }>(row.delivery_points) : null;
  const origin: string | null = row?.origin_name ?? row?.origin_address ?? null;
  const dropName: string | null = drop?.name ?? drop?.address ?? null;
  const route = origin && dropName ? `${origin} to ${dropName}` : (origin ?? dropName);
  const code = overview?.code ?? null;
  const description = ['Freight (road transport of goods)', code ? `consignment ${code}` : null, route].filter(Boolean).join(', ');

  let goods: InvoiceDetail['goods'] = [];
  if (inv.shipment_id) {
    const masterId = row?.parent_shipment_id ?? inv.shipment_id;
    const { data: hsn } = await supabase.from('shipment_hsn').select('hsn_code, description, gst_rate').eq('shipment_id', masterId);
    goods = (hsn ?? []).map((h: any) => ({ hsn_code: h.hsn_code ?? null, description: h.description ?? null, gst_rate: h.gst_rate != null ? Number(h.gst_rate) : null }));
  }

  const amount = Number(inv.amount ?? 0);
  const gstAmount = Number(inv.gst_amount ?? 0);
  const total = Number(inv.total ?? amount + gstAmount);
  const dueDate = effectiveDueDate(inv, company.payment_terms_days);
  const late = overdueDays(inv, dueDate);
  const tax = computeTax(amount, Number(inv.gst_rate ?? 0), gstAmount, sellerState.code, buyer.state_code);

  return {
    ...inv,
    amount, gst_rate: Number(inv.gst_rate ?? 0), gst_amount: gstAmount, total,
    due_date: dueDate,
    overdue: late > 0,
    days_overdue: late,
    payment_terms_days: company.payment_terms_days,
    seller: { ...company, state_code: sellerState.code, state_name: sellerState.name },
    seller_gaps: companyGaps(company),
    buyer,
    lines: [{ description, sac_code: company.sac_code, quantity: 1, unit_price: amount, amount }],
    goods,
    tax,
    total_in_words: rupeesInWords(total),
    links: {
      shipment: ref && overview ? { id: ref, code: overview.code } : null,
      manifest_id: inv.manifest_id,
      request_id: inv.vendor_request_id ?? (overview?.requester.kind === 'vendor_load' ? overview.requester.id : null),
      requester: overview ? { kind: overview.requester.kind, id: overview.requester.id, name: overview.requester.name } : null,
      trip: overview?.trip ? { id: overview.trip.id, status: overview.trip.status } : null,
    },
  };
}
