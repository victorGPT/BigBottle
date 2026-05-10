import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { resources } from './i18n/locales';

export const supportedLanguages = ['en', 'zh-Hans', 'zh-Hant', 'ja'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

export const languageOptions: Array<{ code: SupportedLanguage; label: string; flag: string }> = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'zh-Hans', label: '简体中文', flag: '🇨🇳' },
  { code: 'zh-Hant', label: '繁體中文', flag: '🇹🇼' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' }
];

function getStoredLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return 'en';
  try {
    if (typeof window.localStorage?.getItem !== 'function') return 'en';
    const stored = window.localStorage.getItem('bigbottle.language');
    if (stored === 'zh') return 'zh-Hans';
    return supportedLanguages.includes(stored as SupportedLanguage) ? (stored as SupportedLanguage) : 'en';
  } catch {
    return 'en';
  }
}

function setStoredLanguage(language: string) {
  if (typeof window === 'undefined') return;
  try {
    if (typeof window.localStorage?.setItem !== 'function') return;
    window.localStorage.setItem('bigbottle.language', language);
  } catch {
    // ignore
  }
}

i18n.use(initReactI18next).init({
  resources,
  lng: getStoredLanguage(),
  fallbackLng: 'en',
  defaultNS: 'app',
  ns: ['app'],
  keySeparator: false,
  interpolation: {
    escapeValue: false
  }
});

i18n.on('languageChanged', (language) => {
  if (supportedLanguages.includes(language as SupportedLanguage)) {
    setStoredLanguage(language);
  }
});

export default i18n;
