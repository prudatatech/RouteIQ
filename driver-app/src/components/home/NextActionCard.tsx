import React, { type ReactNode } from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useConsignmentInfo, type VehicleTransfer } from '../../hooks/useCargo';
import type { OnBoardItem } from '../../services/cargo';
import type { RouteStop } from '../../types/route';
import { fill } from '../../locales';
import { formatDistance } from '../../utils/route';
import type { NextAction, StopLot, UpcomingTrip } from '../../utils/nextAction';
import SwipeButton from '../SwipeButton';
import LotLine from '../cargo/LotLine';
import { Banner, Button, Card, StatusPill, Text } from '../ui';
import { colors, size, space } from '../../theme';

interface NextActionCardProps {
  action: NextAction;
  isStartingTracking: boolean;
  refreshing: boolean;
  canFindReturnLoad: boolean;
  /** The open SOS, so it can be cancelled from the card. */
  sosId: string | null;
  /** Resolve false to let the driver swipe again. */
  onStartRoute: () => Promise<boolean>;
  onEnableTracking: () => void;
  onNavigate: (stop: RouteStop) => void;
  onArrivedManually: (stop: RouteStop) => void;
  onConfirmStop: (stop: RouteStop) => void;
  onReportIssue: (stop: RouteStop) => void;
  onFindReturnLoad: () => void;
  onRefresh: () => void;
  onAcceptTrip: () => void;
  onOpenTransfer: (transfer: VehicleTransfer) => void;
  onRecordPickup: (stop: RouteStop | null) => void;
  onDepart: (items: OnBoardItem[]) => void;
  onOpenReturnPickup: () => void;
  onOpenHubDrop: () => void;
  onOpenCargoCheck: () => void;
  onCallDispatch: () => void;
  onOpenDocuments: () => void;
  onRegisterVehicle: () => void;
  onCancelSos: (id: string) => void;
}

type Tone = 'accent' | 'danger' | 'warning' | 'success' | 'neutral';

const TONE: Record<Tone, { border: string; fg: string; textColor: 'accent' | 'danger' | 'warning' | 'success' | 'textMuted' }> = {
  accent: { border: colors.border, fg: colors.accent, textColor: 'accent' },
  danger: { border: colors.danger, fg: colors.danger, textColor: 'danger' },
  warning: { border: colors.warning, fg: colors.warning, textColor: 'warning' },
  success: { border: colors.border, fg: colors.success, textColor: 'success' },
  neutral: { border: colors.border, fg: colors.textMuted, textColor: 'textMuted' },
};

interface HeroProps {
  tone?: Tone;
  icon: ReactNode | ((color: string) => ReactNode);
  eyebrow?: string;
  title: string;
  lines?: (string | null | undefined)[];
  children?: ReactNode;
}

/** The card's frame: what the step is, in a line, then what to do about it. */
function Hero({ tone = 'accent', icon, eyebrow, title, lines = [], children }: HeroProps) {
  const { t } = useTranslation();
  const look = TONE[tone];
  return (
    <Card style={[styles.card, tone === 'danger' || tone === 'warning' ? { borderColor: look.border, borderWidth: 2 } : null]}>
      <View style={styles.head}>
        {typeof icon === 'function' ? icon(look.fg) : icon}
        <Text variant="captionMedium" color={look.textColor} style={styles.flex}>
          {eyebrow ?? t('next_step')}
        </Text>
      </View>
      <Text variant="heading" accessibilityRole="header" accessibilityLiveRegion="polite">
        {title}
      </Text>
      {lines.filter(Boolean).map((line, i) => (
        <Text key={i} variant="bodySmall" color="textMuted">
          {line}
        </Text>
      ))}
      {children}
    </Card>
  );
}

const ion = (name: keyof typeof Ionicons.glyphMap) => (color: string) => <Ionicons name={name} size={size.icon.lg} color={color} />;

const asLotTag = (lot: StopLot) => ({ label: lot.label, masterCode: null, consigneeName: lot.consigneeName, consigneePhone: null });

