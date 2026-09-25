import React, { useEffect, useRef } from 'react';
import { View, Image, Animated, StyleSheet, Dimensions, Easing } from 'react-native';
import { supabase } from '../lib/supabase';

const { width, height } = Dimensions.get('window');

export default function SplashScreen({ navigation }: any) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.5)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const rippleAnim = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;

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

    // 3. Loading bar fills up smoothly (simulating app init)
    Animated.timing(barWidth, {
      toValue: 1,
      duration: 2000,
      delay: 500,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();

    const checkAuth = async () => {
      // Simulate minimum splash screen time
      await new Promise(resolve => setTimeout(resolve, 2800));
      const { data: { session } } = await supabase.auth.getSession();
      
      // Smooth fade out before navigating
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => {
        if (session) {
          navigation.replace('Home');
        } else {
          navigation.replace('Login');
        }
      });
    };

    checkAuth();
  }, [navigation]);

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
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ripple: {
    position: 'absolute',
    width: width,
    height: width,
    borderRadius: width / 2,
    backgroundColor: '#FFC800',
  },
  logoContainer: {
    alignItems: 'center',
    width: width * 0.8,
    zIndex: 10,
  },
  logo: {
    width: '100%',
    height: 120, // Increased size for more impact
    marginBottom: 50,
  },
  loaderContainer: {
    width: 140, // Wider for a more premium feel
    height: 4,
    backgroundColor: 'rgba(255, 200, 0, 0.2)', // Light yellow background
    borderRadius: 2,
    overflow: 'hidden',
  },
  loaderBar: {
    height: '100%',
    backgroundColor: '#FFC800',
    borderRadius: 2,
    shadowColor: '#FFC800',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 3,
  },
});
