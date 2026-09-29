import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { DriverRoute } from '../../types/route';
import { formatDistance, formatDuration, stopCounts } from '../../utils/route';
import { Card, StatusPill, Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface RouteSummaryProps {
  route: DriverRoute;
  /** Road distance and time still to go, from the live routing line. */
  liveDistanceM: number | null;
  liveDurationS: number | null;
}

/** Distance, time and stop progress. Only real figures are shown; unknown ones read "—". */
export default function RouteSummary({ route, liveDistanceM, liveDurationS }: RouteSummaryProps) {
  const { t } = useTranslation();
  const { total, done, failed } = stopCounts(route);

  const live = liveDistanceM !== null;
  const distance = live
    ? formatDistance(liveDistanceM)
    : route.total_distance_km
      ? formatDistance(route.total_distance_km * 1000)
      : '—';
  const duration =
    liveDurationS !== null
      ? formatDuration(liveDurationS / 60)
      : route.total_duration_minutes
        ? formatDuration(route.total_duration_minutes)
        : '—';

  const statusLabel = route.status === 'pending' ? t('status_not_started') : t('status_in_progress');
  const ratio = total > 0 ? done / total : 0;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header">
          {t('trip_details')}
        </Text>
        <StatusPill label={statusLabel} tone={route.status === 'pending' ? 'neutral' : 'info'} />
      </View>

      <View style={styles.stats}>
        <View style={styles.stat} accessible accessibilityLabel={`${live ? t('distance_left') : t('route_distance')}: ${distance}`}>
          <Text variant="caption" color="textMuted">
            {live ? t('distance_left') : t('route_distance')}
          </Text>
          <Text variant="title">{distance}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat} accessible accessibilityLabel={`${live ? t('time_left') : t('planned_time')}: ${duration}`}>
          <Text variant="caption" color="textMuted">
            {live ? t('time_left') : t('planned_time')}
          </Text>
          <Text variant="title">{duration}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat} accessible accessibilityLabel={`${t('stops_done')}: ${done} ${t('of')} ${total}`}>
          <Text variant="caption" color="textMuted">
            {t('stops_done')}
          </Text>
          <Text variant="title">{`${done}/${total}`}</Text>
        </View>
      </View>

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel={t('journey_progress')}
        accessibilityValue={{ min: 0, max: total, now: done }}
      >
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
      {failed > 0 ? (
        <Text variant="caption" color="warning">
          {`${failed} ${t('stops_failed')}`}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  stats: { flexDirection: 'row', alignItems: 'stretch' },
  stat: { flex: 1, gap: space[1] },
  divider: { width: size.border, backgroundColor: colors.border, marginHorizontal: space[3] },
  track: { height: space[2], borderRadius: radius.full, backgroundColor: colors.neutralSoft, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.accentFill },
});
