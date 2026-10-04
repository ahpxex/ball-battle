import * as dm from '../core/dmath'
import { type Vec, clamp, distSq, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const FIRST_THROW = 0.6
export const THROW_INTERVAL = 1.1
/** Distance an apple rolls before stopping (≈0.35 arena widths). */
export const THROW_DISTANCE = 210
/** Exponential deceleration rate of a thrown apple (1/s). */
const APPLE_DRAG = 4.5
/** Fraction of the throw distance after which the apple settles on the spot. */
const LAND_FRACTION = 0.96
export const MAX_APPLES = 10
export const APPLE_DAMAGE = 5
export const APPLE_HEAL = 2
/** Pickup reach of a floor apple, added to the toucher's radius. */
const APPLE_REACH = BALL_RADIUS * 0.55
/** Drawn width of an apple. */
const APPLE_SIZE = BALL_RADIUS * 1.15
/** The comet trail shows for this long, centred on each throw (s). */
const TRAIL_WINDOW = 0.4
/** Owner positions kept for the comet trail. */
const TRAIL_SAMPLES = 24
const SQUASH_TIME = 0.3

const APPLE_RED = '#e0261d'
const APPLE_LIGHT = '#f4594c'
const APPLE_DARK = '#a8150d'
const STEM = '#6b3e1f'
const LEAF = '#4caf32'

interface FlyingApple {
  from: Vec
  dir: Vec
  dist: number
  age: number
  angle: number
  spin: number
}

interface FloorApple {
  pos: Vec
  angle: number
  landedAt: number
}

/**
 * 小苹果儿 — tosses an apple in a random direction every 0.8 s. Apples roll
 * to a stop and stay on the floor: the enemy stepping on one takes damage,
 * while the apple ball eating one heals (even past full HP).
 */
export class AppleAbility extends Ability {
  private flying: FlyingApple[] = []
  private floor: FloorApple[] = []
  private timer = FIRST_THROW
  private lastThrow = -Infinity
  private trail: Vec[] = []

  override update(dt: number): void {
    const o = this.owner
    this.trail.push({ x: o.pos.x, y: o.pos.y })
    if (this.trail.length > TRAIL_SAMPLES) this.trail.shift()

    if (this.world.combatActive && !o.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += THROW_INTERVAL
        this.toss()
      }
    }

    for (const a of this.flying) {
      a.age += dt
      a.angle += a.spin * dm.exp(-APPLE_DRAG * a.age) * dt
    }
    const landing = this.flying.filter((a) => this.progress(a) >= 1)
    if (landing.length > 0) {
      this.flying = this.flying.filter((a) => this.progress(a) < 1)
      for (const a of landing) this.land(a)
    }

    this.pickups()
  }

  /** 0..1 along the throw; reaches 1 once the apple has rolled LAND_FRACTION of the way. */
  private progress(a: FlyingApple): number {
    return Math.min(1, (1 - dm.exp(-APPLE_DRAG * a.age)) / LAND_FRACTION)
  }

  private flyingPos(a: FlyingApple): Vec {
    const d = a.dist * this.progress(a)
    return { x: a.from.x + a.dir.x * d, y: a.from.y + a.dir.y * d }
  }

  private toss(): void {
    const o = this.owner
    const s = this.world.size
    const ang = this.world.rng.range(0, Math.PI * 2)
    const dir = { x: dm.cos(ang), y: dm.sin(ang) }
    const m = APPLE_REACH
    const from = { x: clamp(o.pos.x + dir.x * o.radius * 0.6, m, s - m), y: clamp(o.pos.y + dir.y * o.radius * 0.6, m, s - m) }
    // Shorten the roll so the apple stops inside the arena.
    let dist = THROW_DISTANCE
    if (dir.x > 1e-6) dist = Math.min(dist, (s - m - from.x) / dir.x)
    else if (dir.x < -1e-6) dist = Math.min(dist, (m - from.x) / dir.x)
    if (dir.y > 1e-6) dist = Math.min(dist, (s - m - from.y) / dir.y)
    else if (dir.y < -1e-6) dist = Math.min(dist, (m - from.y) / dir.y)
    const fx = this.world.effects
    this.flying.push({
      from,
      dir,
      dist: Math.max(0, dist),
      age: 0,
      angle: fx.random() * Math.PI * 2,
      // Tumble faster on longer throws; spin direction is cosmetic.
      spin: (fx.random() < 0.5 ? -1 : 1) * (8 + 16 * (dist / THROW_DISTANCE)),
    })
    this.lastThrow = this.world.time
    this.world.sound('throw', 0.4, 1.25)
  }

  private land(a: FlyingApple): void {
    const pos = this.flyingPos(a)
    if (this.floor.length >= MAX_APPLES) this.floor.shift()
    this.floor.push({ pos, angle: a.angle, landedAt: this.world.time })
    this.world.effects.burst(pos, { count: 4, color: ['#4ade80', '#22c55e', '#86efac'], speed: [30, 90], size: [1.5, 2.5], life: [0.25, 0.45], front: false })
  }

  private pickups(): void {
    if (!this.world.combatActive || this.floor.length === 0) return
    const o = this.owner
    const e = this.enemy
    const kept: FloorApple[] = []
    for (const a of this.floor) {
      if (e.alive && touches(e.pos, e.radius + APPLE_REACH, a.pos)) {
        this.world.damage(e, APPLE_DAMAGE, { kind: 'apple', source: o, at: a.pos })
        this.world.effects.burst(a.pos, { count: 6, color: ['#fff7d6', '#f5e6b8', APPLE_RED], shape: 'shard', speed: [60, 180], size: [2, 4], life: [0.3, 0.6] })
        continue
      }
      if (o.alive && touches(o.pos, o.radius + APPLE_REACH, a.pos)) {
        this.world.heal(o, APPLE_HEAL)
        this.world.effects.burst(a.pos, { count: 8, color: ['#fff7d6', APPLE_RED, '#4ade80'], speed: [40, 140], size: [1.5, 3], life: [0.25, 0.5] })
        this.world.sound('heal', 0.45, 1.3)
        continue
      }
      kept.push(a)
    }
    this.floor = kept
  }

  /** 0..1 strength of the comet trail around the last / next throw. */
  private trailStrength(): number {
    const half = TRAIL_WINDOW / 2
    const since = this.world.time - this.lastThrow
    const after = since < half ? 1 - since / half : 0
    const armed = this.world.combatActive && !this.owner.disarmed
    const before = armed && this.timer < half ? 1 - this.timer / half : 0
    return Math.max(after, before)
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.floor.length === 0) return
    const now = this.world.time
    ctx.save()
    ctx.globalAlpha *= fade
    for (const a of this.floor) {
      const u = (now - a.landedAt) / SQUASH_TIME
      // Squash flat on impact, then a small rebound.
      const k = u < 1 ? 0.2 * sq(1 - u) * dm.cos(u * Math.PI * 2.5) : 0
      drawApple(ctx, a.pos.x, a.pos.y, APPLE_SIZE, a.angle, 1 + k, 1 - k)
    }
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const strength = this.trailStrength()
    if (strength <= 0 || this.trail.length < 3) return
    drawCometTrail(ctx, this.trail, this.owner.radius, this.owner.color, strength * 0.4)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.flying.length === 0) return
    ctx.save()
    ctx.globalAlpha *= fade
    for (const a of this.flying) {
      const p = this.flyingPos(a)
      drawApple(ctx, p.x, p.y, APPLE_SIZE, a.angle, 1, 1)
    }
    ctx.restore()
  }
}

