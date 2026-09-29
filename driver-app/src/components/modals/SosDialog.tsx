import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { Button, Text, TextField } from '../ui';
import { space } from '../../theme';

interface SosDialogProps {
  onSend: (type: string, description: string) => Promise<void>;
  onCancel: () => void;
}

const TYPES: { type: string; label: string; variant: 'danger' | 'secondary' }[] = [
  { type: 'accident_serious', label: 'sos_acc_serious', variant: 'danger' },
  { type: 'accident_non_serious', label: 'sos_acc_minor', variant: 'danger' },
  { type: 'vehicle_damage', label: 'sos_veh_damage', variant: 'secondary' },
];

/** Emergency report to the fleet manager. */
export default function SosDialog({ onSend, onCancel }: SosDialogProps) {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState<string | null>(null);

  const send = async (type: string) => {
    setSending(type);
    try {
      await onSend(type, description);
    } finally {
      setSending(null);
    }
  };

  return (
    <>
      <View style={styles.header}>
        <Text variant="heading" color="danger" accessibilityRole="header">
          {t('sos_title')}
        </Text>
        <Text variant="bodySmall" color="textMuted">
          {t('sos_desc')}
        </Text>
      </View>

      <View style={styles.types}>
        {TYPES.map((item) => (
          <Button
            key={item.type}
            title={t(item.label)}
            variant={item.variant}
            loading={sending === item.type}
            disabled={sending !== null}
            onPress={() => send(item.type)}
          />
        ))}
      </View>

      <TextField
        label={t('sos_details_label')}
        placeholder={t('sos_details')}
        multiline
        value={description}
        onChangeText={setDescription}
        maxLength={500}
      />

      <Button title={t('cancel')} variant="ghost" onPress={onCancel} disabled={sending !== null} />
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[1] },
  types: { gap: space[2] },
});
