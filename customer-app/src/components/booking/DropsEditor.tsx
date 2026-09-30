import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button, Card, IconButton, Text, TextField } from '../ui';
import { colors, radius, size, space } from '../../theme';
import { MAX_DROPS, type BookingDrop } from '../../services/api';
import { useTranslation } from '../../hooks/useTranslation';

/** One drop being filled in: the place may not be chosen yet, and the numbers are still text. */
export interface DropDraft {
  id: string;
  address: string | null;
  coord: { latitude: number; longitude: number } | null;
  consigneeName: string;
  consigneePhone: string;
  pieces: string;
}

export const newDropId = () => `drop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** An Indian mobile number: 10 digits starting 6 to 9, with or without +91 / 0. */
const phoneDigits = (text: string) => text.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
export const validPhone = (text: string) => /^[6-9]\d{9}$/.test(phoneDigits(text));
const wholePieces = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

export interface DropsCheck {
  total: number | null;
  assigned: number;
  /** Pieces still to assign (negative: too many). Null until the total is typed. */
  balance: number | null;
  /** Each drop's problem, as a translation key, by drop id. */
  problems: Record<string, { place?: string; name?: string; phone?: string; pieces?: string }>;
  ok: boolean;
}

/** Checks the drops against the total pieces; the booking can go ahead only when everything balances. */
export function checkDrops(drops: DropDraft[], totalText: string): DropsCheck {
  const total = wholePieces(totalText);
  const problems: DropsCheck['problems'] = {};
  let assigned = 0;
  for (const d of drops) {
    const p: DropsCheck['problems'][string] = {};
    if (!d.address || !d.coord) p.place = 'drops_place_required';
    if (d.consigneeName.trim().length < 2) p.name = 'drops_name_required';
    if (!validPhone(d.consigneePhone)) p.phone = 'drops_phone_invalid';
    const pieces = wholePieces(d.pieces);
    if (!pieces || pieces < 1) p.pieces = 'drops_pieces_required';
    else assigned += pieces;
    if (Object.keys(p).length) problems[d.id] = p;
  }
  const balance = total !== null ? total - assigned : null;
  const count = drops.length >= 2 && drops.length <= MAX_DROPS;
  return { total, assigned, balance, problems, ok: count && total !== null && total > 0 && balance === 0 && Object.keys(problems).length === 0 };
}

/**
 * The drops as the booking sends them (the server's DropInputSchema). No weights: the server takes
 * them for every drop or none. Only call once checkDrops is ok.
 */
export function toBookingDrops(drops: DropDraft[]): BookingDrop[] {
  return drops.map((d) => ({
    // The place's name: the first part of the address, as the booking's pickup_name and drop_name
    name: d.address!.split(',')[0].trim() || null,
    address: d.address!,
    lat: d.coord!.latitude,
    lng: d.coord!.longitude,
    consignee_name: d.consigneeName.trim(),
    consignee_phone: phoneDigits(d.consigneePhone),
    pieces: Number(d.pieces.trim()),
  }));
}

interface Props {
  drops: DropDraft[];
  totalPieces: string;
  onTotalPieces: (text: string) => void;
  onChange: (id: string, patch: Partial<DropDraft>) => void;
  /** Opens the place search for this drop (not for the first: it was chosen on the home screen). */
  onPickPlace: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  /** Show the problems (after the customer tried to continue). */
  showErrors: boolean;
}

/**
 * Several drops for one booking: each with its place, the consignee's name and phone, and how
 * many pieces go there. The pieces are split from the total with a live balance, and the booking
 * can go ahead only when they add up.
 */
export function DropsEditor({ drops, totalPieces, onTotalPieces, onChange, onPickPlace, onAdd, onRemove, showErrors }: Props) {
  const { t } = useTranslation();
  const check = checkDrops(drops, totalPieces);
  const balance = check.balance;
  const balanceText =
    balance === null
      ? t('drops_balance_enter_total')
      : balance === 0
        ? t('drops_balance_ok')
        : balance > 0
          ? t('drops_balance_left', { n: balance })
          : t('drops_balance_over', { n: -balance });
  const balanceColor = balance === 0 ? 'success' : balance === null ? 'textMuted' : 'danger';

  return (
    <View style={styles.wrap}>
      <View style={styles.section}>
        <Text variant="title" accessibilityRole="header">
          {t('drops_title')}
        </Text>
        <Text variant="bodySmall" color="textMuted">
          {t('drops_hint')}
        </Text>
      </View>

      <Card style={styles.card}>
        <TextField
          label={t('drops_total_pieces')}
          value={totalPieces}
          onChangeText={(v) => onTotalPieces(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={6}
          hint={t('drops_total_pieces_hint')}
          error={showErrors && (check.total === null || check.total < 1) ? t('drops_total_required') : undefined}
        />
        <View style={styles.balance} accessibilityLiveRegion="polite">
          <Feather name={balance === 0 ? 'check-circle' : 'pie-chart'} size={size.icon.md} color={colors[balanceColor]} />
          <Text variant="bodySmallMedium" color={balanceColor}>
            {balanceText}
          </Text>
        </View>
      </Card>

      {drops.map((drop, index) => {
        const problem = showErrors ? check.problems[drop.id] ?? {} : {};
        const first = index === 0;
        return (
          <Card key={drop.id} style={styles.card}>
            <View style={styles.head}>
              <View style={styles.badge}>
                <Text variant="captionMedium" color="onAccentFill">
                  {index + 1}
                </Text>
              </View>
              <Text variant="bodyMedium" style={styles.flex}>
                {t('drops_drop_n', { n: index + 1 })}
              </Text>
              {!first ? (
                <IconButton
                  accessibilityLabel={t('drops_remove', { n: index + 1 })}
                  onPress={() => onRemove(drop.id)}
                  icon={(color) => <Feather name="trash-2" size={size.icon.md} color={color} />}
                />
              ) : null}
            </View>

            <Pressable
              disabled={first}
              onPress={() => onPickPlace(drop.id)}
              accessibilityRole="button"
              accessibilityState={{ disabled: first }}
              accessibilityLabel={drop.address ? `${t('dropoff')}: ${drop.address}` : t('drops_choose_place')}
              style={({ pressed }) => [styles.place, problem.place ? styles.placeError : null, pressed && styles.pressed]}
            >
              <Feather name="map-pin" size={size.icon.md} color={colors.accent} />
              <Text variant="bodyMedium" color={drop.address ? 'text' : 'textPlaceholder'} style={styles.flex} numberOfLines={2}>
                {drop.address ?? t('drops_choose_place')}
              </Text>
              {!first ? <Feather name="chevron-right" size={size.icon.md} color={colors.textMuted} /> : null}
            </Pressable>
            {problem.place ? (
              <Text variant="caption" color="danger">
                {t(problem.place)}
              </Text>
            ) : null}

            <TextField
              label={t('drops_consignee_name')}
              value={drop.consigneeName}
              onChangeText={(consigneeName) => onChange(drop.id, { consigneeName })}
              autoCapitalize="words"
              maxLength={120}
              error={problem.name ? t(problem.name) : undefined}
            />
            <TextField
              label={t('drops_consignee_phone')}
              value={drop.consigneePhone}
              onChangeText={(consigneePhone) => onChange(drop.id, { consigneePhone: consigneePhone.replace(/[^0-9+ ]/g, '') })}
              keyboardType="phone-pad"
              inputMode="tel"
              maxLength={16}
              error={problem.phone ? t(problem.phone) : undefined}
            />
            <TextField
              label={t('drops_pieces')}
              value={drop.pieces}
              onChangeText={(pieces) => onChange(drop.id, { pieces: pieces.replace(/[^0-9]/g, '') })}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={6}
              error={problem.pieces ? t(problem.pieces) : undefined}
            />
          </Card>
        );
      })}

      {drops.length < MAX_DROPS ? (
        <Button
          title={t('drops_add')}
          variant="secondary"
          onPress={onAdd}
          icon={(color) => <Feather name="plus" size={size.icon.md} color={color} />}
        />
      ) : (
        <Text variant="bodySmall" color="textMuted">
          {t('drops_max', { n: MAX_DROPS })}
        </Text>
      )}
    </View>
  );
}

const BADGE = 24;

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  section: { gap: space[1] },
  card: { gap: space[3] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: radius.full,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  balance: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: size.control,
    paddingHorizontal: space[3],
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  placeError: { borderColor: colors.danger },
  pressed: { opacity: 0.8 },
});
