import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type MyPeople } from '../services/api';

/** The driver's own documents and emergency contacts, loaded once and reloadable. */
export function useMyPeople() {
  const [data, setData] = useState<MyPeople | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getMyPeople();
      if (alive.current) setData(next);
    } catch (e: any) {
      if (alive.current) setError(e?.message || 'error');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { data, loading, error, reload };
}
