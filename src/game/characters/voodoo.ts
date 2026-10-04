import * as dm from '../core/dmath'
import { type Vec, clamp, distSq, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const R = BALL_RADIUS
const TAU = Math.PI * 2

const FIRST_DOLL = 1.0
/** Time before a new doll is placed after the enemy breaks one (s). */
export const DOLL_RESPAWN = 2.5
/** Flight time of a doll tossed onto the field (s). */
const TOSS_TIME = 0.6
const TOSS_HEIGHT = R * 2.2
/** Hit radius of the doll (touching it breaks it). */
const DOLL_RADIUS = R * 0.8
/** Drawn size of the doll relative to its hit radius. */
const DOLL_DRAW = 1.3
/** A new doll lands at least this far from the enemy (when there is room). */
const MIN_ENEMY_DISTANCE = R * 7
const PLACE_MARGIN = R * 1.8
const PLACE_TRIES = 16
/** Time between pin stabs (s). */
export const STAB_INTERVAL = 1.35
/** The first stab comes this long after a doll lands (s). */
const FIRST_STAB = 0.8
/** The pin is raised over the doll this long before it drives in (s). */
const STAB_WINDUP = 0.35
/** Damage of the first pin in a doll; every further pin in the same doll hurts more. */
export const STAB_DAMAGE = 3
export const STAB_GROWTH = 1
export const STAB_MAX = 7
const CURSE_SHOW = 0.35
const MAX_DRAWN_PINS = 9
const BREAK_SHOW = 0.3

const PIN_HEADS = ['#ef4444', '#facc15', '#f8fafc', '#a855f7', '#22c55e'] as const

interface Pin {
  /** Entry point relative to the doll centre, in doll radii. */
  x: number
  y: number
  angle: number
  color: string
}

interface Doll {
  from: Vec
  pos: Vec
  /** Time since it was tossed; it lands at TOSS_TIME. */
  age: number
  /** Pins stabbed into it so far. */
  stabs: number
  pins: Pin[]
  /** Cosmetic wobble phase. */
  phase: number
}

interface Curse {
  from: Vec
  age: number
  seed: number
}

interface Burst {
  pos: Vec
  age: number
}

/**
 * 巫毒娃娃 VOODOO — tosses a voodoo doll onto the field, away from the enemy.
 * Every so often the owner drives a pin into the doll and the enemy takes the
 * damage wherever it is (a curse arc flashes from the doll to the enemy);
 * every pin in the same doll hurts more. The enemy breaks the doll by
 * touching it; a new one is tossed out after a short cooldown.
 */
export class VoodooAbility extends Ability {
  private doll: Doll | null = null
  private placeTimer = FIRST_DOLL
  private stabTimer = FIRST_STAB
  private curses: Curse[] = []
  private breaks: Burst[] = []
  /** Seconds since the last stab, for the owner's pin jab. */
  private sinceStab = Infinity

  private get landed(): boolean {
    return this.doll !== null && this.doll.age >= TOSS_TIME
  }

  /** Damage of the next pin in the current doll. */
  private stabDamage(stabs: number): number {
    return Math.min(STAB_MAX, STAB_DAMAGE + STAB_GROWTH * stabs)
  }

  override update(dt: number): void {
    this.sinceStab += dt
    for (const c of this.curses) c.age += dt
    this.curses = this.curses.filter((c) => c.age < CURSE_SHOW)
    for (const b of this.breaks) b.age += dt
    this.breaks = this.breaks.filter((b) => b.age < BREAK_SHOW)

    const armed = this.world.combatActive && !this.owner.disarmed && this.enemy.alive
    const doll = this.doll
    if (!doll) {
      if (this.world.combatActive) this.placeTimer = Math.max(0, this.placeTimer - dt)
      if (this.placeTimer <= 0 && armed) this.toss()
      return
    }
    doll.age += dt
    if (!this.landed) return
    if (this.checkTouch(doll)) return
    if (!armed) {
      // Disarmed: the pin is lowered again and the next stab waits.
      this.stabTimer = Math.max(this.stabTimer, STAB_WINDUP)
      return
    }
    const before = this.stabTimer
    this.stabTimer -= dt
    if (before > STAB_WINDUP && this.stabTimer <= STAB_WINDUP) this.world.sound('whoosh', 0.25, 1.8)
    if (this.stabTimer <= 0) {
      this.stabTimer += STAB_INTERVAL
      this.stab(doll)
    }
  }

  /** Tosses a new doll from the owner to a random spot away from the enemy. */
  private toss(): void {
    const s = this.world.size
    const rng = this.world.rng
    const e = this.enemy.pos
    let best: Vec | null = null
    let bestD = -1
    for (let i = 0; i < PLACE_TRIES; i++) {
      const p = { x: rng.range(PLACE_MARGIN, s - PLACE_MARGIN), y: rng.range(PLACE_MARGIN, s - PLACE_MARGIN) }
      const d = distSq(p, e)
      if (d > bestD) {
        best = p
        bestD = d
      }
      if (d >= sq(MIN_ENEMY_DISTANCE)) break
    }
    const o = this.owner.pos
    this.doll = { from: { x: o.x, y: o.y }, pos: best!, age: 0, stabs: 0, pins: [], phase: this.world.effects.random() * TAU }
    this.stabTimer = FIRST_STAB
    this.world.sound('throw', 0.5, 0.8)
  }

  /** The enemy breaks the doll by touching it. Returns true when it broke. */
  private checkTouch(doll: Doll): boolean {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return false
    if (distSq(e.pos, doll.pos) >= sq(e.radius + DOLL_RADIUS)) return false
    this.doll = null
    this.placeTimer = DOLL_RESPAWN
    this.breaks.push({ pos: { x: doll.pos.x, y: doll.pos.y }, age: 0 })
    const fx = this.world.effects
    fx.burst(doll.pos, {
      count: 14,
      color: ['#f5f5f4', '#e7e5e4', '#fafaf9'],
      shape: 'smoke',
      speed: [40, 180],
      size: [5, 10],
      life: [0.4, 0.9],
      endScale: 1.6,
      drag: 3,
    })
    fx.burst(doll.pos, { count: 10, color: ['#b08150', '#8b5a2b', '#d6a76a'], shape: 'shard', speed: [120, 320], size: [3, 6], life: [0.35, 0.7] })
    fx.burst(doll.pos, { count: 8, color: ['#e5e7eb', '#a855f7', '#ef4444'], shape: 'spark', speed: [120, 300], size: [1.5, 3], life: [0.2, 0.4] })
    fx.burst(doll.pos, { count: 1, color: '#c084fc', shape: 'ring', speed: [0, 0], size: [DOLL_RADIUS, DOLL_RADIUS], life: [0.35, 0.35], endScale: 3 })
    this.world.sound('clack', 0.8, 0.6)
    this.world.sound('web', 0.6, 0.6)
    return true
  }

  private stab(doll: Doll): void {
    const e = this.enemy
    const dmg = this.stabDamage(doll.stabs)
    doll.stabs += 1
    const fx = this.world.effects
    // Cosmetic: where the pin sits in the doll.
    const px = (fx.random() - 0.5) * 1.1
    const py = -0.9 + fx.random() * 1.6
    doll.pins.push({ x: px, y: py, angle: -Math.PI / 2 + (fx.random() - 0.5) * 1.3, color: PIN_HEADS[doll.stabs % PIN_HEADS.length] })
    if (doll.pins.length > MAX_DRAWN_PINS) doll.pins.shift()
    this.sinceStab = 0
    this.curses.push({ from: { x: doll.pos.x, y: doll.pos.y }, age: 0, seed: fx.random() * 1000 })
    const at = { x: doll.pos.x + px * DOLL_RADIUS, y: doll.pos.y + py * DOLL_RADIUS }
    fx.burst(at, { count: 6, color: ['#a855f7', '#7c3aed', '#f0abfc'], shape: 'spark', speed: [60, 180], size: [1.5, 3], life: [0.15, 0.35] })
    fx.burst(doll.pos, {
      count: 4,
      color: ['#581c87', '#7c3aed'],
      shape: 'smoke',
      speed: [10, 60],
      size: [6, 10],
      life: [0.4, 0.8],
      endScale: 1.8,
      front: false,
    })
    this.world.sound('spike', 0.5, 1.5)
    this.world.damage(e, dmg, { kind: 'voodoo', source: this.owner, at: e.pos, shake: dmg >= 6 ? 3 : 1.5 })
  }

  // ───────────────────────────── rendering ─────────────────────────────

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const doll = this.doll
    const now = this.world.time
    ctx.save()
    ctx.globalAlpha = fade
    if (doll && this.landed && this.enemy.alive) {
      // The soul thread binding the doll to its victim.
      const e = this.enemy.pos
      ctx.strokeStyle = 'rgba(192,132,252,0.45)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 7])
      ctx.lineDashOffset = -now * 30
      ctx.beginPath()
      ctx.moveTo(doll.pos.x, doll.pos.y)
      ctx.lineTo(e.x, e.y)
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (doll) {
      const u = clamp(doll.age / TOSS_TIME, 0, 1)
      const gx = doll.from.x + (doll.pos.x - doll.from.x) * u
      const gy = doll.from.y + (doll.pos.y - doll.from.y) * u
      const lift = dm.sin(Math.PI * u) * TOSS_HEIGHT
      // Shadow on the floor.
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.beginPath()
      ctx.ellipse(gx, gy + DOLL_RADIUS * 1.3, DOLL_RADIUS * (1.1 - 0.3 * (lift / TOSS_HEIGHT)), DOLL_RADIUS * 0.25, 0, 0, TAU)
      ctx.fill()
      if (u >= 1) {
        // Cursed aura, flaring while a pin is raised.
        const windup = this.windupLevel()
        const pulse = 0.75 + 0.25 * dm.sin(now * 4 + doll.phase)
        const ar = DOLL_RADIUS * (1.9 + 0.4 * windup)
        const g = ctx.createRadialGradient(gx, gy, DOLL_RADIUS * 0.3, gx, gy, ar)
        g.addColorStop(0, `rgba(168,85,247,${0.4 * pulse + 0.35 * windup})`)
        g.addColorStop(1, 'rgba(88,28,135,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(gx, gy, ar, 0, TAU)
        ctx.fill()
      }
      const wobble = u >= 1 ? dm.sin(now * 2.2 + doll.phase) * 0.06 + this.recoil() * 0.12 : (1 - u) * TAU * 1.5
      drawDoll(ctx, gx, gy - lift, DOLL_RADIUS * DOLL_DRAW, wobble, this.enemy.color, doll.pins)
      if (u >= 1) this.drawRaisedPin(ctx, doll)
    }
    ctx.restore()
  }

  /** 0..1 while the next pin is being raised over the doll. */
  private windupLevel(): number {
    if (!this.landed || this.owner.disarmed || !this.world.combatActive) return 0
    return clamp(1 - this.stabTimer / STAB_WINDUP, 0, 1)
  }

  /** 1 right after a stab, easing to 0. */
  private recoil(): number {
    return clamp(1 - this.sinceStab / 0.2, 0, 1)
  }

  private drawRaisedPin(ctx: CanvasRenderingContext2D, doll: Doll): void {
    const w = this.windupLevel()
    if (w <= 0) return
    // Rises above the doll, then (at w = 1) drives in.
    const rise = dm.sin(Math.min(1, w * 1.4) * Math.PI * 0.5)
    const x = doll.pos.x + DOLL_RADIUS * 0.15
    const tipY = doll.pos.y - DOLL_RADIUS * (0.8 + 1.2 * rise)
    ctx.save()
    ctx.globalAlpha *= clamp(w * 3, 0, 1)
    drawPin(ctx, x, tipY, Math.PI / 2 - 0.15, DOLL_RADIUS * 1.5, '#ef4444')
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawStitches(ctx, o.pos.x, o.pos.y, o.radius)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const o = this.owner
    ctx.save()
    ctx.globalAlpha = fade
    // The owner's own big pin, mirroring every stab.
    if (o.alive) {
      const w = this.windupLevel()
      const jab = this.recoil()
      const lift = (w > 0 ? dm.sin(Math.min(1, w * 1.4) * Math.PI * 0.5) : 0) * 0.5 - jab * 0.35
      const tipX = o.pos.x + o.radius * 0.9
      const tipY = o.pos.y - o.radius * (0.55 + lift)
      drawPin(ctx, tipX, tipY, Math.PI / 2 + 0.5, o.radius * 1.35, '#ef4444')
    }
    // Curse arcs from the doll to the enemy.
    const e = this.enemy
    for (const c of this.curses) drawCurse(ctx, c.from, e.pos, 1 - c.age / CURSE_SHOW, c.seed, this.world.time)
    for (const b of this.breaks) {
      const u = b.age / BREAK_SHOW
      ctx.globalAlpha = fade * (1 - u)
      ctx.strokeStyle = '#e9d5ff'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      const r = DOLL_RADIUS * (0.8 + 1.2 * u)
      // A cracked "X" flash where the doll was torn apart.
      ctx.beginPath()
      ctx.moveTo(b.pos.x - r, b.pos.y - r)
      ctx.lineTo(b.pos.x + r, b.pos.y + r)
      ctx.moveTo(b.pos.x + r, b.pos.y - r)
      ctx.lineTo(b.pos.x - r, b.pos.y + r)
      ctx.stroke()
    }
    ctx.restore()
  }
}

/** A jagged violet bolt from `from` to `to`, `alpha` 0..1. */
function drawCurse(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, alpha: number, seed: number, time: number): void {
  if (alpha <= 0) return
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = dm.hypot(dx, dy) || 1
  const nx = -dy / d
  const ny = dx / d
  const segs = Math.max(4, Math.round(d / 28))
  const flicker = Math.floor(time * 30)
  const path = (amp: number): void => {
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    for (let i = 1; i < segs; i++) {
      const u = i / segs
      const off = dm.sin(seed + i * 12.9898 + flicker * 4.1) * amp * dm.sin(Math.PI * u)
      ctx.lineTo(from.x + dx * u + nx * off, from.y + dy * u + ny * off)
    }
    ctx.lineTo(to.x, to.y)
  }
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.globalAlpha *= alpha
  ctx.strokeStyle = 'rgba(126,34,206,0.55)'
  ctx.lineWidth = 9
  path(14)
  ctx.stroke()
  ctx.strokeStyle = '#c084fc'
  ctx.lineWidth = 3.5
  path(14)
  ctx.stroke()
  ctx.strokeStyle = '#faf5ff'
  ctx.lineWidth = 1.4
  path(14)
  ctx.stroke()
  ctx.restore()
}

/** A sewing pin with its point at (x, y), shaft running back along `angle` + π. */
export function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, head: string): void {
  const hx = x - dm.cos(angle) * length
  const hy = y - dm.sin(angle) * length
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = Math.max(1.4, length * 0.09)
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(hx, hy)
  ctx.stroke()
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = Math.max(0.8, length * 0.045)
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(hx, hy)
  ctx.stroke()
  const hr = Math.max(2.2, length * 0.13)
  ctx.fillStyle = head
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(hx, hy, hr, 0, TAU)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.beginPath()
  ctx.arc(hx - hr * 0.35, hy - hr * 0.35, hr * 0.35, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** Gingerbread-shaped burlap doll body (head, arms, torso, legs) as one path, in doll radii. */
function dollPath(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.beginPath()
  ctx.arc(0, -s * 0.62, s * 0.42, 0, TAU)
  ctx.roundRect(-s * 0.95, -s * 0.3, s * 1.9, s * 0.34, s * 0.17)
  ctx.roundRect(-s * 0.42, -s * 0.3, s * 0.84, s * 0.85, s * 0.2)
  ctx.roundRect(-s * 0.42, s * 0.3, s * 0.34, s * 0.72, s * 0.15)
  ctx.roundRect(s * 0.08, s * 0.3, s * 0.34, s * 0.72, s * 0.15)
}

/**
 * A burlap voodoo doll centred at (x, y), `s` = its radius. The heart patch
 * is sewn in the cursed ball's colour; `pins` stick out of it.
 */
export function drawDoll(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tilt: number, victimColor: string, pins: readonly Pin[]): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  ctx.lineJoin = 'round'
  // Dark outline first, then the cloth on top, so overlapping parts merge cleanly.
  dollPath(ctx, s)
  ctx.strokeStyle = '#3b2412'
  ctx.lineWidth = Math.max(2, s * 0.16)
  ctx.stroke()
  ctx.fillStyle = '#b8895a'
  ctx.fill()
  // Burlap weave.
  ctx.save()
  dollPath(ctx, s)
  ctx.clip()
  ctx.strokeStyle = 'rgba(92,58,28,0.28)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let k = -6; k <= 6; k++) {
    ctx.moveTo(k * s * 0.2, -s * 1.1)
    ctx.lineTo(k * s * 0.2 + s * 0.3, s * 1.1)
  }
  ctx.stroke()
  ctx.restore()
  // Stitched mouth and X-button eyes.
  ctx.strokeStyle = '#2a1708'
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1.2, s * 0.08)
  const eye = s * 0.11
  for (const ex of [-s * 0.17, s * 0.17]) {
    const ey = -s * 0.7
    ctx.beginPath()
    ctx.moveTo(ex - eye, ey - eye)
    ctx.lineTo(ex + eye, ey + eye)
    ctx.moveTo(ex + eye, ey - eye)
    ctx.lineTo(ex - eye, ey + eye)
    ctx.stroke()
  }
  ctx.lineWidth = Math.max(1, s * 0.05)
  ctx.beginPath()
  ctx.moveTo(-s * 0.2, -s * 0.46)
  ctx.lineTo(s * 0.2, -s * 0.46)
  for (let i = 0; i < 5; i++) {
    const mx = -s * 0.18 + i * s * 0.09
    ctx.moveTo(mx, -s * 0.51)
    ctx.lineTo(mx, -s * 0.41)
  }
  ctx.stroke()
  // Heart patch in the victim's colour.
  const hs = s * 0.26
  const hy = s * 0.02
  ctx.fillStyle = victimColor
  ctx.beginPath()
  ctx.moveTo(0, hy + hs * 0.9)
  ctx.bezierCurveTo(-hs * 1.4, hy, -hs * 0.8, hy - hs * 1.05, 0, hy - hs * 0.35)
  ctx.bezierCurveTo(hs * 0.8, hy - hs * 1.05, hs * 1.4, hy, 0, hy + hs * 0.9)
  ctx.fill()
  ctx.strokeStyle = '#fef3c7'
  ctx.lineWidth = Math.max(0.8, s * 0.04)
  ctx.setLineDash([s * 0.08, s * 0.07])
  ctx.stroke()
  ctx.setLineDash([])
  // Pins stuck into the doll.
  for (const p of pins) drawPin(ctx, p.x * s, p.y * s, p.angle + Math.PI, s * 0.75, p.color)
  ctx.restore()
}

