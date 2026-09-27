import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  StatusBar,
  Dimensions,
  PanResponder,
  LayoutAnimation,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

const COLORS = {
  background: '#F6F5F0',
  cardBg: '#FFFFFF',
  primaryDark: '#1A2F2D',
  primaryGreen: '#10B981',
  textMain: '#111827',
  textMuted: '#6B7280',
  border: '#E5E7EB',
  accentLight: '#E0F2FE', // light blue
  accentGreenLight: '#D1FAE5', // light green
};

const TRUCK_TIERS = [
  { id: '1', weight: 1.0, title: 'Light Load', desc: 'Boxes, pallets, eCommerce', truck: 'Tata Ace / Chota Hathi' },
  { id: '2', weight: 2.5, title: 'Utility Pickup', desc: 'Furniture, appliances, FMCG', truck: 'Mahindra Bolero Pickup' },
  { id: '3', weight: 4.5, title: 'Medium Cargo', desc: 'Retail inventory, machinery', truck: 'Eicher 14ft (6 Wheeler)' },
  { id: '4', weight: 9.0, title: 'Heavy Freight', desc: 'Industrial raw materials', truck: 'Eicher 19ft (6 Wheeler)' },
  { id: '5', weight: 15.0, title: 'Full Truckload', desc: 'Bulk haulage & steel', truck: 'Taurus (10 Wheeler)' },
  { id: '6', weight: 21.0, title: 'Max Payload', desc: 'Long-haul, heavy logistics', truck: '32ft Multi-Axle Container' },
];

