import React, { useState } from 'react';
import { DeviceEventEmitter, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Banner, Button, Card, ErrorBanner, IconButton, ScreenHeader, Text, TextField } from '../components/ui';
import { colors, radius, size, space } from '../theme';
import { api, CLAIM_CREATED_EVENT, newIdempotencyKey, type Claim, type ClaimType } from '../services/api';
import { uploadClaimPhoto, type ClaimPhoto } from '../services/claimUpload';
import { CLAIM_TYPES, CLAIM_WINDOW_DAYS } from '../utils/cargo';
import { useTranslation } from '../hooks/useTranslation';

const MAX_PHOTOS = 5;
/** Enough for the surveyor to see the damage, small enough to upload on a weak signal. */
const PHOTO_QUALITY = 0.6;

/** Rupees with up to two decimals; commas are allowed because people type them. */
function parseAmount(text: string): number | null {
  const clean = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const n = Number(clean);
  return n > 0 ? n : null;
}

const toPhoto = (asset: ImagePicker.ImagePickerAsset, index: number): ClaimPhoto => {
  const mimeType = asset.mimeType ?? 'image/jpeg';
  return {
    uri: asset.uri,
    mimeType,
    fileName: asset.fileName ?? `claim-photo-${Date.now()}-${index}.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
  };
};

export default function ClaimScreen({ navigation, route }: any) {
  const { t } = useTranslation();
  const { shipmentId } = route.params as { bookingId: string; shipmentId: string; trackingId: string | null };

  const [claimType, setClaimType] = useState<ClaimType | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<ClaimPhoto[]>([]);
  const [fieldErrors, setFieldErrors] = useState<{ type?: string; amount?: string; notes?: string }>({});
  const [pickError, setPickError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Once the claim exists, a retry only re-sends the photos that failed.
  const [filed, setFiled] = useState<{ claim: Claim; failed: ClaimPhoto[] } | null>(null);
  // One key per form, so a resend after a lost reply creates only one claim.
  const [idempotencyKey] = useState(newIdempotencyKey);

  const room = MAX_PHOTOS - photos.length;

  const addFromLibrary = async () => {
    setPickError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: room,
        quality: PHOTO_QUALITY,
      });
      if (!result.canceled) setPhotos((prev) => [...prev, ...result.assets.map(toPhoto)].slice(0, MAX_PHOTOS));
    } catch {
      setPickError(t('claim_pick_failed'));
    }
  };

  const takePhoto = async () => {
    setPickError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPickError(t('claim_camera_denied'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: PHOTO_QUALITY });
      if (!result.canceled) setPhotos((prev) => [...prev, ...result.assets.map(toPhoto)].slice(0, MAX_PHOTOS));
    } catch {
      setPickError(t('claim_pick_failed'));
    }
  };

  /** Uploads each photo and returns the ones that did not make it. */
  const uploadAll = async (claimId: string, list: ClaimPhoto[]) => {
    const failed: ClaimPhoto[] = [];
    for (const photo of list) {
      try {
        await uploadClaimPhoto(claimId, photo);
      } catch {
        failed.push(photo);
      }
    }
    return failed;
  };

  const submit = async () => {
    const claimedAmount = parseAmount(amount);
    const errors = {
      type: claimType ? undefined : t('claim_type_required'),
      amount: claimedAmount ? undefined : t('claim_amount_invalid'),
      notes: notes.trim() ? undefined : t('claim_notes_required'),
    };
    setFieldErrors(errors);
    if (!claimType || !claimedAmount || errors.notes) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const claim = await api.createClaim(
        { ref: { shipment_id: shipmentId }, claim_type: claimType, claimed_amount: claimedAmount, notes: notes.trim() },
        idempotencyKey,
      );
      DeviceEventEmitter.emit(CLAIM_CREATED_EVENT);
      const failed = await uploadAll(claim.id, photos);
      setFiled({ claim, failed });
    } catch (e: any) {
      setSubmitError(e?.message || t('claim_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const retryPhotos = async () => {
    if (!filed) return;
    setSubmitting(true);
    const failed = await uploadAll(filed.claim.id, filed.failed);
    setFiled({ claim: filed.claim, failed });
    setSubmitting(false);
  };

  if (filed) {
    const code = filed.claim.code ?? '';
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <ScreenHeader title={t('claim_title')} onBack={() => navigation.goBack()} backLabel={t('back')} />
        <ScrollView contentContainerStyle={styles.content}>
          <Banner tone="info" icon="check-circle" message={code ? t('claim_filed_code', { code }) : t('claim_filed')} />
          {filed.failed.length > 0 ? (
            <>
              <Banner tone="warning" icon="alert-triangle" message={t('claim_photos_failed', { n: filed.failed.length })} />
              <Button title={t('claim_retry_photos')} variant="secondary" loading={submitting} onPress={retryPhotos} />
            </>
          ) : null}
          <Button title={t('claim_back_to_booking')} onPress={() => navigation.goBack()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title={t('claim_title')} onBack={() => navigation.goBack()} backLabel={t('back')} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="bodySmall" color="textMuted">
            {t('claim_intro', { days: CLAIM_WINDOW_DAYS })}
          </Text>

          <Card style={styles.card}>
            <Text variant="bodySmallMedium" nativeID="claim-type-label">
              {t('claim_what_happened')}
            </Text>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabelledBy="claim-type-label">
              {CLAIM_TYPES.map((type) => {
                const selected = claimType === type;
                return (
                  <Pressable
                    key={type}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={t(`claim_type_${type}`)}
                    onPress={() => setClaimType(type)}
                    style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
                  >
                    <Text variant="bodySmallMedium" color={selected ? 'accent' : 'text'}>
                      {t(`claim_type_${type}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {fieldErrors.type ? (
              <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
                {fieldErrors.type}
              </Text>
            ) : null}

            <TextField
              label={t('claim_amount')}
              hint={t('claim_amount_hint')}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="₹"
              error={fieldErrors.amount}
            />
            <TextField
              label={t('claim_notes')}
              hint={t('claim_notes_hint')}
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={2000}
              error={fieldErrors.notes}
            />
          </Card>

          <Card style={styles.card}>
            <Text variant="bodySmallMedium">{t('claim_photos', { n: photos.length, max: MAX_PHOTOS })}</Text>
            <Text variant="caption" color="textMuted">
              {t('claim_photos_hint')}
            </Text>
            {photos.length > 0 ? (
              <View style={styles.photos}>
                {photos.map((photo, index) => (
                  <View key={photo.uri} style={styles.photo}>
                    <Image
                      source={{ uri: photo.uri }}
                      style={styles.photoImage}
                      accessible
                      accessibilityRole="image"
                      accessibilityLabel={t('claim_photo_n', { n: index + 1 })}
                    />
                    <IconButton
                      variant="secondary"
                      style={styles.remove}
                      accessibilityLabel={t('claim_remove_photo', { n: index + 1 })}
                      onPress={() => setPhotos((prev) => prev.filter((p) => p.uri !== photo.uri))}
                      icon={(color) => <Feather name="x" size={size.icon.md} color={color} />}
                    />
                  </View>
                ))}
              </View>
            ) : null}
            {pickError ? <ErrorBanner message={pickError} /> : null}
            {room > 0 ? (
              <View style={styles.pickRow}>
                <Button
                  title={t('claim_take_photo')}
                  variant="secondary"
                  icon={(color) => <Feather name="camera" size={size.icon.md} color={color} />}
                  onPress={takePhoto}
                />
                <Button
                  title={t('claim_choose_photos')}
                  variant="secondary"
                  icon={(color) => <Feather name="image" size={size.icon.md} color={color} />}
                  onPress={addFromLibrary}
                />
              </View>
            ) : null}
          </Card>

          {submitError ? <ErrorBanner message={submitError} /> : null}
          <Button title={t('claim_submit')} loading={submitting} onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const THUMB = 96;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: space[4], gap: space[4], paddingBottom: space[8] },
  card: { gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.7 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  photo: { width: THUMB, height: THUMB },
  photoImage: { width: THUMB, height: THUMB, borderRadius: radius.control, backgroundColor: colors.surfaceSubtle },
  remove: { position: 'absolute', top: -space[2], right: -space[2] },
  pickRow: { gap: space[2] },
});
