import React from 'react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../../hooks/useTranslation';
import { Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

export type DriverTab = 'route' | 'scan' | 'messages' | 'wallet' | 'profile';

interface DriverTabBarProps {
  active: DriverTab;
  onChange: (tab: DriverTab) => void;
  /** Unread messages from dispatch, shown as a badge on the Messages tab. */
  messagesUnread?: number;
}

const TABS: { key: DriverTab; label: string; icon: (color: string, active: boolean) => React.ReactNode }[] = [
  { key: 'route', label: 'tab_home', icon: (c, a) => <Ionicons name={a ? 'home' : 'home-outline'} size={size.icon.lg} color={c} /> },
  { key: 'scan', label: 'tab_scan', icon: (c, a) => <Ionicons name={a ? 'qr-code' : 'qr-code-outline'} size={size.icon.lg} color={c} /> },
  {
    key: 'messages',
    label: 'tab_messages',
    icon: (c, a) => <Ionicons name={a ? 'chatbubbles' : 'chatbubbles-outline'} size={size.icon.lg} color={c} />,
  },
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

export default function DriverTabBar({ active, onChange, messagesUnread = 0 }: DriverTabBarProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[2]) }]} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const color = selected ? colors.accent : colors.textMuted;
        const badge = tab.key === 'messages' ? messagesUnread : 0;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={badge > 0 ? `${t(tab.label)}, ${badge} ${t('messages_unread')}` : t(tab.label)}
            accessibilityState={{ selected }}
            style={styles.tab}
          >
            <View>
              {tab.icon(color, selected)}
              {badge > 0 ? (
                <View style={styles.badge}>
                  <Text variant="caption" style={styles.badgeText}>
                    {badge > 9 ? '9+' : String(badge)}
                  </Text>
                </View>
              ) : null}
            </View>
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
  badge: {
    position: 'absolute',
    top: -space[1],
    right: -space[2],
    minWidth: 16,
    height: 16,
    paddingHorizontal: space[1],
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.onSolid, fontSize: 10, lineHeight: 14 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: size.control, gap: 2 },
});
