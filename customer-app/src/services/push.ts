/**
 * Push notifications for the customer app.
 *
 * The backend sends every customer notification as a push too, once this phone has saved its Expo push
 * token (`PUT /customer/push-token`). Nothing here asks for permission at app start:
 *   - `syncPushToken` runs after sign-in and only saves the token when permission was already given;
 *   - `askForPushAfterBooking` asks once, right after the customer's first booking, when the
 *     reason to allow notifications is clear;
 *   - `requestPushPermission` is the Account screen's button for a customer who chose to turn them on later.
 * Tapping a push opens the same screen as the notification list (see usePushNavigation).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Alert, DeviceEventEmitter, Platform } from 'react-native';
import { translateNow } from '../locales';
import { colors } from '../theme';
import { api, NOTIFICATIONS_CHANGED_EVENT } from './api';

/** The Android channel the backend sends customer pushes to (push.service.ts). */
export const PUSH_CHANNEL = 'default';

const ASKED_KEY = 'customer_push_prompt_shown';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/** Shows a push while the app is open (the badge and list refresh as well). Call once at startup. */
export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  Notifications.addNotificationReceivedListener(() => DeviceEventEmitter.emit(NOTIFICATIONS_CHANGED_EVENT));
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL, {
    name: translateNow('push_channel_name'),
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: colors.accentFill,
  });
}

export async function pushPermission(): Promise<PushPermission> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

/** Gets this phone's Expo push token and saves it on the customer. Needs permission already. */
async function saveToken(): Promise<boolean> {
  // A push token only exists on a real phone with the EAS project id in the build
  if (!Device.isDevice) return false;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return false;
  try {
    await ensureAndroidChannel();
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.registerPushToken(data);
    return true;
  } catch {
    // No signal or no Google services on this phone: the in-app list still works, and the next start tries again.
    return false;
  }
}

/** After sign-in: keep this phone's token saved, if the customer has allowed notifications. Never asks. */
export async function syncPushToken(): Promise<void> {
  if ((await pushPermission()) === 'granted') await saveToken();
}

/** Asks the system for permission (the customer already agreed in our own words) and saves the token. */
export async function requestPushPermission(): Promise<PushPermission> {
  await ensureAndroidChannel();
  const { status } = await Notifications.requestPermissionsAsync();
  if (status === 'granted') {
    await saveToken();
    return 'granted';
  }
  return status === 'denied' ? 'denied' : 'undetermined';
}

/**
 * The sensible moment to ask: just after a booking is sent. Explains why in a sentence first, so the
 * system prompt is not a surprise, and never repeats if the customer said no once.
 */
export async function askForPushAfterBooking(): Promise<void> {
  try {
    const permission = await pushPermission();
    if (permission === 'granted') return void (await saveToken());
    if (permission === 'denied' || (await AsyncStorage.getItem(ASKED_KEY))) return;
    await AsyncStorage.setItem(ASKED_KEY, '1');
    Alert.alert(translateNow('push_prompt_title'), translateNow('push_prompt_body'), [
      { text: translateNow('push_prompt_no'), style: 'cancel' },
      { text: translateNow('push_prompt_yes'), onPress: () => void requestPushPermission() },
    ]);
  } catch {
    // Asking is a nicety: a booking never fails because of it.
  }
}
