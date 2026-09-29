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
  /** Shortcut shown while tracking is on: pause tracking for a break. */
  onTakeBreak?: () => void;
  onRetrySync: () => void;
  /** Repeated background GPS-send/geofence failures, or null when tracking is healthy. */
  backgroundError?: { at: number; message: string } | null;
  onRetryBackgroundTracking?: () => void;
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
  onTakeBreak,
  onRetrySync,
  backgroundError,
  onRetryBackgroundTracking,
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

      {isTracking && onTakeBreak ? (
        <StatusPill
          tone="accent"
          label={t('action_break')}
          icon={icon('cafe-outline')}
          onPress={onTakeBreak}
          accessibilityHint={t('take_break_sub')}
        />
      ) : null}

      {backgroundError ? (
        <StatusPill
          tone="warning"
          label={t('status_tracking_error')}
          icon={icon('warning-outline')}
          onPress={onRetryBackgroundTracking}
          accessibilityHint={t('hint_retry_tracking')}
        />
      ) : null}

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
