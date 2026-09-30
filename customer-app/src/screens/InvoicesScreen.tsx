import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { EmptyState, ErrorBanner, ScreenHeader } from '../components/ui';
import { InvoiceRow } from '../components/invoice/InvoiceRow';
import { PaymentDetailsCard } from '../components/invoice/PaymentDetailsCard';
import { colors, size, space } from '../theme';
import { api } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { useTranslation } from '../hooks/useTranslation';

/** The customer's invoices, newest first, with the way to pay on top while any is unpaid. */
export default function InvoicesScreen({ navigation }: any) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useRemote(() => api.listInvoices(), 'invoices', t('invoices_load_failed'));

  // An invoice is issued or marked paid while the customer is away, so refresh whenever this tab is shown.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (!data && loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title={t('tab_invoices')} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const unpaid = (data ?? []).some((i) => i.status === 'issued');
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('tab_invoices')} />
      {error && !data ? (
        <View style={styles.errorWrap}>
          <ErrorBanner message={error} action={{ label: t('try_again'), onPress: reload }} />
        </View>
      ) : !data || data.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon={<Feather name="file-text" size={size.icon.xl} color={colors.accent} />}
            title={t('invoices_empty_title')}
            message={t('invoices_empty_msg')}
          />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}
          ListHeaderComponent={
            <View style={styles.header}>
              {error ? <ErrorBanner message={error} action={{ label: t('try_again'), onPress: reload }} /> : null}
              {unpaid ? <PaymentDetailsCard /> : null}
            </View>
          }
          renderItem={({ item }) => <InvoiceRow t={t} invoice={item} onPress={() => navigation.navigate('Invoice', { id: item.id })} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center' },
  errorWrap: { padding: space[4] },
  list: { padding: space[4], gap: space[3] },
  header: { gap: space[3] },
});
