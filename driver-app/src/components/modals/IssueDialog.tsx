import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { Button, Text, TextField } from '../ui';
import { colors, radius, size, space } from '../../theme';

export type FailureReason =
  | 'customer_unavailable'
  | 'address_unreachable'
  | 'customer_refused'
  | 'premises_closed'
  | 'other';

const REASONS: FailureReason[] = [
  'customer_unavailable',
  'address_unreachable',
  'customer_refused',
  'premises_closed',
  'other',
];

interface IssueDialogProps {
  stopName?: string | null;
  /** Resolves when the stop is marked failed; throws with a message on failure. */
  onSubmit: (reason: FailureReason, note: string) => Promise<void>;
  onCancel: () => void;
}

/** Why a stop could not be completed: a reason to pick, and a note for "Other". */
export default function IssueDialog({ stopName, onSubmit, onCancel }: IssueDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<FailureReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit(reason, note.trim());
    } catch (e: any) {
      setError(e?.message || t('action_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header">
          {t('alert_report_issue_title')}
        </Text>
        {stopName ? (
          <Text variant="bodySmallMedium" color="textMuted">
            {stopName}
          </Text>
        ) : null}
        <Text variant="bodySmall" color="textMuted">
          {t('issue_reason_prompt')}
        </Text>
      </View>

      <View style={styles.list} accessibilityRole="radiogroup">
        {REASONS.map((item) => {
          const selected = reason === item;
          return (
            <Pressable
              key={item}
              onPress={() => setReason(item)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t(`issue_reason_${item}`)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text variant="bodyMedium" color={selected ? 'danger' : 'text'}>
                {t(`issue_reason_${item}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {reason === 'other' ? (
        <TextField
          label={t('issue_note_label')}
          multiline
          value={note}
          onChangeText={setNote}
          maxLength={300}
        />
      ) : null}
      {error ? (
        <Text variant="bodySmall" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button title={t('cancel')} variant="secondary" block={false} style={styles.action} onPress={onCancel} disabled={saving} />
        <Button
          title={t('mark_failed')}
          variant="danger"
          block={false}
          style={styles.action}
          onPress={submit}
          disabled={!reason}
          loading={saving}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[1] },
  list: { gap: space[2] },
  option: {
    justifyContent: 'center',
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  optionSelected: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  actions: { flexDirection: 'row', gap: space[3] },
  action: { flex: 1 },
});
