/**
 * A transfer of goods between vehicles (or to a hub) that dispatch planned.
 *
 * - Hand over (this vehicle gives the goods): the meeting point with "Open in
 *   Maps", the count out per consignment with its condition, photos, and the
 *   signature of whoever takes the goods.
 * - Receive goods (this vehicle takes them): the count in, condition and
 *   photos, and optionally the handing driver's signature. A count below what
 *   was handed over makes the server open a shortage case.
 */
import React, { useState, type ReactNode } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, StyleSheet } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useLotFamily, type VehicleTransfer } from '../../hooks/useCargo';
import { refKey, type ConditionCode, type LotFamily, type TransferItem } from '../../services/cargo';
import { sendHandover } from '../../services/cargoActions';
import { fill } from '../../locales';
import { errorMessage } from '../../utils/errors';
import { normalizeParcelCode } from '../../utils/parcel';
import { formatDateTime } from '../../utils/format';
import { openTurnByTurn } from '../../utils/navigation';
import CargoScreen from '../../components/cargo/CargoScreen';
import LotLine from '../../components/cargo/LotLine';
import { ConditionPicker, DispatchNote, PhotoStrip, PieceCounter, SignatureBlock } from '../../components/cargo/CargoFields';
import SignaturePad from '../../components/modals/SignaturePad';
import { Banner, Button, Card, ErrorBanner, Text } from '../../components/ui';
import { size, space } from '../../theme';

interface ItemCount {
  pieces: number | null;
  condition: ConditionCode;
}

interface HandoverScreenProps {
  vehicleTransfer: VehicleTransfer;
  onDone: () => void;
  onClose: () => void;
  headerRight?: ReactNode;
}

export default function HandoverScreen({ vehicleTransfer, onDone, onClose, headerRight }: HandoverScreenProps) {
  const { t } = useTranslation();
  const { transfer, direction } = vehicleTransfer;
  const out = direction === 'out';
  const [counts, setCounts] = useState<Record<string, ItemCount>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Before the goods are handed over there is nothing to receive yet
  const waiting = !out && transfer.status === 'planned';
  const alreadyOut = out && transfer.status === 'in_progress';

  const expected = (item: TransferItem) => (out ? item.piecesPlanned : item.piecesOut ?? item.piecesPlanned);
  const countOf = (item: TransferItem): ItemCount => counts[refKey(item.ref)] ?? { pieces: expected(item), condition: 'good' };
  const update = (item: TransferItem, patch: Partial<ItemCount>) =>
    setCounts((cur) => ({ ...cur, [refKey(item.ref)]: { ...countOf(item), ...patch } }));

  const notes = transfer.items.flatMap((item) => {
    const c = countOf(item);
    const exp = expected(item);
    const reasons: string[] = [];
    if (c.pieces !== null && exp !== null && c.pieces < exp) reasons.push(fill(t('cargo_note_count'), { code: item.code, n: c.pieces, total: exp }));
    if (c.condition !== 'good') reasons.push(`${item.code}: ${t(`cargo_condition_${c.condition}`)}`);
    return reasons;
  });

  const destination = transfer.toPlate
    ? fill(t('cargo_transfer_to_vehicle'), { plate: transfer.toPlate })
    : transfer.depotName
      ? fill(t('cargo_transfer_to_hub'), { hub: transfer.depotName })
      : null;

  const openMaps = async () => {
    if (!transfer.meet || !(await openTurnByTurn(transfer.meet))) Alert.alert(t('error'), t('open_maps_failed'));
  };

  const submit = async () => {
    for (const item of transfer.items) {
      if (countOf(item).pieces === null) return setError(fill(t('cargo_count_required'), { code: item.code }));
    }
    if (photos.length === 0) return setError(t('cargo_photo_required'));
    if (out && !signature) return setError(t('cargo_other_signature_required'));
    setError('');
    setSaving(true);
    try {
      const short = transfer.items.some((item) => {
        const exp = expected(item);
        return exp !== null && (countOf(item).pieces ?? 0) < exp;
      });
      const result = await sendHandover(
        {
          transferId: transfer.id,
          direction,
          items: transfer.items.map((item) => ({ ref: item.ref, pieces: countOf(item).pieces ?? 0, condition: countOf(item).condition })),
          photoUris: photos,
          signatureUri: signature,
        },
        short,
      );
      const codes = result.exceptions.map((e) => e.code).join(', ');
      const body = result.queued ? t('queue_saved_desc') : out ? t('cargo_handover_saved') : t('cargo_receive_saved');
      Alert.alert(result.queued ? t('queue_saved_title') : t('cargo_saved_title'), codes ? `${body}\n\n${t('cargo_case_opened')} ${codes}` : body);
      onDone();
    } catch (e) {
      setError(errorMessage(e, t('action_failed')));
    } finally {
      setSaving(false);
    }
  };

  const title = out ? t('cargo_handover_title') : t('cargo_receive_title');

  if (signing) {
    return (
      <CargoScreen title={title} onClose={() => setSigning(false)} headerRight={headerRight}>
        <SignaturePad
          title={out ? t('cargo_taker_signature') : t('cargo_giver_signature')}
          hint={out ? t('cargo_taker_signature_hint') : t('cargo_giver_signature_hint')}
          onDone={(uri) => {
            setSignature(uri);
            setSigning(false);
          }}
          onCancel={() => setSigning(false)}
        />
      </CargoScreen>
    );
  }

  const blocked = waiting || alreadyOut;

  return (
    <CargoScreen
      title={title}
      subtitle={transfer.code}
      onClose={onClose}
      headerRight={headerRight}
      footer={
        <>
          <Button title={blocked ? t('close') : t('cancel')} variant="secondary" block={false} style={styles.action} onPress={onClose} disabled={saving} />
          {blocked ? null : (
            <Button
              title={out ? t('cargo_handover_save') : t('cargo_receive_save')}
              block={false}
              style={styles.action}
              onPress={submit}
              loading={saving}
            />
          )}
        </>
      }
    >
      <Card style={styles.card}>
        <Text variant="title">{out ? t('cargo_meeting_point') : t('cargo_transfer_from')}</Text>
        {out ? (
          <>
            {destination ? <Text variant="bodyMedium">{destination}</Text> : null}
            <Text variant="body">{transfer.meetAddress ?? (transfer.meet ? `${transfer.meet.lat.toFixed(5)}, ${transfer.meet.lng.toFixed(5)}` : t('cargo_meeting_unknown'))}</Text>
            {transfer.meet ? (
              <Button
                title={t('cargo_open_in_maps')}
                variant="secondary"
                onPress={openMaps}
                icon={(color) => <Ionicons name="navigate-outline" size={size.icon.md} color={color} />}
              />
            ) : null}
          </>
        ) : (
          <>
            <Text variant="bodyMedium">{transfer.fromPlate ? fill(t('cargo_from_vehicle'), { plate: transfer.fromPlate }) : t('cargo_from_other_vehicle')}</Text>
            {transfer.meetAddress ? <Text variant="body">{transfer.meetAddress}</Text> : null}
          </>
        )}
        {transfer.plannedAt ? (
          <Text variant="bodySmall" color="textMuted">
            {fill(t('cargo_planned_at'), { time: formatDateTime(transfer.plannedAt) })}
          </Text>
        ) : null}
        {transfer.exceptionCode ? (
          <Text variant="bodySmall" color="textMuted">
            {`${t('cargo_case')} ${transfer.exceptionCode}`}
          </Text>
        ) : null}
        {transfer.note ? <Text variant="bodySmall">{transfer.note}</Text> : null}
      </Card>

      {waiting ? <Banner tone="info" icon="time-outline" message={t('cargo_receive_waiting')} /> : null}
      {alreadyOut ? <Banner tone="info" icon="checkmark-circle-outline" message={t('cargo_handover_done_waiting')} /> : null}

      {blocked
        ? null
        : transfer.items.map((item) => {
            const c = countOf(item);
            const exp = expected(item);
            return (
              <Card key={refKey(item.ref)} style={styles.card}>
                <HandoverItemHead item={item} out={out} fromVehicleId={transfer.fromVehicleId} />
                <PieceCounter
                  label={out ? t('cargo_count_out') : t('cargo_count_in')}
                  value={c.pieces}
                  onChange={(pieces) => update(item, { pieces })}
                  // Transfers move whole consignments: never more than planned (or handed over)
                  max={exp ?? undefined}
                  hint={exp !== null ? fill(out ? t('cargo_pieces_planned') : t('cargo_pieces_handed'), { n: exp }) : undefined}
                />
                <ConditionPicker value={c.condition} onChange={(condition) => update(item, { condition })} />
              </Card>
            );
          })}

      {blocked ? null : (
        <Card style={styles.card}>
          <PhotoStrip label={t('cargo_handover_photos')} hint={t('cargo_photos_hint')} photos={photos} onChange={setPhotos} max={3} disabled={saving} />
          <SignatureBlock
            label={out ? t('cargo_taker_signature') : t('cargo_giver_signature_optional')}
            uri={signature}
            onSign={() => setSigning(true)}
            disabled={saving}
          />
        </Card>
      )}

      {blocked ? null : <DispatchNote reasons={notes} />}
      {error ? <ErrorBanner message={error} /> : null}
    </CargoScreen>
  );
}

