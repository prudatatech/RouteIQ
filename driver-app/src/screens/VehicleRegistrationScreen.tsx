/**
 * MargixIndia Driver App — Register your vehicle
 *
 * First-login onboarding, "add a vehicle", and fixing a rejected or waiting
 * request. The vehicle goes to dispatch for approval; until then it takes no
 * work. Photos are optional and can be added or changed any time.
 */
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, type RegisteredVehicle, type VehicleKind, type VehiclePhotoInfo, type VehiclePhotoSlot } from '../services/api';
import { chooseVehiclePhoto, uploadStagedPhotos } from '../services/vehiclePhotos';
import { useTranslation } from '../hooks/useTranslation';
import PhotoSlots from '../components/vehicle/PhotoSlots';
import { Button, Card, ErrorBanner, Text, TextField } from '../components/ui';
import { colors, radius, size, space } from '../theme';

const KINDS: { id: VehicleKind; labelKey: string }[] = [
  { id: 'truck', labelKey: 'vehicle_kind_truck' },
  { id: 'van', labelKey: 'vehicle_kind_van' },
  { id: 'bike', labelKey: 'vehicle_kind_bike' },
  { id: 'car', labelKey: 'vehicle_kind_car' },
];

/** The plate as the server stores it: capitals, no spaces or dashes. */
const normalizePlate = (raw: string) => raw.trim().toUpperCase().replace(/[\s-]+/g, '');

interface Props {
  /** The vehicle being corrected, when there is one (waiting or rejected). */
  initial: RegisteredVehicle | null;
  photos: VehiclePhotoInfo[];
  /** 'new' is the first registration; the others correct an existing request. */
  mode: 'new' | 'edit' | 'resubmit';
  onDone: () => void;
  /** Back out without sending (edit and resubmit). */
  onCancel?: () => void;
  /** Continue without a vehicle: dispatch will assign one (new only). */
  onSkip?: () => void;
  onLogout: () => void;
}

