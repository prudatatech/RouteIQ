/**
 * The driver's conversation with dispatch for the current route: the thread,
 * the unread count for the tab badge, and sending. Updates arrive over
 * Supabase Realtime (row-level security limits it to the driver's own routes),
 * with a slow poll as a fallback when Realtime drops.
 */
import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { supabase } from '../services/supabase';

const POLL_MS = 30000;

interface Options {
  /** The current route (or vendor load); null when there is none. */
  routeId: string | null;
  /** The Messages tab is showing, so what arrives is read straight away. */
  tabOpen: boolean;
}

export function useDriverMessages({ routeId, tabOpen }: Options) {
  const queryClient = useQueryClient();

  const thread = useQuery({
    queryKey: ['messages', routeId],
    queryFn: () => api.getMessages(routeId as string),
    enabled: !!routeId,
    refetchInterval: POLL_MS,
  });

  const unread = useQuery({
    queryKey: ['messagesUnread'],
    queryFn: () => api.getUnreadMessages(),
    refetchInterval: POLL_MS,
  });

  const { refetch: refetchThread } = thread;
  const { refetch: refetchUnread } = unread;

  useEffect(() => {
    const channel = supabase
      .channel('driver-messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        refetchThread();
        refetchUnread();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetchThread, refetchUnread]);

  const messages = thread.data ?? [];
  const hasUnreadFromDispatch = messages.some((m) => m.sender_role !== 'driver' && !m.read_at);

  const markRead = useMutation({
    mutationFn: (id: string) => api.markMessagesRead(id),
    onSuccess: () => {
      refetchThread();
      refetchUnread();
    },
  });
  const { mutate: markReadNow, isPending: markingRead } = markRead;

  useEffect(() => {
    if (tabOpen && routeId && hasUnreadFromDispatch && !markingRead) markReadNow(routeId);
  }, [tabOpen, routeId, hasUnreadFromDispatch, markingRead, markReadNow]);

  const send = useMutation({
    mutationFn: (body: string) => api.sendMessage(routeId as string, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', routeId] });
    },
  });
  const { mutateAsync: sendAsync } = send;

  const sendMessage = useCallback(async (body: string) => {
    await sendAsync(body);
  }, [sendAsync]);

  return {
    messages,
    unreadCount: unread.data?.total ?? 0,
    loading: thread.isLoading,
    failed: thread.isError,
    retry: refetchThread,
    sending: send.isPending,
    sendMessage,
  };
}
