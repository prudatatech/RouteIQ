import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { DriverRoute, RouteStop } from '../../types/route';
import { isPickup, pendingStops, sortedStops } from '../../utils/route';
import { Button, Card, StatusPill, Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface StopListProps {
  route: DriverRoute;
  /** Per-stop actions are offered once the route has started. */
  actionsEnabled: boolean;
  onComplete: (stop: RouteStop) => void;
  onReportIssue: (stop: RouteStop) => void;
}

/** Every stop in order, with complete / report issue for pending ones. */
export default function StopList({ route, actionsEnabled, onComplete, onReportIssue }: StopListProps) {
  const { t } = useTranslation();
  const stops = sortedStops(route);
  const nextId = pendingStops(route)[0]?.id;

  return (
    <Card padded={false}>
      <Text variant="title" accessibilityRole="header" style={styles.title}>
        {`${t('all_stops')} (${stops.length})`}
      </Text>
      {stops.map((stop, idx) => {
        const name = stop.delivery_point?.name || `${t('stop')} ${idx + 1}`;
        const done = stop.status === 'completed';
        const failed = stop.status === 'failed';
        const pending = stop.status === 'pending';
        return (
          <View key={stop.id} style={[styles.row, idx > 0 && styles.rowBorder]}>
            <View style={styles.rowMain}>
              <View
                style={[styles.badge, done && styles.badgeDone, failed && styles.badgeFailed]}
                importantForAccessibility="no-hide-descendants"
              >
                {done ? (
                  <Ionicons name="checkmark" size={size.icon.sm} color={colors.onSolid} />
                ) : failed ? (
                  <Ionicons name="close" size={size.icon.sm} color={colors.onSolid} />
                ) : (
                  <Text variant="captionMedium">{idx + 1}</Text>
                )}
              </View>
              <View style={styles.info}>
                <Text variant="bodyMedium" numberOfLines={1}>
                  {name}
                </Text>
                <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
                  {stop.delivery_point?.address || t('no_address')}
                </Text>
              </View>
              {done ? (
                <StatusPill tone="success" label={t('stop_done')} />
              ) : failed ? (
                <StatusPill tone="danger" label={t('stop_failed')} />
              ) : stop.id === nextId ? (
                <StatusPill tone="accent" label={t('stop_next')} />
              ) : null}
            </View>

            {pending && actionsEnabled ? (
              <View style={styles.actions}>
                <Button
                  title={t('issue')}
                  variant="secondary"
                  block={false}
                  style={styles.action}
                  accessibilityLabel={`${t('action_issue')}: ${name}`}
                  onPress={() => onReportIssue(stop)}
                />
                <Button
                  title={isPickup(stop) ? t('pickup_label') : t('deliver')}
                  variant="secondary"
                  block={false}
                  style={styles.action}
                  accessibilityLabel={`${isPickup(stop) ? t('pickup_label') : t('deliver')}: ${name}`}
                  onPress={() => onComplete(stop)}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const BADGE = 32;

const styles = StyleSheet.create({
  title: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[2] },
  row: { paddingHorizontal: space[4], paddingVertical: space[3], gap: space[2] },
  rowBorder: { borderTopWidth: size.border, borderTopColor: colors.border },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: radius.full,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDone: { backgroundColor: colors.success },
  badgeFailed: { backgroundColor: colors.danger },
  info: { flex: 1 },
  actions: { flexDirection: 'row', gap: space[2], paddingLeft: BADGE + space[3] },
  action: { flex: 1 },
});
