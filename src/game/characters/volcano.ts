import { closestPointOnSegment } from '../core/geometry'
import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

/** Entity time (scaled by the volcano's own speed factor) between eruptions. */
export const ERUPT_INTERVAL = 8
const FIRST_ERUPTION = 1.7
/** How long the volcano stands still per eruption (s). */
export const STOP_TIME = 5.0
/** Delay between stopping and the lava bursting out (s). */
const WINDUP = 0.3
export const BOLT_COUNT = 7
const MIN_ANGLE_GAP = 0.4
const GROW_TIME = 0.4
const HOLD_TIME = 3.0
const FADE_TIME = 0.4
/** How long each eruption's lava stays dangerous (growing + holding). */
export const LAVA_TIME = Math.round((GROW_TIME + HOLD_TIME) * 10) / 10
const SEGMENT_LENGTH = BALL_RADIUS * 0.5
const WOBBLE = BALL_RADIUS * 0.3
const BOLT_WIDTH = BALL_RADIUS * 0.42
/** Extra reach beyond the enemy radius for touching lava (≈ half the bolt). */
const TOUCH_MARGIN = BALL_RADIUS * 0.21
export const LAVA_DAMAGE = 3
export const LAVA_TICK = 0.5
/** Speed multiplier while on lava; re-applied every step. */
export const LAVA_SLOW = 0.15
const LAVA_SLOW_TIME = 0.2
export const BURN_TICKS = 3
export const BURN_DAMAGE = 2
export const BURN_INTERVAL = 1
/** Visual jitter amplitude while erupting (world units). */
const SHAKE = 1.4

interface LavaBolt {
  pts: Vec[]
  /** Cumulative arc length at each point. */
  cum: number[]
  length: number
  /** Arc-length positions of the decorative ember dots. */
  embers: number[]
}

interface Eruption {
  /** Time since the volcano stopped. */
  t: number
  center: Vec
  bolts: LavaBolt[]
  /** Whether the volcano is still held in place by this eruption. */
  holding: boolean
  crumbled: boolean
}

/**
 * 火山 — VOLCANO. Every few seconds it plants itself and erupts: jagged lava
 * fissures crack out from its centre to the arena walls. The enemy wading
 * through lava is scorched and bogged down, then keeps burning for a while
 * after getting out.
 */
export class VolcanoAbility extends Ability {
  private charge = ERUPT_INTERVAL - FIRST_ERUPTION
  private eruption: Eruption | null = null
  private nextLavaTick = 0
  private burnTicksLeft = 0
  private burnTimer = 0
  private onLava = false

  override update(dt: number): void {
    const o = this.owner
    const active = this.world.combatActive
    if (active && !o.disarmed) {
      this.charge += dt * o.speedFactor
      if (!this.eruption && this.charge >= ERUPT_INTERVAL) {
        this.charge -= ERUPT_INTERVAL
        this.erupt()
      }
    }
    const er = this.eruption
    if (er) {
      er.t += dt
      if (er.holding) {
        if (!active || er.t >= STOP_TIME) this.release(er)
        else this.shakeInPlace(er)
      }
      const fadeAt = WINDUP + GROW_TIME + HOLD_TIME
      if (!er.crumbled && er.t >= fadeAt) this.crumble(er)
      if (er.t >= Math.max(fadeAt + FADE_TIME, STOP_TIME)) this.eruption = null
    }
    this.scorch(dt)
  }

  private erupt(): void {
    const o = this.owner
    const rng = this.world.rng
    const center = { x: o.pos.x, y: o.pos.y }
    o.pinned = true
    o.vel = { x: 0, y: 0 }

    // Random gaps that each keep at least MIN_ANGLE_GAP, summing to a full turn.
    const weights = Array.from({ length: BOLT_COUNT }, () => -Math.log(1 - rng.next()))
    const total = weights.reduce((s, w) => s + w, 0)
    const spare = Math.PI * 2 - MIN_ANGLE_GAP * BOLT_COUNT
    let angle = rng.range(0, Math.PI * 2)
    const bolts: LavaBolt[] = []
    for (const w of weights) {
      bolts.push(this.makeBolt(center, angle))
      angle += MIN_ANGLE_GAP + spare * (w / total)
    }
    this.eruption = { t: 0, center, bolts, holding: true, crumbled: false }
    this.world.sound('roll', 0.6, 0.6)
  }

  /** Zigzag polyline from `c` to the arena edge along `angle`. */
  private makeBolt(c: Vec, angle: number): LavaBolt {
    const rng = this.world.rng
    const s = this.world.size
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    // Distance along the ray to the arena boundary.
    const tx = dx > 1e-9 ? (s - c.x) / dx : dx < -1e-9 ? -c.x / dx : Infinity
    const ty = dy > 1e-9 ? (s - c.y) / dy : dy < -1e-9 ? -c.y / dy : Infinity
    const reach = Math.max(0, Math.min(tx, ty))
    const steps = Math.max(1, Math.round(reach / SEGMENT_LENGTH))
    const pts: Vec[] = [{ x: c.x, y: c.y }]
    for (let i = 1; i < steps; i++) {
      const d = (reach * i) / steps
      const off = rng.range(-WOBBLE, WOBBLE)
      pts.push({ x: clamp(c.x + dx * d - dy * off, 0, s), y: clamp(c.y + dy * d + dx * off, 0, s) })
    }
    pts.push({ x: c.x + dx * reach, y: c.y + dy * reach })
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
    const length = cum[cum.length - 1]
    const embers: number[] = []
    const n = Math.max(2, Math.round(length / (BALL_RADIUS * 2.2)))
    for (let i = 0; i < n; i++) embers.push(length * ((i + rng.range(0.2, 0.8)) / n))
    return { pts, cum, length, embers }
  }

