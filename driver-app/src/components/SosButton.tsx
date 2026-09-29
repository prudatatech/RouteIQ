import React, { useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Animated, Easing, Pressable, StyleSheet, Vibration, View } from 'react-native';
import { useTranslation } from '../hooks/useTranslation';
import { Text } from './ui';
import { colors, radius, size, space, type } from '../theme';

/** How long the driver holds to send at once. */
export const SOS_HOLD_MS = 1200;

interface SosButtonProps {
  /** The button was held for the full time: send at once. */
  onHoldComplete: () => void;
  /** A plain tap: start the cancellable countdown. */
  onTap: () => void;
}

/**
 * The one SOS control. It sits at the top right of every signed-in screen and
 * is the only solid red pill in the app, so it is found without looking.
 * Holding it for 1.2 s fills the ring and sends. A quick tap (also what a
 * screen reader's double-tap does) starts a 5-second countdown that can be
 * cancelled, so a bump in a pocket never sends an alert.
 */
export default function SosButton({ onHoldComplete, onTap }: SosButtonProps) {
  const { t } = useTranslation();
  const progress = useRef(new Animated.Value(0)).current;

  const reset = () => {
    progress.stopAnimation();
    Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  };

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const ringOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <View style={styles.ringWrap}>
      <Animated.View pointerEvents="none" style={[styles.ring, { opacity: ringOpacity }]} />
      <Pressable
        onPressIn={() => {
          Vibration.vibrate(30);
          Animated.timing(progress, {
            toValue: 1,
            duration: SOS_HOLD_MS,
            easing: Easing.linear,
            useNativeDriver: false,
          }).start();
        }}
        onPressOut={reset}
        delayLongPress={SOS_HOLD_MS}
        onLongPress={() => {
          reset();
          onHoldComplete();
        }}
        onPress={onTap}
        accessibilityRole="button"
        accessibilityLabel={t('sos_button_label')}
        accessibilityHint={t('sos_button_hint_hold')}
        hitSlop={8}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Animated.View pointerEvents="none" style={[styles.fill, { width }]} />
        <Ionicons name="alert-circle" size={size.icon.md} color={colors.onSolid} />
        <Text style={styles.label}>SOS</Text>
      </Pressable>
    </View>
  );
}

const RING = 3;

const styles = StyleSheet.create({
  ringWrap: { padding: RING },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.full,
    borderWidth: RING,
    borderColor: colors.dangerHover,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: colors.dangerHover },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.dangerHover,
  },
  label: { ...type.label, fontFamily: type.title.fontFamily, color: colors.onSolid },
});
