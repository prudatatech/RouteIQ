import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from '../hooks/useTranslation';
import type { Language } from '../locales';
import { LANGUAGES } from '../constants/profile';
import { Text } from './ui';
import { colors, radius, size, space } from '../theme';

/** One chip per app language, each written in its own script so a driver can find theirs. */
export default function LanguagePicker() {
  const { lang, setLanguage } = useTranslation();
  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {LANGUAGES.map((l) => {
        const selected = lang === l.code;
        return (
          <Pressable
            key={l.code}
            onPress={() => setLanguage(l.code as Language)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={l.label}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text variant="bodySmallMedium" color={selected ? 'accent' : 'text'}>
              {l.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    minHeight: size.control,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: size.border,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
});
