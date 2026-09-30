import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { MapPoint } from '../../hooks/useSnappedRoute';
import type { LatLng, MyRouteResponse, RouteStop } from '../../types/route';
import type { UpcomingTrip } from '../../utils/nextAction';
import CurrentRate from '../../components/home/CurrentRate';
import NextActionCard, { UpcomingList } from '../../components/home/NextActionCard';
import RestStops from '../../components/home/RestStops';
import CargoTransfersCard from '../../components/home/CargoTransfersCard';
import type { VehicleTransfer } from '../../hooks/useCargo';
import RouteMap from '../../components/home/RouteMap';
import RouteSummary from '../../components/home/RouteSummary';
import { Button, Card } from '../../components/ui';
import { size, space } from '../../theme';

type CardProps = React.ComponentProps<typeof NextActionCard>;

interface RouteTabProps {
  routeData: MyRouteResponse | null;
  /** The next-action card: what to do now and the handlers that run the existing flows. */
  card: CardProps;
  /** The pending stops after the one on the card. */
  restStops: RouteStop[];
  /** Stops already done or failed, so the numbers continue from the card's stop. */
  firstRestNumber: number;
  upcoming: UpcomingTrip[];
  focusStopId: string | null;
  onPressStop?: (stop: RouteStop) => void;
  /** Transfers planned for this vehicle, other than the one on the card. */
  transfers: VehicleTransfer[];
  onOpenTransfer: (transfer: VehicleTransfer) => void;
  currentLoc: LatLng | null;
  line: MapPoint[];
  liveDistanceM: number | null;
  liveDurationS: number | null;
  onOpenMoreActions: () => void;
}

/** The one next action first; then the rest of the trip, the trips waiting, and the map. */
export default function RouteTab(props: RouteTabProps) {
  const { t } = useTranslation();
  const route = props.routeData?.route;
  const showRouteDetails = !!route && !!props.routeData?.active && (route.stops?.length ?? 0) > 0;
  // The card lists the trips waiting itself once the trip is done or there is none
  const cardShowsUpcoming = props.card.action.kind === 'trip_done' || props.card.action.kind === 'idle';

  return (
    <View style={styles.container}>
      <NextActionCard {...props.card} />

      <RestStops stops={props.restStops} firstNumber={props.firstRestNumber} focusStopId={props.focusStopId} onPressStop={props.onPressStop} />

      <CargoTransfersCard transfers={props.transfers} onOpen={props.onOpenTransfer} />

      {!cardShowsUpcoming && props.upcoming.length > 0 ? (
        <Card>
          <UpcomingList trips={props.upcoming} />
        </Card>
      ) : null}

      <Button
        title={t('more_actions')}
        variant="secondary"
        onPress={props.onOpenMoreActions}
        icon={(color) => <Ionicons name="ellipsis-horizontal" size={size.icon.md} color={color} />}
      />

      <CurrentRate />

      <RouteMap route={props.routeData?.active ? route : undefined} currentLoc={props.currentLoc} line={props.line} />

      {showRouteDetails && route ? (
        <RouteSummary route={route} liveDistanceM={props.liveDistanceM} liveDurationS={props.liveDurationS} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[4] },
});
