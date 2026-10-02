import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Card, ErrorBanner, Text } from '../ui';
import { colors, fontFamily, size, space } from '../../theme';
import { api } from '../../services/api';
import { useRemote } from '../../hooks/useRemote';
import { useTranslation } from '../../hooks/useTranslation';

/** How long "Copied" stays on a button. */
const COPIED_MS = 2000;

/**
 * "How to pay": MargixIndia's bank account and UPI id from Settings, each with a copy button. Until
 * staff have saved any, it says the details will be shared.
 */
export function PaymentDetailsCard({ invoiceId }: { invoiceId?: string } = {}) {
  const { t } = useTranslation();
  // With an invoice, the details of the company that issued it
  const { data, loading, error, reload } = useRemote(() => api.getPaymentDetails(invoiceId), `payment-details:${invoiceId ?? ''}`, t('pay_load_failed'));

  const rows: { label: string; value: string | null; mono?: boolean }[] = data
    ? [
        { label: t('pay_account_name'), value: data.account_name },
        { label: t('pay_bank'), value: data.bank_name },
        { label: t('pay_account_no'), value: data.bank_account_no, mono: true },
        { label: t('pay_ifsc'), value: data.bank_ifsc, mono: true },
        { label: t('pay_upi'), value: data.upi_id, mono: true },
      ]
    : [];

  return (
    <Card style={styles.card}>
      <Text variant="title" accessibilityRole="header">
        {t('pay_title')}
      </Text>
      {!data && loading ? <ActivityIndicator color={colors.accent} /> : null}
      {error && !data ? <ErrorBanner message={error} action={{ label: t('try_again'), onPress: reload }} /> : null}
      {data && !data.available ? <Text variant="bodySmall" color="textMuted">{t('pay_pending')}</Text> : null}
      {data?.available ? (
        <>
          {rows.map((row) => (row.value ? <DetailRow key={row.label} label={row.label} value={row.value} mono={row.mono} /> : null))}
          <Text variant="bodySmall" color="textMuted">
            {t('pay_terms', { days: data.payment_terms_days })}
          </Text>
        </>
      ) : null}
    </Card>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Copying is a convenience: the value is on screen to read out or type.
    }
  };

  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text variant="caption" color="textMuted">
          {label}
        </Text>
        <Text variant="bodyMedium" selectable style={mono ? styles.mono : null}>
          {value}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('copy_hint', { label })}
        onPress={copy}
        style={({ pressed }) => [styles.copy, pressed ? styles.pressed : null]}
      >
        <Feather name={copied ? 'check' : 'copy'} size={size.icon.md} color={colors.accent} />
        <Text variant="bodySmallMedium" color="accent">
          {copied ? t('copied') : t('copy')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1 },
  mono: { fontFamily: fontFamily.mono },
  copy: { flexDirection: 'row', alignItems: 'center', gap: space[1], minHeight: size.control, paddingHorizontal: space[2] },
  pressed: { opacity: 0.6 },
});
