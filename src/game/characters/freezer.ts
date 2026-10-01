import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

/** Global chill: damage and interval, at any range. */
export const CHILL_DAMAGE = 1
export const CHILL_TICK = 0.5
const FIRST_WAVE = 5.0
/** Time between pillar waves (s). */
export const WAVE_INTERVAL = 8.5
export const PILLARS_PER_WAVE = 3
/** Warning before a pillar rises (s). */
const TELEGRAPH_TIME = 0.3
/** How long a risen pillar stays (s). */
export const PILLAR_ACTIVE = 4.7
const RISE_TIME = 0.25
const FADE_TIME = 0.25
/** Gameplay footprint of a pillar. */
const PILLAR_RADIUS = BALL_RADIUS * 0.8
/** Pillar centres keep at least this far from the walls. */
const WALL_MARGIN = BALL_RADIUS
/** Preferred spacing between pillars of one wave (best effort). */
const PILLAR_SPACING = BALL_RADIUS * 2.2
export const PILLAR_DAMAGE = 3
/** Repeat hit interval while the enemy stays on a pillar (s). */
export const PILLAR_TICK = 1.0
export const PILLAR_SLOW = 0.1
const SLOW_REFRESH = 0.15
const PILLAR_HEIGHT = BALL_RADIUS * 3

const ICE_MID = '#32bef0'
const ICE_LIGHT = '#50c8ff'
const ICE_DARK = '#1b8fc4'
const ICE_EDGE = '#0d5f8c'
const ICE_RIM = '#c9f1ff'

/** Three pillar silhouettes: wide flat top, wide "M" top, thin spike. */
type PillarVariant = 0 | 1 | 2

interface Pillar {
  pos: Vec
  /** Time since the telegraph appeared. */
  age: number
  variant: PillarVariant
  /** Whether the enemy overlapped this pillar last step. */
  touching: boolean
  /** Seconds until the next repeat hit while touching. */
  tickTimer: number
}

/**
 * 冰川 FREEZER — radiates a constant chill that nibbles at the enemy from
 * anywhere in the arena, and periodically raises clusters of tall ice
 * pillars. An enemy that brushes a pillar takes a hard hit, keeps taking it
 * while it stays, and is slowed to a crawl. Pillars never block anyone.
 */
export class FreezerAbility extends Ability {
  private chillTimer = CHILL_TICK
  private waveTimer = FIRST_WAVE
  private pillars: Pillar[] = []
  /** 0..1 strength of the frozen ring around the enemy. */
  private frozenLook = 0

  override update(dt: number): void {
    const world = this.world
    if (world.combatActive && !this.owner.disarmed) {
      this.chill(dt)
      this.waveTimer -= dt
      if (this.waveTimer <= 0) {
        this.waveTimer += WAVE_INTERVAL
        this.raiseWave()
      }
    }
    const kept: Pillar[] = []
    let frozen = false
    for (const p of this.pillars) {
      const wasRising = p.age < TELEGRAPH_TIME
      p.age += dt
      if (p.age >= TELEGRAPH_TIME + PILLAR_ACTIVE) continue
      kept.push(p)
      if (p.age < TELEGRAPH_TIME) continue
      if (wasRising) this.risen(p)
      if (this.pillarContact(p, dt)) frozen = true
    }
    this.pillars = kept
    this.frozenLook = frozen ? Math.min(1, this.frozenLook + dt * 10) : Math.max(0, this.frozenLook - dt * 5)
  }

  private chill(dt: number): void {
    this.chillTimer -= dt
    if (this.chillTimer > 0) return
    this.chillTimer += CHILL_TICK
    const e = this.enemy
    if (e.alive) this.world.damage(e, CHILL_DAMAGE, { kind: 'ice', source: this.owner, at: e.pos })
  }

  private raiseWave(): void {
    const rng = this.world.rng
    const s = this.world.size
    const placed: Vec[] = []
    for (let i = 0; i < PILLARS_PER_WAVE; i++) {
      // A few tries to keep the wave spread out; the last try is accepted regardless.
      let at = { x: 0, y: 0 }
      for (let attempt = 0; attempt < 8; attempt++) {
        at = { x: rng.range(WALL_MARGIN, s - WALL_MARGIN), y: rng.range(WALL_MARGIN, s - WALL_MARGIN) }
        if (placed.every((q) => (q.x - at.x) ** 2 + (q.y - at.y) ** 2 >= PILLAR_SPACING * PILLAR_SPACING)) break
      }
      placed.push(at)
      this.pillars.push({ pos: at, age: 0, variant: rng.int(0, 2) as PillarVariant, touching: false, tickTimer: 0 })
      this.world.effects.burst(at, { count: 6, color: ['#ffffff', '#e0f2fe'], shape: 'smoke', speed: [10, 50], size: [4, 8], life: [0.25, 0.45], endScale: 1.8, front: false })
    }
    this.world.sound('place', 0.45, 1.6)
  }

