/**
 * MargixIndia Driver App — Home
 *
 * Header (with the one SOS button) and status strip stay fixed; below them
 * the Home tab shows the map, one "next action" card for the current step,
 * and a "More actions" sheet for everything used less often. Data and
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
import { sendCustody, type CargoSendResult } from '../services/cargoActions';
import { manifestRefOfStop } from '../services/cargo';
import { dropLotsFor, type DropLot } from '../utils/dropLots';
import { useActionQueue } from '../hooks/useActionQueue';
import { useDispatchPhone } from '../hooks/useDispatchPhone';
import { withQueuedStops } from '../utils/queuedStops';
import { useDriverMessages } from '../hooks/useDriverMessages';
import { useModalManager, type ActiveModal } from '../hooks/useModalManager';
import type { RouteStop } from '../types/route';
import { shortFeedback } from '../utils/feedback';
import { formatTime } from '../utils/format';
import { getNextStep, isRouteFinished, pendingStops } from '../utils/route';
import BackhaulPopup from '../components/BackhaulPopup';
import SosButton from '../components/SosButton';
import HomeHeader from '../components/home/HomeHeader';
import StatusStrip from '../components/home/StatusStrip';
import DriverTabBar, { type DriverTab } from '../components/home/DriverTabBar';
import MoreActionsSheet, { type MoreAction } from '../components/home/MoreActionsSheet';
import AssignmentDialog from '../components/modals/AssignmentDialog';
import SosDialog from '../components/modals/SosDialog';
import SosCountdownDialog from '../components/modals/SosCountdownDialog';
import CapacityDialog from '../components/modals/CapacityDialog';
import IncomingCallDialog from '../components/modals/IncomingCallDialog';
import { DialogFrame, ErrorBanner, OfflineBanner, type DialogVariant } from '../components/ui';
import ReturnTripScreen from './ReturnTripScreen';
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
import { CARGO_CHANGED_EVENT, OPEN_TAB_EVENT } from '../components/NotificationListener';

interface HomeScreenProps {
  onLogout: () => void;
}

const DIALOG_VARIANT: Partial<Record<ActiveModal['kind'], DialogVariant>> = {
  moreActions: 'sheet',
  returnTrip: 'full',
  fuel: 'full',
  pod: 'full',
  issue: 'full',
  pickup: 'full',
  cargoCheck: 'full',
  handover: 'full',
  hubDrop: 'full',
  returnPickup: 'full',
};

/** Dialogs where the driver types or captures something: only Cancel or Back closes them, never a stray touch outside. */
const FORM_DIALOGS: ActiveModal['kind'][] = ['pod', 'issue', 'capacity', 'sos', 'fuel', 'pickup', 'cargoCheck', 'handover', 'hubDrop', 'returnPickup'];

export default function HomeScreen({ onLogout }: HomeScreenProps) {
  const { t } = useTranslation();
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

  // Tapping a push notification opens the tab it is about.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(OPEN_TAB_EVENT, (tab: DriverTab) => setActiveTab(tab));
    return () => sub.remove();
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
    showBackhaulPopup: showBackhaul,
  });

  useEffect(() => {
    AsyncStorage.getItem(AVATAR_KEY).then((uri) => uri && setAvatarUri(uri));
  }, []);

  // Refresh when coming back to the Home tab
  useEffect(() => {
    if (activeTab === 'route') refresh();
  }, [activeTab, refresh]);

  const step = getNextStep(routeData, tracking.isTracking, tracking.currentLoc);
  const finished = isRouteFinished(route);
  const nextPending = pendingStops(route)[0];

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

  const raiseSos = useCallback(() => {
    openModal({ kind: 'sos' });
    sos.trigger();
  }, [openModal, sos]);

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
            onCancel={sos.cancel}
            onClose={closeModal}
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
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.top}>
        <HomeHeader
          driverName={data.driverInfo?.full_name}
          plateNumber={data.activeVehicle?.plate_number}
          avatarUri={avatarUri}
          right={sosButton}
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
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} tintColor={colors.accent} colors={[colors.accent]} />
          }
        >
          {syncBanner}
          {activeTab === 'route' && (
            <CargoTransfersCard transfers={cargoTransfers.transfers} onOpen={(transfer) => openModal({ kind: 'handover', transfer })} />
          )}
          {activeTab === 'route' && (
            <RouteTab
              routeData={routeData}
              step={step}
              noVehicle={data.noVehicle}
              currentLoc={tracking.currentLoc}
              line={snapped.line}
              liveDistanceM={snapped.distanceM}
              liveDurationS={snapped.durationS}
              isStartingTracking={tracking.isStarting}
              refreshing={data.isRefreshing}
              canFindReturnLoad={!!data.activeVehicleId}
              onStartRoute={actions.startRoute}
              onEnableTracking={tracking.start}
              onNavigate={actions.navigateTo}
              onArrivedManually={actions.confirmAtStop}
              onConfirmStop={openPod}
              onReportIssue={actions.failStop}
              onFindReturnLoad={actions.findReturnLoad}
              onRefresh={refresh}
              onOpenMoreActions={() => openModal({ kind: 'moreActions' })}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  top: { backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[8], gap: space[4] },
});
