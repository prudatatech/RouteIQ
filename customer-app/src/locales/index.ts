/**
 * Customer app text in six languages (the same six as the driver app). English
 * is the source; every other language is typed as `Record<keyof typeof en, string>`,
 * so a key missing from any of them fails `npm run typecheck`.
 */
import en from './en';
import hi from './hi';
import mr from './mr';
import te from './te';
import kn from './kn';
import bn from './bn';

export const translations = { en, hi, mr, te, kn, bn };

export type Language = keyof typeof translations;

/** The languages a customer can choose, each written in its own script. */
export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'bn', label: 'বাংলা' },
];

let currentLanguage: Language = 'en';

/** Kept in step with the customer's choice, so code outside React (the API client) can speak it too. */
export function setCurrentLanguage(lang: Language) {
  currentLanguage = lang;
}

/** The language the customer chose, for code outside React (date formatting). */
export function getCurrentLanguage(): Language {
  return currentLanguage;
}

/** Fills {name} placeholders in a translated sentence. */
export function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/** Looks a key up in the current language, falling back to English. */
export function translateNow(key: string, vars?: Record<string, string | number>): string {
  const dict = translations[currentLanguage] as Record<string, string>;
  return fill(dict[key] || (translations.en as Record<string, string>)[key] || key, vars);
}
