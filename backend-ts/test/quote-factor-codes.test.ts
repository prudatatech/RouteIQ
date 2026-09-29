import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseMock } from './support/mock-supabase';
import { pricingService } from '../src/services/pricing.service';
import { computeQuote } from '../src/services/customer-booking.service';

vi.mock('../src/services/distance.service', () => ({
  getDrivingDistance: async () => ({ km: 150, source: 'estimate', is_estimate: true }),
}));

const pickupDay = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const pune = { lat: 18.52, lng: 73.86 };
const mumbai = { lat: 19.07, lng: 72.87 };

const history = (rate: number) => ({ cost_per_km: rate, pickup_lat: pune.lat, pickup_lng: pune.lng, drop_lat: mumbai.lat, drop_lng: mumbai.lng });

beforeEach(() => supabaseMock.reset({
  system_settings: [
    { key: 'rate_per_km', value: 40 },
    { key: 'per_kg_surcharge', value: 0.5 },
    { key: 'load_multiplier_full', value: 1.2 },
    { key: 'min_charge', value: 100000 },
    { key: 'fuel_price_per_litre', value: 95 },
  ],
  vehicles: [{ id: 'v1', latitude: pune.lat, longitude: pune.lng, vehicle_type: 'truck', status: 'available', fuel_efficiency_kmpl: 5 }],
  vendor_shipment_requests: [
    { id: 'r1', status: 'pending', ...history(42) },
    { id: 'r2', ...history(44) },
    { id: 'r3', ...history(46) },
  ],
  capacity_bids: [],
  shipments: [],
  delivery_points: [],
  price_quotes: [],
}));

const ALL_CODES = ['rate_card', 'weight', 'load_type', 'demand', 'history', 'min_charge', 'fuel'];

describe('quote factor codes', () => {
  it('gives every pricing factor a stable machine code and keeps the English label', async () => {
    const outcome = await pricingService.quote({
      pickup: pune, drop: mumbai, weight_kg: 800, vehicle_type: 'truck', load_type: 'full', date: pickupDay,
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.factors.map(f => f.code).sort()).toEqual([...ALL_CODES].sort());
    for (const f of outcome.factors) {
      expect(f.code).toMatch(/^[a-z_]+$/);
      expect(f.label.length).toBeGreaterThan(0);
    }
  });

  it('sends codes in the customer quote, including the closing final_price note', async () => {
    const quote = await computeQuote({
      pickup_lat: pune.lat, pickup_lng: pune.lng, drop_lat: mumbai.lat, drop_lng: mumbai.lng,
      weight_kg: 800, vehicle_type: 'truck', load_type: 'full', date: pickupDay,
    });
    expect(quote.available).toBe(true);
    expect(quote.factors.length).toBeGreaterThan(1);
    for (const f of quote.factors) {
      expect(typeof f.code).toBe('string');
      expect(f.code.length).toBeGreaterThan(0);
      expect(f.label).toBeTruthy();
    }
    expect(quote.factors[quote.factors.length - 1].code).toBe('final_price');
    expect(quote.factors[0]).toMatchObject({ code: 'rate_card', label: 'Rate card' });
  });
});
