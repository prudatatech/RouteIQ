import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Banner, Button, Card, ErrorBanner, ScreenHeader, StatusPill, Text } from '../components/ui';
import { TrackingMap } from '../components/TrackingMap';
import { CustodyTimeline } from '../components/cargo/CustodyTimeline';
import { DeliveryOtpCard } from '../components/cargo/DeliveryOtpCard';
import { ProofOfDeliveryCard } from '../components/cargo/ProofOfDeliveryCard';
import { ConfirmReceiptCard } from '../components/cargo/ConfirmReceiptCard';
import { ClaimsCard } from '../components/cargo/ClaimsCard';
import { LotsCard, isLotClaim } from '../components/cargo/LotsCard';
import { colors, fontFamily, radius, size, space } from '../theme';
import { api, CLAIM_CREATED_EVENT, type BookingCargo, type BookingDetail, type Invoice } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { BOOKING_STEPS, bookingStatusInfo, canCancel, deliveryFailed, formatMinutes, isDelivered } from '../utils/bookingStatus';
import { claimClosesAt, claimWindowOpen, deliveredAt, mergeClaims } from '../utils/cargo';
import { formatDate, formatDateTime, formatDay, formatINR, formatNumber } from '../utils/format';
import { useTranslation } from '../hooks/useTranslation';
import { invoicesOfBooking } from '../utils/invoices';

/** How often live tracking refreshes while the shipment is moving. */
const LIVE_REFRESH_MS = 30_000;

/** Shipment statuses where the goods are still moving or waiting, so the screen keeps refreshing. */
const LIVE_SHIPMENT = ['exception', 'out_for_delivery', 'at_hub', 'on_hold', 'returning', 'partially_delivered'];

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

  // Custody data exists once the booking has become a shipment (it then has a tracking ID).
  const trackingId = data?.booking.tracking_id ?? null;
  const hasShipment = !!trackingId && data?.booking.status !== 'requested';
  const cargo = useRemote(
    () => (hasShipment ? api.getBookingCargo(id) : Promise.resolve(null)),
    `cargo:${id}:${hasShipment}`,
    t('cargo_load_failed'),
  );
  const { reload: reloadCargo } = cargo;
  // The invoice notice is a bonus on this screen: without a signal the booking still shows.
  const invoices = useRemote(() => api.listInvoices().catch(() => [] as Invoice[]), `invoices:${id}`);
  const { reload: reloadInvoices } = invoices;

  // Bumped on every refresh, so child cards that load their own data refresh with the screen.
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => {
    reload();
    reloadCargo();
    reloadInvoices();
    setRefreshKey((k) => k + 1);
  }, [reload, reloadCargo, reloadInvoices]);

  // A claim filed on the next screen shows up here when the customer comes back.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CLAIM_CREATED_EVENT, () => {
      reloadCargo();
    });
    return () => sub.remove();
  }, [reloadCargo]);

  const status = data?.booking.status;
  const shipmentStatus = cargo.data?.where?.status ?? data?.booking.shipment_status ?? null;
  const live =
    !!data?.tracking && (status === 'assigned' || status === 'in_transit' || (!!shipmentStatus && LIVE_SHIPMENT.includes(shipmentStatus)));
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(refresh, LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, refresh]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title={t('booking_title')} onBack={() => navigation.goBack()} backLabel={t('back')} />
      {!data ? (
        <View style={styles.center}>
          {loading ? <ActivityIndicator color={colors.accent} /> : <ErrorBanner message={error ?? t('booking_load_failed_short')} action={{ label: t('try_again'), onPress: reload }} />}
        </View>
      ) : (
        <Details
          detail={data}
          error={error}
          loading={loading}
          refresh={refresh}
          cargo={cargo.data}
          cargoError={cargo.error}
          retryCargo={reloadCargo}
          refreshKey={refreshKey}
          navigation={navigation}
          invoices={invoicesOfBooking(invoices.data ?? [], id)}
          showOtp={route.params.focus === 'otp'}
        />
      )}
    </SafeAreaView>
  );
}

interface DetailsProps {
  detail: BookingDetail;
  error?: string;
  loading: boolean;
  refresh: () => void;
  cargo: BookingCargo | null | undefined;
  cargoError?: string;
  retryCargo: () => void;
  refreshKey: number;
  navigation: any;
  /** This booking's invoices, newest first. */
  invoices: Invoice[];
  /** Opened from the delivery-code notification: show the code card whatever the status. */
  showOtp: boolean;
}

