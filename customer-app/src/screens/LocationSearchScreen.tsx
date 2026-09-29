import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  FlatList,
  Platform,
  ActivityIndicator,
  LayoutAnimation,
  UIManager,
  DeviceEventEmitter,
  Linking,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { PROVIDER_GOOGLE, UrlTile } from 'react-native-maps';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, ErrorBanner, IconButton, Text } from '../components/ui';
import { colors, radius, size, space, type } from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Prediction = {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
};

const PIN_SIZE = 46;

/** Why a location could not be used, shown to the customer with a way forward. */
type LocationProblem =
  | { kind: 'permission' }
  | { kind: 'services' }
  | { kind: 'no_fix' }
  | { kind: 'no_address' }
  | { kind: 'search' }
  | { kind: 'place' };

const PROBLEM_MESSAGES: Record<LocationProblem['kind'], string> = {
  permission:
    'Location access is off for MargixIndia. Allow it in Settings to use your current location, or type the address instead.',
  services: 'Location services are turned off on this phone. Turn them on in Settings, or type the address instead.',
  no_fix: 'Could not get your position. Move to an open area and try again, or type the address instead.',
  no_address: 'We found your position but not an address for it. Drag the map to adjust, or type the address.',
  search: 'Could not search right now. Check your internet connection and try again.',
  place: 'Could not open that place. Try again, or choose it on the map.',
};

