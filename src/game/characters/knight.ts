import * as dm from '../core/dmath'
import { closestPointOnSegment } from '../core/geometry'
import { type Vec, angleDiff, clamp, damp, distSq, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import type { BallContact } from '../engine/types'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

/** Sword stances last a random duration in [MODE_MIN, MODE_MAX] seconds. */
export const MODE_MIN = 2
export const MODE_MAX = 8
/** Shield stances are shorter: [SHIELD_MIN, SHIELD_MAX] seconds. */
export const SHIELD_MIN = 1.5
export const SHIELD_MAX = 3

export const SWORD_DAMAGE = 6
/** Half-width of the swing either side of the enemy direction. */
export const SWING_AMPLITUDE_DEG = 80
const SWING_AMPLITUDE = (SWING_AMPLITUDE_DEG * Math.PI) / 180
/** One full back-and-forth swing (s). */
export const SWING_PERIOD = 0.8
/** Minimum gap between two hits on the same target: one swing half-cycle (s). */
export const SWORD_COOLDOWN = 0.4
/** No strike can land this soon after drawing the sword (s). */
const SWORD_READY_DELAY = 0.5
const KNOCK = 260

/** Sword layout along the blade, as multiples of the ball radius. */
const POMMEL_AT = 0.25
const GUARD_AT = 1.0
const GUARD_DEPTH = 0.22
const GUARD_HALF_WIDTH = 0.6
const BLADE_TIP = 3.8
const BLADE_HALF_WIDTH = 0.225
const BLADE_POINT = 0.55
/** The hit segment starts at the guard, so the grip inside the ball never cuts. */
const HIT_START = 1.0
const HIT_SLACK = 0.2

/** Swing trail: sector behind the blade, faded out over this long. */
const TRAIL_TIME = 0.3
const TRAIL_MAX_SPAN = (85 * Math.PI) / 180

/** Shield fan: an annular sector facing the enemy. */
export const FAN_ARC_DEG = 62
const FAN_HALF_ARC = (FAN_ARC_DEG * Math.PI) / 360
const FAN_INNER = 2.1
const FAN_OUTER = 3.7
/** How quickly the fan swings round to face the enemy (1/s) — a slight lag. */
const FAN_FOLLOW_RATE = 9
const FAN_FLASH_TIME = 0.18
/** Shield icon: distance from the centre and height, as multiples of the ball radius. */
const SHIELD_ICON_AT = 1.4
const SHIELD_ICON_HEIGHT = 1.1

/** Mode visuals grow in over this long after a switch (s). */
const APPEAR_TIME = 0.15

type Mode = 'sword' | 'shield'

interface TrailSample {
  angle: number
  t: number
}

/**
 * 骑士 KNIGHT BALL — alternates between two stances every few seconds.
 * Sword: a long sword swings back and forth across the enemy direction,
 * every cut deals a heavy 10 and knocks the enemy away. Shield: the knight
 * becomes fully immune and a shield fan facing the enemy bounces it off.
 */
export class KnightAbility extends Ability {
  private mode: Mode = 'sword'
  private modeLeft: number
  private modeTime = 0
  private appear = 1
  private swingPhase = 0
  private cooldown = 0
  private bladeAngle: number
  private fanAngle: number
  private fanFlash = 0
  /** Whether this ability currently holds the owner's invulnerability. */
  private shielding = false
  private trail: TrailSample[] = []

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.modeLeft = world.rng.range(MODE_MIN, MODE_MAX)
    const e = world.opponentOf(owner)
    this.bladeAngle = dm.atan2(e.pos.y - owner.pos.y, e.pos.x - owner.pos.x)
    this.fanAngle = this.bladeAngle
  }

  private get enemyAngle(): number {
    const o = this.owner.pos
    const e = this.enemy.pos
    return dm.atan2(e.y - o.y, e.x - o.x)
  }

  override update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.fanFlash = Math.max(0, this.fanFlash - dt)
    this.appear = Math.min(1, this.appear + dt / APPEAR_TIME)
    this.pruneTrail()
    if (!this.world.combatActive) {
      this.releaseShield()
      return
    }
    this.modeTime += dt
    this.modeLeft -= dt
    if (this.modeLeft <= 0) this.enterMode(this.mode === 'sword' ? 'shield' : 'sword')
    if (this.mode === 'sword') this.updateSword(dt)
    else this.updateShield(dt)
  }

  private enterMode(mode: Mode): void {
    const o = this.owner
    this.mode = mode
    this.modeTime = 0
    this.modeLeft = mode === 'sword' ? this.world.rng.range(MODE_MIN, MODE_MAX) : this.world.rng.range(SHIELD_MIN, SHIELD_MAX)
    this.appear = 0
    this.trail = []
    if (mode === 'sword') {
      this.releaseShield()
      this.swingPhase = 0
      this.cooldown = 0
      this.bladeAngle = this.enemyAngle
      this.world.sound('whoosh', 0.45, 0.9)
    } else {
      this.fanAngle = this.enemyAngle
      this.world.sound('place', 0.55, 0.8)
    }
    this.world.effects.burst(o.pos, { count: 12, color: mode === 'sword' ? ['#d4a017', '#f6f1f6', '#c99f5c'] : ['#60a5fa', '#e5e7eb', '#ffffff'], shape: 'spark', speed: [80, 220], size: [1.5, 3.2], life: [0.2, 0.4], jitter: o.radius * 0.5 })
  }

  private releaseShield(): void {
    if (!this.shielding) return
    this.shielding = false
    this.owner.invulnerable = false
  }

  private updateSword(dt: number): void {
    const o = this.owner
    const before = Math.floor(this.swingPhase * 2)
    this.swingPhase += dt / SWING_PERIOD
    // Whoosh as the blade sweeps through the enemy direction (fastest point).
    if (Math.floor(this.swingPhase * 2) !== before) this.world.sound('whoosh', 0.18, 1.3)
    this.bladeAngle = this.enemyAngle + SWING_AMPLITUDE * dm.sin(2 * Math.PI * this.swingPhase)
    if (!this.world.headless) this.trail.push({ angle: this.bladeAngle, t: this.world.time })

    const e = this.enemy
    if (this.modeTime < SWORD_READY_DELAY || this.cooldown > 0 || o.disarmed || !e.alive) return
    const R = o.radius
    const dx = dm.cos(this.bladeAngle)
    const dy = dm.sin(this.bladeAngle)
    const a = { x: o.pos.x + dx * HIT_START * R, y: o.pos.y + dy * HIT_START * R }
    const b = { x: o.pos.x + dx * BLADE_TIP * R, y: o.pos.y + dy * BLADE_TIP * R }
    const at = closestPointOnSegment(e.pos, a, b)
    const reach = e.radius + HIT_SLACK * R
    if (distSq(at, e.pos) > reach * reach) return
    this.cooldown = SWORD_COOLDOWN
    const away = this.awayFromOwner(e)
    this.world.damage(e, SWORD_DAMAGE, { kind: 'sword', source: o, at, knock: { x: away.x * KNOCK, y: away.y * KNOCK }, shake: 6 })
  }

  private updateShield(dt: number): void {
    const o = this.owner
    o.invulnerable = true
    this.shielding = true
    this.fanAngle = lerpAngle(this.fanAngle, this.enemyAngle, damp(FAN_FOLLOW_RATE, dt))

    const e = this.enemy
    if (!e.alive || !e.movable) return
    const dx = e.pos.x - o.pos.x
    const dy = e.pos.y - o.pos.y
    const d = dm.hypot(dx, dy)
    if (d < 1e-6 || d >= FAN_INNER * o.radius + e.radius) return
    // The enemy's body overlaps the fan's angular span.
    const halfSpan = FAN_HALF_ARC + dm.asin(Math.min(1, e.radius / d))
    if (Math.abs(angleDiff(this.fanAngle, dm.atan2(dy, dx))) > halfSpan) return
    const n = { x: dx / d, y: dy / d }
    // Reflect the inward part of the enemy's motion relative to the knight.
    const vn = (e.vel.x - o.vel.x) * n.x + (e.vel.y - o.vel.y) * n.y
    if (vn >= 0) return
    e.vel.x -= 2 * vn * n.x
    e.vel.y -= 2 * vn * n.y
    const r = FAN_INNER * o.radius
    this.flashFan({ x: o.pos.x + n.x * r, y: o.pos.y + n.y * r })
  }

  override onBallContact(c: BallContact): void {
    if (this.mode !== 'shield' || !this.world.combatActive) return
    if (this.fanFlash > FAN_FLASH_TIME * 0.5) return
    this.flashFan(c.point)
  }

  private flashFan(at: Vec): void {
    this.fanFlash = FAN_FLASH_TIME
    this.world.effects.burst(at, { count: 14, color: ['#fef08a', '#fffbeb', '#facc15', '#ffffff'], shape: 'spark', speed: [100, 300], size: [1.5, 3.5], life: [0.15, 0.35] })
    this.world.sound('clack', 0.6, 0.75)
  }

  private awayFromOwner(e: Ball): Vec {
    const dx = e.pos.x - this.owner.pos.x
    const dy = e.pos.y - this.owner.pos.y
    const d = dm.hypot(dx, dy)
    if (d > 1e-6) return { x: dx / d, y: dy / d }
    return { x: dm.cos(this.bladeAngle), y: dm.sin(this.bladeAngle) }
  }

  private pruneTrail(): void {
    const now = this.world.time
    let i = 0
    while (i < this.trail.length && now - this.trail[i].t > TRAIL_TIME) i++
    if (i > 0) this.trail.splice(0, i)
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const o = this.owner
    ctx.save()
    ctx.globalAlpha = fade * this.appear
    if (this.mode === 'sword') drawSwingTrail(ctx, o.pos.x, o.pos.y, o.radius, this.trail, this.world.time)
    else drawShieldFan(ctx, o.pos.x, o.pos.y, this.fanAngle, o.radius, this.fanFlash / FAN_FLASH_TIME)
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const o = this.owner
    ctx.save()
    ctx.globalAlpha = fade * this.appear
    if (this.mode === 'sword') {
      if (o.disarmed) ctx.globalAlpha *= 0.55
      drawSword(ctx, o.pos.x, o.pos.y, this.bladeAngle, o.radius * (0.6 + 0.4 * this.appear))
    } else {
      const at = SHIELD_ICON_AT * o.radius
      const x = o.pos.x + dm.cos(this.fanAngle) * at
      const y = o.pos.y + dm.sin(this.fanAngle) * at
      drawHeaterShield(ctx, x, y, SHIELD_ICON_HEIGHT * o.radius * (0.5 + 0.5 * this.appear))
    }
    ctx.restore()
  }
}

