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

/**
 * Shipment statuses that say more than a booking's own status can (a booking
 * only knows "on its way" or "delivered"), so the pill shows these instead.
 */
export const SHIPMENT_STATUS: Partial<Record<string, { label: string; tone: Tone }>> = {
  out_for_delivery: { label: 'status_out_for_delivery', tone: 'accent' },
  at_hub: { label: 'status_at_hub', tone: 'info' },
  partially_delivered: { label: 'status_partially_delivered', tone: 'warning' },
  on_hold: { label: 'status_on_hold', tone: 'warning' },
  returning: { label: 'status_returning', tone: 'warning' },
  returned: { label: 'status_returned', tone: 'neutral' },
  lost: { label: 'status_lost', tone: 'danger' },
};

/** A shipment whose delivery attempt failed and is waiting for another. The booking keeps its own status, so this reads the shipment's. */
export const deliveryFailed = (booking: Pick<Booking, 'status' | 'shipment_status'>) =>
  booking.shipment_status === 'exception' && booking.status !== 'delivered' && booking.status !== 'cancelled';

/** The pill for a booking: "Delivery attempt failed", a detailed shipment status, or the booking's own status. */
export const bookingStatusInfo = (booking: Pick<Booking, 'status' | 'shipment_status'>): { label: string; tone: Tone } => {
  if (deliveryFailed(booking)) return { label: 'status_delivery_failed', tone: 'danger' };
  const detailed = booking.shipment_status ? SHIPMENT_STATUS[booking.shipment_status] : undefined;
  if (detailed && booking.status !== 'cancelled') return detailed;
  return BOOKING_STATUS[booking.status];
};

/** One lot's status in plain words: waiting for pickup, on its way, delivered, or a detailed shipment status. */
export function lotStatusInfo(status: string | null | undefined): { label: string; tone: Tone } {
  switch (status) {
    case 'created':
    case 'assigned':
      return { label: 'lot_status_waiting', tone: 'info' };
    case 'picked_up':
    case 'in_transit':
      return BOOKING_STATUS.in_transit;
    case 'delivered':
      return BOOKING_STATUS.delivered;
    case 'cancelled':
      return BOOKING_STATUS.cancelled;
    case 'exception':
      return { label: 'status_delivery_failed', tone: 'danger' };
    default:
      return (status && SHIPMENT_STATUS[status]) || { label: 'lot_status_unknown', tone: 'neutral' };
  }
}

/** The goods have reached the receiver, in full or in part. */
export const isDelivered = (booking: Pick<Booking, 'status' | 'shipment_status'>) =>
  booking.status === 'delivered' || booking.shipment_status === 'delivered' || booking.shipment_status === 'partially_delivered';

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
