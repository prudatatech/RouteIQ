/**
 * Pickup details, after the parcel scan: per consignment the pieces (prefilled
 * from the booking), weight, condition and seal number; then 1 to 3 photos
 * and the consignor's signature. Each consignment is recorded as a `pickup`
 * custody event. Fewer pieces than booked, or a condition other than good,
 * makes the server open a case for dispatch, and the driver is told so here.
 *
 * Lots: a consignment booked to several drops is split into lots at booking,
 * and only the lots are picked up. Scanning the master's code lists its lots
 * (each with its code, pieces and consignee) and records a pickup per lot.
 */
import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useConsignmentInfo, useLotFamily } from '../../hooks/useCargo';
import type { ScanOutcome } from '../../hooks/useParcelScan';
import { normalizeParcelCode } from '../../utils/parcel';
import type { ConditionCode, ConsignmentInfo, ConsignmentRef, LotFamily, LotTag } from '../../services/cargo';
import { sendCustody, type CargoSendResult } from '../../services/cargoActions';
import type { LatLng } from '../../types/route';
import { fill } from '../../locales';
import { errorMessage } from '../../utils/errors';
import CargoScreen from '../../components/cargo/CargoScreen';
import LotLine from '../../components/cargo/LotLine';
import { ConditionPicker, DispatchNote, PhotoStrip, PieceCounter, SignatureBlock } from '../../components/cargo/CargoFields';
import ParcelScanner, { type ScanMethod } from '../../components/scan/ParcelScanner';
import SignaturePad from '../../components/modals/SignaturePad';
import { Banner, Button, Card, ErrorBanner, IconButton, Text, TextField } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';
import { size, space } from '../../theme';

/** A consignment scanned at this pickup. */
export interface PickupItem {
  code: string;
  /** The vendor load, or the tracking ID (the server takes either). */
  ref: ConsignmentRef;
  /** For a lot listed from its master's scan: the master's code (what the driver scanned). */
  masterCode?: string;
  lot?: LotTag;
}

/** Lots still with the sender are the ones to pick up. */
const AT_SENDER = new Set(['created', 'assigned', 'scheduled']);

/** A master's lots to pick up here, as pickup items. */
function lotItems(masterCode: string, family: LotFamily): PickupItem[] {
  return family.lots
    .filter((l) => (l.holder ? l.holder === 'consignor' : !l.status || AT_SENDER.has(l.status)))
    .map((l) => ({
      code: l.code,
      ref: l.ref ?? l.code,
      masterCode,
      lot: { label: l.label, masterCode, consigneeName: l.consigneeName, consigneePhone: l.consigneePhone },
    }));
}

interface ItemForm {
  pieces: number | null;
  weight: string;
  condition: ConditionCode;
  seal: string;
}

const BLANK: ItemForm = { pieces: null, weight: '', condition: 'good', seal: '' };

interface PickupScreenProps {
  items: PickupItem[];
  currentLoc: LatLng | null;
  /** Scans another parcel at this pickup; a picked-up parcel is added to `items` by the caller. */
  onScan: (code: string, method: ScanMethod) => Promise<ScanOutcome>;
  onRemove: (code: string) => void;
  /** Saved (or kept to send). The caller clears the list, tells the driver and offers to depart. */
  onDone: (items: PickupItem[], result: CargoSendResult) => void;
  onClose: () => void;
  headerRight?: ReactNode;
}

