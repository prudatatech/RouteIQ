import { describe, expect, it, vi } from 'vitest';
import { marketFreightService, marketRateFor } from '../src/services/goods/freight';
import { getDrivingDistance } from '../src/services/distance.service';
import { VEHICLE_CLASSES } from './support/goods-world';

vi.mock('../src/services/distance.service', () => ({ getDrivingDistance: vi.fn() }));
const vehicle = (key: string) => VEHICLE_CLASSES.find(v => v.key === key)!;
const draft = { items: [], pickup: { lat: 19.07, lng: 72.87 }, delivery: { lat: 28.61, lng: 77.2 }, load_type: 'ftl' as const };

describe('owner-provided vendor freight reference', () => {
  it.each([
    ['truck_14ft', 'lcv', 15, 25],
    ['truck_17_20ft', 'six_wheeler', 20, 30],
    ['flatbed', 'ten_wheeler', 25, 40],
    ['trailer_40ft', 'multi_axle', 35, 55],
    ['container_20ft', 'container', 50, 80],
    ['container_32ft_sxl', 'container', 50, 80],
  ])('prices %s at the selected truck band', async (key, band, low, high) => {
    vi.mocked(getDrivingDistance).mockResolvedValue({ km: 100.4, source: 'estimate', is_estimate: true });
    const result = await marketFreightService.estimate(draft, 1000, vehicle(String(key)));
    expect(result).toMatchObject({ low: Math.round(100.4 * Number(low)), high: Math.round(100.4 * Number(high)), suggested: Math.round(100.4 * (Number(low) + Number(high)) / 2),
      basis: { rate_key: band, distance_is_estimate: true, weight_kg: 1000 } });
    expect(result?.basis?.rates).toHaveLength(5);
  });

  it('does not price a chosen large truck as a small truck for light cargo', () => {
    expect(marketRateFor(vehicle('trailer_40ft'), 100)?.key).toBe('multi_axle');
  });

  it('does not invent rates for specialised trucks or overload a container', () => {
    expect(marketRateFor(vehicle('reefer'), 1000)).toBeNull();
    expect(marketRateFor(vehicle('tanker'), 1000)).toBeNull();
    expect(marketRateFor(vehicle('container_20ft'), 13000)).toBeNull();
    expect(marketRateFor(vehicle('truck_14ft'), 0)).toBeNull();
  });

  it('needs valid locations, known capacity and a positive trip distance', async () => {
    expect(await marketFreightService.estimate({ items: [] }, 1000, vehicle('truck_14ft'))).toBeNull();
    expect(await marketFreightService.estimate(draft, 1000, undefined)).toBeNull();
    vi.mocked(getDrivingDistance).mockResolvedValue({ km: 0, source: 'estimate', is_estimate: true });
    expect(await marketFreightService.estimate(draft, 1000, vehicle('truck_14ft'))).toBeNull();
  });
});