/**
 * The fading sector swept by the blade: the newest monotonic run of samples,
 * capped to TRAIL_MAX_SPAN, shaded by each sample's age.
 */
function drawSwingTrail(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, trail: readonly TrailSample[], now: number): void {
  const n = trail.length
  if (n < 2) return
  // Unwrap angles backwards from the newest sample.
  const pts: { u: number; age: number }[] = [{ u: trail[n - 1].angle, age: now - trail[n - 1].t }]
  let sign = 0
  for (let i = n - 2; i >= 0; i--) {
    const step = angleDiff(trail[i].angle, trail[i + 1].angle)
    const s = Math.sign(step)
    if (s !== 0 && sign !== 0 && s !== sign) break
    if (s !== 0) sign = s
    const prev = pts[pts.length - 1]
    const u = prev.u - step
    const age = now - trail[i].t
    if (Math.abs(u - pts[0].u) > TRAIL_MAX_SPAN) {
      // Clip the last sample to the span limit.
      const end = pts[0].u - sign * TRAIL_MAX_SPAN
      const k = Math.abs(step) > 1e-9 ? (prev.u - end) / step : 0
      pts.push({ u: end, age: prev.age + (age - prev.age) * k })
      break
    }
    pts.push({ u, age })
  }
  if (pts.length < 2 || sign === 0) return
  let lo = Infinity
  let hi = -Infinity
  for (const p of pts) {
    lo = Math.min(lo, p.u)
    hi = Math.max(hi, p.u)
  }
  if (hi - lo < 1e-3) return
  const inner = HIT_START * r
  const outer = BLADE_TIP * r
  const g = ctx.createConicGradient(lo, cx, cy)
  const stops = pts.map((p) => ({ at: (p.u - lo) / (Math.PI * 2), a: 0.42 * clamp(1 - p.age / TRAIL_TIME, 0, 1) })).sort((a, b) => a.at - b.at)
  for (const s of stops) g.addColorStop(s.at, `rgba(146,104,38,${s.a.toFixed(3)})`)
  ctx.save()
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, outer, lo, hi)
  ctx.arc(cx, cy, inner, hi, lo, true)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** The long sword pivoting at (cx, cy), blade pointing along `angle`, sized for a ball of radius `r`. */
