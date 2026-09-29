import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { DeviceLocationStatus } from '../../hooks/useDeviceLocationStatus';
import type { SyncState } from '../../hooks/useDriverRoute';
import { StatusPill } from '../ui';
import { colors, size, space } from '../../theme';

interface StatusStripProps {
  location: DeviceLocationStatus;
  isTracking: boolean;
  isStartingTracking: boolean;
  syncState: SyncState;
  onToggleTracking: () => void;
  onRetrySync: () => void;
}

const icon = (name: keyof typeof Ionicons.glyphMap) => (color: string) => (
  <Ionicons name={name} size={size.icon.sm} color={color} />
);

/** Always-visible device state: location, live tracking and connection. */
export default function StatusStrip({
  location,
  isTracking,
  isStartingTracking,
  syncState,
  onToggleTracking,
  onRetrySync,
}: StatusStripProps) {
  const { t } = useTranslation();
  const openSettings = () => Linking.openSettings();

  const locationBlocked = location.checked && location.permission !== 'granted';
  const gpsOff = location.checked && !location.servicesEnabled;

  return (
    <View style={styles.strip} accessibilityRole="summary">
      {locationBlocked ? (
        <StatusPill
          tone="danger"
          label={t('status_location_blocked')}
          icon={icon('location-outline')}
          onPress={openSettings}
          accessibilityHint={t('hint_open_settings')}
        />
      ) : gpsOff ? (
        <StatusPill
          tone="danger"
          label={t('status_gps_off')}
          icon={icon('location-outline')}
          onPress={openSettings}
          accessibilityHint={t('hint_open_settings')}
        />
      ) : (
        <StatusPill tone="success" label={t('status_gps_on')} icon={icon('location')} />
      )}

      <StatusPill
        tone={isTracking ? 'success' : 'neutral'}
        label={
          isStartingTracking ? t('status_tracking_starting') : isTracking ? t('status_tracking_on') : t('status_tracking_off')
        }
        icon={icon(isTracking ? 'radio' : 'radio-outline')}
        onPress={isStartingTracking ? undefined : onToggleTracking}
        accessibilityHint={t('hint_toggle_tracking')}
      />

      {syncState === 'offline' ? (
        <StatusPill
          tone="danger"
          label={t('status_offline')}
          icon={icon('cloud-offline-outline')}
          onPress={onRetrySync}
          accessibilityHint={t('hint_retry_sync')}
        />
      ) : syncState === 'failed' ? (
        <StatusPill
          tone="warning"
          label={t('status_sync_failed')}
          icon={icon('sync-outline')}
          onPress={onRetrySync}
          accessibilityHint={t('hint_retry_sync')}
        />
      ) : (
        <StatusPill tone="success" label={t('status_online')} icon={icon('cloud-done-outline')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    backgroundColor: colors.surface,
    borderBottomWidth: size.border,
    borderBottomColor: colors.border,
  },
});
