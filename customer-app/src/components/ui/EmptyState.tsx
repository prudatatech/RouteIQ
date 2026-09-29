import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '../../theme';
import { Button, type ButtonVariant } from './Button';
import { Text } from './Text';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void; loading?: boolean; variant?: ButtonVariant };
}

/** Says what is missing and offers at most one action. */
export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text variant="title" align="center" accessibilityRole="header">
        {title}
      </Text>
      {message ? (
        <Text variant="bodySmall" color="textMuted" align="center">
          {message}
        </Text>
      ) : null}
      {action ? (
        <Button
          title={action.label}
          onPress={action.onPress}
          loading={action.loading}
          variant={action.variant ?? 'secondary'}
          block={false}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space[2], paddingVertical: space[6], paddingHorizontal: space[4] },
  icon: { marginBottom: space[2] },
  action: { marginTop: space[3] },
});
