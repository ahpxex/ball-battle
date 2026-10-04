import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { defaultNS, type Language, resources, SUPPORTED_LANGUAGES } from './resources'

export { type Language, SUPPORTED_LANGUAGES } from './resources'

const STORAGE_KEY = 'ball-battle:lang'

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    ns: ['common', 'characters'],
    supportedLngs: SUPPORTED_LANGUAGES,
    // zh-CN, zh-TW, en-US… all map onto the two bundled languages.
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    // React already escapes rendered text.
    interpolation: { escapeValue: false },
    // Resources are bundled, so initialise synchronously (no flash of keys).
    initAsync: false,
  })

/** The active bundled language ('zh' for zh-CN etc.). */
export function currentLanguage(): Language {
  const lng = i18next.resolvedLanguage ?? i18next.language
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lng) ? (lng as Language) : 'en'
}

function syncDocument(): void {
  document.documentElement.lang = currentLanguage() === 'zh' ? 'zh-CN' : 'en'
  document.title = i18next.t('app.documentTitle')
}

i18next.on('languageChanged', syncDocument)
syncDocument()

export default i18next
