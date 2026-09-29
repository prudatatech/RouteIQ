import React from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../hooks/useTranslation';
import { Text } from '../ui';
import { colors, size, space } from '../../theme';

export type DriverTab = 'route' | 'wallet' | 'profile';

interface DriverTabBarProps {
  active: DriverTab;
  onChange: (tab: DriverTab) => void;
}

const TABS: { key: DriverTab; label: string; icon: (color: string, active: boolean) => React.ReactNode }[] = [
  { key: 'route', label: 'tab_home', icon: (c, a) => <Ionicons name={a ? 'home' : 'home-outline'} size={size.icon.lg} color={c} /> },
  {
    key: 'wallet',
    label: 'tab_trips',
    icon: (c, a) => <MaterialCommunityIcons name={a ? 'truck' : 'truck-outline'} size={size.icon.lg} color={c} />,
  },
  {
    key: 'profile',
    label: 'tab_profile',
    icon: (c, a) => <Ionicons name={a ? 'person' : 'person-outline'} size={size.icon.lg} color={c} />,
  },
];

export default function DriverTabBar({ active, onChange }: DriverTabBarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[2]) }]} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const color = selected ? colors.accent : colors.textMuted;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={t(tab.label)}
            accessibilityState={{ selected }}
            style={styles.tab}
          >
            {tab.icon(color, selected)}
            <Text variant={selected ? 'captionMedium' : 'caption'} style={{ color }}>
              {t(tab.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: size.border,
    borderTopColor: colors.border,
    paddingTop: space[2],
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: size.control, gap: 2 },
});
