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
  name: string
  nameEn: string
  tagline: string
  /** Mechanics, in reading order. */
  rules: readonly string[]
  palette: Palette
  /** Used for the second ball when both players pick the same character. */
  mirrorPalette: Palette
  create: AbilityFactory
  drawPortrait: (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) => void
}
