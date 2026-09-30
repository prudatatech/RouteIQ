import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../../hooks/useTranslation';
import type { VehicleTransfer } from '../../hooks/useCargo';
import { fill } from '../../locales';
import { Button, Card, StatusPill, Text } from '../ui';
import LotLine from '../cargo/LotLine';
import { colors, size, space } from '../../theme';

interface CargoTransfersCardProps {
  transfers: VehicleTransfer[];
  onOpen: (transfer: VehicleTransfer) => void;
}

/** Transfers dispatch planned for this vehicle: goods to hand over, or to receive. */
export default function CargoTransfersCard({ transfers, onOpen }: CargoTransfersCardProps) {
  const { t } = useTranslation();
  if (transfers.length === 0) return null;
  return (
    <Card style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.head}>
        <Ionicons name="swap-horizontal" size={size.icon.lg} color={colors.warning} />
        <Text variant="title" style={styles.flex} accessibilityRole="header">
          {t('cargo_transfers_title')}
        </Text>
      </View>
      {transfers.map((vt) => {
        const { transfer, direction } = vt;
        const out = direction === 'out';
        const other = out
          ? transfer.toPlate
            ? fill(t('cargo_transfer_to_vehicle'), { plate: transfer.toPlate })
            : transfer.depotName
              ? fill(t('cargo_transfer_to_hub'), { hub: transfer.depotName })
              : null
          : transfer.fromPlate
            ? fill(t('cargo_from_vehicle'), { plate: transfer.fromPlate })
            : null;
        const ready = out ? transfer.status === 'planned' : transfer.status === 'in_progress';
        return (
          <View key={transfer.id} style={styles.item}>
            <View style={styles.row}>
              <Text variant="monoMedium" style={styles.flex}>
                {transfer.code}
              </Text>
              <StatusPill label={t(`cargo_transfer_status_${transfer.status}`)} tone={transfer.status === 'in_progress' ? 'accent' : 'warning'} />
            </View>
            {other ? <Text variant="bodyMedium">{other}</Text> : null}
            {transfer.meetAddress ? (
              <Text variant="bodySmall" color="textMuted">
                {transfer.meetAddress}
              </Text>
            ) : null}
            {transfer.items.length > 0 ? (
              transfer.items.map((item) => (
                <LotLine
                  key={item.code}
                  code={item.code}
                  pieces={out ? item.piecesPlanned : item.piecesOut ?? item.piecesPlanned}
                  lot={item.lot}
                />
              ))
            ) : (
              <Text variant="bodySmall" color="textMuted">
                {fill(t('cargo_n_consignments'), { n: transfer.items.length })}
              </Text>
            )}
            <Button
              title={out ? t('cargo_handover_title') : t('cargo_receive_title')}
              variant={ready ? 'primary' : 'secondary'}
              onPress={() => onOpen(vt)}
            />
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  item: { gap: space[1], paddingTop: space[2], borderTopWidth: size.border, borderTopColor: colors.border },
});
