import React, { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Banner, Card, ErrorBanner, ScreenHeader, StatusPill, Text } from '../components/ui';
import { TrackingMap } from '../components/TrackingMap';
import { colors, fontFamily, radius, size, space } from '../theme';
import { api, type BookingDetail } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { BOOKING_STATUS, BOOKING_STEPS, formatMinutes } from '../utils/bookingStatus';
import { formatDateTime, formatDay, formatINR, formatNumber } from '../utils/format';

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
  const id: string = route.params.id;
  const { data, loading, error, reload } = useRemote(() => api.getBooking(id), id, 'Could not load this booking. Check your internet connection and try again.');

  const status = data?.booking.status;
  const live = !!data?.tracking && (status === 'assigned' || status === 'in_transit');
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(reload, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, reload]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Booking" onBack={() => navigation.goBack()} backLabel="Back" />
      {!data ? (
        <View style={styles.center}>
          {loading ? <ActivityIndicator color={colors.accent} /> : <ErrorBanner message={error ?? 'Could not load this booking.'} action={{ label: 'Try again', onPress: reload }} />}
        </View>
      ) : (
        <Details detail={data} error={error} reload={reload} />
      )}
    </SafeAreaView>
  );
}

function Details({ detail, error, reload }: { detail: BookingDetail; error?: string; reload: () => void }) {
  const { booking, tracking } = detail;
  const status = BOOKING_STATUS[booking.status];
  const times = stepTimes(detail);
  const cancelled = booking.status === 'cancelled';
  const reached = BOOKING_STEPS.findIndex((s) => s.status === booking.status);
  const vehicle = tracking?.vehicle;
  const vehiclePoint = vehicle?.lat != null && vehicle?.lng != null ? { latitude: vehicle.lat, longitude: vehicle.lng } : null;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {error ? <ErrorBanner message={error} action={{ label: 'Try again', onPress: reload }} /> : null}

      <Card style={styles.card}>
        <StatusPill label={status.label} tone={status.tone} />
        <View style={styles.place}>
          <Text variant="caption" color="textMuted">
            Pickup
          </Text>
          <Text variant="bodyMedium">{booking.pickup_address}</Text>
        </View>
        <View style={styles.place}>
          <Text variant="caption" color="textMuted">
            Drop-off
          </Text>
          <Text variant="bodyMedium">{booking.drop_address}</Text>
        </View>
        <View style={styles.facts}>
          <Fact label="Pickup date" value={formatDay(booking.pickup_date)} />
          <Fact label="Weight" value={`${formatNumber(Number(booking.weight_kg))} kg`} />
          <Fact label="Load" value={booking.load_type === 'part' ? 'Part load' : 'Full truck'} />
          <Fact
            label="Price"
            value={booking.quoted_price != null ? formatINR(booking.quoted_price, { maximumFractionDigits: 0, minimumFractionDigits: 0 }) : 'To be confirmed'}
          />
          {booking.tracking_id ? <Fact label="Tracking ID" value={booking.tracking_id} mono /> : null}
        </View>
      </Card>

      {cancelled ? (
        <Banner tone="warning" icon="x-circle" message={booking.cancel_reason ? `This booking was cancelled: ${booking.cancel_reason}` : 'This booking was cancelled.'} />
      ) : (
        <Card style={styles.card}>
          <Text variant="title" accessibilityRole="header">
            Progress
          </Text>
          {BOOKING_STEPS.map((step, index) => {
            const done = index <= reached;
            const time = times[step.status];
            return (
              <View key={step.status} style={styles.step} accessible accessibilityLabel={`${step.label}${done ? ', done' : ', not yet'}${time ? `, ${formatDateTime(time)}` : ''}`}>
                <View style={[styles.stepDot, done && styles.stepDotDone]}>
                  {done ? <Feather name="check" size={size.icon.sm} color={colors.onAccentFill} /> : null}
                </View>
                <View style={styles.flex}>
                  <Text variant="bodyMedium" color={done ? 'text' : 'textMuted'}>
                    {step.label}
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
            Live tracking
          </Text>
          <TrackingMap
            pickup={{ latitude: booking.pickup_lat, longitude: booking.pickup_lng }}
            drop={{ latitude: booking.drop_lat, longitude: booking.drop_lng }}
            vehicle={vehiclePoint}
            vehicleLabel={vehicle?.plate_number ?? undefined}
          />
          {vehicle ? (
            <Text variant="bodySmall" color="textMuted">
              {vehicle.plate_number ? `Vehicle ${vehicle.plate_number}. ` : ''}
              {vehiclePoint
                ? tracking.eta_minutes != null
                  ? `Estimated arrival in about ${formatMinutes(tracking.eta_minutes)}, worked out from its position now.`
                  : 'Its position is shown on the map.'
                : 'Its position is not available right now.'}
            </Text>
          ) : (
            <Text variant="bodySmall" color="textMuted">
              A vehicle has not been assigned yet. Its position will show here once it is.
            </Text>
          )}
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
