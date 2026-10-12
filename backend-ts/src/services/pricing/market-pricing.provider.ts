import { settings } from '../../core/config';
import { wheelseyeService, WheelseyePricePayload } from '../wheelseye.service';
import { LatLng } from '../geo';

export interface MarketTruckOption {
  vid?: number;
  name: string;
  bodyType: 'OPEN' | 'CONTAINER' | 'TRAILER' | string;
  tyre: number;
  lengthFt: number;
  actualPriceInr: number;
  discountedPriceInr: number;
  discountPct: number;
  capacityTon: number;
  remark?: string | null;
}

export interface MarketPricingResult {
  provider: 'wheelseye';
  mode: 'ftl' | 'ptl';
  available: boolean;
  lane: {
    origin: string;
    destination: string;
  };
  ftl?: {
    recommendedVehicle: string;
    lowestPriceInr: number;
    highestPriceInr: number;
    averagePriceInr: number;
    vehicleOptions: MarketTruckOption[];
  };
  ptl?: {
    derivedRatePerKgInr: number;
    estimatedMarketPriceInr: number;
    benchmarkTruck: string;
    benchmarkTruckPriceInr: number;
    benchmarkTruckTonnage: number;
  };
  browsingId?: string;
  queriedAt: string;
  error?: string;
}

/**
 * Maps weight in kg to the closest standard WheelsEye tonnage bracket:
 * [1.0, 4.5, 7.0, 12.0, 15.0, 18.0, 25.0]
 */
function resolveTonnageBucket(weightKg: number): number {
  const tons = weightKg / 1000;
  if (tons <= 1.0) return 1.0;
  if (tons <= 4.5) return 4.5;
  if (tons <= 7.0) return 7.0;
  if (tons <= 12.0) return 12.0;
  if (tons <= 15.0) return 15.0;
  if (tons <= 18.0) return 18.0;
  return 25.0;
}

/**
 * Normalizes vehicle type into WheelsEye bodyType (OPEN, CONTAINER, TRAILER)
 */
function resolveBodyType(vehicleType?: string | null): string {
  if (!vehicleType) return 'OPEN';
  const v = vehicleType.toLowerCase();
  if (v.includes('container') || v.includes('closed') || v.includes('box')) return 'CONTAINER';
  if (v.includes('trailer') || v.includes('flatbed') || v.includes('lowbed')) return 'TRAILER';
  return 'OPEN';
}

