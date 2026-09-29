import React, { useState } from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Alert, Animated, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { PendingRoute } from '../../hooks/useDriverRoute';
import { errorMessage } from '../../utils/errors';
import { Button, Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface AssignmentDialogProps {
  /** A stop inserted into the current route is answered before a new route. */
  kind: 'route' | 'stop';
  pendingRoute: PendingRoute | null;
  stopName?: string | null;
  pulse: Animated.Value;
  onAccept: () => Promise<unknown>;
  /** Stop: flag it to dispatch. Route: hide until the next refresh. */
  onSecondary: () => Promise<unknown> | void;
}

export default function AssignmentDialog({
  kind,
  pendingRoute,
  stopName,
  pulse,
  onAccept,
  onSecondary,
}: AssignmentDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'accept' | 'secondary' | null>(null);
  const isRoute = kind === 'route';

  const run = async (which: 'accept' | 'secondary', action: () => Promise<unknown> | void) => {
    setBusy(which);
    try {
      await action();
    } catch (e) {
      Alert.alert(t('error'), errorMessage(e, t('action_failed')));
    } finally {
      setBusy(null);
    }
  };

  const routeType = pendingRoute?.route_type === 'backhaul' ? t('route_type_backhaul') : t('route_type_forward');
  const stopCount = Array.isArray(pendingRoute?.stops) ? pendingRoute!.stops!.length : 0;

  return (
    <>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          {isRoute ? (
            <MaterialCommunityIcons name="truck-delivery" size={size.icon.xl} color={colors.accent} />
          ) : (
            <Ionicons name="location" size={size.icon.xl} color={colors.accent} />
          )}
        </View>
        <Text variant="heading" align="center" accessibilityRole="header">
          {isRoute ? t('new_cargo_assigned') : t('new_stop_added')}
        </Text>
      </View>

      {isRoute && pendingRoute ? (
        <View style={styles.details}>
          <View style={styles.detailRow}>
            <Text variant="bodySmall" color="textMuted">
              {t('route_type')}
            </Text>
            <Text variant="bodySmallMedium">{routeType}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text variant="bodySmall" color="textMuted">
              {t('route_id')}
            </Text>
            <Text variant="monoMedium">{pendingRoute.id?.slice(0, 8)}</Text>
          </View>
          {stopCount > 0 ? (
            <View style={styles.detailRow}>
              <Text variant="bodySmall" color="textMuted">
                {t('stops_label')}
              </Text>
              <Text variant="bodySmallMedium">{stopCount}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Text variant="body" align="center">
        {isRoute ? t('cargo_route_msg') : `${t('cargo_stop_msg')} ${stopName || t('stop')}`}
      </Text>

      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Button
          title={t('accept_btn')}
          onPress={() => run('accept', onAccept)}
          loading={busy === 'accept'}
          disabled={busy !== null}
          icon={(color) => <Ionicons name="checkmark" size={size.icon.md} color={color} />}
        />
      </Animated.View>
      <Button
        title={isRoute ? t('not_now') : t('flag_issue')}
        variant="secondary"
        onPress={() => run('secondary', onSecondary)}
        loading={busy === 'secondary'}
        disabled={busy !== null}
      />
    </>
  );
}

const ICON = 56;

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space[3] },
  iconCircle: {
    width: ICON,
    height: ICON,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.border,
    padding: space[3],
    gap: space[2],
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
