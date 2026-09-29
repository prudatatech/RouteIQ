/**
 * Watches the offline action queue and sends it when the phone is back online:
 * on a timer while something is waiting, when the app comes to the foreground,
 * and on demand ("Waiting to send" pill). Tells the driver when the server
 * refuses a queued action for good, and refreshes the route after a send.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { actionQueue, type FailedAction, type QueuedAction } from '../services/actionQueue';
import { useTranslation } from './useTranslation';

const RETRY_MS = 15000;

export function useActionQueue(onSent: () => void) {
  const { t } = useTranslation();
  const [items, setItems] = useState<readonly QueuedAction[]>(actionQueue.getItems());
  const [sending, setSending] = useState(false);
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  useEffect(() => actionQueue.subscribe(setItems), []);

  useEffect(
    () =>
      actionQueue.onFailure(({ action, message }: FailedAction) => {
        Alert.alert(t('queue_failed_title'), `${t(`queue_kind_${action.kind}`)}: ${message || t('queue_failed_desc')}`);
      }),
    [t],
  );

  const flush = useCallback(async () => {
    if (actionQueue.getItems().length === 0) return;
    setSending(true);
    try {
      const { sent } = await actionQueue.flush();
      if (sent > 0) onSentRef.current();
    } finally {
      setSending(false);
    }
  }, []);

  const waiting = items.length;

  // Sent on a timer while anything waits, and once at start-up for what an earlier session left
  useEffect(() => {
    let cancelled = false;
    actionQueue.whenReady().then(() => {
      if (!cancelled) flush();
    });
    return () => {
      cancelled = true;
    };
  }, [flush]);

  useEffect(() => {
    if (waiting === 0) return;
    const id = setInterval(flush, RETRY_MS);
    return () => clearInterval(id);
  }, [waiting, flush]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flush();
    });
    return () => sub.remove();
  }, [flush]);

  return { items, waiting, sending, flush };
}
