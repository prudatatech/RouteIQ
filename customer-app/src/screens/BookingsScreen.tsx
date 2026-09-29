import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Card, EmptyState, ErrorBanner, ScreenHeader, StatusPill, Text } from '../components/ui';
import { colors, fontFamily, size, space } from '../theme';
import { api, type Booking } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { bookingStatusInfo } from '../utils/bookingStatus';
import { formatDay, formatINR } from '../utils/format';
import { useTranslation, type TranslateFn } from '../hooks/useTranslation';

const placeName = (address: string) => address.split(',')[0].trim() || address;


/** The customer's bookings, newest first. */
export default function BookingsScreen({ navigation }: any) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useRemote(() => api.listBookings(), 'bookings', t('bookings_load_failed'));

  // Statuses change while the customer is away, so refresh whenever this tab is shown.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

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
        ListHeaderComponent={error ? <ErrorBanner message={error} action={{ label: t('try_again'), onPress: reload }} /> : null}
        renderItem={({ item }) => <BookingRow t={t} booking={item} onPress={() => navigation.navigate('BookingDetail', { id: item.id })} />}
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

function BookingRow({ booking, onPress, t }: { booking: Booking; onPress: () => void; t: TranslateFn }) {
  const status = bookingStatusInfo(booking);
  const statusLabel = t(status.label);
  const route = t('route_a_to_b', { from: placeName(booking.pickup_name), to: placeName(booking.drop_name) });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${route}, ${statusLabel}, ${t('pickup_on', { date: formatDay(booking.pickup_date) })}`}
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
        <View style={styles.meta}>
          <Text variant="bodySmall" color="textMuted">
            {booking.quoted_price != null ? formatINR(booking.quoted_price, { maximumFractionDigits: 0, minimumFractionDigits: 0 }) : t('price_tbc')}
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
  card: { gap: space[2], alignItems: 'flex-start' },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  mono: { fontFamily: fontFamily.mono },
  pressed: { opacity: 0.8 },
});
