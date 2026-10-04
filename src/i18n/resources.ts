import enCharacters from './locales/en/characters'
import enCommon from './locales/en/common'
import zhCharacters from './locales/zh/characters'
import zhCommon from './locales/zh/common'

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

/** Chinese is the source locale: every other locale is type-checked against its shape. */
export const resources = {
  zh: { common: zhCommon, characters: zhCharacters },
  en: { common: enCommon, characters: enCharacters },
} as const

export const defaultNS = 'common'
