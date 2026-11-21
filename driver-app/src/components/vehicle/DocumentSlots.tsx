import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../hooks/useTranslation';
import { DOCUMENT_SLOTS } from '../../services/vehicleDocuments';
import type { VehicleDocumentSlot } from '../../services/api';
import { Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface Props {
  /** The picture to show per slot: a local file or a signed link. */
  items: Partial<Record<VehicleDocumentSlot, string | null | undefined>>;
  /** Dispatch's reason a document needs fixing, keyed by slot; absent when nothing was flagged. */
  issues?: Partial<Record<VehicleDocumentSlot, string>>;
  /** The slot being uploaded right now. */
  busy?: VehicleDocumentSlot | null;
  onAdd: (slot: VehicleDocumentSlot) => void;
}

/** Vehicle document slots: tap one to add or replace its file. Every document is optional. */
export default function DocumentSlots({ items, issues = {}, busy = null, onAdd }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.grid}>
      {DOCUMENT_SLOTS.map(({ slot, labelKey }) => {
        const uri = items[slot];
        const issue = issues[slot];
        const label = t(labelKey);
        const working = busy === slot;
        return (
          <Pressable
            key={slot}
            onPress={() => onAdd(slot)}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${t(uri ? 'vehicle_document_replace' : 'vehicle_document_add')}`}
            accessibilityState={{ disabled: busy !== null, busy: working }}
            style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}
          >
            <View style={[styles.frame, issue ? styles.frameFlagged : null]}>
              {uri ? (
                <Image source={{ uri }} style={styles.image} accessibilityIgnoresInvertColors />
              ) : (
                <Ionicons name="document-text-outline" size={size.icon.lg} color={colors.textMuted} />
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
              {t(uri ? 'vehicle_document_replace' : 'vehicle_document_add')}
            </Text>
            {issue ? (
              <Text variant="caption" color="danger" numberOfLines={3}>
                {issue}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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
  frameFlagged: { borderColor: colors.danger, borderWidth: 2 },
  image: { width: '100%', height: '100%' },
  busy: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
});