export function drawSword(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const outline = '#26262c'
  const line = Math.max(1, r * 0.045)
  const gold = (y0: number, y1: number): CanvasGradient => {
    const g = ctx.createLinearGradient(0, y0, 0, y1)
    g.addColorStop(0, '#c99f5c')
    g.addColorStop(0.5, '#d4a017')
    g.addColorStop(1, '#c99f5c')
    return g
  }
  // Grip with a leather wrap.
  const gripA = (POMMEL_AT + 0.1) * r
  const gripB = GUARD_AT * r
  const gripHalf = r * 0.11
  ctx.fillStyle = '#6b3a1e'
  ctx.fillRect(gripA, -gripHalf, gripB - gripA, gripHalf * 2)
  ctx.strokeStyle = '#3d2010'
  ctx.lineWidth = line
  ctx.beginPath()
  for (let x = gripA + r * 0.1; x < gripB; x += r * 0.15) {
    ctx.moveTo(x, -gripHalf)
    ctx.lineTo(x + r * 0.07, gripHalf)
  }
  ctx.stroke()
  ctx.strokeRect(gripA, -gripHalf, gripB - gripA, gripHalf * 2)
  // Pommel.
  ctx.fillStyle = gold(-r * 0.17, r * 0.17)
  ctx.strokeStyle = '#7a5a1c'
  ctx.beginPath()
  ctx.arc(POMMEL_AT * r, 0, r * 0.17, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // Blade with a fuller.
  const base = (GUARD_AT + GUARD_DEPTH) * r
  const tip = BLADE_TIP * r
  const half = BLADE_HALF_WIDTH * r
  const shoulder = tip - BLADE_POINT * r
  ctx.fillStyle = '#f6f1f6'
  ctx.strokeStyle = outline
  ctx.lineWidth = line * 1.2
  ctx.lineJoin = 'miter'
  ctx.beginPath()
  ctx.moveTo(base, -half)
  ctx.lineTo(shoulder, -half)
  ctx.lineTo(tip, 0)
  ctx.lineTo(shoulder, half)
  ctx.lineTo(base, half)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#cbc3cf'
  ctx.lineWidth = r * 0.07
  ctx.beginPath()
  ctx.moveTo(base + r * 0.15, 0)
  ctx.lineTo(shoulder - r * 0.1, 0)
  ctx.stroke()
  // Crossguard.
  const gw = GUARD_HALF_WIDTH * r
  ctx.fillStyle = gold(-gw, gw)
  ctx.strokeStyle = '#7a5a1c'
  ctx.lineWidth = line
  ctx.beginPath()
  ctx.moveTo(GUARD_AT * r, -gw + r * 0.06)
  ctx.quadraticCurveTo(GUARD_AT * r, -gw, base, -gw - r * 0.04)
  ctx.lineTo(base, gw + r * 0.04)
  ctx.quadraticCurveTo(GUARD_AT * r, gw, GUARD_AT * r, gw - r * 0.06)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** The dark shield fan; `flash` 0..1 tints it gold right after a block. */
export function drawShieldFan(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number, flash: number): void {
  const a0 = angle - FAN_HALF_ARC
  const a1 = angle + FAN_HALF_ARC
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, FAN_OUTER * r, a0, a1)
  ctx.arc(cx, cy, FAN_INNER * r, a1, a0, true)
  ctx.closePath()
  ctx.fillStyle = 'rgba(30,32,35,0.7)'
  ctx.fill()
  if (flash > 0) {
    ctx.fillStyle = `rgba(222,184,110,${(0.8 * flash).toFixed(3)})`
    ctx.fill()
  }
  ctx.strokeStyle = flash > 0 ? `rgba(254,240,138,${(0.5 + 0.5 * flash).toFixed(3)})` : 'rgba(150,154,164,0.6)'
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.restore()
}

/** An upright blue heater shield with a silver rim and white cross, `h` tall, centred on (x, y). */
export function drawHeaterShield(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  const w = h * 0.84
  ctx.save()
  ctx.translate(x, y)
  const path = (): void => {
    ctx.beginPath()
    ctx.moveTo(-w / 2, -h / 2)
    ctx.lineTo(w / 2, -h / 2)
    ctx.lineTo(w / 2, -h * 0.06)
    ctx.quadraticCurveTo(w / 2, h * 0.3, 0, h / 2)
    ctx.quadraticCurveTo(-w / 2, h * 0.3, -w / 2, -h * 0.06)
    ctx.closePath()
  }
  const blue = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2)
  blue.addColorStop(0, '#3b82f6')
  blue.addColorStop(1, '#1e40af')
  path()
  ctx.fillStyle = blue
  ctx.fill()
  // White cross.
  ctx.fillStyle = '#ffffff'
  const bar = h * 0.075
  ctx.fillRect(-bar, -h * 0.38, bar * 2, h * 0.7)
  ctx.fillRect(-w * 0.34, -h * 0.17 - bar, w * 0.68, bar * 2)
  // Silver rim, then a thin dark edge.
  path()
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = Math.max(1.5, h * 0.09)
  ctx.stroke()
  ctx.strokeStyle = '#374151'
  ctx.lineWidth = Math.max(0.6, h * 0.02)
  ctx.stroke()
  ctx.restore()
}

export function drawKnightPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const br = r * 0.72
  const x = cx - r * 0.85
  const y = cy + r * 0.85
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  drawSword(ctx, x, y, -Math.PI / 4, br)
  drawHeaterShield(ctx, x - br * 0.95, y + br * 0.25, SHIELD_ICON_HEIGHT * br)
}

export const knightDef: CharacterDef = {
  id: 'knight',
  nameEn: 'KNIGHT BALL',
  ruleValues: { modeMin: MODE_MIN, modeMax: MODE_MAX, shieldMin: SHIELD_MIN, shieldMax: SHIELD_MAX, swingAmplitudeDeg: SWING_AMPLITUDE_DEG, swingPeriod: SWING_PERIOD, swordDamage: SWORD_DAMAGE, swordCooldown: SWORD_COOLDOWN, fanArcDeg: FAN_ARC_DEG },
  palette: { ball: '#787a85', text: '#ffffff', accent: '#9a9ca8' },
  mirrorPalette: { ball: '#3f4150', text: '#e5e7eb', accent: '#b4b7c4' },
  create: (w, b) => new KnightAbility(w, b),
  drawPortrait: drawKnightPortrait,
}
