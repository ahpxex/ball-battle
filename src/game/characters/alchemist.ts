import * as dm from '../core/dmath'
import { type Vec, cube, distSq, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

const FIRST_THROW = 2.5
export const THROW_INTERVAL = 1.6
/** The next bottle is shown in hand this long before it is thrown (s). */
const WINDUP = 0.5
const FLIGHT_TIME = 0.4
/** Throw distance from the alchemist, in ball radii. */
const THROW_MIN = 1
const THROW_MAX = 3
/** Random deviation from the direction to the enemy (rad). */
const THROW_SCATTER = 0.6
export const CLOUD_RADIUS = BALL_RADIUS * 2.7
const CLOUD_GROW = 0.4
export const CLOUD_LIFETIME = 4.5
const CLOUD_FADE = 1
export const MAX_CLOUDS = 4

export const GREEN_DAMAGE = 2
export const GREEN_TICK = 0.5
const GREEN_POISON_TICKS = 4
const GREEN_POISON_MAX = 6
export const RED_DAMAGE = 2
export const RED_TICK = 0.35
export const BLUE_DAMAGE = 2
export const BLUE_TICK = 0.25
/** Freeze refreshed every step the enemy spends in a frost cloud. */
const FREEZE_REFRESH = 0.2

type PotionKind = 'green' | 'red' | 'blue'

const POTION_WEIGHTS: readonly [PotionKind, number][] = [
  ['red', 0.4],
  ['green', 0.3],
  ['blue', 0.3],
]

interface PotionLook {
  /** Liquid / bubble fill. */
  fill: string
  /** Bubble highlight. */
  light: string
  /** Bubble outline. */
  edge: string
  /** Faint cloud floor tint. */
  haze: string
}

const LOOKS: Record<PotionKind, PotionLook> = {
  green: { fill: '#3fc04a', light: '#a7f3a0', edge: '#1f7a2a', haze: 'rgba(63,192,74,0.16)' },
  red: { fill: '#e03030', light: '#ff9a9a', edge: '#8a1414', haze: 'rgba(224,48,48,0.16)' },
  blue: { fill: '#c4efff', light: '#ffffff', edge: '#6cc4e8', haze: 'rgba(196,239,255,0.14)' },
}

const TICKS: Record<PotionKind, number> = { green: GREEN_TICK, red: RED_TICK, blue: BLUE_TICK }

interface Bubble {
  /** Offset from the cloud centre, in cloud radii. */
  x: number
  y: number
  /** Radius, in cloud radii. */
  r: number
  phase: number
}

interface Flask {
  kind: PotionKind
  from: Vec
  to: Vec
  t: number
  /** Cosmetic tumble rate (rad/s). */
  tumble: number
}

interface Cloud {
  kind: PotionKind
  pos: Vec
  age: number
  bubbles: Bubble[]
}

/** One jagged crack, in units of the target's radius. */
type Crack = Vec[]

/**
 * 药剂师 ALCHEMIST — a witch-hatted ball that lobs a random potion toward
 * the enemy every few seconds. Each bottle shatters into a lingering cloud:
 * green poisons, red burns like acid, blue freezes the enemy solid. Its own
 * clouds never affect it.
 */
export class AlchemistAbility extends Ability {
  private timer = FIRST_THROW
  /** Potion chosen for the next throw, shown in hand during the windup. */
  private held: PotionKind | null = null
  private flasks: Flask[] = []
  private clouds: Cloud[] = []
  /** Per-potion world time the next effect tick may land. */
  private nextTick: Record<PotionKind, number> = { green: 0, red: 0, blue: 0 }
  /** 0..1 strength of the frozen overlay on the enemy. */
  private frozenLook = 0
  private readonly cracks: Crack[]

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.cracks = makeCracks(() => world.effects.random())
  }

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.held === null && this.timer <= WINDUP) this.held = this.pickPotion()
      if (this.timer <= 0) {
        this.timer += THROW_INTERVAL
        this.throwFlask()
      }
    }
    for (const f of this.flasks) f.t += dt
    for (const f of this.flasks) if (f.t >= FLIGHT_TIME) this.shatter(f)
    this.flasks = this.flasks.filter((f) => f.t < FLIGHT_TIME)
    for (const c of this.clouds) c.age += dt
    this.clouds = this.clouds.filter((c) => c.age < CLOUD_LIFETIME)
    this.affect(dt)
  }

  private pickPotion(): PotionKind {
    let u = this.world.rng.next() * POTION_WEIGHTS.reduce((s, [, w]) => s + w, 0)
    for (const [kind, w] of POTION_WEIGHTS) {
      u -= w
      if (u < 0) return kind
    }
    return POTION_WEIGHTS[POTION_WEIGHTS.length - 1][0]
  }

  private throwFlask(): void {
    const o = this.owner
    const e = this.enemy
    const rng = this.world.rng
    const kind = this.held ?? this.pickPotion()
    this.held = null
    const dir = dm.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x) + rng.range(-THROW_SCATTER, THROW_SCATTER)
    const dist = BALL_RADIUS * rng.range(THROW_MIN, THROW_MAX)
    // Keep the landing point inside the arena so the cloud isn't wasted on a wall.
    const s = this.world.size
    const m = BALL_RADIUS * 0.5
    const to = {
      x: Math.min(s - m, Math.max(m, o.pos.x + dm.cos(dir) * dist)),
      y: Math.min(s - m, Math.max(m, o.pos.y + dm.sin(dir) * dist)),
    }
    const hand = handPos(o)
    this.flasks.push({ kind, from: hand, to, t: 0, tumble: (to.x >= hand.x ? 1 : -1) * 14 })
    this.world.sound('throw', 0.45)
  }

  private shatter(f: Flask): void {
    const look = LOOKS[f.kind]
    const fx = this.world.effects
    fx.burst(f.to, { count: 8, color: ['#e2e8f0', '#ffffff', look.fill], shape: 'shard', speed: [60, 200], size: [2, 4], life: [0.2, 0.45] })
    fx.burst(f.to, { count: 6, color: [look.fill, look.light], shape: 'smoke', speed: [20, 90], size: [6, 12], life: [0.3, 0.6], endScale: 2 })
    this.world.sound('clack', 0.35, 2.2)
    if (this.clouds.length >= MAX_CLOUDS) this.clouds.shift()
    this.clouds.push({ kind: f.kind, pos: { x: f.to.x, y: f.to.y }, age: 0, bubbles: makeBubbles(() => fx.random()) })
  }

  /** Applies every potion type the enemy currently stands in. */
  private affect(dt: number): void {
    const e = this.enemy
    const active = e.alive && this.world.combatActive
    const inside: Record<PotionKind, boolean> = { green: false, red: false, blue: false }
    if (active) {
      for (const c of this.clouds) {
        if (c.age < CLOUD_GROW) continue
        if (distSq(e.pos, c.pos) < CLOUD_RADIUS * CLOUD_RADIUS) inside[c.kind] = true
      }
    }
    const frozen = inside.blue && !e.invulnerable
    this.frozenLook = frozen ? Math.min(1, this.frozenLook + dt * 8) : Math.max(0, this.frozenLook - dt / FREEZE_REFRESH)
    if (!active) return
    if (frozen) e.applySlow(0, FREEZE_REFRESH)

    const now = this.world.time
    for (const kind of ['green', 'red', 'blue'] as const) {
      if (!inside[kind] || now < this.nextTick[kind] || !e.alive) continue
      this.nextTick[kind] = now + TICKS[kind]
      const amount = kind === 'green' ? GREEN_DAMAGE : kind === 'red' ? RED_DAMAGE : BLUE_DAMAGE
      const dealt = this.world.damage(e, amount, { kind: 'potion', source: this.owner, at: e.pos })
      if (kind === 'green' && dealt > 0 && e.alive) e.applyPoison(GREEN_POISON_TICKS, this.owner, GREEN_POISON_MAX)
    }
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.clouds.length === 0) return
    const now = this.world.time
    ctx.save()
    for (const c of this.clouds) {
      const grow = easeOutBack(Math.min(1, c.age / CLOUD_GROW))
      const alpha = Math.min(1, (CLOUD_LIFETIME - c.age) / CLOUD_FADE) * fade
      if (alpha <= 0) continue
      ctx.globalAlpha = alpha
      drawCloud(ctx, c.pos.x, c.pos.y, CLOUD_RADIUS * (0.25 + 0.75 * grow), c.bubbles, LOOKS[c.kind], now)
    }
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const r = o.radius * o.drawScale
    drawWitchHat(ctx, o.pos.x, o.pos.y - r * 1.1, r)
    if (this.held !== null) {
      const h = handPos(o)
      drawPotionBottle(ctx, h.x, h.y, r * 0.5, LOOKS[this.held].fill, 0.25)
    }
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const f of this.flasks) {
      const u = f.t / FLIGHT_TIME
      const x = f.from.x + (f.to.x - f.from.x) * u
      const y = f.from.y + (f.to.y - f.from.y) * u - dm.sin(u * Math.PI) * BALL_RADIUS * 1.2
      drawPotionBottle(ctx, x, y, BALL_RADIUS * 0.5, LOOKS[f.kind].fill, f.t * f.tumble)
    }
    ctx.restore()
    const e = this.enemy
    const v = this.frozenLook * fade
    if (v > 0 && e.alive) drawFrozenOverlay(ctx, e.pos.x, e.pos.y, e.radius * e.drawScale, this.cracks, v * e.opacity)
  }
}