  /** The pillar just finished its telegraph and bursts out of the floor. */
  private risen(p: Pillar): void {
    const fx = this.world.effects
    fx.burst(p.pos, { count: 14, color: ['#ffffff', '#bae6fd', ICE_LIGHT, ICE_MID], shape: 'shard', speed: [80, 260], size: [2, 4.5], life: [0.3, 0.6], gravity: 220, drag: 2.5 })
    fx.burst(p.pos, { count: 8, color: ['#e0f2fe', '#ffffff'], shape: 'smoke', speed: [30, 110], size: [6, 11], life: [0.35, 0.7], endScale: 2 })
    this.world.sound('spike', 0.5, 1.4)
  }

  /** Damages / slows the enemy on this pillar; returns whether it is frozen by it. */
  private pillarContact(p: Pillar, dt: number): boolean {
    const e = this.enemy
    const reach = e.radius + PILLAR_RADIUS
    const dx = e.pos.x - p.pos.x
    const dy = e.pos.y - p.pos.y
    const over = e.alive && this.world.combatActive && dx * dx + dy * dy < reach * reach
    if (!over) {
      p.touching = false
      return false
    }
    if (!e.invulnerable) e.applySlow(PILLAR_SLOW, SLOW_REFRESH)
    const d = Math.hypot(dx, dy) || 1
    const at = { x: e.pos.x - (dx / d) * e.radius, y: e.pos.y - (dy / d) * e.radius }
    if (!p.touching) {
      p.touching = true
      p.tickTimer = PILLAR_TICK
      this.world.damage(e, PILLAR_DAMAGE, { kind: 'ice', source: this.owner, at })
    } else {
      p.tickTimer -= dt
      if (p.tickTimer <= 0) {
        p.tickTimer += PILLAR_TICK
        this.world.damage(e, PILLAR_DAMAGE, { kind: 'ice', source: this.owner, at })
      }
    }
    return !e.invulnerable
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const p of this.pillars) {
      if (p.age >= TELEGRAPH_TIME) continue
      drawTelegraph(ctx, p.pos.x, p.pos.y, p.age / TELEGRAPH_TIME, this.world.time)
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const e = this.enemy
    const ring = this.frozenLook * fade
    if (ring > 0 && e.alive) drawFrozenRing(ctx, e.pos.x, e.pos.y, e.radius * e.drawScale, this.world.time, ring * e.opacity)

    const risen = this.pillars.filter((p) => p.age >= TELEGRAPH_TIME).sort((a, b) => a.pos.y - b.pos.y)
    for (const p of risen) {
      const t = p.age - TELEGRAPH_TIME
      const rise = easeOutBack(clamp(t / RISE_TIME, 0, 1))
      const alpha = clamp((PILLAR_ACTIVE - t) / FADE_TIME, 0, 1)
      ctx.save()
      ctx.globalAlpha = fade * alpha
      drawIcePillar(ctx, p.pos.x, p.pos.y, p.variant, BALL_RADIUS, rise)
      ctx.restore()
    }
  }
}

function easeOutBack(u: number): number {
  const c = 1.6
  return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2
}

