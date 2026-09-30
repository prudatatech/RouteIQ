import { describe, expect, it } from 'vitest';
import {
  CARGO_MANIFEST_TRANSITIONS, SHIPMENT_TRANSITIONS, CUSTODY_ONLY_SHIPMENT_STATUSES, SHIPMENT_PATCH_STATUSES,
  assertShipmentTransition, canTransition,
} from '../src/core/transitions';
import { addPieces, assertPieces, manifestStatusFor, piecesHeld, type Pieces } from '../src/services/cargo/consignment';
import { EXCEPTION_TRANSITIONS, SLA_HOURS, makeCode, slaDueAt } from '../src/services/cargo/exception.service';
import { CLAIM_TRANSITIONS } from '../src/services/cargo/claim.service';
import enums from './support/db-enums.json';

describe('shipment state machine (docs/cargo-plan.md)', () => {
  const contract: Record<string, string[]> = {
    created: ['assigned', 'picked_up', 'on_hold', 'exception', 'cancelled'],
    assigned: ['created', 'picked_up', 'on_hold', 'exception', 'cancelled'],
    picked_up: ['in_transit', 'at_hub', 'on_hold', 'exception', 'out_for_delivery', 'delivered', 'partially_delivered', 'lost'],
    in_transit: ['out_for_delivery', 'at_hub', 'on_hold', 'exception', 'delivered', 'partially_delivered', 'lost'],
    out_for_delivery: ['delivered', 'partially_delivered', 'exception', 'on_hold', 'returning', 'lost'],
    at_hub: ['in_transit', 'out_for_delivery', 'on_hold', 'exception', 'returning', 'lost'],
    on_hold: ['in_transit', 'at_hub', 'out_for_delivery', 'returning', 'exception', 'lost', 'assigned', 'created'],
    exception: ['assigned', 'picked_up', 'in_transit', 'out_for_delivery', 'at_hub', 'on_hold', 'returning', 'delivered', 'partially_delivered', 'cancelled', 'lost'],
    partially_delivered: ['returning', 'out_for_delivery', 'delivered', 'on_hold'],
    returning: ['returned', 'at_hub', 'exception', 'lost', 'on_hold'],
  };

  it('allows exactly the moves of the contract (plus holding goods already on their way back or partly delivered)', () => {
    for (const [from, allowed] of Object.entries(contract)) {
      expect([...SHIPMENT_TRANSITIONS[from]].sort()).toEqual([...allowed].sort());
    }
  });

  it('has a rule for every status the database allows, and final states go nowhere', () => {
    expect(Object.keys(SHIPMENT_TRANSITIONS).sort()).toEqual([...enums['shipments.status']].sort());
    for (const final of ['delivered', 'returned', 'lost', 'cancelled']) expect(SHIPMENT_TRANSITIONS[final]).toEqual([]);
  });

  it('no longer lets goods skip the pickup or jump from created to delivered', () => {
    expect(canTransition(SHIPMENT_TRANSITIONS, 'created', 'delivered')).toBe(false);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'assigned', 'in_transit')).toBe(false);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'in_transit', 'returning')).toBe(false);
  });

  it('lets held or failed goods go back to the queue or be cancelled only if they were never picked up', () => {
    expect(() => assertShipmentTransition('on_hold', 'assigned', { pickedUp: false })).not.toThrow();
    expect(() => assertShipmentTransition('on_hold', 'created', { pickedUp: true })).toThrow(/already picked up/);
    expect(() => assertShipmentTransition('exception', 'cancelled', { pickedUp: false })).not.toThrow();
    expect(() => assertShipmentTransition('exception', 'cancelled', { pickedUp: true })).toThrow(/already picked up/);
    expect(() => assertShipmentTransition('delivered', 'returning', { pickedUp: true })).toThrow(/can't be changed/);
  });

  it('keeps every move after pickup off the raw status PATCH', () => {
    expect([...SHIPMENT_PATCH_STATUSES].sort()).toEqual(['cancelled', 'created', 'picked_up']);
    for (const s of ['in_transit', 'out_for_delivery', 'delivered', 'partially_delivered', 'at_hub']) {
      expect(CUSTODY_ONLY_SHIPMENT_STATUSES).toContain(s);
    }
  });
});

