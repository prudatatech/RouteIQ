/**
 * The in-app notification list. Each row opens the exact place its notification is about (the same
 * routing as a tapped push, see utils/notificationTarget), shows read or unread, and "Mark all
 * read" clears the unread count.
 */
import React, { type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from '../hooks/useTranslation';
import { useNotifications } from '../hooks/useNotifications';
import type { AppNotification } from '../services/api';
import { fill } from '../locales';
import { formatDateTime } from '../utils/format';
import { resolveNotification, type DriverTarget } from '../utils/notificationTarget';
import CargoScreen from '../components/cargo/CargoScreen';
import { Button, Card, EmptyState, ErrorBanner, Text } from '../components/ui';
import { colors, radius, size, space } from '../theme';

const ICONS: Record<DriverTarget['kind'], keyof typeof Ionicons.glyphMap> = {
  trip: 'navigate-circle-outline',
  cancelled: 'close-circle-outline',
  load: 'cube-outline',
  transfer: 'swap-horizontal',
  cargo: 'cube-outline',
  documents: 'document-text-outline',
  vehicle: 'car-outline',
  wallet: 'wallet-outline',
  rating: 'star-outline',
  messages: 'chatbubbles-outline',
  stop: 'alert-circle-outline',
  profile: 'person-outline',
  home: 'notifications-outline',
};

interface NotificationsScreenProps {
  /** Opens what the notification is about. */
  onOpen: (notification: AppNotification) => void;
  onClose: () => void;
  headerRight?: ReactNode;
}

export default function NotificationsScreen({ onOpen, onClose, headerRight }: NotificationsScreenProps) {
  const { t } = useTranslation();
  const list = useNotifications();

  return (
    <CargoScreen
      title={t('notif_title')}
      subtitle={list.unread > 0 ? fill(t('notif_unread_n'), { n: list.unread }) : undefined}
      onClose={onClose}
      headerRight={headerRight}
    >
      {list.failed ? (
        <ErrorBanner message={t('notif_load_failed')} action={{ label: t('retry'), onPress: () => list.refetch() }} />
      ) : null}
      {list.markAllFailed ? <ErrorBanner message={t('notif_mark_failed')} /> : null}

      {list.loading ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />
      ) : list.notifications.length === 0 && !list.failed ? (
        <Card>
          <EmptyState
            icon={<Ionicons name="notifications-off-outline" size={size.icon.xl} color={colors.textMuted} />}
            title={t('notif_empty_title')}
            message={t('notif_empty_desc')}
          />
        </Card>
      ) : (
        <>
          {list.unread > 0 ? (
            <Button
              title={t('notif_mark_all')}
              variant="secondary"
              onPress={() => list.markAllRead()}
              loading={list.markingAll}
              icon={(color) => <Ionicons name="checkmark-done-outline" size={size.icon.md} color={color} />}
            />
          ) : null}
          <Card padded={false}>
            {list.notifications.map((n, idx) => {
              const kind = resolveNotification(n).kind;
              return (
                <Pressable
                  key={n.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${n.is_read ? '' : `${t('notif_unread')}. `}${n.title}. ${n.body}`}
                  onPress={() => {
                    if (!n.is_read) list.markRead(n.id);
                    onOpen(n);
                  }}
                  style={({ pressed }) => [styles.row, idx > 0 && styles.rowBorder, !n.is_read && styles.unreadRow, pressed && styles.pressed]}
                >
                  <View style={styles.icon} importantForAccessibility="no-hide-descendants">
                    <Ionicons name={ICONS[kind]} size={size.icon.md} color={n.is_read ? colors.textMuted : colors.accent} />
                  </View>
                  <View style={styles.body}>
                    <Text variant={n.is_read ? 'bodyMedium' : 'title'} numberOfLines={2}>
                      {n.title}
                    </Text>
                    <Text variant="bodySmall" color="textMuted" numberOfLines={3}>
                      {n.body}
                    </Text>
                    <Text variant="caption" color="textMuted">
                      {formatDateTime(n.created_at)}
                    </Text>
                  </View>
                  {!n.is_read ? <View style={styles.dot} importantForAccessibility="no-hide-descendants" /> : null}
                </Pressable>
              );
            })}
          </Card>
        </>
      )}
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], padding: space[4], minHeight: size.control },
  rowBorder: { borderTopWidth: size.border, borderTopColor: colors.border },
  unreadRow: { backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.7 },
  icon: { width: size.icon.lg, alignItems: 'center', paddingTop: 2 },
  body: { flex: 1, gap: space[1] },
  dot: { width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.accent, marginTop: 6 },
});
