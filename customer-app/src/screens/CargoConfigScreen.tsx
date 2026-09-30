import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  PanResponder,
  LayoutAnimation,
  type AccessibilityActionEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Card, ScreenHeader, StatusPill, Text, TextField } from '../components/ui';
import { colors, radius, size, space } from '../theme';
import { formatNumber } from '../utils/format';
import { useTranslation } from '../hooks/useTranslation';
import { DropsEditor, checkDrops, newDropId, toBookingDrops, type DropDraft } from '../components/booking/DropsEditor';
import { MAX_DROPS } from '../services/api';

/** The place search tags its answer with this prefix and the drop's id, so the home screen ignores it. */
const DROP_TARGET = 'drop:';

/** Weight presets with the vehicle class usually used for them in India. */
const TRUCK_TIERS = [
  { id: '1', weight: 1.0, title: 'tier1_title', desc: 'tier1_desc', truck: 'Tata Ace / Chota Hathi' },
  { id: '2', weight: 2.5, title: 'tier2_title', desc: 'tier2_desc', truck: 'Mahindra Bolero Pickup' },
  { id: '3', weight: 4.5, title: 'tier3_title', desc: 'tier3_desc', truck: 'Eicher 14 ft (6 wheeler)' },
  { id: '4', weight: 9.0, title: 'tier4_title', desc: 'tier4_desc', truck: 'Eicher 19 ft (6 wheeler)' },
  { id: '5', weight: 15.0, title: 'tier5_title', desc: 'tier5_desc', truck: 'Taurus (10 wheeler)' },
  { id: '6', weight: 21.0, title: 'tier6_title', desc: 'tier6_desc', truck: '32 ft multi-axle container' },
];

const MAX_WEIGHT_T = 25;
/** Smallest load that can be booked (100 kg); the slider and the typed weight share this range. */
const MIN_WEIGHT_T = 0.1;
const SNAP_RANGE_T = 2.0;
const SLIDER_MARKS_T = [0, 5, 10, 15, 25];
const sliderLabel = (tonnes: number, unit: 't' | 'kg') =>
  unit === 't' ? (tonnes === 0 ? '0' : `${tonnes} t${tonnes === MAX_WEIGHT_T ? '+' : ''}`) : formatNumber(tonnes * 1000);

const getTierKey = (weight: number) => {
  if (weight <= 1.0) return 'tier_light';
  if (weight <= 2.5) return 'tier_utility';
  if (weight <= 9.0) return 'tier_medium';
  return 'tier_heavy';
};

const formatWeight = (tonnes: number, unit: 't' | 'kg') =>
  unit === 't' ? tonnes.toFixed(1) : formatNumber(Math.round(tonnes * 1000));

/** The weight as plain digits for the text box: "4.5" tonnes or "4500" kg. */
const inputText = (tonnes: number, unit: 't' | 'kg') =>
  unit === 't' ? String(Math.round(tonnes * 1000) / 1000) : String(Math.round(tonnes * 1000));

/** Reads what was typed as tonnes, or null when it is not a number within the allowed range. */
function parseWeight(text: string, unit: 't' | 'kg'): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const tonnes = unit === 't' ? Number(cleaned) : Number(cleaned) / 1000;
  const kg = Math.round(tonnes * 1000);
  if (!Number.isFinite(tonnes) || kg < MIN_WEIGHT_T * 1000 || kg > MAX_WEIGHT_T * 1000) return null;
  return kg / 1000;
}