/** Cross-stitched seams along the owner's ball, like a stitched-up doll. */
function drawStitches(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(254,243,199,0.75)'
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1, r * 0.05)
  // Seam arc on the left side.
  const a0 = Math.PI * 0.62
  const a1 = Math.PI * 1.38
  const rr = r * 0.78
  ctx.beginPath()
  ctx.arc(x, y, rr, a0, a1)
  ctx.stroke()
  const n = 7
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * (i + 0.5)) / n
    const cx = x + dm.cos(a) * rr
    const cy = y + dm.sin(a) * rr
    const tx = dm.cos(a) * r * 0.1
    const ty = dm.sin(a) * r * 0.1
    const px = -dm.sin(a) * r * 0.07
    const py = dm.cos(a) * r * 0.07
    ctx.moveTo(cx - tx - px, cy - ty - py)
    ctx.lineTo(cx + tx + px, cy + ty + py)
    ctx.moveTo(cx - tx + px, cy - ty + py)
    ctx.lineTo(cx + tx - px, cy + ty - py)
  }
  ctx.stroke()
  // A small patch with a button on the lower right.
  const bx = x + r * 0.5
  const by = y + r * 0.52
  ctx.fillStyle = '#3b2412'
  ctx.beginPath()
  ctx.arc(bx, by, r * 0.13, 0, TAU)
  ctx.fill()
  ctx.fillStyle = 'rgba(254,243,199,0.8)'
  ctx.beginPath()
  ctx.arc(bx - r * 0.04, by, r * 0.025, 0, TAU)
  ctx.arc(bx + r * 0.04, by, r * 0.025, 0, TAU)
  ctx.fill()
  ctx.restore()
}

