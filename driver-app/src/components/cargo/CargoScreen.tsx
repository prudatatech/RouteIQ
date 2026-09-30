import React, { type ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '../../hooks/useTranslation';
import { ScreenHeader } from '../ui';
import { colors, size, space } from '../../theme';

interface CargoScreenProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Rendered at the right of the header (the SOS button). */
  headerRight?: ReactNode;
  /** Buttons kept above the keyboard at the bottom. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Full-screen layout shared by the cargo screens (pickup, delivery, cargo
 * check, handover, hub drop, return pickup): header with close and SOS, a
 * scrolling form that stays clear of the keyboard, and the actions at the
 * bottom inside the safe area.
 */
export default function CargoScreen({ title, subtitle, onClose, headerRight, footer, children }: CargoScreenProps) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScreenHeader title={title} subtitle={subtitle} onBack={onClose} backIcon="close" backLabel={t('close')} right={headerRight} />
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[8], gap: space[4] },
  footer: {
    flexDirection: 'row',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: size.border,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
