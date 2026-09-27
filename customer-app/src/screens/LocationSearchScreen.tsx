import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  TextInput,
  StyleSheet, 
  TouchableOpacity, 
  FlatList, 
  Platform,
  StatusBar,
  ActivityIndicator,
  LayoutAnimation,
  UIManager
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE, UrlTile } from 'react-native-maps';
import AsyncStorage from '@react-native-async-storage/async-storage';

const COLORS = {
  background: '#FFFFFF',
  textMain: '#1A2F2D',
  textMuted: '#6B7280',
  inputBorder: '#3b82f6', // blue border from design
  inputBg: '#FFFFFF',
  primaryDark: '#234E4A',
  currentLocText: '#0ea5e9', // light blue
};

type Prediction = {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
};

export default function LocationSearchScreen({ navigation, route }: any) {
  const { type } = route.params || { type: 'pickup' }; // 'pickup' or 'dropoff'
  const [query, setQuery] = useState('');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [history, setHistory] = useState<Prediction[]>([]);
  
  // Map State
  const mapRef = useRef<MapView>(null);
  const [selectedCoord, setSelectedCoord] = useState<{latitude: number, longitude: number} | null>(null);
  const [confirmedAddress, setConfirmedAddress] = useState('');
  const [showMap, setShowMap] = useState(false);
  const isSelectingRef = useRef(false);

  // Load history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await AsyncStorage.getItem(`location_search_history_${type}`);
        if (stored) {
          setHistory(JSON.parse(stored));
        }
      } catch (e) {}
    };
    loadHistory();
  }, [type]);

  const saveToHistory = async (place: Prediction) => {
    try {
      const storageKey = `location_search_history_${type}`;
      const stored = await AsyncStorage.getItem(storageKey);
      let hist = stored ? JSON.parse(stored) : [];
      // Remove if already exists
      hist = hist.filter((item: Prediction) => item.description !== place.description);
      // Add to front
      hist.unshift(place);
      // Keep only top 5
      if (hist.length > 5) hist.pop();
      await AsyncStorage.setItem(storageKey, JSON.stringify(hist));
      setHistory(hist);
    } catch (e) {}
  };

  // Debounced search for real places API
  useEffect(() => {
    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      return;
    }

    if (query.trim().length < 3) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPredictions([]);
      return;
    }

    const timer = setTimeout(() => {
      fetchPlaces(query);
    }, 600);

    return () => clearTimeout(timer);
  }, [query]);

  const fetchPlaces = async (text: string) => {
    setLoading(true);
    setErrorMessage('');
    
    try {
      // Using Esri ArcGIS World Geocoding Service (Free and Commercial Grade)
      // We MUST use ArcGIS for HTTP calls because the driver Google API key is restricted to Android Native SDK and rejects HTTP REST calls!
      const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?text=${encodeURIComponent(text)}&countryCode=IND&maxSuggestions=6&f=json`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.suggestions && data.suggestions.length > 0) {
        const mappedResults = data.suggestions.map((item: any) => {
          const parts = item.text.split(', ');
          const mainText = parts[0];
          const secondaryText = parts.slice(1, -1).join(', ') || 'India';

          return {
            place_id: item.magicKey,
            description: `${mainText}, ${secondaryText}`,
            structured_formatting: {
              main_text: mainText,
              secondary_text: secondaryText
            }
          };
        });

        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setPredictions(mappedResults);
      } else {
        setPredictions([]);
      }
    } catch (error) {
      console.error('Error fetching places:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLocation = async (place: Prediction) => {
    isSelectingRef.current = true;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setQuery(place.description);
    setPredictions([]);
    saveToHistory(place);
    
    try {
      let url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?magicKey=${place.place_id}&f=json`;
      
      // If it's a random string from manual map selection history, use text search
      if (place.place_id.includes('.')) {
        url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(place.description)}&f=json`;
      }

      let response = await fetch(url);
      let data = await response.json();
      
      // Fallback if magicKey failed
      if (!data.candidates || data.candidates.length === 0) {
        const fallbackUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(place.description)}&f=json`;
        response = await fetch(fallbackUrl);
        data = await response.json();
      }

      if (data.candidates && data.candidates.length > 0) {
        const loc = data.candidates[0].location;
        const coord = { latitude: loc.y, longitude: loc.x };
        setSelectedCoord(coord);
        setConfirmedAddress(place.description);
        setShowMap(true);
      }
    } catch (e) {
      console.error('Error finding address coordinates:', e);
    }
  };

  const handleRegionChange = async (region: any, details: any) => {
    if (region.latitudeDelta > 1) return;
    if (!details?.isGesture) return; // Only search if the user actually dragged the map manually
    
    setSelectedCoord({ latitude: region.latitude, longitude: region.longitude });
    
    try {
      const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${region.longitude},${region.latitude}&f=json`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.address) {
        const preciseAddress = data.address.LongLabel || data.address.Match_addr;
        const cleanedAddress = preciseAddress.replace(/, IND$/, '');
        setQuery(cleanedAddress);
        setConfirmedAddress(cleanedAddress);
      }
    } catch (error) {
      console.log('Map drag reverse geocode error:', error);
    }
  };

  const confirmAndReturn = () => {
    const finalLocation = confirmedAddress || query;
    if (finalLocation) {
      saveToHistory({
        place_id: Math.random().toString(),
        description: finalLocation,
        structured_formatting: { main_text: finalLocation.split(',')[0], secondary_text: finalLocation }
      });
    }

    import('react-native').then(({ DeviceEventEmitter }) => {
      DeviceEventEmitter.emit('locationSelected', {
        selectedLocation: finalLocation,
        selectedCoord: selectedCoord,
        locationType: type 
      });
      navigation.goBack();
    });
  };

  const handleCurrentLocation = async () => {
    setGpsLoading(true);
    setErrorMessage('');
    
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setErrorMessage('Location access denied. Please type your address manually.');
        setGpsLoading(false);
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      const coord = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      
      setSelectedCoord(coord);
      setPredictions([]); // hide list
      setShowMap(true); // force map open when getting current location
      
      mapRef.current?.animateToRegion({
        ...coord,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005
      }, 1000);
      
      const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${location.coords.longitude},${location.coords.latitude}&f=json`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.address) {
        const preciseAddress = data.address.LongLabel || data.address.Match_addr;
        const cleanedAddress = preciseAddress.replace(/, IND$/, '');
        setQuery(cleanedAddress);
        setConfirmedAddress(cleanedAddress);
      } else {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setErrorMessage('Could not find a valid address for your location.');
      }
      
    } catch (error: any) {
      console.error('GPS Error:', error);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      if (error.message && error.message.includes('unsatisfied device settings')) {
         setErrorMessage('Please turn on GPS/Location Services in your phone settings.');
      } else {
         setErrorMessage('Could not find GPS signal. Please type your address manually.');
      }
    } finally {
      setGpsLoading(false);
    }
  };

  const renderItem = ({ item, isHistory }: { item: Prediction, isHistory?: boolean }) => (
    <TouchableOpacity 
      style={styles.resultItem}
      onPress={() => handleSelectLocation(item)}
    >
      <View style={styles.resultIconContainer}>
        <Feather name={isHistory ? "clock" : "map-pin"} size={16} color={COLORS.textMuted} />
      </View>
      <View style={styles.resultTextContainer}>
        <Text style={styles.resultMainText} numberOfLines={1}>
          {item.structured_formatting.main_text}
        </Text>
        <Text style={styles.resultSubText} numberOfLines={1}>
          {item.structured_formatting.secondary_text}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* --- HEADER --- */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => navigation.goBack()}
        >
          <Feather name="arrow-left" size={24} color={COLORS.textMain} />
        </TouchableOpacity>

        <View style={styles.inputContainer}>
          <View style={[styles.typeIconContainer, { backgroundColor: type === 'pickup' ? '#10B981' : '#F59E0B' }]}>
            <Feather name={type === 'pickup' ? "arrow-up" : "arrow-down"} size={14} color="#FFFFFF" />
          </View>
          <TextInput
            style={styles.input}
            placeholder={type === 'pickup' ? "Search pickup location" : "Where is it going?"}
            value={query}
            onChangeText={setQuery}
            autoFocus
            placeholderTextColor={COLORS.textMuted}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
              <Feather name="x" size={18} color={COLORS.textMain} />
            </TouchableOpacity>
          )}
        </View>

        {/* Small Map Icon Button in Header */}
        <TouchableOpacity 
          style={styles.headerMapBtn} 
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setShowMap(true);
            setPredictions([]);
          }}
        >
          <Feather name="map" size={20} color={COLORS.primaryDark} />
        </TouchableOpacity>
      </View>

      {/* --- CURRENT LOCATION --- */}
      <TouchableOpacity style={styles.currentLocBtn} onPress={handleCurrentLocation} disabled={gpsLoading}>
        {gpsLoading ? (
          <ActivityIndicator size="small" color={COLORS.currentLocText} />
        ) : (
          <MaterialCommunityIcons name="crosshairs-gps" size={20} color={COLORS.currentLocText} />
        )}
        <Text style={styles.currentLocText}>
          {gpsLoading ? 'Locating you...' : 'Use your current location'}
        </Text>
      </TouchableOpacity>
      
      <View style={styles.divider} />

      {/* --- PREDICTIONS OR HISTORY --- */}
      {loading && query.length > 2 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primaryDark} />
        </View>
      ) : predictions.length > 0 ? (
        <FlatList
          data={predictions}
          keyExtractor={(item) => item.place_id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
        />
      ) : query.length === 0 && history.length > 0 && !showMap ? (
        <View style={{ flex: 1 }}>
          <Text style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, fontSize: 14, fontWeight: '600', color: COLORS.textMuted }}>
            {type === 'pickup' ? 'Recent Pickups' : 'Recent Drop-offs'}
          </Text>
          <FlatList
            data={history}
            keyExtractor={(item) => item.place_id}
            renderItem={({ item }) => renderItem({ item, isHistory: true })}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
          />
        </View>
      ) : null}

      {/* --- MAP VIEW --- */}
      {showMap ? (
        <View style={[styles.mapContainer, { backgroundColor: '#EFEFEF' }]}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            mapType={Platform.OS === 'android' ? 'none' : 'standard'}
            style={styles.map}
            onRegionChangeComplete={handleRegionChange}
            initialRegion={selectedCoord ? {
              ...selectedCoord,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            } : {
              latitude: 20.5937, // Center of India
              longitude: 78.9629,
              latitudeDelta: 20,
              longitudeDelta: 20,
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
          </MapView>
          
          {/* Stationary Center Pin (Zomato Style) */}
          <View style={styles.centerPinFixed} pointerEvents="none">
            <MaterialCommunityIcons name="map-marker" size={46} color={COLORS.primaryDark} style={{ marginTop: -23 }} />
          </View>
          
          {/* Floating Confirm Button */}
          {selectedCoord && (
            <View style={styles.confirmContainer}>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirmAndReturn}>
                <Text style={styles.confirmBtnText}>Confirm Location</Text>
                <Feather name="arrow-right" size={20} color="#FFFFFF" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  listContent: {
    paddingBottom: 20,
  },
  mapContainer: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  centerPinFixed: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -23,
    marginTop: -23,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  confirmContainer: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
  },
  confirmBtn: {
    backgroundColor: COLORS.primaryDark,
    borderRadius: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backBtn: {
    padding: 8,
    marginRight: 12,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    backgroundColor: COLORS.inputBg,
    marginRight: 12, // Space between input and map button
  },
  headerMapBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#F0F9FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0F2FE',
  },
  typeIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textMain,
    fontWeight: '500',
    height: '100%',
  },
  clearBtn: {
    padding: 4,
  },
  currentLocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  currentLocText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.currentLocText,
    marginLeft: 12,
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginHorizontal: 20,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  resultIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  resultTextContainer: {
    flex: 1,
  },
  resultMainText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textMain,
    marginBottom: 4,
  },
  resultSubText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  loadingContainer: {
    padding: 24,
    alignItems: 'center',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#EF4444',
    marginLeft: 6,
    fontWeight: '500',
  }
});
