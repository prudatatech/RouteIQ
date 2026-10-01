import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, ErrorBanner, OptionPicker, StatusPill, Text, TextField } from '../ui';
import { api, newIdempotencyKey, type Invoice, type InvoiceReport } from '../../services/api';
import type { TranslateFn } from '../../hooks/useTranslation';
import { dayKey, formatDate, formatINR } from '../../utils/format';
import { istDay, reportStatus, REPORT_METHODS, type ReportMethod } from '../../utils/invoiceReports';
import { amountError, paidOnError, parseAmount, queryError, referenceError, METHODS_WITHOUT_REFERENCE, QUERY_MAX, REFERENCE_MAX } from '../../utils/validation';
import { space } from '../../theme';

/** Keeps one idempotency key per unchanged form, so a resend after a lost reply creates only one report. */
function useSubmitKey() {
  const key = useRef<string | null>(null);
  return { next: () => (key.current ??= newIdempotencyKey()), reset: () => (key.current = null) };
}

/** "I have paid": tells MargixIndia about a payment so staff can check it and mark the invoice paid. */
export function PaymentReportForm({ invoice, t, onSent, onCancel }: { invoice: Invoice; t: TranslateFn; onSent: () => void; onCancel: () => void }) {
  const due = invoice.outstanding;
  const [amount, setAmount] = useState(String(due));
  const [paidOn, setPaidOn] = useState(() => dayKey(0));
  const [method, setMethod] = useState<ReportMethod>('upi');
  const [reference, setReference] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const submitKey = useSubmitKey();

  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setServerError(null);
    submitKey.reset();
  };

  const errors = {
    amount: amountError(amount, due),
    paidOn: paidOnError(paidOn.trim(), dayKey(0), istDay(invoice.issued_at)),
    reference: referenceError(reference, method),
  };
  const msg = (k: keyof typeof errors) => (showErrors && errors[k] ? t(errors[k] as string, { max: formatINR(due) }) : undefined);
  const needsReference = !METHODS_WITHOUT_REFERENCE.includes(method);

  const send = async () => {
    setServerError(null);
    if (Object.values(errors).some(Boolean)) {
      setShowErrors(true);
      return;
    }
    setSending(true);
    try {
      await api.createInvoiceReport(
        invoice.id,
        { kind: 'payment', amount: parseAmount(amount) as number, paid_on: paidOn.trim(), method, ...(reference.trim() ? { reference: reference.trim() } : {}) },
        submitKey.next(),
      );
      submitKey.reset();
      onSent();
    } catch (e: any) {
      setServerError(e?.message || t('err_server'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card style={styles.form}>
      <Text variant="title" accessibilityRole="header">
        {t('report_paid_title')}
      </Text>
      <TextField label={t('report_amount')} value={amount} onChangeText={edit(setAmount)} keyboardType="decimal-pad" error={msg('amount')} />
      <TextField
        label={t('report_paid_on')}
        hint={t('report_date_hint')}
        value={paidOn}
        onChangeText={edit(setPaidOn)}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        maxLength={10}
        error={msg('paidOn')}
      />
      <OptionPicker
        label={t('report_method')}
        value={method}
        options={REPORT_METHODS.map((m) => ({ value: m, label: t(`report_method_${m}`) }))}
        onChange={(m) => edit(setMethod)(m as ReportMethod)}
        placeholder={t('report_method')}
        closeLabel={t('close')}
      />
      <TextField
        label={needsReference ? t('report_reference') : t('report_reference_optional')}
        hint={t('report_reference_hint')}
        value={reference}
        onChangeText={edit(setReference)}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={REFERENCE_MAX}
        error={msg('reference')}
      />
      {serverError ? <ErrorBanner message={serverError} /> : null}
      <Button title={t('report_send')} onPress={send} loading={sending} disabled={sending} />
      <Button title={t('cancel')} variant="ghost" onPress={onCancel} disabled={sending} />
    </Card>
  );
}

/** "Ask about this invoice": a question that staff answer on the invoice. */
export function QueryReportForm({ invoice, t, onSent, onCancel }: { invoice: Invoice; t: TranslateFn; onSent: () => void; onCancel: () => void }) {
  const [message, setMessage] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const submitKey = useSubmitKey();
  const error = queryError(message);

  const send = async () => {
    setServerError(null);
    if (error) {
      setShowErrors(true);
      return;
    }
    setSending(true);
    try {
      await api.createInvoiceReport(invoice.id, { kind: 'query', message: message.trim() }, submitKey.next());
      submitKey.reset();
      onSent();
    } catch (e: any) {
      setServerError(e?.message || t('err_server'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card style={styles.form}>
      <Text variant="title" accessibilityRole="header">
        {t('report_ask_title')}
      </Text>
      <TextField
        label={t('report_message')}
        value={message}
        onChangeText={(v) => {
          setMessage(v);
          setServerError(null);
          submitKey.reset();
        }}
        multiline
        maxLength={QUERY_MAX}
        error={showErrors && error ? t(error) : undefined}
      />
      {serverError ? <ErrorBanner message={serverError} /> : null}
      <Button title={t('report_send')} onPress={send} loading={sending} disabled={sending} />
      <Button title={t('cancel')} variant="ghost" onPress={onCancel} disabled={sending} />
    </Card>
  );
}

/** What this customer has sent about the invoice, newest first, each with where it stands and the staff reply. */
export function ReportsList({ reports, t }: { reports: InvoiceReport[]; t: TranslateFn }) {
  if (reports.length === 0) return null;
  return (
    <View style={styles.list}>
      <Text variant="title" accessibilityRole="header">
        {t('reports_title')}
      </Text>
      {reports.map((r) => {
        const status = reportStatus(r);
        const answered = r.status === 'rejected' || r.status === 'answered';
        return (
          <Card key={r.id} style={styles.report}>
            <View style={styles.top}>
              <Text variant="bodyMedium" style={styles.flex}>
                {t(r.kind === 'payment' ? 'report_kind_payment' : 'report_kind_query')}
              </Text>
              <StatusPill label={t(status.labelKey)} tone={status.tone} />
            </View>
            {r.kind === 'payment' ? (
              <>
                <Text variant="body">
                  {t('report_paid_line', {
                    amount: r.amount != null ? formatINR(r.amount) : '',
                    date: r.paid_on ? formatDate(`${r.paid_on}T12:00:00+05:30`) : '',
                    method: r.method ? t(`report_method_${r.method}`) : '',
                  })}
                </Text>
                {r.reference ? (
                  <Text variant="bodySmall" color="textMuted">
                    {t('invoice_reference', { ref: r.reference })}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text variant="body">{r.message}</Text>
            )}
            {answered && r.staff_note ? (
              <Text variant="bodySmall" color={r.status === 'rejected' ? 'danger' : 'text'}>
                {t(r.status === 'rejected' ? 'report_reason' : 'report_answer', { note: r.staff_note })}
              </Text>
            ) : null}
            <Text variant="caption" color="textMuted">
              {t('report_sent_on', { date: formatDate(r.created_at) })}
            </Text>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[3] },
  list: { gap: space[3] },
  report: { gap: space[1] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  flex: { flex: 1 },
});
