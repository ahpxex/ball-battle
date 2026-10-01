import type { Vec } from '../core/vec'
import type { Ball } from './Ball'

export type Team = 0 | 1

export type CharacterId =
  | 'vampire'
  | 'conductor'
  | 'hook'
  | 'toxicSpike'
  | 'cobweb'
  | 'shuriken'
  | 'grenade'
  | 'hammer'
  | 'spider'
  | 'drill'
  | 'chess'
  | 'mathBall'
  | 'electric'
  | 'gojo'
  | 'trapper'
  | 'laserV1'
  | 'laserV2'
  | 'laserV3'
  | 'blackHole'
  | 'orbit'
  | 'tornado'
  | 'acid'
  | 'zeus'
  | 'duplicator'
  | 'frog'
  | 'magnet'
  | 'necromancer'
  | 'boomerang'
  | 'flamethrower'
  | 'quicksand'
  | 'assassin'
  | 'frost'
  | 'trident'
  | 'disco'
  | 'spear'
  | 'mimic'
  | 'cable'
  | 'volcano'
  | 'cannon'
  | 'clone'
  | 'cutter'
  | 'blasters'
  | 'glass'
  | 'saw'
  | 'sawV2'
  | 'alchemist'
  | 'snowman'
  | 'virus'
  | 'hive'
  | 'rocket'
  | 'splitter'
  | 'freezer'
  | 'cactus'
  | 'boxer'
  | 'archer'
  | 'knight'
  | 'meteor'
  | 'bomber'
  | 'spike'
  | 'sonic'
  | 'snake'
  | 'apple'
  | 'shotgun'
  | 'wdc'

export type Wall = 'left' | 'right' | 'top' | 'bottom'

export interface WallBounce {
  ball: Ball
  wall: Wall
  /** Contact point on the wall itself. */
  point: Vec
  /** Unit normal pointing into the arena. */
  normal: Vec
  /** Speed component into the wall before the bounce. */
  impactSpeed: number
}

export interface BallContact {
  other: Ball
  /** Contact point on the surface between both balls. */
  point: Vec
  /** Unit normal pointing from this ball towards `other`. */
  normal: Vec
  /** Closing speed along the normal (>= 0 when approaching). */
  closingSpeed: number
}

export type DamageKind =
  | 'bite'
  | 'train'
  | 'spike'
  | 'poison'
  | 'thread'
  | 'hook'
  | 'shuriken'
  | 'grenade'
  | 'hammer'
  | 'drill'
  | 'spiderBite'
  | 'chess'
  | 'math'
  | 'shock'
  | 'cursed'
  | 'trap'
  | 'laser'
  | 'gravity'
  | 'orb'
  | 'wind'
  | 'acid'
  | 'overtime'
  | 'lightning'
  | 'stab'
  | 'tongue'
  | 'magnet'
  | 'arrow'
  | 'boomerang'
  | 'fire'
  | 'burn'
  | 'sand'
  | 'sword'
  | 'frost'
  | 'spear'
  | 'trident'
  | 'disco'
  | 'lava'
  | 'cable'
  | 'shell'
  | 'ghost'
  | 'cut'
  | 'bullet'
  | 'glass'
  | 'saw'
  | 'potion'
  | 'snowball'
  | 'virus'
  | 'sting'
  | 'ram'
  | 'split'
  | 'ice'
  | 'snake'
  | 'apple'
  | 'meteor'
  | 'bomb'
  | 'ironSpike'
  | 'sonic'
  | 'pellet'
  | 'wdc'
  | 'thorn'
  | 'punch'

export interface DamageOptions {
  kind: DamageKind
  /** Attacking ball, if any; credited in match stats. */
  source?: Ball
  /** Velocity added to the target (ignored while the target is pinned). */
  knock?: Vec
  /** World point where the hit landed, used for particles. */
  at?: Vec
  /** Self-inflicted or environmental damage that no side gets credit for. */
  noCredit?: boolean
  /** Screen shake strength contributed by this hit. */
  shake?: number
}

export type SoundId =
  | 'start'
  | 'bounce'
  | 'clack'
  | 'hit'
  | 'heavyHit'
  | 'bite'
  | 'heal'
  | 'spike'
  | 'place'
  | 'thread'
  | 'hook'
  | 'whoosh'
  | 'trainHorn'
  | 'trainHit'
  | 'poison'
  | 'shuriken'
  | 'throw'
  | 'explosion'
  | 'hammer'
  | 'drill'
  | 'web'
  | 'chess'
  | 'disarm'
  | 'roll'
  | 'jackpot'
  | 'zap'
  | 'laser'
  | 'death'
  | 'win'
  | 'thunder'

export type GameEvent =
  | { type: 'sound'; sound: SoundId; volume: number; pitch: number }
  | { type: 'ko'; loser: Team }
  | { type: 'finished'; winner: Team | null }

export interface TeamStats {
  damageDealt: number
  healing: number
  hits: number
  biggestHit: number
}

export type Phase = 'countdown' | 'fight' | 'ending' | 'finished'
