/**
 * margixindia — Who an invoice is billed to.
 *
 * A GST tax invoice names its recipient, so every invoice stores the billed party (`invoices.bill_to`)
 * the moment it is issued: name, GSTIN, address and state, as they were then. The recipient is, in this order:
 *   1. the vendor the invoice is billed to (their profile), found from the invoice itself, from the
 *      vendor request behind a load, or from the request a manifest carries out;
 *   2. the customer whose booking became the shipment (a lot counts through its master);
 *   3. the consignee written on the shipment or lot (name, GSTIN, drop address), for a shipment staff
 *      created without a vendor or a customer booking. A lot of a split shipment has its own consignee,
 *      so each lot's invoice is billed to the party that lot goes to.
 * Nothing is invented: a field that is not on record stays null, and a shipment with none of the
 * three has no recipient (kind `unknown`).
 *
 * Invoices issued before `bill_to` existed are shown with the same lookup done live (`resolveBillTo`),
 * so history is not rewritten.
 */
import { supabase } from '../core/supabase';
import { GST_STATES, stateCodeByName, stateOf } from '../core/gst';
import { customerDisplayName } from '../core/customer-name';
import { finalDeliveryPoint } from '../core/destination';
import { bookingCustomer, manifestRequest } from './cargo/notify';
import type { InvoiceParty } from './invoice-detail.service';

export interface RecipientRef {
  shipment_id?: string | null;
  manifest_id?: string | null;
  vendor_id?: string | null;
  vendor_request_id?: string | null;
}

export const UNKNOWN_PARTY: InvoiceParty = {
  kind: 'unknown', id: null, name: null, gstin: null, address: null, phone: null, email: null, state_code: null, state: null,
};

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const gstinOf = (v: unknown): string | null => {
  const g = clean(v)?.replace(/\s+/g, '').toUpperCase();
  return g || null;
};

async function vendorParty(vendorId: string): Promise<InvoiceParty> {
  const [{ data: profile }, { data: user }] = await Promise.all([
    supabase.from('vendor_profiles').select('id, company_name, gst_number, address, city').eq('id', vendorId).maybeSingle(),
    supabase.from('users').select('email, phone').eq('id', vendorId).maybeSingle(),
  ]);
  const gstin = gstinOf(profile?.gst_number);
  const { code, name } = stateOf(gstin);
  return {
    kind: 'vendor', id: vendorId, name: clean(profile?.company_name), gstin,
    address: [profile?.address, profile?.city].filter(Boolean).join(', ') || null,
    phone: user?.phone ?? null, email: user?.email ?? null, state_code: code, state: name,
  };
}

async function customerParty(customerId: string): Promise<InvoiceParty> {
  const { data: customer } = await supabase
    .from('customers').select('id, full_name, company_name, phone, gstin, email, billing_address, city, state, pincode').eq('id', customerId).maybeSingle();
  const gstin = gstinOf(customer?.gstin);
  // The customer's own profile: the GSTIN names the state, else the state they chose. Nothing is invented
  // for a field they have not filled in, so a customer with no GSTIN is still billed with the place of supply unknown.
  const fromGstin = stateOf(gstin);
  const chosen = clean(customer?.state);
  const chosenCode = stateCodeByName(chosen);
  const stateCode = fromGstin.code ?? chosenCode;
  const address = [customer?.billing_address, customer?.city, chosenCode ? GST_STATES[chosenCode] : chosen, customer?.pincode]
    .map(clean).filter(Boolean).join(', ') || null;
  return {
    ...UNKNOWN_PARTY, kind: 'customer', id: customerId,
    name: customer ? customerDisplayName(customer) : null,
    gstin, address, phone: customer?.phone ?? null, email: clean(customer?.email),
    state_code: stateCode, state: fromGstin.name ?? (chosenCode ? GST_STATES[chosenCode] : null),
  };
}

/** The consignee of a shipment or lot, with the address of its drop. Null when no consignee is named. */
async function consigneeParty(shipmentId: string): Promise<InvoiceParty | null> {
  const { data: shipment } = await supabase
    .from('shipments').select('id, parent_shipment_id, consignee_name, consignee_phone, consignee_gstin').eq('id', shipmentId).maybeSingle();
  if (!shipment) return null;
  let name = clean(shipment.consignee_name);
  let phone = clean(shipment.consignee_phone);
  let gstin = gstinOf(shipment.consignee_gstin);
  if (!name && shipment.parent_shipment_id) {
    const { data: master } = await supabase
      .from('shipments').select('consignee_name, consignee_phone, consignee_gstin').eq('id', shipment.parent_shipment_id).maybeSingle();
    name = clean(master?.consignee_name);
    phone = phone ?? clean(master?.consignee_phone);
    gstin = gstin ?? gstinOf(master?.consignee_gstin);
  }
  if (!name) return null;

  // A lot's drop is tied to it by lot_shipment_id; a plain shipment's by shipment_id
  const lotPoints = shipment.parent_shipment_id
    ? (await supabase.from('delivery_points').select('name, address, created_at').eq('lot_shipment_id', shipmentId)).data
    : null;
  const points = lotPoints?.length ? lotPoints : (await supabase.from('delivery_points').select('name, address, created_at').eq('shipment_id', shipmentId)).data;
  const drop = finalDeliveryPoint<{ created_at?: string | null; name?: string | null; address?: string | null }>(points ?? []);
  const { code, name: state } = stateOf(gstin);
  return { ...UNKNOWN_PARTY, kind: 'consignee', id: null, name, gstin, address: clean(drop?.address), phone, state_code: code, state };
}

/** The party an invoice is billed to, looked up from the records it points at. Never throws for a missing record. */
export async function resolveBillTo(ref: RecipientRef): Promise<InvoiceParty> {
  let vendorId = ref.vendor_id ?? null;
  if (!vendorId && ref.manifest_id) vendorId = (await manifestRequest(ref.manifest_id))?.vendor_id ?? null;
  if (!vendorId && ref.vendor_request_id) {
    const { data: request } = await supabase.from('vendor_shipment_requests').select('vendor_id').eq('id', ref.vendor_request_id).maybeSingle();
    vendorId = request?.vendor_id ?? null;
  }
  if (vendorId) return vendorParty(vendorId);

  if (ref.shipment_id) {
    const owner = await bookingCustomer(ref.shipment_id);
    if (owner) return customerParty(owner.customer_id);
    const consignee = await consigneeParty(ref.shipment_id);
    if (consignee) return consignee;
  }
  return { ...UNKNOWN_PARTY };
}

/** The snapshot stored on the invoice, or null when there is nothing to store (no recipient on record). */
export function snapshotOf(party: InvoiceParty): InvoiceParty | null {
  return party.kind === 'unknown' || !party.name ? null : party;
}

/** A stored `bill_to` read back as a party; anything malformed is treated as not stored. */
export function partyFromSnapshot(raw: unknown): InvoiceParty | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = clean(r.name);
  if (!name) return null;
  const kind = r.kind === 'vendor' || r.kind === 'customer' || r.kind === 'consignee' ? r.kind : 'unknown';
  const gstin = gstinOf(r.gstin);
  const { code, name: state } = stateOf(gstin);
  return {
    kind, id: clean(r.id), name, gstin, address: clean(r.address), phone: clean(r.phone), email: clean(r.email),
    state_code: code ?? clean(r.state_code), state: state ?? clean(r.state),
  };
}