describe('vendor load (cargo manifest) state machine', () => {
  it('uses the smaller set the database check allows', () => {
    expect(Object.keys(CARGO_MANIFEST_TRANSITIONS).sort()).toEqual([...enums['cargo_manifest.status']].sort());
  });

  it('cannot cancel goods on a truck, and mirrors shipment statuses', () => {
    expect(canTransition(CARGO_MANIFEST_TRANSITIONS, 'in_transit', 'cancelled')).toBe(false);
    expect(canTransition(CARGO_MANIFEST_TRANSITIONS, 'in_transit', 'on_hold')).toBe(true);
    expect(canTransition(CARGO_MANIFEST_TRANSITIONS, 'returning', 'returned')).toBe(true);
    expect(manifestStatusFor('picked_up')).toBe('in_transit');
    expect(manifestStatusFor('out_for_delivery')).toBe('in_transit');
    expect(manifestStatusFor('assigned')).toBe('scheduled');
    expect(manifestStatusFor('at_hub')).toBe('on_hold');
    expect(manifestStatusFor('partially_delivered')).toBe('exception');
    expect(manifestStatusFor('delivered')).toBe('delivered');
  });
});

describe('exception, claim and SLA rules', () => {
  it('moves a case open, investigating, action planned, resolved, and closes it from any open state', () => {
    expect(EXCEPTION_TRANSITIONS.open).toEqual(expect.arrayContaining(['investigating', 'closed']));
    expect(EXCEPTION_TRANSITIONS.investigating).toEqual(expect.arrayContaining(['action_planned', 'closed']));
    expect(EXCEPTION_TRANSITIONS.action_planned).toEqual(expect.arrayContaining(['resolved', 'closed']));
    expect(EXCEPTION_TRANSITIONS.resolved).toEqual(['closed']);
    expect(EXCEPTION_TRANSITIONS.closed).toEqual([]);
  });

  it('gives each severity its SLA', () => {
    expect(SLA_HOURS).toEqual({ critical: 1, high: 4, medium: 24, low: 72 });
    const from = new Date('2026-09-30T00:00:00Z');
    expect(slaDueAt('critical', from)).toBe('2026-09-30T01:00:00.000Z');
    expect(slaDueAt('low', from)).toBe('2026-10-03T00:00:00.000Z');
  });

  it('files, surveys, approves or rejects, then settles a claim', () => {
    expect(CLAIM_TRANSITIONS.draft).toEqual(['filed', 'withdrawn']);
    expect(CLAIM_TRANSITIONS.approved).toEqual(['settled']);
    expect(CLAIM_TRANSITIONS.rejected).toEqual([]);
    expect(CLAIM_TRANSITIONS.settled).toEqual([]);
  });

  it('makes human-readable codes', () => {
    expect(makeCode('EXC')).toMatch(/^EXC-[A-Z2-9]{6}$/);
    expect(makeCode('TRF')).toMatch(/^TRF-[A-Z2-9]{6}$/);
    expect(makeCode('CLM')).toMatch(/^CLM-[A-Z2-9]{6}$/);
  });
});

describe('piece invariants', () => {
  const p = (over: Partial<Pieces> = {}): Pieces => ({ total: 10, delivered: 0, damaged: 0, short: 0, returned: 0, ...over });

  it('counts what is still held', () => {
    expect(piecesHeld(p({ delivered: 6, short: 1, returned: 1 }))).toBe(2);
    expect(piecesHeld(p({ total: null }))).toBeNull();
  });

  it('never goes negative', () => {
    expect(() => assertPieces(p({ delivered: -1 }))).toThrow(/negative/);
    expect(() => addPieces(p({ short: 1 }), { short: -2 })).toThrow(/negative/);
    expect(() => assertPieces(p({ total: -1 }))).toThrow(/negative/);
  });

  it('never accounts for more than the total', () => {
    expect(() => addPieces(p({ delivered: 8 }), { short: 3 })).toThrow(/accounts for 11 pieces/);
    expect(() => addPieces(p(), { delivered: 7, short: 2, returned: 1 })).not.toThrow();
    expect(() => addPieces(p(), { delivered: 7, short: 2, returned: 2 })).toThrow();
  });

  it('counts damaged pieces within the delivered or returned ones', () => {
    expect(() => addPieces(p(), { delivered: 3, damaged: 3 })).not.toThrow();
    expect(() => addPieces(p(), { delivered: 3, damaged: 4 })).toThrow(/Damaged/);
    expect(() => addPieces(p({ returned: 2 }), { delivered: 1, damaged: 3 })).not.toThrow();
  });

  it('leaves the counters alone when the total is unknown', () => {
    expect(() => addPieces(p({ total: null }), { delivered: 50 })).not.toThrow();
  });
});
