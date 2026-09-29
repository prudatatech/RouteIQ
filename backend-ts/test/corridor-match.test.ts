import { describe, expect, it } from 'vitest';
import { corridorMatches, corridorRate, formatRate, normalizePlace, parseLegacyRate, parseRate, priceAtRate, splitCorridorName } from '../src/utils/corridor-match';

describe('corridor names', () => {
  it.each([
    ['DEL-BOM', ['DEL', 'BOM']],
    ['Pune to Mumbai', ['Pune', 'Mumbai']],
    ['Maharashtra – Gujarat', ['Maharashtra', 'Gujarat']],
    ['Pune → Nashik', ['Pune', 'Nashik']],
  ])('splits %s', (name, sides) => {
    expect(splitCorridorName(name)).toEqual(sides);
  });

  it.each(['Mumbai', 'A-B-C', '', null])('does not split %j', name => {
    expect(splitCorridorName(name)).toBeNull();
  });
});

describe('corridor matching', () => {
  it('matches city names in any case and spacing', () => {
    expect(corridorMatches('Pune to Mumbai', '  PUNE,  Maharashtra', 'mumbai')).toBe(true);
  });

  it('matches state names', () => {
    expect(corridorMatches('Maharashtra-Gujarat', 'Bhiwandi, Maharashtra 421302', 'Vapi, Gujarat')).toBe(true);
  });

  it('reads lane codes as the city they stand for', () => {
    expect(corridorMatches('DEL-BOM', 'Okhla, New Delhi', 'Andheri, Mumbai')).toBe(true);
    expect(corridorMatches('BLR-MAA', 'Bangalore', 'Chennai')).toBe(true);
    expect(corridorMatches('BLR-MAA', 'Bengaluru Urban', 'Chennai')).toBe(true);
  });

  it('respects direction', () => {
    expect(corridorMatches('DEL-BOM', 'Mumbai', 'Delhi')).toBe(false);
  });

  it('does not match part of a word', () => {
    expect(corridorMatches('Pune to Mumbai', 'Punechi Wadi', 'Mumbai')).toBe(false);
  });

  it('does not match when a place is empty', () => {
    expect(corridorMatches('DEL-BOM', '', 'Mumbai')).toBe(false);
    expect(normalizePlace(undefined)).toBe('');
  });
});

describe('rates', () => {
  it.each([
    ['41200', 41200],
    ['₹41,200', 41200],
    ['1500.50 per trip', 1500.5],
    [2500, 2500],
  ])('reads %j', (input, rate) => {
    expect(parseRate(input)).toBe(rate);
  });

  it.each(['', 'on request', '0', null, -5, 'Base + 12%', '12% over base', 'about 4000 or so', '₹22 per km'])('has no per-trip rate in %j', input => {
    expect(parseRate(input)).toBeNull();
  });

  it('reads a legacy rate in km only when that is all the text says', () => {
    expect(parseLegacyRate('₹22 per km')).toEqual({ amount: 22, unit: 'per_km' });
    expect(parseLegacyRate('22/km')).toEqual({ amount: 22, unit: 'per_km' });
    expect(parseLegacyRate('₹1,500 per trip')).toEqual({ amount: 1500, unit: 'per_trip' });
    expect(parseLegacyRate('Base + 12%')).toBeNull();
    expect(parseLegacyRate('22 per km plus tolls')).toBeNull();
  });

  it('prefers the numeric columns over the legacy text', () => {
    expect(corridorRate({ rate_amount: 30, rate_unit: 'per_km', proposed_rate: 'Base + 12%' })).toEqual({ amount: 30, unit: 'per_km' });
    expect(corridorRate({ rate_amount: null, rate_unit: null, proposed_rate: '₹41,200' })).toEqual({ amount: 41200, unit: 'per_trip' });
    expect(corridorRate({ rate_amount: 30, rate_unit: 'per_mile', proposed_rate: null })).toBeNull();
    expect(corridorRate({ proposed_rate: 'on request' })).toBeNull();
  });

  it('prices per trip as is and per km from the distance', () => {
    expect(priceAtRate({ amount: 41200, unit: 'per_trip' }, null)).toBe(41200);
    expect(priceAtRate({ amount: 22, unit: 'per_km' }, 150.5)).toBe(3311);
    expect(priceAtRate({ amount: 22, unit: 'per_km' }, null)).toBeNull();
    expect(priceAtRate(null, 100)).toBeNull();
    expect(formatRate({ amount: 41200, unit: 'per_trip' })).toBe('₹41,200 per trip');
    expect(formatRate({ amount: 22, unit: 'per_km' })).toBe('₹22 per km');
  });
});
