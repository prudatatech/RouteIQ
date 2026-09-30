/**
 * "Cargo on board" check after an accident or breakdown: for each consignment
 * on the vehicle, the count, the condition with damage photos, and whether the
 * seal is intact. Each is recorded as an `inspection` custody event, which
 * feeds the case dispatch opened; the case codes are shown to the driver.
 * Works from the phone's last copy of the on-board list when there is no signal.
 */
import React, { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useOnBoard } from '../../hooks/useCargo';
import { refKey, type ConditionCode, type ExceptionNotice, type OnBoardItem } from '../../services/cargo';
import { sendCustody } from '../../services/cargoActions';
import type { LatLng } from '../../types/route';
import { fill } from '../../locales';
import { errorMessage } from '../../utils/errors';
import CargoScreen from '../../components/cargo/CargoScreen';
import { ConditionPicker, DispatchNote, PhotoStrip, PieceCounter, YesNo } from '../../components/cargo/CargoFields';
import { Banner, Button, Card, EmptyState, ErrorBanner, OfflineBanner, Text } from '../../components/ui';
import { colors, space } from '../../theme';

interface ItemCheck {
  pieces: number | null;
  condition: ConditionCode;
  photos: string[];
  sealOk: boolean | null;
}

interface CargoCheckScreenProps {
  currentLoc: LatLng | null;
  onClose: () => void;
  headerRight?: ReactNode;
}