export default function PickupScreen({ items, currentLoc, onScan, onRemove, onDone, onClose, headerRight }: PickupScreenProps) {
  const { t } = useTranslation();
  const [forms, setForms] = useState<Record<string, ItemForm>>({});
  const [booked, setBooked] = useState<Record<string, ConsignmentInfo | null>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // A scanned master whose lots are picked up instead: master code → its lots
  const [expanded, setExpanded] = useState<Record<string, PickupItem[]>>({});
  const onLots = useCallback((masterCode: string, lots: PickupItem[]) => {
    setExpanded((cur) => (cur[masterCode] ? cur : { ...cur, [masterCode]: lots }));
  }, []);
  // What is recorded: each scanned consignment, or its lots
  const picked = useMemo(() => items.flatMap((i) => expanded[i.code] ?? [i]), [items, expanded]);

  const removeItem = (item: PickupItem) => {
    if (!item.masterCode) return onRemove(item.code);
    const rest = (expanded[item.masterCode] ?? []).filter((l) => l.code !== item.code);
    if (rest.length === 0) onRemove(item.masterCode);
    setExpanded((cur) => ({ ...cur, [item.masterCode!]: rest }));
  };

  const formOf = (code: string) => forms[code] ?? BLANK;
  const update = (code: string, patch: Partial<ItemForm>) => setForms((cur) => ({ ...cur, [code]: { ...(cur[code] ?? BLANK), ...patch } }));

  // Pieces start at what was booked, until the driver changes them
  const onInfo = useCallback((code: string, info: ConsignmentInfo | null) => {
    setBooked((cur) => ({ ...cur, [code]: info }));
    setForms((cur) => {
      const form = cur[code] ?? BLANK;
      if (form.pieces !== null || !info) return cur;
      const pieces = info.piecesTotal ?? null;
      return { ...cur, [code]: { ...form, pieces, seal: form.seal || info.sealNumber || '' } };
    });
  }, []);

  const notes = useMemo(() => {
    const reasons: string[] = [];
    for (const item of picked) {
      const form = forms[item.code] ?? BLANK;
      const total = booked[item.code]?.piecesTotal;
      if (form.pieces !== null && total && form.pieces < total) {
        reasons.push(fill(t('cargo_note_short'), { code: item.code, n: form.pieces, total }));
      }
      if (form.condition !== 'good') reasons.push(`${item.code}: ${t(`cargo_condition_${form.condition}`)}`);
    }
    return reasons;
  }, [picked, forms, booked, t]);

  const scan = async (code: string, method: ScanMethod) => {
    setScanBusy(true);
    setScanMessage('');
    try {
      const outcome = await onScan(code, method);
      if (outcome.kind === 'picked_up') setScanning(false);
      else if (outcome.kind === 'error') setScanMessage(outcome.message || t('scan_failed_desc'));
      else if (outcome.kind === 'not_on_route') setScanMessage(t('scan_not_on_route_desc'));
      else setScanMessage(t('cargo_scan_not_pickup'));
    } finally {
      setScanBusy(false);
    }
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    for (const item of picked) {
      const form = formOf(item.code);
      if (!form.pieces || form.pieces < 1) found[item.code] = t('cargo_pieces_required');
      else if (form.weight && !(Number(form.weight) > 0)) found[item.code] = t('cargo_weight_invalid');
    }
    setErrors(found);
    if (Object.keys(found).length) {
      setError(t('cargo_fix_items'));
      return;
    }
    if (photos.length === 0) {
      setError(t('cargo_photo_required'));
      return;
    }
    if (!signature) {
      setError(t('cargo_consignor_signature_required'));
      return;
    }
    setError('');
    setSaving(true);
    try {
      const position = currentLoc ? { lat: currentLoc.lat, lng: currentLoc.lng } : {};
      const result = await sendCustody({
        label: 'pickup',
        photoUris: photos,
        signatureUri: signature,
        events: picked.map((item) => {
          const form = formOf(item.code);
          return {
            ref: item.ref,
            code: item.code,
            fields: {
              kind: 'pickup' as const,
              pieces: form.pieces ?? 0,
              condition: form.condition,
              ...(form.weight ? { weight_kg: Number(form.weight) } : {}),
              ...(form.seal.trim() ? { seal_number: form.seal.trim() } : {}),
              ...position,
            },
          };
        }),
      });
      onDone(picked, result);
    } catch (e) {
      setError(errorMessage(e, t('action_failed')));
    } finally {
      setSaving(false);
    }
  };

  if (signing) {
    return (
      <CargoScreen title={t('cargo_pickup_title')} onClose={() => setSigning(false)} headerRight={headerRight}>
        <SignaturePad
          title={t('cargo_consignor_signature')}
          hint={t('cargo_consignor_signature_hint')}
          onDone={(uri) => {
            setSignature(uri);
            setSigning(false);
          }}
          onCancel={() => setSigning(false)}
        />
      </CargoScreen>
    );
  }

  return (
    <CargoScreen
      title={t('cargo_pickup_title')}
      subtitle={fill(t('cargo_n_consignments'), { n: picked.length })}
      onClose={onClose}
      headerRight={headerRight}
      footer={
        <>
          <Button title={t('cancel')} variant="secondary" block={false} style={styles.action} onPress={onClose} disabled={saving} />
          <Button title={t('cargo_pickup_save')} block={false} style={styles.action} onPress={submit} loading={saving} disabled={picked.length === 0} />
        </>
      }
    >
      <Text variant="bodySmall" color="textMuted">
        {t('cargo_pickup_intro')}
      </Text>

      {picked.length === 0 ? <Banner tone="info" message={t('cargo_pickup_empty')} /> : null}

      {Object.entries(expanded)
        .filter(([master, lots]) => lots.length > 0 && items.some((i) => i.code === master))
        .map(([master, lots]) => (
          <Banner key={master} tone="info" icon="git-branch-outline" message={fill(t('cargo_pickup_master_lots'), { code: master, n: lots.length })} />
        ))}

      {picked.map((item) => (
        <PickupItemCard
          key={item.code}
          item={item}
          form={formOf(item.code)}
          info={booked[item.code] ?? null}
          error={errors[item.code]}
          onInfo={onInfo}
          onLots={onLots}
          onChange={(patch) => update(item.code, patch)}
          onRemove={() => removeItem(item)}
          disabled={saving}
        />
      ))}

      <Card style={styles.card}>
        {scanning ? (
          <>
            <ParcelScanner onCode={scan} busy={scanBusy} height={200} />
            {scanMessage ? <Banner tone="danger" icon="close-circle" message={scanMessage} /> : null}
            <Button title={t('cancel')} variant="ghost" onPress={() => setScanning(false)} />
          </>
        ) : (
          <Button
            title={t('cargo_scan_another_here')}
            variant="secondary"
            onPress={() => {
              setScanMessage('');
              setScanning(true);
            }}
            icon={(color) => <Ionicons name="qr-code-outline" size={size.icon.md} color={color} />}
          />
        )}
      </Card>

      <Card style={styles.card}>
        <PhotoStrip label={t('cargo_pickup_photos')} hint={t('cargo_photos_hint')} photos={photos} onChange={setPhotos} max={3} disabled={saving} />
        <SignatureBlock label={t('cargo_consignor_signature')} uri={signature} onSign={() => setSigning(true)} disabled={saving} />
      </Card>

      <DispatchNote reasons={notes} />
      {error ? <ErrorBanner message={error} /> : null}
    </CargoScreen>
  );
}

