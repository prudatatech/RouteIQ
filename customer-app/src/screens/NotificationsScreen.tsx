import React, { useCallback, useState } from 'react';
import { ActivityIndicator, DeviceEventEmitter, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Button, EmptyState, ErrorBanner, ScreenHeader, Text } from '../components/ui';
import { colors, radius, size, space } from '../theme';
import { api, NOTIFICATIONS_CHANGED_EVENT, type NotificationItem } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { formatDateTime } from '../utils/format';
import { useTranslation } from '../hooks/useTranslation';

export default function NotificationsScreen({ navigation }: any) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useRemote(
    () => api.getNotifications({ limit: 50 }),
    'notifications',
    t('notif_load_failed'),
  );
  // Notifications the customer has opened since the last load, shown as read straight away.
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  // New notifications arrive while the customer is elsewhere, so refresh whenever this tab is shown.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const items = data?.notifications ?? [];
  const isRead = (item: NotificationItem) => item.is_read || readIds.has(item.id);
  const unreadCount = items.filter((n) => !isRead(n)).length;

  const openNotification = useCallback(
    async (item: NotificationItem) => {
      if (item.type === 'booking' && typeof item.data?.booking_id === 'string') {
        navigation.navigate('BookingDetail', { id: item.data.booking_id });
      }
      if (item.is_read || readIds.has(item.id)) return;
      setReadIds((prev) => new Set(prev).add(item.id));
      try {
        await api.markNotificationRead(item.id);
        DeviceEventEmitter.emit(NOTIFICATIONS_CHANGED_EVENT);
      } catch {
        // Not worth a banner for a background mark-as-read; it shows unread again on the next refresh.
      }
    },
    [navigation, readIds],
  );

  const markAllRead = async () => {
    setMarkingAll(true);
    setMarkError(null);
    try {
      await api.markAllNotificationsRead();
      setReadIds(new Set(items.map((n) => n.id)));
      DeviceEventEmitter.emit(NOTIFICATIONS_CHANGED_EVENT);
      reload();
    } catch (e: any) {
      setMarkError(e?.message || t('notif_mark_failed'));
    } finally {
      setMarkingAll(false);
    }
  };

  const body = () => {
    if (!data && loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }
    if (error && !data) {
      return (
        <View style={styles.errorWrap}>
          <ErrorBanner message={error} action={{ label: t('try_again'), onPress: reload }} />
        </View>
      );
    }
    if (items.length === 0) {
      return (
        <View style={styles.center}>
          <EmptyState
            icon={<Feather name="bell-off" size={size.icon.xl} color={colors.accent} />}
            title={t('notif_empty_title')}
            message={t('notif_empty_msg')}
          />
        </View>
      );
    }
    return (
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}
        ListHeaderComponent={
          error || markError ? (
            <View style={styles.errorWrap}>
              <ErrorBanner message={(markError ?? error) as string} action={markError ? undefined : { label: t('try_again'), onPress: reload }} />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const read = isRead(item);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${read ? '' : t('unread') + ' '}${item.title}. ${item.body}`}
              onPress={() => openNotification(item)}
              style={({ pressed }) => [styles.row, !read ? styles.unread : null, pressed ? styles.pressed : null]}
            >
              {!read ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
              <View style={styles.rowBody}>
                <Text variant={read ? 'body' : 'bodyMedium'} color={read ? 'textMuted' : 'text'}>
                  {item.title}
                </Text>
                <Text variant="bodySmall" color="textMuted" style={styles.message} numberOfLines={3}>
                  {item.body}
                </Text>
                <Text variant="caption" color="textMuted">
                  {formatDateTime(item.created_at)}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={t('tab_notifications')}
        right={
          unreadCount > 0 ? (
            <Button title={t('mark_all_read')} variant="ghost" block={false} loading={markingAll} onPress={markAllRead} />
          ) : undefined
        }
      />
      {body()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center' },
  errorWrap: { padding: space[4] },
  list: { paddingVertical: space[2] },
  row: {
    flexDirection: 'row',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: size.control,
    alignItems: 'flex-start',
  },
  unread: { backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.7 },
  rowBody: { flex: 1, gap: space[1] },
  message: { marginTop: 2 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    marginTop: 8,
  },
  dotSpacer: { width: 8, height: 8, marginTop: 8 },
});
