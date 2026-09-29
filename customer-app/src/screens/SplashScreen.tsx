import React, { useEffect, useState } from 'react';
import { View, Image, Animated, StyleSheet, Dimensions, Easing } from 'react-native';
import { api } from '../services/api';
import { colors, radius } from '../theme';
const { width } = Dimensions.get('window');

export default function SplashScreen({ navigation }: any) {
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const [scaleAnim] = useState(() => new Animated.Value(0.5));
  const [slideAnim] = useState(() => new Animated.Value(50));
  const [rippleAnim] = useState(() => new Animated.Value(0));
  const [barWidth] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // 1. Ripple expands (Yellow background effect behind logo)
    Animated.timing(rippleAnim, {
      toValue: 1,
      duration: 1000,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    // 2. Logo fades in, scales up, and slides up smoothly
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        delay: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 40,
        delay: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        delay: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // 3. Loading bar fills while the session is restored
    Animated.timing(barWidth, {
      toValue: 1,
      duration: 2000,
      delay: 500,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();

    const checkAuth = async () => {
      // Show the splash for a minimum time while initialising the API client
      // (migrates legacy tokens and loads the session) in parallel.
      const [, hasSession] = await Promise.all([
        new Promise(resolve => setTimeout(resolve, 2800)),
        api.hasSession(),
      ]);

      // Smooth fade out before navigating
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        navigation.replace(hasSession ? 'Home' : 'Login');
      });
    };

    checkAuth();
  }, [navigation, fadeAnim, scaleAnim, slideAnim, rippleAnim, barWidth]);

  const rippleScale = rippleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1.5]
  });

  const rippleOpacity = rippleAnim.interpolate({
    inputRange: [0, 0.8, 1],
    outputRange: [0.8, 0.1, 0]
  });

  const interpolatedBarWidth = barWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%']
  });

  return (
    <View style={styles.container}>
      {/* Background Ripple Animation */}
      <Animated.View 
        style={[
          styles.ripple, 
          { 
            transform: [{ scale: rippleScale }],
            opacity: rippleOpacity
          }
        ]} 
      />

      <Animated.View 
        style={[
          styles.logoContainer, 
          { 
            opacity: fadeAnim, 
            transform: [
              { scale: scaleAnim },
              { translateY: slideAnim }
            ] 
          }
        ]}
      >
        <Image
          source={require('../../assets/margix-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="MargixIndia"
        />
        
        {/* Sleek Loading Bar */}
        <View style={styles.loaderContainer}>
          <Animated.View 
            style={[
              styles.loaderBar, 
              { width: interpolatedBarWidth }
            ]} 
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ripple: {
    position: 'absolute',
    width: width,
    height: width,
    borderRadius: width / 2,
    backgroundColor: colors.accentFill,
  },
  logoContainer: {
    alignItems: 'center',
    width: width * 0.8,
    zIndex: 10,
  },
  logo: {
    width: '100%',
    height: 120,
    marginBottom: 48,
  },
  loaderContainer: {
    width: 140,
    height: 4,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  loaderBar: {
    height: '100%',
    backgroundColor: colors.accentFill,
    borderRadius: radius.full,
  },
});
