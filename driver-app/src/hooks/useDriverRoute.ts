/**
 * Driver session data for the home screen: driver profile, assigned vehicle,
 * current route, pending assignments and sync state.
 *
 * Sources (unchanged from the original screen):
 * - GET my-route through React Query, cached in AsyncStorage for a fast start;
 * - Supabase: vehicle discovery and unanswered driver_confirmations;
 * - Supabase Realtime for new routes, manifests, confirmations and dispatch
 *   calls, with a 15 s poll as a fallback when Realtime drops.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { locationService } from '../services/location';
import { supabase } from '../services/supabase';
import type { MyRouteResponse } from '../types/route';
import { isNetworkError } from '../utils/errors';

const CACHED_ROUTE_KEY = 'cached_route';
const LAST_SEEN_ROUTE_KEY = 'last_seen_route_id';
const POLL_MS = 15000;
/** "Not now" on a new route keeps the prompt (and its siren) away this long. */
const SNOOZE_KEY = 'route_snoozed_until';
export const ROUTE_SNOOZE_MS = 10 * 60 * 1000;

async function readSnoozes(): Promise<Record<string, number>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(SNOOZE_KEY)) ?? '{}');
  } catch {
    return {};
  }
}

async function isSnoozed(routeId: string): Promise<boolean> {
  return ((await readSnoozes())[routeId] ?? 0) > Date.now();
}


export type SyncState = 'ok' | 'offline' | 'failed';

export interface PendingRoute {
  id: string;
  status?: string;
  route_type?: string;
  stops?: unknown[];
}

export interface IncomingCall {
  caller: string;
}

