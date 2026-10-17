/**
 * MargixIndia Driver App — Register your vehicle
 *
 * First-login onboarding, "add a vehicle", and fixing a rejected or waiting
 * request. The vehicle goes to dispatch for approval; until then it takes no
 * work. Photos are optional and can be added or changed any time.
 */
import React, { useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, type RegisteredVehicle, type VehicleDocumentSlot, type VehicleKind, type VehiclePhotoInfo, type VehiclePhotoSlot } from '../services/api';
import { chooseVehiclePhoto, uploadStagedPhotos } from '../services/vehiclePhotos';
import { chooseVehicleDocument, uploadStagedDocuments } from '../services/vehicleDocuments';
import { isValidDay } from '../utils/documents';
import { useTranslation } from '../hooks/useTranslation';
import PhotoSlots from '../components/vehicle/PhotoSlots';
import DocumentSlots from '../components/vehicle/DocumentSlots';
import { Button, Card, Chip, ErrorBanner, ScreenHeader, Text, TextField } from '../components/ui';
import { colors, space } from '../theme';

const DOCUMENT_URL_FIELD: Record<VehicleDocumentSlot, keyof RegisteredVehicle> = {
  rc: 'rc_document_url',
  insurance: 'insurance_document_url',
  fitness: 'fitness_document_url',
  permit: 'permit_document_url',
  puc: 'puc_document_url',
};

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
  const [rcExpiry, setRcExpiry] = useState(initial?.rc_expiry ?? '');
  const [insurance, setInsurance] = useState(initial?.insurance_number ?? '');
  const [insuranceExpiry, setInsuranceExpiry] = useState(initial?.insurance_expiry ?? '');
  const [fitness, setFitness] = useState(initial?.fitness_certificate_number ?? '');
  const [fitnessExpiry, setFitnessExpiry] = useState(initial?.fitness_expiry ?? '');
  const [permit, setPermit] = useState(initial?.permit_number ?? '');
  const [permitExpiry, setPermitExpiry] = useState(initial?.permit_expiry ?? '');
  const [puc, setPuc] = useState(initial?.puc_number ?? '');
  const [pucExpiry, setPucExpiry] = useState(initial?.puc_expiry ?? '');
  const [containerLength, setContainerLength] = useState(initial?.container_length_ft ? String(initial.container_length_ft) : '');
  const [containerWidth, setContainerWidth] = useState(initial?.container_width_ft ? String(initial.container_width_ft) : '');
  const [containerHeight, setContainerHeight] = useState(initial?.container_height_ft ? String(initial.container_height_ft) : '');
  const [staged, setStaged] = useState<Partial<Record<VehiclePhotoSlot, string>>>({});
  const [stagedDocs, setStagedDocs] = useState<Partial<Record<VehicleDocumentSlot, string>>>({});
  const [errors, setErrors] = useState<{
    plate?: string;
    capacity?: string;
    rcExpiry?: string;
    insuranceExpiry?: string;
    fitnessExpiry?: string;
    permitExpiry?: string;
    pucExpiry?: string;
    containerLength?: string;
    containerWidth?: string;
    containerHeight?: string;
  }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const capacityRef = useRef<TextInput>(null);
  const modelRef = useRef<TextInput>(null);
  const rcRef = useRef<TextInput>(null);
  const rcExpiryRef = useRef<TextInput>(null);
  const insuranceRef = useRef<TextInput>(null);
  const insuranceExpiryRef = useRef<TextInput>(null);
  const fitnessRef = useRef<TextInput>(null);
  const fitnessExpiryRef = useRef<TextInput>(null);
  const permitRef = useRef<TextInput>(null);
  const permitExpiryRef = useRef<TextInput>(null);
  const pucRef = useRef<TextInput>(null);
  const pucExpiryRef = useRef<TextInput>(null);
  const containerLengthRef = useRef<TextInput>(null);
  const containerWidthRef = useRef<TextInput>(null);
  const containerHeightRef = useRef<TextInput>(null);

  const existing: Partial<Record<VehiclePhotoSlot, string | null>> = {};
  for (const p of photos) existing[p.slot] = p.url;

  const existingDocs: Partial<Record<VehicleDocumentSlot, string | null>> = {};
  for (const slot of ['rc', 'insurance', 'fitness', 'permit', 'puc'] as VehicleDocumentSlot[]) {
    existingDocs[slot] = (initial?.[DOCUMENT_URL_FIELD[slot]] as string | null | undefined) ?? null;
  }
  const documentIssues = initial?.document_issues ?? undefined;
  const hasDocumentIssues = !!documentIssues && Object.keys(documentIssues).length > 0;

  const addDocument = async (slot: VehicleDocumentSlot) => {
    const uri = await chooseVehicleDocument(t);
    if (uri) setStagedDocs((s) => ({ ...s, [slot]: uri }));
  };

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
    if (rcExpiry.trim() && !isValidDay(rcExpiry.trim())) nextErrors.rcExpiry = t('doc_expiry_invalid');
    if (insuranceExpiry.trim() && !isValidDay(insuranceExpiry.trim())) nextErrors.insuranceExpiry = t('doc_expiry_invalid');
    if (fitnessExpiry.trim() && !isValidDay(fitnessExpiry.trim())) nextErrors.fitnessExpiry = t('doc_expiry_invalid');
    if (permitExpiry.trim() && !isValidDay(permitExpiry.trim())) nextErrors.permitExpiry = t('doc_expiry_invalid');
    if (pucExpiry.trim() && !isValidDay(pucExpiry.trim())) nextErrors.pucExpiry = t('doc_expiry_invalid');
    const containerLengthValue = containerLength.trim() ? Number(containerLength) : null;
    if (containerLengthValue !== null && (!Number.isFinite(containerLengthValue) || containerLengthValue < 0 || containerLengthValue > 60)) {
      nextErrors.containerLength = t('vehicle_container_invalid');
    }
    const containerWidthValue = containerWidth.trim() ? Number(containerWidth) : null;
    if (containerWidthValue !== null && (!Number.isFinite(containerWidthValue) || containerWidthValue < 0 || containerWidthValue > 15)) {
      nextErrors.containerWidth = t('vehicle_container_invalid');
    }
    const containerHeightValue = containerHeight.trim() ? Number(containerHeight) : null;
    if (containerHeightValue !== null && (!Number.isFinite(containerHeightValue) || containerHeightValue < 0 || containerHeightValue > 15)) {
      nextErrors.containerHeight = t('vehicle_container_invalid');
    }
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) {
      // The plate and capacity fields are at the top: bring the inline message into view
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    setBusy(true);
    setError('');
    try {
      const vehicle = await api.registerVehicle({
        plate_number: plateValue,
        vehicle_type: kind,
        capacity_kg: capacityValue,
        ...(model.trim() ? { vehicle_model: model.trim() } : {}),
        ...(rc.trim() ? { rc_number: rc.trim().toUpperCase() } : {}),
        ...(rcExpiry.trim() ? { rc_expiry: rcExpiry.trim() } : {}),
        ...(insurance.trim() ? { insurance_number: insurance.trim().toUpperCase() } : {}),
        ...(insuranceExpiry.trim() ? { insurance_expiry: insuranceExpiry.trim() } : {}),
        ...(fitness.trim() ? { fitness_certificate_number: fitness.trim().toUpperCase() } : {}),
        ...(fitnessExpiry.trim() ? { fitness_expiry: fitnessExpiry.trim() } : {}),
        ...(permit.trim() ? { permit_number: permit.trim().toUpperCase() } : {}),
        ...(permitExpiry.trim() ? { permit_expiry: permitExpiry.trim() } : {}),
        ...(puc.trim() ? { puc_number: puc.trim().toUpperCase() } : {}),
        ...(pucExpiry.trim() ? { puc_expiry: pucExpiry.trim() } : {}),
        ...(containerLengthValue !== null ? { container_length_ft: containerLengthValue } : {}),
        ...(containerWidthValue !== null ? { container_width_ft: containerWidthValue } : {}),
        ...(containerHeightValue !== null ? { container_height_ft: containerHeightValue } : {}),
      });
      if (Object.keys(staged).length > 0) {
        const failed = await uploadStagedPhotos(vehicle.id, staged);
        if (failed.length > 0) Alert.alert(t('vehicle_reg_title'), t('vehicle_photo_some_failed'));
      }
      if (Object.keys(stagedDocs).length > 0) {
        const failed = await uploadStagedDocuments(vehicle.id, stagedDocs);
        if (failed.length > 0) Alert.alert(t('vehicle_reg_title'), t('vehicle_document_some_failed'));
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
      <ScreenHeader title={title} onBack={mode !== 'new' ? onCancel : undefined} backLabel={t('cancel')} />
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text variant="bodySmall" color="textMuted">
            {t(mode === 'new' ? 'vehicle_reg_intro' : 'vehicle_reg_intro_fix')}
          </Text>

          <Card style={styles.card}>
            <View style={styles.field}>
              <Text variant="bodySmallMedium">{t('vehicle_type')}</Text>
              <View style={styles.kinds} accessibilityRole="radiogroup">
                {KINDS.map((k) => (
                  <Chip key={k.id} label={t(k.labelKey)} selected={kind === k.id} onPress={() => setKind(k.id)} disabled={busy} />
                ))}
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
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => capacityRef.current?.focus()}
            />
            <TextField
              ref={capacityRef}
              label={t('vehicle_capacity')}
              value={capacity}
              onChangeText={(v) => {
                setCapacity(v.replace(/[^\d]/g, ''));
                if (errors.capacity) setErrors((e) => ({ ...e, capacity: undefined }));
              }}
              error={errors.capacity}
              keyboardType="number-pad"
              maxLength={5}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => modelRef.current?.focus()}
            />
            <TextField
              ref={modelRef}
              label={t('vehicle_model_label')}
              hint={t('vehicle_optional')}
              value={model}
              onChangeText={setModel}
              maxLength={100}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => containerLengthRef.current?.focus()}
            />
            <TextField
              ref={containerLengthRef}
              label={t('vehicle_container_length')}
              hint={t('vehicle_optional')}
              value={containerLength}
              onChangeText={(v) => {
                setContainerLength(v.replace(/[^\d.]/g, ''));
                if (errors.containerLength) setErrors((e) => ({ ...e, containerLength: undefined }));
              }}
              error={errors.containerLength}
              keyboardType="decimal-pad"
              maxLength={5}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => containerWidthRef.current?.focus()}
            />
            <TextField
              ref={containerWidthRef}
              label={t('vehicle_container_width')}
              hint={t('vehicle_optional')}
              value={containerWidth}
              onChangeText={(v) => {
                setContainerWidth(v.replace(/[^\d.]/g, ''));
                if (errors.containerWidth) setErrors((e) => ({ ...e, containerWidth: undefined }));
              }}
              error={errors.containerWidth}
              keyboardType="decimal-pad"
              maxLength={5}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => containerHeightRef.current?.focus()}
            />
            <TextField
              ref={containerHeightRef}
              label={t('vehicle_container_height')}
              hint={t('vehicle_optional')}
              value={containerHeight}
              onChangeText={(v) => {
                setContainerHeight(v.replace(/[^\d.]/g, ''));
                if (errors.containerHeight) setErrors((e) => ({ ...e, containerHeight: undefined }));
              }}
              error={errors.containerHeight}
              keyboardType="decimal-pad"
              maxLength={5}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => rcRef.current?.focus()}
            />
            <TextField
              ref={rcRef}
              label={t('vehicle_rc_number')}
              hint={t('vehicle_optional')}
              value={rc}
              onChangeText={(v) => setRc(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={50}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => rcExpiryRef.current?.focus()}
            />
            <TextField
              ref={rcExpiryRef}
              label={t('vehicle_rc_expiry')}
              hint={t('doc_date_hint')}
              value={rcExpiry}
              onChangeText={(v) => {
                setRcExpiry(v);
                if (errors.rcExpiry) setErrors((e) => ({ ...e, rcExpiry: undefined }));
              }}
              error={errors.rcExpiry}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => insuranceRef.current?.focus()}
            />
            <TextField
              ref={insuranceRef}
              label={t('vehicle_insurance_number')}
              hint={t('vehicle_optional')}
              value={insurance}
              onChangeText={(v) => setInsurance(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={50}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => insuranceExpiryRef.current?.focus()}
            />
            <TextField
              ref={insuranceExpiryRef}
              label={t('vehicle_insurance_expiry')}
              hint={t('doc_date_hint')}
              value={insuranceExpiry}
              onChangeText={(v) => {
                setInsuranceExpiry(v);
                if (errors.insuranceExpiry) setErrors((e) => ({ ...e, insuranceExpiry: undefined }));
              }}
              error={errors.insuranceExpiry}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => fitnessRef.current?.focus()}
            />
            <TextField
              ref={fitnessRef}
              label={t('vehicle_fitness_number')}
              hint={t('vehicle_optional')}
              value={fitness}
              onChangeText={(v) => setFitness(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={50}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => fitnessExpiryRef.current?.focus()}
            />
            <TextField
              ref={fitnessExpiryRef}
              label={t('vehicle_fitness_expiry')}
              hint={t('doc_date_hint')}
              value={fitnessExpiry}
              onChangeText={(v) => {
                setFitnessExpiry(v);
                if (errors.fitnessExpiry) setErrors((e) => ({ ...e, fitnessExpiry: undefined }));
              }}
              error={errors.fitnessExpiry}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => permitRef.current?.focus()}
            />
            <TextField
              ref={permitRef}
              label={t('vehicle_permit_number')}
              hint={t('vehicle_optional')}
              value={permit}
              onChangeText={(v) => setPermit(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={50}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => permitExpiryRef.current?.focus()}
            />
            <TextField
              ref={permitExpiryRef}
              label={t('vehicle_permit_expiry')}
              hint={t('doc_date_hint')}
              value={permitExpiry}
              onChangeText={(v) => {
                setPermitExpiry(v);
                if (errors.permitExpiry) setErrors((e) => ({ ...e, permitExpiry: undefined }));
              }}
              error={errors.permitExpiry}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => pucRef.current?.focus()}
            />
            <TextField
              ref={pucRef}
              label={t('vehicle_puc_number')}
              hint={t('vehicle_optional')}
              value={puc}
              onChangeText={(v) => setPuc(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={50}
              editable={!busy}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => pucExpiryRef.current?.focus()}
            />
            <TextField
              ref={pucExpiryRef}
              label={t('vehicle_puc_expiry')}
              hint={t('doc_date_hint')}
              value={pucExpiry}
              onChangeText={(v) => {
                setPucExpiry(v);
                if (errors.pucExpiry) setErrors((e) => ({ ...e, pucExpiry: undefined }));
              }}
              error={errors.pucExpiry}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={submit}
            />
          </Card>

          {hasDocumentIssues ? (
            <ErrorBanner message={t('vehicle_document_issue_banner')} />
          ) : null}

          <Card style={styles.card}>
            <View style={styles.field}>
              <Text variant="title" accessibilityRole="header">
                {t('vehicle_documents_title')}
              </Text>
              <Text variant="bodySmall" color="textMuted">
                {t('vehicle_documents_hint')}
              </Text>
            </View>
            <DocumentSlots items={{ ...existingDocs, ...stagedDocs }} issues={documentIssues} onAdd={addDocument} />
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
  scroll: { padding: space[4], paddingBottom: space[8], gap: space[4] },
  card: { gap: space[4] },
  field: { gap: space[1] },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  actions: { gap: space[2] },
});
