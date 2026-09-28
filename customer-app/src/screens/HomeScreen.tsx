import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  StatusBar,
  DeviceEventEmitter,
  Platform
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, STORAGE_KEYS } from '../services/api';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, UrlTile } from 'react-native-maps';

const { width } = Dimensions.get('window');

// Color Palette inspired by the premium design
const COLORS = {
  background: '#F6F5F0',
  cardBg: '#FFFFFF',
  primaryDark: '#234E4A',
  textMain: '#1A2F2D',
  textMuted: '#6B7280',
  inputBg: '#F0EFEA',
  accentGreen: '#C6E3DF',
  promoBgTop: '#C1DFEB',
  promoBgBottom: '#F2DFBE',
};

export default function HomeScreen({ navigation, route }: any) {
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [loadType, setLoadType] = useState<'full' | 'part'>('full');
  
  // Dynamic Locations
  const [pickupLocation, setPickupLocation] = useState<string | null>(null);
  const [dropoffLocation, setDropoffLocation] = useState<string | null>(null);
  const [pickupCoord, setPickupCoord] = useState<{latitude: number, longitude: number} | null>(null);
  const [dropoffCoord, setDropoffCoord] = useState<{latitude: number, longitude: number} | null>(null);
  
  const [isMapModalVisible, setIsMapModalVisible] = useState(false);

  // Helper to draw a projectile/curve route
  const generateCurve = (start: {latitude: number, longitude: number}, end: {latitude: number, longitude: number}) => {
    const points = [];
    const midLat = (start.latitude + end.latitude) / 2;
    const midLng = (start.longitude + end.longitude) / 2;
    const dx = end.longitude - start.longitude;
    const dy = end.latitude - start.latitude;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Create an arching offset based on distance
    const curveHeight = distance * 0.3; 
    const angle = Math.atan2(dy, dx);
    const offsetAngle = angle + Math.PI / 2;
    
    const controlPoint = {
      latitude: midLat + Math.sin(offsetAngle) * curveHeight,
      longitude: midLng + Math.cos(offsetAngle) * curveHeight,
    };

    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const lat = Math.pow(1 - t, 2) * start.latitude + 2 * (1 - t) * t * controlPoint.latitude + Math.pow(t, 2) * end.latitude;
      const lng = Math.pow(1 - t, 2) * start.longitude + 2 * (1 - t) * t * controlPoint.longitude + Math.pow(t, 2) * end.longitude;
      points.push({ latitude: lat, longitude: lng });
    }
    return points;
  };

  // Handle location selection from LocationSearchScreen using Event Emitter to prevent navigation state wipes
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

  useEffect(() => {
    const loadUser = async () => {
      try {
        const infoStr = await AsyncStorage.getItem(STORAGE_KEYS.CUSTOMER_INFO);
        if (infoStr) {
          const info = JSON.parse(infoStr);
          const name = info.full_name?.split(' ')[0];
          if (name) setCustomerName(name.charAt(0).toUpperCase() + name.slice(1));
        }
      } catch (e) {
        console.error(e);
      }
    };
    loadUser();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const handleLogout = async () => {
    await api.logout();
    navigation.replace('Login');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* --- HEADER --- */}
        <View style={styles.header}>
          <View>
            <View style={styles.brandRow}>
              <View style={styles.brandDot} />
              <Text style={styles.brandText}>MARGIX</Text>
            </View>
            <Text style={styles.greetingText}>
              {customerName ? `${getGreeting()}, ${customerName}` : getGreeting()}
            </Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity 
              style={styles.iconCircle}
              onPress={() => navigation.navigate('Notifications')}
              activeOpacity={0.7}
            >
              <Feather name="bell" size={20} color={COLORS.textMain} />
            </TouchableOpacity>

          </View>
        </View>

        {/* --- LOAD TYPE TOGGLE --- */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[styles.toggleBtn, loadType === 'full' && styles.toggleBtnActive]}
            onPress={() => setLoadType('full')}
            activeOpacity={0.8}
          >
            <Feather name="box" size={16} color={loadType === 'full' ? COLORS.primaryDark : COLORS.textMuted} style={styles.toggleIcon} />
            <Text style={[styles.toggleText, loadType === 'full' && styles.toggleTextActive]}>
              Full Truck
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, loadType === 'part' && styles.toggleBtnActive]}
            onPress={() => setLoadType('part')}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="truck-outline" size={18} color={loadType === 'part' ? COLORS.primaryDark : COLORS.textMuted} style={styles.toggleIcon} />
            <Text style={[styles.toggleText, loadType === 'part' && styles.toggleTextActive]}>
              Part Load
            </Text>
          </TouchableOpacity>
        </View>

        {/* --- MAIN BOOKING CARD --- */}
        <View style={styles.bookingCard}>
          <View style={styles.bookingHeader}>
            <Text style={styles.bookingTitle}>Plan a shipment</Text>
          </View>

          <View style={styles.locationsContainer}>
            {/* Vertical Timeline */}
            <View style={styles.timeline}>
              <View style={styles.timelineDotActive} />
              <View style={styles.timelineLine} />
              <View style={styles.timelineDotInactive} />
            </View>

            <View style={styles.locationsRight}>
              {/* Pickup */}
              <TouchableOpacity 
                style={styles.locationItem} 
                activeOpacity={0.7}
                onPress={() => navigation.navigate('LocationSearch', { type: 'pickup' })}
              >
                <View style={styles.locationTexts}>
                  <Text style={styles.locationLabel}>Pickup</Text>
                  {pickupLocation ? (
                    <Text style={styles.locationValueMain} numberOfLines={1}>{pickupLocation}</Text>
                  ) : (
                    <Text style={styles.locationValuePlaceholder} numberOfLines={1}>Search pickup location</Text>
                  )}
                </View>
                <View style={styles.targetIcon}>
                  <MaterialCommunityIcons name="crosshairs-gps" size={18} color={COLORS.primaryDark} />
                </View>
              </TouchableOpacity>

              <View style={styles.locationDivider} />

              {/* Drop-off */}
              <TouchableOpacity 
                style={styles.locationItem} 
                activeOpacity={0.7}
                onPress={() => navigation.navigate('LocationSearch', { type: 'dropoff' })}
              >
                <View style={styles.locationTexts}>
                  <Text style={styles.locationLabel}>Drop-off</Text>
                  {dropoffLocation ? (
                    <Text style={styles.locationValueMain} numberOfLines={1}>{dropoffLocation}</Text>
                  ) : (
                    <Text style={styles.locationValuePlaceholder} numberOfLines={1}>Where is it going?</Text>
                  )}
                </View>
              </TouchableOpacity>
            </View>
          </View>
          
          {/* View Map Button (Only shows when both locations are selected) */}
          {pickupCoord && dropoffCoord && (
            <TouchableOpacity 
              style={{
                flexDirection: 'row', 
                alignItems: 'center', 
                justifyContent: 'center',
                backgroundColor: '#F0F9FF',
                paddingVertical: 12,
                borderRadius: 12,
                marginTop: 16,
                borderWidth: 1,
                borderColor: '#E0F2FE'
              }}
              onPress={() => setIsMapModalVisible(true)}
            >
              <Feather name="map" size={16} color={COLORS.primaryDark} />
              <Text style={{ marginLeft: 8, fontSize: 14, fontWeight: '600', color: COLORS.primaryDark }}>
                View Route on Map
              </Text>
            </TouchableOpacity>
          )}

          {/* Time/Date Pills */}
          <View style={styles.dateTimeContainer}>
            <TouchableOpacity style={styles.dateTimePill}>
              <Feather name="calendar" size={14} color={COLORS.textMain} style={{ marginRight: 6 }} />
              <Text style={styles.dateTimeText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dateTimePill}>
              <Feather name="clock" size={14} color={COLORS.textMain} style={{ marginRight: 6 }} />
              <Text style={styles.dateTimeText}>Now</Text>
            </TouchableOpacity>
          </View>

          {/* Primary CTA */}
          <TouchableOpacity 
            style={[
              styles.primaryBtn, 
              (!pickupLocation || !dropoffLocation) && { opacity: 0.5 }
            ]} 
            activeOpacity={0.9}
            disabled={!pickupLocation || !dropoffLocation}
            onPress={() => {
              navigation.navigate('CargoConfig', {
                pickupLocation,
                dropoffLocation
              });
            }}
          >
            <Text style={styles.primaryBtnText}>Find a truck</Text>
            <Feather name="arrow-up-right" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* --- BOTTOM TAB BAR --- */}
      <View style={styles.bottomTab}>
        <View style={styles.tabItem}>
          <View style={styles.activeTabIndicator} />
          <Feather name="home" size={24} color={COLORS.primaryDark} />
          <Text style={styles.tabTextActive}>Home</Text>
        </View>
        <TouchableOpacity style={styles.tabItem} onPress={handleLogout} activeOpacity={0.7}>
          <Feather name="log-out" size={24} color={COLORS.textMuted} />
          <Text style={styles.tabText}>Log out</Text>
        </TouchableOpacity>
      </View>

      {/* --- FULL SCREEN MAP MODAL --- */}
      {isMapModalVisible && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#EFEFEF' }}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            mapType={Platform.OS === 'android' ? 'none' : 'standard'}
            initialRegion={
              pickupCoord && dropoffCoord 
                ? {
                    latitude: (pickupCoord.latitude + dropoffCoord.latitude) / 2,
                    longitude: (pickupCoord.longitude + dropoffCoord.longitude) / 2,
                    latitudeDelta: Math.abs(pickupCoord.latitude - dropoffCoord.latitude) * 1.8 || 0.1,
                    longitudeDelta: Math.abs(pickupCoord.longitude - dropoffCoord.longitude) * 1.8 || 0.1,
                  }
                : {
                    ...pickupCoord!,
                    latitudeDelta: 0.08,
                    longitudeDelta: 0.08,
                  }
            }
          >
            {Platform.OS === 'android' && (
              <UrlTile
                urlTemplate="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2&hl=en"
                maximumZ={19}
                tileSize={256}
                flipY={false}
              />
            )}
            {pickupCoord && <Marker coordinate={pickupCoord} pinColor="#10B981" title="Pickup" />}
            {dropoffCoord && <Marker coordinate={dropoffCoord} pinColor="#EF4444" title="Drop-off" />}
            {pickupCoord && dropoffCoord && (
              <Polyline 
                coordinates={generateCurve(pickupCoord, dropoffCoord)} 
                strokeColor={COLORS.primaryDark} 
                strokeWidth={3} 
                lineDashPattern={[8, 8]}
              />
            )}
          </MapView>
          
          <TouchableOpacity 
            style={{
              position: 'absolute',
              top: Platform.OS === 'ios' ? 60 : 40,
              left: 20,
              backgroundColor: '#FFFFFF',
              width: 44,
              height: 44,
              borderRadius: 22,
              justifyContent: 'center',
              alignItems: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.2,
              shadowRadius: 4,
              elevation: 4
            }}
            onPress={() => setIsMapModalVisible(false)}
          >
            <Feather name="arrow-left" size={24} color={COLORS.textMain} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingTop: Platform.OS === 'ios' ? 50 : 10,
    paddingHorizontal: 20,
  },

  /* HEADER */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primaryDark,
    marginRight: 6,
  },
  brandText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: COLORS.primaryDark,
  },
  greetingText: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.textMain,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E5E4DF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    backgroundColor: '#FFFFFF',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#9FB5AE', // Muted green matching the design
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: COLORS.primaryDark,
    fontWeight: '600',
    fontSize: 16,
  },

  /* TOGGLE */
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#EBEAE5',
    borderRadius: 100,
    padding: 4,
    marginBottom: 20,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  toggleIcon: {
    marginRight: 6,
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  toggleTextActive: {
    color: COLORS.textMain,
    fontWeight: '600',
  },

  /* BOOKING CARD */
  bookingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 5,
    marginBottom: 24,
  },
  bookingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  bookingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textMain,
  },
  etaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F5F4', // very light green
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 100,
  },
  etaDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#357169',
    marginRight: 6,
  },
  etaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#357169',
  },
  locationsContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  timeline: {
    width: 20,
    alignItems: 'center',
    marginRight: 12,
    marginTop: 8,
  },
  timelineDotActive: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primaryDark,
  },
  timelineLine: {
    width: 2,
    height: 44,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
  },
  timelineDotInactive: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.primaryDark,
    backgroundColor: '#FFFFFF',
  },
  locationsRight: {
    flex: 1,
  },
  locationItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 52,
  },
  locationTexts: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  locationValueMain: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textMain,
  },
  locationValuePlaceholder: {
    fontSize: 16,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  targetIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F5F4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 6,
  },
  dateTimeContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  dateTimePill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F7F3',
    paddingVertical: 12,
    borderRadius: 12,
    marginRight: 8,
  },
  dateTimeText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMain,
  },
  primaryBtn: {
    flexDirection: 'row',
    backgroundColor: COLORS.primaryDark,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },

  /* PROMO CARD */
  promoCard: {
    backgroundColor: '#C8E1EA', // Light blue/gray base
    borderRadius: 24,
    overflow: 'hidden',
    flexDirection: 'row',
    marginBottom: 20,
    minHeight: 160,
  },
  promoContent: {
    flex: 1,
    padding: 20,
    zIndex: 2,
  },
  promoBadge: {
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 12,
  },
  promoBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1F4243',
    letterSpacing: 0.5,
  },
  promoTitleText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1A2F2D',
    lineHeight: 24,
    marginBottom: 8,
  },
  promoDescText: {
    fontSize: 12,
    color: '#4B5563',
    marginBottom: 12,
    lineHeight: 16,
  },
  promoLink: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  promoLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryDark,
  },
  promoGraphic: {
    position: 'absolute',
    right: -20,
    bottom: -10,
    width: 160,
    height: 160,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  truckImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
  },

  /* REWARDS CARD */
  rewardsCard: {
    backgroundColor: '#EAF0E9', // Pale green
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rewardsIconBg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#D6E2D4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  rewardsTextContainer: {
    flex: 1,
  },
  rewardsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 4,
  },
  rewardsSubText: {
    fontSize: 13,
    color: '#5B6765',
  },

  /* BOTTOM TAB */
  bottomTab: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Platform.OS === 'ios' ? 90 : 70,
    backgroundColor: '#FAFAF9',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#EBEAE5',
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  activeTabIndicator: {
    position: 'absolute',
    top: -24,
    width: 30,
    height: 4,
    backgroundColor: COLORS.background, // Match bg to hide border
    borderRadius: 2,
  },
  tabTextActive: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primaryDark,
    marginTop: 6,
  },
  tabText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 6,
  },
});
