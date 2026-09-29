import type { Booking, BookingStatus } from '../services/api';
import type { Tone } from '../components/ui';
import type { TranslateFn } from '../hooks/useTranslation';

/** Plain-language status for a booking (a translation key), and the tone its pill uses. */
export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  requested: { label: 'status_requested', tone: 'info' },
  confirmed: { label: 'status_confirmed', tone: 'info' },
  assigned: { label: 'status_assigned', tone: 'info' },
  in_transit: { label: 'status_in_transit', tone: 'accent' },
  delivered: { label: 'status_delivered', tone: 'success' },
  cancelled: { label: 'status_cancelled', tone: 'neutral' },
};

/** A shipment whose delivery attempt failed and is waiting for another. The booking keeps its own status, so this reads the shipment's. */
export const deliveryFailed = (booking: Pick<Booking, 'status' | 'shipment_status'>) =>
  booking.shipment_status === 'exception' && booking.status !== 'delivered' && booking.status !== 'cancelled';

/** The pill for a booking: its status, or "Delivery attempt failed" after a failed attempt. */
export const bookingStatusInfo = (booking: Pick<Booking, 'status' | 'shipment_status'>): { label: string; tone: Tone } =>
  deliveryFailed(booking) ? { label: 'status_delivery_failed', tone: 'danger' } : BOOKING_STATUS[booking.status];

/** Steps a booking goes through, in order. */
export const BOOKING_STEPS: { status: BookingStatus; label: string }[] = [
  { status: 'requested', label: 'step_requested' },
  { status: 'confirmed', label: 'step_confirmed' },
  { status: 'assigned', label: 'status_assigned' },
  { status: 'in_transit', label: 'step_in_transit' },
  { status: 'delivered', label: 'status_delivered' },
];

/** A customer can cancel until the shipment is picked up. */
export const canCancel = (status: BookingStatus) => status === 'requested' || status === 'confirmed' || status === 'assigned';

/** "45 min" or "2 h 10 min". */
export function formatMinutes(minutes: number, t: TranslateFn): string {
  const min = t('unit_min');
  const hour = t('unit_hour');
  if (minutes < 60) return `${minutes} ${min}`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ${hour}` : `${h} ${hour} ${m} ${min}`;
}
