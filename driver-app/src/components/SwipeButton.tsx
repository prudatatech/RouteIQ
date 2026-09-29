import { useTranslation } from '../hooks/useTranslation';
import React, { useRef, useState, useEffect } from 'react';
import { View, StyleSheet, Animated, PanResponder, Vibration, type AccessibilityActionEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './ui';
import { colors, radius, size, space, type } from '../theme';

const BUTTON_HEIGHT = 56;
const THUMB_SIZE = 48;
const INSET = (BUTTON_HEIGHT - THUMB_SIZE) / 2;
/** Share of the track the thumb must travel before release confirms. */
const CONFIRM_AT = 0.8;

type SwipeTone = 'accent' | 'success' | 'danger';

const TONE: Record<SwipeTone, { thumb: string; icon: string; fill: string }> = {
  accent: { thumb: colors.accentFill, icon: colors.onAccentFill, fill: colors.accentSoft },
  success: { thumb: colors.success, icon: colors.onSolid, fill: colors.successSoft },
  danger: { thumb: colors.danger, icon: colors.onSolid, fill: colors.dangerSoft },
};

interface SwipeButtonProps {
  title: string;
  /**
   * Called once the swipe is confirmed. Return (or resolve) `false`, or throw,
   * to reset the button so the driver can try again.
   */
  onComplete: () => unknown;
  tone?: SwipeTone;
  isCompleted?: boolean;
  disabled?: boolean;
}

/** Swipe-to-confirm for actions that must not happen by accident. */
export default function SwipeButton({ title, onComplete, tone = 'accent', isCompleted = false, disabled = false }: SwipeButtonProps) {
  const { t } = useTranslation();
  const [completed, setCompleted] = useState(isCompleted);
  const [width, setWidth] = useState(0);
  const pan = useRef(new Animated.Value(0)).current;
  const labelOpacity = useRef(new Animated.Value(1)).current;

  // The pan responder is created once, so it reads live values through refs.
  const maxSlideRef = useRef(0);
  const completedRef = useRef(completed);
  const disabledRef = useRef(disabled);
  const onCompleteRef = useRef(onComplete);
  maxSlideRef.current = width > 0 ? width - THUMB_SIZE - INSET * 2 : 0;
  completedRef.current = completed;
  disabledRef.current = disabled;
  onCompleteRef.current = onComplete;

  const reset = () => {
    setCompleted(false);
    Animated.spring(pan, { toValue: 0, friction: 6, useNativeDriver: false }).start();
    Animated.timing(labelOpacity, { toValue: 1, duration: 150, useNativeDriver: false }).start();
  };

  const confirm = async () => {
    Vibration.vibrate(50);
    setCompleted(true);
    try {
      const result = await onCompleteRef.current();
      if (result === false) reset();
    } catch {
      reset();
    }
  };

  useEffect(() => {
    setCompleted(isCompleted);
    if (!isCompleted) {
      pan.setValue(0);
      labelOpacity.setValue(1);
    }
  }, [isCompleted, pan, labelOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !completedRef.current && !disabledRef.current,
      onMoveShouldSetPanResponder: () => !completedRef.current && !disabledRef.current,
      onPanResponderMove: (_e, gesture) => {
        const max = maxSlideRef.current;
        if (max <= 0) return;
        const x = Math.max(0, Math.min(gesture.dx, max));
        pan.setValue(x);
        labelOpacity.setValue(1 - x / max);
      },
      onPanResponderRelease: (_e, gesture) => {
        const max = maxSlideRef.current;
        if (max > 0 && gesture.dx >= max * CONFIRM_AT) {
          Animated.timing(pan, { toValue: max, duration: 120, useNativeDriver: false }).start(() => {
            confirm();
          });
        } else {
          Animated.spring(pan, { toValue: 0, friction: 5, useNativeDriver: false }).start();
          Animated.timing(labelOpacity, { toValue: 1, duration: 150, useNativeDriver: false }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(pan, { toValue: 0, friction: 5, useNativeDriver: false }).start();
        Animated.timing(labelOpacity, { toValue: 1, duration: 150, useNativeDriver: false }).start();
      },
    }),
  ).current;

  // Screen readers cannot swipe: double-tap performs the action instead.
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'activate' && !completed && !disabled) {
      confirm();
    }
  };

  const colorsForTone = TONE[tone];

  if (completed) {
    return (
      <View
        style={[styles.container, { backgroundColor: colorsForTone.fill }]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${t('completed')}`}
        accessibilityState={{ disabled: true, busy: true }}
      >
        <View style={styles.completedRow}>
          <Ionicons name="checkmark-circle" size={size.icon.md} color={colors.text} />
          <Text variant="label">{t('completed')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, disabled ? styles.disabled : null]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={t('swipe_hint')}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'activate', label: title }]}
      onAccessibilityAction={onAccessibilityAction}
    >
      <Animated.View
        style={[
          styles.trackFill,
          {
            backgroundColor: colorsForTone.fill,
            width: Animated.add(pan, THUMB_SIZE + INSET * 2),
          },
        ]}
      />
      <Animated.Text style={[styles.title, { opacity: labelOpacity }]} numberOfLines={1}>
        {title}
      </Animated.Text>
      {width > 0 && (
        <Animated.View
          {...panResponder.panHandlers}
          style={[styles.thumb, { backgroundColor: colorsForTone.thumb, transform: [{ translateX: pan }] }]}
        >
          <Ionicons name="chevron-forward" size={size.icon.lg} color={colorsForTone.icon} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: BUTTON_HEIGHT,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.full,
    borderWidth: size.border,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  disabled: { opacity: 0.5 },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.full,
  },
  title: {
    ...type.label,
    color: colors.text,
    paddingHorizontal: THUMB_SIZE + space[3],
  },
  completedRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  thumb: {
    position: 'absolute',
    left: INSET,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
