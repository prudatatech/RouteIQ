import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  PanResponder,
  LayoutAnimation,
  type AccessibilityActionEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Button, Card, ScreenHeader, StatusPill, Text } from '../components/ui';
import { colors, radius, size, space } from '../theme';

/** Weight presets with the vehicle class usually used for them in India. */
const TRUCK_TIERS = [
  { id: '1', weight: 1.0, title: 'Light load', desc: 'Boxes, pallets, e-commerce', truck: 'Tata Ace / Chota Hathi' },
  { id: '2', weight: 2.5, title: 'Utility pickup', desc: 'Furniture, appliances, FMCG', truck: 'Mahindra Bolero Pickup' },
  { id: '3', weight: 4.5, title: 'Medium cargo', desc: 'Retail stock, machinery', truck: 'Eicher 14 ft (6 wheeler)' },
  { id: '4', weight: 9.0, title: 'Heavy freight', desc: 'Industrial raw materials', truck: 'Eicher 19 ft (6 wheeler)' },
  { id: '5', weight: 15.0, title: 'Full truckload', desc: 'Bulk haulage and steel', truck: 'Taurus (10 wheeler)' },
  { id: '6', weight: 21.0, title: 'Maximum payload', desc: 'Long-haul, heavy loads', truck: '32 ft multi-axle container' },
];

const MAX_WEIGHT_T = 25;
const SNAP_RANGE_T = 2.0;
const SLIDER_LABELS = ['0', '5 t', '10 t', '15 t', '25 t+'];

const getTierForWeight = (weight: number) => {
  if (weight <= 1.0) return 'Light';
  if (weight <= 2.5) return 'Utility';
  if (weight <= 9.0) return 'Medium';
  return 'Heavy';
};

const formatWeight = (tonnes: number, unit: 't' | 'kg') =>
  unit === 't' ? tonnes.toFixed(1) : Math.round(tonnes * 1000).toLocaleString();

