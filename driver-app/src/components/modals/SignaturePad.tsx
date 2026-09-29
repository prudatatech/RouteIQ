import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { useTranslation } from '../../hooks/useTranslation';
import { Button, Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface SignaturePadProps {
  /** Called with a local PNG file of the signature. */
  onDone: (uri: string) => void;
  onCancel: () => void;
}

const PAD_HEIGHT = 220;
const MIN_POINTS = 8;

type Point = { x: number; y: number };

const pathOf = (points: Point[]) =>
  points.length === 1
    ? `M${points[0].x} ${points[0].y} l0.1 0.1`
    : points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

/** Drawing pad for the receiver's signature. */
export default function SignaturePad({ onDone, onCancel }: SignaturePadProps) {
  const { t } = useTranslation();
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const captureView = useRef<View>(null);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Keep the dialog's scroll view from taking the gesture
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setStrokes((prev) => [...prev, [{ x: locationX, y: locationY }]]);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setStrokes((prev) => {
            if (prev.length === 0) return prev;
            const next = prev.slice(0, -1);
            next.push([...prev[prev.length - 1], { x: locationX, y: locationY }]);
            return next;
          });
        },
      }),
    [],
  );

  const pointCount = strokes.reduce((n, s) => n + s.length, 0);

  const save = useCallback(async () => {
    if (pointCount < MIN_POINTS) {
      setError(t('pod_signature_empty'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const uri = await captureRef(captureView, { format: 'png', quality: 1, result: 'tmpfile' });
      onDone(uri);
    } catch {
      setError(t('pod_signature_failed'));
    } finally {
      setSaving(false);
    }
  }, [pointCount, onDone, t]);

  return (
    <View style={styles.wrap}>
      <Text variant="heading" accessibilityRole="header">
        {t('pod_signature_title')}
      </Text>
      <Text variant="bodySmall" color="textMuted">
        {t('pod_signature_hint')}
      </Text>

      <View ref={captureView} collapsable={false} style={styles.pad} {...pan.panHandlers} accessibilityLabel={t('pod_signature_title')}>
        <Svg width="100%" height={PAD_HEIGHT} pointerEvents="none">
          {strokes.map((s, i) => (
            <Path key={i} d={pathOf(s)} stroke={colors.text} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
        </Svg>
      </View>

      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          title={t('pod_signature_clear')}
          variant="secondary"
          block={false}
          style={styles.action}
          onPress={() => {
            setStrokes([]);
            setError('');
          }}
          disabled={saving || strokes.length === 0}
        />
        <Button title={t('pod_signature_use')} block={false} style={styles.action} onPress={save} loading={saving} />
      </View>
      <Button title={t('cancel')} variant="ghost" onPress={onCancel} disabled={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  pad: {
    height: PAD_HEIGHT,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
  },
  actions: { flexDirection: 'row', gap: space[3] },
  action: { flex: 1 },
});