  /** Holds the planted volcano on its spot with a slight rumble. */
  private shakeInPlace(er: Eruption): void {
    const o = this.owner
    const t = this.world.time
    o.vel = { x: 0, y: 0 }
    o.pos = { x: er.center.x + Math.sin(t * 71) * SHAKE, y: er.center.y + Math.sin(t * 53 + 1.3) * SHAKE }
  }

  private release(er: Eruption): void {
    const o = this.owner
    er.holding = false
    o.pinned = false
    o.pos = { x: er.center.x, y: er.center.y }
    const a = this.world.rng.int(0, 3) * (Math.PI / 2) + Math.PI / 4
    o.vel = { x: Math.cos(a) * o.baseSpeed, y: Math.sin(a) * o.baseSpeed }
  }

  private crumble(er: Eruption): void {
    er.crumbled = true
    for (const b of er.bolts) {
      for (let d = SEGMENT_LENGTH; d < b.length; d += SEGMENT_LENGTH * 2) {
        this.world.effects.burst(pointAt(b, d), { count: 2, color: ['#3b0d06', '#5a1a0a', '#2a2522', '#7c2d12'], speed: [10, 60], size: [1.5, 3.5], life: [0.4, 0.9], drag: 2.5, front: false })
      }
    }
  }

  /** Growth (0..1) of every bolt, or 0 before the burst. */
  private growth(er: Eruption): number {
    const u = clamp((er.t - WINDUP) / GROW_TIME, 0, 1)
    return 1 - (1 - u) * (1 - u)
  }

  /** Whether the lava currently hurts (grown or growing, not yet cooling). */
  private lavaLive(er: Eruption): boolean {
    return er.t >= WINDUP && er.t < WINDUP + GROW_TIME + HOLD_TIME
  }

