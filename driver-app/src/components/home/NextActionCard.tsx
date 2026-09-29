import React from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { RouteStop } from '../../types/route';
import { formatDistance, isPickup, stopCounts, type NextStep } from '../../utils/route';
import SwipeButton from '../SwipeButton';
import { Button, Card, EmptyState, Text } from '../ui';
import { colors, size, space } from '../../theme';

interface NextActionCardProps {
  step: NextStep;
  noVehicle: boolean;
  isStartingTracking: boolean;
  refreshing: boolean;
  canFindReturnLoad: boolean;
  /** Resolve false to let the driver swipe again. */
  onStartRoute: () => Promise<boolean>;
  onEnableTracking: () => void;
  onNavigate: (stop: RouteStop) => void;
  onArrivedManually: (stop: RouteStop) => void;
  onConfirmStop: (stop: RouteStop) => void;
  onReportIssue: (stop: RouteStop) => void;
  onFindReturnLoad: () => void;
  onRefresh: () => void;
}

/** One large card with only the current step's action. */
export default function NextActionCard(props: NextActionCardProps) {
  const { t } = useTranslation();
  const { step } = props;

  if (step.kind === 'no_route') {
    return (
      <Card>
        <EmptyState
          icon={<MaterialCommunityIcons name="truck-outline" size={size.icon.xl} color={colors.textMuted} />}
          title={props.noVehicle ? t('no_vehicle_title') : t('no_route_title')}
          message={props.noVehicle ? t('no_vehicle_desc') : t('no_route_desc')}
          action={{ label: t('check_updates'), onPress: props.onRefresh, loading: props.refreshing }}
        />
      </Card>
    );
  }

  if (step.kind === 'no_stops') {
    return (
      <Card>
        <EmptyState
          icon={<Ionicons name="hourglass-outline" size={size.icon.xl} color={colors.textMuted} />}
          title={t('no_stops_title')}
          message={t('no_stops_desc')}
          action={{ label: t('check_updates'), onPress: props.onRefresh, loading: props.refreshing }}
        />
      </Card>
    );
  }

  if (step.kind === 'completed') {
    return (
      <Card>
        <EmptyState
          icon={<Ionicons name="checkmark-circle" size={size.icon.xl} color={colors.success} />}
          title={t('alert_route_completed_title')}
          message={t('na_completed_desc')}
          action={
            props.canFindReturnLoad
              ? { label: t('find_return_load_btn'), onPress: props.onFindReturnLoad, variant: 'primary' }
              : undefined
          }
        />
      </Card>
    );
  }

  const { total, done } = stopCounts(step.route);
  const progress = `${t('stop')} ${Math.min(done + 1, total)} ${t('of')} ${total}`;

  if (step.kind === 'start') {
    return (
      <Card style={styles.card}>
        <Text variant="captionMedium" color="accent">
          {t('next_step')}
        </Text>
        <Text variant="heading" accessibilityRole="header">
          {t('na_start_title')}
        </Text>
        <Text variant="bodySmall" color="textMuted">
          {`${t('stops_label')}: ${total}`}
        </Text>
        <SwipeButton key={`start-${step.route.id}`} title={t('na_swipe_start')} onComplete={props.onStartRoute} />
      </Card>
    );
  }

  const stop = step.stop;
  const name = stop.delivery_point?.name || `${t('stop')} ${stop.sequence}`;
  const address = stop.delivery_point?.address;

  if (step.kind === 'enable_tracking') {
    return (
      <Card style={styles.card}>
        <Text variant="captionMedium" color="accent">
          {t('next_step')}
        </Text>
        <Text variant="heading" accessibilityRole="header">
          {t('na_tracking_title')}
        </Text>
        <Text variant="bodySmall" color="textMuted">
          {t('na_tracking_desc')}
        </Text>
        <Button
          title={t('na_tracking_btn')}
          onPress={props.onEnableTracking}
          loading={props.isStartingTracking}
          icon={(color) => <Ionicons name="radio" size={size.icon.md} color={color} />}
        />
      </Card>
    );
  }

  const confirmLabel = isPickup(stop) ? t('na_swipe_pickup') : t('na_swipe_deliver');

  return (
    <Card style={styles.card}>
      <Text variant="captionMedium" color={step.kind === 'arrived' ? 'success' : 'accent'}>
        {step.kind === 'arrived' ? t('na_arrived_title') : `${t('next_stop')} · ${progress}`}
      </Text>
      <Text variant="heading" accessibilityRole="header" numberOfLines={2}>
        {name}
      </Text>
      {address ? (
        <Text variant="bodySmall" color="textMuted" numberOfLines={2}>
          {address}
        </Text>
      ) : null}
      {step.distanceM !== null ? (
        <View style={styles.meta}>
          <Ionicons name="navigate-outline" size={size.icon.sm} color={colors.textMuted} />
          <Text variant="bodySmall" color="textMuted">
            {`${formatDistance(step.distanceM)} ${t('away')}`}
          </Text>
        </View>
      ) : null}

      {step.kind === 'arrived' ? (
        <>
          {/* Opening the proof-of-delivery form resets the swipe; submitting it moves the route on. */}
          <SwipeButton
            key={`arrive-${stop.id}`}
            title={confirmLabel}
            tone="success"
            onComplete={() => {
              props.onConfirmStop(stop);
              return false;
            }}
          />
          <Button
            title={t('action_navigation')}
            variant="ghost"
            onPress={() => props.onNavigate(stop)}
            icon={(color) => <Ionicons name="navigate" size={size.icon.md} color={color} />}
          />
          <Button
            title={t('issue_btn')}
            variant="secondary"
            onPress={() => props.onReportIssue(stop)}
            icon={(color) => <Ionicons name="warning-outline" size={size.icon.md} color={color} />}
          />
        </>
      ) : (
        <>
          <Button
            title={t('na_navigate')}
            onPress={() => props.onNavigate(stop)}
            icon={(color) => <Ionicons name="navigate" size={size.icon.md} color={color} />}
          />
          <Button title={t('na_arrived_manual')} variant="ghost" onPress={() => props.onArrivedManually(stop)} />
          <Button
            title={t('issue_btn')}
            variant="secondary"
            onPress={() => props.onReportIssue(stop)}
            icon={(color) => <Ionicons name="warning-outline" size={size.icon.md} color={color} />}
          />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
});
