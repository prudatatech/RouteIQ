import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations, setCurrentLanguage, fill, type Language } from '../locales';

const LANGUAGE_KEY = 'customer_language_preference';

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

interface TranslationContextType {
  lang: Language;
  t: TranslateFn;
  setLanguage: (lang: Language) => Promise<void>;
}

const TranslationContext = createContext<TranslationContextType | null>(null);

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>('en');

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_KEY)
      .then((saved) => {
        if (saved && saved in translations) {
          setLangState(saved as Language);
          setCurrentLanguage(saved as Language);
        }
      })
      .catch(() => {
        // Without a saved choice the app simply stays in English.
      });
  }, []);

  const setLanguage = useCallback(async (next: Language) => {
    setLangState(next);
    setCurrentLanguage(next);
    await AsyncStorage.setItem(LANGUAGE_KEY, next).catch(() => {});
  }, []);

  const t = useCallback<TranslateFn>(
    (key, vars) => fill((translations[lang] as Record<string, string>)[key] || (translations.en as Record<string, string>)[key] || key, vars),
    [lang],
  );

  const value = useMemo(() => ({ lang, t, setLanguage }), [lang, t, setLanguage]);
  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}

export function useTranslation() {
  const context = useContext(TranslationContext);
  if (!context) throw new Error('useTranslation must be used within TranslationProvider');
  return context;
}
