import { Linking } from 'react-native';

/** Opens the phone's dialler with the number ready. Resolves false when it could not be opened. */
export async function dial(phone: string): Promise<boolean> {
  try {
    await Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
    return true;
  } catch {
    return false;
  }
}
