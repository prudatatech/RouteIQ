/**
 * Read-only: how dispatch split a consignment into lots, and where each lot
 * goes from here (GET /cargo/lots/:ref). At a hub it shows which lots stay and
 * which leave, on which truck or to which drop. The driver changes nothing
 * here; the split itself is made by dispatch or the hub staff.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import { useLotFamily } from '../../hooks/useCargo';
import type { LotRow } from '../../services/cargo';
import { fill } from '../../locales';
import { Button, OfflineBanner, Text } from '../ui';
import LotLine from './LotLine';
import { colors, size, space } from '../../theme';

type T = (key: string) => string;

/** Where one lot is going, in plain words. */
export function lotDestination(lot: LotRow, hubId: string | null, t: T): string {
  if (lot.status === 'delivered') return t('cargo_plan_delivered');
  if (lot.holder === 'vehicle' && lot.vehiclePlate) return fill(t('cargo_plan_on_vehicle'), { plate: lot.vehiclePlate });
  const drop = [lot.dropName, lot.dropAddress].filter(Boolean).join(', ');
  if (drop) return fill(t('cargo_plan_to_drop'), { drop });
  if (lot.holder === 'hub') {
    if (hubId && lot.depotId === hubId) return t('cargo_plan_stays_here');
    if (lot.depotName) return fill(t('cargo_plan_at_hub'), { hub: lot.depotName });
  }
  return t('cargo_plan_waiting');
}

interface LotPlanProps {
  code: string;
  /** The hub the driver is at, so its lots read "stays at this hub". */
  hubId: string | null;
  /** Show the refresh button (after the drop, while dispatch is splitting). */
  refreshable?: boolean;
}

export default function LotPlan({ code, hubId, refreshable }: LotPlanProps) {
  const { t } = useTranslation();
  const { family, loading, stale, refetch } = useLotFamily(code);

  if (loading) return <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />;
  if (!family) {
    return refreshable ? (
      <View style={styles.wrap}>
        <Text variant="bodySmall" color="textMuted">
          {t('cargo_plan_none')}
        </Text>
        <Button title={t('refresh')} variant="ghost" onPress={() => refetch()} />
      </View>
    ) : null;
  }

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <Text variant="bodySmallMedium">{fill(t('cargo_plan_title'), { code: family.masterCode ?? code })}</Text>
      {stale ? <OfflineBanner message={t('cargo_plan_offline')} /> : null}
      {family.lots.map((lot) => (
        <View key={lot.code} style={styles.lot}>
          <LotLine
            code={lot.code}
            pieces={lot.pieces}
            lot={{ label: lot.label, masterCode: family.masterCode, consigneeName: lot.consigneeName, consigneePhone: lot.consigneePhone }}
          />
          <Text variant="bodySmall">{lotDestination(lot, hubId, t)}</Text>
        </View>
      ))}
      {refreshable ? <Button title={t('refresh')} variant="ghost" onPress={() => refetch()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[2] },
  lot: { gap: space[1], paddingTop: space[2], borderTopWidth: size.border, borderTopColor: colors.border },
});
