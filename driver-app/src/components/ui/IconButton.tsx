import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, size } from '../../theme';

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Required: icon-only buttons must be named for screen readers. */
  accessibilityLabel: string;
  icon: (color: string) => ReactNode;
  variant?: 'ghost' | 'secondary';
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ icon, variant = 'ghost', style, disabled, ...rest }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        variant === 'secondary' ? styles.secondary : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
      {...rest}
    >
      {icon(colors.text)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: size.control,
    height: size.control,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { backgroundColor: colors.surface, borderWidth: size.border, borderColor: colors.border },
  pressed: { backgroundColor: colors.surfaceSubtle },
  disabled: { opacity: 0.5 },
});
