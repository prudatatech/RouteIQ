import { describe, expect, it } from 'vitest';
import { corridorMatches, normalizePlace, parseRate, splitCorridorName } from '../src/utils/corridor-match';

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

  it.each(['', 'on request', '0', null, -5])('has no rate in %j', input => {
    expect(parseRate(input)).toBeNull();
  });
});
