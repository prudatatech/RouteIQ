import { beforeEach, describe, expect, it } from 'vitest';
import { supabaseMock } from './support/mock-supabase';
import { readPricingSettings } from '../src/services/pricing.service';

describe('pricing settings', () => {
  beforeEach(() => supabaseMock.reset({
    system_settings: [
      { key: 'rate_per_km', value: { rate: 45 } },
      { key: 'fuel_price_per_litre', value: 94.5 },
    ],
  }));

  it('reads the rate card in the stored {"rate": n} shape as well as bare numbers', async () => {
    const cfg = await readPricingSettings();
    expect(cfg.rate_per_km).toBe(45);
  });
});
