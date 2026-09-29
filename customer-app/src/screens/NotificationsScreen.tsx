import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { EmptyState, ErrorBanner, ScreenHeader, Text } from '../components/ui';
import { colors, radius, size, space } from '../theme';
import { api, type NotificationItem } from '../services/api';
import { formatDateTime } from '../utils/format';

export default function NotificationsScreen({ navigation }: any) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await api.getNotifications({ limit: 50 });
      setItems(res.notifications);
    } catch (e: any) {
      setError(e?.message || 'Could not load notifications.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // First load. `loading` starts true, so nothing is set before the request settles.
  useEffect(() => {
    let cancelled = false;
    api
      .getNotifications({ limit: 50 })
      .then((res) => {
        if (!cancelled) setItems(res.notifications);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || 'Could not load notifications.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openNotification = useCallback(async (item: NotificationItem) => {
    if (item.type === 'booking' && typeof item.data?.booking_id === 'string') navigation.navigate('BookingDetail', { id: item.data.booking_id });
    if (item.is_read) return;
    // Optimistic: flip it read locally, then persist.
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
    try {
      await api.markNotificationRead(item.id);
    } catch {
      // Not worth surfacing a banner for a background mark-as-read failure;
      // it will show unread again next refresh if it truly failed.
    }
  }, [navigation]);

  const body = () => {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.errorWrap}>
          <ErrorBanner message={error} action={{ label: 'Retry', onPress: () => load() }} />
        </View>
      );
    }
    if (items.length === 0) {
      return (
        <View style={styles.center}>
          <EmptyState
            icon={<Feather name="bell-off" size={size.icon.xl} color={colors.accent} />}
            title="No notifications yet"
            message="We'll let you know here when there's something new."
          />
        </View>
      );
    }
    return (
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => openNotification(item)}
            style={({ pressed }) => [styles.row, !item.is_read ? styles.unread : null, pressed ? styles.pressed : null]}
          >
            {!item.is_read ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
            <View style={styles.rowBody}>
              <Text variant={item.is_read ? 'bodyMedium' : 'bodyMedium'} color={item.is_read ? 'textMuted' : 'text'}>
                {item.title}
              </Text>
              <Text variant="bodySmall" color="textMuted" style={styles.message} numberOfLines={2}>
                {item.body}
              </Text>
              <Text variant="caption" color="textMuted">
                {formatDateTime(item.created_at)}
              </Text>
            </View>
          </Pressable>
        )}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Notifications" />
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
    marginTop: 6,
  },
  dotSpacer: { width: 8, height: 8, marginTop: 6 },
});
