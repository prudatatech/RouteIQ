import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from '../hooks/useTranslation';
import { Text } from './ui';
import { colors, radius, size, space, type } from '../theme';

interface SosButtonProps {
  onPress: () => void;
}

/**
 * The one SOS control. It sits at the top right of every signed-in screen and
 * is the only solid red pill in the app, so it is found without looking.
 * One tap sends the alert.
 */
export default function SosButton({ onPress }: SosButtonProps) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('sos_button_label')}
      accessibilityHint={t('sos_button_hint')}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name="alert-circle" size={size.icon.md} color={colors.onSolid} />
      <Text style={styles.label}>SOS</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: colors.danger,
  },
  pressed: { backgroundColor: colors.dangerHover },
  label: { ...type.label, fontFamily: type.title.fontFamily, color: colors.onSolid },
});
