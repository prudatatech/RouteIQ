import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import type { Invoice } from '../../components/modals/InvoiceDialog';
import { Card, EmptyState, ErrorBanner, StatusPill, Text } from '../../components/ui';
import { colors, size, space } from '../../theme';

interface WalletTabProps {
  onOpenInvoice: (invoice: Invoice) => void;
}

/** Earnings total, completed trips and recent invoices. */
export default function WalletTab({ onOpenInvoice }: WalletTabProps) {
  const { t } = useTranslation();
  const earnings = useQuery({
    queryKey: ['earnings'],
    queryFn: () => api.getDriverEarnings(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const data = earnings.data as
    | { total_earnings?: number; completed_trips?: number; recent_invoices?: Invoice[] }
    | undefined;
  const invoices = data?.recent_invoices ?? [];

  if (earnings.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} accessibilityLabel={t('loading')} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {earnings.isError ? (
        <ErrorBanner
          message={t('earnings_load_failed')}
          action={{ label: t('retry'), onPress: () => earnings.refetch() }}
        />
      ) : null}

      {data ? (
        <Card style={styles.summary}>
          <Text variant="bodySmall" color="textMuted">
            {t('total_earnings')}
          </Text>
          <Text variant="display">{`₹${(data.total_earnings ?? 0).toLocaleString()}`}</Text>
          <View style={styles.divider} />
          <Text variant="bodySmall" color="textMuted">
            {t('trips_completed')}
          </Text>
          <Text variant="title">{(data.completed_trips ?? 0).toLocaleString()}</Text>
        </Card>
      ) : null}

      <Text variant="title" accessibilityRole="header">
        {t('recent_invoices')}
      </Text>

      {invoices.length > 0 ? (
        <Card padded={false}>
          {invoices.map((inv, idx) => (
            <Pressable
              key={inv.id}
              onPress={() => onOpenInvoice(inv)}
              accessibilityRole="button"
              accessibilityLabel={`${inv.pickup ?? ''} → ${inv.drop ?? ''}, ₹${inv.total_payout?.toLocaleString() ?? ''}`}
              accessibilityHint={t('open_invoice_hint')}
              style={({ pressed }) => [styles.invoice, idx > 0 && styles.invoiceBorder, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text variant="caption" color="textMuted">
                  {`${new Date(inv.date).toLocaleDateString()} · ${inv.cargo_type ?? ''}`}
                </Text>
                <Text variant="bodyMedium" numberOfLines={1}>
                  {`${inv.pickup ?? '—'} → ${inv.drop ?? '—'}`}
                </Text>
              </View>
              <View style={styles.amount}>
                <Text variant="bodyMedium">{`₹${inv.total_payout?.toLocaleString() ?? '—'}`}</Text>
                <StatusPill
                  tone={inv.status === 'paid' ? 'success' : 'warning'}
                  label={inv.status === 'paid' ? t('paid') : t('status_pending')}
                />
              </View>
              <Ionicons name="chevron-forward" size={size.icon.sm} color={colors.textMuted} />
            </Pressable>
          ))}
        </Card>
      ) : !earnings.isError ? (
        <Card>
          <EmptyState
            icon={<Ionicons name="receipt-outline" size={size.icon.xl} color={colors.textMuted} />}
            title={t('no_earnings_yet')}
            message={t('no_earnings_desc')}
          />
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[4] },
  loading: { paddingVertical: space[16], alignItems: 'center' },
  summary: { gap: space[1] },
  divider: { height: size.border, backgroundColor: colors.border, marginVertical: space[3] },
  flex: { flex: 1, gap: 2 },
  invoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: size.control + space[4],
  },
  invoiceBorder: { borderTopWidth: size.border, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surfaceSubtle },
  amount: { alignItems: 'flex-end', gap: space[1] },
});
