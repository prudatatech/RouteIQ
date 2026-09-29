import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import type { EmergencyContact } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';
import { Card, EmptyState, ErrorBanner, StatusPill, Text } from '../ui';
import { colors, size, space } from '../../theme';
import { dial } from '../../utils/dial';

interface Props {
  contacts: EmergencyContact[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** Read-only list of the driver's emergency contacts. Dispatch keeps it up to date. */
export default function EmergencyContactsSection({ contacts, loading, error, onRetry }: Props) {
  const { t } = useTranslation();

  const call = async (phone: string) => {
    if (!(await dial(phone))) Alert.alert(t('error'), t('emergency_contact_call_failed'));
  };

  return (
    <View style={styles.section}>
      <Text variant="title" accessibilityRole="header">
        {t('emergency_contacts_title')}
      </Text>
      {error && !contacts ? (
        <ErrorBanner message={`${t('emergency_contacts_load_failed')} ${error}`} action={{ label: t('retry'), onPress: onRetry }} />
      ) : loading && !contacts ? (
        <Card style={styles.loading}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />
        </Card>
      ) : contacts && contacts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Ionicons name="people-outline" size={size.icon.xl} color={colors.textMuted} />}
            title={t('emergency_contacts_empty')}
            message={t('emergency_contacts_empty_hint')}
          />
        </Card>
      ) : (
        <>
          <Card padded={false}>
            {(contacts ?? []).map((c, idx) => (
              <Pressable
                key={c.id}
                onPress={() => call(c.phone)}
                accessibilityRole="button"
                accessibilityLabel={`${t('emergency_contact_call')} ${c.name}, ${c.phone}`}
                style={({ pressed }) => [styles.row, idx > 0 && styles.rowBorder, pressed && styles.pressed]}
              >
                <View style={styles.flex}>
                  <Text variant="bodyMedium">{c.name}</Text>
                  {c.relation ? (
                    <Text variant="bodySmall" color="textMuted">
                      {c.relation}
                    </Text>
                  ) : null}
                  <Text variant="mono" color="textMuted">
                    {c.phone}
                  </Text>
                  {c.is_primary ? <StatusPill label={t('emergency_contact_primary')} tone="accent" /> : null}
                </View>
                <Ionicons name="call-outline" size={size.icon.lg} color={colors.accent} />
              </Pressable>
            ))}
          </Card>
          <Text variant="caption" color="textMuted">
            {t('emergency_contacts_note')}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
  flex: { flex: 1, gap: space[1] },
  loading: { alignItems: 'center', paddingVertical: space[6] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], minHeight: size.control + space[2] },
  rowBorder: { borderTopWidth: size.border, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surfaceSubtle },
});
