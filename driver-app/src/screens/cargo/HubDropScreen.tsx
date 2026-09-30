/**
 * Hub drop-off: the driver leaves consignments at a hub (a depot). For each
 * one dropped, a `hub_in` custody event with the hub, the pieces and their
 * condition; photos and the hub staff member's name and signature go with it.
 */
import React, { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../hooks/useTranslation';
import { useOnBoard } from '../../hooks/useCargo';
import { api } from '../../services/api';
import { readHubs, refKey, type ConditionCode, type OnBoardItem } from '../../services/cargo';
import { sendCustody } from '../../services/cargoActions';
import type { LatLng } from '../../types/route';
import { fill } from '../../locales';
import { errorMessage } from '../../utils/errors';
import CargoScreen from '../../components/cargo/CargoScreen';
import { ConditionPicker, DispatchNote, PhotoStrip, PieceCounter, SignatureBlock } from '../../components/cargo/CargoFields';
import SignaturePad from '../../components/modals/SignaturePad';
import { Button, Card, Chip, EmptyState, ErrorBanner, OfflineBanner, Text, TextField } from '../../components/ui';
import { colors, space } from '../../theme';

interface DropForm {
  selected: boolean;
  pieces: number | null;
  condition: ConditionCode;
}

interface HubDropScreenProps {
  currentLoc: LatLng | null;
  onClose: () => void;
  headerRight?: ReactNode;
}

export default function HubDropScreen({ currentLoc, onClose, headerRight }: HubDropScreenProps) {
  const { t } = useTranslation();
  const onBoard = useOnBoard(true);
  const hubs = useQuery({ queryKey: ['cargoHubs'], queryFn: async () => readHubs(await api.getCargoHubs()), staleTime: 5 * 60_000 });
  const [hubId, setHubId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, DropForm>>({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [staffName, setStaffName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const formOf = (item: OnBoardItem): DropForm => forms[refKey(item.ref)] ?? { selected: true, pieces: item.pieces, condition: 'good' };
  const update = (item: OnBoardItem, patch: Partial<DropForm>) =>
    setForms((cur) => ({ ...cur, [refKey(item.ref)]: { ...formOf(item), ...patch } }));
  const chosen = onBoard.items.filter((i) => formOf(i).selected);

  const notes = chosen.flatMap((item) => {
    const f = formOf(item);
    const reasons: string[] = [];
    if (f.pieces !== null && item.pieces !== null && f.pieces < item.pieces) reasons.push(fill(t('cargo_note_count'), { code: item.code, n: f.pieces, total: item.pieces }));
    if (f.condition !== 'good') reasons.push(`${item.code}: ${t(`cargo_condition_${f.condition}`)}`);
    return reasons;
  });

  const submit = async () => {
    if (!hubId) return setError(t('cargo_hub_required'));
    if (chosen.length === 0) return setError(t('cargo_hub_nothing_chosen'));
    for (const item of chosen) if (!formOf(item).pieces) return setError(fill(t('cargo_count_required'), { code: item.code }));
    if (photos.length === 0) return setError(t('cargo_photo_required'));
    if (staffName.trim().length < 3) return setError(t('cargo_hub_staff_required'));
    setError('');
    setSaving(true);
    try {
      const position = currentLoc ? { lat: currentLoc.lat, lng: currentLoc.lng } : {};
      const result = await sendCustody({
        label: 'hub_in',
        photoUris: photos,
        signatureUri: signature,
        events: chosen.map((item) => ({
          ref: item.ref,
          code: item.code,
          fields: {
            kind: 'hub_in' as const,
            depot_id: hubId,
            pieces: formOf(item).pieces ?? 0,
            condition: formOf(item).condition,
            receiver_name: staffName.trim(),
            ...position,
          },
        })),
      });
      const codes = result.exceptions.map((e) => e.code).join(', ');
      const body = result.queued ? t('queue_saved_desc') : t('cargo_hub_saved');
      Alert.alert(result.queued ? t('queue_saved_title') : t('cargo_saved_title'), codes ? `${body}\n\n${t('cargo_case_opened')} ${codes}` : body);
      onBoard.refetch();
      onClose();
    } catch (e) {
      setError(errorMessage(e, t('action_failed')));
    } finally {
      setSaving(false);
    }
  };

  if (signing) {
    return (
      <CargoScreen title={t('cargo_hub_title')} onClose={() => setSigning(false)} headerRight={headerRight}>
        <SignaturePad
          title={t('cargo_hub_staff_signature')}
          hint={t('cargo_hub_staff_signature_hint')}
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
      title={t('cargo_hub_title')}
      onClose={onClose}
      headerRight={headerRight}
      footer={
        <>
          <Button title={t('cancel')} variant="secondary" block={false} style={styles.action} onPress={onClose} disabled={saving} />
          <Button title={t('cargo_hub_save')} block={false} style={styles.action} onPress={submit} loading={saving} disabled={onBoard.items.length === 0} />
        </>
      }
    >
      <Card style={styles.card}>
        <Text variant="title">{t('cargo_hub_which')}</Text>
        {hubs.isLoading ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />
        ) : hubs.error ? (
          <ErrorBanner message={errorMessage(hubs.error, t('cargo_hubs_failed'))} action={{ label: t('retry'), onPress: () => hubs.refetch() }} />
        ) : (hubs.data ?? []).length === 0 ? (
          <Text variant="bodySmall" color="textMuted">
            {t('cargo_hubs_none')}
          </Text>
        ) : (
          <View style={styles.chips} accessibilityRole="radiogroup">
            {(hubs.data ?? []).map((hub) => (
              <Chip key={hub.id} label={hub.address ? `${hub.name} · ${hub.address}` : hub.name} selected={hubId === hub.id} onPress={() => setHubId(hub.id)} />
            ))}
          </View>
        )}
      </Card>

      {onBoard.stale ? <OfflineBanner message={t('cargo_on_board_offline')} /> : null}
      {onBoard.loading ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />
      ) : onBoard.items.length === 0 ? (
        <Card>
          <EmptyState title={t('cargo_on_board_empty')} message={t('cargo_on_board_empty_desc')} action={{ label: t('refresh'), onPress: () => onBoard.refetch() }} />
        </Card>
      ) : (
        onBoard.items.map((item) => {
          const f = formOf(item);
          return (
            <Card key={refKey(item.ref)} style={styles.card}>
              <View style={styles.head}>
                <Text variant="monoMedium" style={styles.flex}>
                  {item.code}
                </Text>
                <Chip label={f.selected ? t('cargo_hub_dropping') : t('cargo_hub_keeping')} selected={f.selected} onPress={() => update(item, { selected: !f.selected })} />
              </View>
              {f.selected ? (
                <>
                  <PieceCounter
                    label={t('cargo_pieces')}
                    value={f.pieces}
                    onChange={(pieces) => update(item, { pieces })}
                    hint={item.pieces !== null ? fill(t('cargo_pieces_expected'), { n: item.pieces }) : undefined}
                  />
                  <ConditionPicker value={f.condition} onChange={(condition) => update(item, { condition })} />
                </>
              ) : null}
            </Card>
          );
        })
      )}

      <Card style={styles.card}>
        <PhotoStrip label={t('cargo_handover_photos')} hint={t('cargo_photos_hint')} photos={photos} onChange={setPhotos} max={3} disabled={saving} />
        <TextField label={t('cargo_hub_staff_name')} value={staffName} onChangeText={setStaffName} autoCapitalize="words" maxLength={100} />
        <SignatureBlock label={t('cargo_hub_staff_signature')} uri={signature} onSign={() => setSigning(true)} disabled={saving} />
      </Card>

      <DispatchNote reasons={notes} />
      {error ? <ErrorBanner message={error} /> : null}
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  action: { flex: 1 },
});
