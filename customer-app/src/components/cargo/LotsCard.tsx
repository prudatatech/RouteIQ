import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button, Card, ErrorBanner, StatusPill, Text } from '../ui';
import { colors, fontFamily, radius, size, space } from '../../theme';
import { api, type CargoLot, type Claim, type LotTotals, type ProofOfDelivery } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import { lotStatusInfo } from '../../utils/bookingStatus';
import { claimClosesAt, claimWindowOpen, piecesText } from '../../utils/cargo';
import { formatDateTime, formatNumber } from '../../utils/format';
import { DeliveryOtpCard } from './DeliveryOtpCard';
import { ProofOfDeliveryCard } from './ProofOfDeliveryCard';
import { ClaimsCard } from './ClaimsCard';

/** A lot whose goods have reached a final state a claim can be about. */
const CLAIMABLE = new Set(['delivered', 'partially_delivered', 'lost', 'returned']);

interface Props {
  bookingId: string;
  lots: CargoLot[];
  totals: LotTotals | null;
  claims: Claim[];
  refreshKey: number;
  onOpenNotifications: () => void;
  onRaiseClaim: (lot: CargoLot) => void;
}

/**
 * A booking split into lots (several drops, part of the goods on another truck, or a hub split):
 * the progress of all lots together, then each lot with its pieces, consignee, drop and status in
 * plain words, its own delivery code, proof of delivery and claims.
 */
export function LotsCard({ bookingId, lots, totals, claims, refreshKey, onOpenNotifications, onRaiseClaim }: Props) {
  const { t } = useTranslation();
  const [now] = useState(() => Date.now());
  const share = totals && totals.pieces > 0 ? Math.min(1, totals.delivered / totals.pieces) : 0;

  return (
    <Card style={styles.card}>
      <Text variant="title" accessibilityRole="header">
        {t('lots_title')}
      </Text>
      <Text variant="bodySmall" color="textMuted">
        {t('lots_intro', { n: lots.length })}
      </Text>

      {totals ? (
        <View style={styles.progress} accessible accessibilityLabel={t('lots_progress', { n: formatNumber(totals.delivered), total: formatNumber(totals.pieces) })}>
          <Text variant="bodyMedium">{t('lots_progress', { n: formatNumber(totals.delivered), total: formatNumber(totals.pieces) })}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
          </View>
          <Text variant="caption" color="textMuted">
            {t('lots_progress_lots', { n: totals.lots_delivered, total: totals.lots })}
          </Text>
        </View>
      ) : null}

      {lots.map((lot) => (
        <LotRow
          key={lot.code}
          bookingId={bookingId}
          lot={lot}
          claims={claims.filter((c) => (c.consignment_code && c.consignment_code === lot.code) || (!!lot.shipment_id && c.shipment_id === lot.shipment_id))}
          now={now}
          refreshKey={refreshKey}
          onOpenNotifications={onOpenNotifications}
          onRaiseClaim={() => onRaiseClaim(lot)}
        />
      ))}
    </Card>
  );
}

