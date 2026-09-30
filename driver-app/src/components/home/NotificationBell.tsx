import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useNotifications } from '../../hooks/useNotifications';
import { fill } from '../../locales';
import { Text } from '../ui';
import { colors, radius, size } from '../../theme';

/** Opens the notification list; the badge counts what is unread. */
export default function NotificationBell({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { unread } = useNotifications();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `${t('notif_open')}, ${fill(t('notif_unread_n'), { n: unread })}` : t('notif_open')}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Ionicons name={unread > 0 ? 'notifications' : 'notifications-outline'} size={size.icon.lg} color={colors.text} />
      {unread > 0 ? (
        <View style={styles.badge} importantForAccessibility="no-hide-descendants">
          <Text variant="captionMedium" color="onSolid" style={styles.badgeText}>
            {unread > 9 ? '9+' : String(unread)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: size.control, height: size.control, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.surfaceSubtle },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, lineHeight: 14 },
});
