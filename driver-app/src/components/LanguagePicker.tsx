import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from '../hooks/useTranslation';
import type { Language } from '../locales';
import { LANGUAGES } from '../constants/profile';
import { Chip } from './ui';
import { space } from '../theme';

/** One chip per app language, each written in its own script so a driver can find theirs. */
export default function LanguagePicker() {
  const { lang, setLanguage } = useTranslation();
  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {LANGUAGES.map((l) => (
        <Chip key={l.code} label={l.label} selected={lang === l.code} onPress={() => setLanguage(l.code as Language)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
