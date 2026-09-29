import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { useTranslation } from '../hooks/useTranslation';
import { api, type FuelLog, type FuelPaymentMode } from '../services/api';
import { compressBill, uploadBill } from '../services/fuelBill';
import { Button, Card, ErrorBanner, ScreenHeader, StatusPill, Text, TextField } from '../components/ui';
import { colors, radius, size, space } from '../theme';
import { deriveAmounts, sendableAmounts, type AmountField, type AmountValues } from '../utils/fuel';
import { errorMessage } from '../utils/errors';
import { formatDate, formatINR, formatNumber } from '../utils/format';
import { shortFeedback } from '../utils/feedback';
import type { LatLng } from '../types/route';

interface FuelLogScreenProps {
  vehicleId: string;
  /** The phone's position now, sent with the fill so the office can see where fuel was bought. */
  location: LatLng | null;
  onClose: () => void;
  /** Rendered at the right of the header (the SOS button). */
  headerRight?: ReactNode;
}

const PAYMENT_MODES: FuelPaymentMode[] = ['cash', 'card', 'upi', 'fuel_card', 'credit', 'other'];
const PAYMENT_KEY: Record<FuelPaymentMode, string> = {
  cash: 'fuel_pay_cash',
  card: 'fuel_pay_card',
  upi: 'fuel_pay_upi',
  fuel_card: 'fuel_pay_fuel_card',
  credit: 'fuel_pay_credit',
  other: 'fuel_pay_other',
};
const BLANK: AmountValues = { litres: '', price: '', total: '' };

