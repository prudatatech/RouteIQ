/**
 * Everything the driver can do to the current route. Each action calls the
 * same API as before and reports failures to the driver instead of dropping
 * them.
 */
import { useCallback } from 'react';
import { Alert, Linking } from 'react-native';
import { api, ApiError } from '../services/api';
import type { DriverRoute, LatLng, RouteStop } from '../types/route';
import { errorMessage } from '../utils/errors';
import { fullRouteUrl, openTurnByTurn } from '../utils/navigation';
import { ARRIVAL_RADIUS_M, distanceMeters, stopCoord } from '../utils/route';
import type { FailureReason } from '../components/modals/IssueDialog';
import type { PodInput } from '../services/podUpload';
import { actionQueue } from '../services/actionQueue';
import { useTranslation } from './useTranslation';

interface Options {
  route: DriverRoute | undefined;
  activeVehicleId: string | null;
  activeVehicle: { capacity_kg?: number | null } | null;
  currentLoc: LatLng | null;
  isTracking: boolean;
  refresh: () => Promise<unknown>;
  startTracking: () => Promise<boolean>;
  /** Open the proof-of-delivery form for a stop. */
  openPod: (stop: RouteStop) => void;
  /** Open the "why could this stop not be completed" form for a stop. */
  openIssue: (stop: RouteStop) => void;
  /** Show the live backhaul offers popup. */
  showBackhaulPopup: () => void;
}

export function useRouteActions({
  route,
  activeVehicleId,
  activeVehicle,
  currentLoc,
  isTracking,
  refresh,
  startTracking,
  openPod,
  openIssue,
  showBackhaulPopup,
}: Options) {
  const { t } = useTranslation();

  const startRoute = useCallback(async (): Promise<boolean> => {
    if (!route) return false;
    try {
      await api.startRoute(route.id);
      await refresh();
      return true;
    } catch (e) {
      Alert.alert(t('error'), errorMessage(e, t('start_route_failed')));
      return false;
    }
  }, [route, refresh, t]);

  const navigateTo = useCallback(
    async (stop: RouteStop) => {
      const target = stopCoord(stop);
      if (!target) {
        Alert.alert(t('no_destination_title'), t('no_destination_desc'));
        return;
      }
      if (!(await openTurnByTurn(target))) {
        Alert.alert(t('error'), t('open_maps_failed'));
      }
    },
    [t],
  );

  /** Google Maps through every remaining stop; starts live tracking first. */
  const openFullRoute = useCallback(async () => {
    if (!route) return;
    if (route.status === 'pending') {
      Alert.alert(t('journey_not_started_title'), t('journey_not_started_desc'));
      return;
    }
    if (!isTracking) await startTracking();
    const url = fullRouteUrl(route);
    if (!url) {
      Alert.alert(t('no_destination_title'), t('no_stops_with_location'));
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('error'), t('open_maps_failed'));
    }
  }, [route, isTracking, startTracking, t]);

  /** Runs `action` at the stop, or after the driver confirms when they are not near it. */
  const atStop = useCallback(
    (stop: RouteStop, action: () => void) => {
      const target = stopCoord(stop);
      if (!target) {
        action();
        return;
      }
      if (!currentLoc) {
        Alert.alert(t('alert_gps_req_title'), t('alert_gps_req_desc'));
        return;
      }
      const dist = distanceMeters(currentLoc, target);
      if (dist > ARRIVAL_RADIUS_M) {
        Alert.alert(t('alert_geofence_title'), `${t('alert_geofence_desc')} (${Math.round(dist)} m)`, [
          { text: t('cancel'), style: 'cancel' },
          { text: t('continue_anyway'), onPress: action },
        ]);
      } else {
        action();
      }
    },
    [currentLoc, t],
  );

  const confirmAtStop = useCallback((stop: RouteStop) => atStop(stop, () => openPod(stop)), [atStop, openPod]);

  /** Opens the reason form; submitIssue sends it. */
  const failStop = openIssue;

  /**
   * Marks the stop failed with the driver's reason. With no signal it is kept on
   * the phone and sent later; throws so the form can show any other error.
   */
  const submitIssue = useCallback(
    async (stop: RouteStop, reason: FailureReason, note: string) => {
      const outcome = await actionQueue.submit('fail_stop', {
        stopId: stop.id,
        reason,
        ...(note ? { note } : {}),
        ...(currentLoc ? { lat: currentLoc.lat, lng: currentLoc.lng } : {}),
      }).catch(async (e) => {
        // Dispatch changed the stop (for example cancelled the delivery): show the route as it is now
        if (e instanceof ApiError && e.status === 409) await refresh();
        throw e;
      });
      if (outcome.status === 'queued') Alert.alert(t('queue_saved_title'), t('queue_saved_desc'));
      else {
        Alert.alert(t('alert_reported_title'), t('alert_reported_desc'));
        refresh();
      }
    },
    [currentLoc, refresh, t],
  );

  const findReturnLoad = useCallback(async () => {
    if (!activeVehicleId) return;
    const capacity = activeVehicle?.capacity_kg;
    if (!capacity) {
      Alert.alert(t('error'), t('capacity_unknown'));
      return;
    }
    try {
      await api.openBackhaulWindow(activeVehicleId, capacity, 'return_trip');
      showBackhaulPopup();
    } catch (e) {
      Alert.alert(t('error'), errorMessage(e, t('return_load_failed')));
    }
  }, [activeVehicleId, activeVehicle, showBackhaulPopup, t]);

  /**
   * Proof of delivery. Uploads the photo and signature, then sends the receiver's
   * name, the file paths and the current position as one completion. With no
   * signal the whole thing, files included, is kept on the phone and sent later.
   * Throws so the form can show any other error.
   */
  const completeStop = useCallback(
    async (stop: RouteStop, pod: PodInput) => {
      const outcome = await actionQueue.submit('complete_stop', {
        stopId: stop.id,
        receiverName: pod.receiverName,
        photoUri: pod.photoUri,
        signatureUri: pod.signatureUri,
        ...(currentLoc ? { lat: currentLoc.lat, lng: currentLoc.lng } : {}),
      }).catch(async (e) => {
        // "This delivery was cancelled by dispatch": the form shows the server's message, and the
        // route is reloaded so the cancelled stop is gone
        if (e instanceof ApiError && e.status === 409) await refresh();
        throw e;
      });
      if (outcome.status === 'queued') {
        Alert.alert(t('queue_saved_title'), t('queue_saved_desc'));
        return;
      }
      await refresh();
      if (outcome.result?.route_completed) {
        Alert.alert(t('alert_route_completed_title'), t('alert_route_completed_desc'), [
          { text: t('no'), style: 'cancel' },
          { text: t('yes_find_cargo'), onPress: findReturnLoad },
        ]);
      } else {
        Alert.alert(t('stop_completed_title'), t('stop_completed_desc'));
      }
    },
    [currentLoc, refresh, findReturnLoad, t],
  );

  const declareCapacity = useCallback(
    async (percentage: number) => {
      if (!activeVehicleId) return;
      const outcome = await actionQueue.submit('declare_load', { vehicleId: activeVehicleId, percentage });
      if (outcome.status === 'queued') Alert.alert(t('queue_saved_title'), t('queue_saved_desc'));
      else Alert.alert(t('load_declared_title'), `${t('load_declared_desc')} ${percentage}%`);
    },
    [activeVehicleId, t],
  );

  return {
    startRoute,
    navigateTo,
    openFullRoute,
    confirmAtStop,
    failStop,
    submitIssue,
    findReturnLoad,
    completeStop,
    declareCapacity,
  };
}
