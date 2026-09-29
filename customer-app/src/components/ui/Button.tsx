import React, { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, size, space, type } from '../../theme';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: ButtonVariant;
  loading?: boolean;
  /** Leading icon, drawn in the button's text colour. */
  icon?: (color: string) => ReactNode;
  /** Stretch to the parent's width (default true). */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
}

const VARIANTS: Record<ButtonVariant, { bg: string; pressed: string; fg: string; border: string }> = {
  primary: { bg: colors.accentFill, pressed: colors.accentFillHover, fg: colors.onAccentFill, border: colors.accentFill },
  secondary: { bg: colors.surface, pressed: colors.surfaceSubtle, fg: colors.text, border: colors.borderStrong },
  ghost: { bg: 'transparent', pressed: colors.accentSoft, fg: colors.accent, border: 'transparent' },
  danger: { bg: colors.danger, pressed: colors.dangerHover, fg: colors.onSolid, border: colors.danger },
};

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  icon,
  block = true,
  style,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const v = VARIANTS[variant];
  const inactive = !!disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: pressed ? v.pressed : v.bg, borderColor: v.border },
        block ? styles.block : null,
        inactive ? styles.inactive : null,
        style,
      ]}
      {...rest}
    >
      {/* The label stays while busy so the button never turns into a bare spinner. */}
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={v.fg} size="small" /> : icon ? icon(v.fg) : null}
        <Text style={[type.label, { color: v.fg }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.control,
    borderWidth: size.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { alignSelf: 'stretch' },
  inactive: { opacity: 0.5 },
  content: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
