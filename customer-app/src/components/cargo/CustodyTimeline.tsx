import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card, Text } from '../ui';
import { colors, radius, size, space } from '../../theme';
import type { CargoNotice, CargoWhere, CustodyEvent, Tracking } from '../../services/api';
import type { TranslateFn } from '../../hooks/useTranslation';
import { useTranslation } from '../../hooks/useTranslation';
import { conditionText, piecesText } from '../../utils/cargo';
import { formatDateTime } from '../../utils/format';

type Icon = keyof typeof Feather.glyphMap;

interface Item {
  key: string;
  icon: Icon;
  title: string;
  details: string[];
  at: string | null;
}

/** The truck-change wording names the cause only for these two, which customers understand without detail. */
const TRANSFER_CAUSE: Partial<Record<string, string>> = {
  vehicle_breakdown: 'tl_moved_truck_breakdown',
  vehicle_accident: 'tl_moved_truck_accident',
};

/** One event in plain words, or null for kinds a customer has no use for (or does not know yet). */
function describe(e: CustodyEvent, total: number | null, cause: string | null, t: TranslateFn): { icon: Icon; title: string } | null {
  const pieces = e.pieces != null ? piecesText(e.pieces, t) : null;
  switch (e.kind) {
    case 'booked':
      return { icon: 'file-text', title: t('tl_booked') };
    case 'accepted':
      return { icon: 'user-check', title: t('tl_accepted') };
    case 'arrived_pickup':
      return { icon: 'map-pin', title: t('tl_arrived_pickup') };
    case 'pickup':
      return { icon: 'package', title: pieces ? t('tl_picked_up_pieces', { pieces }) : t('tl_picked_up') };
    case 'departed':
      return { icon: 'truck', title: t('tl_departed') };
    case 'arrived_drop':
      return { icon: 'map-pin', title: t('tl_arrived_drop') };
    case 'delivery':
      return { icon: 'check-circle', title: pieces ? t('tl_delivered_pieces', { pieces }) : t('tl_delivered') };
    case 'partial_delivery':
      return {
        icon: 'check-circle',
        title:
          e.pieces != null && total != null
            ? t('tl_partial_of', { n: e.pieces, total })
            : pieces
              ? t('tl_partial_pieces', { pieces })
              : t('tl_partial'),
      };
    case 'refused':
      return { icon: 'x-circle', title: t('tl_refused') };
    case 'undelivered':
      return { icon: 'alert-circle', title: t('tl_undelivered') };
    case 'handover_out':
      return { icon: 'repeat', title: t(e.to_holder === 'hub' ? 'tl_handover_out_hub' : 'tl_handover_out') };
    case 'handover_in':
      if (e.to_holder === 'hub') {
        return { icon: 'home', title: e.depot_name ? t('tl_moved_to_hub_named', { name: e.depot_name }) : t('tl_moved_to_hub') };
      }
      return { icon: 'repeat', title: t((cause && TRANSFER_CAUSE[cause]) || 'tl_moved_truck') };
    case 'hub_in':
      return { icon: 'home', title: e.depot_name ? t('tl_hub_in_named', { name: e.depot_name }) : t('tl_hub_in') };
    case 'hub_out':
      return { icon: 'truck', title: t('tl_hub_out') };
    case 'return_pickup':
      return { icon: 'corner-up-left', title: t('tl_return_pickup') };
    case 'return_delivery':
      return { icon: 'corner-up-left', title: t('tl_return_delivery') };
    case 'inspection':
      return { icon: 'search', title: t('tl_inspection') };
    case 'hold':
      return { icon: 'pause-circle', title: t('tl_hold') };
    case 'release_hold':
      return { icon: 'play-circle', title: t('tl_release_hold') };
    case 'lost':
      return { icon: 'alert-octagon', title: t('tl_lost') };
    case 'split':
      return { icon: 'git-branch', title: t('tl_split') };
    case 'merge':
      return { icon: 'git-merge', title: t('tl_merge') };
    default:
      return null;
  }
}

