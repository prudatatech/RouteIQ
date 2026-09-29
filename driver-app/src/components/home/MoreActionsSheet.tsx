import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { Button, Text } from '../ui';
import { colors, radius, size, space } from '../../theme';

export interface MoreAction {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

interface MoreActionsSheetProps {
  actions: MoreAction[];
  onClose: () => void;
}

/** Less frequent actions, shown in a bottom sheet. */
export default function MoreActionsSheet({ actions, onClose }: MoreActionsSheetProps) {
  const { t } = useTranslation();
  return (
    <>
      <Text variant="title" accessibilityRole="header">
        {t('more_actions')}
      </Text>
      <View style={styles.list}>
        {actions.map((action) => {
          const fg = action.tone === 'danger' ? colors.danger : colors.text;
          return (
            <Pressable
              key={action.key}
              onPress={action.onPress}
              disabled={action.disabled}
              accessibilityRole="button"
              accessibilityLabel={action.title}
              accessibilityHint={action.subtitle}
              accessibilityState={{ disabled: !!action.disabled }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed, action.disabled && styles.disabled]}
            >
              <View style={styles.icon}>
                <Ionicons name={action.icon} size={size.icon.md} color={action.tone === 'danger' ? colors.danger : colors.accent} />
              </View>
              <View style={styles.text}>
                <Text variant="bodyMedium" style={{ color: fg }}>
                  {action.title}
                </Text>
                {action.subtitle ? (
                  <Text variant="caption" color="textMuted">
                    {action.subtitle}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={size.icon.sm} color={colors.textMuted} />
            </Pressable>
          );
        })}
      </View>
      <Button title={t('close')} variant="secondary" onPress={onClose} />
    </>
  );
}

const ICON_BOX = 40;

const styles = StyleSheet.create({
  list: { gap: space[1] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: size.control + space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.control,
  },
  pressed: { backgroundColor: colors.surfaceSubtle },
  disabled: { opacity: 0.5 },
  icon: {
    width: ICON_BOX,
    height: ICON_BOX,
    borderRadius: radius.control,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
});
