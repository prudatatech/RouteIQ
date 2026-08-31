import { useTranslation } from '../hooks/useTranslation';
import React, { useRef, useState } from 'react';
import { View, Text, TouchableWithoutFeedback, Animated, StyleSheet } from 'react-native';

interface HoldButtonProps {
  onComplete: () => void;
  title: string;
  color?: string;
  duration?: number;
  disabled?: boolean;
}

export default function HoldButton({ onComplete, title, color = '#06B6D4', duration = 1200, disabled = false }: HoldButtonProps) {
  const { t } = useTranslation();
  const [isPressing, setIsPressing] = useState(false);
  const fillAnim = useRef(new Animated.Value(0)).current;

  const handlePressIn = () => {
    if (disabled) return;
    setIsPressing(true);
    Animated.timing(fillAnim, {
      toValue: 1,
      duration: duration,
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
    outputRange: ['0%', '100%']
  });

  return (
    <TouchableWithoutFeedback onPressIn={handlePressIn} onPressOut={handlePressOut} disabled={disabled}>
      <View style={[styles.container, { borderColor: disabled ? '#27272A' : color, opacity: disabled ? 0.5 : 1 }]}>
        <Animated.View style={[styles.fill, { backgroundColor: disabled ? '#27272A' : color, width: widthInterpolate }]} />
        <View style={styles.textContainer}>
          <Text style={[styles.text, { color: isPressing ? '#09090B' : (disabled ? '#71717A' : color) }]}>
            {isPressing ? t('btn_holding') : title}
          </Text>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 64,
    width: '100%',
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#09090B',
    marginBottom: 16,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  textContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  }
});