const timeOf = (at: string | null) => (at ? new Date(at).getTime() || 0 : Number.POSITIVE_INFINITY);

/** Builds the list, oldest first. Only recorded data: nothing is inferred beyond the event itself. */
export function buildTimeline(
  events: CustodyEvent[],
  where: CargoWhere | null,
  notices: CargoNotice[],
  history: Tracking['history'],
  t: TranslateFn,
): Item[] {
  const total = where?.pieces.total ?? null;
  const items: Item[] = [];
  // The customer's view carries no case or transfer ids, so the cause of a move comes from an open
  // vehicle case, when there is one (the case closes once the transfer completes).
  const cause = notices.find((n) => TRANSFER_CAUSE[n.type])?.type ?? null;

  events.forEach((e, index) => {
    // A completed transfer has both halves, one after the other; the receiving one says it better.
    if (e.kind === 'handover_out' && events.slice(index + 1).some((n) => n.kind === 'handover_in')) return;
    const text = describe(e, total, cause, t);
    if (!text) return;
    const details: string[] = [];
    if (e.condition && (e.kind === 'inspection' || e.condition !== 'good')) details.push(conditionText(e.condition, t));
    if (e.receiver_name && (e.kind === 'delivery' || e.kind === 'partial_delivery')) {
      details.push(t('tl_received_by', { name: e.receiver_name }));
    }
    // A split booking's timeline merges its lots' events, each tagged with its lot
    const title = e.lot_label ? t('tl_lot_prefix', { label: e.lot_label, title: text.title }) : text.title;
    items.push({ key: e.id, icon: text.icon, title, details, at: e.recorded_at });
  });

  // "Out for delivery" is a status change, not a custody event, so it comes from the shipment's history.
  const outForDelivery = history.filter((h) => h.status === 'out_for_delivery');
  outForDelivery.forEach((h, i) =>
    items.push({ key: `ofd-${i}`, icon: 'truck', title: t('tl_out_for_delivery'), details: [], at: h.at }),
  );
  if (outForDelivery.length === 0 && where?.status === 'out_for_delivery') {
    items.push({ key: 'ofd-now', icon: 'truck', title: t('tl_out_for_delivery'), details: [], at: null });
  }

  return items.sort((a, b) => timeOf(a.at) - timeOf(b.at));
}

export function CustodyTimeline({
  events,
  where,
  notices,
  history,
}: {
  events: CustodyEvent[];
  where: CargoWhere | null;
  notices: CargoNotice[];
  history: Tracking['history'];
}) {
  const { t } = useTranslation();
  const items = buildTimeline(events, where, notices, history, t);
  if (items.length === 0) return null;

  return (
    <Card style={styles.card}>
      <Text variant="title" accessibilityRole="header">
        {t('tl_title')}
      </Text>
      {items.map((item, index) => {
        const time = item.at ? formatDateTime(item.at) : null;
        const last = index === items.length - 1;
        return (
          <View
            key={item.key}
            style={styles.row}
            accessible
            accessibilityLabel={[item.title, time, ...item.details].filter(Boolean).join(', ')}
          >
            <View style={styles.rail}>
              <View style={[styles.dot, last && styles.dotLatest]}>
                <Feather name={item.icon} size={size.icon.sm} color={last ? colors.onAccentFill : colors.textMuted} />
              </View>
              {!last ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.body}>
              <Text variant="bodyMedium">{item.title}</Text>
              {time ? (
                <Text variant="caption" color="textMuted">
                  {time}
                </Text>
              ) : null}
              {item.details.map((d, i) => (
                <Text key={i} variant="bodySmall" color="textMuted">
                  {d}
                </Text>
              ))}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

const DOT = 28;

const styles = StyleSheet.create({
  card: { gap: space[3] },
  row: { flexDirection: 'row', gap: space[3] },
  rail: { alignItems: 'center' },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: size.border,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotLatest: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: space[1], marginBottom: -space[3] },
  body: { flex: 1, gap: space[1], paddingBottom: space[1] },
});