function LotRow({
  bookingId,
  lot,
  claims,
  now,
  refreshKey,
  onOpenNotifications,
  onRaiseClaim,
}: {
  bookingId: string;
  lot: CargoLot;
  claims: Claim[];
  now: number;
  refreshKey: number;
  onOpenNotifications: () => void;
  onRaiseClaim: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const status = lotStatusInfo(lot.status);
  const label = lot.label ? t('lot_label', { label: lot.label }) : lot.code;
  const drop = [lot.drop_name, lot.drop_address].filter(Boolean).join(', ');
  const consignee = [lot.consignee_name, lot.consignee_phone].filter(Boolean).join(' · ');
  const claimable = !!lot.status && CLAIMABLE.has(lot.status);
  const windowOpen = claimable ? (claimWindowOpen(lot.delivered_at, now) ?? true) : null;

  return (
    <View style={styles.lot}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={[label, t(status.label), lot.pieces != null ? piecesText(lot.pieces, t) : null, consignee || null].filter(Boolean).join(', ')}
        accessibilityHint={t('lot_open_hint')}
        style={({ pressed }) => [styles.lotHead, pressed && styles.pressed]}
      >
        <View style={styles.flex}>
          <View style={styles.row}>
            <Text variant="bodyMedium">{label}</Text>
            {lot.pieces != null ? (
              <Text variant="bodySmall" color="textMuted">
                {piecesText(lot.pieces, t)}
              </Text>
            ) : null}
          </View>
          <Text variant="caption" color="textMuted" style={styles.mono}>
            {lot.code}
          </Text>
        </View>
        <StatusPill label={t(status.label)} tone={status.tone} />
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={size.icon.md} color={colors.textMuted} />
      </Pressable>

      {consignee ? <Line label={t('lot_consignee')} value={consignee} /> : null}
      {drop ? <Line label={t('lot_drop')} value={drop} /> : null}
      {lot.summary ? <Text variant="bodySmall">{lot.summary}</Text> : null}

      {open ? (
        <View style={styles.details}>
          {lot.status === 'out_for_delivery' ? (
            <DeliveryOtpCard
              bookingId={bookingId}
              trackingId={lot.code}
              shipmentId={lot.shipment_id}
              sentAt={null}
              refreshKey={refreshKey}
              onOpenNotifications={onOpenNotifications}
              lotLabel={lot.label ?? lot.code}
            />
          ) : null}
          {lot.status === 'delivered' || lot.status === 'partially_delivered' ? <LotProof lot={lot} /> : null}
          <ClaimsCard
            claims={claims}
            windowOpen={windowOpen}
            closesAt={windowOpen ? claimClosesAt(lot.delivered_at) : null}
            canRaise={!!lot.shipment_id}
            onRaise={onRaiseClaim}
            onRetry={() => {}}
          />
          {!claimable && claims.length === 0 ? (
            <Text variant="caption" color="textMuted">
              {t('lot_claim_after_delivery')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="bodySmall">{value}</Text>
    </View>
  );
}

/**
 * The lot's own proof of delivery: from the cargo view when it carries one, otherwise read from the
 * lot's timeline (its last delivery event) when the customer asks for it.
 */
function LotProof({ lot }: { lot: CargoLot }) {
  const { t } = useTranslation();
  const [pod, setPod] = useState<ProofOfDelivery | null>(lot.pod);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [none, setNone] = useState(false);
  const title = lot.label ? t('lot_pod_title', { label: lot.label }) : t('pod_title');

  if (pod) return <ProofOfDeliveryCard pod={pod} title={title} />;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const events = await api.getCargoTimeline(lot.code);
      const delivery = [...events].reverse().find((e) => e.kind === 'delivery' || e.kind === 'partial_delivery');
      if (!delivery) {
        setNone(true);
        return;
      }
      setPod({
        photo_url: delivery.photo_urls[0] ?? null,
        signature_url: delivery.signature_url,
        receiver_name: delivery.receiver_name,
        delivered_at: delivery.recorded_at,
      });
    } catch (e: any) {
      setError(e?.message || t('lot_pod_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.details}>
      {error ? <ErrorBanner message={error} action={{ label: t('try_again'), onPress: load }} /> : null}
      {none ? (
        <Text variant="bodySmall" color="textMuted">
          {t('lot_pod_none')}
        </Text>
      ) : loading ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Button
          title={t('lot_pod_show')}
          variant="secondary"
          icon={(color) => <Feather name="image" size={size.icon.md} color={color} />}
          onPress={load}
        />
      )}
      {lot.delivered_at ? (
        <Text variant="caption" color="textMuted">
          {t('pod_delivered_at')}: {formatDateTime(lot.delivered_at)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  progress: { gap: space[2] },
  track: { height: 8, borderRadius: radius.full, backgroundColor: colors.surfaceSubtle, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.success },
  lot: { gap: space[2], paddingTop: space[3], borderTopWidth: size.border, borderTopColor: colors.border },
  lotHead: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: size.control },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], flexWrap: 'wrap' },
  flex: { flex: 1 },
  line: { gap: space[1] },
  details: { gap: space[3] },
  mono: { fontFamily: fontFamily.mono },
  pressed: { opacity: 0.8 },
});