export function drawVoodooPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const bx = cx - r * 0.75
  const by = cy + r * 0.55
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bx, by, r * 0.8, 0, TAU)
  ctx.fill()
  drawStitches(ctx, bx, by, r * 0.8)
  const pins: Pin[] = [
    { x: -0.25, y: -0.7, angle: -Math.PI / 2 - 0.5, color: '#ef4444' },
    { x: 0.2, y: -0.05, angle: -Math.PI / 2 + 0.6, color: '#facc15' },
    { x: -0.05, y: 0.45, angle: -0.2, color: '#f8fafc' },
  ]
  // Purple aura behind the doll.
  const dx = cx + r * 0.85
  const dy = cy - r * 0.35
  const g = ctx.createRadialGradient(dx, dy, r * 0.2, dx, dy, r * 1.5)
  g.addColorStop(0, 'rgba(168,85,247,0.55)')
  g.addColorStop(1, 'rgba(88,28,135,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(dx, dy, r * 1.5, 0, TAU)
  ctx.fill()
  drawDoll(ctx, dx, dy, r * 0.95, 0.12, '#ef4444', pins)
}

export const voodooDef: CharacterDef = {
  id: 'voodoo',
  nameEn: 'VOODOO',
  ruleValues: {
    stabInterval: STAB_INTERVAL,
    stabDamage: STAB_DAMAGE,
    stabGrowth: STAB_GROWTH,
    stabMax: STAB_MAX,
    dollRespawn: DOLL_RESPAWN,
  },
  palette: { ball: '#8b5a2b', text: '#fef3c7', accent: '#d6a76a' },
  mirrorPalette: { ball: '#5b3716', text: '#fde68a', accent: '#c08a4a' },
  create: (w, b) => new VoodooAbility(w, b),
  drawPortrait: drawVoodooPortrait,
}
