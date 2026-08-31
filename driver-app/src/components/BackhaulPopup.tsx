import { useTranslation } from '../hooks/useTranslation';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { supabase } from '../services/supabase';
import { API_V1 } from '../config';

interface BackhaulPopupProps {
  vehicleId: string;
  onDismiss: () => void;
}

type PopupState = 'opening' | 'bidding' | 'matched' | 'no_match';

export default function BackhaulPopup({ vehicleId, onDismiss }: BackhaulPopupProps) {
  const { t } = useTranslation();
  const [popupState, setPopupState] = useState<PopupState>('opening');
  const [biddersCount, setBiddersCount] = useState(0);
  const [matchDetails, setMatchDetails] = useState<{ amount: number; route: string } | null>(null);
  const [windowId, setWindowId] = useState<string | null>(null);

  useEffect(() => {
    // Fake the 'opening' state for a brief moment
    const timer = setTimeout(() => {
      setPopupState('bidding');
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // 1. Find the active window
    const fetchWindow = async () => {
      const { data } = await supabase
        .from('capacity_windows')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('opens_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setWindowId(data.id);
        if (data.winning_bid_id) {
          handleWinningBid(data.winning_bid_id);
        } else if (data.fallback_used) {
          setPopupState('no_match');
          setTimeout(onDismiss, 4000);
        }
      }
    };

    fetchWindow();

    // 2. Subscribe to window updates
    const windowSub = supabase
      .channel(`window_updates_${vehicleId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'capacity_windows', filter: `vehicle_id=eq.${vehicleId}` },
        (payload) => {
          if (payload.new.winning_bid_id) {
            handleWinningBid(payload.new.winning_bid_id);
          } else if (payload.new.fallback_used) {
            setPopupState('no_match');
            setTimeout(onDismiss, 4000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(windowSub);
    };
  }, [vehicleId]);

  useEffect(() => {
    if (!windowId || popupState !== 'bidding') return;

    // 3. Poll for live bid counts
    const fetchBids = async () => {
      try {
        const res = await fetch(`${API_V1}/capacity/windows/${windowId}/bid-count`);
        if (res.ok) {
          const data = await res.json();
          setBiddersCount(data.count || 0);
        }
      } catch (err) {
        // Ignore network errors
      }
    };

    fetchBids();
    const interval = setInterval(fetchBids, 3000);

    return () => {
      clearInterval(interval);
    };
  }, [windowId, popupState]);

  const handleWinningBid = async (bidId: string) => {
    const { data: bid } = await supabase.from('capacity_bids').select('bid_amount').eq('id', bidId).single();
    // Due to RLS, bid might be null for drivers. We fallback to a generic message if so.
    setMatchDetails({ amount: bid?.bid_amount || 'Calculated', route: 'Added to your route' });
    setPopupState('matched');
    setTimeout(onDismiss, 5000);
  };

  const getTheme = () => {
    switch (popupState) {
      case 'opening': return { bg: '#FFFFFF', text: '#111827', border: '#27A150' };
      case 'bidding': return { bg: '#FFFFFF', text: '#111827', border: '#FF9933' };
      case 'matched': return { bg: '#FFFFFF', text: '#111827', border: '#27A150' };
      case 'no_match': return { bg: '#FFFFFF', text: '#6B7280', border: '#E5E7EB' };
    }
  };

  const theme = getTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme?.bg, borderColor: theme?.border }]}>
      {popupState === 'opening' && (
        <Text style={[styles.text, { color: theme.text }]}>Letting nearby transporters know you have space...</Text>
      )}

      {popupState === 'bidding' && (
        <View>
          <Text style={[styles.title, { color: theme.text }]}>Finding your best offer...</Text>
          <Text style={[styles.text, { color: theme.text }]}>{biddersCount} transporters interested</Text>
        </View>
      )}

      {popupState === 'matched' && (
        <View>
          <Text style={[styles.title, { color: theme.text }]}>
            Best offer accepted: {typeof matchDetails?.amount === 'number' ? `₹${matchDetails.amount}` : matchDetails?.amount}
          </Text>
          <Text style={[styles.text, { color: theme.text }]}>New stop: {matchDetails?.route}</Text>
        </View>
      )}

      {popupState === 'no_match' && (
        <View>
          <Text style={[styles.title, { color: theme.text }]}>No offers met your route right now.</Text>
          <Text style={[styles.text, { color: theme.text }]}>We'll keep watching.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    left: 20,
    right: 20,
    padding: 20,
    borderRadius: 16,
    borderWidth: 2,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
  },
  title: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
  },
  text: {
    fontSize: 14,
  }
});
