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
 *
 * Lots (docs/cargo-plan.md): when several lots of a split consignment are
 * dropped at this place, the sheet lists them by consignee. Each lot's outcome
 * is recorded on its own, with its own receiver and delivery code. Lots for
 * the same consignee can be recorded together with one proof of delivery
 * (each lot still gets its own delivery code when it needs one).
 */
import React, { useMemo, useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useConsignmentInfos } from '../../hooks/useCargo';
import type { StopCheck } from '../../hooks/useParcelScan';
import type { FailureReasonCode } from '../../services/actionQueue';
import { NO_LOT, type ConditionCode, type ConsignmentInfo } from '../../services/cargo';
import type { PodInput } from '../../services/podUpload';
import type { RouteStop } from '../../types/route';
import { consigneeKey, type DropLot } from '../../utils/dropLots';
import { fill } from '../../locales';
import CargoScreen from '../../components/cargo/CargoScreen';
import LotLine from '../../components/cargo/LotLine';
import { ConditionPicker, DispatchNote, PhotoStrip, PieceCounter, SignatureBlock } from '../../components/cargo/CargoFields';
import ParcelScanner, { type ScanMethod } from '../../components/scan/ParcelScanner';
import SignaturePad from '../../components/modals/SignaturePad';
import { Banner, Button, Card, Chip, ErrorBanner, StatusPill, Text, TextField } from '../../components/ui';
import { colors, size, space } from '../../theme';

export type DeliveryKind = 'full' | 'remarks' | 'partial' | 'refused' | 'not_delivered';
export type RefusalReason = 'customer_refused' | 'damaged_refused' | 'other';

/**
 * What the driver recorded; useRouteActions sends it. `otp` is the code of a single consignment;
 * `otps` holds each lot's own code (by stop id) when lots are recorded together.
 */
export type DeliveryOutcome =
  | { kind: 'full'; pod: PodInput; otp?: string; otps?: Record<string, string> }
  | { kind: 'remarks'; pod: PodInput; otp?: string; otps?: Record<string, string>; condition: ConditionCode; damagePhotos: string[]; note?: string }
  | { kind: 'partial'; pod: PodInput; otp?: string; otps?: Record<string, string>; accepted: number; refused: number; short: number; note?: string }
  | { kind: 'refused'; reason: RefusalReason; photos: string[]; note?: string }
  | { kind: 'not_delivered'; reason: FailureReasonCode; note: string };

/** One lot (or the stop's one consignment) with its details, for the sender. */
export interface DeliveryEntry {
  stop: RouteStop;
  info: ConsignmentInfo | null;
}

const KINDS: DeliveryKind[] = ['full', 'remarks', 'partial', 'refused', 'not_delivered'];
/** Lots recorded together share one outcome; a partial count is per lot, so it is recorded lot by lot. */
const GROUP_KINDS: DeliveryKind[] = ['full', 'remarks', 'refused', 'not_delivered'];
const REFUSAL_REASONS: RefusalReason[] = ['customer_refused', 'damaged_refused', 'other'];
/** The existing complete-stop reasons; a refusal has its own outcome. */
const NOT_DELIVERED_REASONS: FailureReasonCode[] = ['customer_unavailable', 'address_unreachable', 'premises_closed', 'other'];
const DAMAGE_CONDITIONS: ConditionCode[] = ['damaged_packaging', 'damaged_goods', 'wet', 'seal_tampered', 'shortage', 'excess'];
/** Attempts before the goods go back, when the server does not say (the schema's default). */
const DEFAULT_MAX_ATTEMPTS = 3;

interface DeliveryScreenProps {
  stop: RouteStop;
  /** The lots to hand over at this drop (see dropLotsFor). Absent or one: the stop's own sheet. */
  lots?: DropLot[];
  initialKind?: DeliveryKind;
  /** Whether this stop's parcel was already scanned. */
  isVerified?: (stop: RouteStop) => boolean;
  onScanCode?: (stop: RouteStop, code: string, method: ScanMethod) => StopCheck;
  /**
   * Sends the outcome for these lots. Resolves when saved (or kept to send later); throws with a
   * message on failure. `onSent` is called for each lot saved before an error.
   */
  onSubmit: (outcome: DeliveryOutcome, entries: DeliveryEntry[], onSent: (stopId: string) => void) => Promise<void>;
  onClose: () => void;
  headerRight?: ReactNode;
}