export default function CargoConfigScreen({ navigation, route }: any) {
  const { t } = useTranslation();
  const { pickupLocation, dropoffLocation, pickupCoord, dropoffCoord, loadType } = route.params || {};

  const [selectedWeight, setSelectedWeight] = useState(TRUCK_TIERS[0].weight);

  // More than one drop: each with its consignee and pieces (null keeps the single-drop booking as it was)
  const [drops, setDrops] = useState<DropDraft[] | null>(null);
  const [totalPieces, setTotalPieces] = useState('');
  const [showDropErrors, setShowDropErrors] = useState(false);
  const firstDrop = (): DropDraft => ({
    id: newDropId(),
    address: dropoffLocation ?? null,
    coord: dropoffCoord ?? null,
    consigneeName: '',
    consigneePhone: '',
    pieces: '',
  });
  const blankDrop = (): DropDraft => ({ id: newDropId(), address: null, coord: null, consigneeName: '', consigneePhone: '', pieces: '' });
  const addDrop = () => setDrops((cur) => (cur && cur.length >= MAX_DROPS ? cur : [...(cur ?? [firstDrop()]), blankDrop()]));
  const updateDrop = (id: string, patch: Partial<DropDraft>) => setDrops((cur) => cur && cur.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const removeDrop = (id: string) =>
    setDrops((cur) => {
      const rest = (cur ?? []).filter((d) => d.id !== id);
      return rest.length > 1 ? rest : null;
    });
  const pickDropPlace = (id: string) => navigation.navigate('LocationSearch', { type: 'dropoff', target: `${DROP_TARGET}${id}` });

  // A place chosen for one of the extra drops
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('locationSelected', (data) => {
      if (typeof data?.target !== 'string' || !data.target.startsWith(DROP_TARGET)) return;
      const id = data.target.slice(DROP_TARGET.length);
      setDrops((cur) => cur && cur.map((d) => (d.id === id ? { ...d, address: data.selectedLocation || null, coord: data.selectedCoord ?? null } : d)));
    });
    return () => sub.remove();
  }, []);
  const [unit, setUnit] = useState<'t' | 'kg'>('t');
  // What the customer is typing; null means show the slider's weight.
  const [draft, setDraft] = useState<string | null>(null);
  const draftWeight = draft === null ? null : parseWeight(draft, unit);
  const draftInvalid = draft !== null && draftWeight === null;

  // Measured track position, used to turn a finger position into a weight.
  const trackRef = useRef<View>(null);
  const [track, setTrack] = useState({ x: 0, width: 0 });

  const measureTrack = () => {
    trackRef.current?.measureInWindow((x, _y, width) => setTrack({ x, width }));
  };

  const updateWeightFromRatio = useCallback((ratio: number) => {
    const raw = Math.max(MIN_WEIGHT_T, Math.round(Math.max(0, Math.min(1, ratio)) * MAX_WEIGHT_T * 10) / 10);
    let next = raw;
    let closestDiff = Number.POSITIVE_INFINITY;
    for (const tier of TRUCK_TIERS) {
      const diff = Math.abs(tier.weight - raw);
      if (diff < SNAP_RANGE_T && diff < closestDiff) {
        closestDiff = diff;
        next = tier.weight;
      }
    }
    setDraft(null);
    setSelectedWeight((current) => {
      if (current === next) return current;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      return next;
    });
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: (_evt, g) => Math.abs(g.dx) > Math.abs(g.dy),
        onMoveShouldSetPanResponderCapture: (_evt, g) => Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderGrant: (evt) => {
          if (track.width > 0) updateWeightFromRatio(evt.nativeEvent.locationX / track.width);
        },
        onPanResponderMove: (_evt, g) => {
          if (track.width > 0) updateWeightFromRatio((g.moveX - track.x) / track.width);
        },
      }),
    [track, updateWeightFromRatio],
  );

  // Screen readers adjust the slider one preset at a time.
  const onSliderAction = (event: AccessibilityActionEvent) => {
    const next =
      event.nativeEvent.actionName === 'increment'
        ? TRUCK_TIERS.find((t) => t.weight > selectedWeight)
        : [...TRUCK_TIERS].reverse().find((t) => t.weight < selectedWeight);
    if (next) {
      setDraft(null);
      setSelectedWeight(next.weight);
    }
  };

  const onTypeWeight = (text: string) => {
    // Digits and one decimal point only; a comma counts as a point.
    const cleaned = text.replace(',', '.').replace(/[^0-9.]/g, '');
    const [whole, ...rest] = cleaned.split('.');
    const next = rest.length ? `${whole}.${rest.join('')}` : whole;
    setDraft(next);
    const parsed = parseWeight(next, unit);
    if (parsed !== null && parsed !== selectedWeight) setSelectedWeight(parsed);
  };

  const rangeText = {
    min: unit === 't' ? String(MIN_WEIGHT_T) : formatNumber(MIN_WEIGHT_T * 1000),
    max: unit === 't' ? String(MAX_WEIGHT_T) : formatNumber(MAX_WEIGHT_T * 1000),
    unit,
  };
  const suggestedTruck = TRUCK_TIERS.find((t) => t.weight === selectedWeight)?.truck;
  const fillPercent = `${(selectedWeight / MAX_WEIGHT_T) * 100}%` as const;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('cargo_title')} onBack={() => navigation.goBack()} backLabel={t('back')} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ROUTE */}
        <Card style={styles.routeCard}>
          {loadType ? <StatusPill label={loadType === 'part' ? t('load_part') : t('load_full')} tone="neutral" /> : null}
          <View style={styles.routeRow}>
            <View style={styles.timeline}>
              <View style={styles.dotFilled} />
              <View style={styles.timelineLine} />
            </View>
            <View style={styles.flex}>
              <Text variant="caption" color="textMuted">
                {t('pickup')}
              </Text>
              <Text variant="bodyMedium" numberOfLines={2}>
                {pickupLocation || t('not_selected')}
              </Text>
            </View>
          </View>
          <View style={styles.routeRow}>
            <View style={styles.timeline}>
              <View style={styles.dotOutline} />
            </View>
            <View style={styles.flex}>
              <Text variant="caption" color="textMuted">
                {t('dropoff')}
              </Text>
              <Text variant="bodyMedium" numberOfLines={2}>
                {dropoffLocation || t('not_selected')}
              </Text>
              {drops ? (
                <Text variant="caption" color="textMuted">
                  {t('drops_more_n', { n: drops.length })}
                </Text>
              ) : null}
            </View>
          </View>
        </Card>

        {/* WEIGHT */}
        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            {t('cargo_weight_title')}
          </Text>
          <Text variant="bodySmall" color="textMuted">
            {t('cargo_weight_hint')}
          </Text>
        </View>

        <Card style={styles.weightCard}>
          <View style={styles.weightHeader}>
            <Text variant="captionMedium" color="textMuted">
              {t('cargo_gross')}
            </Text>
            <View style={styles.unitToggle} accessibilityRole="radiogroup" accessibilityLabel={t('cargo_unit')}>
              {(['t', 'kg'] as const).map((u) => {
                const selected = unit === u;
                return (
                  <Pressable
                    key={u}
                    onPress={() => {
                      setUnit(u);
                      setDraft(null);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={u === 't' ? t('tonnes') : t('kilograms')}
                    style={[styles.unitBtn, selected && styles.unitBtnActive]}
                  >
                    <Text variant="captionMedium" color={selected ? 'onAccentFill' : 'textMuted'}>
                      {u === 't' ? t('tonnes') : 'kg'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.weightMainRow}>
            <View style={styles.weightValue}>
              <Text variant="display">{formatWeight(selectedWeight, unit)}</Text>
              <Text variant="title" color="textMuted">
                {unit === 't' ? 't' : 'kg'}
              </Text>
            </View>
            <StatusPill label={t(getTierKey(selectedWeight))} tone="accent" />
          </View>

          {/* SLIDER */}
          <View
            ref={trackRef}
            onLayout={measureTrack}
            style={styles.sliderTrack}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t('cargo_est_weight')}
            accessibilityValue={{ text: `${formatWeight(selectedWeight, unit)} ${unit === 't' ? t('tonnes') : t('kilograms')}` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={onSliderAction}
          >
            <View style={[styles.sliderFill, { width: fillPercent }]} />
            <View style={[styles.sliderThumb, { left: fillPercent }]} />
            <View {...panResponder.panHandlers} style={styles.sliderTouchArea} />
          </View>
          <View style={styles.sliderLabels} importantForAccessibility="no-hide-descendants">
            {SLIDER_MARKS_T.map((mark) => (
              <Text key={mark} variant="caption" color="textMuted">
                {sliderLabel(mark, unit)}
              </Text>
            ))}
          </View>

          {/* TYPED WEIGHT */}
          <TextField
            label={t(unit === 't' ? 'cargo_type_weight_t' : 'cargo_type_weight_kg')}
            value={draft ?? inputText(selectedWeight, unit)}
            onChangeText={onTypeWeight}
            keyboardType="decimal-pad"
            inputMode="decimal"
            selectTextOnFocus
            maxLength={8}
            hint={t('cargo_weight_range_hint', rangeText)}
            error={draftInvalid ? t('cargo_weight_range_error', rangeText) : undefined}
          />
        </Card>

        {/* PRESETS */}
        <Text variant="title" accessibilityRole="header">
          {t('cargo_common')}
        </Text>
        <View style={styles.grid} accessibilityRole="radiogroup">
          {TRUCK_TIERS.map((tier) => {
            const isSelected = selectedWeight === tier.weight;
            return (
              <Pressable
                key={tier.id}
                style={({ pressed }) => [styles.gridItem, isSelected && styles.gridItemActive, pressed && styles.pressed]}
                onPress={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setSelectedWeight(tier.weight);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${t(tier.title)}, ${tier.weight.toFixed(1)} ${t('tonnes')}, ${t(tier.desc)}`}
              >
                <View style={styles.gridItemHeader}>
                  <Text variant="bodyMedium">{tier.weight.toFixed(1)} t</Text>
                  <View style={[styles.radioDot, isSelected && styles.radioDotActive]} />
                </View>
                <Text variant="bodySmallMedium">{t(tier.title)}</Text>
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {t(tier.desc)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* SUGGESTED VEHICLE */}
        <Card style={styles.truckBanner}>
          <View style={styles.truckIconBox}>
            <Feather name="truck" size={size.icon.lg} color={colors.onAccentFill} />
          </View>
          <View style={styles.flex}>
            <Text variant="caption" color="textMuted">
              {t('cargo_suggested')}
            </Text>
            <Text variant="bodyMedium">{suggestedTruck ?? t('cargo_no_suggestion')}</Text>
            <Text variant="caption" color="textMuted">
              {t('cargo_up_to', { kg: formatNumber(Math.round(selectedWeight * 1000)) })}
            </Text>
          </View>
        </Card>

        {/* DROPS */}
        {drops ? (
          <DropsEditor
            drops={drops}
            totalPieces={totalPieces}
            onTotalPieces={setTotalPieces}
            onChange={updateDrop}
            onPickPlace={pickDropPlace}
            onAdd={addDrop}
            onRemove={removeDrop}
            showErrors={showDropErrors}
          />
        ) : (
          <Card style={styles.multiDrop}>
            <Text variant="bodyMedium">{t('drops_offer_title')}</Text>
            <Text variant="bodySmall" color="textMuted">
              {t('drops_offer_body')}
            </Text>
            <Button
              title={t('drops_add')}
              variant="secondary"
              onPress={addDrop}
              icon={(color) => <Feather name="plus" size={size.icon.md} color={color} />}
            />
          </Card>
        )}
      </ScrollView>

      {/* NEXT */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <Button
          title={t('cargo_see_price')}
          accessibilityHint={t('cargo_see_price_hint')}
          disabled={draftInvalid}
          onPress={() => {
            if (drops && !checkDrops(drops, totalPieces).ok) {
              setShowDropErrors(true);
              return;
            }
            navigation.navigate('Quote', {
              pickupLocation,
              dropoffLocation,
              pickupCoord,
              dropoffCoord,
              loadType: loadType ?? 'full',
              weightKg: Math.round(selectedWeight * 1000),
              vehicleType: suggestedTruck ?? null,
              ...(drops ? { drops: toBookingDrops(drops) } : {}),
            });
          }}
          icon={(color) => <Feather name="arrow-right" size={size.icon.md} color={color} />}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const DOT = 12;
const THUMB = 24;
const TRACK_HEIGHT = 6;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space[4], gap: space[4], paddingBottom: space[8] },
  flex: { flex: 1 },
  section: { gap: space[1] },
  multiDrop: { gap: space[2] },
  routeCard: { gap: space[2] },
  routeRow: { flexDirection: 'row', gap: space[3] },
  timeline: { width: DOT, alignItems: 'center', paddingTop: space[1] },
  dotFilled: { width: DOT, height: DOT, borderRadius: radius.full, backgroundColor: colors.accent },
  dotOutline: {
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  timelineLine: { flex: 1, width: 2, minHeight: space[6], backgroundColor: colors.border, marginTop: space[1] },
  weightCard: { gap: space[3] },
  weightHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.border,
    padding: 2,
  },
  unitBtn: {
    minHeight: size.control,
    minWidth: size.control,
    paddingHorizontal: space[3],
    borderRadius: radius.control - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitBtnActive: { backgroundColor: colors.accentFill },
  weightMainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weightValue: { flexDirection: 'row', alignItems: 'baseline', gap: space[1] },
  sliderTrack: {
    height: TRACK_HEIGHT,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    marginTop: space[4],
    marginBottom: space[2],
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accentFill,
    borderRadius: radius.full,
  },
  sliderThumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.full,
    backgroundColor: colors.accentFill,
    borderWidth: 4,
    borderColor: colors.surface,
    position: 'absolute',
    top: (TRACK_HEIGHT - THUMB) / 2,
    marginLeft: -THUMB / 2,
  },
  // Taller invisible area so the thin track is easy to drag.
  sliderTouchArea: { position: 'absolute', top: -space[4], bottom: -space[4], left: 0, right: 0 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space[3] },
  gridItem: {
    width: '48%',
    backgroundColor: colors.surface,
    borderWidth: size.border,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: space[4],
    gap: space[1],
  },
  gridItemActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.8 },
  gridItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space[1] },
  radioDot: {
    width: DOT,
    height: DOT,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  radioDotActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  truckBanner: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  truckIconBox: {
    width: size.control - space[2],
    height: size.control - space[2],
    borderRadius: radius.control,
    backgroundColor: colors.accentFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomBar: {
    backgroundColor: colors.surface,
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[3],
    gap: space[2],
    borderTopWidth: size.border,
    borderTopColor: colors.border,
  },
});
