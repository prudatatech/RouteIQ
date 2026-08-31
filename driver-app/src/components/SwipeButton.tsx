import { useTranslation } from '../hooks/useTranslation';
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { Vibration } from 'react-native';

const { width } = Dimensions.get('window');
const BUTTON_HEIGHT = 60;
const THUMB_SIZE = 52;
// Adjust the total width depending on parent padding. 
// Assuming the parent has some padding (e.g., 24px each side for bottom sheet).
// We'll calculate MAX_SLIDE in onLayout to be precise.

interface SwipeButtonProps {
  title: string;
  onComplete: () => void;
  color?: string;
  isCompleted?: boolean;
}

export default function SwipeButton({ title, onComplete, color = '#27A150', isCompleted = false }: SwipeButtonProps) {
  const { t } = useTranslation();
  const [completed, setCompleted] = useState(isCompleted);
  const [width, setWidth] = useState(0);
  const pan = useRef(new Animated.ValueXY()).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  
  const MAX_SLIDE = width > 0 ? width - THUMB_SIZE - 8 : 200;

  useEffect(() => {
    setCompleted(isCompleted);
    if (!isCompleted) {
      pan.setValue({ x: 0, y: 0 });
      opacityAnim.setValue(1);
    }
  }, [isCompleted]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !completed,
      onMoveShouldSetPanResponder: () => !completed,
      onPanResponderMove: (e, gesture) => {
        if (gesture.dx > 0 && gesture.dx <= MAX_SLIDE) {
          pan.setValue({ x: gesture.dx, y: 0 });
          opacityAnim.setValue(1 - gesture.dx / MAX_SLIDE);
        } else if (gesture.dx > MAX_SLIDE) {
          pan.setValue({ x: MAX_SLIDE, y: 0 });
          opacityAnim.setValue(0);
        }
      },
      onPanResponderRelease: (e, gesture) => {
        if (gesture.dx >= MAX_SLIDE * 0.8) {
          Animated.timing(pan, {
            toValue: { x: MAX_SLIDE, y: 0 },
            duration: 150,
            useNativeDriver: false,
          }).start(() => {
            Vibration.vibrate(100);
            setCompleted(true);
            onComplete();
          });
        } else {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            friction: 5,
            useNativeDriver: false,
          }).start();
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  if (completed) {
    return (
      <View style={[styles.container, { backgroundColor: color }]}>
        <Text style={[styles.title, { color: '#FFF' }]}>✓ Completed</Text>
      </View>
    );
  }

  return (
    <View 
      style={styles.container}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View 
        style={[
          styles.trackFill, 
          { 
            backgroundColor: color,
            width: pan.x.interpolate({
              inputRange: [0, MAX_SLIDE > 0 ? MAX_SLIDE : 200],
              outputRange: [THUMB_SIZE + 8, width > 0 ? width : 300],
              extrapolate: 'clamp'
            }) 
          }
        ]} 
      />
      <Animated.Text style={[styles.title, { opacity: opacityAnim, color: color }]}>
        {title}
      </Animated.Text>
      {width > 0 && (
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.thumb,
            {
              backgroundColor: color,
              transform: [{ translateX: pan.x }]
            }
          ]}
        >
          <Text style={styles.thumbIcon}>{'>>'}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: BUTTON_HEIGHT,
    backgroundColor: '#F3F4F6',
    borderRadius: BUTTON_HEIGHT / 2,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: BUTTON_HEIGHT / 2,
    opacity: 0.2,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    zIndex: 1,
  },
  thumb: {
    position: 'absolute',
    left: 4,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 2,
  },
  thumbIcon: {
    color: '#FFF',
    fontWeight: '900',
    fontSize: 20,
    letterSpacing: -2,
    marginLeft: -2,
  }
});
