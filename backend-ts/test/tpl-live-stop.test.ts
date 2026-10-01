import { describe, expect, it } from 'vitest';
import { hasLiveStop } from '../src/services/tpl-network.service';

describe('hasLiveStop (is the shipment still on a trip)', () => {
  it('counts a pending stop on a live trip', () => {
    expect(hasLiveStop([{ status: 'pending', routes: { status: 'pending' } }])).toBe(true);
  });

  it('ignores a cancelled stop and a cancelled trip, so a shipment taken off its vehicle can go to a partner', () => {
    expect(hasLiveStop([{ status: 'cancelled', routes: { status: 'cancelled' } }])).toBe(false);
    expect(hasLiveStop([{ status: 'pending', routes: { status: 'cancelled' } }])).toBe(false);
    expect(hasLiveStop([{ status: 'cancelled', routes: { status: 'pending' } }])).toBe(false);
    expect(hasLiveStop([])).toBe(false);
  });

  it('still counts a live stop next to a cancelled one', () => {
    expect(hasLiveStop([{ status: 'cancelled' }, { status: 'pending', routes: [{ status: 'active' }] }])).toBe(true);
  });
});
