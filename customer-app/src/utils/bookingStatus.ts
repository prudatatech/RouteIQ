import type { BookingStatus } from '../services/api';
import type { Tone } from '../components/ui';
import type { TranslateFn } from '../hooks/useTranslation';

/** Plain-language status for a booking (a translation key), and the tone its pill uses. */
export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: Tone }> = {
  requested: { label: 'status_requested', tone: 'warning' },
  confirmed: { label: 'status_confirmed', tone: 'info' },
  assigned: { label: 'status_assigned', tone: 'info' },
  in_transit: { label: 'status_in_transit', tone: 'accent' },
  delivered: { label: 'status_delivered', tone: 'success' },
  cancelled: { label: 'status_cancelled', tone: 'neutral' },
};

/** Steps a booking goes through, in order. */
export const BOOKING_STEPS: { status: BookingStatus; label: string }[] = [
  { status: 'requested', label: 'step_requested' },
  { status: 'confirmed', label: 'step_confirmed' },
  { status: 'assigned', label: 'status_assigned' },
  { status: 'in_transit', label: 'step_in_transit' },
  { status: 'delivered', label: 'status_delivered' },
];

/** A customer can cancel until the load is picked up. */
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
