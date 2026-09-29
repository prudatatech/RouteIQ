import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface IncomingCallDialogProps {
  caller: string;
  /** The number the driver will ring back; shown when known. */
  phone?: string | null;
  onDecline: () => void;
  onAnswer: () => void;
}

const CALL_BUTTON = 64;

/** Dispatch is calling the driver. */
export default function IncomingCallDialog({ caller, phone, onDecline, onAnswer }: IncomingCallDialogProps) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.header}>
        <View style={styles.iconCircle}>
          <Ionicons name="headset" size={size.icon.xl} color={colors.accent} />
        </View>
        <Text variant="heading" align="center" accessibilityRole="header">
          {t('incoming_call')}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {`${caller} ${t('is_calling')}`}
        </Text>
        {phone ? (
          <Text variant="monoMedium" color="textMuted" align="center">
            {phone}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <View style={styles.action}>
          <Pressable
            style={({ pressed }) => [styles.callButton, styles.decline, pressed && styles.pressed]}
            onPress={onDecline}
            accessibilityRole="button"
            accessibilityLabel={t('decline')}
          >
            <Ionicons name="call" size={size.icon.lg} color={colors.onSolid} style={styles.hangUp} />
          </Pressable>
          <Text variant="caption" color="textMuted">
            {t('decline')}
          </Text>
        </View>
        <View style={styles.action}>
          <Pressable
            style={({ pressed }) => [styles.callButton, styles.answer, pressed && styles.pressed]}
            onPress={onAnswer}
            accessibilityRole="button"
            accessibilityLabel={t('call_dispatch')}
          >
            <Ionicons name="call" size={size.icon.lg} color={colors.onSolid} />
          </Pressable>
          <Text variant="caption" color="textMuted">
            {t('call_dispatch')}
          </Text>
        </View>
      </View>
    </>
  );
}

const ICON = 72;

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space[2], paddingTop: space[2] },
  iconCircle: {
    width: ICON,
    height: ICON,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[2],
  },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: space[12], paddingVertical: space[4] },
  action: { alignItems: 'center', gap: space[2] },
  callButton: {
    width: CALL_BUTTON,
    height: CALL_BUTTON,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decline: { backgroundColor: colors.danger },
  answer: { backgroundColor: colors.success },
  pressed: { opacity: 0.8 },
  hangUp: { transform: [{ rotate: '135deg' }] },
});
