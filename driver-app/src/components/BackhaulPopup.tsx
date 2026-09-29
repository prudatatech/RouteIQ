import { useTranslation } from '../hooks/useTranslation';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { api } from '../services/api';
import { Text } from './ui';
import { colors, elevation, radius, size, space } from '../theme';
import { formatINR } from '../utils/format';

interface BackhaulPopupProps {
  vehicleId: string;
  onDismiss: () => void;
  /** Distance from the bottom of the screen, to clear the tab bar. */
  bottomOffset?: number;
}

type PopupState = 'opening' | 'bidding' | 'matched' | 'no_match';

export default function BackhaulPopup({ vehicleId, onDismiss, bottomOffset = space[4] }: BackhaulPopupProps) {
  const { t } = useTranslation();
  const [popupState, setPopupState] = useState<PopupState>('opening');
  const [biddersCount, setBiddersCount] = useState(0);
  const [matchAmount, setMatchAmount] = useState<number | null>(null);
  const [windowId, setWindowId] = useState<string | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    // Short "letting transporters know" step before showing live bids.
    const timer = setTimeout(() => {
      setPopupState('bidding');
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const dismissLater = (ms: number) => timers.push(setTimeout(() => onDismissRef.current(), ms));

    const handleWinningBid = async (bidId: string) => {
      const { data: bid } = await supabase.from('capacity_bids').select('bid_amount').eq('id', bidId).single();
      // Row-level security may hide the bid from drivers; then no amount is shown.
      setMatchAmount(typeof bid?.bid_amount === 'number' ? bid.bid_amount : null);
      setPopupState('matched');
      dismissLater(5000);
    };

    // A window belongs to this search if it is open, or was opened a moment before the popup (the toggle
    // opens it first). An older closed window is history, not the answer to this search.
    const isCurrent = (w: { status?: string | null; opens_at: string }) =>
      w.status === 'open' || new Date(w.opens_at).getTime() >= mountedAt.current - 60_000

    const applyWindow = (w: { id: string; status?: string | null; opens_at: string; winning_bid_id?: string | null }) => {
      if (!isCurrent(w)) return;
      setWindowId(w.id);
      if (w.winning_bid_id) {
        handleWinningBid(w.winning_bid_id);
      } else if (w.status === 'closed' || w.status === 'cancelled') {
        // The window ended (time ran out, dispatch closed it, or the driver turned matching off) with no winner
        setPopupState('no_match');
        dismissLater(4000);
      }
    };

    // 1. Find the active window
    const fetchWindow = async () => {
      const { data } = await supabase
        .from('capacity_windows')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('opens_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) applyWindow(data);
    };

    fetchWindow();

    // 2. Subscribe to window changes (a new window, a win, or the window closing)
    const windowSub = supabase
      .channel(`window_updates_${vehicleId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'capacity_windows', filter: `vehicle_id=eq.${vehicleId}` },
        (payload) => {
          if (payload.new && 'id' in payload.new) applyWindow(payload.new as Parameters<typeof applyWindow>[0]);
        },
      )
      .subscribe();

    return () => {
      timers.forEach(clearTimeout);
      supabase.removeChannel(windowSub);
    };
  }, [vehicleId]);

  useEffect(() => {
    if (!windowId || popupState !== 'bidding') return;

    // 3. Poll for live bid counts
    const fetchBids = async () => {
      try {
        const data = await api.getWindowBidCount(windowId);
        setBiddersCount(data.count || 0);
      } catch (err) {
        // A missed poll is retried in 3 s.
      }
    };

    fetchBids();
    const interval = setInterval(fetchBids, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [windowId, popupState]);

  const borderColor =
    popupState === 'matched' ? colors.success : popupState === 'no_match' ? colors.border : colors.accentFill;

  return (
    <View style={[styles.container, { borderColor, bottom: bottomOffset }]}>
      {/* The search can run for a long time, so the driver can always put this away. */}
      <Pressable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel={t('close')}
        hitSlop={8}
        style={styles.close}
      >
        <Ionicons name="close" size={size.icon.md} color={colors.textMuted} />
      </Pressable>
      <View accessibilityLiveRegion="polite" accessibilityRole="summary" style={styles.messages}>
      {popupState === 'opening' && <Text variant="bodySmall">{t('backhaul_opening')}</Text>}

      {popupState === 'bidding' && (
        <View style={styles.body}>
          <Text variant="title">{t('backhaul_bidding')}</Text>
          <Text variant="bodySmall" color="textMuted">
            {biddersCount} {t('backhaul_bidders')}
          </Text>
        </View>
      )}

      {popupState === 'matched' && (
        <View style={styles.body}>
          <Text variant="title">
            {matchAmount !== null
              ? `${t('backhaul_matched_offer')} ${formatINR(matchAmount)}`
              : t('backhaul_offer_accepted')}
          </Text>
          <Text variant="bodySmall" color="textMuted">
            {t('backhaul_added_to_route')}
          </Text>
        </View>
      )}

      {popupState === 'no_match' && (
        <View style={styles.body}>
          <Text variant="title">{t('backhaul_no_match')}</Text>
          <Text variant="bodySmall" color="textMuted">
            {t('backhaul_no_match_desc')}
          </Text>
        </View>
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: space[4],
    right: space[4],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: size.border * 2,
    backgroundColor: colors.surface,
    ...elevation.sm,
  },
  body: { gap: space[1] },
  messages: { paddingRight: size.control },
  close: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: size.control,
    height: size.control,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
