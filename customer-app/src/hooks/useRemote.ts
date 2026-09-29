import { useCallback, useEffect, useRef, useState } from 'react';
import { translateNow } from '../locales';

interface Settled<T> {
  id: string;
  data?: T;
  error?: string;
}


/**
 * Loads data from the API and reloads when `key` changes or `reload()` is
 * called. `loading` is derived from which request has settled, so no state is
 * set while an effect starts. `data` keeps the last good result while a new
 * request is loading (for pull-to-refresh).
 */
export function useRemote<T>(fetcher: () => Promise<T>, key: string, failure: string = translateNow('load_failed')) {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const fetcherRef = useRef(fetcher);
  const id = `${key}#${nonce}`;

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;
    fetcherRef.current().then(
      (data) => {
        if (!cancelled) setSettled({ id, data });
      },
      (e: any) => {
        if (!cancelled) setSettled((prev) => ({ id, data: prev?.data, error: e?.message || failure }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, failure]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const loading = settled?.id !== id;
  return { data: settled?.data, error: loading ? undefined : settled?.error, loading, reload };
}
