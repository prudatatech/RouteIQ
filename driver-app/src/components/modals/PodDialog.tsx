import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { StopCheck } from '../../hooks/useParcelScan';
import ParcelScanner, { type ScanMethod } from '../scan/ParcelScanner';
import { Banner, Button, Text, TextField } from '../ui';
import { colors, size, space } from '../../theme';

interface PodDialogProps {
  stopName?: string | null;
  /** The code on this stop's parcel. Without one there is nothing to scan. */
  parcelCode?: string | null;
  /** The parcel was already scanned at this stop. */
  parcelVerified?: boolean;
  /** Checks a scanned or typed code against this stop's parcel. */
  onScanCode?: (code: string, method: ScanMethod) => StopCheck;
  /** Resolves when the stop is saved; throws with a message on failure. */
  onSubmit: (receiverName: string) => Promise<void>;
  onCancel: () => void;
}

/** Proof of delivery: the name of the person who received the goods. */
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
      await onSubmit(receiverName.trim());
    } catch (e: any) {
      setError(e?.message || t('complete_stop_failed'));
    } finally {
      setSaving(false);
    }
  };

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
        autoFocus
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
  verified: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  actions: { flexDirection: 'row', gap: space[3] },
  action: { flex: 1 },
});
