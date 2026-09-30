/**
 * Return pickup: the driver collects goods going back to the sender (after a
 * refusal or the last failed attempt) from the consignee or a hub. The parcel
 * is scanned or typed, then the pieces, condition, photos and the signature of
 * whoever hands the goods back are recorded as a `return_pickup` custody event.
 */
import React, { useState, type ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useConsignmentInfo } from '../../hooks/useCargo';
import { manifestRefOfStop, type ConditionCode } from '../../services/cargo';
import { sendCustody } from '../../services/cargoActions';
import type { DriverRoute, LatLng } from '../../types/route';
import { fill } from '../../locales';
import { errorMessage } from '../../utils/errors';
import { normalizeParcelCode, stopsForCode } from '../../utils/parcel';
import CargoScreen from '../../components/cargo/CargoScreen';
import { ConditionPicker, DispatchNote, PhotoStrip, PieceCounter, SignatureBlock } from '../../components/cargo/CargoFields';
import ParcelScanner, { type ScanMethod } from '../../components/scan/ParcelScanner';
import SignaturePad from '../../components/modals/SignaturePad';
import { Banner, Button, Card, ErrorBanner, StatusPill, Text, TextField } from '../../components/ui';
import { space } from '../../theme';

interface ReturnPickupScreenProps {
  route: DriverRoute | undefined;
  currentLoc: LatLng | null;
  onClose: () => void;
  headerRight?: ReactNode;
}

export default function ReturnPickupScreen({ route, currentLoc, onClose, headerRight }: ReturnPickupScreenProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState<string | null>(null);
  const { info, loading, offline } = useConsignmentInfo(code);
  const [pieces, setPieces] = useState<number | null>(null);
  const [condition, setCondition] = useState<ConditionCode>('good');
  const [photos, setPhotos] = useState<string[]>([]);
  const [giver, setGiver] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const stop = code ? stopsForCode(route, code)[0] ?? null : null;
  const expected = info?.piecesTotal ?? null;
  const shownPieces = pieces ?? expected;
  const notes = [
    ...(shownPieces !== null && expected !== null && shownPieces < expected ? [fill(t('cargo_note_count'), { code: code ?? '', n: shownPieces, total: expected })] : []),
    ...(condition !== 'good' ? [t(`cargo_condition_${condition}`)] : []),
  ];

  const onScan = (value: string, _method: ScanMethod) => {
    setCode(normalizeParcelCode(value));
    setPieces(null);
    setError('');
  };

  const submit = async () => {
    if (!code) return setError(t('cargo_return_scan_first'));
    if (!shownPieces) return setError(t('cargo_pieces_required'));
    if (photos.length === 0) return setError(t('cargo_photo_required'));
    setError('');
    setSaving(true);
    try {
      const result = await sendCustody({
        label: 'return_pickup',
        photoUris: photos,
        signatureUri: signature,
        events: [
          {
            ref: info?.ref ?? manifestRefOfStop(stop?.id) ?? code,
            code,
            fields: {
              kind: 'return_pickup',
              pieces: shownPieces,
              condition,
              ...(giver.trim() ? { receiver_name: giver.trim() } : {}),
              ...(currentLoc ? { lat: currentLoc.lat, lng: currentLoc.lng } : {}),
            },
          },
        ],
      });
      const codes = result.exceptions.map((e) => e.code).join(', ');
      const body = result.queued ? t('queue_saved_desc') : t('cargo_return_saved');
      Alert.alert(result.queued ? t('queue_saved_title') : t('cargo_saved_title'), codes ? `${body}\n\n${t('cargo_case_opened')} ${codes}` : body);
      onClose();
    } catch (e) {
      setError(errorMessage(e, t('action_failed')));
    } finally {
      setSaving(false);
    }
  };

  if (signing) {
    return (
      <CargoScreen title={t('cargo_return_title')} onClose={() => setSigning(false)} headerRight={headerRight}>
        <SignaturePad
          title={t('cargo_giver_signature')}
          hint={t('cargo_giver_signature_hint')}
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
      title={t('cargo_return_title')}
      onClose={onClose}
      headerRight={headerRight}
      footer={
        <>
          <Button title={t('cancel')} variant="secondary" block={false} style={styles.action} onPress={onClose} disabled={saving} />
          <Button title={t('cargo_return_save')} block={false} style={styles.action} onPress={submit} loading={saving} disabled={!code} />
        </>
      }
    >
      <Text variant="bodySmall" color="textMuted">
        {t('cargo_return_intro')}
      </Text>

      <Card style={styles.card}>
        {code ? (
          <View style={styles.head}>
            <Text variant="monoMedium">{code}</Text>
            {info?.rto ? <StatusPill label={t('cargo_return_rto')} tone="warning" /> : null}
            <Button title={t('scan_another')} variant="ghost" onPress={() => setCode(null)} disabled={saving} />
          </View>
        ) : (
          <ParcelScanner onCode={onScan} height={200} />
        )}
        {code && loading ? (
          <Text variant="bodySmall" color="textMuted">
            {t('loading')}
          </Text>
        ) : null}
        {code && offline && !info ? <Banner tone="warning" icon="cloud-offline-outline" message={t('cargo_return_offline')} /> : null}
      </Card>

      {code ? (
        <Card style={styles.card}>
          <PieceCounter
            label={t('cargo_pieces')}
            value={shownPieces}
            onChange={setPieces}
            hint={expected !== null ? fill(t('cargo_pieces_expected'), { n: expected }) : t('cargo_pieces_count_hint')}
          />
          <ConditionPicker value={condition} onChange={setCondition} />
          <PhotoStrip label={t('cargo_handover_photos')} hint={t('cargo_photos_hint')} photos={photos} onChange={setPhotos} max={3} disabled={saving} />
          <TextField label={t('cargo_giver_name')} value={giver} onChangeText={setGiver} autoCapitalize="words" maxLength={100} />
          <SignatureBlock label={t('cargo_giver_signature_optional')} uri={signature} onSign={() => setSigning(true)} disabled={saving} />
        </Card>
      ) : null}

      <DispatchNote reasons={notes} />
      {error ? <ErrorBanner message={error} /> : null}
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  head: { gap: space[2], alignItems: 'flex-start' },
  action: { flex: 1 },
});
