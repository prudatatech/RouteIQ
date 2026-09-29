import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Banner, Button, Card, ErrorBanner, ScreenHeader, StatusPill, Text } from '../components/ui';
import { TrackingMap } from '../components/TrackingMap';
import { colors, fontFamily, radius, size, space } from '../theme';
import { api, type BookingDetail } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { BOOKING_STEPS, bookingStatusInfo, canCancel, deliveryFailed, formatMinutes } from '../utils/bookingStatus';
import { formatDateTime, formatDay, formatINR, formatNumber } from '../utils/format';
import { useTranslation } from '../hooks/useTranslation';

/** How often live tracking refreshes while the shipment is moving. */
const LIVE_REFRESH_MS = 30_000;

/** When each step happened, from the booking and the shipment's history. */
function stepTimes(detail: BookingDetail): Partial<Record<string, string>> {
  const at = (...statuses: string[]) => detail.tracking?.history.find((h) => statuses.includes(h.status))?.at;
  return {
    requested: detail.booking.created_at,
    confirmed: at('created'),
    assigned: at('assigned'),
    in_transit: at('picked_up', 'in_transit'),
    delivered: at('delivered'),
  };
}

export default function BookingDetailScreen({ navigation, route }: any) {
  const { t } = useTranslation();
  const id: string = route.params.id;
  const { data, loading, error, reload } = useRemote(() => api.getBooking(id), id, t('booking_load_failed'));

  const status = data?.booking.status;
  const live = !!data?.tracking && (status === 'assigned' || status === 'in_transit' || data.booking.shipment_status === 'exception');
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(reload, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, reload]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('booking_title')} onBack={() => navigation.goBack()} backLabel={t('back')} />
      {!data ? (
        <View style={styles.center}>
          {loading ? <ActivityIndicator color={colors.accent} /> : <ErrorBanner message={error ?? t('booking_load_failed_short')} action={{ label: t('try_again'), onPress: reload }} />}
        </View>
      ) : (
        <Details detail={data} error={error} reload={reload} loading={loading} />
      )}
    </SafeAreaView>
  );
}