export function useDriverRoute() {
  const [driverInfo, setDriverInfo] = useState<any>(null);
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
  const [activeVehicle, setActiveVehicle] = useState<any>(null);
  const [routeData, setRouteData] = useState<MyRouteResponse | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<any>(null);
  const [pendingRoute, setPendingRouteState] = useState<PendingRoute | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [noVehicle, setNoVehicle] = useState(false);
  const pendingRouteRef = useRef<PendingRoute | null>(null);

  const setPendingRoute = (route: PendingRoute | null) => {
    pendingRouteRef.current = route;
    setPendingRouteState(route);
  };

  const routeQuery = useQuery({
    queryKey: ['myRoute'],
    queryFn: () => api.getMyRoute() as Promise<MyRouteResponse>,
    staleTime: 10000,
    retry: 1,
  });
  const { data: routeDataQ, refetch: refetchRoute } = routeQuery;

  useEffect(() => {
    if (routeDataQ) {
      setRouteData(routeDataQ);
      AsyncStorage.setItem(CACHED_ROUTE_KEY, JSON.stringify(routeDataQ)).catch(() => {});
    }
  }, [routeDataQ]);

  // Load from cache on mount for instant state recovery
  useEffect(() => {
    AsyncStorage.getItem(CACHED_ROUTE_KEY).then((data) => {
      if (!data) return;
      try {
        const cached = JSON.parse(data);
        setRouteData((current) => current ?? cached);
      } catch {}
    });
  }, []);

  const loadData = useCallback(async (): Promise<string | null> => {
    try {
      const info = await api.getDriverInfo();
      setDriverInfo(info);

      let vehicleId: string | null = null;
      // Auto-discover vehicle from Supabase for GPS tracking
      if (info?.id) {
        vehicleId = await locationService.autoDiscoverVehicle(info.id);
        if (vehicleId) {
          setActiveVehicleId(vehicleId);
          try {
            setActiveVehicle(await api.getVehicleInfo(vehicleId));
          } catch {}
        }
      }

      const { data: route, error: routeErr } = await refetchRoute();
      if (route) {
        setNoVehicle(false);
        setRouteData(route);
        await AsyncStorage.setItem(CACHED_ROUTE_KEY, JSON.stringify(route));

        const r = route.route;
        if (r && (r.status === 'active' || r.status === 'pending')) {
          const lastSeenId = await AsyncStorage.getItem(LAST_SEEN_ROUTE_KEY);
          if (r.id !== lastSeenId && pendingRouteRef.current?.id !== r.id && !(await isSnoozed(r.id))) {
            setPendingRoute(r);
          }
        }
      } else if (routeErr) {
        // No vehicle is a real state, not a sync failure: drop the stale route.
        // Other failures keep the cached route on screen and show as a sync problem.
        const vehicleMissing = String((routeErr as Error).message ?? '').includes('No vehicle assigned');
        setNoVehicle(vehicleMissing);
        if (vehicleMissing) {
          setRouteData(null);
          await AsyncStorage.removeItem(CACHED_ROUTE_KEY);
        }
      }

      // Check for pending confirmations
      if (vehicleId) {
        const { data: confs } = await supabase
          .from('driver_confirmations')
          .select('*, route_stops(delivery_points(name))')
          .eq('vehicle_id', vehicleId)
          .is('action', null)
          .order('prompted_at', { ascending: false })
          .limit(1);

        if (confs && confs.length > 0) {
          setPendingConfirmation(confs[0]);
          // Acknowledge delivery of the prompt if not already acknowledged
          if (!confs[0].delivered_at) {
            await api.ackStop(confs[0].id);
          }
        } else {
          setPendingConfirmation(null);
        }
      }

      return vehicleId;
    } catch (e) {
      console.warn('[home] loadData failed:', e);
      return null;
    }
  }, [refetchRoute]);

  // Realtime subscriptions and polling fallback
  useEffect(() => {
    let routeSub: ReturnType<typeof supabase.channel> | null = null;
    let confirmationsSub: ReturnType<typeof supabase.channel> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    api.init().then(async () => {
      const vId = await loadData();
      if (cancelled) return;

      if (vId) {
        routeSub = supabase
          .channel(`driver-route-events-${vId}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'routes', filter: `vehicle_id=eq.${vId}` }, async (payload) => {
            if (!(await isSnoozed(payload.new.id))) setPendingRoute(payload.new as PendingRoute);
            loadData();
          })
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'routes', filter: `vehicle_id=eq.${vId}` }, () => {
            loadData();
          })
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'cargo_manifest', filter: `vehicle_id=eq.${vId}` },
            (payload) => {
              // Map the manifest to the route shape used by the assignment prompt
              setPendingRoute({
                id: payload.new.id,
                status: payload.new.status === 'scheduled' ? 'pending' : 'in_progress',
                route_type: payload.new.route_type || 'forward',
                stops: [],
              });
              loadData();
            },
          )
          .subscribe();

        confirmationsSub = supabase
          .channel(`driver-confs-${vId}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'driver_confirmations', filter: `vehicle_id=eq.${vId}` },
            async (payload) => {
              // The assignment dialog shows it; no separate alert.
              setPendingConfirmation(payload.new);
              try {
                await api.ackStop(payload.new.id);
              } catch (e) {
                console.warn('[home] ackStop failed:', e);
              }
              loadData();
            },
          )
          .on('broadcast', { event: 'INCOMING_DISPATCH_CALL' }, (payload) => {
            setIncomingCall(payload.payload || { caller: 'Dispatch' });
          })
          .subscribe();
      } else {
        console.warn('[Realtime] No vehicle ID found — skipping Supabase subscriptions');
      }

      // Polling fallback so drivers still get new routes if Realtime drops
      pollInterval = setInterval(loadData, POLL_MS);
    });

    return () => {
      cancelled = true;
      if (routeSub) supabase.removeChannel(routeSub);
      if (confirmationsSub) supabase.removeChannel(confirmationsSub);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [loadData]);

  /** Driver accepted the new route or the inserted stop. */
  const acceptAssignment = useCallback(async (): Promise<'stop' | 'route' | null> => {
    if (pendingConfirmation) {
      const { error } = await supabase
        .from('driver_confirmations')
        .update({ action: 'confirmed', responded_at: new Date().toISOString() })
        .eq('id', pendingConfirmation.id);
      if (error) throw error;
      setPendingConfirmation(null);
      loadData();
      return 'stop';
    }
    if (pendingRouteRef.current) {
      await AsyncStorage.setItem(LAST_SEEN_ROUTE_KEY, pendingRouteRef.current.id);
      setPendingRoute(null);
      loadData();
      return 'route';
    }
    return null;
  }, [pendingConfirmation, loadData]);

  /** Flags an inserted stop to dispatch. */
  const flagConfirmation = useCallback(async () => {
    if (!pendingConfirmation) return;
    await api.flagStop(pendingConfirmation.id);
    setPendingConfirmation(null);
    loadData();
  }, [pendingConfirmation, loadData]);

  /**
   * "Not now" on a new route: hides the prompt for 10 minutes (kept across app
   * restarts) and lets dispatch know. It comes back after that until accepted.
   */
  const postponeRoute = useCallback(async () => {
    const route = pendingRouteRef.current;
    setPendingRoute(null);
    if (!route) return;
    try {
      const snoozes = await readSnoozes();
      const now = Date.now();
      for (const id of Object.keys(snoozes)) if (snoozes[id] <= now) delete snoozes[id];
      snoozes[route.id] = now + ROUTE_SNOOZE_MS;
      await AsyncStorage.setItem(SNOOZE_KEY, JSON.stringify(snoozes));
    } catch (e) {
      console.warn('[home] could not save the snooze:', e);
    }
    api.postponeRoute(route.id).catch((e) => console.warn('[home] postponeRoute failed:', e));
  }, []);

  const lastError = routeQuery.isError ? routeQuery.error : null;
  const syncState: SyncState =
    !lastError || noVehicle ? 'ok' : isNetworkError(lastError) ? 'offline' : 'failed';

  return {
    driverInfo,
    setDriverInfo,
    activeVehicleId,
    activeVehicle,
    routeData,
    noVehicle,
    pendingRoute,
    pendingConfirmation,
    incomingCall,
    setIncomingCall,
    refresh: loadData,
    acceptAssignment,
    flagConfirmation,
    postponeRoute,
    syncState,
    isRefreshing: routeQuery.isFetching,
    lastSyncedAt: routeQuery.dataUpdatedAt || null,
  };
}