/** Where the next bottle is held: the lower right of the ball. */
function handPos(o: Ball): Vec {
  const r = o.radius * o.drawScale
  return { x: o.pos.x + r * 0.78, y: o.pos.y + r * 0.62 }
}

function easeOutBack(t: number): number {
  const c = 1.6
  return 1 + (c + 1) * cube(t - 1) + c * sq(t - 1)
}

/** Random bubble layout filling a unit disk, larger bubbles towards the middle. */
function makeBubbles(rnd: () => number): Bubble[] {
  const out: Bubble[] = []
  // Rim ring first so the cloud reads as a circle, then a filled core.
  const rim = 16
  for (let i = 0; i < rim; i++) {
    const a = (i / rim) * Math.PI * 2 + (rnd() - 0.5) * 0.25
    const d = 0.84 + rnd() * 0.06
    out.push({ x: dm.cos(a) * d, y: dm.sin(a) * d, r: 0.11 + rnd() * 0.06, phase: rnd() * Math.PI * 2 })
  }
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * 0.72
    out.push({ x: dm.cos(a) * d, y: dm.sin(a) * d, r: 0.1 + rnd() * 0.12, phase: rnd() * Math.PI * 2 })
  }
  return out
}

function drawCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, bubbles: readonly Bubble[], look: PotionLook, time: number): void {
  ctx.save()
  ctx.fillStyle = look.haze
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
  const base = ctx.globalAlpha
  ctx.lineWidth = 1.2
  ctx.strokeStyle = look.edge
  for (const b of bubbles) {
    const wobble = dm.sin(time * 2.2 + b.phase)
    const x = cx + (b.x + dm.cos(b.phase) * wobble * 0.025) * radius
    const y = cy + (b.y + dm.sin(b.phase) * wobble * 0.025) * radius
    const r = b.r * radius * (1 + wobble * 0.08)
    ctx.globalAlpha = base * 0.62
    ctx.fillStyle = look.fill
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = base * 0.5
    ctx.stroke()
    ctx.globalAlpha = base * 0.7
    ctx.fillStyle = look.light
    ctx.beginPath()
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** A small round-bottomed potion bottle of total height `h`, centred at (x, y). */
export function drawPotionBottle(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, liquid: string, rot: number): void {
  const bodyR = h * 0.32
  const neckW = h * 0.24
  const neckH = h * 0.3
  const corkH = h * 0.16
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  // Lay out from the bottom (+y) up: body, neck, cork.
  const bodyY = h * 0.5 - bodyR
  const neckTop = bodyY - bodyR - neckH + bodyR * 0.25
  // Glass.
  ctx.fillStyle = 'rgba(226,232,240,0.5)'
  ctx.strokeStyle = '#f8fafc'
  ctx.lineWidth = 1.1
  ctx.beginPath()
  ctx.arc(0, bodyY, bodyR, 0, Math.PI * 2)
  ctx.rect(-neckW / 2, neckTop, neckW, neckH)
  ctx.fill()
  // Liquid: the body filled to a little above its middle.
  ctx.fillStyle = liquid
  ctx.beginPath()
  ctx.arc(0, bodyY, bodyR * 0.82, -0.45, Math.PI + 0.45)
  ctx.closePath()
  ctx.fill()
  // Outline.
  ctx.beginPath()
  ctx.arc(0, bodyY, bodyR, -Math.PI / 2 + 0.38, Math.PI * 1.5 - 0.38)
  ctx.lineTo(-neckW / 2, neckTop)
  ctx.lineTo(neckW / 2, neckTop)
  ctx.closePath()
  ctx.stroke()
  // Cork.
  ctx.fillStyle = '#b07a3e'
  ctx.fillRect(-neckW * 0.6, neckTop - corkH, neckW * 1.2, corkH)
  // Glint.
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.arc(-bodyR * 0.4, bodyY - bodyR * 0.3, bodyR * 0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Dark purple pointed witch hat for a ball of radius `r`, hat centre at (x, y). */
export function drawWitchHat(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const brimY = y + r * 0.38
  ctx.save()
  // Cone with a slightly bent tip.
  ctx.fillStyle = '#481967'
  ctx.beginPath()
  ctx.moveTo(x - r * 0.52, brimY)
  ctx.quadraticCurveTo(x - r * 0.2, y - r * 0.2, x + r * 0.08, y - r * 0.95)
  ctx.quadraticCurveTo(x + r * 0.28, y - r * 0.82, x + r * 0.42, y - r * 0.7)
  ctx.quadraticCurveTo(x + r * 0.22, y - r * 0.4, x + r * 0.52, brimY)
  ctx.closePath()
  ctx.fill()
  // Brim.
  ctx.beginPath()
  ctx.ellipse(x, brimY, r * 0.85, r * 0.16, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#2e0f44'
  ctx.lineWidth = 1
  ctx.stroke()
  // Band with gold buckle.
  ctx.fillStyle = '#2e0f44'
  ctx.beginPath()
  ctx.moveTo(x - r * 0.5, brimY - r * 0.02)
  ctx.lineTo(x - r * 0.44, brimY - r * 0.2)
  ctx.lineTo(x + r * 0.44, brimY - r * 0.2)
  ctx.lineTo(x + r * 0.5, brimY - r * 0.02)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#e8b931'
  ctx.lineWidth = Math.max(1, r * 0.06)
  ctx.strokeRect(x - r * 0.1, brimY - r * 0.19, r * 0.2, r * 0.16)
  ctx.restore()
}

/** A few jagged cracks radiating from a point near the centre, in radius units. */
function makeCracks(rnd: () => number): Crack[] {
  const origin = { x: (rnd() - 0.5) * 0.4, y: (rnd() - 0.5) * 0.4 }
  const cracks: Crack[] = []
  const count = 5
  for (let i = 0; i < count; i++) {
    const heading = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.8
    const pts: Vec[] = [origin]
    let x = origin.x
    let y = origin.y
    const segs = 3 + Math.floor(rnd() * 2)
    const step = 1.15 / segs
    for (let k = 0; k < segs; k++) {
      const a = heading + (rnd() - 0.5) * 1.1
      x += dm.cos(a) * step
      y += dm.sin(a) * step
      pts.push({ x, y })
    }
    cracks.push(pts)
    if (rnd() < 0.6) {
      const mid = pts[Math.min(2, pts.length - 1)]
      const a = heading + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.5)
      cracks.push([mid, { x: mid.x + dm.cos(a) * 0.35, y: mid.y + dm.sin(a) * 0.35 }])
    }
  }
  return cracks
}

/** Icy tint and white crack lines over a frozen ball. */
function drawFrozenOverlay(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cracks: readonly Crack[], alpha: number): void {
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(196,239,255,0.4)'
  ctx.fill()
  ctx.clip()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const c of cracks) {
    ctx.moveTo(cx + c[0].x * r, cy + c[0].y * r)
    for (let i = 1; i < c.length; i++) ctx.lineTo(cx + c[i].x * r, cy + c[i].y * r)
  }
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawAlchemistPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // Deterministic bubble layout so the portrait never changes.
  let seed = 7
  const rnd = () => {
    const h = dm.sin(seed++ * 12.9898) * 43758.5453
    return h - Math.floor(h)
  }
  drawCloud(ctx, cx - r * 1.05, cy + r * 1.1, r * 1.35, makeBubbles(rnd), LOOKS.green, 0)
  const br = r * 0.85
  const x = cx + r * 0.25
  const y = cy + r * 0.45
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  drawWitchHat(ctx, x, y - br * 1.1, br)
  drawPotionBottle(ctx, x + br * 0.78, y + br * 0.62, br * 0.5, LOOKS.red.fill, 0.25)
}

export const alchemistDef: CharacterDef = {
  id: 'alchemist',
  nameEn: 'ALCHEMIST',
  ruleValues: { throwInterval: THROW_INTERVAL, cloudLifetime: CLOUD_LIFETIME, maxClouds: MAX_CLOUDS, greenTick: GREEN_TICK, greenDamage: GREEN_DAMAGE, redTick: RED_TICK, redDamage: RED_DAMAGE, blueTick: BLUE_TICK, blueDamage: BLUE_DAMAGE },
  palette: { ball: '#7434b9', text: '#ffffff', accent: '#8b4fd1' },
  mirrorPalette: { ball: '#4c1d95', text: '#ede9fe', accent: '#a78bfa' },
  create: (w, b) => new AlchemistAbility(w, b),
  drawPortrait: drawAlchemistPortrait,
}