  private scorch(dt: number): void {
    const e = this.enemy
    this.onLava = false
    if (!e.alive || !this.world.combatActive) return
    const now = this.world.time
    const er = this.eruption
    if (er && this.lavaLive(er)) {
      const g = this.growth(er)
      const reach = e.radius + TOUCH_MARGIN
      this.onLava = er.bolts.some((b) => distanceToGrown(e.pos, b, b.length * g) < reach)
    }
    if (this.onLava) {
      e.applySlow(LAVA_SLOW, LAVA_SLOW_TIME)
      if (now >= this.nextLavaTick) {
        this.nextLavaTick = now + LAVA_TICK
        this.world.damage(e, LAVA_DAMAGE, { kind: 'lava', source: this.owner, at: e.pos })
      }
      // Burn starts counting only once the enemy is out of the lava.
      this.burnTicksLeft = BURN_TICKS
      this.burnTimer = BURN_INTERVAL
      return
    }
    if (this.burnTicksLeft <= 0) return
    this.burnTimer -= dt
    if (this.burnTimer <= 0) {
      this.burnTimer += BURN_INTERVAL
      this.burnTicksLeft -= 1
      this.world.damage(e, BURN_DAMAGE, { kind: 'burn', source: this.owner, at: e.pos })
    }
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    const er = this.eruption
    if (fade <= 0 || !er) return
    const g = this.growth(er)
    if (g <= 0) return
    const fadeAt = WINDUP + GROW_TIME + HOLD_TIME
    const cool = clamp((er.t - fadeAt) / FADE_TIME, 0, 1)
    if (cool >= 1) return
    const time = this.world.time
    ctx.save()
    ctx.globalAlpha = fade * (1 - cool)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const [i, b] of er.bolts.entries()) {
      const pts = grownPoints(b, b.length * g)
      const flicker = 0.85 + 0.15 * Math.sin(time * 9 + i * 2.1)
      drawLava(ctx, pts, BOLT_WIDTH * (1 - cool * 0.4), flicker, cool)
      ctx.fillStyle = cool > 0 ? '#9a3412' : '#fde047'
      for (const [j, d] of b.embers.entries()) {
        if (d > b.length * g) continue
        const p = pointAt(b, d)
        const pulse = 0.5 + 0.5 * Math.sin(time * 7 + j * 1.7 + i)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.4 + pulse * 1.4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const er = this.eruption
    if (!er?.holding) return
    const o = this.owner
    const pulse = 0.5 + 0.5 * Math.sin(this.world.time * 10)
    ctx.save()
    ctx.shadowColor = '#ff6a10'
    ctx.shadowBlur = 16 + pulse * 10
    ctx.fillStyle = o.color
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, o.radius * o.drawScale, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const e = this.enemy
    if (this.presence <= 0 || !e.alive || (!this.onLava && this.burnTicksLeft <= 0)) return
    ctx.save()
    ctx.beginPath()
    ctx.arc(e.pos.x, e.pos.y, e.radius, 0, Math.PI * 2)
    ctx.clip()
    const frame = Math.floor(this.world.time * 10)
    for (let i = 0; i < 10; i++) {
      const h = hash(frame * 13 + i * 7.3)
      const a = h * Math.PI * 2
      const r = e.radius * (0.15 + 0.8 * hash(i * 3.1 + 0.5))
      ctx.fillStyle = i % 3 === 0 ? '#fb923c' : '#ef4444'
      ctx.beginPath()
      ctx.arc(e.pos.x + Math.cos(a) * r, e.pos.y + Math.sin(a) * r, 1.8 + hash(frame + i) * 1.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** Point at arc length `d` along a bolt. */
function pointAt(b: LavaBolt, d: number): Vec {
  const { pts, cum } = b
  for (let i = 1; i < pts.length; i++) {
    if (d <= cum[i]) {
      const seg = cum[i] - cum[i - 1]
      const t = seg > 1e-9 ? (d - cum[i - 1]) / seg : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
  }
  return pts[pts.length - 1]
}

/** The bolt's polyline truncated at arc length `d`. */
function grownPoints(b: LavaBolt, d: number): Vec[] {
  const out: Vec[] = [b.pts[0]]
  for (let i = 1; i < b.pts.length; i++) {
    if (b.cum[i] >= d) {
      out.push(pointAt(b, d))
      return out
    }
    out.push(b.pts[i])
  }
  return out
}

function distanceToGrown(p: Vec, b: LavaBolt, d: number): number {
  if (d <= 0) return Infinity
  const pts = grownPoints(b, d)
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const q = closestPointOnSegment(p, pts[i - 1], pts[i])
    best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y))
  }
  return best
}

/** A glowing lava fissure. `cool` (0..1) darkens it as it crusts over. */
function drawLava(ctx: CanvasRenderingContext2D, pts: readonly Vec[], width: number, flicker: number, cool: number): void {
  if (pts.length < 2) return
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  }
  ctx.save()
  ctx.shadowColor = '#ff4a10'
  ctx.shadowBlur = 16 * flicker * (1 - cool)
  ctx.strokeStyle = cool > 0 ? `rgb(${Math.round(255 - 150 * cool)},${Math.round(74 - 50 * cool)},${Math.round(16)})` : '#ff4a10'
  ctx.lineWidth = width
  path()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = cool > 0 ? `rgba(255,140,40,${1 - cool})` : '#ff9a2a'
  ctx.lineWidth = width * 0.45
  path()
  ctx.stroke()
  ctx.strokeStyle = `rgba(255,214,120,${0.7 * flicker * (1 - cool)})`
  ctx.lineWidth = width * 0.16
  path()
  ctx.stroke()
  ctx.restore()
}

export function drawVolcanoPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const w = r * 0.42
  const angles = [-2.6, -1.55, -0.55, 0.35, 1.2, 2.0, 2.85]
  for (const [i, a] of angles.entries()) {
    const pts: Vec[] = [{ x: cx, y: cy }]
    const reach = r * 2.35
    const steps = 6
    for (let k = 1; k <= steps; k++) {
      const d = (reach * k) / steps
      const off = k === steps ? 0 : (hash(i * 9 + k) - 0.5) * r * 0.6
      pts.push({ x: cx + Math.cos(a) * d - Math.sin(a) * off, y: cy + Math.sin(a) * d + Math.cos(a) * off })
    }
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    drawLava(ctx, pts, w, 1, 0)
  }
  ctx.save()
  ctx.shadowColor = '#ff6a10'
  ctx.shadowBlur = 18
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export const volcanoDef: CharacterDef = {
  id: 'volcano',
  name: '火山',
  nameEn: 'VOLCANO',
  tagline: '原地爆发，岩浆遍地',
  rules: [
    `每约 ${ERUPT_INTERVAL} 秒停下 ${STOP_TIME} 秒原地喷发，${BOLT_COUNT} 道岩浆裂缝延伸到场边`,
    `岩浆持续约 ${LAVA_TIME} 秒，敌人碰到每 ${LAVA_TICK} 秒 -${LAVA_DAMAGE}，速度降到 ${Math.round(LAVA_SLOW * 100)}%`,
    `离开岩浆后继续灼烧 ${BURN_TICKS} 次，每 ${BURN_INTERVAL} 秒 -${BURN_DAMAGE}`,
    '被减速会推迟喷发，本体撞人没有伤害',
  ],
  palette: { ball: '#f46c18', text: '#ffffff', accent: '#f46c18' },
  mirrorPalette: { ball: '#9a3412', text: '#ffedd5', accent: '#fb923c' },
  create: (w, b) => new VolcanoAbility(w, b),
  drawPortrait: drawVolcanoPortrait,
}
