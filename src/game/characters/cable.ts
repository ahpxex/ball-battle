import * as dm from '../core/dmath'
import { distanceToSegment } from '../core/geometry'
import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { WallBounce } from '../engine/types'
import type { CharacterDef } from './types'

export const CABLE_LIFE = 4.0
export const MAX_CABLES = 6
export const SHOCK_DURATION = 1.5
export const SHOCK_TICK = 0.5
export const SHOCK_DAMAGE = 3
/** Speed multiplier while shocked. */
export const SHOCK_SLOW = 0.12
/** The slow is re-applied every step, so it only needs to outlive one step. */
const SLOW_REFRESH = 0.1
/** Apex displacement of the bowed cable, as a fraction of its chord. */
const BOW = 0.1
/** Polyline resolution used for collision. */
const SEGMENTS = 12
/** Extra reach beyond the enemy radius for touching a cable (≈ half the tube). */
const TOUCH_MARGIN = BALL_RADIUS * 0.12
const TUBE_WIDTH = BALL_RADIUS * 0.23
const PLUG_SIZE = BALL_RADIUS * 0.34
/** The cable darkens, thins and fades over its last moments (s). */
const FADE_TIME = 0.6
/**
 * A second bounce closer than this to the held anchor (a corner double
 * bounce, or the same wall again) re-anchors instead of stringing a stub.
 */
const MIN_CHORD = BALL_RADIUS * 2

export const CABLE_COLORS = ['#e43630', '#f08a28', '#f6cc24', '#24a254', '#36b4d8', '#3c5ade', '#7e4ecc'] as const

interface Anchor {
  point: Vec
  /** Unit normal of the wall, pointing into the arena. */
  normal: Vec
  wall: WallBounce['wall']
  color: string
}

interface Cable {
  a: Anchor
  b: Anchor
  /** Quadratic Bézier control point. */
  control: Vec
  /** Collision polyline sampled along the curve. */
  pts: Vec[]
  color: string
  age: number
}

/**
 * 电缆 — CABLE BALL. Every wall bounce alternately plants a plug and then
 * strings a coloured cable from the plug to the next bounce point. Cables
 * stay live for a few seconds; touching one shocks the enemy, slowing it to a
 * crawl and zapping it repeatedly until the shock wears off.
 */
export class CableAbility extends Ability {
  private cables: Cable[] = []
  /** Plug waiting for the next bounce to complete a cable. */
  private anchor: Anchor | null = null
  /** World time the current shock wears off. */
  private shockUntil = -Infinity
  private nextTick = 0

  override onWallBounce(e: WallBounce): void {
    if (!this.world.combatActive || this.owner.disarmed) {
      // A disarmed ball can't string a cable; drop any half-finished one.
      this.anchor = null
      return
    }
    const here: Anchor = { point: { x: e.point.x, y: e.point.y }, normal: { x: e.normal.x, y: e.normal.y }, wall: e.wall, color: '' }
    const held = this.anchor
    if (!held) {
      here.color = this.world.rng.pick(CABLE_COLORS)
      this.anchor = here
      this.world.sound('place', 0.35, 1.3)
      return
    }
    const chord = dm.hypot(here.point.x - held.point.x, here.point.y - held.point.y)
    if (held.wall === here.wall || chord < MIN_CHORD) {
      // Re-plug here, keeping the colour already picked.
      here.color = held.color
      this.anchor = here
      return
    }
    here.color = held.color
    this.string(held, here)
    this.anchor = null
  }

  private string(a: Anchor, b: Anchor): void {
    const dx = b.point.x - a.point.x
    const dy = b.point.y - a.point.y
    const chord = dm.hypot(dx, dy)
    const side = this.world.rng.sign()
    // A quadratic's apex sits halfway between the chord midpoint and the control point.
    const off = 2 * BOW * chord * side
    const control = {
      x: (a.point.x + b.point.x) / 2 + (-dy / chord) * off,
      y: (a.point.y + b.point.y) / 2 + (dx / chord) * off,
    }
    const pts: Vec[] = []
    for (let i = 0; i <= SEGMENTS; i++) pts.push(quadPoint(a.point, control, b.point, i / SEGMENTS))
    if (this.cables.length >= MAX_CABLES) this.cables.shift()
    this.cables.push({ a, b, control, pts, color: a.color, age: 0 })
    this.world.sound('thread', 0.6, 0.7)
    this.world.effects.burst(b.point, { count: 8, color: ['#ffffff', '#fef08a', a.color], shape: 'spark', speed: [80, 240], size: [1.5, 3], life: [0.15, 0.3], direction: dm.atan2(b.normal.y, b.normal.x), spread: 1.2 })
  }

