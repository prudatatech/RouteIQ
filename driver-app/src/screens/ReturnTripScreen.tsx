import { useTranslation } from '../hooks/useTranslation';
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Switch } from 'react-native';
import { api } from '../services/api';

interface ReturnTripScreenProps {
  vehicleId: string;
  onClose: () => void;
}

export default function ReturnTripScreen({ vehicleId, onClose }: ReturnTripScreenProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [capacity, setCapacity] = useState<number>(0);
  const [biddingOpen, setBiddingOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    loadVehicleInfo();
  }, []);

  const loadVehicleInfo = async () => {
    try {
      setLoading(true);
      const vehicle = await api.getVehicleInfo(vehicleId);
      if (vehicle) {
        setCapacity(vehicle.available_capacity_kg ?? vehicle.capacity_kg);
        setBiddingOpen(vehicle.bidding_window_open || false);
      }
    } catch (error) {
      console.error('Failed to load vehicle info', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleMatching = async (val: boolean) => {
    try {
      setUpdating(true);
      await api.toggleBiddingWindow(vehicleId, val);
      setBiddingOpen(val);
      Alert.alert(val ? t('return_matching_enabled') : t('return_matching_disabled'), val ? t('return_searching_alert') : t('return_stopped_alert'));
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update matching status');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('return_title')}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>X</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t('return_avail_cap')}</Text>
        <Text style={styles.value}>{capacity} KG</Text>
        <Text style={styles.subtitle}>{t('return_cap_desc')}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{t('return_auto_match')}</Text>
            <Text style={styles.subtitle}>{t('return_auto_match_desc')}</Text>
          </View>
          <Switch
            value={biddingOpen}
            onValueChange={toggleMatching}
            disabled={updating}
            trackColor={{ false: '#D1D5DB', true: '#27A150' }}
            thumbColor={'#FFFFFF'}
          />
        </View>
      </View>

      {biddingOpen && (
        <View style={styles.searchingContainer}>
          <ActivityIndicator size="small" color="#10B981" />
          <Text style={styles.searchingText}>{t('return_searching')}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
        <Text style={styles.doneBtnText}>{t('done')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 20,
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
    marginTop: 40,
  },
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '800',
  },
  closeBtn: {
    backgroundColor: '#E5E7EB',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  value: {
    color: '#27A150',
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 8,
  },
  subtitle: {
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 20,
  },
  searchingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#27A150',
  },
  searchingText: {
    color: '#27A150',
    fontWeight: '700',
    marginLeft: 12,
  },
  doneBtn: {
    backgroundColor: '#27A150',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
