/**
 * MargixIndia Driver App — Home
 *
 * Header and status strip stay fixed; below them the Home tab shows the map,
 * one "next action" card for the current step, and a "More actions" sheet for
 * everything used less often. Data and behaviour live in hooks:
 * useDriverRoute (route, assignments, sync), useLocationTracking (GPS),
 * useDeviceLocationStatus, useSnappedRoute, useAlertSiren and useRouteActions.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { locationService } from '../services/location';
import { useTranslation } from '../hooks/useTranslation';
import { useDriverRoute } from '../hooks/useDriverRoute';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { useDeviceLocationStatus } from '../hooks/useDeviceLocationStatus';
import { useSnappedRoute } from '../hooks/useSnappedRoute';
import { useAlertSiren } from '../hooks/useAlertSiren';
import { useRouteActions } from '../hooks/useRouteActions';
import type { RouteStop } from '../types/route';
import { getNextStep, isRouteFinished, pendingStops } from '../utils/route';
import BackhaulPopup from '../components/BackhaulPopup';
import HomeHeader from '../components/home/HomeHeader';
import StatusStrip from '../components/home/StatusStrip';
import DriverTabBar, { type DriverTab } from '../components/home/DriverTabBar';
import MoreActionsSheet, { type MoreAction } from '../components/home/MoreActionsSheet';
import AssignmentDialog from '../components/modals/AssignmentDialog';
import PodDialog from '../components/modals/PodDialog';
import SosDialog from '../components/modals/SosDialog';
import CapacityDialog from '../components/modals/CapacityDialog';
import IncomingCallDialog from '../components/modals/IncomingCallDialog';
import InvoiceDialog, { type Invoice } from '../components/modals/InvoiceDialog';
import { DialogFrame, IconButton, Text } from '../components/ui';
import ReturnTripScreen from './ReturnTripScreen';
import RouteTab from './tabs/RouteTab';
import WalletTab from './tabs/WalletTab';
import ProfileTab, { AVATAR_KEY } from './tabs/ProfileTab';
import { colors, size, space } from '../theme';

interface HomeScreenProps {
  onLogout: () => void;
}

/** Lets a closing sheet finish before the next dialog opens (iOS presents one modal at a time). */
const SHEET_CLOSE_MS = 400;

