import type { Ball } from './Ball'
import type { World } from './World'
import type { BallContact, DamageOptions, WallBounce } from './types'

/**
 * A character's weapon / special behaviour. Each ball owns exactly one
 * ability. Hooks are invoked by the World in this order every fixed step:
 *
 *   prePhysics → (integrate, walls → onWallBounce, ball contacts → onBallContact)
 *   → update → statuses
 *
 * Rendering hooks receive a context already transformed into world units.
 */
export abstract class Ability {
  readonly world: World
  readonly owner: Ball

  constructor(world: World, owner: Ball) {
    this.world = world
    this.owner = owner
  }

  /** The opposing ball (1v1 matches). */
  get enemy(): Ball {
    return this.world.opponentOf(this.owner)
  }

  /** 1 while the owner lives, fading to 0 shortly after it dies. */
  get presence(): number {
    if (this.owner.alive) return 1
    return Math.max(0, 1 - (this.world.time - this.owner.deathTime) / 0.8)
  }

  prePhysics(_dt: number): void {}
  update(_dt: number): void {}
  onWallBounce(_e: WallBounce): void {}
  onBallContact(_c: BallContact): void {}
  /** Called after the owner takes damage (before death handling). */
  onOwnerDamaged(_amount: number, _opts: DamageOptions): void {}
  /** Multiplier applied to every hit the owner deals (see World.damage). */
  get outgoingDamageScale(): number {
    return 1
  }
  /** Whether the owner should physically collide with `other` this step. */
  collidesWith(_other: Ball): boolean {
    return true
  }

  /** Arena-level visuals drawn beneath all balls (tracks, threads, spikes). */
  renderBack(_ctx: CanvasRenderingContext2D): void {}
  /** Arena-wide overlay drawn above every ability's back layer but below balls (chess board). */
  renderOverlay(_ctx: CanvasRenderingContext2D): void {}
  /** Drawn just beneath the owner's ball body (legs, chains). */
  renderUnderBall(_ctx: CanvasRenderingContext2D): void {}
  /** Drawn on top of the owner's ball body, before the HP label (fangs, rings). */
  renderOverBall(_ctx: CanvasRenderingContext2D): void {}
  /** Drawn above every ball (trains, hooks). */
  renderFront(_ctx: CanvasRenderingContext2D): void {}
}

export type AbilityFactory = (world: World, owner: Ball) => Ability
