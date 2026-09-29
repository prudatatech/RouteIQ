/**
 * MargixIndia Driver App — Home
 *
 * Header (with the one SOS button) and status strip stay fixed; below them
 * the Home tab shows the map, one "next action" card for the current step,
 * and a "More actions" sheet for everything used less often. Data and
 * behaviour live in hooks: useDriverRoute (route, assignments, sync),
 * useLocationTracking (GPS), useDeviceLocationStatus, useSnappedRoute,
 * useAlertSiren, useRouteActions, useSos and useModalManager (one dialog at
 * a time).
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
import { useParcelScan } from '../hooks/useParcelScan';
import { useActionQueue } from '../hooks/useActionQueue';
import { useDispatchPhone } from '../hooks/useDispatchPhone';
import { withQueuedStops } from '../utils/queuedStops';
import { useDriverMessages } from '../hooks/useDriverMessages';
import { useModalManager, type ActiveModal } from '../hooks/useModalManager';
import type { RouteStop } from '../types/route';
import { shortFeedback } from '../utils/feedback';
import { getNextStep, isRouteFinished, pendingStops } from '../utils/route';
import BackhaulPopup from '../components/BackhaulPopup';
import SosButton from '../components/SosButton';
import HomeHeader from '../components/home/HomeHeader';
import StatusStrip from '../components/home/StatusStrip';
import DriverTabBar, { type DriverTab } from '../components/home/DriverTabBar';
import MoreActionsSheet, { type MoreAction } from '../components/home/MoreActionsSheet';
import AssignmentDialog from '../components/modals/AssignmentDialog';
import PodDialog from '../components/modals/PodDialog';
import IssueDialog from '../components/modals/IssueDialog';
import SosDialog from '../components/modals/SosDialog';
import SosCountdownDialog from '../components/modals/SosCountdownDialog';
import CapacityDialog from '../components/modals/CapacityDialog';
import IncomingCallDialog from '../components/modals/IncomingCallDialog';
import InvoiceDialog from '../components/modals/InvoiceDialog';
import { DialogFrame, ErrorBanner, OfflineBanner, type DialogVariant } from '../components/ui';
import ReturnTripScreen from './ReturnTripScreen';
import RouteTab from './tabs/RouteTab';
import ScanTab from './tabs/ScanTab';
import MessagesTab from './tabs/MessagesTab';
import WalletTab from './tabs/WalletTab';
import ProfileTab, { AVATAR_KEY } from './tabs/ProfileTab';
import { colors, space } from '../theme';
import { OPEN_TAB_EVENT } from '../components/NotificationListener';

interface HomeScreenProps {
  onLogout: () => void;
}

const DIALOG_VARIANT: Partial<Record<ActiveModal['kind'], DialogVariant>> = {
  moreActions: 'sheet',
  returnTrip: 'full',
};

/** Dialogs where the driver types or captures something: only Cancel or Back closes them, never a stray touch outside. */
const FORM_DIALOGS: ActiveModal['kind'][] = ['pod', 'issue', 'capacity', 'sos'];

const formatTime = (ms: number) =>
  new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(
    new Date(ms),
  );

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

  const openPod = useCallback((stop: RouteStop) => openModal({ kind: 'pod', stop }), [openModal]);
  const openIssue = useCallback((stop: RouteStop) => openModal({ kind: 'issue', stop }), [openModal]);

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
  const scans = useParcelScan({ route, currentLoc: tracking.currentLoc, refresh });

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
    if (data.activeVehicleId) {
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
  }, [routeActive, nextPending, data.activeVehicleId, data.lastSyncedAt, finished, actions, takeBreak, refresh, openModal, closeModal, dispatch, t]);

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
            onRetry={sos.trigger}
            onSendDetails={sos.sendDetails}
            onClose={closeModal}
          />
        );
      case 'pod':
        return (
          <PodDialog
            stopName={active.stop.delivery_point?.name}
            parcelCode={active.stop.parcel?.code}
            parcelVerified={scans.verified.has(active.stop.id)}
            onScanCode={(code, method) => scans.checkForStop(active.stop, code, method)}
            onCancel={closeModal}
            onSubmit={async (pod) => {
              await actions.completeStop(active.stop, pod);
              closeModal();
            }}
          />
        );
      case 'issue':
        return (
          <IssueDialog
            stopName={active.stop.delivery_point?.name}
            onCancel={closeModal}
            onSubmit={async (reason, note) => {
              await actions.submitIssue(active.stop, reason, note);
              closeModal();
            }}
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
      case 'invoice':
        return <InvoiceDialog invoice={active.invoice} onClose={closeModal} />;
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
            <ScanTab hasRoute={!!routeData?.active && !!route?.stops?.length} onScan={scans.handleCode} onDeliver={openPod} />
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
          {activeTab === 'wallet' && <WalletTab onOpenInvoice={(invoice) => openModal({ kind: 'invoice', invoice })} />}
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
