import React, { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Card, EmptyState, ErrorBanner, ScreenHeader, StatusPill, Text } from '../components/ui';
import { colors, radius, size, space } from '../theme';
import { api, type Quote } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { dayKey, formatDay, formatINR, formatNumber } from '../utils/format';

/** How far ahead a pickup can be planned from the date list. */
const DAYS_AHEAD = 60;

type DayChoice = 'today' | 'tomorrow' | 'other';

export default function QuoteScreen({ navigation, route }: any) {
  const { pickupLocation, dropoffLocation, pickupCoord, dropoffCoord, loadType, weightKg, vehicleType } = route.params || {};

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
        drop_lat: dropoffCoord.latitude,
        drop_lng: dropoffCoord.longitude,
        weight_kg: weightKg,
        vehicle_type: vehicleType,
        load_type: loadType,
        date,
      }),
    `${weightKg}|${loadType}|${vehicleType}|${date}`,
    'Could not get a price. Check your internet connection and try again.',
  );

  const days = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => dayKey(i + 2)), []);

  const pickDay = (day: string) => {
    setOtherDay(day);
    setChoice('other');
    setPickerOpen(false);
  };

  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  const book = async () => {
    setBooking(true);
    setBookingError(null);
    try {
      await api.createBooking({
        pickup_lat: pickupCoord.latitude,
        pickup_lng: pickupCoord.longitude,
        drop_lat: dropoffCoord.latitude,
        drop_lng: dropoffCoord.longitude,
        weight_kg: weightKg,
        vehicle_type: vehicleType,
        load_type: loadType,
        date,
        pickup_name: placeName(pickupLocation),
        pickup_address: pickupLocation,
        drop_name: placeName(dropoffLocation),
        drop_address: dropoffLocation,
      });
      setBooked(true);
    } catch (e: any) {
      setBookingError(e?.message || 'Could not send your booking. Check your internet connection and try again.');
    } finally {
      setBooking(false);
    }
  };

  const isRange = quote?.available && quote.low != null && quote.high != null && quote.low !== quote.high;

  if (booked) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.doneWrap}>
          <EmptyState
            icon={<Feather name="check-circle" size={size.icon.xl} color={colors.success} />}
            title="Booking sent"
            message={`Our team will confirm your pickup on ${formatDay(date)} and let you know here.`}
            action={{ label: 'Back to Home', onPress: () => navigation.popToTop(), variant: 'primary' }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Price and pickup date" onBack={() => navigation.goBack()} backLabel="Back" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.routeCard}>
          <View style={styles.pills}>
            <StatusPill label={loadType === 'part' ? 'Part load' : 'Full truck'} tone="neutral" />
            <StatusPill label={`${formatNumber(weightKg)} kg`} tone="neutral" />
          </View>
          <Text variant="caption" color="textMuted">
            Pickup
          </Text>
          <Text variant="bodyMedium" numberOfLines={2}>
            {pickupLocation}
          </Text>
          <Text variant="caption" color="textMuted">
            Drop-off
          </Text>
          <Text variant="bodyMedium" numberOfLines={2}>
            {dropoffLocation}
          </Text>
        </Card>

        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            Pickup date
          </Text>
          <View style={styles.dateRow} accessibilityRole="radiogroup" accessibilityLabel="Pickup date">
            <DateChip label="Today" selected={choice === 'today'} onPress={() => setChoice('today')} />
            <DateChip label="Tomorrow" selected={choice === 'tomorrow'} onPress={() => setChoice('tomorrow')} />
            <DateChip
              label={choice === 'other' && otherDay ? formatDay(otherDay) : 'Pick a date'}
              selected={choice === 'other'}
              onPress={() => setPickerOpen(true)}
              icon="calendar"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            Price
          </Text>
          {loading ? (
            <Card style={styles.priceCard}>
              <ActivityIndicator color={colors.accent} />
              <Text variant="bodySmall" color="textMuted" align="center">
                Working out your price
              </Text>
            </Card>
          ) : error ? (
            <ErrorBanner message={error} action={{ label: 'Try again', onPress: reload }} />
          ) : quote && !quote.available ? (
            <Card style={styles.priceCard}>
              <Feather name="info" size={size.icon.lg} color={colors.info} />
              <Text variant="bodyMedium" align="center">
                {quote.message ?? 'We cannot show a price for this trip yet.'}
              </Text>
            </Card>
          ) : quote ? (
            <Card style={styles.priceCard}>
              <Text variant="caption" color="textMuted">
                {isRange ? 'Price range' : 'Estimated price'}
              </Text>
              <Text variant="display" accessibilityLabel={priceLabel(quote)}>
                {isRange ? `${formatINR(quote.low!, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} to ${formatINR(quote.high!, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}` : formatINR(quote.suggested!, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}
              </Text>
              {isRange ? (
                <Text variant="bodySmall" color="textMuted">
                  Suggested {formatINR(quote.suggested!, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}
                </Text>
              ) : null}
            </Card>
          ) : null}

          {quote && quote.factors.length > 0 ? (
            <Card style={styles.factors}>
              <Text variant="bodyMedium" accessibilityRole="header">
                How this price is worked out
              </Text>
              {quote.factors.map((factor) => (
                <View key={factor.label} style={styles.factor}>
                  <Text variant="captionMedium" color="textMuted">
                    {factor.label}
                  </Text>
                  <Text variant="bodySmall">{factor.detail}</Text>
                </View>
              ))}
            </Card>
          ) : null}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        {bookingError ? <ErrorBanner message={bookingError} /> : null}
        <Button
          title="Book this shipment"
          loading={booking}
          disabled={loading || !!error}
          accessibilityHint={quote && !quote.available ? 'Sends your request so our team can quote it' : undefined}
          onPress={book}
        />
        <Button title="Change details" variant="secondary" disabled={booking} onPress={() => navigation.goBack()} />
      </SafeAreaView>

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text variant="title" accessibilityRole="header">
                Choose a pickup date
              </Text>
              <Button title="Close" variant="ghost" block={false} onPress={() => setPickerOpen(false)} />
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

function priceLabel(quote: Quote): string {
  if (quote.low != null && quote.high != null && quote.low !== quote.high) {
    return `Between ${formatINR(quote.low)} and ${formatINR(quote.high)}`;
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
  doneWrap: { flex: 1, justifyContent: 'center' },
  content: { padding: space[4], gap: space[4], paddingBottom: space[8] },
  section: { gap: space[2] },
  routeCard: { gap: space[1] },
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
