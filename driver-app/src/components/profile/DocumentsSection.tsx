import React, { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Image, Linking, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, type DocType, type PersonDocument } from '../../services/api';
import { uploadMyDocument } from '../../services/documentUpload';
import { useTranslation } from '../../hooks/useTranslation';
import type { Language } from '../../locales';
import { Button, Card, ErrorBanner, StatusPill, Text, TextField } from '../ui';
import { colors, size, space } from '../../theme';
import {
  DRIVER_CAN_UPLOAD,
  EXPIRING_SOON_DAYS,
  NEEDS_EXPIRY,
  NEEDS_NUMBER,
  OPTIONAL_DOC_TYPES,
  REQUIRED_DOC_TYPES,
  STATUS_TONE,
  currentDocuments,
  daysUntil,
  displayStatus,
  formatDocDate,
  isValidDay,
  isValidDocNumber,
} from '../../utils/documents';

interface Props {
  documents: PersonDocument[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Called after an upload so the list reloads. */
  onChanged: () => void;
}

/** "Expires in {n} days" style strings: the locale files hold `{n}` and `{date}` markers. */
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ''));

/** "My documents": every document the driver needs, with its status, and upload or replace. */
export default function DocumentsSection({ documents, loading, error, onRetry, onChanged }: Props) {
  const { t } = useTranslation();

  const current = currentDocuments(documents ?? []);
  const types: DocType[] = [
    ...REQUIRED_DOC_TYPES,
    ...OPTIONAL_DOC_TYPES.filter((type) => current.has(type)),
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
            {types.map((type, idx) => (
              <DocumentRow
                key={type}
                type={type}
                doc={current.get(type)}
                required={REQUIRED_DOC_TYPES.includes(type)}
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
  type: DocType;
  doc?: PersonDocument;
  required: boolean;
  first: boolean;
  onChanged: () => void;
}

interface Draft {
  step: 'source' | 'details';
  uri: string | null;
  number: string;
  expiry: string;
  licenceClass: string;
}

function DocumentRow({ type, doc, required, first, onChanged }: RowProps) {
  const { t, lang } = useTranslation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [formError, setFormError] = useState('');

  const name = type === 'other' && doc?.metadata?.title ? String(doc.metadata.title) : t(`doc_type_${type}`);
  const status = displayStatus(doc);
  const left = daysUntil(doc?.expires_on);
  const expiringSoon = !!doc && status !== 'expired' && left !== null && left >= 0 && left <= EXPIRING_SOON_DAYS;
  const needsNumber = NEEDS_NUMBER.includes(type);
  const needsExpiry = NEEDS_EXPIRY.includes(type);
  const canUpload = DRIVER_CAN_UPLOAD(type);

  const start = () => {
    setFormError('');
    setDraft({ step: 'source', uri: null, number: '', expiry: '', licenceClass: '' });
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
      setDraft((d) => (d ? { ...d, step: 'details', uri: result.assets[0].uri } : d));
    } catch {
      Alert.alert(t('error'), t('doc_pick_failed'));
    }
  };

  const submit = async () => {
    if (!draft?.uri) return;
    const number = type === 'pan' ? draft.number.trim().toUpperCase() : draft.number.trim();
    const expiry = draft.expiry.trim();
    if (needsNumber && !isValidDocNumber(type, number)) {
      setFormError(t(type === 'aadhaar' ? 'doc_aadhaar_invalid' : type === 'pan' ? 'doc_pan_invalid' : 'doc_number_invalid'));
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
      await uploadMyDocument(type, draft.uri, {
        doc_number: needsNumber ? number.replace(/\s/g, '') : undefined,
        expires_on: needsExpiry ? expiry : undefined,
        metadata: type === 'driving_licence' && draft.licenceClass.trim() ? { licence_class: draft.licenceClass.trim().toUpperCase() } : undefined,
      });
      setDraft(null);
      onChanged();
      Alert.alert(name, t('doc_upload_done'));
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

  return (
    <View style={[styles.row, !first && styles.rowBorder]}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="bodyMedium">{name}</Text>
          {required ? (
            <Text variant="caption" color="textMuted">
              {t('doc_required')}
            </Text>
          ) : null}
        </View>
        <StatusPill label={t(`doc_status_${status}`)} tone={STATUS_TONE[status]} />
      </View>

      {doc?.doc_number ? (
        <Text variant="mono" color="textMuted">
          {doc.doc_number}
        </Text>
      ) : null}
      {doc?.expires_on ? (
        <View style={styles.expiry}>
          {expiringSoon ? <Ionicons name="warning-outline" size={size.icon.sm} color={colors.warning} /> : null}
          <Text variant="bodySmall" color={status === 'expired' ? 'danger' : expiringSoon ? 'warning' : 'textMuted'}>
            {expiringSoon
              ? left === 0
                ? t('doc_expires_today')
                : fill(t('doc_expires_in_days'), { n: left ?? 0 })
              : fill(t(status === 'expired' ? 'doc_expired_on' : 'doc_expires_on'), {
                  date: formatDocDate(doc.expires_on, lang as Language),
                })}
          </Text>
        </View>
      ) : null}
      {expiringSoon && doc?.expires_on ? (
        <Text variant="caption" color="textMuted">
          {fill(t('doc_expires_on'), { date: formatDocDate(doc.expires_on, lang as Language) })}
        </Text>
      ) : null}
      {doc?.status === 'rejected' && doc.rejection_reason ? (
        <Text variant="bodySmall" color="danger">
          {fill(t('doc_rejected_reason'), { reason: doc.rejection_reason })}
        </Text>
      ) : null}

      {draft ? (
        <View style={styles.form}>
          {draft.step === 'source' ? (
            <>
              <Button
                title={t('doc_take_photo')}
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
              <Button title={t('cancel')} variant="ghost" onPress={() => setDraft(null)} />
            </>
          ) : (
            <>
              {draft.uri ? <Image source={{ uri: draft.uri }} style={styles.preview} accessibilityIgnoresInvertColors /> : null}
              {needsNumber ? (
                <TextField
                  label={t('doc_number_label')}
                  value={draft.number}
                  onChangeText={(v) => setDraft({ ...draft, number: v })}
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
                  onChangeText={(v) => setDraft({ ...draft, licenceClass: v })}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!busy}
                />
              ) : null}
              {needsExpiry ? (
                <TextField
                  label={t('doc_expiry_label')}
                  hint={t('doc_date_hint')}
                  value={draft.expiry}
                  onChangeText={(v) => setDraft({ ...draft, expiry: v })}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  editable={!busy}
                />
              ) : null}
              {formError ? <ErrorBanner message={formError} /> : null}
              <Button title={t('doc_upload_button')} onPress={submit} loading={busy} />
              <View style={styles.actions}>
                <Button
                  title={t('doc_retake')}
                  variant="secondary"
                  block={false}
                  style={styles.flex}
                  disabled={busy}
                  onPress={() => setDraft({ ...draft, step: 'source', uri: null })}
                />
                <Button
                  title={t('cancel')}
                  variant="ghost"
                  block={false}
                  style={styles.flex}
                  disabled={busy}
                  onPress={() => setDraft(null)}
                />
              </View>
            </>
          )}
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
              title={t(doc ? 'doc_replace' : 'doc_upload')}
              variant={doc ? 'ghost' : 'primary'}
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
  preview: { width: '100%', height: 180, borderRadius: 8, backgroundColor: colors.neutralSoft },
});
