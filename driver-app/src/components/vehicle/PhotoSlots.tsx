import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { PHOTO_SLOTS } from '../../services/vehiclePhotos';
import type { VehiclePhotoSlot } from '../../services/api';
import { Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface Props {
  /** The picture to show per slot: a local file or a signed link. */
  items: Partial<Record<VehiclePhotoSlot, string | null | undefined>>;
  /** The slot being uploaded right now. */
  busy?: VehiclePhotoSlot | null;
  onAdd: (slot: VehiclePhotoSlot) => void;
}

/** Vehicle photo slots: tap one to add or replace its photo. Every photo is optional. */
export default function PhotoSlots({ items, busy = null, onAdd }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.grid}>
      {PHOTO_SLOTS.map(({ slot, labelKey }) => {
        const uri = items[slot];
        const label = t(labelKey);
        const working = busy === slot;
        return (
          <Pressable
            key={slot}
            onPress={() => onAdd(slot)}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${t(uri ? 'vehicle_photo_replace' : 'vehicle_photo_add')}`}
            accessibilityState={{ disabled: busy !== null, busy: working }}
            style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}
          >
            <View style={styles.frame}>
              {uri ? (
                <Image source={{ uri }} style={styles.image} accessibilityIgnoresInvertColors />
              ) : (
                <Ionicons name="camera-outline" size={size.icon.lg} color={colors.textMuted} />
              )}
              {working ? (
                <View style={styles.busy}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : null}
            </View>
            <Text variant="captionMedium" numberOfLines={2}>
              {label}
            </Text>
            <Text variant="caption" color="accent" numberOfLines={2}>
              {t(uri ? 'vehicle_photo_replace' : 'vehicle_photo_add')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Two columns at every width (a 360dp phone included), so a lone last tile never stretches across the row
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space[3] },
  tile: { width: '48%', gap: space[1] },
  pressed: { opacity: 0.7 },
  frame: {
    aspectRatio: 4 / 3,
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  busy: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
});
