import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, DeviceEventEmitter, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Card, EmptyState, ErrorBanner, ScreenHeader, StatusPill, Text } from '../components/ui';
import { colors, radius, size, space } from '../theme';
import { api, BOOKING_CREATED_EVENT, type BookingDrop, type Quote } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { dayKey, formatDay, formatINR, formatNumber } from '../utils/format';
import { useTranslation, type TranslateFn } from '../hooks/useTranslation';
import { hasTranslation } from '../locales';

/** How far ahead a pickup can be planned from the date list. */
const DAYS_AHEAD = 60;

type DayChoice = 'today' | 'tomorrow' | 'other';

export default function QuoteScreen({ navigation, route }: any) {
  const { t } = useTranslation();
  const { pickupLocation, dropoffLocation, pickupCoord, dropoffCoord, loadType, weightKg, vehicleType } = route.params || {};
  // Several drops (each becomes a lot); the route ends at the last one. None for a single drop.
  const drops: BookingDrop[] | undefined = route.params?.drops?.length > 1 ? route.params.drops : undefined;
  const lastDrop = drops ? drops[drops.length - 1] : null;
  const dropLat: number = lastDrop ? lastDrop.lat : dropoffCoord.latitude;
  const dropLng: number = lastDrop ? lastDrop.lng : dropoffCoord.longitude;
  const dropAddress: string = lastDrop ? lastDrop.address : dropoffLocation;
  const dropsKey = drops ? drops.map((d) => `${d.lat},${d.lng},${d.pieces}`).join(';') : '';

  const today = dayKey(0);
  const tomorrow = dayKey(1);
  const [choice, setChoice] = useState<DayChoice>('today');
  const [otherDay, setOtherDay] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const date = choice === 'today' ? today : choice === 'tomorrow' ? tomorrow : (otherDay ?? today);

  const { data: quote, loading, error, reload } = useRemote(
    () =>
      api.getQuote({
        pickup_lat: pickupCoord.latitude,
        pickup_lng: pickupCoord.longitude,
        drop_lat: dropLat,
        drop_lng: dropLng,
        weight_kg: weightKg,
        vehicle_type: vehicleType,
        load_type: loadType,
        date,
        ...(drops ? { drops } : {}),
      }),
    `${weightKg}|${loadType}|${vehicleType}|${date}|${dropsKey}`,
    t('quote_failed'),
  );

  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => dayKey(i + 2)), []);

  const pickDay = (day: string) => {
    setOtherDay(day);
    setChoice('other');
    setPickerOpen(false);
  };

  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookedId, setBookedId] = useState<string | null>(null);

  const book = async () => {
    setBooking(true);
    setBookingError(null);
    try {
      const created = await api.createBooking({
        pickup_lat: pickupCoord.latitude,
        pickup_lng: pickupCoord.longitude,
        drop_lat: dropLat,
        drop_lng: dropLng,
        weight_kg: weightKg,
        vehicle_type: vehicleType,
        load_type: loadType,
        date,
        pickup_name: placeName(pickupLocation),
        pickup_address: pickupLocation,
        drop_name: placeName(dropAddress),
        drop_address: dropAddress,
        ...(drops ? { drops } : {}),
      });
      setBookedId(created.id);
      DeviceEventEmitter.emit(BOOKING_CREATED_EVENT);
    } catch (e: any) {
      setBookingError(e?.message || t('book_failed'));
    } finally {
      setBooking(false);
    }
  };

  // Once the booking is sent, Back must not return to the form and send it twice.
  useEffect(() => {
    if (!bookedId) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      navigation.popToTop();
      return true;
    });
    return () => sub.remove();
  }, [bookedId, navigation]);

  const isRange = quote?.available && quote.low != null && quote.high != null && quote.low !== quote.high;

  if (bookedId) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.doneWrap}>
          <EmptyState
            icon={<Feather name="check-circle" size={size.icon.xl} color={colors.success} />}
            title={t('booked_title')}
            message={t('booked_msg', { date: formatDay(date) })}
            action={{
              label: t('booked_view'),
              variant: 'primary',
              onPress: () => {
                navigation.popToTop();
                navigation.navigate('BookingDetail', { id: bookedId });
              },
            }}
          />
          <Button title={t('back_home')} variant="ghost" onPress={() => navigation.popToTop()} style={styles.doneHome} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('quote_title')} onBack={() => navigation.goBack()} backLabel={t('back')} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.routeCard}>
          <View style={styles.pills}>
            <StatusPill label={loadType === 'part' ? t('load_part') : t('load_full')} tone="neutral" />
            <StatusPill label={`${formatNumber(weightKg)} kg`} tone="neutral" />
          </View>
          <Text variant="caption" color="textMuted">
            {t('pickup')}
          </Text>
          <Text variant="bodyMedium" numberOfLines={2}>
            {pickupLocation}
          </Text>
          {drops ? (
            <>
              <Text variant="caption" color="textMuted">
                {t('drops_quote_title', { n: drops.length, pieces: formatNumber(drops.reduce((sum, d) => sum + d.pieces, 0)) })}
              </Text>
              {drops.map((drop, index) => (
                <View key={`${drop.lat},${drop.lng},${index}`} style={styles.drop}>
                  <Text variant="captionMedium" color="textMuted">
                    {t('drops_drop_n', { n: index + 1 })}
                  </Text>
                  <Text variant="bodyMedium" numberOfLines={2}>
                    {drop.address}
                  </Text>
                  <Text variant="bodySmall" color="textMuted">
                    {t('drops_quote_line', { name: drop.consignee_name, phone: drop.consignee_phone, pieces: formatNumber(drop.pieces) })}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <>
              <Text variant="caption" color="textMuted">
                {t('dropoff')}
              </Text>
              <Text variant="bodyMedium" numberOfLines={2}>
                {dropoffLocation}
              </Text>
            </>
          )}
        </Card>

        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            {t('fact_pickup_date')}
          </Text>
          <View style={styles.dateRow} accessibilityRole="radiogroup" accessibilityLabel={t('fact_pickup_date')}>
            <DateChip label={t('today')} selected={choice === 'today'} onPress={() => setChoice('today')} />
            <DateChip label={t('tomorrow')} selected={choice === 'tomorrow'} onPress={() => setChoice('tomorrow')} />
            <DateChip
              label={choice === 'other' && otherDay ? formatDay(otherDay) : t('pick_date')}
              selected={choice === 'other'}
              onPress={() => setPickerOpen(true)}
              icon="calendar"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            {t('fact_price')}
          </Text>
          {loading ? (
            <Card style={styles.priceCard}>
              <ActivityIndicator color={colors.accent} />
              <Text variant="bodySmall" color="textMuted" align="center">
                {t('quote_working')}
              </Text>
            </Card>
          ) : error ? (
            <ErrorBanner message={error} action={{ label: t('try_again'), onPress: reload }} />
          ) : quote && !quote.available ? (
            <Card style={styles.priceCard}>
              <Feather name="info" size={size.icon.lg} color={colors.info} />
              <Text variant="bodyMedium" align="center">
                {quote.message ?? t('quote_unavailable')}
              </Text>
            </Card>
          ) : quote ? (
            <Card style={styles.priceCard}>
              <Text variant="caption" color="textMuted">
                {isRange ? t('quote_range') : t('quote_estimated')}
              </Text>
              <Text variant="display" accessibilityLabel={priceLabel(quote, t)}>
                {isRange ? t('price_to', { low: formatINR(quote.low!), high: formatINR(quote.high!) }) : formatINR(quote.suggested!)}
              </Text>
              {isRange ? (
                <Text variant="bodySmall" color="textMuted">
                  {t('quote_suggested', { price: formatINR(quote.suggested!) })}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {quote && quote.factors.length > 0 ? (
            <Card style={styles.factors}>
              <Text variant="bodyMedium" accessibilityRole="header">
                {t('quote_how')}
              </Text>
              {quote.factors.map((factor) => {
                const known = factor.code ? `factor_${factor.code}` : null;
                const detailKey = factor.code ? `factor_${factor.code}_detail` : null;
                return (
                  <View key={factor.code ?? factor.label} style={styles.factor}>
                    <Text variant="captionMedium" color="textMuted">
                      {known && hasTranslation(known) ? t(known) : factor.label}
                    </Text>
                    <Text variant="bodySmall">{detailKey && hasTranslation(detailKey) ? t(detailKey) : factor.detail}</Text>
                  </View>
                );
              })}
            </Card>
          ) : null}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        {quote && !quote.available && !loading ? (
          <Text variant="caption" color="textMuted" align="center">
            {t('quote_no_price')}
          </Text>
        ) : null}
        {bookingError ? <ErrorBanner message={bookingError} /> : null}
        <Button
          title={t('quote_book')}
          loading={booking}
          disabled={loading || !!error}
          accessibilityHint={quote && !quote.available ? t('quote_book_hint') : undefined}
          onPress={book}
        />
        <Button title={t('quote_change')} variant="secondary" disabled={booking} onPress={() => navigation.goBack()} />
      </SafeAreaView>

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text variant="title" accessibilityRole="header">
                {t('quote_choose_date')}
              </Text>
              <Button title={t('close')} variant="ghost" block={false} onPress={() => setPickerOpen(false)} />
            </View>
            <FlatList
              data={days}
              keyExtractor={(d) => d}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={formatDay(item)}
                  accessibilityState={{ selected: otherDay === item && choice === 'other' }}
                  onPress={() => pickDay(item)}
                  style={({ pressed }) => [styles.dayRow, pressed ? styles.pressed : null]}
                >
                  <Text variant="body">{formatDay(item)}</Text>
                  {otherDay === item && choice === 'other' ? <Feather name="check" size={size.icon.md} color={colors.accent} /> : null}
                </Pressable>
              )}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** The first part of an address, used as the place's short name. */
const placeName = (address: string) => address.split(',')[0].trim() || address;

function priceLabel(quote: Quote, t: TranslateFn): string {
  if (quote.low != null && quote.high != null && quote.low !== quote.high) {
    return t('price_between', { low: formatINR(quote.low), high: formatINR(quote.high) });
  }
  return formatINR(quote.suggested ?? 0);
}

function DateChip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: keyof typeof Feather.glyphMap;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[styles.chip, selected && styles.chipActive]}
    >
      {icon ? <Feather name={icon} size={size.icon.sm} color={selected ? colors.onAccentFill : colors.textMuted} /> : null}
      <Text variant="captionMedium" color={selected ? 'onAccentFill' : 'text'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  doneWrap: { flex: 1, justifyContent: 'center', padding: space[4] },
  doneHome: { marginTop: space[2] },
  content: { padding: space[4], gap: space[4], paddingBottom: space[8] },
  section: { gap: space[2] },
  routeCard: { gap: space[1] },
  drop: { gap: space[1], paddingTop: space[2], borderTopWidth: size.border, borderTopColor: colors.border },
  pills: { flexDirection: 'row', gap: space[2], marginBottom: space[2] },
  dateRow: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
  chip: {
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  chipActive: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  priceCard: { alignItems: 'center', gap: space[2] },
  factors: { gap: space[3] },
  factor: { gap: space[1] },
  bottomBar: {
    backgroundColor: colors.surface,
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[3],
    gap: space[2],
    borderTopWidth: size.border,
    borderTopColor: colors.border,
  },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: { maxHeight: '70%', backgroundColor: colors.surface, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space[4] },
  dayRow: {
    minHeight: size.control,
    paddingHorizontal: space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: size.border,
    borderTopColor: colors.border,
  },
  pressed: { opacity: 0.8 },
});