export default function DeliveryScreen(props: DeliveryScreenProps) {
  const { stop, lots } = props;
  if (lots && lots.length > 1) return <LotsSheet {...props} lots={lots} />;
  const single: DropLot = lots?.[0] ?? { stop, code: stop.parcel?.code ?? '', ref: null, pieces: null, lot: NO_LOT };
  return (
    <OutcomeForm
      lots={[single]}
      initialKind={props.initialKind}
      isVerified={props.isVerified}
      onScanCode={props.onScanCode}
      onSubmit={async (outcome, entries, onSent) => {
        await props.onSubmit(outcome, entries, onSent);
        props.onClose();
      }}
      onClose={props.onClose}
      headerRight={props.headerRight}
    />
  );
}

// ── Several lots at one drop ───────────────────────────────────

interface Group {
  key: string;
  name: string | null;
  phone: string | null;
  lots: DropLot[];
}

/** The lots at this drop grouped by consignee; each lot or group opens the outcome form. */
function LotsSheet({ lots, initialKind, isVerified, onScanCode, onSubmit, onClose, headerRight }: DeliveryScreenProps & { lots: DropLot[] }) {
  const { t } = useTranslation();
  const [recorded, setRecorded] = useState<Record<string, DeliveryKind>>({});
  const [selection, setSelection] = useState<DropLot[] | null>(null);

  const groups = useMemo(() => {
    const out: Group[] = [];
    for (const lot of lots) {
      const key = consigneeKey(lot);
      const group = out.find((g) => g.key === key);
      if (group) group.lots.push(lot);
      else out.push({ key, name: lot.lot.consigneeName, phone: lot.lot.consigneePhone, lots: [lot] });
    }
    return out;
  }, [lots]);

  const left = lots.filter((l) => !recorded[l.stop.id]).length;

  if (selection) {
    return (
      <OutcomeForm
        lots={selection}
        initialKind={initialKind}
        isVerified={isVerified}
        onScanCode={onScanCode}
        onSubmit={async (outcome, entries, onSent) => {
          await onSubmit(outcome, entries, (stopId) => {
            setRecorded((cur) => ({ ...cur, [stopId]: outcome.kind }));
            onSent(stopId);
          });
          setSelection(null);
        }}
        onClose={() => setSelection(null)}
        closeLabel={t('back')}
        headerRight={headerRight}
      />
    );
  }

  return (
    <CargoScreen
      title={t('cargo_delivery_title')}
      subtitle={[lots[0].stop.delivery_point?.name, fill(t('cargo_lots_at_drop_n'), { n: lots.length })].filter(Boolean).join(' · ')}
      onClose={onClose}
      headerRight={headerRight}
      footer={<Button title={left === 0 ? t('done') : t('close')} variant={left === 0 ? 'primary' : 'secondary'} onPress={onClose} />}
    >
      <Text variant="bodySmall" color="textMuted">
        {t('cargo_lots_intro')}
      </Text>
      {left === 0 ? <Banner tone="info" icon="checkmark-circle" message={t('cargo_lots_all_recorded')} /> : null}

      {groups.map((group) => {
        const open = group.lots.filter((l) => !recorded[l.stop.id]);
        return (
          <Card key={group.key} style={styles.card}>
            <View style={styles.row}>
              <Ionicons name="person-outline" size={size.icon.md} color={colors.textMuted} />
              <Text variant="title" style={styles.flex}>
                {group.name ?? t('cargo_lot_no_consignee')}
              </Text>
            </View>
            {group.phone ? (
              <Text variant="bodySmall" color="textMuted">
                {group.phone}
              </Text>
            ) : null}
            {group.lots.map((lot) => {
              const done = recorded[lot.stop.id];
              return (
                <View key={lot.stop.id} style={styles.lot}>
                  <LotLine
                    code={lot.code}
                    pieces={lot.pieces}
                    lot={lot.lot}
                    hideConsignee
                    trailing={done ? <StatusPill label={t(`cargo_outcome_${done}`)} tone={done === 'full' || done === 'remarks' || done === 'partial' ? 'success' : 'warning'} /> : null}
                  />
                  {!done && group.lots.length > 1 ? (
                    <Button title={t('cargo_lot_record_one')} variant="secondary" onPress={() => setSelection([lot])} />
                  ) : null}
                </View>
              );
            })}
            {open.length > 1 ? (
              <Button
                title={fill(t('cargo_lots_record_together'), { n: open.length })}
                onPress={() => setSelection(open)}
                icon={(color) => <Ionicons name="layers-outline" size={size.icon.md} color={color} />}
              />
            ) : open.length === 1 && group.lots.length === 1 ? (
              <Button title={t('cargo_lot_record')} onPress={() => setSelection(open)} />
            ) : null}
          </Card>
        );
      })}
    </CargoScreen>
  );
}