function Details({
  detail,
  error,
  loading,
  refresh,
  cargo,
  cargoError,
  retryCargo,
  refreshKey,
  navigation,
  invoices,
  showOtp,
}: DetailsProps) {
  const { t } = useTranslation();
  const { booking, tracking } = detail;
  const where = cargo?.where ?? null;
  // The cargo view is fresher than the booking, so its status wins when there is one.
  const shipment = { status: booking.status, shipment_status: where?.status ?? booking.shipment_status };
  const status = bookingStatusInfo(shipment);
  const times = stepTimes(detail);
  const cancelled = booking.status === 'cancelled';
  const reached = BOOKING_STEPS.findIndex((s) => s.status === booking.status);
  const vehicle = tracking?.vehicle;
  const delivered = !cancelled && isDelivered(shipment);
  const notices = cargo?.exceptions ?? [];
  // The customer reported a problem while rating: the claim option stays open (see the claims card below).
  const [issueReported, setIssueReported] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // Read once: the claim window is measured in days, so a clock frozen at screen open is close enough.
  const [now] = useState(() => Date.now());
  // Only a pull down shows the spinner, not the quiet refresh that runs while a shipment is moving.
  const [pulling, setPulling] = useState(false);
  const pull = () => {
    setPulling(true);
    refresh();
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
      refresh();
    } catch (e: any) {
      setCancelError(e?.message || t('cancel_failed'));
      // The booking may have been picked up in the meantime, so show its current state.
      refresh();
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

  const handedOverAt = delivered ? deliveredAt(cargo, tracking) : null;
  const claimWindow = delivered ? claimWindowOpen(handedOverAt, now) : null;
  // The cargo view carries the claims of the master and of every lot (each lot's tagged with its code)
  const allClaims = mergeClaims(cargo?.claims, undefined);
  const shipmentId = where?.shipment_id ?? null;
  // The receipt form waits for the cargo data, which says whether the customer already confirmed.
  const cargoSettled = cargo !== undefined || !!cargoError;
  // A master (split into lots): the lots carry the delivery codes, proofs and claims
  const lots = cargo?.lots ?? [];
  const split = lots.length > 0;
  const bookingClaims = split ? allClaims.filter((c) => !lots.some((l) => isLotClaim(c, l))) : allClaims;
  // A claim is offered only when a problem was reported (with the rating) or a claim already exists;
  // a delivery rated without an issue shows no claim option.
  const claimOption = issueReported || bookingClaims.length > 0;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} tintColor={colors.accent} />}
      >
        {error ? <ErrorBanner message={error} action={{ label: t('try_again'), onPress: refresh }} /> : null}

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
              value={booking.quoted_price != null ? formatINR(booking.quoted_price) : t('fact_price_tbc')}
            />
            {booking.tracking_id ? <Fact label={t('fact_tracking')} value={booking.tracking_id} mono /> : null}
            {where?.pieces.total != null ? <Fact label={t('fact_pieces')} value={formatNumber(where.pieces.total)} /> : null}
          </View>
        </Card>

        {deliveryFailed(booking) ? <Banner tone="warning" icon="alert-triangle" message={t('delivery_failed_note')} /> : null}

        {notices.map((notice, index) => (
          <Banner
            key={notice.id ?? `notice-${index}`}
            tone="warning"
            icon="alert-triangle"
            message={notice.revised_eta ? `${notice.message} ${t('new_eta', { time: formatDateTime(notice.revised_eta) })}` : notice.message}
          />
        ))}

        {cargoError ? <ErrorBanner message={cargoError} action={{ label: t('try_again'), onPress: retryCargo }} /> : null}

        {delivered && cargoSettled ? (
          <ConfirmReceiptCard
            bookingId={booking.id}
            receipt={cargo?.receipt ?? null}
            onConfirmed={(withIssue) => {
              if (withIssue) setIssueReported(true);
              retryCargo();
            }}
          />
        ) : null}

        {invoices.map((invoice) => (
          <Banner
            key={invoice.id}
            tone={invoice.status === 'paid' ? 'info' : invoice.overdue ? 'warning' : 'info'}
            icon="file-text"
            message={
              invoice.status === 'paid'
                ? t('booking_invoice_paid', { number: invoice.invoice_number ?? '' })
                : `${t('booking_invoice_issued', { number: invoice.invoice_number ?? '', amount: invoice.total != null ? formatINR(invoice.total) : '' })}${
                    invoice.due_date ? ` ${t('invoice_due', { date: formatDate(invoice.due_date) })}.` : ''
                  }`
            }
            action={{ label: t('booking_invoice_view'), onPress: () => navigation.navigate('Invoice', { id: invoice.id }) }}
          />
        ))}

        {!cancelled && !split && (showOtp || shipment.shipment_status === 'out_for_delivery') ? (
          <DeliveryOtpCard
            bookingId={booking.id}
            trackingId={booking.tracking_id}
            shipmentId={shipmentId}
            sentAt={cargo?.delivery_otp?.sent_at ?? null}
            refreshKey={refreshKey}
            onOpenNotifications={() => navigation.navigate('Main', { screen: 'Notifications' })}
          />
        ) : null}

        {cancelled ? (
          <Banner tone="neutral" icon="x-circle" message={booking.cancel_reason ? t('cancelled_reason', { reason: booking.cancel_reason }) : t('cancelled')} />
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

        {split ? (
          <LotsCard
            bookingId={booking.id}
            lots={lots}
            totals={where?.totals ?? null}
            claims={allClaims}
            refreshKey={refreshKey}
            onOpenNotifications={() => navigation.navigate('Main', { screen: 'Notifications' })}
            onRaiseClaim={(lot) =>
              navigation.navigate('Claim', { bookingId: booking.id, shipmentId: lot.shipment_id, trackingId: lot.code, lotLabel: lot.label })
            }
          />
        ) : null}

        {cargo ? <CustodyTimeline events={cargo.timeline} where={where} notices={notices} history={tracking?.history ?? []} /> : null}

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

        {cargo?.pod ? <ProofOfDeliveryCard pod={cargo.pod} /> : null}

        <ClaimsCard
          claims={bookingClaims}
          windowOpen={split || !claimOption ? null : claimWindow}
          closesAt={claimWindow ? claimClosesAt(handedOverAt) : null}
          canRaise={!!shipmentId && !split && claimOption}
          onRaise={() =>
            navigation.navigate('Claim', { bookingId: booking.id, shipmentId, trackingId: booking.tracking_id })
          }
          error={cargoError ? t('claims_load_failed') : undefined}
          onRetry={retryCargo}
        />

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
    </KeyboardAvoidingView>
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
