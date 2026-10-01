/**
 * MargixIndia Driver App — Home
 *
 * Header (the notification bell and the one SOS button) and status strip stay
 * fixed; below them the Home tab opens with one "next action" card (utils/
 * nextAction decides it from the route, the cargo on board, transfers and
 * SOS), then the rest of the trip and the map, and a "More actions" sheet for
 * everything used less often. A tapped notification, from a push or the in-app
 * list, opens its exact place through handleIntent (utils/notificationTarget). Data and
 * behaviour live in hooks: useDriverRoute (route, assignments, sync),
 * useLocationTracking (GPS), useDeviceLocationStatus, useSnappedRoute,
 * useAlertSiren, useRouteActions, useSos, useCargo (what is on board,
 * transfers) and useModalManager (one dialog at a time).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, DeviceEventEmitter, KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { locationService } from '../services/location';
import { useTranslation } from '../hooks/useTranslation';
import { useDriverRoute } from '../hooks/useDriverRoute';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { useDeviceLocationStatus } from '../hooks/useDeviceLocationStatus';
import { useSnappedRoute } from '../hooks/useSnappedRoute';
import { useGpsOffEscalation } from '../hooks/useGpsOffEscalation';
import { useAlertSiren } from '../hooks/useAlertSiren';
import { useRouteActions } from '../hooks/useRouteActions';
import { useSos } from '../hooks/useSos';
import { useParcelScan, type ScanOutcome } from '../hooks/useParcelScan';
import { useCargoTransfers, useOnBoard } from '../hooks/useCargo';
import { useDriverStatus, DRIVER_STATUS_KEY } from '../hooks/useDriverStatus';
import { REGISTRATION_KEY } from '../hooks/useVehicleRegistration';
import { sendCustody, type CargoSendResult } from '../services/cargoActions';
import { manifestRefOfStop } from '../services/cargo';
import { dropLotsFor, type DropLot } from '../utils/dropLots';
import { useActionQueue } from '../hooks/useActionQueue';
import { useDispatchPhone } from '../hooks/useDispatchPhone';
import { withQueuedStops } from '../utils/queuedStops';
import { useDriverMessages } from '../hooks/useDriverMessages';
import { useModalManager, type ActiveModal } from '../hooks/useModalManager';
import type { RouteStop } from '../types/route';
import type { View as RNView } from 'react-native';
import { shortFeedback } from '../utils/feedback';
import { dial } from '../utils/dial';
import { isPickupStop } from '../utils/nextAction';
import { formatTime } from '../utils/format';
import { isRouteFinished, pendingStops, stopCounts } from '../utils/route';
import { getNextAction, restOfStops, type AssignmentWaiting } from '../utils/nextAction';
import { stopIdFor } from '../utils/notificationTarget';
import { OPEN_TARGET_EVENT, takePendingIntent, type DriverIntent } from '../services/driverLinks';
import BackhaulPopup from '../components/BackhaulPopup';
import SosButton from '../components/SosButton';
import HomeHeader from '../components/home/HomeHeader';
import NotificationBell from '../components/home/NotificationBell';
import StatusStrip from '../components/home/StatusStrip';
import DriverTabBar, { type DriverTab } from '../components/home/DriverTabBar';
import MoreActionsSheet, { type MoreAction } from '../components/home/MoreActionsSheet';
import AssignmentDialog from '../components/modals/AssignmentDialog';
import SosDialog from '../components/modals/SosDialog';
import SosCountdownDialog from '../components/modals/SosCountdownDialog';
import CapacityDialog from '../components/modals/CapacityDialog';
import IncomingCallDialog from '../components/modals/IncomingCallDialog';
import { Banner, DialogFrame, ErrorBanner, OfflineBanner, type DialogVariant } from '../components/ui';
import { ScrollToContext } from '../components/ScrollToContext';
import type { DocFocus } from '../components/profile/DocumentsSection';
import ReturnTripScreen from './ReturnTripScreen';
import NotificationsScreen from './NotificationsScreen';
import { useVehicleGate } from './VehicleGate';
import FuelLogScreen from './FuelLogScreen';
import RouteTab from './tabs/RouteTab';
import ScanTab from './tabs/ScanTab';
import MessagesTab from './tabs/MessagesTab';
import WalletTab from './tabs/WalletTab';
import ProfileTab, { AVATAR_KEY } from './tabs/ProfileTab';
import DeliveryScreen from './cargo/DeliveryScreen';
import PickupScreen, { type PickupItem } from './cargo/PickupScreen';
import CargoCheckScreen from './cargo/CargoCheckScreen';
import HandoverScreen from './cargo/HandoverScreen';
import HubDropScreen from './cargo/HubDropScreen';
import ReturnPickupScreen from './cargo/ReturnPickupScreen';
import CargoTransfersCard from '../components/home/CargoTransfersCard';
import type { ScanMethod } from '../components/scan/ParcelScanner';
import { colors, space } from '../theme';
import { fill } from '../locales';
import { CARGO_CHANGED_EVENT } from '../components/NotificationListener';
import { openNotification } from '../services/driverLinks';

interface HomeScreenProps {
  onLogout: () => void;
}

const DIALOG_VARIANT: Partial<Record<ActiveModal['kind'], DialogVariant>> = {
  moreActions: 'sheet',
  stopActions: 'sheet',
  returnTrip: 'full',
  fuel: 'full',
  pod: 'full',
  issue: 'full',
  pickup: 'full',
  cargoCheck: 'full',
  handover: 'full',
  hubDrop: 'full',
  returnPickup: 'full',
  notifications: 'full',
};

/** Dialogs where the driver types or captures something: only Cancel or Back closes them, never a stray touch outside. */
const FORM_DIALOGS: ActiveModal['kind'][] = ['pod', 'issue', 'capacity', 'sos', 'fuel', 'pickup', 'cargoCheck', 'handover', 'hubDrop', 'returnPickup'];

