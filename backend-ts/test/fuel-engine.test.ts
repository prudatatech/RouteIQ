import { describe, expect, it } from 'vitest';
import {
  analyzeFills, computeSegments, findDuplicates, resolveAmounts, rollingKmpl, vehicleStats, vehicleUpdate, FuelInputError, type FuelFill,
} from '../src/services/fuel-engine';

let n = 0;
const fill = (day: string, odo: number | null, litres: number, over: Partial<FuelFill> = {}): FuelFill => ({
  id: `f${++n}`, filled_at: `2026-09-${day}T06:00:00Z`, litres, price_per_litre: 100, total_amount: litres * 100,
  odometer_km: odo, is_full_tank: true, bill_status: 'with_bill', ...over,
});

describe('resolveAmounts', () => {
  it('works out the third figure from any two', () => {
    expect(resolveAmounts({ litres: 40, price_per_litre: 95.5 })).toEqual({ litres: 40, price_per_litre: 95.5, total_amount: 3820 });
    expect(resolveAmounts({ litres: 40, total_amount: 3820 })).toEqual({ litres: 40, price_per_litre: 95.5, total_amount: 3820 });
    expect(resolveAmounts({ price_per_litre: 95.5, total_amount: 3820 })).toEqual({ litres: 40, price_per_litre: 95.5, total_amount: 3820 });
  });

  it('accepts three figures that agree and rejects ones that do not', () => {
    expect(resolveAmounts({ litres: 40.5, price_per_litre: 94.87, total_amount: 3842 }).total_amount).toBe(3842);
    expect(() => resolveAmounts({ litres: 40, price_per_litre: 95, total_amount: 5000 })).toThrow(FuelInputError);
  });

  it('needs two figures, all above zero', () => {
    expect(() => resolveAmounts({ litres: 40 })).toThrow('any two');
    expect(() => resolveAmounts({ litres: 0, price_per_litre: 90 })).toThrow('more than 0');
  });
});

describe('full tank to full tank mileage', () => {
  it('measures from full fill to full fill', () => {
    const { segments } = computeSegments([fill('01', 1000, 50), fill('05', 1400, 40), fill('10', 1800, 40)]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ distance_km: 400, litres: 40, kmpl: 10 });
    expect(segments[1]).toMatchObject({ distance_km: 400, litres: 40, kmpl: 10 });
  });

  it('adds partial fills up until the next full fill', () => {
    const a = fill('01', 1000, 50);
    const partial = fill('05', 1200, 20, { is_full_tank: false });
    const partial2 = fill('06', 1300, 10, { is_full_tank: false });
    const b = fill('08', 1500, 20);
    const { segments } = computeSegments([b, partial2, a, partial]); // any order in, oldest first inside
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ anchor_id: a.id, closing_id: b.id, fill_ids: [partial.id, partial2.id, b.id], distance_km: 500, litres: 50, cost: 5000, kmpl: 10 });
  });

  it('has no mileage until a second full fill, and ignores partial fills before the first', () => {
    expect(computeSegments([fill('01', 1000, 50), fill('02', 1100, 10, { is_full_tank: false })]).segments).toEqual([]);
    const { segments } = computeSegments([fill('01', 900, 10, { is_full_tank: false }), fill('02', 1000, 50), fill('05', 1300, 30)]);
    expect(segments[0]).toMatchObject({ litres: 30, kmpl: 10 });
  });

  it('breaks the chain at a full fill with no odometer reading', () => {
    const { segments } = computeSegments([fill('01', 1000, 50), fill('05', null, 40), fill('10', 1800, 40), fill('15', 2200, 40)]);
    expect(segments).toHaveLength(1); // only 1800 -> 2200
    expect(segments[0]).toMatchObject({ distance_km: 400, litres: 40 });
  });

  it('skips a reading lower than the one before it', () => {
    const bad = fill('05', 900, 40);
    const { segments, backwards } = computeSegments([fill('01', 1000, 50), bad, fill('10', 1400, 40)]);
    expect([...backwards]).toEqual([bad.id]);
    expect(segments[0]).toMatchObject({ distance_km: 400, litres: 40 });
  });

  it('rolling average weights by distance and looks at the last five segments', () => {
    const fills = [fill('01', 0, 50)];
    // six segments of 100 km; the first uses 5 L (20 km/l), the rest 10 L (10 km/l)
    const litres = [5, 10, 10, 10, 10, 10];
    litres.forEach((l, i) => fills.push(fill(String(2 + i).padStart(2, '0'), (i + 1) * 100, l)));
    const { segments } = computeSegments(fills);
    expect(segments).toHaveLength(6);
    expect(rollingKmpl(segments)).toBe(10); // the 20 km/l one has dropped out
    expect(rollingKmpl(segments, 6)).toBe(Math.round((600 / 55) * 100) / 100);
  });
});

