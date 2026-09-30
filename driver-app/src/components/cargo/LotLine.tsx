/**
 * How a consignment is named on every cargo screen: its code with the pieces
 * (`RTX-ABC123-B · 25 pcs`), and for a lot of a split consignment the lot
 * label and the lot's own consignee. A consignment never split shows only its
 * code and pieces.
 */
import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { LotTag } from '../../services/cargo';
import { fill } from '../../locales';
import { StatusPill, Text } from '../ui';
import { space } from '../../theme';

/** `RTX-ABC123-B · 25 pcs`, or the code alone when the count is not known. */
export function lotCodeText(code: string, pieces: number | null | undefined, t: (key: string) => string): string {
  return pieces !== null && pieces !== undefined ? fill(t('cargo_lot_code_pieces'), { code, n: pieces }) : code;
}

interface LotLineProps {
  code: string;
  pieces?: number | null;
  lot?: LotTag | null;
  /** Shown at the right of the code (a status pill or a button). */
  trailing?: ReactNode;
  /** Hide the consignee (a screen that shows it elsewhere). */
  hideConsignee?: boolean;
}

export default function LotLine({ code, pieces, lot, trailing, hideConsignee }: LotLineProps) {
  const { t } = useTranslation();
  const consignee = !hideConsignee && lot?.consigneeName ? [lot.consigneeName, lot.consigneePhone].filter(Boolean).join(' · ') : null;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text variant="monoMedium" style={styles.flex}>
          {lotCodeText(code, pieces, t)}
        </Text>
        {lot?.label ? <StatusPill label={fill(t('cargo_lot_label'), { label: lot.label })} tone="info" /> : null}
        {trailing}
      </View>
      {consignee ? (
        <Text variant="bodySmall" color="textMuted">
          {fill(t('cargo_lot_consignee'), { name: consignee })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
});
