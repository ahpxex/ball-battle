import { type CharacterDef, type Palette, getCharacter } from './characters/registry'
import type { CharacterId } from './engine/types'
import { World } from './engine/World'

export interface MatchSetup {
  left: CharacterId
  right: CharacterId
  seed: number
}

export interface MatchSide {
  def: CharacterDef
  palette: Palette
}

/** Resolves both sides' presentation, recoloring the right side in mirror matches. */
export function resolveSides(setup: Pick<MatchSetup, 'left' | 'right'>): [MatchSide, MatchSide] {
  const l = getCharacter(setup.left)
  const r = getCharacter(setup.right)
  return [
    { def: l, palette: l.palette },
    { def: r, palette: l.id === r.id ? r.mirrorPalette : r.palette },
  ]
}

export function createWorld(setup: MatchSetup, opts: { headless?: boolean } = {}): World {
  const sides = resolveSides(setup)
  return new World({
    seed: setup.seed,
    headless: opts.headless,
    fighters: [
      { charId: sides[0].def.id, color: sides[0].palette.ball, textColor: sides[0].palette.text, createAbility: sides[0].def.create },
      { charId: sides[1].def.id, color: sides[1].palette.ball, textColor: sides[1].palette.text, createAbility: sides[1].def.create },
    ],
  })
}
