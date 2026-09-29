/**
 * margixindia — Customer quotes and bookings
 *
 * A customer gets a price, books, and tracks the booking. Staff confirm a
 * booking (which creates a real shipment through ShipmentService, so dispatch
 * works as for any other load), assign a vehicle, or cancel it.
 */
import { indianDateKey } from '../core/istDate';
import { getFinanceSettings } from './finance.service';

export interface QuoteInput {
  pickup_lat: number;
  pickup_lng: number;
  drop_lat: number;
  drop_lng: number;
  weight_kg: number;
  vehicle_type?: string | null;
  load_type: 'full' | 'part';
  date: string;
}

export interface QuoteFactor {
  label: string;
  detail: string;
}

export interface Quote {
  /** False when no price can be given yet; the customer can still send the request. */
  available: boolean;
  low: number | null;
  suggested: number | null;
  high: number | null;
  distance_km: number | null;
  factors: QuoteFactor[];
  /** Where the number came from, so staff and the app can tell an estimate from an engine price. */
  source: 'rate_per_km_straight_line';
  message?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * MERGE NOTE: this is a stand-in for the pricing engine (POST /pricing/quote,
 * `pricing.service.ts`), which was not in this branch when the customer app was
 * built. It prices the straight-line distance at the `rate_per_km` setting and
 * returns one number (low = suggested = high). When the engine lands, replace
 * the body of this function with a call to it; the response shape is the same
 * ({low, suggested, high, factors[]}) so nothing else changes.
 */
export async function computeQuote(input: QuoteInput): Promise<Quote> {
  const km = haversineKm(input.pickup_lat, input.pickup_lng, input.drop_lat, input.drop_lng);
  const distance = Math.round(km * 10) / 10;
  const { rate_per_km } = await getFinanceSettings();

  if (rate_per_km == null || rate_per_km <= 0) {
    return {
      available: false,
      low: null,
      suggested: null,
      high: null,
      distance_km: distance,
      factors: [{ label: 'Distance', detail: `${distance} km in a straight line` }],
      source: 'rate_per_km_straight_line',
      message: 'We cannot show an instant price right now. You can still send your request and our team will quote it.',
    };
  }

  const price = round2(km * rate_per_km);
  return {
    available: true,
    low: price,
    suggested: price,
    high: price,
    distance_km: distance,
    factors: [
      { label: 'Distance', detail: `${distance} km in a straight line` },
      { label: 'Rate', detail: `₹${rate_per_km} per km, set by MargixIndia` },
      { label: 'Final price', detail: 'This is an estimate. Our team confirms the price when your booking is accepted.' },
    ],
    source: 'rate_per_km_straight_line',
  };
}

/** True when `date` (YYYY-MM-DD) is today or later in India. */
export function isTodayOrLater(date: string): boolean {
  return date >= indianDateKey(new Date());
}