/** "Ask for the 6-digit code" when the server says this consignment needs one. */
function OtpHint({ code }: { code: string }) {
  const { t } = useTranslation();
  const { info } = useConsignmentInfo(code || null);
  return info?.otpRequired === true ? <Banner tone="info" icon="key-outline" message={t('na2_otp_needed')} /> : null;
}

const icon = (name: keyof typeof Ionicons.glyphMap) => (color: string) => <Ionicons name={name} size={size.icon.md} color={color} />;

/** One large card with only the current step: what to do, and the button that does it. */
export default function NextActionCard(props: NextActionCardProps) {
  const { t } = useTranslation();
  const { action } = props;

  const call = <Button title={t('call_dispatch')} variant="secondary" onPress={props.onCallDispatch} icon={icon('call-outline')} />;
  const refresh = <Button title={t('check_updates')} variant="secondary" onPress={props.onRefresh} loading={props.refreshing} />;

  switch (action.kind) {
    case 'sos_open':
      return (
        <Hero tone="danger" icon={ion('alert-circle')} eyebrow={t('sos')} title={t('na2_sos_title')} lines={[t('na2_sos_desc')]}>
          {call}
          {props.sosId ? (
            <Button title={t('na2_sos_cancel')} variant="ghost" onPress={() => props.onCancelSos(props.sosId!)} />
          ) : null}
        </Hero>
      );

    case 'dispatch_blocked':
      return (
        <Hero tone="danger" icon={ion('document-lock-outline')} title={t('na2_blocked_title')} lines={action.issues.map((i) => t(`na2_blocked_${i}`))}>
          {action.issues.some((i) => i !== 'not_active') ? <Button title={t('na2_open_docs')} onPress={props.onOpenDocuments} icon={icon('document-text-outline')} /> : null}
          {call}
        </Hero>
      );

    case 'cargo_on_hold':
      return (
        <Hero tone="warning" icon={ion('pause-circle-outline')} title={t('na2_hold_title')} lines={[t('na2_hold_desc')]}>
          {action.items.map((item) => (
            <LotLine key={item.code} code={item.code} pieces={item.pieces} lot={item.lot} />
          ))}
          {call}
          <Button title={t('cargo_check_title')} variant="secondary" onPress={props.onOpenCargoCheck} icon={icon('cube-outline')} />
        </Hero>
      );

    case 'no_vehicle':
      return (
        <Hero tone="neutral" icon={ion('car-outline')} title={t('no_vehicle_title')} lines={[t('no_vehicle_desc')]}>
          <Button title={t('na2_register_vehicle')} onPress={props.onRegisterVehicle} />
          {refresh}
        </Hero>
      );

    case 'accept_trip': {
      const a = action.assignment;
      const isStop = a.kind === 'stop';
      const desc = isStop
        ? a.stopName
          ? fill(t('na2_accept_stop_desc'), { place: a.stopName })
          : t('na2_accept_stop_desc_plain')
        : a.stops && a.firstStop
          ? fill(t('na2_accept_desc'), { n: a.stops, place: a.firstStop })
          : t('na2_accept_desc_plain');
      return (
        <Hero icon={ion('notifications-outline')} title={isStop ? t('na2_accept_stop_title') : t('na2_accept_title')} lines={[desc]}>
          <Button title={t('na2_accept_btn')} onPress={props.onAcceptTrip} icon={icon('checkmark-circle-outline')} />
        </Hero>
      );
    }

    case 'receive_goods':
    case 'hand_over':
    case 'drop_at_hub': {
      const { transfer, direction } = action.transfer;
      const receive = action.kind === 'receive_goods';
      const title =
        action.kind === 'drop_at_hub'
          ? transfer.depotName
            ? fill(t('na2_hub_title'), { name: transfer.depotName })
            : t('na2_hub_title_plain')
          : receive
            ? transfer.fromPlate
              ? fill(t('na2_receive_title'), { plate: transfer.fromPlate })
              : t('na2_receive_title_plain')
            : transfer.toPlate
              ? fill(t('na2_handover_title'), { plate: transfer.toPlate })
              : t('na2_handover_title_plain');
      return (
        <Hero
          icon={(c) => <Ionicons name="swap-horizontal" size={size.icon.lg} color={c} />}
          title={title}
          lines={[transfer.meetAddress ? fill(t('na2_meet'), { place: transfer.meetAddress }) : null, transfer.note]}
        >
          {transfer.items.map((item) => (
            <LotLine key={item.code} code={item.code} pieces={direction === 'out' ? item.piecesPlanned : item.piecesOut ?? item.piecesPlanned} lot={item.lot} />
          ))}
          <Button title={receive ? t('cargo_receive_title') : action.kind === 'drop_at_hub' ? t('cargo_hub_title') : t('cargo_handover_title')} onPress={() => props.onOpenTransfer(action.transfer)} />
        </Hero>
      );
    }

    case 'record_pickup': {
      const desc = action.scanned > 0
        ? fill(t('na2_pickup_scanned'), { n: action.scanned })
        : action.from
          ? action.pieces !== null
            ? fill(t('na2_pickup_desc_from'), { n: action.pieces, from: action.from })
            : fill(t('na2_pickup_desc_from_plain'), { from: action.from })
          : null;
      return (
        <Hero icon={ion('clipboard-outline')} title={t('na2_pickup_title')} lines={[desc]}>
          <Button title={t('na2_pickup_btn')} onPress={() => props.onRecordPickup(action.stop)} icon={icon('clipboard-outline')} />
          {action.stop ? <Button title={t('issue_btn')} variant="secondary" onPress={() => props.onReportIssue(action.stop!)} icon={icon('warning-outline')} /> : null}
        </Hero>
      );
    }

    case 'depart':
      return (
        <Hero icon={ion('arrow-forward-circle-outline')} title={t('na2_depart_title')} lines={[fill(t('na2_depart_desc'), { n: action.items.length })]}>
          <Button title={t('cargo_depart_now')} onPress={() => props.onDepart(action.items)} icon={icon('arrow-forward-circle-outline')} />
        </Hero>
      );

    case 'no_stops':
      return (
        <Hero tone="neutral" icon={ion('hourglass-outline')} title={t('no_stops_title')} lines={[t('no_stops_desc')]}>
          {refresh}
        </Hero>
      );

    case 'start_trip':
      return (
        <Hero title={t('na_start_title')} icon={ion('play-circle-outline')} lines={[`${t('stops_label')}: ${action.stops}`]}>
          <SwipeButton key={`start-${action.route.id}`} title={t('na_swipe_start')} onComplete={props.onStartRoute} />
        </Hero>
      );

    case 'enable_tracking':
      return (
        <Hero title={t('na_tracking_title')} icon={ion('radio-outline')} lines={[t('na_tracking_desc')]}>
          <Button title={t('na_tracking_btn')} onPress={props.onEnableTracking} loading={props.isStartingTracking} icon={icon('radio')} />
        </Hero>
      );

    case 'return_pickup': {
      const name = action.stop.delivery_point?.name;
      return (
        <Hero icon={ion('arrow-undo-outline')} title={name ? `${t('na2_return_title')}: ${name}` : t('na2_return_title')} lines={[fill(t('na2_return_desc'), { code: action.code })]}>
          <Button title={t('na2_return_btn')} onPress={props.onOpenReturnPickup} icon={icon('arrow-undo-outline')} />
          <Button title={t('na_navigate')} variant="ghost" onPress={() => props.onNavigate(action.stop)} icon={icon('navigate')} />
        </Hero>
      );
    }

    case 'hub_drop':
      return (
        <Hero icon={ion('business-outline')} title={t('na2_hubdrop_title')} lines={[fill(t('na2_hubdrop_desc'), { n: action.items.length })]}>
          <Button title={t('cargo_hub_title')} onPress={props.onOpenHubDrop} icon={icon('business-outline')} />
        </Hero>
      );

    case 'deliver': {
      const { stop, lots } = action;
      const name = stop.delivery_point?.name || `${t('stop')} ${stop.sequence}`;
      const lot = lots[0];
      const together = new Set(lots.map((l) => l.consigneeName ?? '')).size === 1;
      const consignee = lot?.consigneeName ?? stop.delivery_point?.consignee_name ?? null;
      const title = !consignee
        ? fill(t('na2_deliver_title_plain'), { n: action.index, total: action.total })
        : lots.length === 1 && lot?.label
          ? fill(t('na2_deliver_lot_title'), { label: lot.label, consignee })
          : fill(t('na2_deliver_title'), { consignee: together ? consignee : name });
      return (
        <Hero
          tone="success"
          icon={ion('location')}
          eyebrow={t('na_arrived_title')}
          title={title}
          lines={[`${fill(t('na2_deliver_here'), { n: action.index, total: action.total })} ${name}`, stop.delivery_point?.address]}
        >
          {lots.map((l) => (
            <LotLine key={l.code || stop.id} code={l.code} pieces={l.pieces} lot={asLotTag(l)} hideConsignee={lots.length === 1} />
          ))}
          {lot?.code ? <OtpHint code={lot.code} /> : null}
          {/* Opening the proof-of-delivery form resets the swipe; submitting it moves the route on. */}
          <SwipeButton
            key={`arrive-${stop.id}`}
            title={t('na_swipe_deliver')}
            tone="success"
            onComplete={() => {
              props.onConfirmStop(stop);
              return false;
            }}
          />
          <Button title={t('na_navigate')} variant="ghost" onPress={() => props.onNavigate(stop)} icon={icon('navigate')} />
          <Button title={t('issue_btn')} variant="secondary" onPress={() => props.onReportIssue(stop)} icon={icon('warning-outline')} />
        </Hero>
      );
    }

    case 'go_to_stop': {
      const { stop } = action;
      const name = stop.delivery_point?.name || `${t('stop')} ${stop.sequence}`;
      const title = action.pickup
        ? fill(t('na2_go_pickup_title'), { place: name })
        : `${fill(t('na2_go_stop_title'), { n: action.index, total: action.total })}: ${name}`;
      return (
        <Hero
          icon={ion('navigate-circle-outline')}
          eyebrow={`${t('next_stop')} · ${t('stop')} ${action.index} ${t('of')} ${action.total}`}
          title={title}
          lines={[stop.delivery_point?.address, action.distanceM !== null ? `${formatDistance(action.distanceM)} ${t('away')}` : null]}
        >
          <Button title={t('na_navigate')} onPress={() => props.onNavigate(stop)} icon={icon('navigate')} />
          <Button title={t('na_arrived_manual')} variant="ghost" onPress={() => props.onArrivedManually(stop)} />
          <Button title={t('issue_btn')} variant="secondary" onPress={() => props.onReportIssue(stop)} icon={icon('warning-outline')} />
        </Hero>
      );
    }

    case 'trip_done':
    case 'idle': {
      const done = action.kind === 'trip_done';
      return (
        <Hero
          tone={done ? 'success' : 'neutral'}
          icon={done ? ion('checkmark-circle') : (c) => <MaterialCommunityIcons name="truck-outline" size={size.icon.lg} color={c} />}
          title={done ? t('na2_done_title') : t('na2_idle_title')}
          lines={[action.upcoming.length === 0 ? (done ? t('na2_done_none') : t('na2_idle_desc')) : null]}
        >
          {action.upcoming.length > 0 ? <UpcomingList trips={action.upcoming} /> : null}
          {done && props.canFindReturnLoad ? <Button title={t('find_return_load_btn')} onPress={props.onFindReturnLoad} /> : null}
          {refresh}
        </Hero>
      );
    }
  }
}

/** The trips dispatch has sent that are waiting behind this one. */
export function UpcomingList({ trips }: { trips: UpcomingTrip[] }) {
  const { t } = useTranslation();
  return (
    <View style={styles.list}>
      <Text variant="bodyMedium">{t('na2_waiting_title')}</Text>
      {trips.map((trip) => (
        <View key={trip.id} style={styles.row}>
          <StatusPill tone="neutral" label={String(trip.stops)} />
          <Text variant="bodySmall" color="textMuted" style={styles.flex}>
            {trip.first_stop ? fill(t('na2_waiting_item'), { n: trip.stops, place: trip.first_stop }) : fill(t('na2_waiting_item_plain'), { n: trip.stops })}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  list: { gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
