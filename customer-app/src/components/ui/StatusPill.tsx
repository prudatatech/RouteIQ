import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, size, space } from '../../theme';
import { Text } from './Text';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

export const TONES: Record<Tone, { fg: string; bg: string }> = {
  success: { fg: colors.success, bg: colors.successSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
  info: { fg: colors.info, bg: colors.infoSoft },
  neutral: { fg: colors.neutral, bg: colors.neutralSoft },
  accent: { fg: colors.accent, bg: colors.accentSoft },
};

export interface StatusPillProps {
  label: string;
  tone?: Tone;
  icon?: (color: string) => ReactNode;
  /** Makes the pill a button. */
  onPress?: () => void;
  accessibilityHint?: string;
}

/** A status is never shown by colour alone: the pill always carries a label. */
export function StatusPill({ label, tone = 'neutral', icon, onPress, accessibilityHint }: StatusPillProps) {
  const t = TONES[tone];
  const content = (
    <>
      {icon ? icon(t.fg) : null}
      <Text variant="captionMedium" style={{ color: t.fg }} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        hitSlop={12}
        style={({ pressed }) => [styles.pill, styles.pillPressable, { backgroundColor: t.bg }, pressed ? styles.pressed : null]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={label} style={[styles.pill, { backgroundColor: t.bg }]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  pillPressable: { minHeight: size.control, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