export default function CargoCheckScreen({ currentLoc, onClose, headerRight }: CargoCheckScreenProps) {
  const { t } = useTranslation();
  const onBoard = useOnBoard(true);
  const [checks, setChecks] = useState<Record<string, ItemCheck>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ queued: boolean; exceptions: ExceptionNotice[] } | null>(null);

  const checkOf = (item: OnBoardItem): ItemCheck =>
    checks[refKey(item.ref)] ?? { pieces: item.pieces, condition: 'good', photos: [], sealOk: item.sealNumber ? null : true };
  const update = (item: OnBoardItem, patch: Partial<ItemCheck>) =>
    setChecks((cur) => ({ ...cur, [refKey(item.ref)]: { ...checkOf(item), ...patch } }));

  // Cases dispatch already has open for this cargo (opened from the SOS)
  const openCases = onBoard.items.flatMap((i) => i.exceptions);
  const caseCodes = [...new Set([...openCases, ...(done?.exceptions ?? [])].map((e) => e.code))];

  const notes = onBoard.items.flatMap((item) => {
    const c = checkOf(item);
    const reasons: string[] = [];
    if (c.pieces !== null && item.pieces !== null && c.pieces !== item.pieces) {
      reasons.push(fill(t('cargo_note_count'), { code: item.code, n: c.pieces, total: item.pieces }));
    }
    if (c.condition !== 'good') reasons.push(`${item.code}: ${t(`cargo_condition_${c.condition}`)}`);
    if (c.sealOk === false) reasons.push(`${item.code}: ${t('cargo_seal_broken')}`);
    return reasons;
  });

  const submit = async () => {
    for (const item of onBoard.items) {
      const c = checkOf(item);
      if (c.pieces === null) return setError(fill(t('cargo_count_required'), { code: item.code }));
      if (item.sealNumber && c.sealOk === null) return setError(fill(t('cargo_seal_answer_required'), { code: item.code }));
      if (c.condition !== 'good' && c.photos.length === 0) return setError(fill(t('cargo_damage_photo_required_for'), { code: item.code }));
    }
    setError('');
    setSaving(true);
    try {
      const position = currentLoc ? { lat: currentLoc.lat, lng: currentLoc.lng } : {};
      const result = await sendCustody({
        label: 'inspection',
        photoUris: [],
        events: onBoard.items.map((item) => {
          const c = checkOf(item);
          // The server compares the seal read now with the one recorded at pickup: an intact seal
          // is sent as that number, and a broken one as the seal_tampered condition (a seal case).
          const condition: ConditionCode = c.sealOk === false && c.condition === 'good' ? 'seal_tampered' : c.condition;
          return {
            ref: item.ref,
            code: item.code,
            photoUris: c.photos,
            fields: {
              kind: 'inspection' as const,
              pieces: c.pieces ?? 0,
              condition,
              ...(item.sealNumber && c.sealOk === true ? { seal_number: item.sealNumber } : {}),
              ...position,
            },
          };
        }),
      });
      setDone({ queued: result.queued, exceptions: result.exceptions });
      if (!result.queued) onBoard.refetch();
    } catch (e) {
      setError(errorMessage(e, t('action_failed')));
    } finally {
      setSaving(false);
    }
  };

  const footer = done ? (
    <Button title={t('close')} onPress={onClose} />
  ) : (
    <>
      <Button title={t('cancel')} variant="secondary" block={false} style={styles.action} onPress={onClose} disabled={saving} />
      <Button
        title={t('cargo_check_save')}
        block={false}
        style={styles.action}
        onPress={submit}
        loading={saving}
        disabled={onBoard.items.length === 0}
      />
    </>
  );

  return (
    <CargoScreen title={t('cargo_check_title')} onClose={onClose} headerRight={headerRight} footer={footer}>
      {caseCodes.length ? (
        <Banner tone="info" icon="briefcase-outline" message={`${t('cargo_case_opened')} ${caseCodes.join(', ')}`} />
      ) : null}

      {done ? (
        <Card style={styles.card}>
          <Text variant="title">{done.queued ? t('queue_saved_title') : t('cargo_check_saved_title')}</Text>
          <Text variant="body">{done.queued ? t('queue_saved_desc') : t('cargo_check_saved_desc')}</Text>
        </Card>
      ) : onBoard.loading ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />
      ) : onBoard.items.length === 0 ? (
        <Card>
          <EmptyState
            title={t('cargo_on_board_empty')}
            message={onBoard.error ? errorMessage(onBoard.error, t('cargo_on_board_failed')) : t('cargo_on_board_empty_desc')}
            action={{ label: t('refresh'), onPress: () => onBoard.refetch() }}
          />
        </Card>
      ) : (
        <>
          <Text variant="bodySmall" color="textMuted">
            {t('cargo_check_intro')}
          </Text>
          {onBoard.stale ? <OfflineBanner message={t('cargo_on_board_offline')} /> : null}
          {onBoard.items.map((item) => {
            const c = checkOf(item);
            return (
              <Card key={refKey(item.ref)} style={styles.card}>
                <View style={styles.head}>
                  <Text variant="monoMedium">{item.code}</Text>
                  {item.stopName ? (
                    <Text variant="caption" color="textMuted">
                      {item.stopName}
                    </Text>
                  ) : null}
                </View>
                <PieceCounter
                  label={t('cargo_count_now')}
                  value={c.pieces}
                  onChange={(pieces) => update(item, { pieces })}
                  hint={item.pieces !== null ? fill(t('cargo_pieces_expected'), { n: item.pieces }) : undefined}
                />
                <ConditionPicker value={c.condition} onChange={(condition) => update(item, { condition })} />
                {c.condition !== 'good' ? (
                  <PhotoStrip label={t('cargo_damage_photos')} photos={c.photos} onChange={(photos) => update(item, { photos })} max={3} disabled={saving} />
                ) : null}
                {item.sealNumber ? (
                  <YesNo label={fill(t('cargo_seal_intact_q'), { seal: item.sealNumber })} value={c.sealOk} onChange={(sealOk) => update(item, { sealOk })} />
                ) : null}
              </Card>
            );
          })}
          <DispatchNote reasons={notes} />
        </>
      )}
      {error ? <ErrorBanner message={error} /> : null}
    </CargoScreen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  head: { gap: space[1] },
  action: { flex: 1 },
});
