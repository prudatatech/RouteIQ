import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import { INDIAN_VEHICLES } from '../../constants/profile';
import LanguagePicker from '../../components/LanguagePicker';
import DocumentsSection from '../../components/profile/DocumentsSection';
import EmergencyContactsSection from '../../components/profile/EmergencyContactsSection';
import { useMyPeople } from '../../hooks/useMyPeople';
import { useVehicleGate } from '../VehicleGate';
import { Button, Card, IconButton, Text, TextField } from '../../components/ui';
import { colors, radius, size, space } from '../../theme';
import { formatNumber } from '../../utils/format';

export const AVATAR_KEY = 'driver_avatar_uri';

interface ProfileTabProps {
  driverInfo: any;
  onDriverInfoChange: (info: any) => void;
  avatarUri: string | null;
  onAvatarChange: (uri: string) => void;
  onLogout: () => void;
}

const AVATAR = 96;
const NAME_PATTERN = /^[\p{L}\s.-]+$/u;

export default function ProfileTab({ driverInfo, onDriverInfoChange, avatarUri, onAvatarChange, onLogout }: ProfileTabProps) {
  const vehicleGate = useVehicleGate();
  const { t } = useTranslation();
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingVehicle, setSavingVehicle] = useState<string | null>(null);

  const people = useMyPeople();

  const shortId =driverInfo?.id ? String(driverInfo.id).slice(0, 6).toUpperCase() : null;

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });
      if (!result.canceled && result.assets?.length) {
        const uri = result.assets[0].uri;
        onAvatarChange(uri);
        await AsyncStorage.setItem(AVATAR_KEY, uri);
      }
    } catch (e) {
      console.log('Image picker error', e);
      Alert.alert(t('error'), t('avatar_pick_failed'));
    }
  };

  const saveName = async () => {
    const newName = nameValue.trim();
    if (!newName) {
      setNameError(t('name_empty'));
      return;
    }
    if (!NAME_PATTERN.test(newName)) {
      setNameError(t('name_invalid_chars'));
      return;
    }
    setSavingName(true);
    try {
      await api.updateProfile({ full_name: newName });
      onDriverInfoChange({ ...driverInfo, full_name: newName });
      setIsEditingName(false);
    } catch (e: any) {
      setNameError(e?.message || t('name_save_failed'));
    } finally {
      setSavingName(false);
    }
  };

  const selectVehicle = async (vehicleType: string) => {
    setSavingVehicle(vehicleType);
    try {
      await api.updateProfile({ vehicle_type: vehicleType });
      onDriverInfoChange({ ...driverInfo, vehicle_type: vehicleType });
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || t('vehicle_save_failed'));
    } finally {
      setSavingVehicle(null);
    }
  };

  const confirmLogout = () => {
    Alert.alert(t('logout'), t('logout_confirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('logout'), style: 'destructive', onPress: onLogout },
    ]);
  };

  return (
    <View style={styles.container}>
      <Card style={styles.identity}>
        <Pressable
          onPress={pickImage}
          accessibilityRole="button"
          accessibilityLabel={t('change_photo')}
          style={styles.avatarWrap}
        >
          <View style={styles.avatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person" size={size.icon.xl} color={colors.accent} />
            )}
          </View>
          <View style={styles.avatarBadge}>
            <Ionicons name="camera" size={size.icon.sm} color={colors.onAccentFill} />
          </View>
        </Pressable>

        {isEditingName ? (
          <View style={styles.nameEdit}>
            <TextField
              label={t('full_name')}
              value={nameValue}
              onChangeText={(v) => {
                setNameValue(v);
                if (nameError) setNameError('');
              }}
              error={nameError || undefined}
              autoFocus
              autoCapitalize="words"
              onSubmitEditing={saveName}
            />
            <View style={styles.row}>
              <Button
                title={t('cancel')}
                variant="secondary"
                block={false}
                style={styles.flex}
                onPress={() => setIsEditingName(false)}
                disabled={savingName}
              />
              <Button title={t('save')} block={false} style={styles.flex} onPress={saveName} loading={savingName} />
            </View>
          </View>
        ) : (
          <View style={styles.nameRow}>
            <View style={styles.nameText}>
              <Text variant="heading" align="center">
                {driverInfo?.full_name || t('driver')}
              </Text>
              {shortId ? (
                <Text variant="mono" color="textMuted" align="center" accessibilityLabel={`${t('driver_id')} ${shortId}`}>
                  #{shortId}
                </Text>
              ) : null}
            </View>
            <IconButton
              accessibilityLabel={t('edit_name')}
              onPress={() => {
                setNameValue(driverInfo?.full_name || '');
                setNameError('');
                setIsEditingName(true);
              }}
              icon={(color) => <Ionicons name="pencil" size={size.icon.md} color={color} />}
            />
          </View>
        )}
        {driverInfo?.phone ? (
          <Text variant="mono" color="textMuted" align="center">
            {driverInfo.phone}
          </Text>
        ) : null}
      </Card>

      <Text variant="title" accessibilityRole="header">
        {t('change_language')}
      </Text>
      <LanguagePicker />

      <Text variant="title" accessibilityRole="header">
        {t('my_vehicle')}
      </Text>
      {vehicleGate.state === 'none' ? (
        <Card style={styles.register}>
          <Text variant="bodySmall" color="textMuted">
            {t('vehicle_reg_intro')}
          </Text>
          <Button
            title={t('vehicle_register_button')}
            onPress={vehicleGate.registerVehicle}
            icon={(color) => <Ionicons name="add-circle-outline" size={size.icon.md} color={color} />}
          />
        </Card>
      ) : null}
      <Card padded={false} accessibilityRole="radiogroup">
        {INDIAN_VEHICLES.map((v, idx) => {
          const selected = driverInfo?.vehicle_type === v.id;
          const label = t(v.key);
          return (
            <Pressable
              key={v.id}
              onPress={() => selectVehicle(v.id)}
              disabled={savingVehicle !== null}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: savingVehicle !== null }}
              accessibilityLabel={`${label}, ${formatNumber(v.capacity_kg)} kg`}
              style={({ pressed }) => [styles.vehicle, idx > 0 && styles.vehicleBorder, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text variant="bodyMedium" color={selected ? 'accent' : 'text'}>
                  {label}
                </Text>
                <Text variant="caption" color="textMuted">
                  {`${formatNumber(v.capacity_kg)} kg · ${v.container}`}
                </Text>
              </View>
              {selected ? <Ionicons name="checkmark-circle" size={size.icon.md} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </Card>

      <DocumentsSection
        documents={people.data?.documents ?? null}
        consentMissing={!!people.data && !people.data.consent_at}
        loading={people.loading}
        error={people.error}
        onRetry={people.reload}
        onChanged={people.reload}
      />

      <EmergencyContactsSection
        contacts={people.data?.emergency_contacts ?? null}
        loading={people.loading}
        error={people.error}
        onRetry={people.reload}
      />

      <Button
        title={t('logout')}
        variant="secondary"
        onPress={confirmLogout}
        icon={(color) => <Ionicons name="log-out-outline" size={size.icon.md} color={color} />}
      />
    </View>
  );
}

const BADGE = 32;

const styles = StyleSheet.create({
  container: { gap: space[4] },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: space[3] },
  register: { gap: space[3] },
  identity: { alignItems: 'center', gap: space[2] },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: BADGE,
    height: BADGE,
    borderRadius: radius.full,
    backgroundColor: colors.accentFill,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameEdit: { alignSelf: 'stretch', gap: space[3] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  nameText: { alignItems: 'center' },
  vehicle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: size.control + space[2],
  },
  vehicleBorder: { borderTopWidth: size.border, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surfaceSubtle },
});
