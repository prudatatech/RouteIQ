import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api, type PayPayout, type PayTrip } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import { fill } from '../../locales';
import { Card, EmptyState, ErrorBanner, StatusPill, Text } from '../../components/ui';
import type { Tone } from '../../components/ui/StatusPill';
import { colors, size, space } from '../../theme';
import { formatDate, formatINR, formatNumber } from '../../utils/format';

/** How a trip's pay stands: waiting for approval, approved and to be paid, or paid on a date. */
function tripStatus(trip: PayTrip, t: (key: string) => string): { label: string; tone: Tone } {
  if (trip.rate_missing) return { label: t('pay_status_no_rate'), tone: 'neutral' };
  if (trip.status === 'paid') {
    return { label: trip.paid_at ? fill(t('pay_status_paid_on'), { date: formatDate(trip.paid_at) }) : t('paid'), tone: 'success' };
  }
  if (trip.status === 'approved') return { label: t('pay_status_approved'), tone: 'info' };
  return { label: t('pay_status_pending'), tone: 'warning' };
}

/** Real driver pay: a fixed amount per trip plus a rate per km. It is never the customer's invoice. */
export default function WalletTab() {
  const { t } = useTranslation();
  const pay = useQuery({
    queryKey: ['driver-pay'],
    queryFn: () => api.getDriverPay(),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (pay.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} accessibilityLabel={t('loading')} />
      </View>
    );
  }

  const data = pay.data;
  return (
    <View style={styles.container}>
      {pay.isError ? (
        <ErrorBanner message={t('pay_load_failed')} action={{ label: t('retry'), onPress: () => pay.refetch() }} />
      ) : null}

      {data ? (
        <>
          <Card style={styles.summary}>
            <Text variant="bodySmall" color="textMuted">
              {t('pay_total_earned')}
            </Text>
            <Text variant="display">{formatINR(data.totals.earned)}</Text>
            <View style={styles.divider} />
            <Row label={t('pay_pending_approval')} value={formatINR(data.totals.pending)} />
            <Row label={t('pay_approved_unpaid')} value={formatINR(data.totals.approved)} />
            <Row label={t('pay_paid_total')} value={formatINR(data.totals.paid)} strong />
          </Card>

          <View style={styles.periods}>
            <Period
              label={t('pay_this_trip')}
              value={data.this_trip ? formatINR(data.this_trip.amount) : '—'}
              note={data.this_trip ? tripStatus(data.this_trip, t).label : undefined}
            />
            <Period label={t('pay_this_week')} value={formatINR(data.this_week.total)} note={fill(t('pay_trips_n'), { n: formatNumber(data.this_week.trips) })} />
            <Period label={t('pay_this_month')} value={formatINR(data.this_month.total)} note={fill(t('pay_trips_n'), { n: formatNumber(data.this_month.trips) })} />
          </View>

          <Text variant="caption" color="textMuted" style={styles.how}>
            {t('pay_how')}
          </Text>

          <Text variant="title" accessibilityRole="header">
            {t('pay_trips_title')}
          </Text>
          {data.trips.length > 0 ? (
            <Card padded={false}>
              {data.trips.map((trip, idx) => (
                <TripLine key={trip.id} trip={trip} first={idx === 0} />
              ))}
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={<Ionicons name="wallet-outline" size={size.icon.xl} color={colors.textMuted} />}
                title={t('pay_empty_title')}
                message={t('pay_empty_desc')}
              />
            </Card>
          )}

          <Text variant="title" accessibilityRole="header">
            {t('pay_payouts_title')}
          </Text>
          {data.payouts.length > 0 ? (
            <Card padded={false}>
              {data.payouts.map((p, idx) => (
                <PayoutLine key={p.id} payout={p} first={idx === 0} />
              ))}
            </Card>
          ) : (
            <Card>
              <Text variant="bodySmall" color="textMuted">
                {t('pay_no_payouts')}
              </Text>
            </Card>
          )}
        </>
      ) : null}
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="bodySmall" color="textMuted" style={styles.flex}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyMedium' : 'bodySmall'}>{value}</Text>
    </View>
  );
}

function Period({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card style={styles.period}>
      <Text variant="caption" color="textMuted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="title">{value}</Text>
      {note ? (
        <Text variant="caption" color="textMuted" numberOfLines={2}>
          {note}
        </Text>
      ) : null}
    </Card>
  );
}

function TripLine({ trip, first }: { trip: PayTrip; first: boolean }) {
  const { t } = useTranslation();
  const status = tripStatus(trip, t);
  const source = trip.km_source === 'none' ? null : t(`pay_source_${trip.km_source}`);
  const detail = [fill(t('pay_km'), { km: formatNumber(trip.km, { maximumFractionDigits: 1 }) }), source].filter(Boolean).join(' · ');
  return (
    <View
      style={[styles.line, !first && styles.lineBorder]}
      accessible
      accessibilityLabel={`${formatDate(trip.date)}, ${trip.trip_ref}, ${formatINR(trip.amount)}, ${status.label}`}
    >
      <View style={styles.flex}>
        <Text variant="caption" color="textMuted">
          {`${formatDate(trip.date)} · ${trip.trip_ref}`}
        </Text>
        {trip.km_source !== 'none' ? <Text variant="bodySmall">{detail}</Text> : null}
        {!trip.rate_missing ? (
          <Text variant="caption" color="textMuted">
            {fill(t('pay_breakdown'), { trip: formatINR(trip.per_trip_amount), perKm: formatINR(trip.per_km_amount) })}
          </Text>
        ) : null}
        {trip.adjustment_total !== 0 ? (
          <Text variant="caption" color="textMuted">
            {fill(t('pay_adjusted'), { amount: formatINR(trip.adjustment_total) })}
          </Text>
        ) : null}
      </View>
      <View style={styles.amount}>
        <Text variant="bodyMedium">{formatINR(trip.amount)}</Text>
        <StatusPill tone={status.tone} label={status.label} />
      </View>
    </View>
  );
}

function PayoutLine({ payout, first }: { payout: PayPayout; first: boolean }) {
  const { t } = useTranslation();
  const method = t(`pay_method_${payout.method}`);
  return (
    <View
      style={[styles.line, !first && styles.lineBorder]}
      accessible
      accessibilityLabel={`${formatDate(payout.paid_at)}, ${formatINR(payout.amount)}, ${method}`}
    >
      <View style={styles.flex}>
        <Text variant="caption" color="textMuted">
          {formatDate(payout.paid_at)}
        </Text>
        <Text variant="bodySmall">{method}</Text>
        {payout.reference ? (
          <Text variant="caption" color="textMuted">
            {fill(t('pay_reference'), { ref: payout.reference })}
          </Text>
        ) : null}
      </View>
      <Text variant="bodyMedium" color="success">
        {formatINR(payout.amount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[4] },
  loading: { paddingVertical: space[16], alignItems: 'center' },
  summary: { gap: space[1] },
  divider: { height: size.border, backgroundColor: colors.border, marginVertical: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[1] },
  periods: { flexDirection: 'row', gap: space[2] },
  period: { flex: 1, gap: space[1] },
  how: { paddingHorizontal: space[1] },
  flex: { flex: 1, gap: 2 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: size.control + space[4],
  },
  lineBorder: { borderTopWidth: size.border, borderTopColor: colors.border },
  amount: { alignItems: 'flex-end', gap: space[1] },
});
