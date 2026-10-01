import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, radius, size, space } from '../../theme';
import { Text } from './Text';

export interface PickerOption {
  value: string;
  label: string;
}

export interface OptionPickerProps {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder: string;
  closeLabel: string;
  error?: string;
}

/** A labelled field that opens a full-screen list to choose from; for long lists such as the states. */
export function OptionPicker({ label, value, options, onChange, placeholder, closeLabel, error }: OptionPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={styles.wrap}>
      <Text variant="bodySmallMedium">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        onPress={() => setOpen(true)}
        style={[styles.field, error ? styles.fieldError : null]}
      >
        <Text variant="body" color={selected ? 'text' : 'textMuted'} style={styles.flex} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={size.icon.md} color={colors.textMuted} />
      </Pressable>
      {error ? (
        <Text variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text variant="title" accessibilityRole="header" style={styles.flex}>
              {label}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={() => setOpen(false)} hitSlop={12} style={styles.close}>
              <Feather name="x" size={size.icon.lg} color={colors.text} />
            </Pressable>
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item.value === value }}
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.option, pressed ? styles.pressed : null]}
              >
                <Text variant="body" style={styles.flex}>
                  {item.label}
                </Text>
                {item.value === value ? <Feather name="check" size={size.icon.md} color={colors.accent} /> : null}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[1], alignSelf: 'stretch' },
  flex: { flex: 1 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: size.control,
    paddingHorizontal: space[3],
    borderRadius: radius.control,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  fieldError: { borderColor: colors.danger },
  modal: { flex: 1, backgroundColor: colors.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', padding: space[4], gap: space[3] },
  close: { minWidth: size.control, minHeight: size.control, alignItems: 'center', justifyContent: 'center' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderTopWidth: size.border,
    borderTopColor: colors.border,
  },
  pressed: { backgroundColor: colors.surfaceSubtle },
});
