/**
 * The dispatcher's phone number, set by staff in the console. The last number
 * read is kept on the phone so "Call dispatch" still works with no signal.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { dial } from '../utils/dial';
import { useTranslation } from './useTranslation';

const CACHE_KEY = 'dispatch_phone';

export function useDispatchPhone() {
  const { t } = useTranslation();
  const [phone, setPhone] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<string | null> => {
    try {
      const { phone: latest } = await api.getDispatchContact();
      setPhone(latest);
      if (latest) await AsyncStorage.setItem(CACHE_KEY, latest);
      else await AsyncStorage.removeItem(CACHE_KEY);
      return latest;
    } catch {
      // Offline: keep the number already known
      return null;
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY)
      .then((cached) => cached && setPhone((current) => current ?? cached))
      .catch(() => {});
    refresh();
  }, [refresh]);

  /** Calls dispatch, or says that no number is set. */
  const callDispatch = useCallback(async () => {
    // A number may have been set since the app last asked
    const number = phone ?? (await refresh());
    if (!number) {
      Alert.alert(t('dispatch_no_number_title'), t('dispatch_no_number_desc'));
      return;
    }
    if (!(await dial(number))) Alert.alert(t('error'), t('dispatch_call_failed'));
  }, [phone, refresh, t]);

  return { phone, callDispatch, refresh };
}
