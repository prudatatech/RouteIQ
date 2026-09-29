import { useTranslation } from '../hooks/useTranslation';
import React, { useState, useEffect, useCallback, type ReactNode } from 'react';
import { View, StyleSheet, ActivityIndicator, Alert, Switch, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../services/api';
import { Button, Card, ErrorBanner, ScreenHeader, Text } from '../components/ui';
import { colors, space } from '../theme';
import { formatNumber } from '../utils/format';

interface ReturnTripScreenProps {
  vehicleId: string;
  onClose: () => void;
  /** Rendered at the right of the header (the SOS button). */
  headerRight?: ReactNode;
}

export default function ReturnTripScreen({ vehicleId, onClose, headerRight }: ReturnTripScreenProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [biddingOpen, setBiddingOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const loadVehicleInfo = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setLoadFailed(false);
      const vehicle = await api.getVehicleInfo(vehicleId);
      if (vehicle) {
        setCapacity(vehicle.available_capacity_kg ?? vehicle.capacity_kg ?? null);
        setBiddingOpen(vehicle.bidding_window_open || false);
      }
    } catch (error) {
      console.error('Failed to load vehicle info', error);
      if (!silent) setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    loadVehicleInfo();
    // The bidding window ends by itself (time runs out, dispatch closes it, a bid wins), which turns
    // the vehicle's flag off: keep the switch in step with it.
    const timer = setInterval(() => loadVehicleInfo(true), 30_000);
    return () => clearInterval(timer);
  }, [loadVehicleInfo]);

  const toggleMatching = async (val: boolean) => {
    try {
      setUpdating(true);
      await api.toggleBiddingWindow(vehicleId, val);
      setBiddingOpen(val);
      Alert.alert(
        val ? t('return_matching_enabled') : t('return_matching_disabled'),
        val ? t('return_searching_alert') : t('return_stopped_alert'),
      );
    } catch (error: any) {
      Alert.alert(t('error'), error.message || t('return_matching_failed'));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader
        title={t('return_title')}
        onBack={onClose}
        backIcon="close"
        backLabel={t('close')}
        right={headerRight}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} accessibilityLabel={t('loading')} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {loadFailed ? (
            <ErrorBanner message={t('vehicle_load_failed')} action={{ label: t('retry'), onPress: () => loadVehicleInfo() }} />
          ) : null}

          <Card style={styles.card}>
            <Text variant="bodySmallMedium" color="textMuted">
              {t('return_avail_cap')}
            </Text>
            <Text variant="heading">{capacity !== null ? `${formatNumber(capacity)} kg` : '—'}</Text>
            <Text variant="bodySmall" color="textMuted">
              {t('return_cap_desc')}
            </Text>
          </Card>

          <Card style={styles.row}>
            <View style={styles.flex}>
              <Text variant="title">{t('return_auto_match')}</Text>
              <Text variant="bodySmall" color="textMuted">
                {t('return_auto_match_desc')}
              </Text>
            </View>
            <Switch
              value={biddingOpen}
              onValueChange={toggleMatching}
              disabled={updating || loadFailed}
              trackColor={{ false: colors.borderStrong, true: colors.accentFill }}
              thumbColor={colors.surface}
              accessibilityLabel={t('return_auto_match')}
            />
          </Card>

          {biddingOpen && (
            <View style={styles.searching} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={colors.success} />
              <Text variant="bodySmallMedium" color="success">
                {t('return_searching')}
              </Text>
            </View>
          )}

          <Button title={t('done')} onPress={onClose} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space[4], gap: space[4] },
  card: { gap: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1, gap: space[1] },
  searching: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    padding: space[3],
  },
});
