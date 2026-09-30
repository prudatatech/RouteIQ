import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Banner, Button, Card, ErrorBanner, Text, TextField } from '../ui';
import { colors, radius, size, space } from '../../theme';
import { api, newIdempotencyKey, type BookingCargo, type ClaimType } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import { CLAIM_TYPES } from '../../utils/cargo';

const STARS = [1, 2, 3, 4, 5];

interface Props {
  bookingId: string;
  /** Set when the server already has the customer's confirmation. */
  receipt: BookingCargo['receipt'];
  onConfirmed: () => void;
}

/**
 * After delivery: confirm the goods arrived, rate the trip and optionally report a problem. A
 * problem is sent as `issue: { type, description, claimed_amount? }`, and the server opens a claim
 * of that type. A delivery is rated once; a second try answers 409.
 */
export function ConfirmReceiptCard({ bookingId, receipt, onConfirmed }: Props) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [reporting, setReporting] = useState(false);
  const [issue, setIssue] = useState('');
  const [issueType, setIssueType] = useState<ClaimType | null>(null);
  const [issueAmount, setIssueAmount] = useState('');
  const [issueError, setIssueError] = useState<string | undefined>();
  const [typeError, setTypeError] = useState<string | undefined>();
  const [amountError, setAmountError] = useState<string | undefined>();
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ issue: boolean } | null>(null);
  // One key per form, so a resend after a lost reply is applied once.
  const [idempotencyKey] = useState(newIdempotencyKey);

  if (sent) {
    return <Banner tone="info" icon="check-circle" message={sent.issue ? t('receipt_thanks_issue') : t('receipt_thanks')} />;
  }
  if (receipt || alreadyRated) {
    return (
      <Banner
        tone="info"
        icon="check-circle"
        message={receipt?.rating != null ? t('receipt_done_rating', { n: receipt.rating }) : t('receipt_done')}
      />
    );
  }

  const submit = async () => {
    const issueText = issue.trim();
    const amountText = issueAmount.replace(/,/g, '').trim();
    const amount = amountText ? Number(amountText) : undefined;
    const badAmount = amountText !== '' && !(/^\d+(\.\d{1,2})?$/.test(amountText) && Number(amountText) > 0);
    const missingType = reporting && !issueType;
    // The server wants at least a few words describing the problem
    const missingText = reporting && issueText.length < 3;
    setTypeError(missingType ? t('claim_type_required') : undefined);
    setIssueError(missingText ? t('receipt_issue_required') : undefined);
    setAmountError(reporting && badAmount ? t('claim_amount_invalid') : undefined);
    if (missingType || missingText || (reporting && badAmount)) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.confirmReceipt(
        bookingId,
        {
          rating,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
          ...(reporting && issueType
            ? { issue: { type: issueType, description: issueText, ...(amount !== undefined ? { claimed_amount: amount } : {}) } }
            : {}),
        },
        idempotencyKey,
      );
      setSent({ issue: reporting });
      onConfirmed();
    } catch (e: any) {
      // Rated already (from another phone, or a reply that was lost): show it as done
      if (typeof e?.message === 'string' && /already been rated/i.test(e.message)) {
        setAlreadyRated(true);
        onConfirmed();
        return;
      }
      setError(e?.message || t('receipt_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Text variant="title" accessibilityRole="header">
        {t('receipt_title')}
      </Text>
      <Text variant="bodySmall" color="textMuted">
        {t('receipt_body')}
      </Text>

      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel={t('receipt_rating')}>
        {STARS.map((n) => {
          const on = n <= rating;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ checked: rating === n }}
              accessibilityLabel={t('receipt_stars', { n })}
              onPress={() => setRating(n)}
              style={({ pressed }) => [styles.star, pressed ? styles.pressed : null]}
            >
              <MaterialCommunityIcons name={on ? 'star' : 'star-outline'} size={size.icon.xl} color={on ? colors.accent : colors.textMuted} />
            </Pressable>
          );
        })}
      </View>

      <TextField
        label={t('receipt_comment')}
        value={comment}
        onChangeText={setComment}
        multiline
        maxLength={500}
        placeholder={t('receipt_comment_placeholder')}
      />

      <View style={styles.toggle}>
        <Text variant="bodyMedium" style={styles.flex}>
          {t('receipt_report_issue')}
        </Text>
        <Switch
          value={reporting}
          onValueChange={setReporting}
          accessibilityLabel={t('receipt_report_issue')}
          trackColor={{ true: colors.accentFill, false: colors.borderStrong }}
          thumbColor={colors.surface}
        />
      </View>
      {reporting ? (
        <>
          <Text variant="bodySmallMedium" nativeID="receipt-issue-type">
            {t('claim_what_happened')}
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabelledBy="receipt-issue-type">
            {CLAIM_TYPES.map((type) => {
              const selected = issueType === type;
              return (
                <Pressable
                  key={type}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={t(`claim_type_${type}`)}
                  onPress={() => setIssueType(type)}
                  style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
                >
                  <Text variant="bodySmallMedium" color={selected ? 'accent' : 'text'}>
                    {t(`claim_type_${type}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {typeError ? (
            <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
              {typeError}
            </Text>
          ) : null}
          <TextField
            label={t('receipt_issue')}
            hint={t('receipt_issue_hint')}
            value={issue}
            onChangeText={setIssue}
            multiline
            maxLength={1000}
            error={issueError}
          />
          <TextField
            label={t('claim_amount')}
            hint={t('claim_amount_hint')}
            value={issueAmount}
            onChangeText={setIssueAmount}
            keyboardType="decimal-pad"
            placeholder="₹"
            error={amountError}
          />
        </>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      <Button
        title={t('receipt_submit')}
        loading={submitting}
        disabled={rating === 0}
        accessibilityHint={rating === 0 ? t('receipt_choose_rating') : undefined}
        onPress={submit}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  stars: { flexDirection: 'row', gap: space[1] },
  star: { width: size.control, height: size.control, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: size.control },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
});
