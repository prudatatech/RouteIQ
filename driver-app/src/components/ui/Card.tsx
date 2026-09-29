import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors, radius, size, space } from '../../theme';

export interface CardProps extends ViewProps {
  /** Inner padding (default true). */
  padded?: boolean;
}

/** Surface with a border and no shadow. */
export function Card({ padded = true, style, ...rest }: CardProps) {
  return <View style={[styles.card, padded ? styles.padded : null, style]} {...rest} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: size.border,
    borderColor: colors.border,
  },
  padded: { padding: space[4] },
});