/** A banner above the tabs: what a tapped notification says. */
interface Notice {
  tone: 'danger' | 'warning' | 'info';
  message: string;
}

/** A tapped transfer notification waits for the transfer list, then opens it. */
interface TransferIntent {
  id: string;
  phase: 'new' | 'fetching' | 'settled';
}

export default function HomeScreen({ onLogout }: HomeScreenProps) {
  const { t } = useTranslation();
  const vehicleGate = useVehicleGate();
  const scrollRef = useRef<ScrollView>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [focusStopId, setFocusStopId] = useState<string | null>(null);
  const [docFocus, setDocFocus] = useState<DocFocus | null>(null);
  const [transferIntent, setTransferIntent] = useState<TransferIntent | null>(null);
  const [activeTab, setActiveTab] = useState<DriverTab>('route');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [showBackhaulPopup, setShowBackhaulPopup] = useState(false);

  const queryClient = useQueryClient();

  // Android Back on another tab goes to Home first; it only leaves the app from Home.
  useEffect(() => {
    if (activeTab === 'route') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setActiveTab('route');
      return true;
    });
    return () => sub.remove();
  }, [activeTab]);

  // Brings an item deep in a tab (a document row) into view
  const scrollToView = useCallback((view: RNView | null) => {
    const scroll = scrollRef.current;
    if (!view || !scroll) return;
    try {
      const inner = (scroll as any).getInnerViewRef?.() ?? (scroll as any).getInnerViewNode?.();
      if (!inner) return;
      view.measureLayout(inner, (_x, y) => scroll.scrollTo({ y: Math.max(0, y - space[4]), animated: true }), () => {});
    } catch {}
  }, []);

  const data = useDriverRoute();
  const { refresh } = data;
  // Actions waiting to be sent (no signal) show on the route already: a stop done offline counts as done.
  const queue = useActionQueue(refresh);
  const dispatch = useDispatchPhone();
  const routeData = useMemo(() => withQueuedStops(data.routeData, queue.items), [data.routeData, queue.items]);
  const route = routeData?.route;
  const routeActive = !!routeData?.active && route?.status === 'active';

  const assignmentKind = data.pendingConfirmation ? 'stop' : data.pendingRoute ? 'route' : null;
  const modal = useModalManager({ call: !!data.incomingCall, assignment: !!assignmentKind });
  const { open: openModal, close: closeModal } = modal;

  // The lots to hand over where a stop is (set once the on-board list is known, below)
  const lotsAtDrop = useRef<(stop: RouteStop) => DropLot[]>((stop) => dropLotsFor(stop, null, []));
  // Parcels scanned at the current pickup, waiting for their pickup details
  const [pickupItems, setPickupItems] = useState<PickupItem[]>([]);
  // A vendor load's pickup stop is a pickup, not a delivery: it opens the pickup details
  const openPod = useCallback(
    (stop: RouteStop) => {
      const load = manifestRefOfStop(stop.id);
      if (load && stop.parcel?.purpose === 'pickup' && stop.parcel.code) {
        const code = stop.parcel.code;
        setPickupItems((cur) => (cur.some((i) => i.code === code) ? cur : [...cur, { code, ref: load }]));
        openModal({ kind: 'pickup' });
        return;
      }
      openModal({ kind: 'pod', stop, lots: lotsAtDrop.current(stop) });
    },
    [openModal],
  );
  // Goods that were never picked up cannot be delivered: open the pickup form for them first
  const openPickupFor = useCallback(
    (stop: RouteStop) => {
      const code = stop.parcel?.code;
      if (code) setPickupItems((cur) => (cur.some((i) => i.code === code) ? cur : [...cur, { code, ref: manifestRefOfStop(stop.id) ?? code }]));
      openModal({ kind: 'pickup' });
    },
    [openModal],
  );
  const openIssue = useCallback((stop: RouteStop) => openModal({ kind: 'issue', stop, lots: lotsAtDrop.current(stop) }), [openModal]);

  // Arrival is shown by the next-action card; the phone just buzzes once per stop.
  const arrivedStops = useRef(new Set<string>());
  const deviceLocation = useDeviceLocationStatus();
  const tracking = useLocationTracking({
    isRouteActive: routeActive,
    onGeofenceArrival: (alert) => {
      if (arrivedStops.current.has(alert.stop_id)) return;
      arrivedStops.current.add(alert.stop_id);
      shortFeedback();
    },
    onRouteSyncRequested: refresh,
    onDeviceLocationRecheck: deviceLocation.recheck,
  });
  const { takeBreak } = tracking;
  const snapped = useSnappedRoute(routeData, tracking.currentLoc);
  const sos = useSos(tracking.currentLoc);
  const messages = useDriverMessages({ routeId: routeData?.active ? route?.id ?? null : null, tabOpen: activeTab === 'messages' });
  const scans = useParcelScan({ route, currentLoc: tracking.currentLoc });
  const onBoard = useOnBoard(!!data.activeVehicleId);
  const cargoTransfers = useCargoTransfers(data.activeVehicleId);
  const { refetch: refetchOnBoard } = onBoard;
  useEffect(() => {
    lotsAtDrop.current = (stop: RouteStop) => dropLotsFor(stop, route, onBoard.items);
  }, [route, onBoard.items]);
  const { refetch: refetchTransfers } = cargoTransfers;

  // A transfer planned or a case opened by dispatch: reload what is on board and the transfers
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CARGO_CHANGED_EVENT, () => {
      refetchOnBoard();
      refetchTransfers();
    });
    return () => sub.remove();
  }, [refetchOnBoard, refetchTransfers]);

  const scanCode = useCallback(
    async (code: string, method: ScanMethod): Promise<ScanOutcome> => {
      const outcome = await scans.handleCode(code, method);
      if (outcome.kind === 'picked_up') {
        setPickupItems((cur) =>
          cur.some((i) => i.code === outcome.code)
            ? cur
            : [...cur, { code: outcome.code, ref: outcome.ref }],
        );
      }
      return outcome;
    },
    [scans],
  );

  // The looping siren is only for a new assignment or a dispatch call.
  const { pulse } = useAlertSiren({
    ringing: !!assignmentKind || !!data.incomingCall,
    assignmentWaiting: assignmentKind,
  });

  // Losing GPS on a route gets one short buzz, and a louder notification if it stays off for 2 minutes.
  const gpsOffOnRoute = !!routeData?.active && deviceLocation.checked && !deviceLocation.servicesEnabled;
  useEffect(() => {
    if (gpsOffOnRoute) shortFeedback();
  }, [gpsOffOnRoute]);
  useGpsOffEscalation(gpsOffOnRoute);

  const showBackhaul = useCallback(() => setShowBackhaulPopup(true), []);
  const hideBackhaul = useCallback(() => setShowBackhaulPopup(false), []);

  const actions = useRouteActions({
    route,
    activeVehicleId: data.activeVehicleId,
    activeVehicle: data.activeVehicle,
    currentLoc: tracking.currentLoc,
    isTracking: tracking.isTracking,
    refresh,
    startTracking: tracking.start,
    openPod,
    openIssue,
    openPickupFor,
    onBoard: onBoard.data ?? null,
    pickedUpCodes: scans.pickedUp,
    showBackhaulPopup: showBackhaul,
  });

  useEffect(() => {
    AsyncStorage.getItem(AVATAR_KEY).then((uri) => uri && setAvatarUri(uri));
  }, []);

  // Refresh when coming back to the Home tab
  useEffect(() => {
    if (activeTab === 'route') refresh();
  }, [activeTab, refresh]);

  const status = useDriverStatus();
  const finished = isRouteFinished(route);
  const nextPending = pendingStops(route)[0];

  // A new trip, or a stop dispatch inserted, waits for a yes
  const assignment = useMemo<AssignmentWaiting | null>(() => {
    if (data.pendingConfirmation) {
      return { kind: 'stop', stopName: data.pendingConfirmation.route_stops?.delivery_points?.name ?? null };
    }
    const waiting = data.assignmentRoute;
    if (!waiting) return null;
    const stops = route && route.id === waiting.id ? route.stops ?? [] : [];
    const first = [...stops].sort((a, b) => a.sequence - b.sequence)[0];
    return { kind: 'route', stops: stops.length || null, firstStop: first?.delivery_point?.name ?? null };
  }, [data.pendingConfirmation, data.assignmentRoute, route]);

  const nextAction = getNextAction({
    routeData,
    noVehicle: data.noVehicle,
    assignment,
    isTracking: tracking.isTracking,
    currentLoc: tracking.currentLoc,
    onBoard: onBoard.data ?? null,
    transfers: cargoTransfers.transfers,
    openSos: !!status.openSos,
    dispatchIssues: status.dispatchIssues,
    upcoming: status.upcoming,
    pickupWaiting: pickupItems.length,
    pickedUpCodes: scans.pickedUp,
    lotsAt: (stop) =>
      dropLotsFor(stop, route, onBoard.items).map((l) => ({ code: l.code, pieces: l.pieces, label: l.lot.label, consigneeName: l.lot.consigneeName })),
  });

  // Stops the card does not show, in order: the rest of the trip under it
  const cardStop =
    nextAction.kind === 'go_to_stop' || nextAction.kind === 'deliver' || nextAction.kind === 'return_pickup' || nextAction.kind === 'pickup_first'
      ? nextAction.stop
      : nextAction.kind === 'record_pickup'
        ? nextAction.stop
        : null;
  const restStops = routeData?.active ? (cardStop ? restOfStops(route) : pendingStops(route)) : [];
  const firstRestNumber = stopCounts(route).done + (cardStop ? 2 : 1);
  // A transfer on the card is not listed twice
  const featuredTransferId =
    nextAction.kind === 'receive_goods' || nextAction.kind === 'hand_over' || nextAction.kind === 'drop_at_hub'
      ? nextAction.transfer.transfer.id
      : null;

  /** "Departed" for consignments just picked up: the server moves them to in transit. */
  const depart = useCallback(
    async (items: { ref: PickupItem['ref']; code: string }[]) => {
      try {
        const result = await sendCustody({
          label: 'departed',
          photoUris: [],
          events: items.map((item) => ({
            ref: item.ref,
            code: item.code,
            fields: { kind: 'departed' as const, ...(tracking.currentLoc ? { lat: tracking.currentLoc.lat, lng: tracking.currentLoc.lng } : {}) },
          })),
        });
        Alert.alert(result.queued ? t('queue_saved_title') : t('cargo_departed_title'), result.queued ? t('queue_saved_desc') : t('cargo_departed_desc'));
        refetchOnBoard();
        refresh();
      } catch (e: any) {
        Alert.alert(t('error'), e?.message || t('action_failed'));
      }
    },
    [tracking.currentLoc, refetchOnBoard, refresh, t],
  );

  const afterPickup = useCallback(
    (items: PickupItem[], result: CargoSendResult) => {
      setPickupItems([]);
      // A lot's master was what the driver scanned: it is no longer a pickup either
      scans.markPickedUp([...new Set(items.flatMap((i) => (i.masterCode ? [i.code, i.masterCode] : [i.code])))]);
      closeModal();
      refetchOnBoard();
      const codes = result.exceptions.map((e) => e.code).join(', ');
      const saved = result.queued ? t('queue_saved_desc') : t('cargo_pickup_saved_desc');
      const message = [saved, codes ? `${t('cargo_case_opened')} ${codes}` : '', t('cargo_depart_prompt_desc')].filter(Boolean).join('\n\n');
      Alert.alert(result.queued ? t('queue_saved_title') : t('cargo_pickup_saved_title'), message, [
        { text: t('not_now'), style: 'cancel' },
        { text: t('cargo_depart_now'), onPress: () => depart(items) },
      ]);
    },
    [closeModal, refetchOnBoard, depart, scans, t],
  );

  // Picked up but not yet on the move: offered as "Depart with cargo"
  const awaitingDeparture = onBoard.items.filter((i) => i.status === 'picked_up');

  const refreshStatus = useCallback(() => queryClient.invalidateQueries({ queryKey: DRIVER_STATUS_KEY }), [queryClient]);

  const raiseSos = useCallback(() => {
    openModal({ kind: 'sos' });
    // The open alert becomes the card as soon as the server has it
    sos.trigger().finally(refreshStatus);
  }, [openModal, sos, refreshStatus]);

  /** "I am safe": cancels the open alert from the card. Online only, so a failure is said out loud. */
  const cancelOpenSos = useCallback(
    (id: string) => {
      Alert.alert(t('na2_sos_cancel_title'), t('na2_sos_cancel_desc'), [
        { text: t('na2_keep_sos'), style: 'cancel' },
        {
          text: t('na2_sos_cancel'),
          style: 'destructive',
          onPress: () => {
            api
              .cancelSos(id)
              .catch(() => Alert.alert(t('error'), t('na2_sos_cancel_failed')))
              .finally(refreshStatus);
          },
        },
      ]);
    },
    [t, refreshStatus],
  );

  /** Opens the exact place a notification is about (see utils/notificationTarget). */
  const handleIntent = useCallback(
    ({ target, notification }: DriverIntent) => {
      closeModal();
      const say = (tone: Notice['tone'], message: string) => setNotice(message ? { tone, message } : null);
      const goHome = () => {
        setActiveTab('route');
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      };
      const reloadWork = () => {
        refresh();
        refetchOnBoard();
        refetchTransfers();
        refreshStatus();
      };
      setFocusStopId(null);
      setNotice(null);

      switch (target.kind) {
        case 'trip':
          // The accept prompt, if the trip is not accepted yet
          goHome();
          data.reopenAssignment();
          refreshStatus();
          break;
        case 'cancelled':
          goHome();
          reloadWork();
          say('warning', notification.body || t('na2_notice_cancelled'));
          break;
        case 'load':
          goHome();
          reloadWork();
          say('info', notification.body);
          break;
        case 'transfer':
          goHome();
          setTransferIntent({ id: target.transferId, phase: 'new' });
          break;
        case 'cargo':
          goHome();
          reloadWork();
          openModal({ kind: 'cargoCheck' });
          break;
        case 'documents':
          setActiveTab('profile');
          setDocFocus({ docId: target.docId, docType: target.docType, at: Date.now() });
          break;
        case 'vehicle':
          // The vehicle gate shows the new decision; the profile shows the vehicle
          queryClient.invalidateQueries({ queryKey: REGISTRATION_KEY });
          setActiveTab('profile');
          break;
        case 'wallet':
          setActiveTab('wallet');
          queryClient.invalidateQueries({ queryKey: ['driver-pay'] });
          break;
        case 'rating': {
          setActiveTab('wallet');
          queryClient.invalidateQueries({ queryKey: ['driver-pay'] });
          if (target.rating !== null) {
            const text = target.code
              ? fill(t('na2_notice_rating'), { code: target.code, rating: target.rating })
              : fill(t('na2_notice_rating_plain'), { rating: target.rating });
            say('info', target.comment ? `${text} "${target.comment}"` : text);
          }
          break;
        }
        case 'messages':
          setActiveTab('messages');
          break;
        case 'stop': {
          goHome();
          reloadWork();
          const stopId = stopIdFor(
            target,
            route?.stops ?? [],
            onBoard.items.map((i) => ({ shipmentId: typeof i.ref === 'object' && 'shipment_id' in i.ref ? i.ref.shipment_id : null, stopId: i.stopId })),
          );
          setFocusStopId(stopId ?? nextPending?.id ?? null);
          say('danger', notification.body || t('na2_notice_stop_fallback'));
          break;
        }
        case 'profile':
          setActiveTab('profile');
          break;
        case 'home':
          goHome();
          reloadWork();
          break;
      }
    },
    [closeModal, openModal, refresh, refetchOnBoard, refetchTransfers, refreshStatus, queryClient, data.reopenAssignment, route, onBoard.items, nextPending?.id, t],
  );

  // A tapped notification (push or the in-app list): take it now, and whenever the next one comes
  const handleIntentRef = useRef(handleIntent);
  handleIntentRef.current = handleIntent;
  useEffect(() => {
    const take = () => {
      const intent = takePendingIntent();
      if (intent) handleIntentRef.current(intent);
    };
    take();
    const sub = DeviceEventEmitter.addListener(OPEN_TARGET_EVENT, take);
    return () => sub.remove();
  }, []);

  // A tapped transfer notification: wait for the transfer list, open it, or say it is gone
  useEffect(() => {
    if (!transferIntent || !data.activeVehicleId) return;
    const found = cargoTransfers.transfers.find((vt) => vt.transfer.id === transferIntent.id);
    if (found) {
      setTransferIntent(null);
      openModal({ kind: 'handover', transfer: found });
    } else if (transferIntent.phase === 'new') {
      setTransferIntent({ ...transferIntent, phase: 'fetching' });
      refetchTransfers().finally(() => setTransferIntent((cur) => (cur && cur.id === transferIntent.id ? { ...cur, phase: 'settled' } : cur)));
    } else if (transferIntent.phase === 'settled') {
      setTransferIntent(null);
      setNotice({ tone: 'warning', message: t('na2_notice_transfer_gone') });
    }
  }, [transferIntent, cargoTransfers.transfers, data.activeVehicleId, openModal, refetchTransfers, t]);

  const onPullRefresh = async () => {
    setPullRefreshing(true);
    try {
      // Pulling down refreshes whatever tab is open: the route, and also messages and earnings.
      await Promise.all([refresh(), queryClient.invalidateQueries()]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const handleLogout = async () => {
    locationService.stop();
    await api.logout();
    onLogout();
  };

  const moreActions = useMemo<MoreAction[]>(() => {
    const list: MoreAction[] = [];
    // The break comes first: it is the one drivers reach for most.
    list.push({
      key: 'break',
      icon: 'cafe-outline',
      title: t('action_break'),
      subtitle: t('take_break_sub'),
      onPress: () => {
        closeModal();
        takeBreak();
      },
    });
    list.push({
      key: 'call_dispatch',
      icon: 'call-outline',
      title: t('call_dispatch'),
      subtitle: dispatch.phone ?? t('dispatch_no_number_title'),
      onPress: () => {
        closeModal();
        dispatch.callDispatch();
      },
    });
    if (routeActive) {
      list.push({
        key: 'full_route',
        icon: 'map-outline',
        title: t('open_full_route'),
        subtitle: t('open_full_route_sub'),
        onPress: () => {
          closeModal();
          actions.openFullRoute();
        },
      });
    }
    if (routeActive && nextPending) {
      list.push({
        key: 'report_issue',
        icon: 'warning-outline',
        tone: 'danger',
        title: t('alert_report_issue_title'),
        subtitle: nextPending.delivery_point?.name ?? undefined,
        onPress: () => {
          closeModal();
          actions.failStop(nextPending);
        },
      });
    }
    if (awaitingDeparture.length > 0) {
      list.push({
        key: 'depart',
        icon: 'arrow-forward-circle-outline',
        title: t('cargo_depart_now'),
        subtitle: fill(t('cargo_n_consignments'), { n: awaitingDeparture.length }),
        onPress: () => {
          closeModal();
          depart(awaitingDeparture);
        },
      });
    }
    if (pickupItems.length > 0) {
      list.push({
        key: 'pickup_details',
        icon: 'clipboard-outline',
        title: t('cargo_pickup_details'),
        subtitle: fill(t('cargo_n_consignments'), { n: pickupItems.length }),
        onPress: () => openModal({ kind: 'pickup' }),
      });
    }
    if (data.activeVehicleId) {
      list.push({
        key: 'cargo_check',
        icon: 'cube-outline',
        title: t('cargo_check_title'),
        subtitle: t('cargo_check_sub'),
        onPress: () => openModal({ kind: 'cargoCheck' }),
      });
      list.push({
        key: 'hub_drop',
        icon: 'business-outline',
        title: t('cargo_hub_title'),
        subtitle: t('cargo_hub_sub'),
        onPress: () => openModal({ kind: 'hubDrop' }),
      });
      list.push({
        key: 'return_pickup',
        icon: 'arrow-undo-outline',
        title: t('cargo_return_title'),
        subtitle: t('cargo_return_sub'),
        onPress: () => openModal({ kind: 'returnPickup' }),
      });
    }
    if (data.activeVehicleId) {
      list.push({
        key: 'log_fuel',
        icon: 'water-outline',
        title: t('fuel_log_title'),
        subtitle: t('fuel_log_sub'),
        onPress: () => openModal({ kind: 'fuel' }),
      });
      list.push({
        key: 'declare_load',
        icon: 'cube-outline',
        title: t('declare_load'),
        subtitle: t('backhaul_sub'),
        onPress: () => openModal({ kind: 'capacity' }),
      });
      list.push({
        key: 'return_trip',
        icon: 'return-down-back-outline',
        title: t('find_return'),
        subtitle: finished ? t('return_trip_sub') : t('return_trip_locked'),
        disabled: !finished,
        onPress: () => openModal({ kind: 'returnTrip' }),
      });
    }
    list.push({
      key: 'refresh',
      icon: 'refresh',
      title: t('refresh'),
      subtitle: data.lastSyncedAt ? `${t('last_updated')} ${formatTime(data.lastSyncedAt)}` : undefined,
      onPress: () => {
        closeModal();
        refresh();
      },
    });
    return list;
  }, [routeActive, nextPending, data.activeVehicleId, data.lastSyncedAt, finished, actions, takeBreak, refresh, openModal, closeModal, dispatch, awaitingDeparture, pickupItems.length, depart, t]);

  const sosButton = <SosButton onHoldComplete={raiseSos} onTap={() => openModal({ kind: 'sosCountdown' })} />;

  const renderDialog = (active: ActiveModal) => {
    switch (active.kind) {
      case 'assignment':
        if (!assignmentKind) return null;
        return (
          <AssignmentDialog
            kind={assignmentKind}
            pendingRoute={data.pendingRoute}
            stopName={data.pendingConfirmation?.route_stops?.delivery_points?.name}
            pulse={pulse}
            onAccept={async () => {
              const accepted = await data.acceptAssignment();
              if (accepted === 'stop') Alert.alert(t('stop_accepted_title'), t('stop_accepted_desc'));
              if (accepted === 'route') Alert.alert(t('route_accepted_title'), t('route_accepted_desc'));
            }}
            onSecondary={
              assignmentKind === 'stop'
                ? async () => {
                    await data.flagConfirmation();
                    Alert.alert(t('flagged_title'), t('flagged_desc'));
                  }
                : data.postponeRoute
            }
          />
        );
      case 'call':
        return data.incomingCall ? (
          <IncomingCallDialog
            caller={data.incomingCall.caller}
            phone={dispatch.phone}
            onDecline={() => data.setIncomingCall(null)}
            onAnswer={() => {
              data.setIncomingCall(null);
              dispatch.callDispatch();
            }}
          />
        ) : null;
      case 'sosCountdown':
        return <SosCountdownDialog onSend={raiseSos} onCancel={closeModal} />;
      case 'sos':
        return (
          <SosDialog
            state={sos.state}
            details={sos.details}
            cancelState={sos.cancelState}
            onRetry={sos.trigger}
            onSendDetails={sos.sendDetails}
            onCancel={() => sos.cancel().finally(refreshStatus)}
            onClose={() => {
              closeModal();
              refreshStatus();
            }}
            onCheckCargo={onBoard.items.length > 0 ? () => openModal({ kind: 'cargoCheck' }) : undefined}
          />
        );
      case 'pod':
      case 'issue':
        return (
          <DeliveryScreen
            key={`${active.kind}-${active.stop.id}`}
            stop={active.stop}
            lots={active.lots}
            initialKind={active.kind === 'issue' ? 'not_delivered' : 'full'}
            isVerified={(stop) => scans.verified.has(stop.id)}
            onScanCode={(stop, code, method) => scans.checkForStop(stop, code, method)}
            onClose={closeModal}
            headerRight={sosButton}
            onSubmit={async (outcome, entries, onSent) => {
              await actions.deliverLots(entries, outcome, onSent);
              refetchOnBoard();
            }}
          />
        );
      case 'pickup':
        return (
          <PickupScreen
            items={pickupItems}
            currentLoc={tracking.currentLoc}
            onScan={scanCode}
            onRemove={(code) => setPickupItems((cur) => cur.filter((i) => i.code !== code))}
            onDone={afterPickup}
            onClose={closeModal}
            headerRight={sosButton}
          />
        );
      case 'cargoCheck':
        return <CargoCheckScreen currentLoc={tracking.currentLoc} onClose={closeModal} headerRight={sosButton} />;
      case 'handover':
        return (
          <HandoverScreen
            key={active.transfer.transfer.id}
            vehicleTransfer={active.transfer}
            onDone={() => {
              closeModal();
              refetchTransfers();
              refetchOnBoard();
              refresh();
            }}
            onClose={closeModal}
            headerRight={sosButton}
          />
        );
      case 'hubDrop':
        return (
          <HubDropScreen
            currentLoc={tracking.currentLoc}
            onClose={() => {
              closeModal();
              refresh();
            }}
            headerRight={sosButton}
          />
        );
      case 'returnPickup':
        return (
          <ReturnPickupScreen
            route={route}
            currentLoc={tracking.currentLoc}
            onClose={() => {
              closeModal();
              refetchOnBoard();
            }}
            headerRight={sosButton}
          />
        );
      case 'capacity':
        return (
          <CapacityDialog
            vehicle={data.activeVehicle}
            onCancel={closeModal}
            onDeclare={async (pct) => {
              await actions.declareCapacity(pct);
              closeModal();
            }}
          />
        );
      case 'moreActions':
        return <MoreActionsSheet actions={moreActions} onClose={closeModal} />;
      case 'stopActions': {
        const stop = active.stop;
        const phone = stop.delivery_point?.consignee_phone;
        const list: MoreAction[] = [
          {
            key: 'navigate',
            icon: 'navigate-outline',
            title: t('na_navigate'),
            subtitle: stop.delivery_point?.address ?? undefined,
            onPress: () => {
              closeModal();
              actions.navigateTo(stop);
            },
          },
          {
            key: 'complete',
            icon: 'checkmark-circle-outline',
            title: isPickupStop(stop) ? t('pickup_label') : t('deliver'),
            // Any stop can be done in any order; the card recomputes and dispatch sees the real order
            onPress: () => actions.confirmAtStop(stop),
          },
          {
            key: 'issue',
            icon: 'warning-outline',
            tone: 'danger',
            title: t('alert_report_issue_title'),
            onPress: () => actions.failStop(stop),
          },
        ];
        if (phone) {
          list.push({
            key: 'call',
            icon: 'call-outline',
            title: t('na2_call_consignee'),
            subtitle: [stop.delivery_point?.consignee_name, phone].filter(Boolean).join(' · '),
            onPress: () => {
              closeModal();
              dial(phone).then((ok) => ok || Alert.alert(t('error'), t('na2_call_failed')));
            },
          });
        }
        return <MoreActionsSheet title={stop.delivery_point?.name || `${t('stop')} ${stop.sequence}`} actions={list} onClose={closeModal} />;
      }
      case 'notifications':
        return <NotificationsScreen onOpen={(n) => openNotification(n)} onClose={closeModal} headerRight={sosButton} />;
      case 'fuel':
        return data.activeVehicleId ? (
          <FuelLogScreen vehicleId={data.activeVehicleId} location={tracking.currentLoc} onClose={closeModal} headerRight={sosButton} />
        ) : null;
      case 'returnTrip':
        return data.activeVehicleId ? (
          <ReturnTripScreen vehicleId={data.activeVehicleId} onClose={closeModal} headerRight={sosButton} />
        ) : null;
    }
  };

  const active = modal.active;
  // Keep the last dialog's content while the modal fades out, so it never flashes empty.
  const lastShown = useRef<ActiveModal | null>(null);
  if (active) lastShown.current = active;
  const shown = active ?? lastShown.current;
  // Calls and new assignments must be answered; everything else closes with Back.
  const closable = !!active && active.kind !== 'call' && active.kind !== 'assignment';

  const syncBanner =
    activeTab !== 'route' ? null : data.syncState === 'offline' ? (
      <OfflineBanner
        message={
          data.lastSyncedAt ? `${t('offline_banner')} ${formatTime(data.lastSyncedAt)}.` : t('offline_banner_cached')
        }
        action={{ label: t('retry'), onPress: refresh }}
      />
    ) : data.syncState === 'failed' ? (
      <ErrorBanner
        message={data.lastSyncedAt ? `${t('sync_failed_banner')} ${formatTime(data.lastSyncedAt)}.` : t('sync_failed_cached')}
        action={{ label: t('retry'), onPress: refresh }}
      />
    ) : null;

  return (
    <ScrollToContext.Provider value={scrollToView}>
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.top}>
        <HomeHeader
          driverName={data.driverInfo?.full_name}
          plateNumber={data.activeVehicle?.plate_number}
          avatarUri={avatarUri}
          right={
            <View style={styles.headerRight}>
              <NotificationBell onPress={() => openModal({ kind: 'notifications' })} />
              {sosButton}
            </View>
          }
        />
        <StatusStrip
          location={deviceLocation}
          isTracking={tracking.isTracking}
          isStartingTracking={tracking.isStarting}
          syncState={data.syncState}
          speedKmph={routeActive ? tracking.speedKmph : null}
          waitingToSend={queue.waiting}
          sendingQueue={queue.sending}
          onSendQueue={queue.flush}
          onToggleTracking={tracking.toggle}
          onTakeBreak={takeBreak}
          onRetrySync={refresh}
          backgroundError={tracking.backgroundError}
          onRetryBackgroundTracking={tracking.retryBackgroundTracking}
        />
      </SafeAreaView>

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} tintColor={colors.accent} colors={[colors.accent]} />
          }
        >
          {notice ? (
            <Banner
              tone={notice.tone}
              icon={notice.tone === 'info' ? 'information-circle-outline' : 'alert-circle-outline'}
              message={notice.message}
              action={{ label: t('na2_notice_dismiss'), onPress: () => setNotice(null) }}
            />
          ) : null}
          {syncBanner}
          {activeTab === 'route' && (
            <RouteTab
              routeData={routeData}
              restStops={restStops}
              firstRestNumber={firstRestNumber}
              upcoming={status.upcoming}
              focusStopId={focusStopId}
              onPressStop={routeActive ? (stop) => openModal({ kind: 'stopActions', stop }) : undefined}
              currentLoc={tracking.currentLoc}
              line={snapped.line}
              liveDistanceM={snapped.distanceM}
              liveDurationS={snapped.durationS}
              transfers={cargoTransfers.transfers.filter((vt) => vt.transfer.id !== featuredTransferId)}
              onOpenTransfer={(transfer) => openModal({ kind: 'handover', transfer })}
              onOpenMoreActions={() => openModal({ kind: 'moreActions' })}
              card={{
                action: nextAction,
                isStartingTracking: tracking.isStarting,
                refreshing: data.isRefreshing,
                canFindReturnLoad: !!data.activeVehicleId,
                sosId: status.openSos?.id ?? null,
                onStartRoute: actions.startRoute,
                onEnableTracking: tracking.start,
                onNavigate: actions.navigateTo,
                onArrivedManually: actions.confirmAtStop,
                onConfirmStop: actions.confirmAtStop,
                onReportIssue: actions.failStop,
                onFindReturnLoad: actions.findReturnLoad,
                onRefresh: refresh,
                onAcceptTrip: data.reopenAssignment,
                onOpenTransfer: (transfer) => openModal({ kind: 'handover', transfer }),
                onRecordPickup: (stop) => (stop ? actions.confirmAtStop(stop) : openModal({ kind: 'pickup' })),
                onDepart: depart,
                onOpenReturnPickup: () => openModal({ kind: 'returnPickup' }),
                onPickupFirst: openPickupFor,
                onOpenHubDrop: () => openModal({ kind: 'hubDrop' }),
                onOpenCargoCheck: () => openModal({ kind: 'cargoCheck' }),
                onCallDispatch: dispatch.callDispatch,
                onOpenDocuments: () => {
                  setActiveTab('profile');
                  setDocFocus({ docId: null, docType: 'driving_licence', at: Date.now() });
                },
                onRegisterVehicle: vehicleGate.registerVehicle,
                onCancelSos: cancelOpenSos,
              }}
            />
          )}
          {activeTab === 'scan' && (
            <ScanTab
              hasRoute={!!routeData?.active && !!route?.stops?.length}
              onScan={async (code, method) => {
                const outcome = await scanCode(code, method);
                // Straight on to the pickup details: pieces, condition, photos, signature
                if (outcome.kind === 'picked_up') openModal({ kind: 'pickup' });
                return outcome;
              }}
              onDeliver={openPod}
              onPickupDetails={() => openModal({ kind: 'pickup' })}
            />
          )}
          {activeTab === 'messages' && (
            <MessagesTab
              hasRoute={!!routeData?.active && !!route?.id}
              messages={messages.messages}
              loading={messages.loading}
              failed={messages.failed}
              sending={messages.sending}
              onRetry={messages.retry}
              onSend={messages.sendMessage}
              onCallDispatch={dispatch.callDispatch}
            />
          )}
          {activeTab === 'wallet' && <WalletTab />}
          {activeTab === 'profile' && (
            <ProfileTab
              driverInfo={data.driverInfo}
              onDriverInfoChange={data.setDriverInfo}
              avatarUri={avatarUri}
              onAvatarChange={setAvatarUri}
              onLogout={handleLogout}
              docFocus={docFocus}
            />
          )}
        </ScrollView>

        {showBackhaulPopup && data.activeVehicleId && (
          <BackhaulPopup vehicleId={data.activeVehicleId} onDismiss={hideBackhaul} bottomOffset={space[4]} />
        )}
      </KeyboardAvoidingView>

      <DriverTabBar active={activeTab} onChange={setActiveTab} messagesUnread={messages.unreadCount} />

      {/* The only dialog host: useModalManager decides what, if anything, is shown. */}
      <DialogFrame
        visible={!!active}
        variant={shown ? DIALOG_VARIANT[shown.kind] ?? 'center' : 'center'}
        onRequestClose={closable ? closeModal : undefined}
        dismissOnBackdrop={!shown || !FORM_DIALOGS.includes(shown.kind)}
      >
        {shown ? renderDialog(shown) : null}
      </DialogFrame>
    </View>
    </ScrollToContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  top: { backgroundColor: colors.surface },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  flex: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[8], gap: space[4] },
});
