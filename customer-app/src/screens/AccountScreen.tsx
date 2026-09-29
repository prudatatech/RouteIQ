import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, STORAGE_KEYS } from '../services/api';
import { Button, Card, ScreenHeader, Text } from '../components/ui';
import LanguagePicker from '../components/LanguagePicker';
import { useTranslation } from '../hooks/useTranslation';
import { colors, radius, size, space } from '../theme';

interface CustomerInfo {
  full_name?: string | null;
  phone?: string | null;
}

export default function AccountScreen({ navigation }: any) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<CustomerInfo | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.CUSTOMER_INFO)
      .then((stored) => setInfo(stored ? JSON.parse(stored) : {}))
      .catch(() => setInfo({}));
  }, []);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.logout();
    } finally {
      setSigningOut(false);
      // The tabs live inside the root stack; reset it so Back cannot return here.
      navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Login' }] });
    }
  };

  const confirmSignOut = () => {
    Alert.alert(t('signout_title'), t('signout_body'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('signout'), style: 'destructive', onPress: signOut },
    ]);
  };

  const name = info?.full_name?.trim();
  const phone = info?.phone?.trim();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('tab_account')} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.profile}>
          <View style={styles.avatar} accessible={false}>
            <Feather name="user" size={size.icon.lg} color={colors.accent} />
          </View>
          <View style={styles.flex}>
            <Text variant="title" numberOfLines={1}>
              {name || t('your_account')}
            </Text>
            {phone ? (
              <Text variant="mono" color="textMuted" accessibilityLabel={`${t('phone')} ${phone}`}>
                {phone}
              </Text>
            ) : null}
          </View>
        </Card>

        <Text variant="title" accessibilityRole="header">
          {t('language')}
        </Text>
        <LanguagePicker />

        <Button
          title={t('signout')}
          variant="secondary"
          onPress={confirmSignOut}
          loading={signingOut}
          icon={(color) => <Feather name="log-out" size={size.icon.md} color={color} />}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const AVATAR = 48;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space[4], gap: space[4] },
  flex: { flex: 1 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