  override update(dt: number): void {
    for (const c of this.cables) c.age += dt
    this.cables = this.cables.filter((c) => c.age < CABLE_LIFE)

    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const now = this.world.time
    const reach = e.radius + TOUCH_MARGIN
    const touching = this.cables.some((c) => distanceToPolyline(e.pos, c.pts) < reach)
    if (touching) {
      if (now >= this.shockUntil) {
        // Fresh shock: zap right away.
        this.nextTick = now
        this.world.sound('zap', 0.5, 1.2)
      }
      this.shockUntil = now + SHOCK_DURATION
    }
    if (now >= this.shockUntil) return
    e.applySlow(SHOCK_SLOW, SLOW_REFRESH)
    if (now >= this.nextTick) {
      this.nextTick += SHOCK_TICK
      this.world.damage(e, SHOCK_DAMAGE, { kind: 'cable', source: this.owner, at: e.pos })
    }
  }

  private get shocked(): boolean {
    return this.enemy.alive && this.world.time < this.shockUntil
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    for (const c of this.cables) {
      const k = clamp((CABLE_LIFE - c.age) / FADE_TIME, 0, 1)
      // Snap taut over the first few frames.
      const grow = clamp(c.age / 0.08, 0, 1)
      const control = {
        x: (c.a.point.x + c.b.point.x) / 2 + (c.control.x - (c.a.point.x + c.b.point.x) / 2) * grow,
        y: (c.a.point.y + c.b.point.y) / 2 + (c.control.y - (c.a.point.y + c.b.point.y) / 2) * grow,
      }
      ctx.globalAlpha = fade * k
      drawCable(ctx, c.a.point, control, c.b.point, c.color, TUBE_WIDTH * (0.45 + 0.55 * k), 1 - k)
      drawPlug(ctx, c.a.point, c.a.normal, PLUG_SIZE)
      drawPlug(ctx, c.b.point, c.b.normal, PLUG_SIZE)
    }
    const h = this.anchor
    if (h && this.owner.alive) {
      // Thin, harmless lead trailing from the plug to the ball.
      ctx.globalAlpha = fade * 0.75
      ctx.strokeStyle = h.color
      ctx.lineWidth = 1.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(h.point.x + h.normal.x * PLUG_SIZE * 0.5, h.point.y + h.normal.y * PLUG_SIZE * 0.5)
      ctx.lineTo(this.owner.pos.x, this.owner.pos.y)
      ctx.stroke()
      ctx.globalAlpha = fade
      drawPlug(ctx, h.point, h.normal, PLUG_SIZE)
    }
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    ctx.save()
    ctx.shadowColor = 'rgba(246,204,36,0.55)'
    ctx.shadowBlur = 12
    ctx.fillStyle = o.color
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, o.radius * o.drawScale, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    if (this.presence <= 0 || !this.shocked) return
    const e = this.enemy
    // Flickering starburst of tiny white spikes around the shocked enemy.
    const frame = Math.floor(this.world.time * 20)
    const spikes = 14
    ctx.save()
    ctx.strokeStyle = '#ffffff'
    ctx.shadowColor = '#bae6fd'
    ctx.shadowBlur = 6
    ctx.lineWidth = 1.6
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (let i = 0; i < spikes; i++) {
      const j = hash(frame * 31 + i * 7)
      const a = (i / spikes) * Math.PI * 2 + (hash(frame) - 0.5) * 0.5
      const r0 = e.radius + 2
      const r1 = r0 + 4 + j * 7
      ctx.moveTo(e.pos.x + dm.cos(a) * r0, e.pos.y + dm.sin(a) * r0)
      ctx.lineTo(e.pos.x + dm.cos(a) * r1, e.pos.y + dm.sin(a) * r1)
    }
    ctx.stroke()
    ctx.restore()
  }
}

function quadPoint(a: Vec, c: Vec, b: Vec, t: number): Vec {
  const u = 1 - t
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }
}

function distanceToPolyline(p: Vec, pts: readonly Vec[]): number {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distanceToSegment(p, pts[i - 1], pts[i]))
  return best
}

