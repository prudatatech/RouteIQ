import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { EmptyState, ScreenHeader } from '../components/ui';
import { colors, size } from '../theme';

export default function NotificationsScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Notifications" onBack={() => navigation.goBack()} backLabel="Back" />

      <View style={styles.body}>
        <EmptyState
          icon={<Feather name="bell-off" size={size.icon.xl} color={colors.accent} />}
          title="No notifications yet"
          message="We'll let you know here when there's something new."
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, justifyContent: 'center' },
});
