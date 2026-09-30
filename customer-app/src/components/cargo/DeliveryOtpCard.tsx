import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button, Card, Text } from '../ui';
import { colors, size, space } from '../../theme';
import { api, type NotificationItem } from '../../services/api';
import { useRemote } from '../../hooks/useRemote';
import { useTranslation } from '../../hooks/useTranslation';

/** The notification type the backend uses when it sends the delivery code. */
const OTP_NOTIFICATION = 'cargo_delivery_otp';

interface Props {
  bookingId: string;
  trackingId: string | null;
  shipmentId: string | null;
  /** When the server says the code was sent. Without it, the customer's notifications are checked. */
  sentAt: string | null;
  /** Changes on every refresh of the booking, so a code sent meanwhile is picked up. */
  refreshKey: number;
  onOpenNotifications: () => void;
}

const isForThisShipment = (n: NotificationItem, p: Props) => {
  const d = n.data ?? {};
  return (
    (d.booking_id != null && d.booking_id === p.bookingId) ||
    (p.trackingId != null && d.tracking_id === p.trackingId) ||
    (p.shipmentId != null && (d.shipment_id === p.shipmentId || d.ref?.shipment_id === p.shipmentId))
  );
};

/**
 * Tells the customer to give the delivery code to the driver at handover.
 * The code itself only lives in the notification (the server stores a hash),
 * so it is never shown here.
 */
export function DeliveryOtpCard(props: Props) {
  const { t } = useTranslation();
  const { sentAt, bookingId, refreshKey } = props;
  const { data } = useRemote(
    () => (sentAt ? Promise.resolve(null) : api.getNotifications({ limit: 50 })),
    `otp:${bookingId}:${sentAt ? 'sent' : refreshKey}`,
  );
  const sent = !!sentAt || !!data?.notifications.some((n) => n.type === OTP_NOTIFICATION && isForThisShipment(n, props));
  if (!sent) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Feather name="key" size={size.icon.md} color={colors.accent} />
        <Text variant="title" accessibilityRole="header" style={styles.flex}>
          {t('otp_title')}
        </Text>
      </View>
      <Text variant="bodySmall" color="textMuted">
        {t('otp_body')}
      </Text>
      <Button
        title={t('otp_open_notifications')}
        variant="secondary"
        accessibilityHint={t('otp_open_hint')}
        onPress={props.onOpenNotifications}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
});
