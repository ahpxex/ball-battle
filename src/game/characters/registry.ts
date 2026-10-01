import type { CharacterId } from '../engine/types'
import { acidDef } from './acid'
import { blackHoleDef } from './blackHole'
import { chessDef } from './chess'
import { cobwebDef } from './cobweb'
import { conductorDef } from './conductor'
import { drillDef } from './drill'
import { electricDef } from './electric'
import { gojoDef } from './gojo'
import { grenadeDef } from './grenade'
import { hammerDef } from './hammer'
import { hookDef } from './hook'
import { laserV1Def, laserV2Def, laserV3Def } from './laser'
import { mathBallDef } from './mathBall'
import { orbitDef } from './orbit'
import { shurikenDef } from './shuriken'
import { spiderDef } from './spider'
import { tornadoDef } from './tornado'
import { toxicSpikeDef } from './toxicSpike'
import { trapperDef } from './trapper'
import { vampireDef } from './vampire'
import { zeusDef } from './zeus'
import { duplicatorDef } from './duplicator'
import { glassDef } from './glass'
import { mimicDef } from './mimic'
import { flamethrowerDef } from './flamethrower'
import { quicksandDef } from './quicksand'
import { cableDef } from './cable'
import { volcanoDef } from './volcano'
import { assassinDef } from './assassin'
import { frostDef } from './frost'
import { spearDef } from './spear'
import { necromancerDef } from './necromancer'
import { boomerangDef } from './boomerang'
import { tridentDef } from './trident'
import { discoDef } from './disco'
import { frogDef } from './frog'
import { magnetDef } from './magnet'
import { cannonDef } from './cannon'
import { cloneDef } from './clone'
import { cutterDef } from './cutter'
import { blastersDef } from './blasters'
import { spikeDef } from './spike'
import { sonicDef } from './sonic'
import { sawDef, sawV2Def } from './saw'
import { alchemistDef } from './alchemist'
import { meteorDef } from './meteor'
import { bomberDef } from './bomber'
import { snowmanDef } from './snowman'
import { virusDef } from './virus'
import { splitterDef } from './splitter'
import { freezerDef } from './freezer'
import { hiveDef } from './hive'
import { rocketDef } from './rocket'
import { archerDef } from './archer'
import { knightDef } from './knight'
import { snakeDef } from './snake'
import { appleDef } from './apple'
import { shotgunDef } from './shotgun'
import { wdcDef } from './wdc'
import { cactusDef } from './cactus'
import { boxerDef } from './boxer'
import type { CharacterDef } from './types'

export type { CharacterDef, Palette } from './types'

/** Every playable character, in roster order. */
export const CHARACTERS: readonly CharacterDef[] = [
  vampireDef,
  conductorDef,
  hookDef,
  toxicSpikeDef,
  cobwebDef,
  shurikenDef,
  grenadeDef,
  hammerDef,
  spiderDef,
  drillDef,
  chessDef,
  mathBallDef,
  electricDef,
  gojoDef,
  trapperDef,
  laserV1Def,
  laserV2Def,
  laserV3Def,
  blackHoleDef,
  orbitDef,
  tornadoDef,
  acidDef,
  zeusDef,
  duplicatorDef,
  glassDef,
  mimicDef,
  flamethrowerDef,
  quicksandDef,
  cableDef,
  volcanoDef,
  assassinDef,
  frostDef,
  spearDef,
  necromancerDef,
  boomerangDef,
  tridentDef,
  discoDef,
  frogDef,
  magnetDef,
  cannonDef,
  cloneDef,
  cutterDef,
  blastersDef,
  spikeDef,
  sonicDef,
  sawDef,
  sawV2Def,
  alchemistDef,
  meteorDef,
  bomberDef,
  snowmanDef,
  virusDef,
  splitterDef,
  freezerDef,
  hiveDef,
  rocketDef,
  archerDef,
  knightDef,
  snakeDef,
  appleDef,
  shotgunDef,
  wdcDef,
  cactusDef,
  boxerDef,
]

const byId = new Map(CHARACTERS.map((c) => [c.id, c]))

export function getCharacter(id: CharacterId): CharacterDef {
  const c = byId.get(id)
  if (!c) throw new Error(`Unknown character: ${id}`)
  return c
}

export function isCharacterId(value: string): value is CharacterId {
  return byId.has(value as CharacterId)
}
