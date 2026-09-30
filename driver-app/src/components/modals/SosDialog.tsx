import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { SosCancelState, SosDetailsState, SosState } from '../../hooks/useSos';
import type { SosSeverity, SosType } from '../../services/api';
import { Banner, Button, Chip, Text, TextField } from '../ui';
import { colors, size, space } from '../../theme';

interface SosDialogProps {
  state: SosState;
  details: SosDetailsState;
  cancelState: SosCancelState;
  onRetry: () => void;
  onSendDetails: (type: SosType, description: string, severity?: SosSeverity) => void;
  onCancel: () => void;
  onClose: () => void;
  /** Opens the cargo-on-board check; offered after an accident or breakdown when the vehicle carries cargo. */
  onCheckCargo?: () => void;
}

const DETAIL_TYPES: { type: SosType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: 'accident', label: 'sos_type_accident', icon: 'car-outline' },
  { type: 'breakdown', label: 'sos_type_breakdown', icon: 'construct-outline' },
  { type: 'medical', label: 'sos_type_medical', icon: 'medkit-outline' },
  { type: 'theft', label: 'sos_type_theft', icon: 'lock-open-outline' },
  { type: 'other', label: 'sos_type_other', icon: 'ellipsis-horizontal' },
];

/** Shows the SOS as it is sent, then lets the driver say what happened. */
export default function SosDialog({ state, details, cancelState, onRetry, onSendDetails, onCancel, onClose, onCheckCargo }: SosDialogProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<SosType | null>(null);
  const [description, setDescription] = useState('');
  const [injured, setInjured] = useState<boolean | null>(null);

  if (state.phase === 'sending') {
    return (
      <View style={styles.center} accessibilityLiveRegion="assertive">
        <ActivityIndicator size="large" color={colors.danger} />
        <Text variant="heading" color="danger" align="center" accessibilityRole="header">
          {t('sos_sending_title')}
        </Text>
        <Text variant="bodySmall" color="textMuted" align="center">
          {t('sos_sending_desc')}
        </Text>
      </View>
    );
  }

  if (state.phase === 'cancelled') {
    return (
      <>
        <View style={styles.header} accessibilityLiveRegion="assertive">
          <Ionicons name="checkmark-circle" size={size.icon.xl} color={colors.success} />
          <Text variant="heading" accessibilityRole="header">
            {t('sos_cancelled_title')}
          </Text>
          <Text variant="body">{t('sos_cancelled_desc')}</Text>
        </View>
        <Button title={t('close')} variant="secondary" onPress={onClose} />
      </>
    );
  }

  if (state.phase === 'failed') {
    const message =
      state.reason === 'no_vehicle' ? t('sos_no_vehicle') : state.reason === 'offline' ? t('sos_offline') : t('sos_error');
    return (
      <>
        <View style={styles.header} accessibilityLiveRegion="assertive">
          <Ionicons name="close-circle" size={size.icon.xl} color={colors.danger} />
          <Text variant="heading" color="danger" accessibilityRole="header">
            {t('sos_failed')}
          </Text>
          <Text variant="body">{message}</Text>
        </View>
        {state.reason !== 'no_vehicle' ? (
          <Button
            title={t('retry')}
            variant="danger"
            onPress={onRetry}
            icon={(color) => <Ionicons name="refresh" size={size.icon.md} color={color} />}
          />
        ) : null}
        <Button title={t('close')} variant="secondary" onPress={onClose} />
      </>
    );
  }

  return (
    <>
      <View style={styles.header} accessibilityLiveRegion="assertive">
        <Ionicons name="checkmark-circle" size={size.icon.xl} color={colors.success} />
        <Text variant="heading" accessibilityRole="header">
          {t('sos_sent_title')}
        </Text>
        <Text variant="body">{state.withLocation ? t('sos_sent_desc') : t('sos_sent_no_location')}</Text>
      </View>

      {details === 'sent' || details === 'queued' ? (
        <>
          <Banner tone="info" message={details === 'queued' ? t('sos_details_queued') : t('sos_details_sent')} />
          {onCheckCargo && (type === 'accident' || type === 'breakdown') ? (
            <View style={styles.injured}>
              <Text variant="bodyMedium">{t('cargo_sos_check_prompt')}</Text>
              <Button
                title={t('cargo_check_title')}
                onPress={onCheckCargo}
                icon={(color) => <Ionicons name="cube-outline" size={size.icon.md} color={color} />}
              />
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text variant="bodyMedium">{t('sos_what_happened')}</Text>
          <View style={styles.types} accessibilityRole="radiogroup">
            {DETAIL_TYPES.map((item) => (
              <Chip
                key={item.type}
                tone="danger"
                label={t(item.label)}
                selected={type === item.type}
                onPress={() => setType(item.type)}
                icon={(color) => <Ionicons name={item.icon} size={size.icon.sm} color={color} />}
              />
            ))}
          </View>
          {type === 'accident' ? (
            <View style={styles.injured}>
              <Text variant="bodyMedium">{t('sos_injured_q')}</Text>
              <View style={styles.types} accessibilityRole="radiogroup">
                {[
                  { value: true, label: t('yes') },
                  { value: false, label: t('no') },
                ].map((option) => (
                  <Chip key={String(option.value)} tone="danger" label={option.label} selected={injured === option.value} onPress={() => setInjured(option.value)} />
                ))}
              </View>
            </View>
          ) : null}
          <TextField
            label={t('sos_details_label')}
            placeholder={t('sos_details')}
            multiline
            value={description}
            onChangeText={setDescription}
            maxLength={500}
          />
          {details === 'failed' ? <Banner tone="danger" message={t('sos_details_failed')} /> : null}
          <Button
            title={t('sos_send_details')}
            variant="secondary"
            disabled={!type}
            loading={details === 'sending'}
            onPress={() =>
              type &&
              onSendDetails(type, description, type === 'accident' && injured !== null ? (injured ? 'serious' : 'minor') : undefined)
            }
          />
        </>
      )}

      <View style={styles.cancel}>
        <Text variant="bodySmall" color="textMuted">
          {t('sos_cancel_hint')}
        </Text>
        {cancelState === 'failed' ? <Banner tone="danger" message={t('sos_cancel_failed')} /> : null}
        <Button title={t('sos_cancel')} variant="secondary" loading={cancelState === 'sending'} onPress={onCancel} />
      </View>

      <Button title={t('close')} variant="ghost" onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: space[3], paddingVertical: space[4] },
  header: { gap: space[2] },
  injured: { gap: space[2] },
  // Set apart from the details form above, so cancelling an SOS is never a stray tap on "send details"
  cancel: { gap: space[2], paddingTop: space[4], borderTopWidth: size.border, borderTopColor: colors.border },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