export default function CargoConfigScreen({ navigation, route }: any) {
  const { pickupLocation, dropoffLocation, loadType } = route.params || {};

  const [selectedWeight, setSelectedWeight] = useState(TRUCK_TIERS[0].weight);
  const [unit, setUnit] = useState<'t' | 'kg'>('t');

  // Measured track position, used to turn a finger position into a weight.
  const trackRef = useRef<View>(null);
  const [track, setTrack] = useState({ x: 0, width: 0 });

  const measureTrack = () => {
    trackRef.current?.measureInWindow((x, _y, width) => setTrack({ x, width }));
  };

  const updateWeightFromRatio = useCallback((ratio: number) => {
    const raw = Math.max(0, Math.min(1, ratio)) * MAX_WEIGHT_T;
    let next = raw;
    let closestDiff = Number.POSITIVE_INFINITY;
    for (const tier of TRUCK_TIERS) {
      const diff = Math.abs(tier.weight - raw);
      if (diff < SNAP_RANGE_T && diff < closestDiff) {
        closestDiff = diff;
        next = tier.weight;
      }
    }
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
    if (next) setSelectedWeight(next.weight);
  };

  const suggestedTruck = TRUCK_TIERS.find((t) => t.weight === selectedWeight)?.truck;
  const fillPercent = `${(selectedWeight / MAX_WEIGHT_T) * 100}%` as const;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Cargo and weight" onBack={() => navigation.goBack()} backLabel="Back" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ROUTE */}
        <Card style={styles.routeCard}>
          {loadType ? <StatusPill label={loadType === 'part' ? 'Part load' : 'Full truck'} tone="neutral" /> : null}
          <View style={styles.routeRow}>
            <View style={styles.timeline}>
              <View style={styles.dotFilled} />
              <View style={styles.timelineLine} />
            </View>
            <View style={styles.flex}>
              <Text variant="caption" color="textMuted">
                Pickup
              </Text>
              <Text variant="bodyMedium" numberOfLines={2}>
                {pickupLocation || 'Not selected'}
              </Text>
            </View>
          </View>
          <View style={styles.routeRow}>
            <View style={styles.timeline}>
              <View style={styles.dotOutline} />
            </View>
            <View style={styles.flex}>
              <Text variant="caption" color="textMuted">
                Drop-off
              </Text>
              <Text variant="bodyMedium" numberOfLines={2}>
                {dropoffLocation || 'Not selected'}
              </Text>
            </View>
          </View>
        </Card>

        {/* WEIGHT */}
        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            Estimated weight of goods
          </Text>
          <Text variant="bodySmall" color="textMuted">
            Choose the approximate weight so the right size of vehicle can be matched.
          </Text>
        </View>

        <Card style={styles.weightCard}>
          <View style={styles.weightHeader}>
            <Text variant="captionMedium" color="textMuted">
              Gross weight
            </Text>
            <View style={styles.unitToggle} accessibilityRole="radiogroup" accessibilityLabel="Weight unit">
              {(['t', 'kg'] as const).map((u) => {
                const selected = unit === u;
                return (
                  <Pressable
                    key={u}
                    onPress={() => setUnit(u)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={u === 't' ? 'Tonnes' : 'Kilograms'}
                    style={[styles.unitBtn, selected && styles.unitBtnActive]}
                  >
                    <Text variant="captionMedium" color={selected ? 'onAccentFill' : 'textMuted'}>
                      {u === 't' ? 'Tonnes' : 'kg'}
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
            <StatusPill label={getTierForWeight(selectedWeight)} tone="accent" />
          </View>

          {/* SLIDER */}
          <View
            ref={trackRef}
            onLayout={measureTrack}
            style={styles.sliderTrack}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Estimated weight"
            accessibilityValue={{ text: `${formatWeight(selectedWeight, unit)} ${unit === 't' ? 'tonnes' : 'kilograms'}` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={onSliderAction}
          >
            <View style={[styles.sliderFill, { width: fillPercent }]} />
            <View style={[styles.sliderThumb, { left: fillPercent }]} />
            <View {...panResponder.panHandlers} style={styles.sliderTouchArea} />
          </View>
          <View style={styles.sliderLabels} importantForAccessibility="no-hide-descendants">
            {SLIDER_LABELS.map((label) => (
              <Text key={label} variant="caption" color="textMuted">
                {label}
              </Text>
            ))}
          </View>
        </Card>

        {/* PRESETS */}
        <Text variant="title" accessibilityRole="header">
          Common loads
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
                accessibilityLabel={`${tier.title}, ${tier.weight.toFixed(1)} tonnes, ${tier.desc}`}
              >
                <View style={styles.gridItemHeader}>
                  <Text variant="bodyMedium">{tier.weight.toFixed(1)} t</Text>
                  <View style={[styles.radioDot, isSelected && styles.radioDotActive]} />
                </View>
                <Text variant="bodySmallMedium">{tier.title}</Text>
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {tier.desc}
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
              Suggested vehicle
            </Text>
            <Text variant="bodyMedium">{suggestedTruck ?? 'Chosen after you confirm the weight'}</Text>
            <Text variant="caption" color="textMuted">
              For loads up to {Math.round(selectedWeight * 1000).toLocaleString()} kg
            </Text>
          </View>
        </Card>
      </ScrollView>

      {/* COMING SOON */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <Card style={styles.comingSoonCard}>
          <View style={styles.comingSoonHeader}>
            <View style={styles.comingSoonIconBox}>
              <Feather name="clock" size={size.icon.md} color={colors.accent} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyMedium">Online booking is coming soon</Text>
              <Text variant="bodySmall" color="textMuted">
                You can't book a shipment in the app yet. In the meantime, go back to Home to see what you can do today.
              </Text>
            </View>
          </View>
          <Button title="Back to Home" variant="secondary" onPress={() => navigation.goBack()} />
        </Card>
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
  comingSoonCard: { gap: space[3], backgroundColor: colors.surfaceSubtle },
  comingSoonHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  comingSoonIconBox: {
    width: size.control - space[2],
    height: size.control - space[2],
    borderRadius: radius.control,
    backgroundColor: colors.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