describe('anomaly flags', () => {
  const history = () => [fill('01', 1000, 50), fill('05', 1400, 40), fill('10', 1800, 40), fill('15', 2200, 40)]; // 10 km/l x3

  it('flags mileage more than 25% below the vehicle own average', () => {
    const slow = fill('20', 2500, 40); // 300 / 40 = 7.5 km/l, exactly 25% below: fine
    const slower = fill('20', 2490, 40); // 290 / 40 = 7.25
    const ok = analyzeFills([...history(), slow]).annotations.get(slow.id)!;
    expect(ok.flags).not.toContain('low_mileage');
    expect(ok.mileage_kmpl).toBe(7.5);
    expect(analyzeFills([...history(), slower]).annotations.get(slower.id)!.flags).toContain('low_mileage');
  });

  it('needs some history before it calls a segment low', () => {
    const a = fill('01', 1000, 50);
    const b = fill('05', 1400, 40);
    const c = fill('10', 1600, 40); // 5 km/l but only one segment before it
    expect(analyzeFills([a, b, c]).annotations.get(c.id)!.flags).not.toContain('low_mileage');
  });

  it('flags litres above the tank capacity, only when the capacity is known', () => {
    const big = fill('01', 1000, 130);
    expect(analyzeFills([big], { tankCapacityLiters: 120 }).annotations.get(big.id)!.flags).toContain('over_tank_capacity');
    expect(analyzeFills([big], { tankCapacityLiters: 130 }).annotations.get(big.id)!.flags).not.toContain('over_tank_capacity');
    expect(analyzeFills([big]).annotations.get(big.id)!.flags).not.toContain('over_tank_capacity');
  });

  it('flags an odometer going backwards and leaves that fill out of the mileage', () => {
    const bad = fill('05', 900, 40);
    const last = fill('10', 1400, 40);
    const { annotations, segments } = analyzeFills([fill('01', 1000, 50), bad, last]);
    expect(annotations.get(bad.id)!.flags).toContain('odometer_backwards');
    expect(segments).toHaveLength(1);
    expect(annotations.get(last.id)!.mileage_kmpl).toBe(10);
  });

  it('flags a duplicate within the window and leaves it out of the mileage', () => {
    const a = fill('01', 1000, 50);
    const b = fill('05', 1400, 40);
    const twin = { ...fill('05', 1400, 40.2), filled_at: '2026-09-05T06:10:00Z' };
    expect([...findDuplicates([a, b, twin])]).toEqual([twin.id]);
    const { annotations, segments } = analyzeFills([a, b, twin]);
    expect(annotations.get(twin.id)!.flags).toContain('duplicate');
    expect(annotations.get(b.id)!.flags).not.toContain('duplicate');
    expect(segments[0]).toMatchObject({ litres: 40, kmpl: 10 });
    // Same size a day later is a normal fill
    expect(findDuplicates([b, { ...fill('06', 1500, 40) }]).size).toBe(0);
  });

  it('flags a fill far from the GPS position at that time, and not one near it', () => {
    const near = fill('01', 1000, 40, { fill_latitude: 19.076, fill_longitude: 72.8777 });
    const far = fill('02', 1100, 41, { fill_latitude: 19.076, fill_longitude: 72.8777 });
    const noPlace = fill('03', 1200, 42);
    const gps = [
      { lat: 19.08, lng: 72.88, at: '2026-09-01T06:05:00Z' }, // ~0.5 km away
      { lat: 18.5204, lng: 73.8567, at: '2026-09-02T06:05:00Z' }, // Pune, ~120 km away
    ];
    const { annotations } = analyzeFills([near, far, noPlace], { gps });
    expect(annotations.get(near.id)!.flags).not.toContain('far_from_gps');
    expect(annotations.get(far.id)!.flags).toContain('far_from_gps');
    expect(annotations.get(noPlace.id)!.flags).not.toContain('far_from_gps');
    // With no GPS point near that time nothing is claimed
    expect(analyzeFills([far], { gps: [{ lat: 18.5, lng: 73.8, at: '2026-08-01T00:00:00Z' }] }).annotations.get(far.id)!.flags).toEqual([]);
  });

  it('flags an entry without a bill', () => {
    const f = fill('01', 1000, 40, { bill_status: 'no_bill' });
    expect(analyzeFills([f]).annotations.get(f.id)!.flags).toEqual(['no_bill']);
  });
});