/**
 * The pieces the handing-over vehicle held before a partial transfer split them: the moving lot
 * plus the lot that stays. The transfer does not repeat the split, so it is read from the lots: a
 * partial transfer makes the moving lot and, right after it (the next `seq`), the lot that stays
 * on the vehicle. Null when the item is a whole consignment (no such pair).
 */
function piecesBeforeSplit(item: TransferItem, family: LotFamily | null, fromVehicleId: string | null): number | null {
  if (!family || item.piecesPlanned === null || !fromVehicleId) return null;
  const moving = family.lots.find((l) => normalizeParcelCode(l.code) === normalizeParcelCode(item.code));
  if (!moving || moving.splitReason !== 'partial_transfer' || moving.seq === null) return null;
  const staying = family.lots.find(
    (l) => l.seq === moving.seq! + 1 && l.splitReason === 'partial_transfer' && l.holder === 'vehicle' && l.vehicleId === fromVehicleId,
  );
  return staying?.pieces != null ? item.piecesPlanned + staying.pieces : null;
}

/**
 * The item's code, lot and consignee, and for a partial transfer "Hand over 30 of 100 (lot C)":
 * only the moving lot is counted. The receiving driver sees only the lot that comes to them.
 */
function HandoverItemHead({ item, out, fromVehicleId }: { item: TransferItem; out: boolean; fromVehicleId: string | null }) {
  const { t } = useTranslation();
  const { family } = useLotFamily(out && item.lot.label ? item.code : null);
  const moving = out ? item.piecesPlanned : item.piecesOut ?? item.piecesPlanned;
  const before = out ? piecesBeforeSplit(item, family, fromVehicleId) : null;
  const label = item.lot.label;
  const line =
    moving === null || !label
      ? null
      : out
        ? before !== null
          ? fill(t('cargo_handover_part_of'), { n: moving, total: before, label })
          : fill(t('cargo_handover_lot'), { n: moving, label })
        : fill(t('cargo_receive_lot'), { n: moving, label });
  return (
    <>
      <LotLine code={item.code} pieces={moving} lot={item.lot} />
      {line ? <Text variant="bodyMedium">{line}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  action: { flex: 1 },
});