/** A ring of white dots closing in where a pillar is about to rise. */
function drawTelegraph(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, time: number): void {
  const dots = 12
  const r = PILLAR_RADIUS * (1.35 - 0.35 * u)
  ctx.save()
  ctx.fillStyle = `rgba(186,230,253,${0.12 + 0.2 * u})`
  ctx.beginPath()
  ctx.ellipse(x, y, PILLAR_RADIUS, PILLAR_RADIUS * 0.55, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < dots; i++) {
    const a = (i / dots) * Math.PI * 2 + time * 2
    ctx.beginPath()
    ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, 1.6 + 1.2 * u, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Dotted white ring marking an enemy held by a pillar. */
function drawFrozenRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, time: number, alpha: number): void {
  const dots = 18
  const rr = r + 6
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < dots; i++) {
    const a = (i / dots) * Math.PI * 2 - time * 0.8
    ctx.beginPath()
    ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 1.8, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Top silhouette of each variant: [x, y] pairs from left to right, x in [-1, 1], y as a fraction of the height. */
const TOP_PROFILES: Record<PillarVariant, readonly (readonly [number, number])[]> = {
  0: [[-1, 0.9], [-0.7, 0.97], [-0.35, 1], [-0.05, 0.96], [0.35, 1], [0.7, 0.95], [1, 0.88]],
  1: [[-1, 0.84], [-0.55, 1.02], [-0.3, 0.9], [0, 0.78], [0.3, 0.92], [0.55, 1.0], [1, 0.82]],
  2: [[-1, 0.8], [-0.45, 0.95], [-0.1, 1.06], [0.3, 0.96], [1, 0.78]],
}
/** Half-width of each variant, in ball radii. */
const HALF_WIDTH: Record<PillarVariant, number> = { 0: 1, 1: 1, 2: 0.5 }

/**
 * Pseudo-3D faceted ice slab standing on (x, y): lit left face, mid front,
 * shaded right face, grooves and a jagged top. `unit` is the ball radius
 * and `rise` (0..1+) scales the height while it grows out of the floor.
 */
export function drawIcePillar(ctx: CanvasRenderingContext2D, x: number, y: number, variant: PillarVariant, unit: number, rise: number): void {
  const w = HALF_WIDTH[variant] * unit
  const h = (PILLAR_HEIGHT / BALL_RADIUS) * unit * Math.max(0, rise)
  const sag = w * 0.28
  const profile = TOP_PROFILES[variant]
  // Base shadow.
  const sr = Math.max(w * 1.2, (PILLAR_RADIUS / BALL_RADIUS) * unit)
  ctx.save()
  ctx.fillStyle = 'rgba(0,10,20,0.55)'
  ctx.beginPath()
  ctx.ellipse(x, y + sag * 0.4, sr, sr * 0.4, 0, 0, Math.PI * 2)
  ctx.fill()
  if (h < 1) {
    ctx.restore()
    return
  }
  // Outline: jagged top left→right, then the curved bottom edge right→left.
  const bottomY = (fx: number) => y + Math.sqrt(Math.max(0, 1 - fx * fx)) * sag
  const outline = new Path2D()
  profile.forEach(([fx, fy], i) => {
    const px = x + fx * w
    const py = bottomY(fx) - fy * h
    if (i === 0) outline.moveTo(px, py)
    else outline.lineTo(px, py)
  })
  for (let i = 8; i >= -8; i--) {
    const fx = i / 8
    outline.lineTo(x + fx * w, bottomY(fx))
  }
  outline.closePath()

  ctx.save()
  ctx.clip(outline)
  const top = y - h * 1.1
  const bottom = y + sag + 2
  ctx.fillStyle = ICE_MID
  ctx.fillRect(x - w, top, w * 2, bottom - top)
  ctx.fillStyle = ICE_LIGHT
  ctx.fillRect(x - w, top, w * 0.62, bottom - top)
  ctx.fillStyle = ICE_DARK
  ctx.fillRect(x + w * 0.4, top, w * 0.6, bottom - top)
  // Frosty sheen towards the top.
  const sheen = ctx.createLinearGradient(0, top, 0, y)
  sheen.addColorStop(0, 'rgba(255,255,255,0.35)')
  sheen.addColorStop(0.45, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(x - w, top, w * 2, y - top)
  // Grooves: facet edges plus thin vertical cracks.
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(13,95,140,0.6)'
  ctx.beginPath()
  for (const fx of [-0.38, 0.4]) {
    ctx.moveTo(x + fx * w, top)
    ctx.lineTo(x + fx * w, bottomY(fx))
  }
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.beginPath()
  for (const [fx, from, to] of [[-0.7, 0.25, 0.75], [0.05, 0.1, 0.6], [0.15, 0.45, 0.85], [0.7, 0.2, 0.55]] as const) {
    if (variant === 2 && Math.abs(fx) > 0.5) continue
    ctx.moveTo(x + fx * w, bottomY(fx) - from * h)
    ctx.lineTo(x + fx * w, bottomY(fx) - to * h)
  }
  ctx.stroke()
  ctx.restore()

  // Bright rim along the jagged top, then the dark outline.
  ctx.lineJoin = 'round'
  ctx.strokeStyle = ICE_RIM
  ctx.lineWidth = 2
  ctx.beginPath()
  profile.forEach(([fx, fy], i) => {
    const px = x + fx * w
    const py = bottomY(fx) - fy * h + 1
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  ctx.stroke()
  ctx.strokeStyle = ICE_EDGE
  ctx.lineWidth = 1.3
  ctx.stroke(outline)
  ctx.restore()
}

export function drawFreezerPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawIcePillar(ctx, cx + r * 1.15, cy + r * 0.2, 0, r * 0.75, 1)
  drawIcePillar(ctx, cx - r * 1.55, cy + r * 0.55, 2, r * 0.75, 1)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.2, cy + r * 1.0, r * 0.85, 0, Math.PI * 2)
  ctx.fill()
  drawFrozenRing(ctx, cx - r * 0.2, cy + r * 1.0, r * 0.85, 0, 0.9)
  drawIcePillar(ctx, cx + r * 1.3, cy + r * 2.1, 1, r * 0.6, 1)
}

export const freezerDef: CharacterDef = {
  id: 'freezer',
  name: '冰川',
  nameEn: 'FREEZER',
  tagline: '寒气逼人',
  rules: [
    `持续散发寒气：不论距离，每 ${CHILL_TICK} 秒让敌人 -${CHILL_DAMAGE}`,
    `每 ${WAVE_INTERVAL} 秒在场上随机升起 ${PILLARS_PER_WAVE} 根冰柱，持续 ${PILLAR_ACTIVE} 秒`,
    `敌人碰到冰柱立刻 -${PILLAR_DAMAGE}，贴着冰柱每 ${PILLAR_TICK.toFixed(1)} 秒再 -${PILLAR_DAMAGE}`,
    `碰到冰柱时速度降到 ${Math.round(PILLAR_SLOW * 100)}%；冰柱不挡路，对自己无效`,
  ],
  palette: { ball: '#50c0f8', text: '#ffffff', accent: '#4db8f5' },
  mirrorPalette: { ball: '#0e6fa0', text: '#e0f2fe', accent: '#7dd3fc' },
  create: (w, b) => new FreezerAbility(w, b),
  drawPortrait: drawFreezerPortrait,
}
