import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, DeviceEventEmitter, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, UrlTile } from 'react-native-maps';
import { BOOKING_CREATED_EVENT, STORAGE_KEYS } from '../services/api';
import { Button, Card, IconButton, Text } from '../components/ui';
import { colors, elevation, radius, size, space } from '../theme';
import { useTranslation } from '../hooks/useTranslation';

type Coord = { latitude: number; longitude: number };
type LoadType = 'full' | 'part';

const LOAD_TYPES: { id: LoadType; label: string }[] = [
  { id: 'full', label: 'load_full' },
  { id: 'part', label: 'load_part' },
];

/** A gentle arc between two points, drawn as a guide line (not a road route). */
const generateCurve = (start: Coord, end: Coord) => {
  const points: Coord[] = [];
  const midLat = (start.latitude + end.latitude) / 2;
  const midLng = (start.longitude + end.longitude) / 2;
  const dx = end.longitude - start.longitude;
  const dy = end.latitude - start.latitude;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const curveHeight = distance * 0.3;
  const offsetAngle = Math.atan2(dy, dx) + Math.PI / 2;
  const control = {
    latitude: midLat + Math.sin(offsetAngle) * curveHeight,
    longitude: midLng + Math.cos(offsetAngle) * curveHeight,
  };

  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    points.push({
      latitude: (1 - t) ** 2 * start.latitude + 2 * (1 - t) * t * control.latitude + t ** 2 * end.latitude,
      longitude: (1 - t) ** 2 * start.longitude + 2 * (1 - t) * t * control.longitude + t ** 2 * end.longitude,
    });
  }
  return points;
};

const getGreetingKey = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'greet_morning';
  if (hour < 18) return 'greet_afternoon';
  return 'greet_evening';
};

