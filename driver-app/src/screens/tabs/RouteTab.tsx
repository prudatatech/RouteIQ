import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { MapPoint } from '../../hooks/useSnappedRoute';
import type { LatLng, MyRouteResponse, RouteStop } from '../../types/route';
import type { NextStep } from '../../utils/route';
import CurrentRate from '../../components/home/CurrentRate';
import NextActionCard from '../../components/home/NextActionCard';
import RouteMap from '../../components/home/RouteMap';
import RouteSummary from '../../components/home/RouteSummary';
import StopList from '../../components/home/StopList';
import { Button } from '../../components/ui';
import { size, space } from '../../theme';

interface RouteTabProps {
  routeData: MyRouteResponse | null;
  step: NextStep;
  noVehicle: boolean;
  currentLoc: LatLng | null;
  line: MapPoint[];
  liveDistanceM: number | null;
  liveDurationS: number | null;
  isStartingTracking: boolean;
  refreshing: boolean;
  canFindReturnLoad: boolean;
  onStartRoute: () => Promise<boolean>;
  onEnableTracking: () => void;
  onNavigate: (stop: RouteStop) => void;
  onArrivedManually: (stop: RouteStop) => void;
  onConfirmStop: (stop: RouteStop) => void;
  onReportIssue: (stop: RouteStop) => void;
  onFindReturnLoad: () => void;
  onRefresh: () => void;
  onOpenMoreActions: () => void;
}

/** Map, the one next action, then route details and every stop. */
export default function RouteTab(props: RouteTabProps) {
  const { t } = useTranslation();
  const route = props.routeData?.route;
  const showRouteDetails = !!route && !!props.routeData?.active && (route.stops?.length ?? 0) > 0;

  return (
    <View style={styles.container}>
      <CurrentRate />

      <RouteMap route={props.routeData?.active ? route : undefined} currentLoc={props.currentLoc} line={props.line} />

      <NextActionCard
        step={props.step}
        noVehicle={props.noVehicle}
        isStartingTracking={props.isStartingTracking}
        refreshing={props.refreshing}
        canFindReturnLoad={props.canFindReturnLoad}
        onStartRoute={props.onStartRoute}
        onEnableTracking={props.onEnableTracking}
        onNavigate={props.onNavigate}
        onArrivedManually={props.onArrivedManually}
        onConfirmStop={props.onConfirmStop}
        onFindReturnLoad={props.onFindReturnLoad}
        onRefresh={props.onRefresh}
      />

      <Button
        title={t('more_actions')}
        variant="secondary"
        onPress={props.onOpenMoreActions}
        icon={(color) => <Ionicons name="ellipsis-horizontal" size={size.icon.md} color={color} />}
      />

      {showRouteDetails && route ? (
        <>
          <RouteSummary route={route} liveDistanceM={props.liveDistanceM} liveDurationS={props.liveDurationS} />
          <StopList
            route={route}
            actionsEnabled={route.status === 'active'}
            onComplete={props.onArrivedManually}
            onReportIssue={props.onReportIssue}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[4] },
});
