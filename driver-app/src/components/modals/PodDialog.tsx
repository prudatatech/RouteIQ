import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { Button, Text, TextField } from '../ui';
import { space } from '../../theme';

interface PodDialogProps {
  stopName?: string | null;
  /** Resolves when the stop is saved; throws with a message on failure. */
  onSubmit: (receiverName: string) => Promise<void>;
  onCancel: () => void;
}

/** Proof of delivery: the name of the person who received the goods. */
export default function PodDialog({ stopName, onSubmit, onCancel }: PodDialogProps) {
  const { t } = useTranslation();
  const [receiverName, setReceiverName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
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
  actions: { flexDirection: 'row', gap: space[3] },
  action: { flex: 1 },
});
