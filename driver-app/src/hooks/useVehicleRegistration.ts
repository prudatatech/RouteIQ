/**
 * Where the driver's vehicle registration stands (none, pending, approved,
 * rejected). While it waits for approval the answer is re-read every 10 s, when
 * the app comes back to the front, and when the vehicle row changes (Supabase
 * Realtime, when it is enabled for the table), so an approval or rejection shows
 * up without the driver doing anything.
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type MyVehicleRegistration } from '../services/api';
import { supabase } from '../services/supabase';

export const REGISTRATION_KEY = ['vehicleRegistration'] as const;
const POLL_MS = 10_000;

export function useVehicleRegistration() {
  const queryClient = useQueryClient();
  const query = useQuery<MyVehicleRegistration>({
    queryKey: REGISTRATION_KEY,
    queryFn: () => api.getMyVehicleRegistration(),
    refetchInterval: (q) => (q.state.data?.state === 'pending' ? POLL_MS : false),
    retry: 1,
  });

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    const refresh = () => queryClient.invalidateQueries({ queryKey: REGISTRATION_KEY });

    api.getDriverInfo().then((info) => {
      if (cancelled || !info?.id) return;
      channel = supabase
        .channel(`vehicle-registration-${info.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles', filter: `driver_id=eq.${info.id}` }, refresh)
        .subscribe();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    return () => {
      cancelled = true;
      appState.remove();
      if (channel) supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
}
