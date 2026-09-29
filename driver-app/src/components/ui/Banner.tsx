import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { radius, size, space } from '../../theme';
import { TONES } from './StatusPill';
import { Text } from './Text';

export interface BannerProps {
  tone: 'danger' | 'warning' | 'info';
  message: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: { label: string; onPress: () => void };
}

/** Inline message, announced to screen readers when it appears. */
export function Banner({ tone, message, icon, action }: BannerProps) {
  const t = TONES[tone];
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { backgroundColor: t.bg }]}
    >
      {icon ? <Ionicons name={icon} size={size.icon.md} color={t.fg} /> : null}
      <Text variant="bodySmall" style={[styles.message, { color: t.fg }]}>
        {message}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={12}
          style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
        >
          <Text variant="bodySmallMedium" style={{ color: t.fg }}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ErrorBanner(props: Omit<BannerProps, 'tone' | 'icon'>) {
  return <Banner tone="danger" icon="alert-circle-outline" {...props} />;
}

export function OfflineBanner(props: Omit<BannerProps, 'tone' | 'icon'>) {
  return <Banner tone="warning" icon="cloud-offline-outline" {...props} />;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.control,
    minHeight: size.control,
  },
  message: { flex: 1 },
  action: { paddingHorizontal: space[2], paddingVertical: space[1] },
  pressed: { opacity: 0.6 },
});
