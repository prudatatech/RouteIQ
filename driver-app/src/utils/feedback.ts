import { Vibration } from 'react-native';

/**
 * A short, single buzz for confirmations and state changes (tracking on/off,
 * GPS lost, arrival). The looping siren is reserved for new assignments and
 * dispatch calls (see useAlertSiren).
 */
export function shortFeedback() {
  Vibration.vibrate(40);
}
