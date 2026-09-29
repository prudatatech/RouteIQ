import React, { useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, type DocType, type PersonDocument } from '../../services/api';
import { actionQueue, type QueuedAction } from '../../services/actionQueue';
import { compressDocument, MAX_DOCUMENT_FILES } from '../../services/documentUpload';
import { useTranslation } from '../../hooks/useTranslation';
import type { Language } from '../../locales';
import { Button, Card, Chip, ErrorBanner, StatusPill, Text, TextField } from '../ui';
import { colors, radius, size, space } from '../../theme';
import {
  DRIVER_CAN_UPLOAD,
  EXPIRING_SOON_DAYS,
  NEEDS_EXPIRY,
  NEEDS_NUMBER,
  OPTIONAL_DOC_TYPES,
  REQUIRED_SLOTS,
  STATUS_TONE,
  bestOf,
  currentDocuments,
  daysUntil,
  displayNumber,
  displayStatus,
  formatDocDate,
  isValidDay,
  isValidDocNumber,
  reviewState,
  type DocSlot,
} from '../../utils/documents';

interface Props {
  documents: PersonDocument[] | null;
  /** True once the profile loaded and no consent is recorded yet. */
  consentMissing: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Called after an upload so the list reloads. */
  onChanged: () => void;
}

/** Strings hold `{n}`, `{date}` and `{reason}` markers. */
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''));

/** Document types that have an upload waiting on the phone for a connection. */
function waitingTypes(items: readonly QueuedAction[]): Set<DocType> {
  const set = new Set<DocType>();
  for (const a of items) if (a.kind === 'upload_document') set.add(a.payload.docType);
  return set;
}

/** "My documents": every document the driver needs, with its status, and upload or replace. */
export default function DocumentsSection({ documents, consentMissing, loading, error, onRetry, onChanged }: Props) {
  const { t } = useTranslation();
  const [waiting, setWaiting] = useState(() => waitingTypes(actionQueue.getItems()));
  const waitingCount = useRef(waiting.size);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  // When a queued upload has been sent, the list is reloaded to show it
  useEffect(
    () =>
      actionQueue.subscribe((items) => {
        const next = waitingTypes(items);
        if (next.size < waitingCount.current) changed.current();
        waitingCount.current = next.size;
        setWaiting(next);
      }),
    [],
  );

  const current = currentDocuments(documents ?? []);
  const slots: DocSlot[] = [
    ...REQUIRED_SLOTS,
    ...OPTIONAL_DOC_TYPES.filter((type) => current.has(type)).map((type) => ({ key: type, types: [type] })),
  ];

  return (
    <View style={styles.section}>
      <Text variant="title" accessibilityRole="header">
        {t('docs_title')}
      </Text>
      {error && !documents ? (
        <ErrorBanner message={`${t('docs_load_failed')} ${error}`} action={{ label: t('retry'), onPress: onRetry }} />
      ) : loading && !documents ? (
        <Card style={styles.loading}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />
        </Card>
      ) : (
        <>
          {error ? (
            <ErrorBanner message={`${t('docs_load_failed')} ${error}`} action={{ label: t('retry'), onPress: onRetry }} />
          ) : null}
          <Card padded={false}>
            {slots.map((slot, idx) => (
              <DocumentRow
                key={slot.key}
                slot={slot}
                doc={bestOf(current, slot.types)}
                required={REQUIRED_SLOTS.some((s) => s.key === slot.key)}
                waiting={slot.types.some((type) => waiting.has(type))}
                consentMissing={consentMissing}
                first={idx === 0}
                onChanged={onChanged}
              />
            ))}
          </Card>
        </>
      )}
    </View>
  );
}

interface RowProps {
  slot: DocSlot;
  doc?: PersonDocument;
  required: boolean;
  waiting: boolean;
  consentMissing: boolean;
  first: boolean;
  onChanged: () => void;
}

interface Draft {
  step: 'source' | 'details';
  type: DocType;
  /** Compressed JPEGs: the main page, then the back page and others. */
  uris: string[];
  number: string;
  expiry: string;
  licenceClass: string;
}