// ── The outcome form, for one lot or several of one consignee ──

interface OutcomeFormProps {
  lots: DropLot[];
  initialKind?: DeliveryKind;
  isVerified?: (stop: RouteStop) => boolean;
  onScanCode?: (stop: RouteStop, code: string, method: ScanMethod) => StopCheck;
  onSubmit: (outcome: DeliveryOutcome, entries: DeliveryEntry[], onSent: (stopId: string) => void) => Promise<void>;
  onClose: () => void;
  closeLabel?: string;
  headerRight?: ReactNode;
}

function OutcomeForm({ lots, initialKind = 'full', isVerified, onScanCode, onSubmit, onClose, closeLabel, headerRight }: OutcomeFormProps) {
  const { t } = useTranslation();
  const together = lots.length > 1;
  const first = lots[0];
  const codes = useMemo(() => lots.map((l) => l.code).filter(Boolean), [lots]);
  const { infos, loading: infoLoading } = useConsignmentInfos(codes);
  const infoOf = (lot: DropLot): ConsignmentInfo | null => (lot.code ? infos[lot.code] ?? null : null);
  const info = infoOf(first);

  const kinds = together ? GROUP_KINDS : KINDS;
  const [kind, setKind] = useState<DeliveryKind>(kinds.includes(initialKind) ? initialKind : 'full');

  const [verified, setVerified] = useState<Set<string>>(() => new Set(lots.filter((l) => isVerified?.(l.stop)).map((l) => l.stop.id)));
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [skipScan, setSkipScan] = useState(false);

  const [receiver, setReceiver] = useState('');
  const [photo, setPhoto] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [otps, setOtps] = useState<Record<string, string>>({});
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
  // Lots already saved in this form: a retry after an error sends only the rest
  const [sent, setSent] = useState<Set<string>>(new Set());

  const piecesOf = (lot: DropLot) => {
    const i = infoOf(lot);
    return i?.piecesOnBoard ?? i?.piecesTotal ?? lot.pieces;
  };
  const counts = lots.map(piecesOf);
  const onBoard = counts.every((c): c is number => c !== null) ? counts.reduce((a, b) => a + b, 0) : null;
  const delivers = kind === 'full' || kind === 'remarks' || kind === 'partial';
  const scannable = lots.filter((l) => !!l.code);
  const needsScan = delivers && scannable.length > 0 && !!onScanCode;
  const allVerified = scannable.every((l) => verified.has(l.stop.id));
  const otpRequired = (lot: DropLot) => infoOf(lot)?.otpRequired ?? null;

  const attempts = useMemo(() => {
    if (together || info?.attempts === null || info?.attempts === undefined) return null;
    const max = info.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const thisAttempt = info.attempts + 1;
    return { thisAttempt, max, left: Math.max(0, max - thisAttempt) };
  }, [info, together]);

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
    const match = scannable.find((l) => !verified.has(l.stop.id) && onScanCode(l.stop, value, method) === 'ok');
    if (!match) {
      setScanError(t('pod_parcel_wrong'));
      return;
    }
    const next = new Set(verified);
    next.add(match.stop.id);
    setVerified(next);
    setScanError('');
    if (scannable.every((l) => next.has(l.stop.id))) setScanning(false);
  };

  const podInput = (): PodInput => ({ receiverName: receiver.trim(), photoUri: photo[0] ?? null, signatureUri: signature });

  const fail = (message: string) => {
    setError(message);
    return null;
  };

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
    if (needsScan && !allVerified && !skipScan) return fail(t('pod_parcel_required'));
    if (receiver.trim().length < 3) return fail(t('alert_valid_receiver'));
    if (!photo.length && !signature) return fail(t('cargo_photo_or_signature'));
    const codesByStop: Record<string, string> = {};
    for (const lot of lots) {
      const code6 = (otps[lot.stop.id] ?? '').trim();
      if (otpRequired(lot) === true && !/^\d{6}$/.test(code6)) {
        return fail(together ? fill(t('cargo_lot_otp_required'), { code: lot.code }) : t('cargo_otp_required'));
      }
      if (code6 && !/^\d{6}$/.test(code6)) return fail(t('cargo_otp_invalid'));
      if (code6) codesByStop[lot.stop.id] = code6;
    }
    const withOtp = together ? { otps: codesByStop } : codesByStop[first.stop.id] ? { otp: codesByStop[first.stop.id] } : {};
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

  const submit = async () => {
    const outcome = build();
    if (!outcome) return;
    setError('');
    setSaving(true);
    const done = new Set(sent);
    try {
      const entries = lots.filter((l) => !done.has(l.stop.id)).map((l) => ({ stop: l.stop, info: infoOf(l) }));
      await onSubmit(outcome, entries, (stopId) => {
        done.add(stopId);
        setSent(new Set(done));
      });
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
  const subtitle = together
    ? [first.lot.consigneeName, fill(t('cargo_lots_n'), { n: lots.length })].filter(Boolean).join(' · ')
    : [first.stop.delivery_point?.name, first.code].filter(Boolean).join(' · ');
  const hasLot = together || !!first.lot.label || !!first.lot.consigneeName;
  const otpLots = lots.filter((l) => otpRequired(l) !== false);

  return (
    <CargoScreen
      title={t('cargo_delivery_title')}
      subtitle={subtitle || undefined}
      onClose={onClose}
      headerRight={headerRight}
      footer={
        <>
          <Button title={closeLabel ?? t('cancel')} variant="secondary" block={false} style={styles.action} onPress={onClose} disabled={saving} />
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
      {hasLot ? (
        <Card style={styles.card}>
          {together ? <Text variant="bodySmallMedium">{fill(t('cargo_lots_together_title'), { n: lots.length })}</Text> : null}
          {lots.map((lot) => (
            <LotLine
              key={lot.stop.id}
              code={lot.code}
              pieces={piecesOf(lot)}
              lot={lot.lot}
              hideConsignee={together}
              trailing={sent.has(lot.stop.id) ? <Ionicons name="checkmark-circle" size={size.icon.md} color={colors.success} /> : null}
            />
          ))}
        </Card>
      ) : null}

      <View style={styles.section}>
        <Text variant="bodyMedium">{t('cargo_what_happened')}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {kinds.map((k) => (
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
        {together ? (
          <Text variant="bodySmall" color="textMuted">
            {t('cargo_lots_partial_hint')}
          </Text>
        ) : null}
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
          {allVerified ? (
            <View style={styles.row}>
              <Ionicons name="checkmark-circle" size={size.icon.md} color={colors.success} />
              <Text variant="bodySmall" color="success">
                {together ? fill(t('cargo_lots_scanned_all'), { n: scannable.length }) : `${t('pod_parcel_verified')} · ${first.code}`}
              </Text>
            </View>
          ) : scanning ? (
            <>
              {together ? (
                <Text variant="bodySmall" color="textMuted">
                  {fill(t('cargo_lots_scanned_n'), { n: scannable.filter((l) => verified.has(l.stop.id)).length, total: scannable.length })}
                </Text>
              ) : null}
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
          {together ? (
            <Text variant="bodySmall" color="textMuted">
              {t('cargo_lots_one_pod')}
            </Text>
          ) : null}
          <PhotoStrip label={t('pod_photo_title')} photos={photo} onChange={setPhoto} max={1} disabled={saving} />
          <SignatureBlock label={t('pod_signature_title')} uri={signature} onSign={() => setSigning(true)} disabled={saving} />
          <TextField
            label={t('pod_receiver_label')}
            placeholder={first.lot.consigneeName ?? t('pod_receiver_placeholder')}
            value={receiver}
            onChangeText={setReceiver}
            maxLength={100}
            autoCapitalize="words"
            autoCorrect={false}
          />
          {otpLots.map((lot) => {
            const required = otpRequired(lot);
            return (
              <TextField
                key={lot.stop.id}
                label={
                  together
                    ? fill(required ? t('cargo_lot_otp_label') : t('cargo_lot_otp_label_optional'), { code: lot.code })
                    : required
                      ? t('cargo_otp_label')
                      : t('cargo_otp_label_optional')
                }
                hint={required ? t('cargo_otp_hint') : t('cargo_otp_hint_optional')}
                value={otps[lot.stop.id] ?? ''}
                onChangeText={(v) => setOtps((cur) => ({ ...cur, [lot.stop.id]: v.replace(/[^0-9]/g, '') }))}
                keyboardType="number-pad"
                maxLength={6}
              />
            );
          })}
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
  flex: { flex: 1 },
  lot: { gap: space[2], paddingTop: space[2], borderTopWidth: size.border, borderTopColor: colors.border },
  action: { flex: 1 },
});