function PickupItemCard({
  item,
  form,
  info,
  error,
  onInfo,
  onLots,
  onChange,
  onRemove,
  disabled,
}: {
  item: PickupItem;
  form: ItemForm;
  info: ConsignmentInfo | null;
  error?: string;
  onInfo: (code: string, info: ConsignmentInfo | null) => void;
  onLots: (masterCode: string, lots: PickupItem[]) => void;
  onChange: (patch: Partial<ItemForm>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { info: loaded, loading } = useConsignmentInfo(item.code);
  useEffect(() => {
    if (!loading) onInfo(item.code, loaded);
  }, [loaded, loading, item.code, onInfo]);

  // Lots of a split consignment: a master's scan turns into its lots; a lot shows its consignee
  const { family } = useLotFamily(item.masterCode ? null : item.code);
  const isMaster = !!family?.masterCode && normalizeParcelCode(family.masterCode) === normalizeParcelCode(item.code);
  useEffect(() => {
    if (family && isMaster) {
      const lots = lotItems(item.code, family);
      if (lots.length) onLots(item.code, lots);
    }
  }, [family, isMaster, item.code, onLots]);
  const row = family?.lots.find((l) => normalizeParcelCode(l.code) === normalizeParcelCode(item.code));
  const lot: LotTag | null =
    item.lot ??
    (row ? { label: row.label, masterCode: family?.masterCode ?? null, consigneeName: row.consigneeName, consigneePhone: row.consigneePhone } : null);

  const total = info?.piecesTotal;
  return (
    <Card style={styles.card}>
      <View style={styles.itemHead}>
        <View style={styles.flex}>
          <LotLine code={item.code} pieces={total ?? null} lot={lot} />
        </View>
        <IconButton
          accessibilityLabel={`${t('cargo_remove_item')} ${item.code}`}
          onPress={onRemove}
          disabled={disabled}
          icon={(color) => <Ionicons name="trash-outline" size={size.icon.md} color={color} />}
        />
      </View>
      <PieceCounter
        label={t('cargo_pieces')}
        value={form.pieces}
        onChange={(pieces) => onChange({ pieces })}
        hint={total ? fill(t('cargo_pieces_booked'), { n: total }) : loading ? t('loading') : t('cargo_pieces_count_hint')}
        error={error}
      />
      <TextField
        label={t('cargo_weight_optional')}
        value={form.weight}
        onChangeText={(weight) => onChange({ weight: weight.replace(/[^0-9.]/g, '') })}
        keyboardType="decimal-pad"
        maxLength={8}
      />
      <ConditionPicker value={form.condition} onChange={(condition) => onChange({ condition })} />
      <TextField
        label={t('cargo_seal_optional')}
        value={form.seal}
        onChangeText={(seal) => onChange({ seal })}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={40}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  action: { flex: 1 },
});