describe('statistics and the vehicle update', () => {
  const NOW = new Date('2026-09-29T06:00:00Z');
  const fills = [
    fill('01', 1000, 50), fill('05', 1400, 40), fill('10', 1800, 40, { is_full_tank: false }),
    { ...fill('28', 2200, 40), price_per_litre: 110, total_amount: 4400 },
  ];

  it('gives the rolling and last mileage, cost per km and the month', () => {
    const analysis = analyzeFills(fills);
    const stats = vehicleStats(fills, analysis, NOW);
    // segment 1: 400 km / 40 L; segment 2: 800 km for 80 L (partial + closing), cost 4000 + 4400
    expect(analysis.segments.map(s => s.kmpl)).toEqual([10, 10]);
    expect(stats).toMatchObject({ fills: 4, rolling_avg_kmpl: 10, last_kmpl: 10, month_spend: 5000 + 4000 + 4000 + 4400, month_litres: 170, month_fills: 4 });
    expect(stats.cost_per_km).toBe(Math.round(((4000 + 4000 + 4400) / 1200) * 100) / 100);
    expect(stats.trend).toHaveLength(2);
  });

  it('counts only this IST month in the monthly figures', () => {
    const edge = [fill('01', 1000, 50), { ...fill('05', 1400, 40), filled_at: '2026-08-31T20:00:00Z' }]; // 1 Sep 01:30 IST: this month
    expect(vehicleStats(edge, analyzeFills(edge), NOW).month_fills).toBe(2);
    const august = [{ ...fill('01', 1000, 50), filled_at: '2026-08-31T10:00:00Z' }];
    expect(vehicleStats(august, analyzeFills(august), NOW).month_fills).toBe(0);
  });

  it('keeps the vehicle at the rolling average and full after a newest full fill', () => {
    const analysis = analyzeFills(fills);
    // The newest fill (28 Sep) is a full one
    expect(vehicleUpdate(fills, analysis, 100)).toEqual({ fuel_efficiency_kmpl: 10, current_fuel_liters: 100 });
    expect(vehicleUpdate(fills, analysis, null)).toEqual({ fuel_efficiency_kmpl: 10 });
    const partialNewest = [...fills, fill('29', 2300, 20, { is_full_tank: false })];
    expect(vehicleUpdate(partialNewest, analyzeFills(partialNewest), 100)).toEqual({ fuel_efficiency_kmpl: 10 });
    expect(vehicleUpdate([fills[0]], analyzeFills([fills[0]]), 100)).toEqual({ current_fuel_liters: 100 });
  });
});
