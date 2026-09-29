/**
 * margixindia — Customer quotes and bookings
 *
 * A customer gets a price, books, and tracks the booking. Staff confirm a
 * booking (which creates a real shipment through ShipmentService, so dispatch
 * works as for any other load), assign a vehicle, or cancel it.
 */
import { indianDateKey } from '../core/istDate';
import { pricingService } from './pricing.service';

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
  source: 'pricing_engine';
  message?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;


/**
 * Customer price from the shared pricing engine (rate card, driving distance,
 * weight, vehicle type, demand and past accepted prices). The customer sees the
 * engine's range and its reasons; staff confirm the final price on acceptance.
 */
export async function computeQuote(input: QuoteInput, ctx: { userId?: string } = {}): Promise<Quote> {
  const outcome = await pricingService.quote(
    {
      pickup: { lat: input.pickup_lat, lng: input.pickup_lng },
      drop: { lat: input.drop_lat, lng: input.drop_lng },
      weight_kg: input.weight_kg,
      vehicle_type: input.vehicle_type ?? null,
      load_type: input.load_type,
      date: input.date,
    },
    { userId: ctx.userId, role: 'customer', source: 'customer_app' },
  );

  if (outcome.status !== 'ok') {
    return {
      available: false,
      low: null,
      suggested: null,
      high: null,
      distance_km: null,
      factors: [],
      source: 'pricing_engine',
      message: 'We cannot show an instant price right now. You can still send your request and our team will quote it.',
    };
  }

  return {
    available: true,
    low: round2(outcome.low),
    suggested: round2(outcome.suggested),
    high: round2(outcome.high),
    distance_km: outcome.distance_km,
    factors: [
      ...outcome.factors.map(f => ({ label: f.label, detail: f.detail })),
      { label: 'Final price', detail: 'This is an estimate. Our team confirms the price when your booking is accepted.' },
    ],
    source: 'pricing_engine',
  };
}

/** True when `date` (YYYY-MM-DD) is today or later in India. */
export function isTodayOrLater(date: string): boolean {
  return date >= indianDateKey(new Date());
}
