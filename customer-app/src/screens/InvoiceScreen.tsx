import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { Banner, Button, Card, ErrorBanner, ScreenHeader, Text } from '../components/ui';
import { InvoiceStatePill, invoiceDateLine } from '../components/invoice/InvoiceRow';
import { PaymentDetailsCard } from '../components/invoice/PaymentDetailsCard';
import { PaymentReportForm, QueryReportForm, ReportsList } from '../components/invoice/InvoiceReports';
import { colors, fontFamily, size, space } from '../theme';
import { api, type Invoice } from '../services/api';
import { useRemote } from '../hooks/useRemote';
import { useTranslation, type TranslateFn } from '../hooks/useTranslation';
import { formatDate, formatINR } from '../utils/format';

/**
 * One invoice: amounts, dates and status, how to pay while it is unpaid, the PDF, and the booking it
 * bills. A tapped invoice notification opens this screen with the invoice id.
 */
export default function InvoiceScreen({ navigation, route }: any) {
  const { t } = useTranslation();
  const id: string = route.params.id;
  // There is no single-invoice endpoint for customers: the list is small and carries everything shown here.
  const { data, loading, error, reload } = useRemote(() => api.listInvoices(), 'invoices', t('invoices_load_failed'));
  const invoice = data?.find((i) => i.id === id);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title={t('invoice_title')} onBack={() => navigation.goBack()} backLabel={t('back')} />
      {!data ? (
        <View style={styles.center}>
          {loading ? <ActivityIndicator color={colors.accent} /> : <ErrorBanner message={error ?? t('invoices_load_failed')} action={{ label: t('try_again'), onPress: reload }} />}
        </View>
      ) : !invoice ? (
        <View style={styles.center}>
          <ErrorBanner message={t('invoice_not_found')} />
        </View>
      ) : (
        <Details invoice={invoice} loading={loading} reload={reload} navigation={navigation} t={t} />
      )}
    </SafeAreaView>
  );
}

function Details({ invoice, loading, reload, navigation, t }: { invoice: Invoice; loading: boolean; reload: () => void; navigation: any; t: TranslateFn }) {
  const [busy, setBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const paid = invoice.status === 'paid';
  const [form, setForm] = useState<'paid' | 'ask' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reports = useRemote(() => api.listInvoiceReports(invoice.id), `reports-${invoice.id}`, t('reports_load_failed'));
  // A reply from MargixIndia arrives while this screen is closed: look again whenever it is shown.
  const reloadReports = reports.reload;
  useFocusEffect(
    useCallback(() => {
      reloadReports();
    }, [reloadReports]),
  );
  const sent = (kind: 'paid' | 'ask') => {
    setForm(null);
    setNotice(t(kind === 'paid' ? 'report_sent_paid' : 'report_sent_query'));
    reloadReports();
  };
  const open = (next: 'paid' | 'ask') => {
    setNotice(null);
    setForm(next);
  };

  const openPdf = async () => {
    setBusy(true);
    setPdfError(null);
    let uri: string;
    try {
      uri = await api.downloadInvoicePdf(invoice.id, invoice.invoice_number);
    } catch {
      setPdfError(t('invoice_pdf_failed'));
      setBusy(false);
      return;
    }
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('unavailable');
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: t('invoice_share_title') });
    } catch {
      setPdfError(t('invoice_share_unavailable'));
    } finally {
      setBusy(false);
    }
  };

  const method = invoice.payment_method ? t(`pay_method_${invoice.payment_method}`) : null;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.accent} />}
    >
      <Card style={styles.card}>
        <View style={styles.top}>
          <Text variant="title" style={styles.mono} numberOfLines={1}>
            {invoice.invoice_number ?? invoice.tracking_id ?? ''}
          </Text>
          <InvoiceStatePill invoice={invoice} t={t} />
        </View>
        <Text variant="bodySmall" color={invoice.overdue ? 'danger' : 'textMuted'}>
          {invoiceDateLine(invoice, t)}
        </Text>
        {invoice.issued_at ? (
          <Text variant="caption" color="textMuted">
            {t('invoice_issued_on', { date: formatDate(invoice.issued_at) })}
          </Text>
        ) : null}

        <View style={styles.amounts}>
          {invoice.amount != null ? <Line label={t('invoice_freight')} value={formatINR(invoice.amount)} /> : null}
          {invoice.gst_amount != null && invoice.gst_amount > 0 ? <Line label={t('invoice_gst')} value={formatINR(invoice.gst_amount)} /> : null}
          {invoice.total != null ? <Line label={t('invoice_total')} value={formatINR(invoice.total)} strong /> : null}
        </View>

        {paid && (method || invoice.payment_reference) ? (
          <Text variant="bodySmall" color="textMuted">
            {[method ? t('invoice_paid_via', { method }) : null, invoice.payment_reference ? t('invoice_reference', { ref: invoice.payment_reference }) : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        ) : null}
        {invoice.tracking_id ? (
          <Text variant="caption" color="textMuted" style={styles.mono}>
            {invoice.tracking_id}
          </Text>
        ) : null}
      </Card>

      {!paid ? <PaymentDetailsCard /> : null}

      {notice ? <Banner tone="info" icon="check-circle" message={notice} /> : null}
      {form === 'paid' ? <PaymentReportForm invoice={invoice} t={t} onSent={() => sent('paid')} onCancel={() => setForm(null)} /> : null}
      {form === 'ask' ? <QueryReportForm invoice={invoice} t={t} onSent={() => sent('ask')} onCancel={() => setForm(null)} /> : null}
      {form === null && !paid ? (
        <Button
          title={t('report_paid_button')}
          icon={(color) => <Feather name="check-circle" size={size.icon.md} color={color} />}
          onPress={() => open('paid')}
        />
      ) : null}
      {form === null ? (
        <Button
          title={t('report_ask_button')}
          variant="secondary"
          icon={(color) => <Feather name="message-circle" size={size.icon.md} color={color} />}
          onPress={() => open('ask')}
        />
      ) : null}
      {reports.error && !reports.data ? <ErrorBanner message={reports.error} action={{ label: t('try_again'), onPress: reloadReports }} /> : null}
      {reports.data ? <ReportsList reports={reports.data} t={t} /> : null}

      {pdfError ? <ErrorBanner message={pdfError} /> : null}
      <Button
        title={t('invoice_download')}
        loading={busy}
        icon={(color) => <Feather name="download" size={size.icon.md} color={color} />}
        onPress={openPdf}
      />
      <Button
        title={t('invoice_view_booking')}
        variant="secondary"
        icon={(color) => <Feather name="package" size={size.icon.md} color={color} />}
        onPress={() => navigation.navigate('BookingDetail', { id: invoice.booking_id })}
      />
    </ScrollView>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={strong ? 'bodyMedium' : 'body'} color={strong ? 'text' : 'textMuted'}>
        {label}
      </Text>
      <Text variant={strong ? 'title' : 'body'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', padding: space[4] },
  content: { padding: space[4], gap: space[4], paddingBottom: space[8] },
  card: { gap: space[2] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  mono: { fontFamily: fontFamily.mono, flexShrink: 1 },
  amounts: { gap: space[1], paddingTop: space[2], marginTop: space[2], borderTopWidth: size.border, borderTopColor: colors.border },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
