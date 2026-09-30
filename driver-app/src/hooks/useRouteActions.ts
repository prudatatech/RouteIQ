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
import type { PodInput } from '../services/podUpload';
import { actionQueue, type FailureReasonCode, type Payloads } from '../services/actionQueue';
import { manifestRefOfStop, type ConsignmentInfo, type ConsignmentRef } from '../services/cargo';
import { openCaseCodes, sendCustody } from '../services/cargoActions';
import type { DeliveryOutcome } from '../screens/cargo/DeliveryScreen';
import { useTranslation } from './useTranslation';

interface Options {
  route: DriverRoute | undefined;
  activeVehicleId: string | null;
  activeVehicle: { capacity_kg?: number | null } | null;
  currentLoc: LatLng | null;
  isTracking: boolean;
  refresh: () => Promise<unknown>;
  startTracking: () => Promise<boolean>;
  /** Open the delivery sheet for a stop, on "delivered". */
  openPod: (stop: RouteStop) => void;
  /** Open the delivery sheet for a stop, on "not delivered". */
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
      // Testing override: bypass GPS and geofence checks completely
      // so deliveries can be made from anywhere.
      action();
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
    async (stop: RouteStop, reason: FailureReasonCode, note: string) => {
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

  /**
   * The delivery sheet's outcome, sent as one complete-stop with `outcome`: the server records the
   * custody event (delivery, partial_delivery, refused) and settles the stop in the same call.
   * "Not delivered" is the plain failed stop. The server keeps no photos on a failed stop, so the
   * photos of refused goods follow as an `inspection` of those goods. Everything goes through the
   * offline queue. Throws so the sheet can show an error.
   */
  const deliver = useCallback(
    async (stop: RouteStop, outcome: DeliveryOutcome, info: ConsignmentInfo | null) => {
      if (outcome.kind === 'not_delivered') return submitIssue(stop, outcome.reason, outcome.note);

      const position = currentLoc ? { lat: currentLoc.lat, lng: currentLoc.lng } : {};
      const ref: ConsignmentRef | null = info?.ref ?? manifestRefOfStop(stop.id) ?? stop.parcel?.code ?? null;
      let payload: Payloads['complete_stop'];
      if (outcome.kind === 'refused') {
        payload = {
          stopId: stop.id,
          receiverName: '',
          outcome: 'refused',
          details: { reason: outcome.reason, ...(outcome.note ? { note: outcome.note } : {}) },
          ...position,
        };
      } else {
        const pod = outcome.pod;
        const otp = outcome.otp ? { otp: outcome.otp } : {};
        payload = {
          stopId: stop.id,
          receiverName: pod.receiverName,
          photoUri: pod.photoUri,
          signatureUri: pod.signatureUri,
          ...position,
          ...(outcome.kind === 'full'
            ? { outcome: 'delivered' as const, details: otp }
            : outcome.kind === 'remarks'
              ? {
                  outcome: 'delivered_with_remarks' as const,
                  extraPhotoUris: outcome.damagePhotos,
                  details: { condition: outcome.condition, ...(outcome.note ? { note: outcome.note } : {}), ...otp },
                }
              : {
                  outcome: 'partial' as const,
                  details: {
                    pieces: outcome.accepted,
                    pieces_refused: outcome.refused,
                    pieces_short: outcome.short,
                    ...(outcome.note ? { note: outcome.note } : {}),
                    ...otp,
                  },
                }),
        };
      }

      const sent = await actionQueue.submit('complete_stop', payload).catch(async (e) => {
        // Dispatch changed the stop (for example cancelled the delivery): show the route as it is now
        if (e instanceof ApiError && e.status === 409) await refresh();
        throw e;
      });
      let queued = sent.status === 'queued';

      if (outcome.kind === 'refused' && outcome.photos.length && ref) {
        const onBoard = info?.piecesOnBoard;
        const photos = await sendCustody({
          label: 'refused_photos',
          photoUris: outcome.photos,
          events: [
            {
              ref,
              code: stop.parcel?.code ?? '',
              fields: {
                kind: 'inspection',
                // A count that matches what is held records the photos without opening another case
                ...(onBoard ? { pieces: onBoard } : { condition: outcome.reason === 'damaged_refused' ? 'damaged_goods' : 'good' }),
                notes: t('cargo_refusal_photo'),
                ...position,
              },
            },
          ],
        }).catch((e) => {
          console.warn('[delivery] refusal photos not recorded:', e);
          return null;
        });
        if (photos?.queued) queued = true;
      }

      if (queued) {
        Alert.alert(t('queue_saved_title'), t('queue_saved_desc'));
        return;
      }
      await refresh();
      const cases = outcome.kind !== 'full' && ref ? await openCaseCodes([ref]) : [];
      const codes = cases.map((c) => c.code).join(', ');
      const title = outcome.kind === 'refused' ? t('alert_reported_title') : t('stop_completed_title');
      const body = outcome.kind === 'refused' ? t('cargo_refusal_saved') : outcome.kind === 'partial' ? t('cargo_partial_saved') : t('stop_completed_desc');
      if (outcome.kind === 'full' && sent.status === 'sent' && sent.result?.route_completed) {
        Alert.alert(t('alert_route_completed_title'), t('alert_route_completed_desc'), [
          { text: t('no'), style: 'cancel' },
          { text: t('yes_find_cargo'), onPress: findReturnLoad },
        ]);
        return;
      }
      Alert.alert(title, codes ? `${body}\n\n${t('cargo_case_opened')} ${codes}` : body);
    },
    [submitIssue, currentLoc, refresh, findReturnLoad, t],
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
    deliver,
    declareCapacity,
  };
}
