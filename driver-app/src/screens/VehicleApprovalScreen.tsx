/**
 * MargixIndia Driver App — Waiting for approval / not approved / approved
 *
 * The screen a driver sees after registering a vehicle. It shows what was
 * submitted and when, has a refresh button, and updates on its own (see
 * useVehicleRegistration). A rejection shows dispatch's reason and lets the
 * driver fix the details and submit again.
 */
import React, { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { MyVehicleRegistration, VehiclePhotoSlot } from '../services/api';
import { chooseVehiclePhoto, uploadVehiclePhoto } from '../services/vehiclePhotos';
import { REGISTRATION_KEY } from '../hooks/useVehicleRegistration';
import { useTranslation } from '../hooks/useTranslation';
import PhotoSlots from '../components/vehicle/PhotoSlots';
import { Button, Card, ErrorBanner, StatusPill, Text } from '../components/ui';
import { formatDateTime, formatNumber } from '../utils/format';
import { colors, size, space } from '../theme';

interface Props {
  registration: MyVehicleRegistration;
  /** 'approved' is the short "you can start" screen shown once, right after the decision. */
  view: 'pending' | 'rejected' | 'approved';
  refreshing: boolean;
  onRefresh: () => void;
  onEdit: () => void;
  onContinue: () => void;
  onLogout: () => void;
}

export default function VehicleApprovalScreen({ registration, view, refreshing, onRefresh, onEdit, onContinue, onLogout }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busySlot, setBusySlot] = useState<VehiclePhotoSlot | null>(null);
  const vehicle = registration.vehicle;
  if (!vehicle) return null;

  const photoItems: Partial<Record<VehiclePhotoSlot, string | null>> = {};
  for (const p of registration.photos) photoItems[p.slot] = p.url;

  const addPhoto = async (slot: VehiclePhotoSlot) => {
    const uri = await chooseVehiclePhoto(t);
    if (!uri) return;
    setBusySlot(slot);
    try {
      await uploadVehiclePhoto(vehicle.id, slot, uri);
      await queryClient.invalidateQueries({ queryKey: REGISTRATION_KEY });
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || t('vehicle_photo_failed'));
    } finally {
      setBusySlot(null);
    }
  };

  const tone = view === 'approved' ? 'success' : view === 'rejected' ? 'danger' : 'warning';
  const icon = view === 'approved' ? 'checkmark-circle' : view === 'rejected' ? 'close-circle' : 'hourglass-outline';
  const title = t(view === 'approved' ? 'vehicle_approved_title' : view === 'rejected' ? 'vehicle_rejected_title' : 'vehicle_pending_title');
  const description =
    view === 'approved'
      ? t('vehicle_approved_desc').replace('{plate}', vehicle.plate_number)
      : t(view === 'rejected' ? 'vehicle_rejected_desc' : 'vehicle_pending_desc');

  const rows: [string, string][] = [
    [t('vehicle_plate'), vehicle.plate_number],
    [t('vehicle_type'), t(`vehicle_kind_${vehicle.vehicle_type}`)],
    [t('vehicle_capacity'), vehicle.capacity_kg ? `${formatNumber(vehicle.capacity_kg)} kg` : '—'],
  ];
  if (vehicle.vehicle_model) rows.push([t('vehicle_model_label'), vehicle.vehicle_model]);
  if (vehicle.rc_number) rows.push([t('vehicle_rc_number'), vehicle.rc_number]);
  if (vehicle.insurance_number) rows.push([t('vehicle_insurance_number'), vehicle.insurance_number]);
  if (vehicle.submitted_at) rows.push([t('vehicle_submitted_at'), formatDateTime(vehicle.submitted_at)]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        <Card style={styles.status}>
          <Ionicons name={icon} size={size.icon.xl * 2} color={colors[tone]} />
          <Text variant="heading" align="center" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="bodySmall" color="textMuted" align="center" accessibilityLiveRegion="polite">
            {description}
          </Text>
          {view === 'pending' ? <StatusPill label={t('vehicle_pending_pill')} tone="warning" /> : null}
        </Card>

        {view === 'rejected' && vehicle.rejection_reason ? (
          <View style={styles.gap}>
            <Text variant="bodySmallMedium">{t('vehicle_rejected_reason')}</Text>
            <ErrorBanner message={vehicle.rejection_reason} />
          </View>
        ) : null}

        {view !== 'approved' ? (
          <>
            <View style={styles.gap}>
              <Text variant="title" accessibilityRole="header">
                {t('vehicle_details_title')}
              </Text>
              <Card padded={false}>
                {rows.map(([label, value], idx) => (
                  <View key={label} style={[styles.row, idx > 0 ? styles.rowBorder : null]}>
                    <Text variant="bodySmall" color="textMuted" style={styles.label}>
                      {label}
                    </Text>
                    <Text variant="bodyMedium" style={styles.value}>
                      {value}
                    </Text>
                  </View>
                ))}
              </Card>
            </View>

            {view === 'pending' ? (
              <View style={styles.gap}>
                <Text variant="title" accessibilityRole="header">
                  {t('vehicle_photos_title')}
                </Text>
                <Text variant="bodySmall" color="textMuted">
                  {t('vehicle_photos_hint')}
                </Text>
                <PhotoSlots items={photoItems} busy={busySlot} onAdd={addPhoto} />
              </View>
            ) : null}
          </>
        ) : null}

        <View style={styles.gap}>
          {view === 'approved' ? <Button title={t('vehicle_continue')} onPress={onContinue} /> : null}
          {view === 'rejected' ? <Button title={t('vehicle_resubmit')} onPress={onEdit} /> : null}
          {view === 'pending' ? (
            <>
              <Button title={t('vehicle_refresh')} onPress={onRefresh} loading={refreshing} />
              <Button title={t('vehicle_edit_details')} variant="secondary" onPress={onEdit} />
            </>
          ) : null}
          {view !== 'approved' ? <Button title={t('logout')} variant="ghost" onPress={onLogout} /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space[4], gap: space[4] },
  status: { alignItems: 'center', gap: space[3], paddingVertical: space[6] },
  gap: { gap: space[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[3], padding: space[4] },
  rowBorder: { borderTopWidth: size.border, borderTopColor: colors.border },
  // Both sides may wrap: long Indian-language labels no longer squeeze the value off the row
  label: { flex: 1 },
  value: { flex: 1, textAlign: 'right' },
});
