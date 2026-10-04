import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CharacterDef } from '../game/characters/registry'
import type { CharacterId } from '../game/engine/types'

export interface CharacterText {
  name: (id: CharacterId) => string
  tagline: (id: CharacterId) => string
  /** Rule lines with the character's live tuning numbers filled in. */
  rules: (def: CharacterDef) => readonly string[]
}

/** Localized character names, taglines and rules. */
export function useCharacterText(): CharacterText {
  const { t } = useTranslation('characters')
  return useMemo(
    () => ({
      name: (id) => t(`${id}.name`),
      tagline: (id) => t(`${id}.tagline`),
      rules: (def) => t(`${def.id}.rules`, { ...def.ruleValues, returnObjects: true }) as readonly string[],
    }),
    [t],
  )
}
