import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from '../../hooks/useTranslation';
import type { StopCheck } from '../../hooks/useParcelScan';
import { compressPhoto, type PodInput } from '../../services/podUpload';
import ParcelScanner, { type ScanMethod } from '../scan/ParcelScanner';
import SignaturePad from './SignaturePad';
import { Banner, Button, Text, TextField } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface PodDialogProps {
  stopName?: string | null;
  /** The code on this stop's parcel. Without one there is nothing to scan. */
  parcelCode?: string | null;
  /** The parcel was already scanned at this stop. */
  parcelVerified?: boolean;
  /** Checks a scanned or typed code against this stop's parcel. */
  onScanCode?: (code: string, method: ScanMethod) => StopCheck;
  /**
   * Resolves when the stop is saved (or queued to send later); throws with a
   * message on failure. The photo and signature are local files.
   */
  onSubmit: (pod: PodInput) => Promise<void>;
  onCancel: () => void;
}

/** Proof of delivery: parcel check, delivery photo, receiver's signature and name. */
export default function PodDialog({ stopName, parcelCode, parcelVerified = false, onScanCode, onSubmit, onCancel }: PodDialogProps) {
  const { t } = useTranslation();
  const [receiverName, setReceiverName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [verified, setVerified] = useState(parcelVerified);
  const [skipScan, setSkipScan] = useState(false);
  const needsScan = !!parcelCode && !!onScanCode;
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [signatureUri, setSignatureUri] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');

  const takePhoto = async () => {
    setPhotoError('');
    setPhotoBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPhotoError(t('pod_photo_denied'));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: false });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setPhotoUri(await compressPhoto(result.assets[0].uri));
    } catch {
      setPhotoError(t('pod_photo_failed'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const onCode = (code: string, method: ScanMethod) => {
    if (!onScanCode) return;
    if (onScanCode(code, method) === 'ok') {
      setVerified(true);
      setScanning(false);
      setScanError('');
    } else {
      setScanError(t('pod_parcel_wrong'));
    }
  };

  const submit = async () => {
    if (needsScan && !verified && !skipScan) {
      setError(t('pod_parcel_required'));
      return;
    }
    if (receiverName.trim().length < 3) {
      setError(t('alert_valid_receiver'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({ receiverName: receiverName.trim(), photoUri, signatureUri });
    } catch (e: any) {
      setError(e?.message || t('complete_stop_failed'));
    } finally {
      setSaving(false);
    }
  };

  if (signing) {
    return (
      <SignaturePad
        onDone={(uri) => {
          setSignatureUri(uri);
          setSigning(false);
        }}
        onCancel={() => setSigning(false)}
      />
    );
  }

  return (
    <>
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header">
          {t('pod_title')}
        </Text>
        {stopName ? (
          <Text variant="bodySmallMedium" color="textMuted">
            {stopName}
          </Text>
        ) : null}
        <Text variant="bodySmall" color="textMuted">
          {t('pod_receiver_desc')}
        </Text>
      </View>

      {needsScan ? (
        <View style={styles.parcel}>
          <Text variant="bodySmallMedium">{t('pod_parcel_title')}</Text>
          {verified ? (
            <View style={styles.verified}>
              <Ionicons name="checkmark-circle" size={size.icon.md} color={colors.success} />
              <Text variant="bodySmall" color="success">
                {`${t('pod_parcel_verified')} · ${parcelCode}`}
              </Text>
            </View>
          ) : scanning ? (
            <>
              <ParcelScanner onCode={onCode} height={220} />
              {scanError ? <Banner tone="danger" message={scanError} icon="close-circle" /> : null}
              <Button title={t('cancel')} variant="ghost" onPress={() => setScanning(false)} />
            </>
          ) : (
            <>
              <Button
                title={t('pod_parcel_scan')}
                variant="secondary"
                onPress={() => {
                  setScanError('');
                  setScanning(true);
                }}
                icon={(color) => <Ionicons name="qr-code-outline" size={size.icon.md} color={color} />}
              />
              <Button
                title={skipScan ? t('pod_parcel_skipped') : t('pod_parcel_skip')}
                variant="ghost"
                disabled={skipScan}
                onPress={() => {
                  setSkipScan(true);
                  setError('');
                }}
              />
            </>
          )}
        </View>
      ) : null}

      <View style={styles.parcel}>
        <Text variant="bodySmallMedium">{t('pod_photo_title')}</Text>
        {photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} accessibilityLabel={t('pod_photo_title')} /> : null}
        <Button
          title={photoUri ? t('pod_photo_retake') : t('pod_photo_take')}
          variant="secondary"
          onPress={takePhoto}
          loading={photoBusy}
          disabled={saving}
          icon={(color) => <Ionicons name="camera-outline" size={size.icon.md} color={color} />}
        />
        {photoError ? (
          <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
            {photoError}
          </Text>
        ) : null}
      </View>

      <View style={styles.parcel}>
        <Text variant="bodySmallMedium">{t('pod_signature_title')}</Text>
        {signatureUri ? <Image source={{ uri: signatureUri }} style={styles.signature} resizeMode="contain" accessibilityLabel={t('pod_signature_title')} /> : null}
        <Button
          title={signatureUri ? t('pod_signature_redo') : t('pod_signature_take')}
          variant="secondary"
          onPress={() => setSigning(true)}
          disabled={saving}
          icon={(color) => <Ionicons name="create-outline" size={size.icon.md} color={color} />}
        />
      </View>

      <TextField
        label={t('pod_receiver_label')}
        placeholder={t('pod_receiver_placeholder')}
        value={receiverName}
        onChangeText={(v) => {
          setReceiverName(v);
          if (error) setError('');
        }}
        error={error || undefined}
        maxLength={100}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={submit}
      />

      <View style={styles.actions}>
        <Button title={t('cancel')} variant="secondary" block={false} style={styles.action} onPress={onCancel} disabled={saving} />
        <Button title={t('complete_stop')} block={false} style={styles.action} onPress={submit} loading={saving} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[1] },
  parcel: { gap: space[2] },
  photo: { width: '100%', height: 160, borderRadius: radius.card, backgroundColor: colors.surfaceSubtle },
  signature: { width: '100%', height: 96, borderRadius: radius.card, borderWidth: size.border, borderColor: colors.border, backgroundColor: colors.surface },
  verified: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  actions: { flexDirection: 'row', gap: space[3] },
  action: { flex: 1 },
});
