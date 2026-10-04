import * as dm from '../core/dmath'
import { Rng } from '../core/rng'
import { type Vec, clamp, damp, fromAngle, len } from '../core/vec'
import type { Ability, AbilityFactory } from './Ability'
import { Ball } from './Ball'
import {
  ARENA_SIZE,
  COUNTDOWN_DURATION,
  ENDING_DURATION,
  OVERTIME_START,
  OVERTIME_TICK,
  SPEED_RECOVERY,
} from './constants'
import { Effects } from './effects'
import { spawnHitEffects } from './hitEffects'
import type {
  BallContact,
  CharacterId,
  DamageOptions,
  GameEvent,
  Phase,
  SoundId,
  Team,
  TeamStats,
  Wall,
  WallBounce,
} from './types'

export interface FighterSetup {
  charId: CharacterId
  color: string
  textColor: string
  createAbility: AbilityFactory
}

export interface WorldOptions {
  seed: number
  fighters: readonly [FighterSetup, FighterSetup]
  /** Disable particles/text/sound events for fast headless simulation. */
  headless?: boolean
}

const emptyStats = (): TeamStats => ({ damageDealt: 0, healing: 0, hits: 0, biggestHit: 0 })

/** Minimum fraction of speed on each axis, so balls never get stuck bouncing in a straight line. */
const MIN_AXIS_RATIO = 0.22

export class World {
  readonly size = ARENA_SIZE
  readonly seed: number
  readonly rng: Rng
  readonly effects: Effects
  readonly headless: boolean
  readonly balls: readonly [Ball, Ball]
  readonly abilities: readonly [Ability, Ability]
  readonly stats: [TeamStats, TeamStats] = [emptyStats(), emptyStats()]

  /** Total simulated time, including countdown and ending. */
  time = 0
  /** Time spent in the 'fight' phase. */
  fightTime = 0
  phase: Phase = 'countdown'
  winner: Team | null = null
  /** Current screen shake amplitude in world units. */
  shake = 0
  overtime = false

  private events: GameEvent[] = []
  private countdown = COUNTDOWN_DURATION
  private endingTimer = 0
  private overtimeTimer = 0
  /** While set, lethal damage is queued so simultaneous hits resolve together. */
  private deferKills = false
  private pendingKills: Ball[] = []
  /** Rounding remainder of scaled damage per attacking team, so a ×1.3 bonus on 1-damage hits still averages 1.3. */
  private damageCarry: [number, number] = [0, 0]

  constructor(opts: WorldOptions) {
    this.seed = opts.seed
    this.rng = new Rng(opts.seed)
    this.headless = opts.headless ?? false
    this.effects = new Effects(opts.seed)
    this.effects.enabled = !this.headless

    const s = this.size
    const makeBall = (team: Team, setup: FighterSetup): Ball => {
      // Launch roughly diagonally in a random quadrant.
      const quadrant = this.rng.int(0, 3)
      const angle = quadrant * (Math.PI / 2) + this.rng.range(0.35, Math.PI / 2 - 0.35)
      return new Ball({
        id: team + 1,
        team,
        charId: setup.charId,
        color: setup.color,
        textColor: setup.textColor,
        pos: { x: team === 0 ? s * 0.25 : s * 0.75, y: s * 0.5 },
        vel: fromAngle(angle, 1),
      })
    }
    const b0 = makeBall(0, opts.fighters[0])
    const b1 = makeBall(1, opts.fighters[1])
    for (const b of [b0, b1]) b.vel = fromAngle(dm.atan2(b.vel.y, b.vel.x), b.baseSpeed)
    this.balls = [b0, b1]
    this.abilities = [opts.fighters[0].createAbility(this, b0), opts.fighters[1].createAbility(this, b1)]
  }

  // ───────────────────────────── queries ─────────────────────────────

  opponentOf(ball: Ball): Ball {
    return this.balls[ball.team === 0 ? 1 : 0]
  }

  abilityOf(ball: Ball): Ability {
    return this.abilities[ball.team]
  }

