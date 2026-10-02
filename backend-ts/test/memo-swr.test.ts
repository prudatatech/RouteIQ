import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoize } from '../src/core/memo';

describe('memoize with staleWhileRevalidate', () => {
  afterEach(() => vi.useRealTimers());

  it('returns the expired value at once and swaps in the fresh one when it has loaded', async () => {
    vi.useFakeTimers();
    let n = 0;
    let release!: () => void;
    const load = vi.fn(async () => {
      n += 1;
      if (n === 2) await new Promise<void>(r => { release = r; });
      return n;
    });
    const get = memoize(1000, load, { staleWhileRevalidate: true });
    expect(await get()).toBe(1);
    vi.advanceTimersByTime(1500);
    expect(await get()).toBe(1); // stale, the refresh is still running
    expect(load).toHaveBeenCalledTimes(2);
    release();
    await vi.waitFor(async () => expect(await get()).toBe(2));
  });

  it('keeps the stale value when the refresh fails, and waits on the very first load', async () => {
    vi.useFakeTimers();
    let fail = false;
    const get = memoize(1000, async () => { if (fail) throw new Error('down'); return 'v1'; }, { staleWhileRevalidate: true });
    expect(await get()).toBe('v1');
    fail = true;
    vi.advanceTimersByTime(1500);
    expect(await get()).toBe('v1');
    const cold = memoize(1000, async () => { throw new Error('down'); }, { staleWhileRevalidate: true });
    await expect(cold()).rejects.toThrow('down');
  });
});
