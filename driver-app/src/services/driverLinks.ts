/**
 * Hand-off between a tapped notification and the screen that opens it.
 *
 * A tap can come from a push (the app closed, in the background, or open) or from the in-app
 * list. The tap may land before Home has mounted (cold start, the vehicle gate in the way), so
 * the target is kept here until Home takes it, and announced to Home if it is already there.
 */
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dataOf, resolveNotification, type DriverTarget } from '../utils/notificationTarget';

export const OPEN_TARGET_EVENT = 'driver:open-target';

/** A notification as far as opening it goes. */
export interface OpenedNotification {
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface DriverIntent {
  target: DriverTarget;
  notification: OpenedNotification;
}

let pending: DriverIntent | null = null;
// A push tap that starts a closed app is delivered twice (last response and the listener), and
// the phone keeps the last response, so the last one opened is remembered across launches too
const handled = new Set<string>();
const LAST_OPENED_KEY = 'last_opened_push';

export function toIntent(n: { type?: unknown; title?: unknown; body?: unknown; data?: unknown }): DriverIntent {
  const data = dataOf(n.data);
  return {
    target: resolveNotification({ type: n.type, data }),
    notification: {
      type: typeof n.type === 'string' ? n.type : '',
      title: typeof n.title === 'string' ? n.title : '',
      body: typeof n.body === 'string' ? n.body : '',
      data,
    },
  };
}

/** Opens what a notification is about. `key` (the push's id) stops the same tap from opening twice. */
export async function openNotification(n: { type?: unknown; title?: unknown; body?: unknown; data?: unknown }, key?: string) {
  if (key) {
    if (handled.has(key)) return;
    handled.add(key);
    if ((await AsyncStorage.getItem(LAST_OPENED_KEY).catch(() => null)) === key) return;
    AsyncStorage.setItem(LAST_OPENED_KEY, key).catch(() => {});
  }
  pending = toIntent(n);
  DeviceEventEmitter.emit(OPEN_TARGET_EVENT);
}

/** Home calls this on mount and on every OPEN_TARGET_EVENT. */
export function takePendingIntent(): DriverIntent | null {
  const intent = pending;
  pending = null;
  return intent;
}
