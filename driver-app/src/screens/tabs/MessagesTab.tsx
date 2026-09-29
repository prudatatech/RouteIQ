import React, { useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { ChatMessage } from '../../services/api';
import { Button, Card, EmptyState, ErrorBanner, Text, TextField } from '../../components/ui';
import { errorMessage } from '../../utils/errors';
import { colors, radius, size, space } from '../../theme';

interface MessagesTabProps {
  /** There is a current route, so there is a thread to show. */
  hasRoute: boolean;
  messages: ChatMessage[];
  loading: boolean;
  failed: boolean;
  sending: boolean;
  onRetry: () => void;
  onSend: (body: string) => Promise<void>;
  onCallDispatch: () => void;
}

const MAX_LENGTH = 2000;

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));

/** Text conversation with dispatch for the current route. */
export default function MessagesTab({ hasRoute, messages, loading, failed, sending, onRetry, onSend, onCallDispatch }: MessagesTabProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);

  const callButton = (
    <Button
      title={t('call_dispatch')}
      variant="secondary"
      onPress={onCallDispatch}
      icon={(color) => <Ionicons name="call-outline" size={size.icon.md} color={color} />}
    />
  );

  if (!hasRoute) {
    return (
      <View style={styles.container}>
        <Card>
          <EmptyState
            icon={<Ionicons name="chatbubbles-outline" size={size.icon.xl} color={colors.textMuted} />}
            title={t('messages_no_route_title')}
            message={t('messages_no_route_desc')}
          />
        </Card>
        {callButton}
      </View>
    );
  }

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy.current) return;
    busy.current = true;
    setError('');
    try {
      await onSend(body);
      setDraft('');
    } catch (e) {
      setError(errorMessage(e, t('messages_send_failed')));
    } finally {
      busy.current = false;
    }
  };

  return (
    <View style={styles.container}>
      {callButton}

      {failed ? <ErrorBanner message={t('messages_load_failed')} action={{ label: t('retry'), onPress: onRetry }} /> : null}

      <Card style={styles.thread}>
        <Text variant="title" accessibilityRole="header">
          {t('messages_title')}
        </Text>
        {loading && messages.length === 0 ? (
          <Text variant="bodySmall" color="textMuted">
            {t('loading')}
          </Text>
        ) : messages.length === 0 ? (
          <Text variant="bodySmall" color="textMuted">
            {t('messages_empty')}
          </Text>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
      </Card>

      <Card style={styles.composer}>
        <TextField
          label={t('messages_input_label')}
          placeholder={t('messages_input_placeholder')}
          value={draft}
          onChangeText={(v) => {
            setDraft(v);
            if (error) setError('');
          }}
          error={error || undefined}
          maxLength={MAX_LENGTH}
          multiline
        />
        <Button
          title={t('messages_send')}
          onPress={submit}
          loading={sending}
          disabled={!draft.trim()}
          icon={(color) => <Ionicons name="send" size={size.icon.md} color={color} />}
        />
      </Card>
    </View>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const mine = message.sender_role === 'driver';
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text variant="body" style={mine ? styles.mineText : undefined}>
          {message.body}
        </Text>
      </View>
      <Text variant="caption" color="textMuted">
        {`${mine ? t('messages_you') : t('messages_dispatch')}${message.shipment_tracking_id ? ` · ${message.shipment_tracking_id}` : ''} · ${formatTime(message.created_at)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[4] },
  thread: { gap: space[3] },
  composer: { gap: space[3] },
  row: { gap: space[1] },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '85%', paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.card },
  bubbleMine: { backgroundColor: colors.accentSoft },
  bubbleTheirs: { backgroundColor: colors.surfaceSubtle },
  mineText: { color: colors.text },
});
