import React, { type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

interface HomeHeaderProps {
  driverName?: string | null;
  plateNumber?: string | null;
  avatarUri?: string | null;
  /** Rendered at the right edge (the SOS button). */
  right?: ReactNode;
}

const AVATAR = 40;

/** Driver and vehicle at a glance. Safe-area padding is applied by the screen. */
export default function HomeHeader({ driverName, plateNumber, avatarUri, right }: HomeHeaderProps) {
  const { t } = useTranslation();
  const firstName = driverName?.trim().split(' ')[0];

  return (
    <View style={styles.header}>
      <View style={styles.avatar} importantForAccessibility="no-hide-descendants">
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
        ) : (
          <Ionicons name="person" size={size.icon.md} color={colors.accent} />
        )}
      </View>
      <View style={styles.titles} accessible accessibilityRole="header">
        <Text variant="title" numberOfLines={1}>
          {firstName ? `${t('hello_driver')}, ${firstName}` : t('hello_driver')}
        </Text>
        <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
          {t('my_vehicle')}:{' '}
          {!plateNumber
            ? t('not_assigned')
            : isPlaceholderPlate(plateNumber)
              ? t('vehicle_not_registered')
              : <Text variant="monoMedium">{plateNumber}</Text>}
        </Text>
      </View>
      {right}
    </View>
  );
}

/** TEMP-… plates are placeholders created for drivers whose vehicle isn't registered yet. */
const isPlaceholderPlate = (plate: string) => /^TEMP-/i.test(plate);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    backgroundColor: colors.surface,
  },
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
  titles: { flex: 1 },
});
