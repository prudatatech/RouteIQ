import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, size, space } from '../theme';

interface SplashScreenProps {
  onAnimationFinish: () => void;
}

/**
 * Brand splash shown while the app restores the session and loads fonts. Its
 * dark background continues the native splash so there is no flash. The app
 * unmounts it once it is ready, so it never fades to an empty screen.
 */
export default function AnimatedSplashScreen({ onAnimationFinish }: SplashScreenProps) {
  const { width, height } = useWindowDimensions();
  const textOpacity = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(space[4])).current;
  const truckAnim = useRef(new Animated.Value(-width)).current;

  useEffect(() => {
    // Truck drives across the road in a loop until the splash closes.
    const drive = Animated.loop(
      Animated.timing(truckAnim, {
        toValue: width + space[16],
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    truckAnim.setValue(-width);
    drive.start();

    Animated.sequence([
      Animated.parallel([
        Animated.timing(textOpacity, { toValue: 1, duration: 300, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      ]),
      Animated.delay(900),
    ]).start(() => onAnimationFinish());

    return () => drive.stop();
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container} accessibilityLabel="MargixIndia">
      <Animated.View style={{ opacity: textOpacity, transform: [{ translateY: slideAnim }] }}>
        <Animated.Text style={styles.titleText}>
          Margix<Animated.Text style={styles.highlight}>India</Animated.Text>
        </Animated.Text>
      </Animated.View>

      <View style={[styles.roadContainer, { bottom: height * 0.2 }]}>
        <Animated.View style={{ transform: [{ translateX: truckAnim }] }}>
          <MaterialCommunityIcons name="truck-fast" size={size.icon.xl * 1.5} color={colors.accentFill} />
        </Animated.View>
        <View style={styles.roadLine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.text,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleText: {
    // System font on purpose: the theme fonts may not be loaded yet.
    fontWeight: '600',
    fontSize: fontSize.xl3,
    color: colors.surface,
  },
  highlight: {
    color: colors.accentFill,
  },
  roadContainer: {
    position: 'absolute',
    width: '100%',
    alignItems: 'flex-start',
  },
  roadLine: {
    width: '100%',
    height: 2,
    marginTop: space[1],
    backgroundColor: colors.accentFill,
    opacity: 0.4,
  },
});
