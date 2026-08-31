import React, { useEffect, useState, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing, Dimensions } from 'react-native';
import { supabase } from '../services/supabase';

const { width } = Dimensions.get('window');

export default function LiveRateMarquee() {
  const [rate, setRate] = useState<number | null>(null);
  const translateX = useRef(new Animated.Value(width)).current;

  useEffect(() => {
    // Fetch initial
    supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'rate_per_km')
      .single()
      .then(({ data }) => {
        if (data?.value?.rate) setRate(data.value.rate);
      });

    // Subscribe
    const channel = supabase
      .channel('driver_system_settings')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'system_settings', filter: "key=eq.'rate_per_km'" },
        (payload) => {
          if (payload.new?.value?.rate) {
            setRate(payload.new.value.rate);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (rate !== null) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(translateX, {
            toValue: -width,
            duration: 10000,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.timing(translateX, {
            toValue: width,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [rate]);

  if (!rate) return null;

  return (
    <View style={styles.container}>
      <Animated.Text style={[styles.text, { transform: [{ translateX }] }]} numberOfLines={1}>
        🚨 LIVE MARKET UPDATE: CURRENT RATE PER KM IS ₹{rate} 🚨
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 193, 7, 0.2)',
    paddingVertical: 8,
    overflow: 'hidden',
    position: 'absolute',
    top: 50,
    zIndex: 1000,
  },
  text: {
    color: '#D97706',
    fontWeight: '900',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    width: width * 1.5,
  },
});
