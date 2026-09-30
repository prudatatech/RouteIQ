/** The driver's in-app notifications (GET /notifications): the list, the unread count, and marking read. */
import { useCallback, useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AppNotification } from '../services/api';
import { NOTIFICATIONS_CHANGED_EVENT } from '../components/NotificationListener';

export const NOTIFICATIONS_KEY = ['notifications'];

interface NotificationsData {
  notifications: AppNotification[];
  unread_count: number;
}

export function useNotifications() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => api.getNotifications(50),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  // A notification arrived (push or realtime): reload
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(NOTIFICATIONS_CHANGED_EVENT, () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    });
    return () => sub.remove();
  }, [queryClient]);

  const patch = useCallback(
    (update: (data: NotificationsData) => NotificationsData) => {
      queryClient.setQueryData<NotificationsData>(NOTIFICATIONS_KEY, (old) => (old ? update(old) : old));
    },
    [queryClient],
  );

  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onMutate: (id) =>
      patch((d) => {
        const was = d.notifications.find((n) => n.id === id);
        return {
          notifications: d.notifications.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
          unread_count: was && !was.is_read ? Math.max(0, d.unread_count - 1) : d.unread_count,
        };
      }),
    onError: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => patch((d) => ({ notifications: d.notifications.map((n) => ({ ...n, is_read: true })), unread_count: 0 })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  return {
    notifications: query.data?.notifications ?? [],
    unread: query.data?.unread_count ?? 0,
    loading: query.isLoading,
    failed: query.isError && !query.data,
    refetch: query.refetch,
    refreshing: query.isFetching,
    markRead: markRead.mutate,
    markAllRead: markAllRead.mutate,
    markingAll: markAllRead.isPending,
    markAllFailed: markAllRead.isError,
  };
}