export default function HomeScreen({ onLogout }: HomeScreenProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DriverTab>('route');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const [podStop, setPodStop] = useState<RouteStop | null>(null);
  const [showSos, setShowSos] = useState(false);
  const [showCapacity, setShowCapacity] = useState(false);
  const [showReturnTrip, setShowReturnTrip] = useState(false);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showBackhaulPopup, setShowBackhaulPopup] = useState(false);

  const data = useDriverRoute({
    onNewConfirmation: () => Alert.alert(t('alert_next_stop_title'), t('alert_next_stop_desc')),
  });
  const route = data.routeData?.route;
  const routeActive = !!data.routeData?.active && route?.status === 'active';

  const openPod = useCallback((stop: RouteStop) => setPodStop(stop), []);

  const tracking = useLocationTracking({
    isRouteActive: routeActive,
    onGeofenceArrival: (alert) => {
      const stop = route?.stops?.find((s) => s.id === alert.stop_id);
      Alert.alert(t('alert_arrived_title'), alert.message, [
        { text: t('not_yet'), style: 'cancel' },
        ...(stop ? [{ text: t('mark_delivered'), onPress: () => openPod(stop) }] : []),
      ]);
    },
    onRouteSyncRequested: data.refresh,
  });
  const deviceLocation = useDeviceLocationStatus();
  const snapped = useSnappedRoute(data.routeData, tracking.currentLoc);

  const assignmentKind = data.pendingConfirmation ? 'stop' : data.pendingRoute ? 'route' : null;
  const gpsOffOnRoute = !!data.routeData?.active && deviceLocation.checked && !deviceLocation.servicesEnabled;
  const { pulse } = useAlertSiren({
    ringing: !!assignmentKind || !!data.incomingCall || gpsOffOnRoute,
    assignmentWaiting: assignmentKind,
  });

  const showBackhaul = useCallback(() => setShowBackhaulPopup(true), []);
  const hideBackhaul = useCallback(() => setShowBackhaulPopup(false), []);

  const actions = useRouteActions({
    route,
    activeVehicleId: data.activeVehicleId,
    activeVehicle: data.activeVehicle,
    currentLoc: tracking.currentLoc,
    isTracking: tracking.isTracking,
    refresh: data.refresh,
    startTracking: tracking.start,
    openPod,
    showBackhaulPopup: showBackhaul,
  });

  useEffect(() => {
    AsyncStorage.getItem(AVATAR_KEY).then((uri) => uri && setAvatarUri(uri));
  }, []);

  // Refresh when coming back to the Home tab
  const { refresh } = data;
  useEffect(() => {
    if (activeTab === 'route') refresh();
  }, [activeTab, refresh]);

  const step = getNextStep(data.routeData, tracking.isTracking, tracking.currentLoc);
  const finished = isRouteFinished(route);
  const nextPending = pendingStops(route)[0];

  const onPullRefresh = async () => {
    setPullRefreshing(true);
    await refresh();
    setPullRefreshing(false);
  };

  const handleLogout = async () => {
    locationService.stop();
    await api.logout();
    onLogout();
  };

  const moreActions = useMemo<MoreAction[]>(() => {
    const fromSheet = (open: () => void) => () => {
      setShowMoreActions(false);
      setTimeout(open, SHEET_CLOSE_MS);
    };
    const list: MoreAction[] = [];
    if (routeActive) {
      list.push({
        key: 'full_route',
        icon: 'map-outline',
        title: t('open_full_route'),
        subtitle: t('open_full_route_sub'),
        onPress: fromSheet(actions.openFullRoute),
      });
    }
    if (routeActive && nextPending) {
      list.push({
        key: 'report_issue',
        icon: 'warning-outline',
        tone: 'danger',
        title: t('alert_report_issue_title'),
        subtitle: nextPending.delivery_point?.name ?? undefined,
        onPress: fromSheet(() => actions.failStop(nextPending)),
      });
    }
    if (data.activeVehicleId) {
      list.push({
        key: 'declare_load',
        icon: 'cube-outline',
        title: t('declare_load'),
        subtitle: t('backhaul_sub'),
        onPress: fromSheet(() => setShowCapacity(true)),
      });
      list.push({
        key: 'return_trip',
        icon: 'return-down-back-outline',
        title: t('find_return'),
        subtitle: finished ? t('return_trip_sub') : t('return_trip_locked'),
        disabled: !finished,
        onPress: fromSheet(() => setShowReturnTrip(true)),
      });
    }
    list.push({
      key: 'break',
      icon: 'cafe-outline',
      title: t('action_break'),
      subtitle: t('take_break_sub'),
      onPress: fromSheet(tracking.takeBreak),
    });
    list.push({
      key: 'refresh',
      icon: 'refresh',
      title: t('refresh'),
      subtitle: data.lastSyncedAt
        ? `${t('last_updated')} ${new Date(data.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : undefined,
      onPress: () => {
        setShowMoreActions(false);
        refresh();
      },
    });
    return list;
  }, [routeActive, nextPending, data.activeVehicleId, data.lastSyncedAt, finished, actions, tracking.takeBreak, refresh, t]);

  const sosButton = (
    <IconButton
      accessibilityLabel={t('sos')}
      accessibilityHint={t('sos_desc')}
      variant="secondary"
      onPress={() => setShowSos(true)}
      icon={() => (
        <View style={styles.sosIcon}>
          <Ionicons name="notifications-outline" size={size.icon.md} color={colors.text} />
          <Text variant="caption" color="danger">
            SOS
          </Text>
        </View>
      )}
    />
  );

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
          onToggleTracking={tracking.toggle}
          onRetrySync={refresh}
        />
      </SafeAreaView>

      <View style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} tintColor={colors.accent} colors={[colors.accent]} />
          }
        >
          {activeTab === 'route' && (
            <RouteTab
              routeData={data.routeData}
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
              onOpenMoreActions={() => setShowMoreActions(true)}
            />
          )}
          {activeTab === 'wallet' && <WalletTab onOpenInvoice={setSelectedInvoice} />}
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
      </View>

      <DriverTabBar active={activeTab} onChange={setActiveTab} />

      {/* Dialogs */}
      <DialogFrame visible={!!assignmentKind}>
        {assignmentKind ? (
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
        ) : null}
      </DialogFrame>

      <DialogFrame visible={!!data.incomingCall}>
        {data.incomingCall ? (
          <IncomingCallDialog
            caller={data.incomingCall.caller}
            onDecline={() => data.setIncomingCall(null)}
            onAnswer={() => {
              data.setIncomingCall(null);
              Alert.alert(t('call_answer_title'), t('call_answer_desc'));
            }}
          />
        ) : null}
      </DialogFrame>

      <DialogFrame visible={!!podStop} onRequestClose={() => setPodStop(null)}>
        {podStop ? (
          <PodDialog
            stopName={podStop.delivery_point?.name}
            onCancel={() => setPodStop(null)}
            onSubmit={async (receiverName) => {
              await actions.completeStop(podStop, receiverName);
              setPodStop(null);
            }}
          />
        ) : null}
      </DialogFrame>

      <DialogFrame visible={showSos} onRequestClose={() => setShowSos(false)}>
        <SosDialog
          onCancel={() => setShowSos(false)}
          onSend={async (type, description) => {
            if (await actions.sendSos(type, description)) setShowSos(false);
          }}
        />
      </DialogFrame>

      <DialogFrame visible={showCapacity} onRequestClose={() => setShowCapacity(false)}>
        <CapacityDialog
          vehicle={data.activeVehicle}
          onCancel={() => setShowCapacity(false)}
          onDeclare={async (pct) => {
            await actions.declareCapacity(pct);
            setShowCapacity(false);
          }}
        />
      </DialogFrame>

      <DialogFrame visible={showMoreActions} variant="sheet" onRequestClose={() => setShowMoreActions(false)}>
        <MoreActionsSheet actions={moreActions} onClose={() => setShowMoreActions(false)} />
      </DialogFrame>

      <DialogFrame visible={!!selectedInvoice} onRequestClose={() => setSelectedInvoice(null)}>
        {selectedInvoice ? <InvoiceDialog invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} /> : null}
      </DialogFrame>

      <DialogFrame
        visible={showReturnTrip && !!data.activeVehicleId}
        variant="full"
        onRequestClose={() => setShowReturnTrip(false)}
      >
        {data.activeVehicleId ? (
          <ReturnTripScreen vehicleId={data.activeVehicleId} onClose={() => setShowReturnTrip(false)} />
        ) : null}
      </DialogFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  top: { backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[8] },
  sosIcon: { alignItems: 'center' },
});