function hash(n: number): number {
  const x = dm.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** Mixes `hex` towards `to` by `t` (0..1). */
function mix(hex: string, to: string, t: number): string {
  const a = hexRgb(hex)
  const b = hexRgb(to)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

/**
 * A coloured tube along a quadratic curve: darker edge, body, lighter core
 * line and a few clamps. `dim` (0..1) darkens it as it dies.
 */
export function drawCable(ctx: CanvasRenderingContext2D, a: Vec, c: Vec, b: Vec, color: string, width: number, dim = 0): void {
  const dark = '#141414'
  const body = mix(color, dark, dim * 0.7)
  const edge = mix(color, dark, 0.45 + dim * 0.4)
  const core = dim > 0 ? mix(color, '#ffffff', 0.45 * (1 - dim)) : mix(color, '#ffffff', 0.45)
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y)
  }
  ctx.save()
  ctx.lineCap = 'butt'
  ctx.strokeStyle = edge
  ctx.lineWidth = width
  path()
  ctx.stroke()
  ctx.strokeStyle = body
  ctx.lineWidth = width * 0.68
  path()
  ctx.stroke()
  ctx.strokeStyle = core
  ctx.lineWidth = Math.max(0.8, width * 0.2)
  path()
  ctx.stroke()

  // Clamps: two on short runs, three on long ones.
  const chord = dm.hypot(b.x - a.x, b.y - a.y)
  const ts = chord > BALL_RADIUS * 8 ? [0.25, 0.5, 0.75] : [0.33, 0.67]
  ctx.fillStyle = mix(color, dark, 0.55 + dim * 0.3)
  for (const t of ts) {
    const p = quadPoint(a, c, b, t)
    // Derivative of the quadratic gives the tangent.
    const tx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x)
    const ty = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y)
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(dm.atan2(ty, tx))
    const l = width * 1.2
    const w = width * 1.3
    ctx.fillRect(-l / 2, -w / 2, l, w)
    ctx.restore()
  }
  ctx.restore()
}

/** Small dark square plug seated against the wall at `at`. */
export function drawPlug(ctx: CanvasRenderingContext2D, at: Vec, normal: Vec, size: number): void {
  const cx = at.x + normal.x * size * 0.5
  const cy = at.y + normal.y * size * 0.5
  ctx.save()
  ctx.fillStyle = '#26262b'
  ctx.strokeStyle = '#0c0c0e'
  ctx.lineWidth = 1
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size)
  ctx.strokeRect(cx - size / 2, cy - size / 2, size, size)
  ctx.fillStyle = '#4b4b52'
  ctx.fillRect(cx - size * 0.18, cy - size * 0.18, size * 0.36, size * 0.36)
  ctx.restore()
}

export function drawCablePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const w = r * 0.23
  const runs: [Vec, Vec, Vec, Vec, string][] = [
    // from, to, wall normal at from, wall normal at to, colour
    [{ x: cx - 2.4 * r, y: cy - 1.3 * r }, { x: cx + 0.6 * r, y: cy - 2.4 * r }, { x: 1, y: 0 }, { x: 0, y: 1 }, '#e43630'],
    [{ x: cx - 2.4 * r, y: cy + 1.1 * r }, { x: cx + 2.4 * r, y: cy + 1.9 * r }, { x: 1, y: 0 }, { x: -1, y: 0 }, '#36b4d8'],
    [{ x: cx + 1.4 * r, y: cy - 2.4 * r }, { x: cx + 2.4 * r, y: cy + 0.2 * r }, { x: 0, y: 1 }, { x: -1, y: 0 }, '#24a254'],
  ]
  for (const [a, b, na, nb, c] of runs) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = dm.hypot(dx, dy)
    const ctrl = { x: (a.x + b.x) / 2 + (-dy / l) * 0.2 * l, y: (a.y + b.y) / 2 + (dx / l) * 0.2 * l }
    drawCable(ctx, a, ctrl, b, c, w)
    drawPlug(ctx, a, na, r * 0.34)
    drawPlug(ctx, b, nb, r * 0.34)
  }
  ctx.save()
  ctx.shadowColor = 'rgba(246,204,36,0.6)'
  ctx.shadowBlur = 14
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export const cableDef: CharacterDef = {
  id: 'cable',
  nameEn: 'CABLE BALL',
  ruleValues: { maxCables: MAX_CABLES, cableLife: CABLE_LIFE, shockDuration: SHOCK_DURATION, shockTick: SHOCK_TICK, shockDamage: SHOCK_DAMAGE, shockSlowPercent: Math.round(SHOCK_SLOW * 100) },
  palette: { ball: '#f6cc24', text: '#ffffff', accent: '#f6cc24' },
  mirrorPalette: { ball: '#a16207', text: '#fef9c3', accent: '#eab308' },
  create: (w, b) => new CableAbility(w, b),
  drawPortrait: drawCablePortrait,
}
