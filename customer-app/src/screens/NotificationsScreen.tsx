import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  Platform,
  StatusBar
} from 'react-native';
import { Feather, MaterialCommunityIcons, Octicons } from '@expo/vector-icons';

// Color Palette
const COLORS = {
  background: '#F6F5F0',
  cardBg: '#FFFFFF',
  primaryDark: '#234E4A',
  textMain: '#1A2F2D',
  textMuted: '#6B7280',
  accentGreen: '#E2EBE8',
  iconBg: '#F0F5F4',
  readBg: '#E9EFEB',
};

const FILTER_TABS = ['All', 'Shipments', 'Bookings', 'Rewards'];

export default function NotificationsScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState('All');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* --- HEADER --- */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={24} color={COLORS.textMain} />
        </TouchableOpacity>
        
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Notifications</Text>
          <View style={styles.unreadRow}>
            <View style={styles.unreadDot} />
            <Text style={styles.unreadText}>3 unread</Text>
          </View>
        </View>

        <TouchableOpacity>
          <Text style={styles.markReadText}>Mark all read</Text>
        </TouchableOpacity>
      </View>

      {/* --- FILTER TABS --- */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTER_TABS.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity 
                key={tab} 
                style={[styles.tabBtn, isActive && styles.tabBtnActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab}</Text>
                {tab === 'All' && (
                  <View style={styles.badgeContainer}>
                    <Text style={styles.badgeText}>3</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* --- TODAY SECTION --- */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>TODAY</Text>
          <Text style={styles.sectionSubtitle}>3 new</Text>
        </View>

        {/* Card 1 */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons name="truck-fast-outline" size={22} color={COLORS.primaryDark} />
            </View>
            <View style={styles.cardTextContainer}>
              <View style={styles.cardTitleRow}>
                <View style={styles.unreadDotSmall} />
                <Text style={styles.cardTitleUnread}>Truck is 6 minutes away</Text>
                <Text style={styles.cardTime}>9:34</Text>
              </View>
              <Text style={styles.cardDesc}>Arjun is nearing your warehouse pickup for shipment MX-2841.</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.actionPill}>
            <Text style={styles.actionPillText}>Track truck</Text>
            <Feather name="arrow-right" size={14} color={COLORS.primaryDark} />
          </TouchableOpacity>
        </View>

        {/* Card 2 */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={[styles.iconContainer, { backgroundColor: '#FDF3E1' }]}>
              <Feather name="calendar" size={20} color="#D97706" />
            </View>
            <View style={styles.cardTextContainer}>
              <View style={styles.cardTitleRow}>
                <View style={styles.unreadDotSmall} />
                <Text style={styles.cardTitleUnread}>Pickup window starts soon</Text>
                <Text style={styles.cardTime}>8:10</Text>
              </View>
              <Text style={styles.cardDesc}>Your full truck booking begins today at 11:30 AM.</Text>
            </View>
          </View>
        </View>

        {/* Card 3 */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.iconContainer}>
              <Octicons name="sparkle" size={20} color={COLORS.primaryDark} />
            </View>
            <View style={styles.cardTextContainer}>
              <View style={styles.cardTitleRow}>
                <View style={styles.unreadDotSmall} />
                <Text style={styles.cardTitleUnread}>80 Margix Miles added</Text>
                <Text style={styles.cardTime}>7:42</Text>
              </View>
              <Text style={styles.cardDesc}>Your on-time loading earned a little extra.</Text>
            </View>
          </View>
        </View>

        {/* --- EARLIER SECTION --- */}
        <View style={[styles.sectionHeader, { marginTop: 20 }]}>
          <Text style={styles.sectionTitle}>EARLIER</Text>
          <Text style={styles.sectionSubtitle}>This week</Text>
        </View>

        {/* Card 4 (Read) */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.iconContainer}>
              <Feather name="package" size={20} color={COLORS.primaryDark} />
            </View>
            <View style={styles.cardTextContainer}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitleRead}>Delivered to Aditi Rao</Text>
                <Text style={styles.cardTime}>Tue</Text>
              </View>
              <Text style={styles.cardDesc}>Shipment MX-2818 was handed over safely.</Text>
            </View>
          </View>
        </View>

        {/* Card 5 (Read) */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={[styles.iconContainer, { backgroundColor: '#F3F4F6' }]}>
              <Feather name="shield" size={20} color="#6B7280" />
            </View>
            <View style={styles.cardTextContainer}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitleRead}>Account details confirmed</Text>
                <Text style={styles.cardTime}>Mon</Text>
              </View>
              <Text style={styles.cardDesc}>Your phone number and warehouse contact are up to date.</Text>
            </View>
          </View>
        </View>

        {/* All Caught Up */}
        <View style={styles.caughtUpCard}>
          <View style={styles.iconContainerRead}>
            <Feather name="check" size={20} color={COLORS.primaryDark} />
          </View>
          <View style={styles.cardTextContainer}>
            <Text style={styles.cardTitleRead}>Nothing else to show</Text>
            <Text style={styles.cardDesc}>You're all caught up in this view.</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
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
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.cardBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  headerTitleContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textMain,
    marginBottom: 2,
  },
  unreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981', // green
    marginRight: 6,
  },
  unreadText: {
    fontSize: 13,
    color: '#10B981',
    fontWeight: '600',
  },
  markReadText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#357169',
  },

  /* FILTER TABS */
  filterContainer: {
    paddingLeft: 20,
    marginBottom: 20,
  },
  filterScroll: {
    paddingRight: 20,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 100,
    marginRight: 8,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  tabTextActive: {
    color: COLORS.textMain,
    fontWeight: '700',
  },
  badgeContainer: {
    backgroundColor: COLORS.accentGreen,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primaryDark,
  },

  /* SCROLL CONTENT */
  scrollContent: {
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textMain,
    letterSpacing: 1,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
  },

  /* CARDS */
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.iconBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  cardTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  unreadDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  cardTitleUnread: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textMain,
  },
  cardTitleRead: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textMain,
  },
  cardTime: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginLeft: 8,
  },
  cardDesc: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.iconBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    marginTop: 12,
    marginLeft: 60, // align with text
  },
  actionPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primaryDark,
    marginRight: 4,
  },

  /* CAUGHT UP CARD */
  caughtUpCard: {
    backgroundColor: COLORS.readBg,
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainerRead: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#D1DDD6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
});
