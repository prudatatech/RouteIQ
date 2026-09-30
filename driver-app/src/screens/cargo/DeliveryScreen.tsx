/**
 * The delivery sheet: what happened at the drop. It replaces the old choice
 * between "proof of delivery" and "report an issue".
 *
 * - Delivered in full: receiver, photo and/or signature, and the customer's
 *   delivery code when the booking asks for one.
 * - Delivered with remarks: the same, plus the condition and damage photos.
 * - Partial: pieces accepted, refused and short.
 * - Refused: a reason and a photo.
 * - Not delivered: the usual reasons, with how many attempts are left before
 *   the goods go back to the sender.
 */
import React, { useMemo, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useConsignmentInfo } from '../../hooks/useCargo';
import type { StopCheck } from '../../hooks/useParcelScan';
import type { FailureReasonCode } from '../../services/actionQueue';
import type { ConditionCode, ConsignmentInfo } from '../../services/cargo';
import type { PodInput } from '../../services/podUpload';
import type { RouteStop } from '../../types/route';
import { fill } from '../../locales';
import CargoScreen from '../../components/cargo/CargoScreen';
import { ConditionPicker, DispatchNote, PhotoStrip, PieceCounter, SignatureBlock } from '../../components/cargo/CargoFields';
import ParcelScanner, { type ScanMethod } from '../../components/scan/ParcelScanner';
import SignaturePad from '../../components/modals/SignaturePad';
import { Banner, Button, Card, Chip, ErrorBanner, Text, TextField } from '../../components/ui';
import { colors, size, space } from '../../theme';

export type DeliveryKind = 'full' | 'remarks' | 'partial' | 'refused' | 'not_delivered';
export type RefusalReason = 'customer_refused' | 'damaged_refused' | 'other';

/** What the driver recorded; useRouteActions sends it. */
export type DeliveryOutcome =
  | { kind: 'full'; pod: PodInput; otp?: string }
  | { kind: 'remarks'; pod: PodInput; otp?: string; condition: ConditionCode; damagePhotos: string[]; note?: string }
  | { kind: 'partial'; pod: PodInput; otp?: string; accepted: number; refused: number; short: number; note?: string }
  | { kind: 'refused'; reason: RefusalReason; photos: string[]; note?: string }
  | { kind: 'not_delivered'; reason: FailureReasonCode; note: string };

const KINDS: DeliveryKind[] = ['full', 'remarks', 'partial', 'refused', 'not_delivered'];
const REFUSAL_REASONS: RefusalReason[] = ['customer_refused', 'damaged_refused', 'other'];
/** The existing complete-stop reasons; a refusal has its own outcome. */
const NOT_DELIVERED_REASONS: FailureReasonCode[] = ['customer_unavailable', 'address_unreachable', 'premises_closed', 'other'];
const DAMAGE_CONDITIONS: ConditionCode[] = ['damaged_packaging', 'damaged_goods', 'wet', 'seal_tampered', 'shortage', 'excess'];
/** Attempts before the goods go back, when the server does not say (the schema's default). */
const DEFAULT_MAX_ATTEMPTS = 3;

interface DeliveryScreenProps {
  stop: RouteStop;
  initialKind?: DeliveryKind;
  parcelVerified?: boolean;
  onScanCode?: (code: string, method: ScanMethod) => StopCheck;
  /** Resolves when saved (or kept to send later); throws with a message on failure. */
  onSubmit: (outcome: DeliveryOutcome, info: ConsignmentInfo | null) => Promise<void>;
  onClose: () => void;
  headerRight?: ReactNode;
}

