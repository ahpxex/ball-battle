import * as dm from '../core/dmath'
import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS, FIXED_DT } from '../engine/constants'
import { predictPosition } from '../engine/predict'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

const R = BALL_RADIUS
/** Owner positions kept for replaying (s). */
const HISTORY = 4.0
const FIRST_ECHO = 1.6
/** Time between echoes (s). */
export const ECHO_INTERVAL = 1.1
/** How long an echo lives, replaying that many seconds of the owner's path (s). */
export const ECHO_LIFE = 2.6
/** An echo replays the owner's path from this many seconds ago (s). */
export const LAG_MIN = 1
export const LAG_MAX = 4
const LAG_STEP = 0.1
/** Two echoes never replay lags closer than this, so they don't stack (s). */
const LAG_GAP = 0.35
/** How far ahead the enemy's path is predicted when picking a lag (s): the whole replay. */
const SCORE_HORIZON = ECHO_LIFE
const SCORE_SAMPLE = 0.1
/** Later prediction samples are trusted less: added distance per second ahead. */
const SCORE_TIME_PENALTY = 30
export const MAX_ECHOES = 3
export const ECHO_DAMAGE = 4
/** Each echo hits the same target at most once per this long (s). */
export const HIT_COOLDOWN = 0.5
const ECHO_RADIUS = R * 0.9
const ECHO_KNOCK = 120
/** A fresh echo can't hit until it has faded in (s). */
const ARM_TIME = 0.15
const FADE_IN = 0.15
const FADE_OUT = 0.3
/** Afterimage dots trailing each echo: count and spacing in steps. */
const TRAIL_DOTS = 4
const TRAIL_SPACING = 8
/** A history jump longer than this between two steps is a teleport, not motion. */
const JUMP = 40

const steps = (s: number): number => Math.round(s / FIXED_DT)
const HISTORY_STEPS = steps(HISTORY)
const LIFE_STEPS = steps(ECHO_LIFE)

interface Echo {
  /** Replay delay in simulation steps. */
  lag: number
  /** Age in simulation steps. */
  age: number
  hitCooldown: number
  /** Cosmetic shimmer phase. */
  phase: number
}

/**
 * 残影 AFTERIMAGE — records its own path. Every so often an afterimage
 * appears and replays exactly what the owner did a few seconds earlier, same
 * positions and same timing, picking the stretch of memory most likely to
 * run into the enemy. Echoes pass through everything and sting on contact.
 */
export class EchoAbility extends Ability {
  /** Ring buffer of owner positions, one per simulation step. */
  private readonly xs = new Float64Array(HISTORY_STEPS + 1)
  private readonly ys = new Float64Array(HISTORY_STEPS + 1)
  /** Number of positions recorded so far; the newest is at index `count - 1`. */
  private count = 0
  private echoes: Echo[] = []
  private timer = FIRST_ECHO

  constructor(world: World, owner: Ball) {
    super(world, owner)
  }

  override update(dt: number): void {
    this.record()
    for (const e of this.echoes) {
      e.age += 1
      e.hitCooldown = Math.max(0, e.hitCooldown - dt)
    }
    this.echoes = this.echoes.filter((e) => e.age < LIFE_STEPS)

    if (this.world.combatActive) {
      // Summoning is an attack: the countdown waits out a disarm.
      const armed = !this.owner.disarmed
      if (armed) this.timer -= dt
      if (armed && this.timer <= 0 && this.echoes.length < MAX_ECHOES && this.spawn()) this.timer += ECHO_INTERVAL
      else this.timer = Math.max(0, this.timer)
    }
    this.hitEnemy()
  }

  // ───────────────────────────── history ─────────────────────────────

  private record(): void {
    const i = this.count % this.xs.length
    this.xs[i] = this.owner.pos.x
    this.ys[i] = this.owner.pos.y
    this.count += 1
  }

  /** Owner position `back` steps before the newest sample (clamped to what's stored). */
  private past(back: number): Vec {
    const oldest = Math.max(0, this.count - this.xs.length)
    const k = Math.max(oldest, this.count - 1 - back)
    const i = k % this.xs.length
    return { x: this.xs[i], y: this.ys[i] }
  }

  private echoPos(e: Echo): Vec {
    return this.past(e.lag)
  }

  // ───────────────────────────── echoes ─────────────────────────────

