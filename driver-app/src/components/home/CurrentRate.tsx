import React, { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { supabase } from '../../services/supabase';
import { useTranslation } from '../../hooks/useTranslation';
import { Text } from '../ui';
import { colors, size, space } from '../../theme';

/**
 * Current market rate per km from system_settings, kept live with Realtime.
 * Renders nothing until a rate is known.
 */
export default function CurrentRate() {
  const { t } = useTranslation();
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'rate_per_km')
      .single()
      .then(({ data }) => {
        if (data?.value?.rate) setRate(data.value.rate);
      });

    const channel = supabase
      .channel('driver_system_settings')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'system_settings', filter: "key=eq.'rate_per_km'" },
        (payload) => {
          if (payload.new?.value?.rate) setRate(payload.new.value.rate);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (!rate) return null;

  return (
    <View style={styles.row} accessible accessibilityLabel={`${t('current_rate')}: ₹${rate} ${t('per_km')}`}>
      <Ionicons name="pricetag-outline" size={size.icon.sm} color={colors.textMuted} />
      <Text variant="bodySmall" color="textMuted">
        {t('current_rate')}:{' '}
        <Text variant="bodySmallMedium">
          ₹{rate} {t('per_km')}
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
