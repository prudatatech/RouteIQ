import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Vibration, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { Button, Text } from '../ui';
import { space } from '../../theme';

export const SOS_COUNTDOWN_S = 5;

interface SosCountdownDialogProps {
  onSend: () => void;
  onCancel: () => void;
}

/** "Sending SOS…" with a cancel button; sends by itself when the count ends. */
export default function SosCountdownDialog({ onSend, onCancel }: SosCountdownDialogProps) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(SOS_COUNTDOWN_S);
  const sendRef = useRef(onSend);
  sendRef.current = onSend;

  useEffect(() => {
    Vibration.vibrate(50);
    const timer = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (left === 0) sendRef.current();
  }, [left]);

  return (
    <>
      <View style={styles.header} accessibilityLiveRegion="assertive">
        <Text variant="heading" color="danger" align="center" accessibilityRole="header">
          {t('sos_countdown_title')}
        </Text>
        <Text variant="display" color="danger" align="center">
          {Math.max(left, 0)}
        </Text>
        <Text variant="bodySmall" color="textMuted" align="center">
          {t('sos_countdown_desc').replace('{n}', String(Math.max(left, 0)))}
        </Text>
      </View>
      <Button title={t('cancel')} variant="secondary" onPress={onCancel} />
      <Button title={t('sos_send_now')} variant="danger" onPress={onSend} />
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[2], paddingVertical: space[2] },
});
