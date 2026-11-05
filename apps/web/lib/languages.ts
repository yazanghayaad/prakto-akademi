import type { Direction } from './direction'

export interface Language {
  code: string
  translationKey: string
  nativeName: string
  /** Text direction of the language. Behaviour lives in lib/direction.ts. */
  dir: Direction
}

/**
 * Language shown to visitors who have not picked one themselves. The browser's
 * language is deliberately not used. Keep in sync with public/dir-init.js.
 */
export const DEFAULT_LANGUAGE = 'sv'

// Prakto: the academy is run in Swedish and English only; the other
// translations were removed (copies in utbildning/backups/locales-removed).
export const AVAILABLE_LANGUAGES: Language[] = [
  { code: 'sv', translationKey: 'common.swedish', nativeName: 'Svenska', dir: 'ltr' },
  { code: 'en', translationKey: 'common.english', nativeName: 'English', dir: 'ltr' },
]

export const getLanguageByCode = (code: string): Language | undefined => {
  return AVAILABLE_LANGUAGES.find(lang => lang.code === code)
}

export const getCurrentLanguageNativeName = (currentLang: string): string => {
  const language = getLanguageByCode(currentLang)
  return language?.nativeName || 'English'
}
