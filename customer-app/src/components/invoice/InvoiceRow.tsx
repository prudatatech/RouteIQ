import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card, StatusPill, Text } from '../ui';
import { fontFamily, space } from '../../theme';
import type { Invoice } from '../../services/api';
import type { TranslateFn } from '../../hooks/useTranslation';
import { formatDate, formatINR } from '../../utils/format';
import { INVOICE_TONE, invoiceState } from '../../utils/invoices';

const placeName = (address: string) => address.split(',')[0].trim() || address;

/** The one line under an invoice's number: when it was paid, or when it is due (and how late it is). */
export function invoiceDateLine(invoice: Invoice, t: TranslateFn): string {
  const state = invoiceState(invoice);
  if (state === 'paid') return invoice.paid_at ? t('invoice_paid_on', { date: formatDate(invoice.paid_at) }) : t('invoice_status_paid');
  const due = invoice.due_date ? t('invoice_due', { date: formatDate(invoice.due_date) }) : t('invoice_status_unpaid');
  return state === 'overdue' && invoice.days_overdue > 0 ? `${due} · ${t('invoice_overdue_days', { n: invoice.days_overdue })}` : due;
}

/** The status pill of an invoice: Paid, Unpaid, or the Overdue badge. */
export function InvoiceStatePill({ invoice, t }: { invoice: Invoice; t: TranslateFn }) {
  const state = invoiceState(invoice);
  return <StatusPill label={t(`invoice_status_${state}`)} tone={INVOICE_TONE[state]} />;
}

export function InvoiceRow({ invoice, onPress, t }: { invoice: Invoice; onPress: () => void; t: TranslateFn }) {
  const number = invoice.invoice_number ?? invoice.tracking_id ?? '';
  const route = t('route_a_to_b', { from: placeName(invoice.pickup_name), to: placeName(invoice.drop_name) });
  const total = invoice.total != null ? formatINR(invoice.total) : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('invoice_no', { number })}, ${total}, ${t(`invoice_status_${invoiceState(invoice)}`)}, ${invoiceDateLine(invoice, t)}, ${route}`}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      <Card style={styles.card}>
        <View style={styles.top}>
          <Text variant="bodyMedium" style={styles.mono} numberOfLines={1}>
            {number}
          </Text>
          <InvoiceStatePill invoice={invoice} t={t} />
        </View>
        <Text variant="title">{total}</Text>
        <Text variant="bodySmall" color={invoiceState(invoice) === 'overdue' ? 'danger' : 'textMuted'}>
          {invoiceDateLine(invoice, t)}
        </Text>
        <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
          {route}
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[1] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  mono: { fontFamily: fontFamily.mono, flex: 1 },
  pressed: { opacity: 0.8 },
});