function touches(center: Vec, reach: number, p: Vec): boolean {
  return distSq(center, p) < reach * reach
}

/** Fully transparent version of a hex colour, so gradients fade without darkening. */
function transparent(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}00`
  if (/^#[0-9a-f]{3}$/i.test(color)) return `${color}0`
  return 'rgba(255,255,255,0)'
}

/** Tapered translucent ribbon along `pts` (oldest first), widest at the newest point. */
function drawCometTrail(ctx: CanvasRenderingContext2D, pts: readonly Vec[], radius: number, color: string, alpha: number): void {
  const n = pts.length
  const left: Vec[] = []
  const right: Vec[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = dm.hypot(dx, dy)
    if (d < 1e-3) continue
    const w = radius * (0.1 + 0.85 * (i / (n - 1)))
    left.push({ x: pts[i].x - (dy / d) * w, y: pts[i].y + (dx / d) * w })
    right.push({ x: pts[i].x + (dy / d) * w, y: pts[i].y - (dx / d) * w })
  }
  if (left.length < 2) return
  const tail = pts[0]
  const head = pts[n - 1]
  const g = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y)
  g.addColorStop(0, transparent(color))
  g.addColorStop(1, color)
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(left[0].x, left[0].y)
  for (const p of left) ctx.lineTo(p.x, p.y)
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * Emoji-style red apple centred on (x, y), `size` wide: two lobes with a top
 * dimple, a brown stem and a green leaf. `sx`/`sy` squash it in screen space.
 */
export function drawApple(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, sx: number, sy: number): void {
  const u = size / 2
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(sx, sy)
  ctx.rotate(angle)
  // Body: two overlapping lobes leave a dimple at the top and a soft notch below.
  const g = ctx.createRadialGradient(-u * 0.35, -u * 0.3, u * 0.1, 0, u * 0.05, u * 1.15)
  g.addColorStop(0, APPLE_LIGHT)
  g.addColorStop(0.55, APPLE_RED)
  g.addColorStop(1, APPLE_DARK)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(-u * 0.3, u * 0.06, u * 0.7, u * 0.8, 0, 0, Math.PI * 2)
  ctx.moveTo(u * 1.0, u * 0.06)
  ctx.ellipse(u * 0.3, u * 0.06, u * 0.7, u * 0.8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.beginPath()
  ctx.ellipse(-u * 0.5, -u * 0.25, u * 0.12, u * 0.24, 0.5, 0, Math.PI * 2)
  ctx.fill()
  // Stem.
  ctx.strokeStyle = STEM
  ctx.lineWidth = u * 0.15
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, -u * 0.5)
  ctx.quadraticCurveTo(-u * 0.02, -u * 0.85, u * 0.14, -u * 1.08)
  ctx.stroke()
  // Leaf.
  ctx.fillStyle = LEAF
  ctx.beginPath()
  ctx.moveTo(u * 0.06, -u * 0.8)
  ctx.quadraticCurveTo(u * 0.35, -u * 1.25, u * 0.85, -u * 1.08)
  ctx.quadraticCurveTo(u * 0.5, -u * 0.68, u * 0.06, -u * 0.8)
  ctx.fill()
  ctx.strokeStyle = 'rgba(20,83,45,0.6)'
  ctx.lineWidth = u * 0.05
  ctx.beginPath()
  ctx.moveTo(u * 0.1, -u * 0.82)
  ctx.lineTo(u * 0.7, -u * 1.03)
  ctx.stroke()
  ctx.restore()
}

export function drawApplePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const size = r * 1.15
  drawApple(ctx, cx + r * 1.55, cy - r * 1.35, size, 0.35, 1, 1)
  drawApple(ctx, cx - r * 1.7, cy + r * 1.45, size, -0.5, 1.12, 0.88)
  drawApple(ctx, cx + r * 1.5, cy + r * 1.55, size * 0.85, 2.4, 1, 1)
  const trail: Vec[] = []
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    trail.push({ x: cx - r * 2.1 + t * r * 2.0, y: cy - r * 1.3 + t * r * 1.2 - dm.sin(t * Math.PI) * r * 0.3 })
  }
  drawCometTrail(ctx, trail, r * 0.9, color, 0.45)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.1, cy - r * 0.1, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
}

export const appleDef: CharacterDef = {
  id: 'apple',
  nameEn: 'APPLE BALL',
  ruleValues: { throwInterval: THROW_INTERVAL, maxApples: MAX_APPLES, appleDamage: APPLE_DAMAGE, appleHeal: APPLE_HEAL },
  palette: { ball: '#e83328', text: '#ffffff', accent: '#d33636' },
  mirrorPalette: { ball: '#5fae2b', text: '#ffffff', accent: '#84cc16' },
  create: (w, b) => new AppleAbility(w, b),
  drawPortrait: drawApplePortrait,
}
