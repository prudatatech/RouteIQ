import rateCard from '../../data/vendor-freight-rates.json';
import { getDrivingDistance } from '../distance.service';
import { isValidPoint } from '../geo';
import type { VehicleClass } from './master';
import type { Estimate, LoadDraft } from './types';

export const ESTIMATE_LABEL = 'Actual rate confirmed after carrier assignment';

/** The owner's rate bands are configuration, separate from the calculation. No invented specialised rates. */
export function marketRateFor(vehicle: VehicleClass, weightKg: number) {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || vehicle.max_t == null || weightKg > vehicle.max_t * 1000) return null;
  if (vehicle.is_reefer || vehicle.is_tanker) return null;
  if (/container/i.test(`${vehicle.key} ${vehicle.name}`)) return rateCard.rates.find(r => r.key === 'container') ?? null;
  // Price the selected truck's capacity, rather than a smaller truck that fits only the cargo weight.
  return rateCard.rates.find(r => r.max_payload_t != null && vehicle.max_t! <= r.max_payload_t) ?? null;
}

export const marketFreightService = {
  async estimate(draft: LoadDraft, weightKg: number, vehicle: VehicleClass | undefined): Promise<Estimate | null> {
    if (!vehicle || vehicle.max_t == null || !Number.isFinite(vehicle.max_t) || vehicle.max_t <= 0) return null;
    const rate = marketRateFor(vehicle, weightKg);
    const a = { lat: draft.pickup?.lat ?? NaN, lng: draft.pickup?.lng ?? NaN };
    const b = { lat: draft.delivery?.lat ?? NaN, lng: draft.delivery?.lng ?? NaN };
    if (!rate || !isValidPoint(a) || !isValidPoint(b)) return null;
    const distance = await getDrivingDistance(a, b);
    if (!Number.isFinite(distance.km) || distance.km <= 0) return null;
    const midpoint = (rate.min_per_km + rate.max_per_km) / 2;
    return {
      low: Math.round(distance.km * rate.min_per_km),
      high: Math.round(distance.km * rate.max_per_km),
      suggested: Math.round(distance.km * midpoint),
      distance_km: distance.km,
      label: ESTIMATE_LABEL,
      basis: {
        source: rateCard.source,
        rate_key: rate.key,
        truck_type: rate.name,
        vehicle_name: vehicle.name,
        vehicle_capacity_t: vehicle.max_t,
        weight_kg: weightKg,
        min_per_km: rate.min_per_km,
        max_per_km: rate.max_per_km,
        midpoint_per_km: midpoint,
        distance_is_estimate: distance.is_estimate,
        load_type: draft.load_type ?? null,
        rates: rateCard.rates.map(({ key, name, payload, min_per_km, max_per_km }) => ({ key, name, payload, min_per_km, max_per_km })),
      },
    };
  },
};
