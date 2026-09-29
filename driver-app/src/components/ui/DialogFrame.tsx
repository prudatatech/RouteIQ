import React, { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, elevation, radius, space } from '../../theme';

export type DialogVariant = 'center' | 'sheet' | 'full';

export interface DialogFrameProps {
  visible: boolean;
  variant?: DialogVariant;
  /** Android back button and backdrop tap. Omit to make the dialog blocking. */
  onRequestClose?: () => void;
  children: ReactNode;
}

/**
 * The single modal container used by the app: a centred dialog, a bottom
 * sheet, or a full-screen page. Handles the backdrop, keyboard and safe areas.
 */
export function DialogFrame({ visible, variant = 'center', onRequestClose, children }: DialogFrameProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType={variant === 'sheet' ? 'slide' : 'fade'}
      onRequestClose={onRequestClose ?? (() => {})}
    >
      {variant === 'full' ? (
        // Full-screen content handles its own safe areas (SafeAreaView).
        <View style={styles.full}>{children}</View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.overlay, variant === 'sheet' ? styles.overlaySheet : styles.overlayCenter]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onRequestClose}
              disabled={!onRequestClose}
              accessible={false}
              importantForAccessibility="no"
            />
            <View
              style={[
                styles.panel,
                variant === 'sheet'
                  ? [styles.sheet, { paddingBottom: space[4] + insets.bottom }]
                  : [styles.center, { marginTop: insets.top, marginBottom: insets.bottom }],
              ]}
              accessibilityViewIsModal
            >
              <ScrollView
                bounces={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
              >
                {variant === 'sheet' ? <View style={styles.handle} /> : null}
                {children}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { flex: 1, backgroundColor: colors.overlay },
  overlayCenter: { justifyContent: 'center', padding: space[4] },
  overlaySheet: { justifyContent: 'flex-end' },
  panel: { backgroundColor: colors.surface, maxHeight: '90%', ...elevation.lg },
  center: { borderRadius: radius.card },
  sheet: { borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  content: { padding: space[6], gap: space[4] },
  handle: {
    alignSelf: 'center',
    width: space[8],
    height: space[1],
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
    marginTop: -space[3],
  },
  full: { flex: 1, backgroundColor: colors.bg },
});