function parseInr(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val !== 'string') return 0;
  const cleaned = val.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export class WheelseyeMarketProvider {
  /**
   * Fetches real-time market freight benchmark for FTL and PTL loads.
   * Completely isolated: catches all errors gracefully and returns { available: false } on failure.
   */
  async getMarketBenchmark(input: {
    pickup: LatLng & { label?: string | null; placeId?: string };
    drop: LatLng & { label?: string | null; placeId?: string };
    weight_kg: number;
    load_type?: string | null;
    vehicle_type?: string | null;
  }): Promise<MarketPricingResult | null> {
    try {
      const isPtl = input.load_type === 'ptl' || input.weight_kg <= 500;
      const tonnage = isPtl ? 4.5 : resolveTonnageBucket(input.weight_kg);
      const bodyType = resolveBodyType(input.vehicle_type);

      const originAddr = input.pickup.label || `${input.pickup.lat.toFixed(4)}, ${input.pickup.lng.toFixed(4)}`;
      const destAddr = input.drop.label || `${input.drop.lat.toFixed(4)}, ${input.drop.lng.toFixed(4)}`;

      // Resolve valid Google placeIds for WheelsEye demand engine
      let originPlaceId = input.pickup.placeId;
      let destPlaceId = input.drop.placeId;

      if (!originPlaceId) {
        const originQuery = input.pickup.label ? input.pickup.label.split(',')[0].trim() : `${input.pickup.lat},${input.pickup.lng}`;
        const suggestions = await wheelseyeService.autocomplete(originQuery);
        if (suggestions.length > 0) originPlaceId = suggestions[0].placeId;
      }

      if (!destPlaceId) {
        const destQuery = input.drop.label ? input.drop.label.split(',')[0].trim() : `${input.drop.lat},${input.drop.lng}`;
        const suggestions = await wheelseyeService.autocomplete(destQuery);
        if (suggestions.length > 0) destPlaceId = suggestions[0].placeId;
      }

      if (!originPlaceId || !destPlaceId) {
        return {
          provider: 'wheelseye',
          mode: isPtl ? 'ptl' : 'ftl',
          available: false,
          lane: { origin: originAddr, destination: destAddr },
          queriedAt: new Date().toISOString(),
          error: 'Could not resolve WheelsEye placeId for origin or destination'
        };
      }

      // Build payload for WheelsEye
      const payload: WheelseyePricePayload = {
        locs: [
          {
            placeId: originPlaceId,
            address: originAddr,
            name: originAddr.split(',')[0].trim(),
            source: 'GOOGLE',
            addressSummary: originAddr,
            loc: { lat: input.pickup.lat, lng: input.pickup.lng },
            buildingName: originAddr.split(',')[0].trim(),
            addressLineOne: originAddr,
            pincode: '',
            type: 'LOADING'
          },
          {
            placeId: destPlaceId,
            address: destAddr,
            name: destAddr.split(',')[0].trim(),
            source: 'GOOGLE',
            addressSummary: destAddr,
            loc: { lat: input.drop.lat, lng: input.drop.lng },
            buildingName: destAddr.split(',')[0].trim(),
            addressLineOne: destAddr,
            pincode: '',
            type: 'CONSIGNEE'
          }
        ],
        tonnage,
        bodyType
      };

      const response = await wheelseyeService.getPricingRecommendations(payload);
      if (!response || !response.vehicleType) {
        return {
          provider: 'wheelseye',
          mode: isPtl ? 'ptl' : 'ftl',
          available: false,
          lane: { origin: originAddr, destination: destAddr },
          queriedAt: new Date().toISOString(),
          error: 'No market vehicle recommendations returned for this lane.'
        };
      }

      // Collect all vehicle options across body types
      const options: MarketTruckOption[] = [];
      for (const vt of response.vehicleType || []) {
        for (const v of vt.vehicleList || []) {
          const actual = parseInr(v.actualPrice);
          const discounted = parseInr(v.discountedPrice);
          const discountPct = actual > 0 ? Math.round(((actual - discounted) / actual) * 100) : 0;

          options.push({
            vid: v.vid,
            name: v.vehicleName || `${vt.title} Truck`,
            bodyType: vt.value || bodyType,
            tyre: v.tyre || 6,
            lengthFt: v.vehicleLength || 22,
            actualPriceInr: actual,
            discountedPriceInr: discounted,
            discountPct,
            capacityTon: parseFloat(v.vehicleWeight) || tonnage,
            remark: v.remark?.text || null
          });
        }
      }

      if (options.length === 0) {
        return {
          provider: 'wheelseye',
          mode: isPtl ? 'ptl' : 'ftl',
          available: false,
          lane: { origin: originAddr, destination: destAddr },
          browsingId: response.priceBrowsingId,
          queriedAt: new Date().toISOString(),
          error: 'No trucks currently available for this lane capacity.'
        };
      }

      // Sort by price ascending
      options.sort((a, b) => a.discountedPriceInr - b.discountedPriceInr);
      const lowest = options[0];
      const highest = options[options.length - 1];
      const avg = Math.round(options.reduce((s, o) => s + o.discountedPriceInr, 0) / options.length);

      if (!isPtl) {
        // Full Truckload (FTL) Model
        return {
          provider: 'wheelseye',
          mode: 'ftl',
          available: true,
          lane: { origin: originAddr, destination: destAddr },
          ftl: {
            recommendedVehicle: lowest.name,
            lowestPriceInr: lowest.discountedPriceInr,
            highestPriceInr: highest.discountedPriceInr,
            averagePriceInr: avg,
            vehicleOptions: options
          },
          browsingId: response.priceBrowsingId,
          queriedAt: new Date().toISOString()
        };
      } else {
        // Partial Truckload (PTL) Model
        // Derives pro-rata lane rate per kg from baseline truck capacity + 30% LTL consolidation margin
        const benchmarkTruck = lowest;
        const truckCapacityKg = Math.max(1000, benchmarkTruck.capacityTon * 1000);
        const baseRatePerKg = benchmarkTruck.discountedPriceInr / truckCapacityKg;
        // PTL consolidation factor: 1.30 (30% overhead for handling, hub transit and partial space)
        const ptlFactor = 1.30;
        const derivedRatePerKg = Math.round(baseRatePerKg * ptlFactor * 100) / 100;
        const estimatedPtlPrice = Math.round(derivedRatePerKg * input.weight_kg);

        return {
          provider: 'wheelseye',
          mode: 'ptl',
          available: true,
          lane: { origin: originAddr, destination: destAddr },
          ptl: {
            derivedRatePerKgInr: derivedRatePerKg,
            estimatedMarketPriceInr: Math.max(99, estimatedPtlPrice),
            benchmarkTruck: benchmarkTruck.name,
            benchmarkTruckPriceInr: benchmarkTruck.discountedPriceInr,
            benchmarkTruckTonnage: benchmarkTruck.capacityTon
          },
          browsingId: response.priceBrowsingId,
          queriedAt: new Date().toISOString()
        };
      }
    } catch (err: any) {
      console.warn('[WheelseyeMarketProvider] Failed to fetch benchmark:', err.message);
      return null;
    }
  }
}

export const marketPricingProvider = new WheelseyeMarketProvider();
