/**
 * margixindia — The customer's own invoices.
 *
 * An invoice belongs to a customer through the shipment it bills: their booking's shipment, or one
 * of that shipment's lots. This is the same ownership `GET /invoices/:id/pdf` applies, so every row
 * listed here can also be downloaded: void invoices and ones billed to a vendor are left out.
 */
import { supabase } from '../core/supabase';
import { selectIn } from './finance.service';
import { getCompanyProfile } from './company.service';
import { effectiveDueDate, overdueDays } from './invoice-detail.service';

const LIST_COLUMNS = 'id, invoice_number, shipment_id, amount, gst_amount, total, status, issued_at, due_date, paid_at, payment_method, payment_reference';

export async function listCustomerInvoices(customerId: string) {
  const { data: bookings, error } = await supabase
    .from('customer_bookings')
    .select('id, shipment_id, tracking_id, pickup_name, drop_name')
    .eq('customer_id', customerId);
  if (error) throw new Error(`Failed to list bookings: ${error.message}`);
  const withShipment = (bookings ?? []).filter((b: any) => b.shipment_id);
  if (withShipment.length === 0) return [];

  // The booking's shipment and, when it was split, each lot: lots are billed on their own
  const masterIds = withShipment.map((b: any) => b.shipment_id as string);
  const lots = await selectIn<{ id: string; parent_shipment_id: string; tracking_id: string | null }>('shipments', 'parent_shipment_id', masterIds, 'id, parent_shipment_id, tracking_id');
  const bookingOf = new Map<string, any>();
  for (const b of withShipment) bookingOf.set(b.shipment_id, b);
  const codeOf = new Map<string, string | null>(withShipment.map((b: any) => [b.shipment_id, b.tracking_id ?? null]));
  for (const lot of lots) {
    const booking = bookingOf.get(lot.parent_shipment_id);
    if (!booking) continue;
    bookingOf.set(lot.id, booking);
    codeOf.set(lot.id, lot.tracking_id ?? null);
  }

  const invoices = await selectIn<any>('invoices', 'shipment_id', [...bookingOf.keys()], LIST_COLUMNS, (q) => q.neq('status', 'void').is('vendor_id', null));
  const terms = (await getCompanyProfile()).payment_terms_days;
  const now = new Date();
  return invoices
    .map((inv) => {
      const booking = bookingOf.get(inv.shipment_id);
      const due = effectiveDueDate(inv, terms);
      const late = overdueDays(inv, due, now);
      const total = Number(inv.total ?? inv.amount ?? 0);
      // Invoices are paid in full, so nothing is recorded until then: paid means all of it, issued means none
      const amountPaid = inv.status === 'paid' ? total : 0;
      return {
        ...inv,
        amount_paid: amountPaid,
        outstanding: Math.max(0, Math.round((total - amountPaid) * 100) / 100),
        due_date: due,
        overdue: late > 0,
        days_overdue: late,
        booking_id: booking.id as string,
        tracking_id: codeOf.get(inv.shipment_id) ?? null,
        pickup_name: booking.pickup_name as string,
        drop_name: booking.drop_name as string,
      };
    })
    .sort((a, b) => String(b.issued_at ?? '').localeCompare(String(a.issued_at ?? '')));
}
