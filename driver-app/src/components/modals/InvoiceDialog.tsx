import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { Button, Text } from '../ui';
import { colors, size, space } from '../../theme';
import { formatDate, formatINR, formatNumber } from '../../utils/format';

export interface Invoice {
  id: string;
  date: string;
  status?: string;
  pickup?: string;
  drop?: string;
  cargo_type?: string;
  weight_tons?: number;
  distance_km?: number;
  base_pay?: number;
  bonus?: number;
  tax?: number;
  total_payout?: number;
}

const money = (v?: number) => (typeof v === 'number' ? formatINR(v) : '—');

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: 'success' | 'danger' | 'text' }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="bodySmall" color="textMuted">
        {label}
      </Text>
      <Text variant="bodySmallMedium" color={valueColor ?? 'text'} style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

/** Earnings breakdown for one completed trip. */
export default function InvoiceDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header">
          {t('invoice_title')}
        </Text>
        {invoice.date ? (
          <Text variant="bodySmall" color="textMuted">
            {formatDate(invoice.date)}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text variant="captionMedium" color="textMuted">
          {t('trip_details')}
        </Text>
        <Row label={t('pickup_label')} value={invoice.pickup || '—'} />
        <Row label={t('drop_label')} value={invoice.drop || '—'} />
        <Row
          label={t('cargo_label')}
          value={`${invoice.cargo_type || '—'}${typeof invoice.weight_tons === 'number' ? ` (${formatNumber(invoice.weight_tons, { maximumFractionDigits: 1 })} t)` : ''}`}
        />
        <Row label={t('distance_label')} value={typeof invoice.distance_km === 'number' ? `${formatNumber(invoice.distance_km, { maximumFractionDigits: 1 })} km` : '—'} />
      </View>

      <View style={styles.divider} />

      <View style={styles.section}>
        <Text variant="captionMedium" color="textMuted">
          {t('earnings_breakdown')}
        </Text>
        <Row label={t('base_pay')} value={money(invoice.base_pay)} />
        <Row label={t('bonus_label')} value={typeof invoice.bonus === 'number' ? `+${money(invoice.bonus)}` : '—'} valueColor="success" />
        <Row label={t('tax_label')} value={money(invoice.tax)} valueColor="danger" />
      </View>

      <View style={[styles.row, styles.total]}>
        <Text variant="title">{t('total_payout')}</Text>
        <Text variant="heading" color="success">
          {money(invoice.total_payout)}
        </Text>
      </View>

      <Button title={t('close')} onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[1] },
  section: { gap: space[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3] },
  value: { flexShrink: 1, textAlign: 'right' },
  divider: { height: size.border, backgroundColor: colors.border },
  total: { borderTopWidth: size.border * 2, borderTopColor: colors.text, paddingTop: space[3] },
});
