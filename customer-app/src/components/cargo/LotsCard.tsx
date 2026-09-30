import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Card, StatusPill, Text } from '../ui';
import { colors, fontFamily, radius, size, space } from '../../theme';
import type { CargoLot, Claim, LotTotals, ProofOfDelivery } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import { lotStatusInfo } from '../../utils/bookingStatus';
import { claimClosesAt, claimWindowOpen, piecesText } from '../../utils/cargo';
import { formatNumber } from '../../utils/format';
import { DeliveryOtpCard } from './DeliveryOtpCard';
import { ProofOfDeliveryCard } from './ProofOfDeliveryCard';
import { ClaimsCard } from './ClaimsCard';

/** Lot statuses the server takes a customer's claim on (its CUSTOMER_CLAIMABLE). */
const CLAIMABLE = new Set(['delivered', 'partially_delivered', 'lost', 'returned']);

interface Props {
  bookingId: string;
  lots: CargoLot[];
  /** The master's `where.totals`. */
  totals: LotTotals | null;
  /** Claims listed by each lot's tracking ID (the cargo view's `claims` are the booking's own). */
  claims: Claim[];
  refreshKey: number;
  onOpenNotifications: () => void;
  onRaiseClaim: (lot: CargoLot) => void;
}

/** A claim on this lot: it names the lot's shipment, and the list gives the lot's tracking ID. */
export const isLotClaim = (claim: Claim, lot: CargoLot) =>
  (!!lot.shipment_id && claim.shipment_id === lot.shipment_id) || claim.consignment_code === lot.code;

/**
 * A booking split into lots (several drops, part of the goods on another truck, or a hub split):
 * the progress of all lots together, then each lot with its pieces and the server's plain line
 * about it, its own delivery code, proof of delivery and claims.
 */
export function LotsCard({ bookingId, lots, totals, claims, refreshKey, onOpenNotifications, onRaiseClaim }: Props) {
  const { t } = useTranslation();
  const [now] = useState(() => Date.now());
  const total = totals?.pieces_total ?? null;
  const share = totals && total ? Math.min(1, totals.delivered / total) : 0;
  const lotsDelivered = lots.filter((l) => l.status === 'delivered').length;

  return (
    <Card style={styles.card}>
      <Text variant="title" accessibilityRole="header">
        {t('lots_title')}
      </Text>
      <Text variant="bodySmall" color="textMuted">
        {t('lots_intro', { n: lots.length })}
      </Text>

      {totals && total ? (
        <View style={styles.progress} accessible accessibilityLabel={t('lots_progress', { n: formatNumber(totals.delivered), total: formatNumber(total) })}>
          <Text variant="bodyMedium">{t('lots_progress', { n: formatNumber(totals.delivered), total: formatNumber(total) })}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
          </View>
          {/* The server's line says where the rest is: "25 at Patna hub · 15 on HR55AB1234" */}
          {totals.progress_text ? (
            <Text variant="bodySmall" color="textMuted">
              {totals.progress_text}
            </Text>
          ) : null}
          <Text variant="caption" color="textMuted">
            {t('lots_progress_lots', { n: lotsDelivered, total: lots.length })}
          </Text>
        </View>
      ) : null}

      {lots.map((lot) => (
        <LotRow
          key={lot.code}
          bookingId={bookingId}
          lot={lot}
          claims={claims.filter((c) => isLotClaim(c, lot))}
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
  const pieces = lot.pieces.total;
  const drop = [lot.drop?.name, lot.drop?.address].filter(Boolean).join(', ');
  const claimable = !!lot.status && CLAIMABLE.has(lot.status);
  const windowOpen = claimable ? (claimWindowOpen(lot.delivered_at, now) ?? true) : null;

  return (
    <View style={styles.lot}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={[label, t(status.label), pieces != null ? piecesText(pieces, t) : null, lot.consignee_name].filter(Boolean).join(', ')}
        accessibilityHint={t('lot_open_hint')}
        style={({ pressed }) => [styles.lotHead, pressed && styles.pressed]}
      >
        <View style={styles.flex}>
          <View style={styles.row}>
            <Text variant="bodyMedium">{label}</Text>
            {pieces != null ? (
              <Text variant="bodySmall" color="textMuted">
                {piecesText(pieces, t)}
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

      {/* The server's line already names the consignee and the drop; without it they are listed as they are. */}
      {lot.text ? (
        <Text variant="bodySmall">{lot.text}</Text>
      ) : (
        <>
          {lot.consignee_name ? <Line label={t('lot_consignee')} value={lot.consignee_name} /> : null}
          {drop ? <Line label={t('lot_drop')} value={drop} /> : null}
        </>
      )}

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

/** The lot's own proof of delivery, else the photo and signature of its delivery on the timeline. */
function LotProof({ lot }: { lot: CargoLot }) {
  const { t } = useTranslation();
  const title = lot.label ? t('lot_pod_title', { label: lot.label }) : t('pod_title');
  const e = lot.delivery;
  const pod: ProofOfDelivery | null =
    lot.pod ?? (e ? { photo_url: e.photo_urls[0] ?? null, signature_url: e.signature_url, receiver_name: e.receiver_name, delivered_at: e.recorded_at } : null);
  if (pod) return <ProofOfDeliveryCard pod={pod} title={title} />;
  return (
    <Text variant="bodySmall" color="textMuted">
      {t('lot_pod_none')}
    </Text>
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
