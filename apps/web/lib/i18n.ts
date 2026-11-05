'use client'

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../locales/en.json';
import { loadDateLocale } from './format';
import { AVAILABLE_LANGUAGES, DEFAULT_LANGUAGE } from './languages';

const LOCALE_LOADERS: Record<string, () => Promise<{ default: any }>> = {
  sv: () => import('../locales/sv.json'),
};

// Only bundle English; lazy-load all other locales on demand
const resources = {
  en: { common: en },
};

async function loadLocale(lng: string) {
  const code = lng.split('-')[0]
  if (code === 'en' || !LOCALE_LOADERS[code]) return;
  if (i18n.hasResourceBundle(code, 'common')) return;

  try {
    const mod = await LOCALE_LOADERS[code]();
    i18n.addResourceBundle(code, 'common', mod.default, true, true);
  } catch (e) {
    console.warn(`Failed to load locale: ${lng}`, e);
  }
}

// Visitors who have not chosen a language get DEFAULT_LANGUAGE instead of their
// browser's language. Missing translations still fall back to English.
const languageDetector = new LanguageDetector();
languageDetector.addDetector({
  name: 'platformDefault',
  lookup: () => DEFAULT_LANGUAGE,
});

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    // A language picked before the other translations were removed (still in
    // localStorage or the cookie) is ignored, and the platform default applies.
    supportedLngs: AVAILABLE_LANGUAGES.map((l) => l.code),
    load: 'languageOnly',
    ns: ['common'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
    detection: {
      // Mirrored in public/dir-init.js: keep the two in sync.
      order: ['localStorage', 'cookie', 'querystring', 'platformDefault'],
      caches: ['localStorage', 'cookie'],
      lookupLocalStorage: 'i18nextLng',
      lookupCookie: 'i18next',
    },
    react: {
      useSuspense: false,
    }
  });

// Load the detected language if it's not English, and export the promise
// so I18nProvider can wait for resources before rendering.
// The date locale rides along: dayjs keeps its own registry, and without this
// every "2 hours ago" renders in English no matter the language.
export const initialLocaleReady = Promise.all([
  loadLocale(i18n.language.split('-')[0]),
  loadDateLocale(i18n.language),
]).then(() => undefined);

/**
 * Switch language safely: preloads the bundle before switching
 * so the UI never flashes English as a fallback.
 */
export async function changeLanguage(lng: string) {
  await Promise.all([loadLocale(lng), loadDateLocale(lng)])
  return i18n.changeLanguage(lng)
}

export default i18n;
