import React, { useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import type { Invoice } from '../../components/modals/InvoiceDialog';
import { Card, EmptyState, ErrorBanner, StatusPill, Text } from '../../components/ui';
import { colors, size, space } from '../../theme';
import { formatINR, formatNumber } from '../../utils/format';

interface WalletTabProps {
  onOpenInvoice: (invoice: Invoice) => void;
}

type HistoryFilter = 'this_month' | 'last_month' | 'all';

const HISTORY_PAGE_SIZE = 20;

/** [from, to) ISO bounds in Asia/Kolkata month terms, or undefined for "all". */
function filterRange(filter: HistoryFilter): { from?: string; to?: string } {
  if (filter === 'all') return {};
  const now = new Date();
  // Approximate month boundaries in UTC; good enough for a client-side quick filter.
  const monthsAgo = filter === 'last_month' ? 1 : 0;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1));
  return { from: start.toISOString(), to: end.toISOString() };
}

function monthLabel(dateStr: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(dateStr));
}

/** Earnings total, completed trips and a filterable, infinite-scroll trip history. */
export default function WalletTab({ onOpenInvoice }: WalletTabProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<HistoryFilter>('all');

  const earnings = useQuery({
    queryKey: ['earnings'],
    queryFn: () => api.getDriverEarnings(),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const summary = earnings.data as { total_earnings?: number; completed_trips?: number } | undefined;

  const { from, to } = useMemo(() => filterRange(filter), [filter]);
  const history = useInfiniteQuery({
    queryKey: ['earnings-history', filter],
    queryFn: ({ pageParam }) => api.getDriverEarningsHistory({ limit: HISTORY_PAGE_SIZE, offset: pageParam, from, to }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.offset + lastPage.limit : undefined),
  });

  const invoices: Invoice[] = history.data?.pages.flatMap((p) => p.invoices) ?? [];

  // Group into { month label -> invoices }, preserving the newest-first order the API returns.
  const groups = useMemo(() => {
    const out: { label: string; invoices: Invoice[] }[] = [];
    for (const inv of invoices) {
      const label = monthLabel(inv.date);
      const last = out[out.length - 1];
      if (last && last.label === label) last.invoices.push(inv);
      else out.push({ label, invoices: [inv] });
    }
    return out;
  }, [invoices]);

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

      {summary ? (
        <Card style={styles.summary}>
          <Text variant="bodySmall" color="textMuted">
            {t('total_earnings')}
          </Text>
          <Text variant="display">{formatINR(summary.total_earnings ?? 0)}</Text>
          <View style={styles.divider} />
          <Text variant="bodySmall" color="textMuted">
            {t('trips_completed')}
          </Text>
          <Text variant="title">{formatNumber(summary.completed_trips ?? 0)}</Text>
        </Card>
      ) : null}

      <View style={styles.historyHeader}>
        <Text variant="title" accessibilityRole="header">
          {t('earnings_history_title')}
        </Text>
        <View style={styles.filters}>
          {(['this_month', 'last_month', 'all'] as const).map((f) => (
            <StatusPill
              key={f}
              label={t(`history_filter_${f}`)}
              tone={filter === f ? 'accent' : 'neutral'}
              onPress={() => setFilter(f)}
            />
          ))}
        </View>
      </View>

      {history.isLoading ? (
        <View style={styles.loadingInline}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />
        </View>
      ) : history.isError ? (
        <ErrorBanner message={t('history_error')} action={{ label: t('retry'), onPress: () => history.refetch() }} />
      ) : invoices.length > 0 ? (
        <>
          {groups.map((group) => (
            <View key={group.label} style={styles.group}>
              <Text variant="captionMedium" color="textMuted" style={styles.groupLabel}>
                {group.label}
              </Text>
              <Card padded={false}>
                {group.invoices.map((inv, idx) => (
                  <Pressable
                    key={inv.id}
                    onPress={() => onOpenInvoice(inv)}
                    accessibilityRole="button"
                    accessibilityLabel={`${inv.pickup ?? ''} → ${inv.drop ?? ''}, ${formatINR(inv.total_payout ?? 0)}`}
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
                      <Text variant="bodyMedium">{formatINR(inv.total_payout ?? 0)}</Text>
                      <StatusPill
                        tone={inv.status === 'paid' ? 'success' : 'warning'}
                        label={inv.status === 'paid' ? t('paid') : t('status_pending')}
                      />
                    </View>
                    <Ionicons name="chevron-forward" size={size.icon.sm} color={colors.textMuted} />
                  </Pressable>
                ))}
              </Card>
            </View>
          ))}

          {history.hasNextPage ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('history_load_more')}
              onPress={() => history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
              style={({ pressed }) => [styles.loadMore, pressed ? styles.pressed : null]}
            >
              {history.isFetchingNextPage ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text variant="bodyMedium" color="accent">
                  {t('history_load_more')}
                </Text>
              )}
            </Pressable>
          ) : null}
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<Ionicons name="receipt-outline" size={size.icon.xl} color={colors.textMuted} />}
            title={t('no_earnings_yet')}
            message={filter === 'all' ? t('no_earnings_desc') : t('history_empty')}
          />
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[4] },
  loading: { paddingVertical: space[16], alignItems: 'center' },
  loadingInline: { paddingVertical: space[6], alignItems: 'center' },
  summary: { gap: space[1] },
  divider: { height: size.border, backgroundColor: colors.border, marginVertical: space[3] },
  historyHeader: { gap: space[2] },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  group: { gap: space[2] },
  groupLabel: { paddingHorizontal: space[1] },
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
  pressed: { opacity: 0.7 },
  amount: { alignItems: 'flex-end', gap: space[1] },
  loadMore: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: size.control,
    paddingVertical: space[3],
  },
});