function DocumentRow({ slot, doc, required, waiting, consentMissing, first, onChanged }: RowProps) {
  const { t, lang } = useTranslation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [formError, setFormError] = useState('');

  const type: DocType = doc?.doc_type ?? slot.types[0];
  const name = slot.group === 'identity' ? t('doc_group_identity') : type === 'other' && doc?.metadata?.title ? String(doc.metadata.title) : t(`doc_type_${type}`);
  const status = displayStatus(doc, waiting);
  const left = daysUntil(doc?.expires_on);
  const expiringSoon = !!doc && status !== 'expired' && status !== 'grace' && left !== null && left >= 0 && left <= EXPIRING_SOON_DAYS;
  const review = reviewState(doc);
  const number = doc ? displayNumber(doc) : null;
  const canUpload = slot.types.some(DRIVER_CAN_UPLOAD);
  const rejected = doc?.status === 'rejected';

  const start = () => {
    setFormError('');
    setDraft({ step: 'source', type, uris: [], number: '', expiry: '', licenceClass: '' });
  };

  const pick = async (source: 'camera' | 'gallery') => {
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('error'), t(source === 'camera' ? 'doc_permission_camera' : 'doc_permission_gallery'));
        return;
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.length) return;
      // Always a JPEG afterwards, so iPhone HEIC photos are converted here
      const jpeg = await compressDocument(result.assets[0].uri);
      setDraft((d) => (d ? { ...d, step: 'details', uris: [...d.uris, jpeg] } : d));
    } catch {
      Alert.alert(t('error'), t('doc_pick_failed'));
    }
  };

  const submit = async () => {
    if (!draft || draft.uris.length === 0) return;
    const dt = draft.type;
    const needsNumber = NEEDS_NUMBER.includes(dt);
    const needsExpiry = NEEDS_EXPIRY.includes(dt);
    const num = dt === 'aadhaar' ? draft.number.replace(/\s/g, '') : draft.number.trim().toUpperCase();
    const expiry = draft.expiry.trim();
    if (needsNumber && !isValidDocNumber(dt, num)) {
      setFormError(t(`doc_${dt === 'aadhaar' || dt === 'pan' || dt === 'voter_id' || dt === 'passport' ? dt : 'number'}_invalid`));
      return;
    }
    if (needsExpiry) {
      const days = isValidDay(expiry) ? daysUntil(expiry) : null;
      if (days === null) {
        setFormError(t('doc_expiry_invalid'));
        return;
      }
      if (days < 0) {
        setFormError(t('doc_expiry_past'));
        return;
      }
    }
    setFormError('');
    setBusy(true);
    try {
      const licenceClass = draft.licenceClass.trim().toUpperCase();
      const result = await actionQueue.submit('upload_document', {
        docType: dt,
        fileUris: draft.uris,
        details: {
          doc_number: needsNumber ? num : undefined,
          expires_on: needsExpiry ? expiry : undefined,
          metadata: dt === 'driving_licence' && licenceClass ? { licence_class: licenceClass } : undefined,
        },
      });
      setDraft(null);
      if (result.status === 'sent') {
        onChanged();
        Alert.alert(name, t('doc_upload_done'));
      } else {
        Alert.alert(name, t('doc_upload_queued'));
      }
    } catch (e: any) {
      setFormError(e?.message || t('doc_upload_failed'));
    } finally {
      setBusy(false);
    }
  };

  const view = async () => {
    if (!doc) return;
    setOpening(true);
    try {
      const { url } = await api.getMyDocumentFileUrl(doc.id);
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert(t('error'), e?.message || t('doc_open_failed'));
    } finally {
      setOpening(false);
    }
  };

  const date = (value?: string | null) => formatDocDate(value, lang as Language);

  return (
    <View style={[styles.row, !first && styles.rowBorder]}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="bodyMedium">{name}</Text>
          {slot.group && doc ? (
            <Text variant="caption" color="textMuted">
              {t(`doc_type_${doc.doc_type}`)}
            </Text>
          ) : required ? (
            <Text variant="caption" color="textMuted">
              {t('doc_required')}
            </Text>
          ) : null}
        </View>
        <StatusPill label={t(`doc_status_${status}`)} tone={STATUS_TONE[status]} />
      </View>
      {waiting && doc ? <StatusPill label={t('doc_status_waiting')} tone="info" /> : null}

      {number ? (
        <Text variant="mono" color="textMuted">
          {number}
        </Text>
      ) : null}
      {doc?.expires_on ? (
        <View style={styles.expiry}>
          {expiringSoon || status === 'grace' ? <Ionicons name="warning-outline" size={size.icon.sm} color={colors.warning} /> : null}
          <Text variant="bodySmall" color={status === 'expired' ? 'danger' : expiringSoon || status === 'grace' ? 'warning' : 'textMuted'}>
            {expiringSoon
              ? left === 0
                ? t('doc_expires_today')
                : fill(t('doc_expires_in_days'), { n: left ?? 0 })
              : fill(t(status === 'expired' || status === 'grace' ? 'doc_expired_on' : 'doc_expires_on'), { date: date(doc.expires_on) })}
          </Text>
        </View>
      ) : null}
      {expiringSoon && doc?.expires_on ? (
        <Text variant="caption" color="textMuted">
          {fill(t('doc_expires_on'), { date: date(doc.expires_on) })}
        </Text>
      ) : null}
      {review ? (
        <View style={styles.expiry}>
          <Ionicons name="alarm-outline" size={size.icon.sm} color={colors.warning} />
          <Text variant="bodySmall" color="warning">
            {review.due ? t('doc_review_due') : fill(t('doc_review_due_on'), { date: date(doc?.review_by) })}
          </Text>
        </View>
      ) : null}
      {rejected ? (
        <>
          {doc?.rejection_reason ? (
            <Text variant="bodySmall" color="danger">
              {fill(t('doc_rejected_reason'), { reason: doc.rejection_reason })}
            </Text>
          ) : null}
          <Text variant="bodySmall" color="danger">
            {t('doc_resubmit_hint')}
          </Text>
        </>
      ) : null}

      {draft ? (
        <View style={styles.form}>
          {draft.step === 'source' && draft.uris.length === 0 && slot.types.length > 1 ? (
            <View style={styles.kinds} accessibilityRole="radiogroup">
              {slot.types.map((k) => (
                <Chip key={k} label={t(`doc_type_${k}`)} selected={draft.type === k} onPress={() => setDraft({ ...draft, type: k })} />
              ))}
            </View>
          ) : null}
          {draft.step === 'source' ? (
            <>
              <Button
                title={t(draft.uris.length ? 'doc_add_back_camera' : 'doc_take_photo')}
                variant="secondary"
                onPress={() => pick('camera')}
                icon={(c) => <Ionicons name="camera-outline" size={size.icon.md} color={c} />}
              />
              <Button
                title={t('doc_choose_gallery')}
                variant="secondary"
                onPress={() => pick('gallery')}
                icon={(c) => <Ionicons name="images-outline" size={size.icon.md} color={c} />}
              />
              <Button
                title={t('cancel')}
                variant="ghost"
                onPress={() => (draft.uris.length ? setDraft({ ...draft, step: 'details' }) : setDraft(null))}
              />
            </>
          ) : (
            <DetailsForm
              draft={draft}
              busy={busy}
              formError={formError}
              onChange={setDraft}
              onAddPage={() => setDraft({ ...draft, step: 'source' })}
              onSubmit={submit}
              onCancel={() => setDraft(null)}
            />
          )}
          <Text variant="caption" color="textMuted">
            {t('doc_consent_notice')}
          </Text>
          {consentMissing ? (
            <Text variant="caption" color="textMuted">
              {t('doc_consent_pending')}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.actions}>
          {doc ? (
            <Button
              title={t('doc_view')}
              variant="secondary"
              block={false}
              style={styles.flex}
              loading={opening}
              onPress={view}
              icon={(c) => <Ionicons name="eye-outline" size={size.icon.md} color={c} />}
            />
          ) : null}
          {canUpload ? (
            <Button
              title={t(rejected ? 'doc_upload_again' : doc ? 'doc_replace' : 'doc_upload')}
              variant={doc && !rejected ? 'ghost' : 'primary'}
              block={false}
              style={styles.flex}
              onPress={start}
              icon={(c) => <Ionicons name="cloud-upload-outline" size={size.icon.md} color={c} />}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

interface DetailsProps {
  draft: Draft;
  busy: boolean;
  formError: string;
  onChange: (d: Draft | null) => void;
  onAddPage: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** After the first picture: the pages taken, the number and expiry, and the send button. */
function DetailsForm({ draft, busy, formError, onChange, onAddPage, onSubmit, onCancel }: DetailsProps) {
  const { t } = useTranslation();
  const type = draft.type;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pages}>
        {draft.uris.map((uri, i) => (
          <View key={uri} style={styles.page}>
            <Image source={{ uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
            <Text variant="caption" color="textMuted" align="center">
              {i === 0 ? t('doc_page_front') : `${t('doc_page_n')} ${i + 1}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('doc_remove_page')}
              disabled={busy}
              hitSlop={8}
              onPress={() => {
                const uris = draft.uris.filter((_, k) => k !== i);
                onChange(uris.length ? { ...draft, uris } : { ...draft, uris, step: 'source' });
              }}
              style={styles.remove}
            >
              <Ionicons name="close" size={size.icon.sm} color={colors.onSolid} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
      {draft.uris.length < MAX_DOCUMENT_FILES ? (
        <Button
          title={t('doc_add_back')}
          variant="secondary"
          disabled={busy}
          onPress={onAddPage}
          icon={(c) => <Ionicons name="add-circle-outline" size={size.icon.md} color={c} />}
        />
      ) : null}
      {NEEDS_NUMBER.includes(type) ? (
        <TextField
          label={t('doc_number_label')}
          value={draft.number}
          onChangeText={(v) => onChange({ ...draft, number: v })}
          autoCapitalize="characters"
          autoCorrect={false}
          keyboardType={type === 'aadhaar' ? 'number-pad' : 'default'}
          editable={!busy}
        />
      ) : null}
      {type === 'driving_licence' ? (
        <TextField
          label={t('doc_licence_class')}
          hint={t('doc_licence_class_hint')}
          value={draft.licenceClass}
          onChangeText={(v) => onChange({ ...draft, licenceClass: v })}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
        />
      ) : null}
      {NEEDS_EXPIRY.includes(type) ? (
        <TextField
          label={t('doc_expiry_label')}
          hint={t('doc_date_hint')}
          value={draft.expiry}
          onChangeText={(v) => onChange({ ...draft, expiry: v })}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
          editable={!busy}
        />
      ) : null}
      {formError ? <ErrorBanner message={formError} /> : null}
      <Button title={t('doc_upload_button')} onPress={onSubmit} loading={busy} />
      <View style={styles.actions}>
        <Button
          title={t('doc_retake')}
          variant="secondary"
          block={false}
          style={styles.flex}
          disabled={busy}
          onPress={() => onChange({ ...draft, step: 'source', uris: [] })}
        />
        <Button title={t('cancel')} variant="ghost" block={false} style={styles.flex} disabled={busy} onPress={onCancel} />
      </View>
    </>
  );
}

const THUMB = 96;

const styles = StyleSheet.create({
  section: { gap: space[3] },
  flex: { flex: 1 },
  loading: { alignItems: 'center', paddingVertical: space[6] },
  row: { padding: space[4], gap: space[2] },
  rowBorder: { borderTopWidth: size.border, borderTopColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  expiry: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  actions: { flexDirection: 'row', gap: space[3], marginTop: space[1] },
  form: { gap: space[3], marginTop: space[2] },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  pages: { gap: space[3] },
  page: { width: THUMB, gap: space[1] },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.control, backgroundColor: colors.neutralSoft },
  remove: {
    position: 'absolute',
    top: space[1],
    right: space[1],
    // 32 + hitSlop 8 on each side reaches the 48dp touch target
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.neutral,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
