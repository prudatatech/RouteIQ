import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { goodsTables, PREFIXES } from './support/goods-world';
import { isPincode, lookupPincode, pincodeFromPrefix } from '../src/services/goods/pincode';

beforeEach(() => supabaseMock.reset(goodsTables()));

describe('pin code lookup', () => {
  it('uses the full pin code first', async () => {
    expect(await lookupPincode('400001')).toEqual({ pincode: '400001', state_code: '27', state_name: 'Maharashtra', district: 'Mumbai', city: 'Mumbai' });
    // a row without a city leaves it out
    expect(await lookupPincode('411001')).toEqual({ pincode: '411001', state_code: '27', state_name: 'Maharashtra', district: 'Pune' });
  });

  it('falls back to the 3-digit prefix', async () => {
    expect(await lookupPincode('110045')).toEqual({ pincode: '110045', state_code: '07', state_name: 'Delhi' });
    expect(await lookupPincode('560100')).toMatchObject({ state_code: '29', state_name: 'Karnataka' });
  });

  it('prefers the exact row over the prefix when they disagree', async () => {
    supabaseMock.reset({ ...goodsTables(), pincodes: [{ pincode: '400099', district: 'Daman', city: 'Daman', state_code: '26', state_name: 'Dadra and Nagar Haveli and Daman and Diu' }] });
    expect((await lookupPincode('400099'))?.state_code).toBe('26');
    expect((await lookupPincode('400100'))?.state_code).toBe('27');
  });

  it('knows nothing about an unmapped prefix, and rejects a malformed pin', async () => {
    expect(await lookupPincode('999999')).toBeNull();
    expect(await lookupPincode('12345')).toBeNull();
    expect(await lookupPincode('0123456')).toBeNull();
    expect(await lookupPincode('abcdef')).toBeNull();
    expect(isPincode('400001')).toBe(true);
    expect(isPincode('040001')).toBe(false);
  });

  it('pincodeFromPrefix is pure', () => {
    const map = new Map(PREFIXES.map(p => [p.prefix, p]));
    expect(pincodeFromPrefix('411057', map)?.state_name).toBe('Maharashtra');
    expect(pincodeFromPrefix('222222', map)).toBeNull();
  });
});

describe('GET /public/pincode/:pin', () => {
  const app = testApp();

  it('answers with the state, without a sign-in', async () => {
    const res = await request(app).get('/api/v1/public/pincode/400001');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pincode: '400001', state_code: '27', state_name: 'Maharashtra', district: 'Mumbai' });
    const prefix = await request(app).get('/api/v1/public/pincode/110001');
    expect(prefix.body).toEqual({ pincode: '110001', state_code: '07', state_name: 'Delhi' });
  });

  it('400 for a bad pin and 404 for one it cannot place', async () => {
    expect((await request(app).get('/api/v1/public/pincode/4000')).status).toBe(400);
    expect((await request(app).get('/api/v1/public/pincode/999999')).status).toBe(404);
  });
});
