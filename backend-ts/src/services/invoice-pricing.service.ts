/**
 * margixindia — Money, To price: set the price of a delivered shipment or vendor load and issue its invoice.
 *
 * The price goes where the invoice service already reads it from, so the invoice is priced exactly as
 * one issued on delivery would have been:
 *   - a shipment: shipments.freight_charge (a lot, or a master that kept part, takes freight_share)
 *   - a vendor load: the agreed cost on its vendor request (a lot takes freight_share)
 * A delivery that already has an invoice, or a price from a won bid, is refused: change the price
 * where it was agreed instead of writing a second one.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { InvoiceService } from './invoice.service';
import { assertCanIssueInvoices } from './company.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PriceTarget = { kind: 'shipment' | 'manifest'; id: string };

export function parseAmount(raw: unknown): number {
  const amount = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 99_999_999.99) {
    throw new HttpError(400, 'Enter a price greater than zero');
  }
  return round2(amount);
}

async function priceShipment(id: string, amount: number): Promise<void> {
  const { data: s, error } = await supabase
    .from('shipments').select('id, status, bid_id, is_master, parent_shipment_id').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read shipment: ${error.message}`);
  if (!s) throw new HttpError(404, 'Shipment not found');
  if (s.status !== 'delivered' && s.status !== 'partially_delivered') throw new HttpError(409, 'Only delivered shipments can be priced here');

  if (s.is_master || s.parent_shipment_id) {
    const { error: upErr } = await supabase.from('shipments').update({ freight_share: amount }).eq('id', id);
    if (upErr) throw new Error(`Failed to save the price: ${upErr.message}`);
    return;
  }
  if (s.bid_id) {
    const { data: bid } = await supabase.from('capacity_bids').select('status, bid_amount').eq('id', s.bid_id).maybeSingle();
    if (bid?.status === 'won' && Number(bid.bid_amount) > 0) throw new HttpError(409, 'This shipment is priced by the vendor\'s accepted bid');
  }
  const { error: upErr } = await supabase.from('shipments').update({ freight_charge: amount }).eq('id', id);
  if (upErr) throw new Error(`Failed to save the price: ${upErr.message}`);
}

async function priceManifest(id: string, amount: number): Promise<void> {
  const { data: m, error } = await supabase
    .from('cargo_manifest').select('id, status, vendor_request_id, is_master, parent_manifest_id').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read load: ${error.message}`);
  if (!m) throw new HttpError(404, 'Load not found');
  if (m.status !== 'delivered') throw new HttpError(409, 'Only delivered loads can be priced here');
  if (!m.vendor_request_id) throw new HttpError(409, 'This load is billed on its shipment, not here');

  if (m.is_master || m.parent_manifest_id) {
    const { error: upErr } = await supabase.from('cargo_manifest').update({ freight_share: amount }).eq('id', id);
    if (upErr) throw new Error(`Failed to save the price: ${upErr.message}`);
    return;
  }
  const { error: upErr } = await supabase.from('vendor_shipment_requests').update({ cost: amount }).eq('id', m.vendor_request_id);
  if (upErr) throw new Error(`Failed to save the price: ${upErr.message}`);
}

/** Sets the price, then issues the invoice through the invoice service. Returns the invoice. */
export async function setPriceAndInvoice(target: PriceTarget, rawAmount: unknown): Promise<{ invoice_id: string; invoice_number: string | null; amount: number }> {
  const amount = parseAmount(rawAmount);
  // Refuse before the price is saved: a price saved with no invoice behind it would sit unseen
  await assertCanIssueInvoices();
  const column = target.kind === 'shipment' ? 'shipment_id' : 'manifest_id';
  const { data: existing } = await supabase.from('invoices').select('id, invoice_number').eq(column, target.id).neq('status', 'void').maybeSingle();
  if (existing) throw new HttpError(409, `This delivery already has invoice ${existing.invoice_number ?? existing.id}`);

  if (target.kind === 'shipment') await priceShipment(target.id, amount);
  else await priceManifest(target.id, amount);

  const result = target.kind === 'shipment'
    ? await InvoiceService.createForShipment(target.id)
    : await InvoiceService.createForManifest(target.id);
  if (!result.invoiceId || (result.status !== 'created' && result.status !== 'exists')) {
    throw new HttpError(422, 'The price was saved but this delivery could not be invoiced');
  }
  const { data: inv } = await supabase.from('invoices').select('invoice_number').eq('id', result.invoiceId).maybeSingle();
  return { invoice_id: result.invoiceId, invoice_number: inv?.invoice_number ?? null, amount };
}
