/**
 * MargixIndia Driver App — Vehicle approval gate
 *
 * Sits between login and the home screen:
 *  - no vehicle yet: the driver registers one (or carries on and waits for
 *    dispatch to assign one);
 *  - registered, waiting: the "Waiting for approval" screen, which updates by
 *    itself;
 *  - rejected: dispatch's reason, and a form to fix the details and submit again;
 *  - approved (or a vehicle dispatch assigned): the app, as before.
 * When the last known answer was "approved" and the phone has no signal, the
 * driver is let in rather than locked out.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { api, type VehicleRegistrationState } from '../services/api';
import { REGISTRATION_KEY, useVehicleRegistration } from '../hooks/useVehicleRegistration';
import { useTranslation } from '../hooks/useTranslation';
import { Button, ErrorBanner, Text } from '../components/ui';
import { colors, space } from '../theme';
import VehicleRegistrationScreen from './VehicleRegistrationScreen';
import VehicleApprovalScreen from './VehicleApprovalScreen';

const SKIP_KEY = 'vehicle_onboarding_skipped';
const APPROVED_KEY = 'vehicle_registration_approved';

interface GateContextValue {
  /** Where the driver's vehicle registration stands, once known. */
  state: VehicleRegistrationState | null;
  /** Opens the registration form again (after carrying on without a vehicle). */
  registerVehicle: () => void;
}

const GateContext = createContext<GateContextValue>({ state: null, registerVehicle: () => {} });

/** For screens inside the app that offer "Register my vehicle". */
export const useVehicleGate = () => useContext(GateContext);

export default function VehicleGate({ onLogout, children }: { onLogout: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const registration = useVehicleRegistration();
  const [skipped, setSkipped] = useState<boolean | null>(null);
  const [cachedApproved, setCachedApproved] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [showApproved, setShowApproved] = useState(false);
  const previous = useRef<VehicleRegistrationState | null>(null);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(SKIP_KEY), AsyncStorage.getItem(APPROVED_KEY)])
      .then(([skip, approved]) => {
        setSkipped(skip === '1');
        setCachedApproved(approved === '1');
      })
      .catch(() => {
        setSkipped(false);
        setCachedApproved(false);
      });
  }, []);

  const state = registration.data?.state ?? null;
  useEffect(() => {
    if (!state) return;
    // The driver was watching the waiting or rejected screen when it got approved: say so before moving on
    if (state === 'approved' && (previous.current === 'pending' || previous.current === 'rejected')) setShowApproved(true);
    previous.current = state;
    if (state === 'approved') AsyncStorage.setItem(APPROVED_KEY, '1').catch(() => {});
    else AsyncStorage.removeItem(APPROVED_KEY).catch(() => {});
  }, [state]);

  const skip = useCallback(() => {
    setSkipped(true);
    AsyncStorage.setItem(SKIP_KEY, '1').catch(() => {});
  }, []);
  const registerVehicle = useCallback(() => {
    setSkipped(false);
    AsyncStorage.removeItem(SKIP_KEY).catch(() => {});
  }, []);
  const logout = useCallback(async () => {
    await api.logout();
    onLogout();
  }, [onLogout]);
  const registered = useCallback(() => {
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: REGISTRATION_KEY });
  }, [queryClient]);

  const context = useMemo(() => ({ state, registerVehicle }), [state, registerVehicle]);

  if (skipped === null || cachedApproved === null || (registration.isLoading && !registration.data)) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.accent} accessibilityLabel={t('loading')} />
      </SafeAreaView>
    );
  }

  const data = registration.data;
  if (!data) {
    // Could not ask. A driver last known as approved carries on with what is saved on the phone.
    if (cachedApproved) return <GateContext.Provider value={context}>{children}</GateContext.Provider>;
    return (
      <SafeAreaView style={styles.center}>
        <View style={styles.errorBox}>
          <Text variant="heading" align="center">
            {t('vehicle_load_failed')}
          </Text>
          <ErrorBanner message={registration.error instanceof Error ? registration.error.message : t('vehicle_load_failed')} />
          <Button title={t('retry')} onPress={() => registration.refetch()} loading={registration.isFetching} />
          <Button title={t('logout')} variant="ghost" onPress={logout} />
        </View>
      </SafeAreaView>
    );
  }

  if (data.state === 'approved') {
    // Also on the very render where the answer flips, so the home screen never flashes up first
    if (showApproved || previous.current === 'pending' || previous.current === 'rejected') {
      return (
        <VehicleApprovalScreen
          registration={data}
          view="approved"
          refreshing={false}
          onRefresh={() => {}}
          onEdit={() => {}}
          onContinue={() => setShowApproved(false)}
          onLogout={logout}
        />
      );
    }
    return <GateContext.Provider value={context}>{children}</GateContext.Provider>;
  }

  if (data.state === 'none') {
    if (skipped) return <GateContext.Provider value={context}>{children}</GateContext.Provider>;
    return <VehicleRegistrationScreen initial={null} photos={[]} mode="new" onDone={registered} onSkip={skip} onLogout={logout} />;
  }

  // Waiting for approval, or rejected
  if (editing) {
    return (
      <VehicleRegistrationScreen
        initial={data.vehicle}
        photos={data.photos}
        mode={data.state === 'rejected' ? 'resubmit' : 'edit'}
        onDone={registered}
        onCancel={() => setEditing(false)}
        onLogout={logout}
      />
    );
  }
  return (
    <VehicleApprovalScreen
      registration={data}
      view={data.state === 'rejected' ? 'rejected' : 'pending'}
      refreshing={registration.isFetching}
      onRefresh={() => registration.refetch()}
      onEdit={() => setEditing(true)}
      onContinue={() => {}}
      onLogout={logout}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: space[4] },
  errorBox: { alignSelf: 'stretch', gap: space[4] },
});