  get finished(): boolean {
    return this.phase === 'finished'
  }

  /** Drains queued events (sounds, KO, finish). */
  drainEvents(): GameEvent[] {
    const e = this.events
    this.events = []
    return e
  }

  // ───────────────────────────── mutation API for abilities ─────────────────────────────

  sound(sound: SoundId, volume = 1, pitch = 1): void {
    if (this.headless) return
    this.events.push({ type: 'sound', sound, volume, pitch })
  }

  addShake(amount: number): void {
    this.shake = Math.min(14, this.shake + amount)
  }

  /** Whether hits currently count (no damage during countdown or after a KO). */
  get combatActive(): boolean {
    return this.phase === 'fight'
  }

  damage(target: Ball, amount: number, opts: DamageOptions): number {
    if (!target.alive || !this.combatActive) return 0
    if (target.invulnerable && opts.kind !== 'overtime') {
      this.effects.burst(opts.at ?? target.pos, { count: 4, color: ['#bfdbfe', '#ffffff'], shape: 'spark', speed: [80, 200], size: [1.5, 3], life: [0.15, 0.3] })
      return 0
    }
    const dmg = this.scaledDamage(amount, opts.source)
    target.hp -= dmg
    target.flash = Math.max(target.flash, opts.kind === 'poison' ? 0.06 : 0.12)

    const attackerTeam: Team | null = opts.source
      ? opts.source.team
      : opts.noCredit || opts.kind === 'overtime'
        ? null
        : target.team === 0
          ? 1
          : 0
    if (attackerTeam !== null) {
      const st = this.stats[attackerTeam]
      st.damageDealt += dmg
      st.hits += 1
      st.biggestHit = Math.max(st.biggestHit, dmg)
    }

    if (opts.knock && target.movable) {
      target.vel.x += opts.knock.x
      target.vel.y += opts.knock.y
    }
    if (opts.shake) this.addShake(opts.shake)

    if (!this.headless) spawnHitEffects(this, target, dmg, opts)
    this.abilityOf(target).onOwnerDamaged(dmg, opts)

    if (target.hp <= 0) {
      if (!this.deferKills) this.kill(target)
      else if (!this.pendingKills.includes(target)) this.pendingKills.push(target)
    }
    return dmg
  }

  /** Applies the attacker's outgoing damage scale, carrying the rounding remainder to its next hit. */
  private scaledDamage(amount: number, source: Ball | undefined): number {
    const scale = source ? this.abilityOf(source).outgoingDamageScale : 1
    if (!source || scale === 1) return Math.max(1, Math.round(amount))
    const raw = amount * scale + this.damageCarry[source.team]
    const dmg = Math.max(1, Math.round(raw))
    this.damageCarry[source.team] = raw - dmg
    return dmg
  }

  heal(target: Ball, amount: number): void {
    if (!target.alive || !this.combatActive) return
    const value = Math.round(amount)
    target.hp += value
    this.stats[target.team].healing += value
    const e = this.effects
    e.text(`+${value}`, { x: target.pos.x - 18, y: target.pos.y - target.radius - 14 }, '#4ade80')
  }

  // ───────────────────────────── simulation ─────────────────────────────

  step(dt: number): void {
    this.time += dt
    this.effects.update(dt)
    this.shake = Math.max(0, this.shake - this.shake * 9 * dt - 2 * dt)
    for (const b of this.balls) b.flash = Math.max(0, b.flash - dt)

    if (this.phase === 'finished') return
    if (this.phase === 'countdown') {
      this.countdown -= dt
      if (this.countdown <= 0) {
        this.phase = 'fight'
        this.sound('start')
      }
      return
    }

    if (this.phase === 'fight') this.fightTime += dt

    const [a0, a1] = this.abilities
    if (a0.owner.alive) a0.prePhysics(dt)
    if (a1.owner.alive) a1.prePhysics(dt)

    this.integrate(dt)
    this.collideWalls()
    this.collideBalls()

    if (a0.owner.alive) a0.update(dt)
    if (a1.owner.alive) a1.update(dt)

    this.updateStatuses(dt)
    this.updateOvertime(dt)

    if (this.phase === 'ending') {
      this.endingTimer -= dt
      if (this.endingTimer <= 0) {
        this.phase = 'finished'
        this.events.push({ type: 'finished', winner: this.winner })
        this.sound('win')
      }
    }
  }