  /**
   * Picks the lag whose replay comes closest to where the enemy is heading
   * and spawns an echo there. Returns false when nothing suitable is stored yet.
   */
  private spawn(): boolean {
    const enemy = this.enemy
    if (!enemy.alive) return false
    const s = this.world.size
    const available = this.count - 1
    const minLag = steps(LAG_MIN)
    const maxLag = Math.min(steps(LAG_MAX), available)
    if (maxLag < minLag) return false

    // Where the enemy will be over the echo's life (a held enemy stays put).
    const samples: { ahead: number; at: Vec }[] = []
    const every = steps(SCORE_SAMPLE)
    for (let ahead = every; ahead <= steps(SCORE_HORIZON); ahead += every) {
      const at = enemy.movable ? predictPosition(enemy, ahead * FIXED_DT, s) : { x: enemy.pos.x, y: enemy.pos.y }
      samples.push({ ahead, at })
    }
    let best = -1
    let bestScore = Infinity
    const lagStep = steps(LAG_STEP)
    for (let lag = minLag; lag <= maxLag; lag += lagStep) {
      if (this.echoes.some((e) => Math.abs(e.lag - lag) < steps(LAG_GAP))) continue
      let score = Infinity
      for (const smp of samples) {
        // Only the part of the replay that is already recorded can be scored.
        if (smp.ahead > lag) break
        const p = this.past(lag - smp.ahead)
        const d = dm.hypot(p.x - smp.at.x, p.y - smp.at.y) + smp.ahead * FIXED_DT * SCORE_TIME_PENALTY
        if (d < score) score = d
      }
      if (score < bestScore) {
        bestScore = score
        best = lag
      }
    }
    if (best < 0) return false

    const echo: Echo = { lag: best, age: 0, hitCooldown: 0, phase: this.world.effects.random() * Math.PI * 2 }
    this.echoes.push(echo)
    const at = this.echoPos(echo)
    const fx = this.world.effects
    fx.burst(at, {
      count: 1,
      color: '#fda4af',
      shape: 'ring',
      speed: [0, 0],
      size: [ECHO_RADIUS * 0.5, ECHO_RADIUS * 0.5],
      life: [0.35, 0.35],
      endScale: 2.6,
      front: false,
    })
    fx.burst(at, {
      count: 10,
      color: [this.owner.color, '#fda4af', '#ffffff'],
      shape: 'spark',
      speed: [40, 160],
      size: [1.5, 3],
      life: [0.25, 0.5],
      jitter: ECHO_RADIUS * 0.5,
      front: false,
    })
    this.world.sound('whoosh', 0.35, 0.6)
    return true
  }

  private hitEnemy(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const reach = e.radius + ECHO_RADIUS
    for (const echo of this.echoes) {
      if (echo.hitCooldown > 0 || echo.age * FIXED_DT < ARM_TIME) continue
      const p = this.echoPos(echo)
      const dx = e.pos.x - p.x
      const dy = e.pos.y - p.y
      const d2 = dx * dx + dy * dy
      if (d2 >= reach * reach) continue
      const d = Math.sqrt(d2)
      const nx = d > 1e-6 ? dx / d : 1
      const ny = d > 1e-6 ? dy / d : 0
      echo.hitCooldown = HIT_COOLDOWN
      this.world.damage(e, ECHO_DAMAGE, {
        kind: 'echo',
        source: this.owner,
        at: { x: p.x + nx * ECHO_RADIUS, y: p.y + ny * ECHO_RADIUS },
        knock: { x: nx * ECHO_KNOCK, y: ny * ECHO_KNOCK },
        shake: 2,
      })
      if (!e.alive) return
    }
  }

  // ───────────────────────────── rendering ─────────────────────────────

