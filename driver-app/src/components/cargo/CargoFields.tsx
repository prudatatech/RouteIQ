/**
 * Form pieces shared by the cargo screens: a piece counter, the condition
 * chips, the photo strip, the signature block and the "dispatch will be told"
 * note.
 */
import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from '../../hooks/useTranslation';
import { compressPhoto } from '../../services/podUpload';
import { CONDITIONS, type ConditionCode } from '../../services/cargo';
import { Banner, Button, Chip, IconButton, Text } from '../ui';
import { colors, radius, size, space, type } from '../../theme';

// ── Piece counter ──────────────────────────────────────────────

interface PieceCounterProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  error?: string;
  /** Upper bound for the + button. */
  max?: number;
}

/** A whole number of pieces, typed or stepped with − and +. Empty is null. */
export function PieceCounter({ label, value, onChange, hint, error, max }: PieceCounterProps) {
  const { t } = useTranslation();
  const step = (delta: number) => {
    const next = Math.max(0, (value ?? 0) + delta);
    onChange(max !== undefined ? Math.min(max, next) : next);
  };
  return (
    <View style={styles.field}>
      <Text variant="bodySmallMedium">{label}</Text>
      <View style={styles.counter}>
        <IconButton
          accessibilityLabel={`${label}: ${t('cargo_less')}`}
          onPress={() => step(-1)}
          disabled={!value}
          variant="secondary"
          icon={(color) => <Ionicons name="remove" size={size.icon.lg} color={color} />}
        />
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          value={value === null ? '' : String(value)}
          onChangeText={(text) => {
            const digits = text.replace(/[^0-9]/g, '');
            onChange(digits ? Number(digits) : null);
          }}
          keyboardType="number-pad"
          maxLength={5}
          style={[styles.counterInput, error ? styles.inputError : null]}
          placeholderTextColor={colors.textPlaceholder}
        />
        <IconButton
          accessibilityLabel={`${label}: ${t('cargo_more')}`}
          onPress={() => step(1)}
          disabled={max !== undefined && (value ?? 0) >= max}
          variant="secondary"
          icon={(color) => <Ionicons name="add" size={size.icon.lg} color={color} />}
        />
      </View>
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

// ── Condition ──────────────────────────────────────────────────

interface ConditionPickerProps {
  value: ConditionCode;
  onChange: (value: ConditionCode) => void;
  /** Codes to offer; all by default. */
  options?: readonly ConditionCode[];
  label?: string;
}

export function ConditionPicker({ value, onChange, options = CONDITIONS, label }: ConditionPickerProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.field}>
      <Text variant="bodySmallMedium">{label ?? t('cargo_condition')}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label ?? t('cargo_condition')}>
        {options.map((code) => (
          <Chip
            key={code}
            label={t(`cargo_condition_${code}`)}
            selected={value === code}
            tone={code === 'good' ? 'accent' : 'danger'}
            onPress={() => onChange(code)}
          />
        ))}
      </View>
    </View>
  );
}

// ── Photos ─────────────────────────────────────────────────────

interface PhotoStripProps {
  label: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  max?: number;
  hint?: string;
  error?: string;
  disabled?: boolean;
}

/** Up to `max` camera photos (compressed), each removable. */
export function PhotoStrip({ label, photos, onChange, max = 3, hint, error, disabled }: PhotoStripProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const take = async () => {
    setCameraError('');
    setBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setCameraError(t('pod_photo_denied'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: false });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      onChange([...photos, await compressPhoto(result.assets[0].uri)].slice(0, max));
    } catch {
      setCameraError(t('pod_photo_failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.field}>
      <Text variant="bodySmallMedium">{label}</Text>
      {photos.length ? (
        <View style={styles.photos}>
          {photos.map((uri, index) => (
            <View key={uri} style={styles.photoWrap}>
              <Image source={{ uri }} style={styles.photo} accessibilityLabel={`${label} ${index + 1}`} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('cargo_photo_remove')} ${index + 1}`}
                onPress={() => onChange(photos.filter((p) => p !== uri))}
                hitSlop={8}
                style={styles.photoRemove}
                disabled={disabled}
              >
                <Ionicons name="close" size={size.icon.sm} color={colors.onSolid} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {photos.length < max ? (
        <Button
          title={photos.length ? t('cargo_photo_add_another') : t('pod_photo_take')}
          variant="secondary"
          onPress={take}
          loading={busy}
          disabled={disabled}
          icon={(color) => <Ionicons name="camera-outline" size={size.icon.md} color={color} />}
        />
      ) : null}
      {cameraError || error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {cameraError || error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

// ── Signature ──────────────────────────────────────────────────

interface SignatureBlockProps {
  label: string;
  uri: string | null;
  onSign: () => void;
  error?: string;
  disabled?: boolean;
}

/** Shows the captured signature and opens the pad (the screen swaps to SignaturePad). */
export function SignatureBlock({ label, uri, onSign, error, disabled }: SignatureBlockProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.field}>
      <Text variant="bodySmallMedium">{label}</Text>
      {uri ? <Image source={{ uri }} style={styles.signature} resizeMode="contain" accessibilityLabel={label} /> : null}
      <Button
        title={uri ? t('pod_signature_redo') : t('pod_signature_take')}
        variant="secondary"
        onPress={onSign}
        disabled={disabled}
        icon={(color) => <Ionicons name="create-outline" size={size.icon.md} color={color} />}
      />
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// ── Notes ──────────────────────────────────────────────────────

/** A short warning that the server will open a case for dispatch, with what it is about. */
export function DispatchNote({ reasons }: { reasons: string[] }) {
  const { t } = useTranslation();
  if (reasons.length === 0) return null;
  return <Banner tone="warning" icon="megaphone-outline" message={`${t('cargo_dispatch_told')} ${reasons.join(' · ')}`} />;
}

/** Yes / no choice as two chips. */
export function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.field}>
      <Text variant="bodySmallMedium">{label}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <Chip label={t('yes')} selected={value === true} onPress={() => onChange(true)} />
        <Chip label={t('no')} selected={value === false} tone="danger" onPress={() => onChange(false)} />
      </View>
    </View>
  );
}

const PHOTO = 88;

const styles = StyleSheet.create({
  field: { gap: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  counter: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  counterInput: {
    ...type.bodyMedium,
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    minHeight: size.control,
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  photoWrap: { width: PHOTO, height: PHOTO },
  photo: { width: PHOTO, height: PHOTO, borderRadius: radius.control, backgroundColor: colors.surfaceSubtle },
  photoRemove: {
    position: 'absolute',
    top: space[1],
    right: space[1],
    width: size.icon.lg,
    height: size.icon.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  signature: { width: '100%', height: 96, borderRadius: radius.card, borderWidth: size.border, borderColor: colors.border, backgroundColor: colors.surface },
});
