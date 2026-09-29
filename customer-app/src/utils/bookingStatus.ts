import type { BookingStatus } from '../services/api';
import type { Tone } from '../components/ui';

/** Plain-language status for a booking, and the tone its pill uses. */
export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  requested: { label: 'Waiting for confirmation', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  assigned: { label: 'Vehicle assigned', tone: 'info' },
  in_transit: { label: 'On its way', tone: 'accent' },
  delivered: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** Steps a booking goes through, in order. */
export const BOOKING_STEPS: { status: BookingStatus; label: string }[] = [
  { status: 'requested', label: 'Booking sent' },
  { status: 'confirmed', label: 'Confirmed by our team' },
  { status: 'assigned', label: 'Vehicle assigned' },
  { status: 'in_transit', label: 'Picked up and on its way' },
  { status: 'delivered', label: 'Delivered' },
];

/** A customer can cancel until the load is picked up. */
export const canCancel = (status: BookingStatus) => status === 'requested' || status === 'confirmed' || status === 'assigned';

/** "45 min" or "2 h 10 min". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
