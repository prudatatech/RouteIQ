import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { colors, radius, size, space } from '../../theme';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** 'danger' is for the emergency (SOS) flows; everything else uses the accent. */
  tone?: 'accent' | 'danger';
  /** Leading icon, drawn in the chip's text colour. */
  icon?: (color: string) => ReactNode;
  disabled?: boolean;
}

/**
 * One choice out of a group (wrap chips in a View with accessibilityRole="radiogroup").
 * The single chip style of the app: language, vehicle type, payment mode, SOS type.
 */
export function Chip({ label, selected, onPress, tone = 'accent', icon, disabled }: ChipProps) {
  const fg = selected ? (tone === 'danger' ? colors.danger : colors.accent) : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.chip,
        selected ? (tone === 'danger' ? styles.selectedDanger : styles.selectedAccent) : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {icon ? icon(fg) : null}
      {/* Long labels (Hindi, Telugu, Bengali) wrap instead of pushing the chip past the screen edge. */}
      <Text variant="bodySmallMedium" style={[styles.label, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    maxWidth: '100%',
    minHeight: size.control,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.full,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  label: { flexShrink: 1 },
  selectedAccent: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  selectedDanger: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
