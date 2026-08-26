import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

interface SplashScreenProps {
  onAnimationFinish: () => void;
}

const LANGUAGES = [
  { text: 'Route', highlight: 'IQ' }, // Fix margixindiaIQ typo
  { text: 'रूट', highlight: ' आईक्यू' }, // Hindi
  { text: 'मार्ग', highlight: ' आयक्यू' }, // Marathi
  { text: 'రూట్', highlight: ' ఐక్యూ' }, // Telugu
  { text: 'ரூட்', highlight: ' ஐக்யூ' }, // Tamil
  { text: 'Route', highlight: 'IQ' }, // Back to English to finish
];

export default function AnimatedSplashScreen({ onAnimationFinish }: SplashScreenProps) {
  const [langIndex, setLangIndex] = useState(0);
  const textOpacity = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(15)).current;
  const truckAnim = useRef(new Animated.Value(-width)).current;

  // Background animation
  const bgOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Start continuous truck animation across the screen
    const driveTruck = () => {
      truckAnim.setValue(-width);
      Animated.timing(truckAnim, {
        toValue: width + 100, // Make sure it completely exits the screen
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          driveTruck(); // recursively call to restart seamlessly from left
        }
      });
    };
    driveTruck();

    // We will show each language for 500ms, fading in and out.
    // Total duration = languages.length * (fadeIn + hold + fadeOut)

    let currentIdx = 0;

    const animateText = () => {
      if (currentIdx >= LANGUAGES.length) {
        // Finish splash screen
        Animated.timing(bgOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }).start(() => onAnimationFinish());
        return;
      }

      setLangIndex(currentIdx);
      slideAnim.setValue(15);

      Animated.sequence([
        // Fade in & slide up
        Animated.parallel([
          Animated.timing(textOpacity, { toValue: 1, duration: 250, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
          Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
        ]),
        // Hold
        Animated.delay(400),
        // Fade out & slide up
        Animated.parallel([
          Animated.timing(textOpacity, { toValue: 0, duration: 200, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
          Animated.timing(slideAnim, { toValue: -15, duration: 200, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
        ]),
      ]).start(() => {
        currentIdx++;
        animateText();
      });
    };

    // Start animation loop
    animateText();

  }, []);

  const currentLang = LANGUAGES[langIndex];

  return (
    <Animated.View style={[styles.container, { opacity: bgOpacity }]}>
      <Animated.View
        style={[
          styles.logoContainer,
          {
            opacity: textOpacity,
            transform: [{ translateY: slideAnim }]
          }
        ]}
      >
        <Text style={styles.titleText}>
          {currentLang.text}<Text style={styles.iqText}>{currentLang.highlight}</Text>
        </Text>
      </Animated.View>

      <View style={styles.roadContainer}>
        <Animated.View style={{ transform: [{ translateX: truckAnim }] }}>
          <Text style={[styles.truckIcon, { transform: [{ scaleX: -1 }] }]}>🚛</Text>
        </Animated.View>
        <View style={styles.roadLine} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000', // Deep pure black
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  logoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 48,
    fontWeight: '900',
    color: '#FFFFFF', // White text on black
    letterSpacing: -1,
  },
  iqText: {
    color: '#FFCC00', // Signature margixindia Yellow for the highlight
  },
  roadContainer: {
    position: 'absolute',
    bottom: height * 0.2, // 20% from bottom
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  truckIcon: {
    fontSize: 42,
    marginBottom: -8, // Slight overlap with road
  },
  roadLine: {
    width: '100%',
    height: 4,
    backgroundColor: '#333333',
    borderTopWidth: 2,
    borderTopColor: '#FFCC00',
    borderStyle: 'dashed',
  }
});
