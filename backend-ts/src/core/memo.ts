/**
 * Brief in-process cache for values that are the same for every user and change rarely
 * (settings, the company profile, the map tile token). Per instance, so it never replaces
 * Redis for anything that must agree across instances; a write path calls `.clear()`.
 *
 * A failed load is never cached, and callers that arrive while a load is running share it.
 */
type Clearable = { clear(): void };
const registry = new Set<Clearable>();

/** Registers any cache with a clear() so clearAllMemos() empties it too (tests rely on it between fixtures). */
export function registerClearable(c: Clearable): void {
  registry.add(c);
}

export interface Memo<T> {
  (): Promise<T>;
  clear(): void;
}

/**
 * `staleWhileRevalidate`: once a value exists, an expired one is still returned at once while a fresh load runs in
 * the background (for large values that are slow to load, such as the HSN index).
 */
export function memoize<T>(ttlMs: number, load: () => Promise<T>, opts: { staleWhileRevalidate?: boolean } = {}): Memo<T> {
  let entry: { value: T; expiresAt: number } | null = null;
  let inflight: Promise<T> | null = null;
  let generation = 0;

  const get = (async () => {
    if (entry && entry.expiresAt > Date.now()) return entry.value;
    const stale = opts.staleWhileRevalidate && entry ? entry.value : undefined;
    if (!inflight) {
      const started = generation;
      inflight = load()
        .then(value => {
          // A clear() during the load means the value may predate a write: serve it once, do not keep it
          if (started === generation) entry = { value, expiresAt: Date.now() + ttlMs };
          return value;
        })
        .finally(() => { inflight = null; });
      // A failed background refresh keeps the stale value; the next call tries again
      if (stale !== undefined) inflight.catch(() => undefined);
    }
    return stale !== undefined ? stale : inflight;
  }) as Memo<T>;

  get.clear = () => { entry = null; inflight = null; generation++; };
  registry.add(get);
  return get;
}

/** Empties every memo. Tests call it when they reset the database fixtures. */
export function clearAllMemos(): void {
  for (const m of registry) m.clear();
}
