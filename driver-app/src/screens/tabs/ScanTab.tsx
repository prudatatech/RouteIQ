import React, { useCallback, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { ScanOutcome } from '../../hooks/useParcelScan';
import type { RouteStop } from '../../types/route';
import ParcelScanner, { type ScanMethod } from '../../components/scan/ParcelScanner';
import { Button, Card, EmptyState, Text } from '../../components/ui';
import { shortFeedback } from '../../utils/feedback';
import { colors, size, space } from '../../theme';

interface ScanTabProps {
  /** A route with parcels is on the phone, so there is something to check a scan against. */
  hasRoute: boolean;
  onScan: (code: string, method: ScanMethod) => Promise<ScanOutcome>;
  /** Open proof of delivery for the stop the parcel belongs to. */
  onDeliver: (stop: RouteStop) => void;
}

/** Scan a parcel to load it at pickup, or to check it is the right one at a stop. */
export default function ScanTab({ hasRoute, onScan, onDeliver }: ScanTabProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);

  const handle = useCallback(
    async (code: string, method: ScanMethod) => {
      setBusy(true);
      try {
        const result = await onScan(code, method);
        setOutcome(result);
        shortFeedback();
      } finally {
        setBusy(false);
      }
    },
    [onScan],
  );

  if (!hasRoute) {
    return (
      <Card>
        <EmptyState
          icon={<Ionicons name="qr-code-outline" size={size.icon.xl} color={colors.textMuted} />}
          title={t('scan_no_route_title')}
          message={t('scan_no_route_desc')}
        />
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        <Text variant="title" accessibilityRole="header">
          {t('scan_title')}
        </Text>
        <Text variant="bodySmall" color="textMuted">
          {t('scan_hint')}
        </Text>
        <ParcelScanner onCode={handle} busy={busy} />
      </Card>

      {outcome ? <OutcomeCard outcome={outcome} onDeliver={onDeliver} onDismiss={() => setOutcome(null)} /> : null}
    </View>
  );
}

function OutcomeCard({
  outcome,
  onDeliver,
  onDismiss,
}: {
  outcome: ScanOutcome;
  onDeliver: (stop: RouteStop) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();

  let icon: keyof typeof Ionicons.glyphMap = 'checkmark-circle';
  let tint: string = colors.success;
  let title = '';
  let message = '';
  let action: { label: string; onPress: () => void } | null = null;

  switch (outcome.kind) {
    case 'picked_up':
      title = outcome.already ? t('scan_already_picked_up') : t('scan_picked_up_title');
      message = outcome.queued ? `${outcome.code} · ${t('scan_queued')}` : outcome.code;
      break;
    case 'verified': {
      const name = outcome.stop.delivery_point?.name || `${t('stop')} ${outcome.stop.sequence}`;
      title = t('scan_verified_title');
      message = outcome.isNext ? name : `${t('scan_later_stop')} ${outcome.stop.sequence}: ${name}`;
      if (outcome.isNext) action = { label: t('scan_continue_delivery'), onPress: () => onDeliver(outcome.stop) };
      break;
    }
    case 'already_done':
      icon = 'information-circle';
      tint = colors.info;
      title = t('scan_stop_done_title');
      message = outcome.stop.delivery_point?.name || `${t('stop')} ${outcome.stop.sequence}`;
      break;
    case 'not_on_route':
      icon = 'close-circle';
      tint = colors.danger;
      title = t('scan_not_on_route_title');
      message = t('scan_not_on_route_desc');
      break;
    case 'error':
      icon = 'alert-circle';
      tint = colors.danger;
      title = t('scan_failed_title');
      message = outcome.message || t('scan_failed_desc');
      break;
  }

  return (
    <Card style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.outcomeHead}>
        <Ionicons name={icon} size={size.icon.xl} color={tint} />
        <View style={styles.outcomeText}>
          <Text variant="title">{title}</Text>
          {message ? (
            <Text variant="bodySmall" color="textMuted">
              {message}
            </Text>
          ) : null}
        </View>
      </View>
      {action ? <Button title={action.label} onPress={action.onPress} /> : null}
      <Button title={t('scan_another')} variant="secondary" onPress={onDismiss} />
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[4] },
  card: { gap: space[3] },
  outcomeHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  outcomeText: { flex: 1, gap: space[1] },
});