function Details({ detail, error, reload, loading }: { detail: BookingDetail; error?: string; reload: () => void; loading: boolean }) {
  const { t } = useTranslation();
  const { booking, tracking } = detail;
  const status = bookingStatusInfo(booking);
  const times = stepTimes(detail);
  const cancelled = booking.status === 'cancelled';
  const reached = BOOKING_STEPS.findIndex((s) => s.status === booking.status);
  const vehicle = tracking?.vehicle;
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Only a pull down shows the spinner, not the quiet refresh that runs while a shipment is moving.
  const [pulling, setPulling] = useState(false);
  const pull = () => {
    setPulling(true);
    reload();
  };
  const [wasLoading, setWasLoading] = useState(loading);
  if (wasLoading !== loading) {
    setWasLoading(loading);
    if (!loading) setPulling(false);
  }

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await api.cancelBooking(booking.id);
      reload();
    } catch (e: any) {
      setCancelError(e?.message || t('cancel_failed'));
      // The booking may have been picked up in the meantime, so show its current state.
      reload();
    } finally {
      setCancelling(false);
    }
  };

  const askCancel = () =>
    Alert.alert(
      t('cancel_confirm_title'),
      t('cancel_confirm_body'),
      [
        { text: t('cancel_keep'), style: 'cancel' },
        { text: t('cancel_booking'), style: 'destructive', onPress: cancel },
      ],
    );
  const vehiclePoint = vehicle?.lat != null && vehicle?.lng != null ? { latitude: vehicle.lat, longitude: vehicle.lng } : null;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={colors.accent} />}
    >
      {error ? <ErrorBanner message={error} action={{ label: t('try_again'), onPress: reload }} /> : null}

      <Card style={styles.card}>
        <StatusPill label={t(status.label)} tone={status.tone} />
        <View style={styles.place}>
          <Text variant="caption" color="textMuted">
            {t('pickup')}
          </Text>
          <Text variant="bodyMedium">{booking.pickup_address}</Text>
        </View>
        <View style={styles.place}>
          <Text variant="caption" color="textMuted">
            {t('dropoff')}
          </Text>
          <Text variant="bodyMedium">{booking.drop_address}</Text>
        </View>
        <View style={styles.facts}>
          <Fact label={t('fact_pickup_date')} value={formatDay(booking.pickup_date)} />
          <Fact label={t('fact_weight')} value={`${formatNumber(Number(booking.weight_kg))} kg`} />
          <Fact label={t('fact_load')} value={booking.load_type === 'part' ? t('load_part') : t('load_full')} />
          <Fact
            label={t('fact_price')}
            value={booking.quoted_price != null ? formatINR(booking.quoted_price, { maximumFractionDigits: 0, minimumFractionDigits: 0 }) : t('fact_price_tbc')}
          />
          {booking.tracking_id ? <Fact label={t('fact_tracking')} value={booking.tracking_id} mono /> : null}
        </View>
      </Card>

      {deliveryFailed(booking) ? <Banner tone="warning" icon="alert-triangle" message={t('delivery_failed_note')} /> : null}

      {cancelled ? (
        <Banner tone="warning" icon="x-circle" message={booking.cancel_reason ? t('cancelled_reason', { reason: booking.cancel_reason }) : t('cancelled')} />
      ) : (
        <Card style={styles.card}>
          <Text variant="title" accessibilityRole="header">
            {t('progress')}
          </Text>
          {BOOKING_STEPS.map((step, index) => {
            const done = index <= reached;
            const time = times[step.status];
            return (
              <View key={step.status} style={styles.step} accessible accessibilityLabel={`${t(step.label)}${done ? ', ' + t('step_done') : ', ' + t('step_not_yet')}${time ? `, ${formatDateTime(time)}` : ''}`}>
                <View style={[styles.stepDot, done && styles.stepDotDone]}>
                  {done ? <Feather name="check" size={size.icon.sm} color={colors.onAccentFill} /> : null}
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyMedium" color={done ? 'text' : 'textMuted'}>
                    {t(step.label)}
                  </Text>
                  {time && done ? (
                    <Text variant="caption" color="textMuted">
                      {formatDateTime(time)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
      )}

      {tracking && !cancelled && booking.status !== 'delivered' ? (
        <View style={styles.live}>
          <Text variant="title" accessibilityRole="header">
            {t('live_tracking')}
          </Text>
          <TrackingMap
            pickup={{ latitude: booking.pickup_lat, longitude: booking.pickup_lng }}
            drop={{ latitude: booking.drop_lat, longitude: booking.drop_lng }}
            vehicle={vehiclePoint}
            vehicleLabel={vehicle?.plate_number ?? undefined}
          />
          {vehicle ? (
            <Text variant="bodySmall" color="textMuted">
              {vehicle.plate_number ? `${t('vehicle')} ${vehicle.plate_number}. ` : ''}
              {vehiclePoint
                ? tracking.eta_minutes != null
                  ? t('eta_text', { time: formatMinutes(tracking.eta_minutes, t) })
                  : t('position_shown')
                : t('position_unavailable')}
            </Text>
          ) : (
            <Text variant="bodySmall" color="textMuted">
              {t('no_vehicle_yet')}
            </Text>
          )}
        </View>
      ) : null}

      {canCancel(booking.status) ? (
        <View style={styles.live}>
          {cancelError ? <ErrorBanner message={cancelError} /> : null}
          <Button
            title={t('cancel_booking')}
            variant="danger"
            loading={cancelling}
            accessibilityHint={t('cancel_hint')}
            onPress={askCancel}
          />
          <Text variant="caption" color="textMuted" align="center">
            {t('cancel_until')}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.fact}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="bodySmallMedium" style={mono ? styles.mono : null}>
        {value}
      </Text>
    </View>
  );
}

const DOT = 24;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', padding: space[4] },
  content: { padding: space[4], gap: space[4], paddingBottom: space[8] },
  flex: { flex: 1 },
  card: { gap: space[3], alignItems: 'flex-start' },
  place: { gap: space[1], alignSelf: 'stretch' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4], alignSelf: 'stretch' },
  fact: { gap: space[1] },
  mono: { fontFamily: fontFamily.mono },
  step: { flexDirection: 'row', alignItems: 'center', gap: space[3], alignSelf: 'stretch' },
  stepDot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  live: { gap: space[2] },
});
