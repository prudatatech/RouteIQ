
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { translations, Language } from '../locales';
import { api } from '../services/api';
import { getCurrentSession } from '../services/supabase';

interface TranslationContextType {
  lang: Language;
  t: (key: string) => string;
  setLanguage: (lang: Language) => Promise<void>;
  isLoaded: boolean;
}

const TranslationContext = createContext<TranslationContextType | null>(null);

export const TranslationProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Language>('en');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Load from async storage initially for login screen
    AsyncStorage.getItem('language_preference').then((saved) => {
      if (saved && saved in translations) {
        setLangState(saved as Language);
      }
      setIsLoaded(true);
    });
  }, []);

  const setLanguage = async (newLang: Language) => {
    setLangState(newLang);
    await AsyncStorage.setItem('language_preference', newLang);
    try {
      // If logged in, update the backend profile
      if (await getCurrentSession()) {
        await api.updateLanguagePreference(newLang);
      }
    } catch (e) {
      console.warn('Failed to update language on backend', e);
    }
  };

  const t = (key: string) => {
    const dict = translations[lang] || translations['en'];
    return (dict as any)[key] || (translations['en'] as any)[key] || key;
  };

  return (
    <TranslationContext.Provider value={{ lang, t, setLanguage, isLoaded }}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(TranslationContext);
  if (!context) throw new Error('useTranslation must be used within TranslationProvider');
  return context;
};