  private integrate(dt: number): void {
    const k = damp(SPEED_RECOVERY, dt)
    for (const b of this.balls) {
      if (!b.alive || !b.movable) continue
      const target = b.baseSpeed * b.speedFactor
      let speed = len(b.vel)
      if (speed < 1e-3) {
        // Fully stopped (e.g. frozen): stay put until allowed to move again.
        if (target < 1e-3) continue
        b.vel = fromAngle(this.rng.range(0, Math.PI * 2), target)
        speed = target
      }
      const newSpeed = speed + (target - speed) * k
      let vx = (b.vel.x / speed) * newSpeed
      let vy = (b.vel.y / speed) * newSpeed
      // Gently steer away from near axis-aligned paths.
      const minAxis = newSpeed * MIN_AXIS_RATIO
      if (Math.abs(vx) < minAxis) vx += Math.sign(vx || 1) * (minAxis - Math.abs(vx)) * damp(3, dt)
      if (Math.abs(vy) < minAxis) vy += Math.sign(vy || 1) * (minAxis - Math.abs(vy)) * damp(3, dt)
      b.vel.x = vx
      b.vel.y = vy
      b.pos.x += vx * dt
      b.pos.y += vy * dt
    }
  }

  private collideWalls(): void {
    const s = this.size
    for (const b of this.balls) {
      if (!b.alive) continue
      const r = b.radius
      const bounce = (wall: Wall, point: Vec, normal: Vec, impactSpeed: number) => {
        if (!b.movable) return
        const e: WallBounce = { ball: b, wall, point, normal, impactSpeed }
        this.abilityOf(b).onWallBounce(e)
        this.sound('bounce', clamp(impactSpeed / 600, 0.15, 0.6))
      }
      if (b.pos.x < r) {
        b.pos.x = r
        if (b.vel.x < 0) {
          const imp = -b.vel.x
          b.vel.x = imp
          bounce('left', { x: 0, y: b.pos.y }, { x: 1, y: 0 }, imp)
        }
      } else if (b.pos.x > s - r) {
        b.pos.x = s - r
        if (b.vel.x > 0) {
          const imp = b.vel.x
          b.vel.x = -imp
          bounce('right', { x: s, y: b.pos.y }, { x: -1, y: 0 }, imp)
        }
      }
      if (b.pos.y < r) {
        b.pos.y = r
        if (b.vel.y < 0) {
          const imp = -b.vel.y
          b.vel.y = imp
          bounce('top', { x: b.pos.x, y: 0 }, { x: 0, y: 1 }, imp)
        }
      } else if (b.pos.y > s - r) {
        b.pos.y = s - r
        if (b.vel.y > 0) {
          const imp = b.vel.y
          b.vel.y = -imp
          bounce('bottom', { x: b.pos.x, y: s }, { x: 0, y: -1 }, imp)
        }
      }
    }
  }

