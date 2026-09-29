import React, { useCallback, useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, UrlTile } from 'react-native-maps';
import { colors, radius, size } from '../theme';
import { useTranslation } from '../hooks/useTranslation';

type Point = { latitude: number; longitude: number };

interface TrackingMapProps {
  pickup: Point;
  drop: Point;
  /** Last known position of the vehicle, when it has reported one. */
  vehicle?: Point | null;
  vehicleLabel?: string;
}

/** Pickup, drop-off and (when known) the vehicle, framed together. */
export function TrackingMap({ pickup, drop, vehicle, vehicleLabel }: TrackingMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const vehicleLat = vehicle?.latitude;
  const vehicleLng = vehicle?.longitude;

  const fit = useCallback(() => {
    const points = [pickup, drop];
    if (vehicleLat != null && vehicleLng != null) points.push({ latitude: vehicleLat, longitude: vehicleLng });
    mapRef.current?.fitToCoordinates(points, {
      edgePadding: { top: size.control, right: size.control, bottom: size.control, left: size.control },
      animated: false,
    });
  }, [pickup, drop, vehicleLat, vehicleLng]);

  // Frame everything again when the vehicle first appears or moves.
  useEffect(() => {
    fit();
  }, [fit]);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        mapType={Platform.OS === 'android' ? 'none' : 'standard'}
        onMapReady={fit}
        initialRegion={{
          latitude: (pickup.latitude + drop.latitude) / 2,
          longitude: (pickup.longitude + drop.longitude) / 2,
          latitudeDelta: Math.abs(pickup.latitude - drop.latitude) * 1.8 || 0.1,
          longitudeDelta: Math.abs(pickup.longitude - drop.longitude) * 1.8 || 0.1,
        }}
      >
        {Platform.OS === 'android' && (
          <UrlTile urlTemplate="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2&hl=en" maximumZ={19} tileSize={256} flipY={false} />
        )}
        <Marker coordinate={pickup} pinColor={colors.accent} title={t('pickup')} />
        <Marker coordinate={drop} pinColor={colors.info} title={t('dropoff')} />
        {vehicleLat != null && vehicleLng != null ? (
          <Marker
            coordinate={{ latitude: vehicleLat, longitude: vehicleLng }}
            pinColor={colors.warning}
            title={vehicleLabel ? `${t('vehicle')} ${vehicleLabel}` : t('your_vehicle')}
          />
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 240,
    borderRadius: radius.card,
    overflow: 'hidden',
    borderWidth: size.border,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
});