  private echoAlpha(e: Echo): number {
    const t = e.age * FIXED_DT
    return Math.min(clamp(t / FADE_IN, 0, 1), clamp((ECHO_LIFE - t) / FADE_OUT, 0, 1))
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.echoes.length === 0) return
    const color = this.owner.color
    const now = this.world.time
    ctx.save()
    for (const e of this.echoes) {
      const a = this.echoAlpha(e) * fade
      if (a <= 0) continue
      // Trail: the path this echo just replayed, never reaching back before it appeared.
      const span = Math.min(e.age, TRAIL_DOTS * TRAIL_SPACING)
      const pts: Vec[] = []
      for (let k = span; k >= 0; k -= 1) pts.push(this.past(e.lag + k))
      drawEchoTrail(ctx, pts, ECHO_RADIUS, color, a)
      for (let i = TRAIL_DOTS; i >= 1; i--) {
        const back = i * TRAIL_SPACING
        if (back > e.age) continue
        const p = this.past(e.lag + back)
        drawEcho(ctx, p.x, p.y, ECHO_RADIUS * (1 - i * 0.08), color, a * 0.4 * (1 - i / (TRAIL_DOTS + 1)), 0, false)
      }
      const p = this.echoPos(e)
      drawEcho(ctx, p.x, p.y, ECHO_RADIUS, color, a, now * 2 + e.phase)
    }
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    // The owner itself leaves a faint double image behind it.
    const o = this.owner
    const color = o.color
    ctx.save()
    for (const [back, alpha] of [
      [16, 0.14],
      [8, 0.26],
    ] as const) {
      if (back >= this.count) continue
      const p = this.past(back)
      if (dm.hypot(p.x - o.pos.x, p.y - o.pos.y) > JUMP * 2) continue
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p.x, p.y, o.radius * o.drawScale, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

/** Fading ribbon along `pts` (oldest first); segments across teleports are skipped. */
function drawEchoTrail(ctx: CanvasRenderingContext2D, pts: readonly Vec[], r: number, color: string, alpha: number): void {
  const n = pts.length
  if (n < 2) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = color
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (dm.hypot(b.x - a.x, b.y - a.y) > JUMP) continue
    const u = i / (n - 1)
    ctx.globalAlpha = alpha * 0.28 * u
    ctx.lineWidth = r * (0.5 + 1.3 * u)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * A translucent copy of the ball: tinted body, a glitchy double rim and a
 * small rewind mark (`glyph`). `shimmer` drives the rim's flicker (0 = steady).
 */
export function drawEcho(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, shimmer: number, glyph = true): void {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  const base = ctx.globalAlpha
  ctx.fillStyle = color
  ctx.globalAlpha = base * 0.34
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = base
  // Hollow core so it reads as a ghost, not a ball.
  ctx.fillStyle = 'rgba(255,255,255,0.1)'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2)
  ctx.fill()
  // A "rewind" mark: this is a replay.
  if (glyph) {
    const g = r * 0.2
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.beginPath()
    for (const off of [-g * 0.95, g * 0.95]) {
      ctx.moveTo(x + off - g, y)
      ctx.lineTo(x + off + g * 0.9, y - g)
      ctx.lineTo(x + off + g * 0.9, y + g)
      ctx.closePath()
    }
    ctx.fill()
  }
  const jitter = shimmer === 0 ? 0 : 1.6 * dm.sin(shimmer * 3.1)
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(253,164,175,0.85)'
  ctx.beginPath()
  ctx.arc(x - 1.5 - jitter, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(x + 1.5 + jitter, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawEchoPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // Echoes trailing down-left along a gentle arc, the ball itself leading.
  const pts: Vec[] = []
  for (let i = 0; i <= 24; i++) {
    const u = i / 24
    pts.push({ x: cx - r * 1.55 + u * r * 2.35, y: cy + r * 1.35 - u * r * 2.0 - dm.sin(u * Math.PI) * r * 0.45 })
  }
  drawEchoTrail(ctx, pts, r * 0.8, color, 1.4)
  for (const [i, a] of [
    [0, 0.55],
    [9, 0.8],
  ] as const) {
    drawEcho(ctx, pts[i].x, pts[i].y, r * 0.72, color, a, 0, i === 9)
  }
  const head = pts[24]
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(head.x, head.y, r * 0.85, 0, Math.PI * 2)
  ctx.fill()
}

export const echoDef: CharacterDef = {
  id: 'echo',
  nameEn: 'AFTERIMAGE',
  ruleValues: {
    echoInterval: ECHO_INTERVAL,
    lagMin: LAG_MIN,
    lagMax: LAG_MAX,
    echoLife: ECHO_LIFE,
    maxEchoes: MAX_ECHOES,
    echoDamage: ECHO_DAMAGE,
    hitCooldown: HIT_COOLDOWN,
  },
  palette: { ball: '#fb7185', text: '#ffffff', accent: '#fda4af' },
  mirrorPalette: { ball: '#9f1239', text: '#ffe4e6', accent: '#fb7185' },
  create: (w, b) => new EchoAbility(w, b),
  drawPortrait: drawEchoPortrait,
}