export default function HomeScreen({ navigation }: any) {
  const { t } = useTranslation();
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [loadType, setLoadType] = useState<LoadType>('full');

  const [pickupLocation, setPickupLocation] = useState<string | null>(null);
  const [dropoffLocation, setDropoffLocation] = useState<string | null>(null);
  const [pickupCoord, setPickupCoord] = useState<Coord | null>(null);
  const [dropoffCoord, setDropoffCoord] = useState<Coord | null>(null);

  const [isMapVisible, setIsMapVisible] = useState(false);

  // Location picks come back through an event so navigation state is not wiped.
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('locationSelected', (data) => {
      if (data.locationType === 'pickup') {
        setPickupLocation(data.selectedLocation);
        if (data.selectedCoord) setPickupCoord(data.selectedCoord);
      } else if (data.locationType === 'dropoff') {
        setDropoffLocation(data.selectedLocation);
        if (data.selectedCoord) setDropoffCoord(data.selectedCoord);
      }
    });

    return () => subscription.remove();
  }, []);

  // Once a booking is sent, start the next one from a clean form.
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(BOOKING_CREATED_EVENT, () => {
      setPickupLocation(null);
      setDropoffLocation(null);
      setPickupCoord(null);
      setDropoffCoord(null);
      setLoadType('full');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.CUSTOMER_INFO)
      .then((infoStr) => {
        if (!infoStr) return;
        const name = JSON.parse(infoStr).full_name?.split(' ')[0];
        if (name) setCustomerName(name.charAt(0).toUpperCase() + name.slice(1));
      })
      .catch((e) => console.error(e));
  }, []);

  const curve = useMemo(
    () => (pickupCoord && dropoffCoord ? generateCurve(pickupCoord, dropoffCoord) : []),
    [pickupCoord, dropoffCoord],
  );

  const canContinue = !!pickupLocation && !!dropoffLocation && !!pickupCoord && !!dropoffCoord;
  const greeting = t(getGreetingKey());

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* --- HEADER --- */}
        <View style={styles.header}>
          <Text variant="captionMedium" color="accent">
            MargixIndia
          </Text>
          <Text variant="heading" accessibilityRole="header">
            {customerName ? `${greeting}, ${customerName}` : greeting}
          </Text>
        </View>

        {/* --- LOAD TYPE --- */}
        <View style={styles.toggle} accessibilityRole="radiogroup" accessibilityLabel={t('load_type')}>
          {LOAD_TYPES.map((option) => {
            const selected = loadType === option.id;
            return (
              <Pressable
                key={option.id}
                style={[styles.toggleBtn, selected && styles.toggleBtnActive]}
                onPress={() => setLoadType(option.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(option.label)}
              >
                {option.id === 'full' ? (
                  <Feather name="box" size={size.icon.sm} color={selected ? colors.text : colors.textMuted} />
                ) : (
                  <MaterialCommunityIcons
                    name="truck-outline"
                    size={size.icon.md}
                    color={selected ? colors.text : colors.textMuted}
                  />
                )}
                <Text variant={selected ? 'bodySmallMedium' : 'bodySmall'} color={selected ? 'text' : 'textMuted'}>
                  {t(option.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* --- BOOKING CARD --- */}
        <Card style={styles.bookingCard}>
          <Text variant="title" accessibilityRole="header">
            {t('plan_shipment')}
          </Text>

          <View style={styles.locations}>
            <View style={styles.timeline} importantForAccessibility="no-hide-descendants">
              <View style={styles.dotFilled} />
              <View style={styles.timelineLine} />
              <View style={styles.dotOutline} />
            </View>

            <View style={styles.flex}>
              <Pressable
                style={({ pressed }) => [styles.locationItem, pressed && styles.pressed]}
                onPress={() => navigation.navigate('LocationSearch', { type: 'pickup' })}
                accessibilityRole="button"
                accessibilityLabel={pickupLocation ? `${t('pickup')}: ${pickupLocation}` : t('home_choose_pickup')}
                accessibilityHint={t('home_opens_search')}
              >
                <View style={styles.flex}>
                  <Text variant="caption" color="textMuted">
                    {t('pickup')}
                  </Text>
                  <Text variant="bodyMedium" color={pickupLocation ? 'text' : 'textMuted'} numberOfLines={1}>
                    {pickupLocation || t('home_search_pickup')}
                  </Text>
                </View>
                <MaterialCommunityIcons name="crosshairs-gps" size={size.icon.md} color={colors.accent} />
              </Pressable>

              <View style={styles.locationDivider} />

              <Pressable
                style={({ pressed }) => [styles.locationItem, pressed && styles.pressed]}
                onPress={() => navigation.navigate('LocationSearch', { type: 'dropoff' })}
                accessibilityRole="button"
                accessibilityLabel={dropoffLocation ? `${t('dropoff')}: ${dropoffLocation}` : t('home_choose_drop')}
                accessibilityHint={t('home_opens_search')}
              >
                <View style={styles.flex}>
                  <Text variant="caption" color="textMuted">
                    {t('dropoff')}
                  </Text>
                  <Text variant="bodyMedium" color={dropoffLocation ? 'text' : 'textMuted'} numberOfLines={1}>
                    {dropoffLocation || t('home_where_to')}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>

          {pickupCoord && dropoffCoord && (
            <Button
              title={t('home_view_map')}
              variant="secondary"
              onPress={() => setIsMapVisible(true)}
              icon={(color) => <Feather name="map" size={size.icon.sm} color={color} />}
            />
          )}

          <Button
            title={t('home_find_truck')}
            disabled={!canContinue}
            accessibilityHint={canContinue ? undefined : t('home_need_both')}
            onPress={() => navigation.navigate('CargoConfig', { pickupLocation, dropoffLocation, pickupCoord, dropoffCoord, loadType })}
            icon={(color) => <Feather name="arrow-right" size={size.icon.md} color={color} />}
          />
        </Card>
      </ScrollView>

      {/* --- MAP --- */}
      <Modal visible={isMapVisible} animationType="slide" onRequestClose={() => setIsMapVisible(false)}>
        <View style={styles.mapScreen}>
          {pickupCoord && dropoffCoord && (
            <MapView
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              mapType={Platform.OS === 'android' ? 'none' : 'standard'}
              initialRegion={{
                latitude: (pickupCoord.latitude + dropoffCoord.latitude) / 2,
                longitude: (pickupCoord.longitude + dropoffCoord.longitude) / 2,
                latitudeDelta: Math.abs(pickupCoord.latitude - dropoffCoord.latitude) * 1.8 || 0.1,
                longitudeDelta: Math.abs(pickupCoord.longitude - dropoffCoord.longitude) * 1.8 || 0.1,
              }}
            >
              {Platform.OS === 'android' && (
                <UrlTile
                  urlTemplate="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2&hl=en"
                  maximumZ={19}
                  tileSize={256}
                  flipY={false}
                />
              )}
              <Marker coordinate={pickupCoord} pinColor={colors.accent} title={t('pickup')} description={pickupLocation ?? undefined} />
              <Marker coordinate={dropoffCoord} pinColor={colors.info} title={t('dropoff')} description={dropoffLocation ?? undefined} />
              <Polyline coordinates={curve} strokeColor={colors.accent} strokeWidth={3} lineDashPattern={[8, 8]} />
            </MapView>
          )}

          <SafeAreaView edges={['top']} style={styles.mapHeader} pointerEvents="box-none">
            <IconButton
              accessibilityLabel={t('home_close_map')}
              variant="secondary"
              style={styles.mapClose}
              onPress={() => setIsMapVisible(false)}
              icon={(color) => <Feather name="arrow-left" size={size.icon.lg} color={color} />}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const DOT = 12;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { padding: space[4], gap: space[6] },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  header: { gap: space[1] },

  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.border,
    padding: space[1],
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: space[2],
    minHeight: size.control,
    borderRadius: radius.control - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnActive: { backgroundColor: colors.accentSoft },

  bookingCard: { gap: space[4] },
  locations: { flexDirection: 'row', gap: space[3] },
  timeline: { width: DOT, alignItems: 'center', paddingVertical: space[4] },
  dotFilled: { width: DOT, height: DOT, borderRadius: radius.full, backgroundColor: colors.accent },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: space[1] },
  dotOutline: {
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: size.control + space[2],
  },
  locationDivider: { height: size.border, backgroundColor: colors.border },

  mapScreen: { flex: 1, backgroundColor: colors.bg },
  mapHeader: { position: 'absolute', top: 0, left: 0, right: 0 },
  mapClose: { margin: space[4], ...elevation.sm },
});
