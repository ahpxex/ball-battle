import * as dm from '../core/dmath'
import type { Vec } from '../core/vec'
import { BALL_RADIUS, BASE_SPEED, STARTING_HP } from './constants'
import type { CharacterId, Team } from './types'

export interface PoisonStack {
  ticksLeft: number
  timer: number
  source: Ball | null
}

export interface BallInit {
  id: number
  team: Team
  charId: CharacterId
  color: string
  textColor: string
  pos: Vec
  vel: Vec
}

export class Ball {
  readonly id: number
  readonly team: Team
  readonly charId: CharacterId
  /** Fill color (may differ from the character default in mirror matches; the mimic recolours itself). */
  color: string
  textColor: string

  pos: Vec
  vel: Vec
  radius = BALL_RADIUS
  mass = 1
  baseSpeed = BASE_SPEED

  hp = STARTING_HP
  readonly maxHp = STARTING_HP
  alive = true
  /** World time of death, or -1 while alive. */
  deathTime = -1

  /**
   * A pinned ball is positioned by its ability instead of by physics
   * (e.g. a vampire latched onto its prey). Pinned balls ignore knockback.
   */
  pinned = false
  /** Ball this one is physically attached to; the pair does not collide. */
  attachedTo: Ball | null = null

  /** Visual-only size multiplier (e.g. sinking into quicksand). */
  drawScale = 1
  /** Visual-only opacity (e.g. swallowed by a frog). */
  opacity = 1

  /** Set by an ability while the ball can't be hurt (overtime still applies). */
  invulnerable = false

  /** Seconds of white hit flash remaining. */
  flash = 0
  poison: PoisonStack[] = []
  slowTimer = 0
  slowFactor = 1
  /** Seconds the ball is held in place (e.g. caught in a web). */
  rootTimer = 0
  /** Heading to resume when a root ends. */
  private rootHeading = 0
  /** Seconds the ball can't start new attacks (hammer hits disarm). */
  disarmTimer = 0

  constructor(init: BallInit) {
    this.id = init.id
    this.team = init.team
    this.charId = init.charId
    this.color = init.color
    this.textColor = init.textColor
    this.pos = init.pos
    this.vel = init.vel
  }

  get speedFactor(): number {
    return this.slowTimer > 0 ? this.slowFactor : 1
  }

  get rooted(): boolean {
    return this.rootTimer > 0
  }

  /** Whether physics may move this ball (not pinned by its ability, not rooted). */
  get movable(): boolean {
    return !this.pinned && this.rootTimer <= 0
  }

  get disarmed(): boolean {
    return this.disarmTimer > 0
  }

  applyDisarm(duration: number): void {
    this.disarmTimer = Math.max(this.disarmTimer, duration)
  }

  get poisonStacks(): number {
    return this.poison.length
  }

  applySlow(factor: number, duration: number): void {
    // Keep the strongest active slow, refresh duration.
    if (this.slowTimer <= 0 || factor <= this.slowFactor) this.slowFactor = factor
    this.slowTimer = Math.max(this.slowTimer, duration)
  }

  applyRoot(duration: number): void {
    if (this.rootTimer <= 0 && (this.vel.x !== 0 || this.vel.y !== 0)) {
      this.rootHeading = dm.atan2(this.vel.y, this.vel.x)
    }
    this.rootTimer = Math.max(this.rootTimer, duration)
    this.vel = { x: 0, y: 0 }
  }

  /** Ends a root early; the ball resumes its old heading. */
  endRoot(): void {
    if (this.rootTimer <= 0) return
    this.rootTimer = 0
    const s = this.baseSpeed * 0.5
    this.vel = { x: dm.cos(this.rootHeading) * s, y: dm.sin(this.rootHeading) * s }
  }

  /** Advances the root timer; on release the ball resumes its old heading. */
  tickRoot(dt: number): void {
    if (this.rootTimer <= 0) return
    this.rootTimer = Math.max(0, this.rootTimer - dt)
    this.vel = { x: 0, y: 0 }
    if (this.rootTimer === 0) {
      const s = this.baseSpeed * 0.5
      this.vel = { x: dm.cos(this.rootHeading) * s, y: dm.sin(this.rootHeading) * s }
    }
  }

  applyPoison(ticks: number, source: Ball | null, maxStacks: number): void {
    if (this.poison.length >= maxStacks) {
      // Refresh the oldest stack instead of growing without bound.
      this.poison.sort((a, b) => a.ticksLeft - b.ticksLeft)
      this.poison[0].ticksLeft = ticks
      return
    }
    this.poison.push({ ticksLeft: ticks, timer: 1, source })
  }
}