export default function CargoConfigScreen({ navigation, route }: any) {
  const { pickupLocation, dropoffLocation } = route.params || {};
  
  const [selectedWeight, setSelectedWeight] = useState(1.0);
  const [unit, setUnit] = useState<'t' | 'kg'>('t');
  
  const TRACK_WIDTH = Dimensions.get('window').width - 96; // Full width minus paddings

  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (evt, gestureState) => Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
      
      onPanResponderGrant: (evt) => {
        const rawX = evt.nativeEvent.locationX;
        const newPercentage = Math.max(0, Math.min(1, rawX / TRACK_WIDTH));
        updateWeightFromPercentage(newPercentage);
      },
      onPanResponderMove: (evt, gestureState) => {
        // moveX is the absolute X on screen. Subtract 48 (padding of container + card)
        const currentX = Math.max(0, Math.min(TRACK_WIDTH, gestureState.moveX - 48));
        const newPercentage = currentX / TRACK_WIDTH;
        updateWeightFromPercentage(newPercentage);
      },
    })
  ).current;

  const updateWeightFromPercentage = (percentage: number) => {
    const newWeight = percentage * 25; 
    let snappedWeight = newWeight;
    let closestDiff = 999;
    
    TRUCK_TIERS.forEach(tier => {
      const diff = Math.abs(tier.weight - newWeight);
      if (diff < 2.0) {
        if (diff < closestDiff) {
          closestDiff = diff;
          snappedWeight = tier.weight;
        }
      }
    });
    
    if (snappedWeight !== selectedWeight) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setSelectedWeight(snappedWeight);
    }
  };

  const getTierForWeight = (weight: number) => {
    if (weight <= 1.0) return 'Light Logistics';
    if (weight <= 2.5) return 'Utility Transit';
    if (weight <= 9.0) return 'Medium Freight';
    return 'Heavy Transport';
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <Feather name="chevron-left" size={24} color={COLORS.primaryDark} />
        </TouchableOpacity>
        
        <View style={styles.headerTitles}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot} />
            <Text style={styles.brandText}>MARGIX LOGISTICS</Text>
          </View>
          <Text style={styles.headerTitle}>Cargo & Weight Config</Text>
        </View>
        
        <TouchableOpacity style={styles.iconBtn}>
          <Feather name="help-circle" size={20} color={COLORS.primaryDark} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        
        {/* ROUTE CARD */}
        <View style={styles.routeCard}>
          <View style={styles.routeTimeline}>
            {/* Pickup */}
            <View style={styles.routeRow}>
              <View style={styles.timelineGraphic}>
                <View style={[styles.dotOutline, { borderColor: COLORS.primaryGreen }]}>
                  <View style={[styles.dotInner, { backgroundColor: COLORS.primaryGreen }]} />
                </View>
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.routeTextContainer}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.locationTitle} numberOfLines={1}>
                    {pickupLocation ? pickupLocation.split(',')[0] : 'Pickup Location'}
                  </Text>
                  <View style={styles.badgePickup}>
                    <Text style={styles.badgePickupText}>PICKUP</Text>
                  </View>
                </View>
                <Text style={styles.locationSub} numberOfLines={1}>{pickupLocation || 'Select location'}</Text>
              </View>
              <TouchableOpacity style={styles.editBtn}>
                <Feather name="edit-2" size={14} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Dropoff */}
            <View style={styles.routeRow}>
              <View style={styles.timelineGraphic}>
                <View style={[styles.dotOutline, { borderColor: '#EF4444' }]}>
                  <View style={[styles.dotInner, { backgroundColor: '#EF4444' }]} />
                </View>
              </View>
              <View style={styles.routeTextContainer}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.locationTitle} numberOfLines={1}>
                    {dropoffLocation ? dropoffLocation.split(',')[0] : 'Drop-off Location'}
                  </Text>
                  <View style={styles.badgeDrop}>
                    <Text style={styles.badgeDropText}>DROP-OFF</Text>
                  </View>
                </View>
                <Text style={styles.locationSub} numberOfLines={1}>{dropoffLocation || 'Select location'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.routeActions}>
            <TouchableOpacity style={styles.actionBtn}>
              <Feather name="plus" size={14} color={COLORS.primaryDark} />
              <Text style={styles.actionBtnText}>Add Stop</Text>
            </TouchableOpacity>
            <View style={styles.actionDivider} />
            <TouchableOpacity style={styles.actionBtn}>
              <Feather name="users" size={14} color={COLORS.primaryDark} />
              <Text style={styles.actionBtnText}>Loading Crew</Text>
            </TouchableOpacity>
            <View style={styles.actionDivider} />
            <View style={styles.etaContainer}>
              <Feather name="clock" size={12} color={COLORS.textMuted} />
              <Text style={styles.etaText}>Calc. route...</Text>
            </View>
          </View>
        </View>

        {/* PROGRESS INDICATOR */}
        <View style={styles.progressRow}>
          <Text style={styles.progressText}>
            <Text style={{ fontWeight: '700', color: COLORS.primaryDark }}>STEP 2 OF 4</Text> · Weight & Fleet Allocation
          </Text>
          <View style={styles.progressDots}>
            <View style={[styles.progDot, styles.progDotActive, { width: 16 }]} />
            <View style={[styles.progDot, styles.progDotActive, { width: 16 }]} />
            <View style={styles.progDot} />
            <View style={styles.progDot} />
          </View>
        </View>

        {/* BOTTOM SHEET SIMULATION */}
        <View style={styles.bottomSheet}>
          <View style={styles.sheetDragHandle} />
          
          <Text style={styles.sheetTitle}>Estimated Goods Weight</Text>
          <Text style={styles.sheetSubtitle}>
            Precision weight matches optimal chassis & zero overload penalty
          </Text>

          {/* WEIGHT DISPLAY CARD */}
          <View style={styles.weightCard}>
            <View style={styles.weightHeader}>
              <View style={styles.grossPayloadRow}>
                <View style={styles.brandDot} />
                <Text style={styles.grossPayloadText}>GROSS PAYLOAD</Text>
              </View>
              <View style={styles.unitToggle}>
                <TouchableOpacity 
                  style={[styles.unitBtn, unit === 't' && styles.unitBtnActive]}
                  onPress={() => setUnit('t')}
                >
                  <Text style={[styles.unitBtnText, unit === 't' && styles.unitBtnTextActive]}>Tons (t)</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.unitBtn, unit === 'kg' && styles.unitBtnActive]}
                  onPress={() => setUnit('kg')}
                >
                  <Text style={[styles.unitBtnText, unit === 'kg' && styles.unitBtnTextActive]}>kg</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.weightMainRow}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={styles.weightHugeText}>
                  {unit === 't' ? selectedWeight.toFixed(1) : (selectedWeight * 1000).toLocaleString()}
                </Text>
                <Text style={styles.weightUnitText}>{unit === 't' ? 'TON' : 'KG'}</Text>
              </View>
              <View style={styles.tierBadge}>
                <View style={[styles.brandDot, { backgroundColor: COLORS.primaryGreen }]} />
                <Text style={styles.tierBadgeText}>{getTierForWeight(selectedWeight)}</Text>
              </View>
            </View>

            <Text style={styles.approxText}>Approx. ~{(selectedWeight * 1000).toLocaleString()} kg</Text>

            {/* INTERACTIVE SLIDER */}
            <View style={styles.sliderTrack}>
              <View style={[styles.sliderFill, { width: `${(selectedWeight / 25) * 100}%` }]} />
              <View style={[styles.sliderThumb, { left: `${(selectedWeight / 25) * 100}%` }]} />
              
              {/* Invisible touch overlay for PanResponder */}
              <View 
                {...panResponder.panHandlers}
                style={{ position: 'absolute', top: -20, bottom: -20, left: 0, right: 0, backgroundColor: 'transparent' }} 
              />
            </View>
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>0.5t</Text>
              <Text style={styles.sliderLabel}>5.0t</Text>
              <Text style={styles.sliderLabel}>10t</Text>
              <Text style={styles.sliderLabel}>15t</Text>
              <Text style={styles.sliderLabel}>25t+</Text>
            </View>
          </View>

          {/* PRESETS GRID */}
          <View style={styles.presetsHeaderRow}>
            <Text style={styles.presetsTitle}>Quick Preset Categories</Text>
            <TouchableOpacity>
              <Text style={styles.viewGuideText}>View Tier Guide</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.gridContainer}>
            {TRUCK_TIERS.map((tier) => {
              const isSelected = selectedWeight === tier.weight;
              return (
                <TouchableOpacity 
                  key={tier.id}
                  style={[styles.gridItem, isSelected && styles.gridItemActive]}
                  onPress={() => {
                    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                    setSelectedWeight(tier.weight);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.gridItemHeader}>
                    <Text style={styles.gridWeightText}>{tier.weight.toFixed(1)} t</Text>
                    <View style={[styles.radioDot, isSelected && styles.radioDotActive]} />
                  </View>
                  <Text style={styles.gridTitleText}>{tier.title}</Text>
                  <Text style={styles.gridDescText} numberOfLines={1}>{tier.desc}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* BOTTOM TRUCK INFO BANNER */}
          <View style={styles.truckBanner}>
            <View style={styles.truckIconBox}>
              <MaterialCommunityIcons name="truck-outline" size={24} color="#FFFFFF" />
            </View>
            <View style={styles.truckBannerText}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Text style={styles.truckBannerTitle}>
                  {TRUCK_TIERS.find(t => t.weight === selectedWeight)?.truck || 'Margix Standard'}
                </Text>
                <View style={styles.zeroEmissionBadge}>
                  <Text style={styles.zeroEmissionText}>INDIAN FLEET</Text>
                </View>
              </View>
              <Text style={styles.truckBannerSub}>Payload limit: up to {(selectedWeight * 1000).toLocaleString()} kg</Text>
            </View>
            <Feather name="chevron-right" size={20} color={COLORS.primaryDark} />
          </View>
          
        </View>
      </ScrollView>
      
      {/* FIXED CONTINUE BUTTON */}
      <View style={styles.bottomFixedBar}>
        <TouchableOpacity style={styles.continueBtn} activeOpacity={0.9}>
          <Text style={styles.continueBtnText}>Continue to Pricing</Text>
          <Feather name="arrow-right" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
    paddingBottom: 20,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.cardBg,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  headerTitles: {
    alignItems: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  brandDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primaryGreen,
    marginRight: 6,
  },
  brandText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primaryDark,
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textMain,
  },
  routeCard: {
    backgroundColor: COLORS.cardBg,
    marginHorizontal: 20,
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
    marginBottom: 24,
  },
  routeTimeline: {
    marginBottom: 16,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  timelineGraphic: {
    alignItems: 'center',
    marginRight: 16,
    width: 16,
  },
  dotOutline: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  dotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  timelineLine: {
    width: 2,
    height: 24,
    backgroundColor: '#E5E7EB',
    position: 'absolute',
    top: 16,
    zIndex: -1,
  },
  routeTextContainer: {
    flex: 1,
    paddingRight: 10,
  },
  locationTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMain,
    marginRight: 8,
    maxWidth: '65%',
  },
  badgePickup: {
    backgroundColor: COLORS.accentGreenLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgePickupText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
  },
  badgeDrop: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeDropText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
  },
  locationSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  editBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primaryDark,
    marginLeft: 6,
  },
  actionDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 12,
  },
  etaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  etaText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginLeft: 4,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  progressText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  progressDots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
    marginLeft: 4,
  },
  progDotActive: {
    backgroundColor: COLORS.primaryDark,
  },
  bottomSheet: {
    backgroundColor: COLORS.cardBg,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 10,
    minHeight: Dimensions.get('window').height * 0.6,
  },
  sheetDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 24,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textMain,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  sheetSubtitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    lineHeight: 20,
    marginBottom: 24,
  },
  weightCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 24,
    padding: 24,
    marginBottom: 24,
  },
  weightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  grossPayloadRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  grossPayloadText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 1,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    padding: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  unitBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  unitBtnActive: {
    backgroundColor: COLORS.primaryDark,
  },
  unitBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  unitBtnTextActive: {
    color: '#FFFFFF',
  },
  weightMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weightHugeText: {
    fontSize: 48,
    fontWeight: '800',
    color: COLORS.textMain,
    letterSpacing: -1,
  },
  weightUnitText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginLeft: 8,
    marginBottom: 8,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.accentGreenLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  tierBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  approxText: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 8,
    textAlign: 'right',
  },
  sliderTrack: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    marginTop: 32,
    marginBottom: 16,
    position: 'relative',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: COLORS.primaryDark,
    borderRadius: 3,
  },
  sliderThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primaryDark,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    position: 'absolute',
    top: -9,
    marginLeft: -12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  presetsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  presetsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textMain,
  },
  viewGuideText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primaryDark,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  gridItem: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  gridItemActive: {
    borderColor: COLORS.primaryDark,
    borderWidth: 2,
    backgroundColor: '#F8FAFC',
  },
  gridItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  gridWeightText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textMain,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
  },
  radioDotActive: {
    backgroundColor: COLORS.primaryDark,
  },
  gridTitleText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 4,
  },
  gridDescText: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  truckBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4', // Light green hint
    borderWidth: 1,
    borderColor: '#DCFCE7',
    borderRadius: 16,
    padding: 16,
  },
  truckIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  truckBannerText: {
    flex: 1,
  },
  truckBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMain,
    marginRight: 8,
  },
  zeroEmissionBadge: {
    backgroundColor: '#059669',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  zeroEmissionText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  truckBannerSub: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  bottomFixedBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.cardBg,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 10,
  },
  continueBtn: {
    backgroundColor: COLORS.primaryDark,
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  continueBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginRight: 8,
  },
});
