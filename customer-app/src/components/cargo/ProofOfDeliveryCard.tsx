import React, { useState } from 'react';
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { Card, Text } from '../ui';
import { colors, radius, size, space } from '../../theme';
import type { ProofOfDelivery } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import { formatDateTime } from '../../utils/format';

/** The delivery photo and signature (short-lived signed URLs), who received the goods and when. */
export function ProofOfDeliveryCard({ pod, title }: { pod: ProofOfDelivery; title?: string }) {
  const { t } = useTranslation();
  if (!pod.photo_url && !pod.signature_url && !pod.receiver_name && !pod.delivered_at) return null;

  return (
    <Card style={styles.card}>
      <Text variant="title" accessibilityRole="header">
        {title ?? t('pod_title')}
      </Text>
      {pod.receiver_name ? <Row label={t('pod_received_by')} value={pod.receiver_name} /> : null}
      {pod.delivered_at ? <Row label={t('pod_delivered_at')} value={formatDateTime(pod.delivered_at)} /> : null}
      {pod.photo_url ? <ProofImage key={pod.photo_url} uri={pod.photo_url} label={t('pod_photo')} style={styles.photo} /> : null}
      {pod.signature_url ? <ProofImage key={pod.signature_url} uri={pod.signature_url} label={t('pod_signature')} style={styles.signature} contain /> : null}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="bodyMedium">{value}</Text>
    </View>
  );
}

/** Signed URLs expire, so a failed load says so instead of leaving an empty box. */
function ProofImage({ uri, label, style, contain }: { uri: string; label: string; style: StyleProp<ImageStyle>; contain?: boolean }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.row}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      {failed ? (
        <Text variant="bodySmall" color="textMuted">
          {t('pod_image_failed')}
        </Text>
      ) : (
        <Image
          source={{ uri }}
          style={[styles.image, style]}
          resizeMode={contain ? 'contain' : 'cover'}
          accessible
          accessibilityRole="image"
          accessibilityLabel={label}
          onError={() => setFailed(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  row: { gap: space[1] },
  image: {
    alignSelf: 'stretch',
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  photo: { aspectRatio: 4 / 3 },
  signature: { aspectRatio: 3, backgroundColor: colors.surface },
});
