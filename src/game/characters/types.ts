import type { AbilityFactory } from '../engine/Ability'
import type { CharacterId } from '../engine/types'

export interface Palette {
  /** Ball fill. */
  ball: string
  /** HP label on the ball. */
  text: string
  /** Accent used for titles, HP bars and the arena border. */
  accent: string
}

export interface CharacterDef {
  id: CharacterId
  /** Pixel-font display title; the localized name, tagline and rules live in i18n/locales/<lang>/characters.ts. */
  nameEn: string
  /**
   * Tuning constants quoted by the localized rule text (`{{key}}` placeholders),
   * so the rules shown on the select screen always match the actual numbers.
   */
  ruleValues?: Readonly<Record<string, string | number>>
  palette: Palette
  /** Used for the second ball when both players pick the same character. */
  mirrorPalette: Palette
  create: AbilityFactory
  drawPortrait: (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) => void
}