export default function LocationSearchScreen({ navigation, route }: any) {
  const { type: locationType } = route.params || { type: 'pickup' }; // 'pickup' or 'dropoff'
  const isPickup = locationType === 'pickup';
  const [query, setQuery] = useState('');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [problem, setProblem] = useState<LocationProblem | null>(null);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [history, setHistory] = useState<Prediction[]>([]);

  // Map State
  const mapRef = useRef<MapView>(null);
  const [selectedCoord, setSelectedCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [confirmedAddress, setConfirmedAddress] = useState('');
  const [showMap, setShowMap] = useState(false);
  const isSelectingRef = useRef(false);

  // Load history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await AsyncStorage.getItem(`location_search_history_${locationType}`);
        if (stored) {
          setHistory(JSON.parse(stored));
        }
      } catch {}
    };
    loadHistory();
  }, [locationType]);

  const saveToHistory = async (place: Prediction) => {
    try {
      const storageKey = `location_search_history_${locationType}`;
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
    } catch {}
  };

  const fetchPlaces = useCallback(async (text: string) => {
    setLoading(true);
    setProblem((current) => (current?.kind === 'search' ? null : current));

    try {
      // Esri ArcGIS World Geocoding: the Google key is restricted to the native
      // Maps SDK and rejects REST calls.
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
              secondary_text: secondaryText,
            },
          };
        });

        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setPredictions(mappedResults);
      } else {
        setPredictions([]);
      }
      setSearchedQuery(text);
    } catch (error) {
      console.error('Error fetching places:', error);
      setProblem({ kind: 'search' });
    } finally {
      setLoading(false);
    }
  }, []);

  // Suggestions only apply to a query of 3 or more characters.
  const trimmedQuery = query.trim();
  const visiblePredictions = trimmedQuery.length >= 3 ? predictions : [];

  // Debounced search for real places API
  useEffect(() => {
    if (isSelectingRef.current) {
      isSelectingRef.current = false;
      return;
    }
    if (trimmedQuery.length < 3) return;

    const timer = setTimeout(() => {
      fetchPlaces(trimmedQuery);
    }, 600);

    return () => clearTimeout(timer);
  }, [trimmedQuery, fetchPlaces]);

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
        setProblem(null);
        setSelectedCoord(coord);
        setConfirmedAddress(place.description);
        setShowMap(true);
      } else {
        setProblem({ kind: 'place' });
      }
    } catch (e) {
      console.error('Error finding address coordinates:', e);
      setProblem({ kind: 'place' });
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
        setProblem(null);
        setQuery(cleanedAddress);
        setConfirmedAddress(cleanedAddress);
      } else {
        // We have a pin position but no address for it: don't leave the previous
        // location's text showing as if it still applied to the new pin.
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setQuery('');
        setConfirmedAddress('');
        setProblem({ kind: 'no_address' });
      }
    } catch (error) {
      console.log('Map drag reverse geocode error:', error);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setQuery('');
      setConfirmedAddress('');
      setProblem({ kind: 'no_address' });
    }
  };

  const confirmAndReturn = () => {
    const finalLocation = confirmedAddress || query;
    if (finalLocation) {
      saveToHistory({
        place_id: Math.random().toString(),
        description: finalLocation,
        structured_formatting: { main_text: finalLocation.split(',')[0], secondary_text: finalLocation },
      });
    }

    DeviceEventEmitter.emit('locationSelected', {
      selectedLocation: finalLocation,
      selectedCoord: selectedCoord,
      locationType,
    });
    navigation.goBack();
  };

  const handleCurrentLocation = useCallback(async () => {
    setGpsLoading(true);
    setProblem(null);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setProblem({ kind: 'permission' });
        return;
      }

      if (!(await Location.hasServicesEnabledAsync())) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setProblem({ kind: 'services' });
        return;
      }

      let location: Location.LocationObject;
      try {
        location = await Location.getCurrentPositionAsync({});
      } catch (error: any) {
        console.error('GPS error:', error);
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setProblem({ kind: error?.message?.includes('unsatisfied device settings') ? 'services' : 'no_fix' });
        return;
      }

      const coord = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      setSelectedCoord(coord);
      setPredictions([]); // hide list
      setShowMap(true); // open the map on the current location

      mapRef.current?.animateToRegion(
        {
          ...coord,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        },
        1000,
      );

      try {
        const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?location=${coord.longitude},${coord.latitude}&f=json`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.address) {
          const preciseAddress = data.address.LongLabel || data.address.Match_addr;
          const cleanedAddress = preciseAddress.replace(/, IND$/, '');
          setQuery(cleanedAddress);
          setConfirmedAddress(cleanedAddress);
        } else {
          setProblem({ kind: 'no_address' });
        }
      } catch (error) {
        console.error('Reverse geocode error:', error);
        setProblem({ kind: 'no_address' });
      }
    } finally {
      setGpsLoading(false);
    }
  }, []);

  // Coming back from Settings: if access or location services were fixed,
  // carry on without making the customer tap again.
  useEffect(() => {
    if (problem?.kind !== 'permission' && problem?.kind !== 'services') return;
    const subscription = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      const { status } = await Location.getForegroundPermissionsAsync();
      const servicesOn = await Location.hasServicesEnabledAsync();
      if (status === 'granted' && servicesOn) handleCurrentLocation();
    });
    return () => subscription.remove();
  }, [problem, handleCurrentLocation]);

  const renderProblem = () => {
    if (!problem) return null;
    const needsSettings = problem.kind === 'permission' || problem.kind === 'services';
    const canRetryGps = needsSettings || problem.kind === 'no_fix';
    return (
      <View style={styles.problem}>
        <ErrorBanner
          message={PROBLEM_MESSAGES[problem.kind]}
          action={
            problem.kind === 'search' && trimmedQuery.length >= 3
              ? { label: 'Try again', onPress: () => fetchPlaces(trimmedQuery) }
              : undefined
          }
        />
        {canRetryGps ? (
          <View style={styles.problemActions}>
            {needsSettings ? (
              <Button
                title="Open settings"
                variant="secondary"
                block={false}
                style={styles.flex}
                onPress={() => Linking.openSettings()}
                icon={(color) => <Feather name="settings" size={size.icon.sm} color={color} />}
              />
            ) : null}
            <Button
              title="Try again"
              variant="ghost"
              block={false}
              style={styles.flex}
              loading={gpsLoading}
              onPress={handleCurrentLocation}
            />
          </View>
        ) : null}
      </View>
    );
  };

  const renderItem = ({ item, isHistory }: { item: Prediction; isHistory?: boolean }) => (
    <Pressable
      style={({ pressed }) => [styles.resultItem, pressed && styles.pressed]}
      onPress={() => handleSelectLocation(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.structured_formatting.main_text}, ${item.structured_formatting.secondary_text}`}
    >
      <View style={styles.resultIcon}>
        <Feather name={isHistory ? 'clock' : 'map-pin'} size={size.icon.sm} color={colors.textMuted} />
      </View>
      <View style={styles.flex}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {item.structured_formatting.main_text}
        </Text>
        <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
          {item.structured_formatting.secondary_text}
        </Text>
      </View>
    </Pressable>
  );

  const placeholder = isPickup ? 'Search pickup location' : 'Where is it going?';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* --- HEADER --- */}
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Back"
          onPress={() => navigation.goBack()}
          icon={(color) => <Feather name="arrow-left" size={size.icon.lg} color={color} />}
        />

        <View style={styles.inputContainer}>
          <View style={styles.typeIcon}>
            <Feather name={isPickup ? 'arrow-up' : 'arrow-down'} size={size.icon.sm} color={colors.onAccentFill} />
          </View>
          <TextInput
            style={styles.input}
            placeholder={placeholder}
            accessibilityLabel={isPickup ? 'Pickup location' : 'Drop-off location'}
            value={query}
            onChangeText={setQuery}
            autoFocus
            returnKeyType="search"
            placeholderTextColor={colors.textDisabled}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear search">
              <Feather name="x" size={size.icon.md} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <IconButton
          accessibilityLabel="Choose on map"
          variant="secondary"
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setShowMap(true);
            setPredictions([]);
          }}
          icon={() => <Feather name="map" size={size.icon.md} color={colors.accent} />}
        />
      </View>

      {/* --- CURRENT LOCATION --- */}
      <Pressable
        style={({ pressed }) => [styles.currentLocBtn, pressed && styles.pressed]}
        onPress={handleCurrentLocation}
        disabled={gpsLoading}
        accessibilityRole="button"
        accessibilityLabel="Use your current location"
        accessibilityState={{ disabled: gpsLoading, busy: gpsLoading }}
      >
        {gpsLoading ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <MaterialCommunityIcons name="crosshairs-gps" size={size.icon.md} color={colors.accent} />
        )}
        <Text variant="bodyMedium" color="accent">
          {gpsLoading ? 'Finding your location…' : 'Use your current location'}
        </Text>
      </Pressable>

      {renderProblem()}

      <View style={styles.divider} />

      {/* --- PREDICTIONS OR HISTORY --- */}
      {loading && query.length > 2 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} accessibilityLabel="Searching" />
        </View>
      ) : visiblePredictions.length > 0 ? (
        <FlatList
          data={visiblePredictions}
          keyExtractor={(item) => item.place_id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
        />
      ) : !showMap && trimmedQuery.length >= 3 && searchedQuery === trimmedQuery && !problem ? (
        <Text variant="bodySmall" color="textMuted" style={styles.noResults} accessibilityLiveRegion="polite">
          No matching places. Try a different search, or choose the place on the map.
        </Text>
      ) : query.length === 0 && history.length > 0 && !showMap ? (
        <View style={styles.flex}>
          <Text variant="bodySmallMedium" color="textMuted" style={styles.historyTitle} accessibilityRole="header">
            {isPickup ? 'Recent pickups' : 'Recent drop-offs'}
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
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            mapType={Platform.OS === 'android' ? 'none' : 'standard'}
            style={StyleSheet.absoluteFill}
            onRegionChangeComplete={handleRegionChange}
            initialRegion={
              selectedCoord
                ? {
                    ...selectedCoord,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                  }
                : {
                    latitude: 20.5937, // Centre of India
                    longitude: 78.9629,
                    latitudeDelta: 20,
                    longitudeDelta: 20,
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
          </MapView>

          {/* Fixed centre pin: drag the map to place it */}
          <View style={styles.centerPin} pointerEvents="none">
            <MaterialCommunityIcons name="map-marker" size={PIN_SIZE} color={colors.accent} />
          </View>

          {selectedCoord && (
            <SafeAreaView edges={['bottom']} style={styles.confirmContainer}>
              <Button
                title="Confirm location"
                onPress={confirmAndReturn}
                icon={(color) => <Feather name="check" size={size.icon.md} color={color} />}
              />
            </SafeAreaView>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  listContent: { paddingBottom: space[4] },
  pressed: { backgroundColor: colors.surfaceSubtle },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[2],
    paddingVertical: space[2],
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    borderWidth: size.border,
    borderColor: colors.accent,
    borderRadius: radius.control,
    paddingHorizontal: space[3],
    minHeight: size.control,
    backgroundColor: colors.surface,
  },
  typeIcon: {
    width: space[6],
    height: space[6],
    borderRadius: radius.control - 2,
    backgroundColor: colors.accentFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    ...type.body,
    flex: 1,
    color: colors.text,
    minHeight: size.control,
  },
  currentLocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    minHeight: size.control + space[2],
  },
  divider: { height: size.border, backgroundColor: colors.border, marginHorizontal: space[4] },
  historyTitle: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[2] },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: size.control + space[4],
    borderBottomWidth: size.border,
    borderBottomColor: colors.border,
  },
  resultIcon: {
    width: space[8],
    height: space[8],
    borderRadius: radius.full,
    backgroundColor: colors.surfaceSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: { padding: space[6], alignItems: 'center' },
  noResults: { padding: space[4] },
  problem: { gap: space[2], paddingHorizontal: space[4], paddingBottom: space[3] },
  problemActions: { flexDirection: 'row', gap: space[2] },
  mapContainer: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  centerPin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -PIN_SIZE / 2,
    // The pin's tip, not its centre, marks the location.
    marginTop: -PIN_SIZE,
  },
  confirmContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: space[4],
  },
});