  private collideBalls(): void {
    const [a, b] = this.balls
    if (!a.alive || !b.alive) return
    if (a.attachedTo === b || b.attachedTo === a) return
    const aa = this.abilityOf(a)
    const ab = this.abilityOf(b)
    if (!aa.collidesWith(b) || !ab.collidesWith(a)) return

    const dx = b.pos.x - a.pos.x
    const dy = b.pos.y - a.pos.y
    const minD = a.radius + b.radius
    const d2 = dx * dx + dy * dy
    if (d2 >= minD * minD) return
    const d = Math.sqrt(d2) || 1e-6
    const nx = dx / d
    const ny = dy / d

    const invA = a.movable ? 1 / a.mass : 0
    const invB = b.movable ? 1 / b.mass : 0
    const invSum = invA + invB
    if (invSum === 0) return

    const overlap = minD - d
    a.pos.x -= nx * overlap * (invA / invSum)
    a.pos.y -= ny * overlap * (invA / invSum)
    b.pos.x += nx * overlap * (invB / invSum)
    b.pos.y += ny * overlap * (invB / invSum)

    const rel = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny
    const closing = Math.max(0, -rel)
    if (rel < 0) {
      const j = (-2 * rel) / invSum
      a.vel.x -= nx * j * invA
      a.vel.y -= ny * j * invA
      b.vel.x += nx * j * invB
      b.vel.y += ny * j * invB
      this.sound('clack', clamp(closing / 700, 0.2, 0.8))
    }

    const point = { x: a.pos.x + nx * a.radius, y: a.pos.y + ny * a.radius }
    const ca: BallContact = { other: b, point, normal: { x: nx, y: ny }, closingSpeed: closing }
    const cb: BallContact = { other: a, point, normal: { x: -nx, y: -ny }, closingSpeed: closing }
    aa.onBallContact(ca)
    ab.onBallContact(cb)
  }

  private updateStatuses(dt: number): void {
    for (const b of this.balls) {
      if (!b.alive) continue
      if (b.slowTimer > 0) b.slowTimer = Math.max(0, b.slowTimer - dt)
      b.tickRoot(dt)
      if (b.disarmTimer > 0) b.disarmTimer = Math.max(0, b.disarmTimer - dt)
      if (b.poison.length === 0) continue
      for (const p of b.poison) {
        p.timer -= dt
        if (p.timer <= 0 && b.alive) {
          p.timer += 1
          p.ticksLeft -= 1
          this.damage(b, 1, { kind: 'poison', source: p.source ?? undefined })
        }
      }
      b.poison = b.poison.filter((p) => p.ticksLeft > 0)
    }
  }

  private updateOvertime(dt: number): void {
    if (this.phase !== 'fight' || this.fightTime < OVERTIME_START) return
    if (!this.overtime) {
      this.overtime = true
      this.sound('trainHorn', 0.6, 0.7)
    }
    this.overtimeTimer -= dt
    if (this.overtimeTimer > 0) return
    this.overtimeTimer += OVERTIME_TICK
    const extra = Math.floor((this.fightTime - OVERTIME_START) / 15)
    // Both balls are drained at the same instant; if both drop, it's a draw.
    this.deferKills = true
    for (const b of this.balls) this.damage(b, 1 + extra, { kind: 'overtime' })
    this.deferKills = false
    for (const b of this.pendingKills) this.kill(b)
    this.pendingKills = []
  }

  private kill(ball: Ball): void {
    ball.hp = 0
    ball.alive = false
    ball.deathTime = this.time
    ball.pinned = false
    ball.attachedTo = null
    for (const other of this.balls) if (other.attachedTo === ball) other.attachedTo = null

    this.effects.burst(ball.pos, {
      count: 46,
      color: [ball.color, ball.color, '#ffffff'],
      speed: [120, 520],
      size: [3, 9],
      life: [0.5, 1.2],
      drag: 2.6,
    })
    this.effects.burst(ball.pos, {
      count: 14,
      color: '#9ca3af',
      shape: 'smoke',
      speed: [20, 120],
      size: [10, 22],
      life: [0.7, 1.4],
      endScale: 2.2,
      drag: 2,
    })
    this.effects.burst(ball.pos, {
      count: 1,
      color: '#ffffff',
      shape: 'ring',
      speed: [0, 0],
      size: [ball.radius, ball.radius],
      life: [0.5, 0.5],
      endScale: 4,
    })
    this.addShake(12)
    this.sound('death')
    this.events.push({ type: 'ko', loser: ball.team })

    if (this.phase === 'fight') {
      this.phase = 'ending'
      this.endingTimer = ENDING_DURATION
    }
    const survivors = this.balls.filter((b) => b.alive)
    this.winner = survivors.length === 1 ? survivors[0].team : null
  }
}
