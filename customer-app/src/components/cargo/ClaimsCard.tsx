import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button, Card, ErrorBanner, StatusPill, Text } from '../ui';
import { colors, fontFamily, size, space } from '../../theme';
import type { Claim } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import { CLAIM_STATUS, CLAIM_TYPES, CLAIM_WINDOW_DAYS } from '../../utils/cargo';
import { formatDate, formatDateTime, formatINR } from '../../utils/format';

interface Props {
  claims: Claim[];
  /** true: a claim can be raised now; false: the window has closed; null: not delivered yet. */
  windowOpen: boolean | null;
  /** The last moment a claim can be raised, when known. */
  closesAt: string | null;
  /** Without a shipment reference the server cannot take a claim, so the button is hidden. */
  canRaise: boolean;
  onRaise: () => void;
  error?: string;
  onRetry: () => void;
}

/** Raise a claim within the window after delivery, and follow the claims already made. */
export function ClaimsCard({ claims, windowOpen, closesAt, canRaise, onRaise, error, onRetry }: Props) {
  const { t } = useTranslation();
  const showRaise = windowOpen === true && canRaise;
  if (claims.length === 0 && !showRaise && windowOpen !== false && !error) return null;

  return (
    <Card style={styles.card}>
      <Text variant="title" accessibilityRole="header">
        {t('claims_title')}
      </Text>
      {error ? <ErrorBanner message={error} action={{ label: t('try_again'), onPress: onRetry }} /> : null}

      {claims.map((claim) => (
        <ClaimRow key={claim.id} claim={claim} />
      ))}

      {showRaise ? (
        <>
          <Text variant="bodySmall" color="textMuted">
            {closesAt ? t('claims_until', { date: formatDateTime(closesAt) }) : t('claims_within', { days: CLAIM_WINDOW_DAYS })}
          </Text>
          <Button
            title={t('claims_raise')}
            variant="secondary"
            icon={(color) => <Feather name="file-plus" size={size.icon.md} color={color} />}
            accessibilityHint={t('claims_raise_hint')}
            onPress={onRaise}
          />
        </>
      ) : null}
      {windowOpen === false ? (
        <Text variant="bodySmall" color="textMuted">
          {t('claims_closed', { days: CLAIM_WINDOW_DAYS })}
        </Text>
      ) : null}
    </Card>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  const { t } = useTranslation();
  const status = CLAIM_STATUS[claim.status] ?? { label: 'claim_status_filed', tone: 'info' as const };
  const type = (CLAIM_TYPES as string[]).includes(claim.claim_type ?? '') ? t(`claim_type_${claim.claim_type}`) : t('claim');
  const amounts = [
    claim.claimed_amount != null ? t('claim_amount_claimed', { amount: formatINR(claim.claimed_amount) }) : null,
    claim.approved_amount != null ? t('claim_amount_approved', { amount: formatINR(claim.approved_amount) }) : null,
    claim.settled_amount != null ? t('claim_amount_settled', { amount: formatINR(claim.settled_amount) }) : null,
  ].filter((a): a is string => a !== null);
  const dates = [
    claim.created_at ? t('claim_filed_on', { date: formatDate(claim.created_at) }) : null,
    claim.settled_at ? t('claim_settled_on', { date: formatDate(claim.settled_at) }) : null,
  ].filter((d): d is string => d !== null);

  return (
    <View style={styles.claim} accessible accessibilityLabel={[type, claim.code, t(status.label), ...amounts, ...dates].filter(Boolean).join(', ')}>
      <View style={styles.claimHeader}>
        <View style={styles.flex}>
          <Text variant="bodyMedium">{type}</Text>
          {claim.code ? (
            <Text variant="caption" color="textMuted" style={styles.mono}>
              {claim.code}
            </Text>
          ) : null}
        </View>
        <StatusPill label={t(status.label)} tone={status.tone} />
      </View>
      {amounts.map((a) => (
        <Text key={a} variant="bodySmall">
          {a}
        </Text>
      ))}
      {dates.length ? (
        <Text variant="caption" color="textMuted">
          {dates.join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  claim: { gap: space[1], paddingTop: space[3], borderTopWidth: size.border, borderTopColor: colors.border },
  claimHeader: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  mono: { fontFamily: fontFamily.mono },
});