export default function DeliveryScreen({ stop, initialKind = 'full', parcelVerified = false, onScanCode, onSubmit, onClose, headerRight }: DeliveryScreenProps) {
  const { t } = useTranslation();
  const code = stop.parcel?.code ?? null;
  const { info, loading: infoLoading } = useConsignmentInfo(code);
  const [kind, setKind] = useState<DeliveryKind>(initialKind);

  const [verified, setVerified] = useState(parcelVerified);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [skipScan, setSkipScan] = useState(false);

  const [receiver, setReceiver] = useState('');
  const [photo, setPhoto] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [otp, setOtp] = useState('');
  const [condition, setCondition] = useState<ConditionCode>('damaged_packaging');
  const [damagePhotos, setDamagePhotos] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<number | null>(null);
  const [refused, setRefused] = useState<number | null>(0);
  const [short, setShort] = useState<number | null>(0);
  const [refusal, setRefusal] = useState<RefusalReason | null>(null);
  const [refusalPhotos, setRefusalPhotos] = useState<string[]>([]);
  const [reason, setReason] = useState<FailureReasonCode | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const onBoard = info?.piecesOnBoard ?? info?.piecesTotal ?? null;
  const delivers = kind === 'full' || kind === 'remarks' || kind === 'partial';
  const needsScan = delivers && !!code && !!onScanCode;
  const otpRequired = info?.otpRequired ?? null;

  const attempts = useMemo(() => {
    if (info?.attempts === null || info?.attempts === undefined) return null;
    const max = info.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const thisAttempt = info.attempts + 1;
    return { thisAttempt, max, left: Math.max(0, max - thisAttempt) };
  }, [info]);

  const partialNote = useMemo(() => {
    if (kind === 'remarks') return [t(`cargo_condition_${condition}`)];
    if (kind !== 'partial') return [];
    const reasons: string[] = [];
    if (refused) reasons.push(fill(t('cargo_note_refused'), { n: refused }));
    if (short) reasons.push(fill(t('cargo_note_missing'), { n: short }));
    return reasons;
  }, [kind, condition, refused, short, t]);

  const onCode = (value: string, method: ScanMethod) => {
    if (!onScanCode) return;
    if (onScanCode(value, method) === 'ok') {
      setVerified(true);
      setScanning(false);
      setScanError('');
    } else {
      setScanError(t('pod_parcel_wrong'));
    }
  };

  const podInput = (): PodInput => ({ receiverName: receiver.trim(), photoUri: photo[0] ?? null, signatureUri: signature });

  /** The checks for this outcome; returns the outcome or sets an error. */
  const build = (): DeliveryOutcome | null => {
    const trimmedNote = note.trim();
    if (kind === 'not_delivered') {
      if (!reason) return fail(t('issue_reason_prompt'));
      return { kind, reason, note: trimmedNote };
    }
    if (kind === 'refused') {
      if (!refusal) return fail(t('cargo_refusal_reason_required'));
      if (refusalPhotos.length === 0) return fail(t('cargo_photo_required'));
      return { kind, reason: refusal, photos: refusalPhotos, ...(trimmedNote ? { note: trimmedNote } : {}) };
    }
    if (needsScan && !verified && !skipScan) return fail(t('pod_parcel_required'));
    if (receiver.trim().length < 3) return fail(t('alert_valid_receiver'));
    if (!photo.length && !signature) return fail(t('cargo_photo_or_signature'));
    const code6 = otp.trim();
    if (otpRequired === true && !/^\d{6}$/.test(code6)) return fail(t('cargo_otp_required'));
    if (code6 && !/^\d{6}$/.test(code6)) return fail(t('cargo_otp_invalid'));
    const withOtp = code6 ? { otp: code6 } : {};
    if (kind === 'full') return { kind, pod: podInput(), ...withOtp };
    if (kind === 'remarks') {
      if (damagePhotos.length === 0) return fail(t('cargo_damage_photo_required'));
      return { kind, pod: podInput(), ...withOtp, condition, damagePhotos, ...(trimmedNote ? { note: trimmedNote } : {}) };
    }
    const a = accepted ?? 0;
    const r = refused ?? 0;
    const s = short ?? 0;
    if (a < 1) return fail(t('cargo_accepted_required'));
    if (r + s < 1) return fail(t('cargo_partial_rest_required'));
    if (onBoard !== null && a + r + s !== onBoard) return fail(fill(t('cargo_partial_sum'), { total: onBoard }));
    return { kind: 'partial', pod: podInput(), ...withOtp, accepted: a, refused: r, short: s, ...(trimmedNote ? { note: trimmedNote } : {}) };
  };

  const fail = (message: string) => {
    setError(message);
    return null;
  };

  const submit = async () => {
    const outcome = build();
    if (!outcome) return;
    setError('');
    setSaving(true);
    try {
      await onSubmit(outcome, info);
    } catch (e: any) {
      setError(e?.message || t('complete_stop_failed'));
    } finally {
      setSaving(false);
    }
  };

  if (signing) {
    return (
      <CargoScreen title={t('cargo_delivery_title')} onClose={() => setSigning(false)} headerRight={headerRight}>
        <SignaturePad
          onDone={(uri) => {
            setSignature(uri);
            setSigning(false);
          }}
          onCancel={() => setSigning(false)}
        />
      </CargoScreen>
    );
  }

  const submitTitle =
    kind === 'not_delivered' ? t('mark_failed') : kind === 'refused' ? t('cargo_record_refusal') : kind === 'partial' ? t('cargo_record_partial') : t('complete_stop');

  return (
    <CargoScreen
      title={t('cargo_delivery_title')}
      subtitle={[stop.delivery_point?.name, code].filter(Boolean).join(' · ') || undefined}
      onClose={onClose}
      headerRight={headerRight}
      footer={
        <>
          <Button title={t('cancel')} variant="secondary" block={false} style={styles.action} onPress={onClose} disabled={saving} />
          <Button
            title={submitTitle}
            variant={kind === 'not_delivered' || kind === 'refused' ? 'danger' : 'primary'}
            block={false}
            style={styles.action}
            onPress={submit}
            loading={saving}
          />
        </>
      }
    >
      <View style={styles.section}>
        <Text variant="bodyMedium">{t('cargo_what_happened')}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {KINDS.map((k) => (
            <Chip
              key={k}
              label={t(`cargo_outcome_${k}`)}
              selected={kind === k}
              tone={k === 'refused' || k === 'not_delivered' ? 'danger' : 'accent'}
              onPress={() => {
                setKind(k);
                setError('');
              }}
            />
          ))}
        </View>
        {onBoard !== null ? (
          <Text variant="bodySmall" color="textMuted">
            {fill(t('cargo_pieces_on_board_n'), { n: onBoard })}
          </Text>
        ) : infoLoading ? (
          <Text variant="bodySmall" color="textMuted">
            {t('loading')}
          </Text>
        ) : null}
      </View>

      {needsScan ? (
        <Card style={styles.card}>
          <Text variant="bodySmallMedium">{t('pod_parcel_title')}</Text>
          {verified ? (
            <View style={styles.row}>
              <Ionicons name="checkmark-circle" size={size.icon.md} color={colors.success} />
              <Text variant="bodySmall" color="success">
                {`${t('pod_parcel_verified')} · ${code}`}
              </Text>
            </View>
          ) : scanning ? (
            <>
              <ParcelScanner onCode={onCode} height={200} />
              {scanError ? <Banner tone="danger" message={scanError} icon="close-circle" /> : null}
              <Button title={t('cancel')} variant="ghost" onPress={() => setScanning(false)} />
            </>
          ) : (
            <>
              <Button
                title={t('pod_parcel_scan')}
                variant="secondary"
                onPress={() => {
                  setScanError('');
                  setScanning(true);
                }}
                icon={(color) => <Ionicons name="qr-code-outline" size={size.icon.md} color={color} />}
              />
              <Button
                title={skipScan ? t('pod_parcel_skipped') : t('pod_parcel_skip')}
                variant="ghost"
                disabled={skipScan}
                onPress={() => setSkipScan(true)}
              />
            </>
          )}
        </Card>
      ) : null}

      {kind === 'partial' ? (
        <Card style={styles.card}>
          <PieceCounter label={t('cargo_pieces_accepted')} value={accepted} onChange={setAccepted} max={onBoard ?? undefined} />
          <PieceCounter label={t('cargo_pieces_refused')} value={refused} onChange={setRefused} max={onBoard ?? undefined} />
          <PieceCounter label={t('cargo_pieces_short')} value={short} onChange={setShort} max={onBoard ?? undefined} hint={t('cargo_pieces_short_hint')} />
        </Card>
      ) : null}

      {kind === 'remarks' ? (
        <Card style={styles.card}>
          <ConditionPicker value={condition} onChange={setCondition} options={DAMAGE_CONDITIONS} />
          <PhotoStrip label={t('cargo_damage_photos')} photos={damagePhotos} onChange={setDamagePhotos} max={3} disabled={saving} />
        </Card>
      ) : null}

      {delivers ? (
        <Card style={styles.card}>
          <PhotoStrip label={t('pod_photo_title')} photos={photo} onChange={setPhoto} max={1} disabled={saving} />
          <SignatureBlock label={t('pod_signature_title')} uri={signature} onSign={() => setSigning(true)} disabled={saving} />
          <TextField
            label={t('pod_receiver_label')}
            placeholder={t('pod_receiver_placeholder')}
            value={receiver}
            onChangeText={setReceiver}
            maxLength={100}
            autoCapitalize="words"
            autoCorrect={false}
          />
          {otpRequired !== false ? (
            <TextField
              label={otpRequired ? t('cargo_otp_label') : t('cargo_otp_label_optional')}
              hint={otpRequired ? t('cargo_otp_hint') : t('cargo_otp_hint_optional')}
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
            />
          ) : null}
        </Card>
      ) : null}

      {kind === 'refused' ? (
        <Card style={styles.card}>
          <Text variant="bodySmallMedium">{t('cargo_refusal_reason')}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {REFUSAL_REASONS.map((r) => (
              <Chip key={r} label={t(`cargo_refusal_${r}`)} selected={refusal === r} tone="danger" onPress={() => setRefusal(r)} />
            ))}
          </View>
          <PhotoStrip label={t('cargo_refusal_photo')} photos={refusalPhotos} onChange={setRefusalPhotos} max={3} disabled={saving} />
        </Card>
      ) : null}

      {kind === 'not_delivered' ? (
        <Card style={styles.card}>
          <Text variant="bodySmallMedium">{t('issue_reason_prompt')}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {NOT_DELIVERED_REASONS.map((r) => (
              <Chip key={r} label={t(`issue_reason_${r}`)} selected={reason === r} tone="danger" onPress={() => setReason(r)} />
            ))}
          </View>
        </Card>
      ) : null}

      {(kind === 'not_delivered' || kind === 'refused') && attempts ? (
        <Banner
          tone={attempts.left === 0 ? 'danger' : 'warning'}
          icon="repeat-outline"
          message={[
            fill(t('cargo_attempt_n_of_max'), { n: attempts.thisAttempt, max: attempts.max }),
            attempts.left === 0 ? t('cargo_attempt_last') : fill(t('cargo_attempts_left'), { n: attempts.left }),
          ].join(' ')}
        />
      ) : null}

      {kind !== 'full' ? (
        <TextField
          label={kind === 'not_delivered' || kind === 'refused' ? t('issue_note_label') : t('cargo_remarks_label')}
          multiline
          value={note}
          onChangeText={setNote}
          maxLength={300}
        />
      ) : null}

      <DispatchNote reasons={partialNote} />
      {error ? <ErrorBanner message={error} /> : null}
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  card: { gap: space[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  action: { flex: 1 },
});