/** The driver logs a fill-up for their own vehicle. The bill photo is optional; without it the fill is flagged for review. */
export default function FuelLogScreen({ vehicleId, location, onClose, headerRight }: FuelLogScreenProps) {
  const { t } = useTranslation();
  const [amounts, setAmounts] = useState<AmountValues>(BLANK);
  const [edited, setEdited] = useState<AmountField[]>([]);
  const [odometer, setOdometer] = useState('');
  const [odometerFromVehicle, setOdometerFromVehicle] = useState(false);
  const [fullTank, setFullTank] = useState(true);
  const [station, setStation] = useState('');
  const [payment, setPayment] = useState<FuelPaymentMode>('cash');
  const [billUri, setBillUri] = useState<string | null>(null);
  const [billBusy, setBillBusy] = useState(false);
  const [billError, setBillError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<FuelLog[] | null>(null);
  const [recentFailed, setRecentFailed] = useState(false);
  // One key per form: a resend after a lost reply is applied once
  const keyRef = useRef(Crypto.randomUUID());
  const odometerTouched = useRef(false);

  const loadRecent = useCallback(async () => {
    setRecentFailed(false);
    try {
      setRecent(await api.getFuelLogs(vehicleId));
    } catch {
      setRecentFailed(true);
    }
  }, [vehicleId]);

  useEffect(() => {
    loadRecent();
    // Prefill the odometer with the vehicle's own reading
    api
      .getVehicleInfo(vehicleId)
      .then((vehicle) => {
        const km = vehicle?.odometer_km;
        if (km != null && !odometerTouched.current) {
          setOdometer(String(Math.round(Number(km))));
          setOdometerFromVehicle(true);
        }
      })
      .catch(() => {});
  }, [vehicleId, loadRecent]);

  const setAmount = (field: AmountField, value: string) => {
    const nextEdited = [...edited.filter((f) => f !== field), field].slice(-2) as AmountField[];
    setEdited(nextEdited);
    setAmounts(deriveAmounts({ ...amounts, [field]: value }, nextEdited));
  };

  const pickBill = async (source: 'camera' | 'gallery') => {
    setBillError('');
    setBillBusy(true);
    try {
      const permission =
        source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setBillError(t('fuel_bill_denied'));
        return;
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
      const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setBillUri(await compressBill(result.assets[0].uri));
    } catch {
      setBillError(t('fuel_bill_failed'));
    } finally {
      setBillBusy(false);
    }
  };

  const save = async () => {
    setError('');
    const figures = sendableAmounts(amounts, edited);
    if (!figures) {
      setError(t('fuel_amounts_needed'));
      return;
    }
    const odo = odometer.trim() === '' ? null : Number(odometer);
    if (odo != null && !(Number.isFinite(odo) && odo >= 0)) {
      setError(t('fuel_odometer_invalid'));
      return;
    }
    setSaving(true);
    try {
      const billPath = billUri ? await uploadBill(vehicleId, billUri) : null;
      const log = await api.createFuelLog(
        vehicleId,
        {
          ...figures,
          odometer_km: odo,
          is_full_tank: fullTank,
          station_name: station.trim() || null,
          payment_mode: payment,
          bill_path: billPath,
          ...(location ? { fill_latitude: location.lat, fill_longitude: location.lng } : {}),
        },
        keyRef.current,
      );
      shortFeedback();
      Alert.alert(log.bill_status === 'with_bill' ? t('fuel_saved_bill') : t('fuel_saved_no_bill'));
      onClose();
    } catch (e) {
      setError(errorMessage(e, t('fuel_save_failed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title={t('fuel_log_title')} onBack={onClose} backIcon="close" backLabel={t('close')} right={headerRight} />
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="bodySmall" color="textMuted">
            {t('fuel_any_two')}
          </Text>

          <TextField label={t('fuel_litres')} keyboardType="decimal-pad" value={amounts.litres} onChangeText={(v) => setAmount('litres', v)} />
          <TextField label={t('fuel_price')} keyboardType="decimal-pad" value={amounts.price} onChangeText={(v) => setAmount('price', v)} />
          <TextField label={t('fuel_total')} keyboardType="decimal-pad" value={amounts.total} onChangeText={(v) => setAmount('total', v)} />
          <TextField
            label={t('fuel_odometer')}
            hint={odometerFromVehicle ? t('fuel_odometer_hint') : undefined}
            keyboardType="number-pad"
            value={odometer}
            onChangeText={(v) => {
              odometerTouched.current = true;
              setOdometer(v);
            }}
          />
          <TextField label={t('fuel_station')} value={station} onChangeText={setStation} maxLength={120} />

          <Card style={styles.row}>
            <View style={styles.flex}>
              <Text variant="bodyMedium">{t('fuel_full_tank')}</Text>
              <Text variant="caption" color="textMuted">
                {t('fuel_full_tank_hint')}
              </Text>
            </View>
            <Switch
              value={fullTank}
              onValueChange={setFullTank}
              trackColor={{ false: colors.borderStrong, true: colors.accentFill }}
              thumbColor={colors.surface}
              accessibilityLabel={t('fuel_full_tank')}
            />
          </Card>

          <View style={styles.group}>
            <Text variant="bodySmallMedium">{t('fuel_payment')}</Text>
            <View style={styles.chips}>
              {PAYMENT_MODES.map((mode) => {
                const selected = payment === mode;
                return (
                  <Pressable
                    key={mode}
                    onPress={() => setPayment(mode)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text variant="bodySmallMedium" color={selected ? 'onAccentFill' : 'text'}>
                      {t(PAYMENT_KEY[mode])}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.group}>
            <Text variant="bodySmallMedium">{t('fuel_bill')}</Text>
            {billUri ? (
              <View style={styles.billRow}>
                <Image source={{ uri: billUri }} style={styles.thumb} accessibilityLabel={t('fuel_bill_attached')} />
                <View style={styles.flex}>
                  <StatusPill tone="success" label={t('fuel_bill_attached')} />
                </View>
                <Button title={t('fuel_bill_remove')} variant="ghost" block={false} onPress={() => setBillUri(null)} disabled={saving} />
              </View>
            ) : (
              <>
                <View style={styles.billButtons}>
                  <View style={styles.flex}>
                    <Button title={t('fuel_bill_take')} variant="secondary" loading={billBusy} onPress={() => pickBill('camera')} disabled={saving} />
                  </View>
                  <View style={styles.flex}>
                    <Button title={t('fuel_bill_pick')} variant="secondary" onPress={() => pickBill('gallery')} disabled={saving || billBusy} />
                  </View>
                </View>
                <Text variant="caption" color="textMuted">
                  {t('fuel_no_bill_note')}
                </Text>
              </>
            )}
            {billError ? (
              <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
                {billError}
              </Text>
            ) : null}
          </View>

          {error ? <ErrorBanner message={error} /> : null}
          <Button title={t('fuel_save')} loading={saving} onPress={save} />

          <View style={styles.group}>
            <Text variant="title">{t('fuel_recent')}</Text>
            {recent === null && !recentFailed ? (
              <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />
            ) : recentFailed ? (
              <ErrorBanner message={t('fuel_load_failed')} action={{ label: t('retry'), onPress: loadRecent }} />
            ) : recent && recent.length === 0 ? (
              <Text variant="bodySmall" color="textMuted">
                {t('fuel_recent_empty')}
              </Text>
            ) : (
              recent?.map((log) => (
                <Card key={log.id} style={styles.recent}>
                  <View style={styles.flex}>
                    <Text variant="bodyMedium">{`${formatNumber(log.litres)} L · ${formatINR(log.total_amount)}`}</Text>
                    <Text variant="caption" color="textMuted">
                      {[formatDate(log.filled_at), log.station_name, log.is_full_tank ? null : t('fuel_part_fill')].filter(Boolean).join(' · ')}
                    </Text>
                    {log.mileage_kmpl != null ? (
                      <Text variant="caption" color="textMuted">{`${formatNumber(log.mileage_kmpl, { maximumFractionDigits: 1 })} ${t('fuel_kmpl')}`}</Text>
                    ) : null}
                  </View>
                  <StatusPill tone={log.bill_status === 'with_bill' ? 'success' : 'warning'} label={log.bill_status === 'with_bill' ? t('fuel_bill_tag') : t('fuel_no_bill_tag')} />
                </Card>
              ))
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const THUMB = 56;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[8], gap: space[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  group: { gap: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.accentFill, borderColor: colors.accentFill },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  billButtons: { flexDirection: 'row', gap: space[2] },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.control, backgroundColor: colors.surfaceSubtle },
  recent: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
