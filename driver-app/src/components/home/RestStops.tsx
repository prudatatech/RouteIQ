import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { RouteStop } from '../../types/route';
import { fill } from '../../locales';
import { Card, Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface RestStopsProps {
  /** The pending stops after the one on the card, in order. */
  stops: RouteStop[];
  /** Where the driver's stop count stands: the stop numbers continue from it. */
  firstNumber: number;
  /** A stop a notification opened, marked so it is easy to find. */
  focusStopId?: string | null;
  /** Tapping a stop opens its actions. Left out when the trip has not started. */
  onPressStop?: (stop: RouteStop) => void;
}

/** The rest of the trip, compact: number, place, address. The card above owns the actions. */
export default function RestStops({ stops, firstNumber, focusStopId, onPressStop }: RestStopsProps) {
  const { t } = useTranslation();
  if (stops.length === 0) return null;
  return (
    <Card padded={false}>
      <Text variant="title" accessibilityRole="header" style={styles.title}>
        {fill(t('na2_rest_title'), { n: stops.length })}
      </Text>
      {stops.map((stop, idx) => {
        const name = stop.delivery_point?.name || `${t('stop')} ${stop.sequence}`;
        const focused = stop.id === focusStopId;
        return (
          <Pressable
            key={stop.id}
            disabled={!onPressStop}
            onPress={() => onPressStop?.(stop)}
            accessibilityRole={onPressStop ? 'button' : undefined}
            accessibilityLabel={`${firstNumber + idx}. ${name}`}
            style={({ pressed }) => [styles.row, idx > 0 && styles.rowBorder, focused && styles.focused, pressed && styles.pressed]}
          >
            <View style={styles.badge} importantForAccessibility="no-hide-descendants">
              <Text variant="captionMedium">{firstNumber + idx}</Text>
            </View>
            <View style={styles.info}>
              <Text variant="bodyMedium" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
                {stop.delivery_point?.address || t('no_address')}
              </Text>
            </View>
            {onPressStop ? <Ionicons name="chevron-forward" size={size.icon.sm} color={colors.textMuted} /> : null}
          </Pressable>
        );
      })}
    </Card>
  );
}

const BADGE = 32;

const styles = StyleSheet.create({
  title: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[3], minHeight: size.control },
  rowBorder: { borderTopWidth: size.border, borderTopColor: colors.border },
  pressed: { opacity: 0.7 },
  focused: { backgroundColor: colors.accentSoft },
  badge: { width: BADGE, height: BADGE, borderRadius: radius.full, backgroundColor: colors.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
});