export default function VehicleRegistrationScreen({ initial, photos, mode, onDone, onCancel, onSkip, onLogout }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<VehicleKind>(initial?.vehicle_type ?? 'truck');
  const [plate, setPlate] = useState(initial?.plate_number ?? '');
  const [capacity, setCapacity] = useState(initial?.capacity_kg ? String(initial.capacity_kg) : '');
  const [model, setModel] = useState(initial?.vehicle_model ?? '');
  const [rc, setRc] = useState(initial?.rc_number ?? '');
  const [insurance, setInsurance] = useState(initial?.insurance_number ?? '');
  const [staged, setStaged] = useState<Partial<Record<VehiclePhotoSlot, string>>>({});
  const [errors, setErrors] = useState<{ plate?: string; capacity?: string }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const existing: Partial<Record<VehiclePhotoSlot, string | null>> = {};
  for (const p of photos) existing[p.slot] = p.url;

  const addPhoto = async (slot: VehiclePhotoSlot) => {
    const uri = await chooseVehiclePhoto(t);
    if (uri) setStaged((s) => ({ ...s, [slot]: uri }));
  };

  const submit = async () => {
    const nextErrors: typeof errors = {};
    const plateValue = normalizePlate(plate);
    if (!/^[A-Z0-9]{4,20}$/.test(plateValue)) nextErrors.plate = t('vehicle_plate_invalid');
    const capacityValue = Number(capacity);
    if (!Number.isFinite(capacityValue) || capacityValue <= 0 || capacityValue > 50000) nextErrors.capacity = t('vehicle_capacity_invalid');
    setErrors(nextErrors);
    if (nextErrors.plate || nextErrors.capacity) return;

    setBusy(true);
    setError('');
    try {
      const vehicle = await api.registerVehicle({
        plate_number: plateValue,
        vehicle_type: kind,
        capacity_kg: capacityValue,
        ...(model.trim() ? { vehicle_model: model.trim() } : {}),
        ...(rc.trim() ? { rc_number: rc.trim().toUpperCase() } : {}),
        ...(insurance.trim() ? { insurance_number: insurance.trim().toUpperCase() } : {}),
      });
      if (Object.keys(staged).length > 0) {
        const failed = await uploadStagedPhotos(vehicle.id, staged);
        if (failed.length > 0) Alert.alert(t('vehicle_reg_title'), t('vehicle_photo_some_failed'));
      }
      onDone();
    } catch (e: any) {
      setError(e?.message || t('vehicle_submit_failed'));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'resubmit' ? t('vehicle_resubmit') : mode === 'edit' ? t('vehicle_edit_details') : t('vehicle_reg_title');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.heading}>
            <Text variant="heading" accessibilityRole="header">
              {title}
            </Text>
            <Text variant="bodySmall" color="textMuted">
              {t(mode === 'new' ? 'vehicle_reg_intro' : 'vehicle_reg_intro_fix')}
            </Text>
          </View>

          <Card style={styles.card}>
            <View style={styles.field}>
              <Text variant="bodySmallMedium">{t('vehicle_type')}</Text>
              <View style={styles.kinds} accessibilityRole="radiogroup">
                {KINDS.map((k) => {
                  const selected = kind === k.id;
                  return (
                    <Pressable
                      key={k.id}
                      onPress={() => setKind(k.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={t(k.labelKey)}
                      style={[styles.kind, selected ? styles.kindSelected : null]}
                    >
                      <Text variant="bodySmallMedium" color={selected ? 'accent' : 'text'}>
                        {t(k.labelKey)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <TextField
              label={t('vehicle_plate')}
              hint={t('vehicle_plate_hint')}
              value={plate}
              onChangeText={(v) => {
                setPlate(v.toUpperCase());
                if (errors.plate) setErrors((e) => ({ ...e, plate: undefined }));
              }}
              error={errors.plate}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={24}
            />
            <TextField
              label={t('vehicle_capacity')}
              value={capacity}
              onChangeText={(v) => {
                setCapacity(v.replace(/[^\d]/g, ''));
                if (errors.capacity) setErrors((e) => ({ ...e, capacity: undefined }));
              }}
              error={errors.capacity}
              keyboardType="number-pad"
              maxLength={5}
            />
            <TextField label={t('vehicle_model_label')} hint={t('vehicle_optional')} value={model} onChangeText={setModel} maxLength={100} />
            <TextField label={t('vehicle_rc_number')} hint={t('vehicle_optional')} value={rc} onChangeText={(v) => setRc(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={50} />
            <TextField
              label={t('vehicle_insurance_number')}
              hint={t('vehicle_optional')}
              value={insurance}
              onChangeText={(v) => setInsurance(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={50}
            />
          </Card>

          <Card style={styles.card}>
            <View style={styles.field}>
              <Text variant="title" accessibilityRole="header">
                {t('vehicle_photos_title')}
              </Text>
              <Text variant="bodySmall" color="textMuted">
                {t('vehicle_photos_hint')}
              </Text>
            </View>
            <PhotoSlots items={{ ...existing, ...staged }} onAdd={addPhoto} />
          </Card>

          {error ? <ErrorBanner message={error} /> : null}

          <View style={styles.actions}>
            <Button title={t(mode === 'new' ? 'vehicle_submit' : 'vehicle_resubmit')} onPress={submit} loading={busy} />
            {mode === 'new' && onSkip ? <Button title={t('vehicle_skip')} variant="secondary" onPress={onSkip} disabled={busy} /> : null}
            {mode !== 'new' && onCancel ? <Button title={t('cancel')} variant="secondary" onPress={onCancel} disabled={busy} /> : null}
            <Button title={t('logout')} variant="ghost" onPress={onLogout} disabled={busy} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { padding: space[4], gap: space[4] },
  heading: { gap: space[1], paddingTop: space[2] },
  card: { gap: space[4] },
  field: { gap: space[1] },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  kind: {
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  actions: { gap: space[2] },
});
