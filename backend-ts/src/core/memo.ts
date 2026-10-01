/**
 * Brief in-process cache for values that are the same for every user and change rarely
 * (settings, the company profile, the map tile token). Per instance, so it never replaces
 * Redis for anything that must agree across instances; a write path calls `.clear()`.
 *
 * A failed load is never cached, and callers that arrive while a load is running share it.
 */
type Clearable = { clear(): void };
const registry = new Set<Clearable>();

export interface Memo<T> {
  (): Promise<T>;
  clear(): void;
}

export function memoize<T>(ttlMs: number, load: () => Promise<T>): Memo<T> {
  let entry: { value: T; expiresAt: number } | null = null;
  let inflight: Promise<T> | null = null;
  let generation = 0;

  const get = (async () => {
    if (entry && entry.expiresAt > Date.now()) return entry.value;
    if (!inflight) {
      const started = generation;
      inflight = load()
        .then(value => {
          // A clear() during the load means the value may predate a write: serve it once, do not keep it
          if (started === generation) entry = { value, expiresAt: Date.now() + ttlMs };
          return value;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }) as Memo<T>;

  get.clear = () => { entry = null; inflight = null; generation++; };
  registry.add(get);
  return get;
}

/** Empties every memo. Tests call it when they reset the database fixtures. */
export function clearAllMemos(): void {
  for (const m of registry) m.clear();
}
