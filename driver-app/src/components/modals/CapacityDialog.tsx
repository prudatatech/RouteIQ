import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { errorMessage } from '../../utils/errors';
import { Button, Text } from '../ui';
import { space } from '../../theme';
import { formatNumber } from '../../utils/format';

interface CapacityDialogProps {
  vehicle: { vehicle_type?: string | null; capacity_kg?: number | null } | null;
  onDeclare: (percentage: number) => Promise<void>;
  onCancel: () => void;
}

const LEVELS = [0, 25, 50, 75, 100];

/** Driver declares how full the vehicle is, so free space can be offered. */
export default function CapacityDialog({ vehicle, onDeclare, onCancel }: CapacityDialogProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState<number | null>(null);

  const declare = async (pct: number) => {
    setSaving(pct);
    try {
      await onDeclare(pct);
    } catch (e) {
      Alert.alert(t('error'), errorMessage(e, t('declare_load_failed')));
    } finally {
      setSaving(null);
    }
  };

  const capacity = vehicle?.capacity_kg ?? null;
  const label = (pct: number) => {
    const base = pct === 0 ? t('load_empty') : pct === 100 ? t('load_full') : `${pct}% ${t('load_full_suffix')}`;
    return capacity ? `${base} (${formatNumber(Math.round((pct / 100) * capacity))} kg)` : base;
  };

  return (
    <>
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header">
          {t('declare_load_title')}
        </Text>
        {vehicle?.vehicle_type ? (
          <Text variant="bodySmall" color="textMuted">
            {`${t('vehicle_type')}: ${vehicle.vehicle_type}`}
          </Text>
        ) : null}
        {capacity ? (
          <Text variant="bodySmall" color="textMuted">
            {`${t('max_capacity')}: ${formatNumber(capacity)} kg`}
          </Text>
        ) : null}
        <Text variant="bodySmall" color="textMuted">
          {t('declare_load_question')}
        </Text>
      </View>

      <View style={styles.levels}>
        {LEVELS.map((pct) => (
          <Button
            key={pct}
            title={label(pct)}
            variant="secondary"
            loading={saving === pct}
            disabled={saving !== null}
            onPress={() => declare(pct)}
          />
        ))}
      </View>

      <Button title={t('cancel')} variant="ghost" onPress={onCancel} disabled={saving !== null} />
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[1] },
  levels: { gap: space[2] },
});
