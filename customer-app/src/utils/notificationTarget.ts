/**
 * Where a customer notification opens (docs/notifications.md, "Customers"). One mapping, used by the
 * in-app list and by a tapped push, so both open the same screen. Pure: no React, no navigation.
 *
 *   booking, cargo_*                     -> the booking (`booking_id`); cargo_delivery_otp also shows its code card
 *   invoice_issued, invoice_paid         -> that invoice (`invoice_id`), else the booking, else the invoice list
 *   cargo_claim_update                   -> the booking, whose claims card lists the claim
 */
export type NotificationTarget =
  | { screen: 'BookingDetail'; params: { id: string; focus?: 'otp' } }
  | { screen: 'Invoice'; params: { id: string } }
  | { screen: 'Invoices' };

const idOf = (data: unknown, key: string): string | null => {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : null;
  return typeof value === 'string' && value !== '' ? value : null;
};

export function notificationTarget(type: unknown, data: unknown): NotificationTarget | null {
  if (typeof type !== 'string') return null;
  const bookingId = idOf(data, 'booking_id');

  if (type === 'invoice_issued' || type === 'invoice_paid') {
    const invoiceId = idOf(data, 'invoice_id');
    if (invoiceId) return { screen: 'Invoice', params: { id: invoiceId } };
    return bookingId ? { screen: 'BookingDetail', params: { id: bookingId } } : { screen: 'Invoices' };
  }
  if ((type === 'booking' || type.startsWith('cargo_')) && bookingId) {
    return { screen: 'BookingDetail', params: type === 'cargo_delivery_otp' ? { id: bookingId, focus: 'otp' } : { id: bookingId } };
  }
  return null;
}
