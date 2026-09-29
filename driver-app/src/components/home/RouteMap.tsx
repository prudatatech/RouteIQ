import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useTranslation } from '../../hooks/useTranslation';
import type { MapPoint } from '../../hooks/useSnappedRoute';
import type { DriverRoute, LatLng } from '../../types/route';
import { pendingStops, sortedStops, stopCoord } from '../../utils/route';
import { IconButton } from '../ui';
import { colors, elevation, radius, size, space } from '../../theme';

interface RouteMapProps {
  route: DriverRoute | null | undefined;
  currentLoc: LatLng | null;
  line: MapPoint[];
}

const MAP_HEIGHT = 280;
const STOP_ZOOM_DELTA = 0.1;
const MY_LOCATION_ZOOM = 16;

/** Route map with stops, the road line and a "centre on me" button. */
export default function RouteMap({ route, currentLoc, line }: RouteMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const centredOnce = useRef(false);
  // The phone's own position, read once when tracking has not reported one yet (no route, tracking off).
  const [deviceLoc, setDeviceLoc] = useState<LatLng | null>(null);

  useEffect(() => {
    if (currentLoc || deviceLoc) return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (!cancelled && loc) setDeviceLoc({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch (e) {
        console.warn(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentLoc, deviceLoc]);

  // Start on the next stop, else the first stop, else the driver.
  const focus = useMemo<LatLng | null>(
    () => stopCoord(pendingStops(route)[0]) ?? stopCoord(sortedStops(route)[0]) ?? currentLoc ?? deviceLoc,
    [route, currentLoc, deviceLoc],
  );

  // Only the first known focus is used as the starting region (MapView ignores later changes).
  const hasFocus = !!focus;
  const initialRegion = useMemo<Region | undefined>(
    () =>
      focus
        ? { latitude: focus.lat, longitude: focus.lng, latitudeDelta: STOP_ZOOM_DELTA, longitudeDelta: STOP_ZOOM_DELTA }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasFocus],
  );

  // If nothing was known when the map mounted, move there once it is.
  useEffect(() => {
    if (!focus || centredOnce.current) return;
    centredOnce.current = true;
    mapRef.current?.animateToRegion(
      { latitude: focus.lat, longitude: focus.lng, latitudeDelta: STOP_ZOOM_DELTA, longitudeDelta: STOP_ZOOM_DELTA },
      300,
    );
  }, [focus]);

  const centreOnMe = async () => {
    let target = currentLoc ?? deviceLoc;
    if (!target) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        target = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      } catch (e) {
        console.warn(e);
        return;
      }
    }
    mapRef.current?.animateCamera({ center: { latitude: target.lat, longitude: target.lng }, zoom: MY_LOCATION_ZOOM }, { duration: 200 });
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        showsUserLocation
        showsMyLocationButton={false}
        initialRegion={initialRegion}
        accessibilityLabel={t('map_label')}
      >
        {line.length > 1 && <Polyline coordinates={line} strokeColor={colors.accent} strokeWidth={5} />}
        {sortedStops(route).map((stop) => {
          const c = stopCoord(stop);
          if (!c) return null;
          return (
            <Marker
              key={stop.id}
              coordinate={{ latitude: c.lat, longitude: c.lng }}
              title={stop.delivery_point?.name ?? undefined}
              description={stop.delivery_point?.address ?? undefined}
              pinColor={stop.status === 'completed' ? colors.success : stop.status === 'failed' ? colors.neutral : colors.accent}
            />
          );
        })}
      </MapView>

      <IconButton
        accessibilityLabel={t('centre_on_me')}
        variant="secondary"
        style={styles.fab}
        onPress={centreOnMe}
        icon={(color) => <Ionicons name="locate-outline" size={size.icon.md} color={color} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: MAP_HEIGHT,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: size.border,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  fab: { position: 'absolute', right: space[3], bottom: space[3], ...elevation.sm },
});
