import rateCard from '../../data/vendor-freight-rates.json';
import { getDrivingDistance } from '../distance.service';
import { isValidPoint } from '../geo';
import { loadVehicleClasses, type VehicleClass } from './master';
import type { Estimate, LoadDraft } from './types';

export const ESTIMATE_LABEL = 'Actual rate confirmed after carrier assignment';
type FreightVehicle = Pick<VehicleClass, 'key' | 'name' | 'max_t' | 'is_reefer' | 'is_tanker'>;

/** Resolve a real truck class or supplied fleet capacity. Unknown explicit types never silently become a smaller truck. */
export async function resolveFreightVehicle(type: string | null | undefined, weightKg: number, capacityT?: number | null, bodyType?: string | null): Promise<FreightVehicle | undefined> {
  const classes = await loadVehicleClasses();
  const normalise = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const key = type ? normalise(type) : null;
  const explicit = classes.find(v => v.key === key || v.name.split('/').some(name => normalise(name) === key) || normalise(v.name) === key);
  if (bodyType === 'reefer' || bodyType === 'tanker') return undefined;
  if (explicit) return explicit;
  if (key && !['truck', 'van'].includes(key)) return undefined;
  if (capacityT != null) return {
    key: bodyType === 'container' ? 'container' : key ?? 'truck', name: bodyType ? `${bodyType} truck` : 'Selected truck', max_t: capacityT,
    is_reefer: bodyType === 'reefer', is_tanker: bodyType === 'tanker',
  };
  return [...classes].sort((a, b) => (a.max_t ?? Infinity) - (b.max_t ?? Infinity))
    .find(v => !v.is_reefer && !v.is_tanker && (bodyType === 'container' ? /container/i.test(v.key) : !/container/i.test(v.key)) && v.max_t != null && v.max_t * 1000 >= weightKg);
}

/** The owner's rate bands are configuration, separate from the calculation. No invented specialised rates. */
export function marketRateFor(vehicle: FreightVehicle, weightKg: number) {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || vehicle.max_t == null || weightKg > vehicle.max_t * 1000) return null;
  if (vehicle.is_reefer || vehicle.is_tanker) return null;
  if (/container/i.test(`${vehicle.key} ${vehicle.name}`)) return rateCard.rates.find(r => r.key === 'container') ?? null;
  // Price the selected truck's capacity, rather than a smaller truck that fits only the cargo weight.
  return rateCard.rates.find(r => r.max_payload_t != null && vehicle.max_t! <= r.max_payload_t) ?? null;
}

export const marketFreightService = {
  async estimate(draft: LoadDraft, weightKg: number, vehicle: FreightVehicle | undefined): Promise<Estimate | null> {
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
        distance_source: distance.source,
        load_type: draft.load_type ?? null,
        rates: rateCard.rates.map(({ key, name, payload, min_per_km, max_per_km }) => ({ key, name, payload, min_per_km, max_per_km })),
      },
    };
  },
};
