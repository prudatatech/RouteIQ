import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Banner, Card, EmptyState, ErrorBanner, ScreenHeader, StatusPill, TONES, Text } from '../components/ui';
import { colors, fontFamily, radius, size, space } from '../theme';
import { api, type Booking, type Invoice } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { bookingStatusInfo } from '../utils/bookingStatus';
import { formatDay, formatINR } from '../utils/format';
import { useTranslation, type TranslateFn } from '../hooks/useTranslation';
import { awaitsRating, needsLiveDetail, nextStep, type NextStep, type NextStepInput } from '../utils/nextStep';
import { nextStepText } from '../utils/nextStepText';
import { unpaidInvoiceFor } from '../utils/invoices';

/** At most this many moving bookings look up their live ETA and problem notice (a few at a time is the norm). */
const LIVE_LOOKUPS = 8;

/** What the list itself does not carry, for the bookings that are on the way: the live ETA and any open problem. */
type Live = Pick<NextStepInput, 'etaMinutes' | 'problem'>;


const placeName = (address: string) => address.split(',')[0].trim() || address;


/** The customer's bookings, newest first. */
export default function BookingsScreen({ navigation }: any) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useRemote(() => api.listBookings(), 'bookings', t('bookings_load_failed'));

  // Invoices and live details only improve the row: the list still shows without them.
  const invoices = useRemote(() => api.listInvoices().catch(() => [] as Invoice[]), 'bookings-invoices');
  const moving = (data ?? []).filter(needsLiveDetail).slice(0, LIVE_LOOKUPS);
  const liveKey = moving.map((b) => `${b.id}:${b.shipment_status}`).join(',');
  const live = useRemote(
    async () => {
      const entries = await Promise.all(
        moving.map(async (b): Promise<[string, Live]> => {
          const [detail, cargo] = await Promise.all([api.getBooking(b.id).catch(() => null), api.getBookingCargo(b.id).catch(() => null)]);
          const notice = cargo?.exceptions[0];
          return [b.id, { etaMinutes: detail?.tracking?.eta_minutes ?? null, problem: notice ? { message: notice.message, revisedEta: notice.revised_eta } : null }];
        }),
      );
      return Object.fromEntries(entries) as Record<string, Live>;
    },
    `live:${liveKey}`,
  );
  const { reload: reloadInvoices } = invoices;
  const { reload: reloadLive } = live;

  // Statuses change while the customer is away, so refresh whenever this tab is shown.
  useFocusEffect(
    useCallback(() => {
      reload();
      reloadInvoices();
      reloadLive();
    }, [reload, reloadInvoices, reloadLive]),
  );

  const steps = new Map<string, NextStep | null>();
  for (const b of data ?? []) {
    steps.set(b.id, nextStep({ booking: b, ...live.data?.[b.id], unpaidInvoice: invoices.data ? unpaidInvoiceFor(invoices.data, b.id) : null }));
  }
  const toRate = (data ?? []).filter(awaitsRating);

  const body = () => {
    if (!data && loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }
    if (error && !data) {
      return (
        <View style={styles.errorWrap}>
          <ErrorBanner message={error} action={{ label: t('try_again'), onPress: reload }} />
        </View>
      );
    }
    if (!data || data.length === 0) {
      return (
        <View style={styles.center}>
          <EmptyState
            icon={<Feather name="package" size={size.icon.xl} color={colors.accent} />}
            title={t('bookings_empty_title')}
            message={t('bookings_empty_msg')}
            action={{ label: t('plan_shipment'), onPress: () => navigation.navigate('Home') }}
          />
        </View>
      );
    }
    return (
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}
        ListHeaderComponent={
          error || toRate.length > 0 ? (
            <View style={styles.header}>
              {error ? <ErrorBanner message={error} action={{ label: t('try_again'), onPress: reload }} /> : null}
              {toRate.length > 0 ? (
                <Banner
                  tone="info"
                  icon="star"
                  message={toRate.length === 1 ? t('rate_banner') : t('rate_banner_many', { n: toRate.length })}
                  action={{ label: t('rate_banner_action'), onPress: () => navigation.navigate('BookingDetail', { id: toRate[0].id }) }}
                />
              ) : null}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <BookingRow t={t} booking={item} step={steps.get(item.id) ?? null} onPress={() => navigation.navigate('BookingDetail', { id: item.id })} />
        )}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('my_bookings')} />
      {body()}
    </SafeAreaView>
  );
}

function BookingRow({ booking, step, onPress, t }: { booking: Booking; step: NextStep | null; onPress: () => void; t: TranslateFn }) {
  const status = bookingStatusInfo(booking);
  const statusLabel = t(status.label);
  const route = t('route_a_to_b', { from: placeName(booking.pickup_name), to: placeName(booking.drop_name) });
  const next = step ? nextStepText(step, t) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${route}, ${statusLabel}, ${t('pickup_on', { date: formatDay(booking.pickup_date) })}${next ? `, ${next}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      <Card style={styles.card}>
        <StatusPill label={statusLabel} tone={status.tone} />
        <Text variant="bodyMedium" numberOfLines={2}>
          {route}
        </Text>
        <Text variant="bodySmall" color="textMuted">
          {t('pickup_on', { date: formatDay(booking.pickup_date) })}
        </Text>
        {step && next ? (
          <View style={[styles.next, { backgroundColor: TONES[step.tone].bg }]}>
            <Text variant="bodySmallMedium" style={{ color: TONES[step.tone].fg }}>
              {next}
            </Text>
          </View>
        ) : null}
        <View style={styles.meta}>
          <Text variant="bodySmall" color="textMuted">
            {booking.quoted_price != null ? formatINR(booking.quoted_price) : t('price_tbc')}
          </Text>
          {booking.tracking_id ? (
            <Text variant="caption" color="textMuted" style={styles.mono}>
              {booking.tracking_id}
            </Text>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center' },
  errorWrap: { padding: space[4] },
  list: { padding: space[4], gap: space[3] },
  header: { gap: space[3] },
  next: { alignSelf: 'stretch', paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.control },
  card: { gap: space[2], alignItems: 'flex-start' },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  mono: { fontFamily: fontFamily.mono },
  pressed: { opacity: 0.8 },
});
