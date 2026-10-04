import { useTranslation } from 'react-i18next'
import { currentLanguage, SUPPORTED_LANGUAGES } from '../i18n'

/** Language picker; the choice is remembered in localStorage by the i18next detector. */
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  return (
    <label className="relative flex items-center rounded-lg border border-zinc-800 bg-zinc-950/70 text-sm text-zinc-300 transition hover:border-zinc-600">
      <span className="sr-only">{t('lang.label')}</span>
      <span aria-hidden className="pointer-events-none absolute left-2 text-xs">
        🌐
      </span>
      <select
        value={currentLanguage()}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent py-1.5 pl-7 pr-2 outline-none"
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng} className="bg-zinc-900">
            {t(`lang.${lng}`)}
          </option>
        ))}
      </select>
    </label>
  )
}
