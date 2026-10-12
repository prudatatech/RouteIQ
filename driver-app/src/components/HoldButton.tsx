import { useTranslation } from '../hooks/useTranslation';
import React, { useRef, useState } from 'react';
import { View, Pressable, Animated, StyleSheet } from 'react-native';
import { Text } from './ui';
import { colors, radius, size, type } from '../theme';

type HoldTone = 'accent' | 'danger';

const TONE: Record<HoldTone, { border: string; fill: string; text: string; textActive: string }> = {
  accent: { border: colors.accentFill, fill: colors.accentFill, text: colors.accent, textActive: colors.onAccentFill },
  danger: { border: colors.danger, fill: colors.danger, text: colors.danger, textActive: colors.onSolid },
};

interface HoldButtonProps {
  onComplete: () => void;
  title: string;
  tone?: HoldTone;
  duration?: number;
  disabled?: boolean;
}

/** Press and hold to confirm; releasing early cancels. */
export default function HoldButton({ onComplete, title, tone = 'accent', duration = 1200, disabled = false }: HoldButtonProps) {
  const { t } = useTranslation();
  const [isPressing, setIsPressing] = useState(false);
  const fillAnim = useRef(new Animated.Value(0)).current;
  const toneColors = TONE[tone];

  const handlePressIn = () => {
    if (disabled) return;
    setIsPressing(true);
    Animated.timing(fillAnim, {
      toValue: 1,
      duration,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        onComplete();
        // Snap back after completion
        Animated.timing(fillAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
        setIsPressing(false);
      }
    });
  };

  const handlePressOut = () => {
    if (disabled) return;
    setIsPressing(false);
    Animated.timing(fillAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };

  const widthInterpolate = fillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={t('hold_hint')}
      accessibilityState={{ disabled }}
      // Screen readers cannot hold: double-tap performs the action instead.
      accessibilityActions={[{ name: 'activate', label: title }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate' && !disabled) onComplete();
      }}
    >
      <View style={[styles.container, { borderColor: toneColors.border }, disabled ? styles.disabled : null]}>
        <Animated.View style={[styles.fill, { backgroundColor: toneColors.fill, width: widthInterpolate }]} />
        <View style={styles.textContainer}>
          <Text style={[type.label, { color: isPressing ? toneColors.textActive : toneColors.text }]}>
            {isPressing ? t('btn_holding') : title}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    height: size.control + 8,
    width: '100%',
    borderRadius: radius.control,
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  disabled: { opacity: 0.5 },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  textContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
