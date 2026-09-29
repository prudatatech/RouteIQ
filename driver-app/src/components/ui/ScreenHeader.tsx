import React, { type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { size, space } from '../../theme';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Shows a back or close button on the left. */
  onBack?: () => void;
  backLabel?: string;
  backIcon?: 'arrow-back' | 'close';
  right?: ReactNode;
}

/** Top-of-screen title row. Safe-area insets are handled by the screen. */
export function ScreenHeader({ title, subtitle, onBack, backLabel, backIcon = 'arrow-back', right }: ScreenHeaderProps) {
  return (
    <View style={styles.row}>
      {onBack ? (
        <IconButton
          accessibilityLabel={backLabel ?? title}
          onPress={onBack}
          icon={(color) => <Ionicons name={backIcon} size={size.icon.lg} color={color} />}
        />
      ) : null}
      <View style={styles.titles}>
        <Text variant="title" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: size.control,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  titles: { flex: 1 },
});
