import { type Vec, clamp, damp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import { predictPosition } from '../engine/predict'
import type { DamageOptions } from '../engine/types'
import type { CharacterDef } from './types'

/** Time between throws, also the delay before the first one (s). */
export const THROW_INTERVAL = 2.5
const PELLET_FLIGHT = 0.45
/** Max random offset added to the predicted landing point. */
const AIM_SCATTER = BALL_RADIUS * 1.5
export const ZONE_RADIUS = BALL_RADIUS * 2.5
/** Live time of a zone after landing (s). */
export const ZONE_DURATION = 2.2
/** Cosmetic fade after the zone stops working (s). */
const ZONE_FADE = 0.3
const ZONE_POP = 0.25
export const MAX_ZONES = 2
export const SLOW_FACTOR = 0.2
/** Status durations re-applied every step while sunk. */
const STATUS_REFRESH = 0.1
export const SAND_DAMAGE = 2
export const SAND_TICK = 0.3
const SINK_SCALE = 0.55
const SINK_RATE = 3
const RISE_RATE = 6
const PELLET_SIZE = BALL_RADIUS * 0.5
const PELLET_ARC = BALL_RADIUS * 0.8
const SMALL = 1e-6

/** Speck cloud layout (cosmetic). */
const CORE_RADIUS = BALL_RADIUS * 2.3
const OUTER_RADIUS = BALL_RADIUS * 2.8
const CORE_SPECKS = 150
const STRAY_SPECKS = 34
const SAND_LIGHT: RGB = [0xf0, 0xd0, 0x30]
const SAND_DARK: RGB = [0xd9, 0xc2, 0x1e]
const SAND_OLIVE: RGB = [0xa3, 0x9a, 0x1a]
const SAND_BROWN: RGB = [0x5a, 0x3c, 0x14]
const RIM_SPECKS: readonly [number, number][] = [
  [0.4, 2.2],
  [1.5, 1.6],
  [2.7, 2.4],
  [3.6, 1.7],
  [4.9, 2.1],
  [5.7, 1.5],
]

type RGB = [number, number, number]

interface Speck {
  x: number
  y: number
  size: number
  color: RGB
}

interface Pellet {
  from: Vec
  to: Vec
  t: number
}

interface Zone {
  pos: Vec
  age: number
  specks: Speck[]
}

/**
 * 流沙 (QUICKSAND BALL) — every few seconds lobs a clump of sand ahead of
 * where the enemy is going. It bursts into a quicksand pit: a ball caught in
 * it sinks, crawls at a fraction of its speed, can't attack and keeps losing
 * HP until it drags itself out.
 */
export class QuicksandAbility extends Ability {
  private pellets: Pellet[] = []
  private zones: Zone[] = []
  private timer = THROW_INTERVAL
  private sandCd = 0

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += THROW_INTERVAL
        this.throwPellet()
      }
    }
    for (const p of this.pellets) p.t += dt
    for (const p of this.pellets) if (p.t >= PELLET_FLIGHT) this.land(p.to)
    this.pellets = this.pellets.filter((p) => p.t < PELLET_FLIGHT)
    for (const z of this.zones) z.age += dt
    this.zones = this.zones.filter((z) => z.age < ZONE_DURATION + ZONE_FADE)
    this.sink(dt)
  }

  private throwPellet(): void {
    const rng = this.world.rng
    const s = this.world.size
    const aim = predictPosition(this.enemy, PELLET_FLIGHT, s)
    const a = rng.range(0, Math.PI * 2)
    const off = rng.range(0, AIM_SCATTER)
    const m = BALL_RADIUS
    const to = {
      x: clamp(aim.x + Math.cos(a) * off, m, s - m),
      y: clamp(aim.y + Math.sin(a) * off, m, s - m),
    }
    this.pellets.push({ from: { x: this.owner.pos.x, y: this.owner.pos.y }, to, t: 0 })
    this.world.sound('throw', 0.6, 0.8)
  }

  private land(at: Vec): void {
    if (this.zones.length >= MAX_ZONES) this.zones.shift()
    this.zones.push({ pos: { x: at.x, y: at.y }, age: 0, specks: makeSpecks(() => this.world.effects.random()) })
    this.world.sound('place', 0.7, 0.6)
    this.world.effects.burst(at, {
      count: 14,
      color: ['#d9c21e', '#f0d030', '#a39a1a'],
      speed: [60, 200],
      size: [1.5, 3.5],
      life: [0.25, 0.5],
      front: false,
    })
  }

  /** Applies the pit to the enemy and drives its sinking animation. */
  private sink(dt: number): void {
    const e = this.enemy
    this.sandCd -= dt
    let sunk = false
    if (e.alive && this.world.combatActive) {
      for (const z of this.zones) {
        if (z.age >= ZONE_DURATION) continue
        if ((e.pos.x - z.pos.x) ** 2 + (e.pos.y - z.pos.y) ** 2 <= ZONE_RADIUS * ZONE_RADIUS) {
          sunk = true
          break
        }
      }
    }
    if (sunk) {
      e.applySlow(SLOW_FACTOR, STATUS_REFRESH)
      e.applyDisarm(STATUS_REFRESH)
      if (this.sandCd <= SMALL) {
        this.sandCd = (this.sandCd > -dt ? this.sandCd : 0) + SAND_TICK
        this.world.damage(e, SAND_DAMAGE, { kind: 'sand', source: this.owner, at: e.pos })
      }
      e.drawScale += (SINK_SCALE - e.drawScale) * damp(SINK_RATE, dt)
    } else if (e.drawScale !== 1) {
      e.drawScale += (1 - e.drawScale) * damp(RISE_RATE, dt)
      if (Math.abs(1 - e.drawScale) < 0.005) e.drawScale = 1
    }
  }

  override onOwnerDamaged(_amount: number, _opts: DamageOptions): void {
    // Our update stops once we die, so release the enemy's sinking pose now.
    if (this.owner.hp <= 0) this.enemy.drawScale = 1
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.zones.length === 0) return
    ctx.save()
    for (const z of this.zones) drawZone(ctx, z, fade)
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawRimSpecks(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    if (this.presence <= 0 || this.pellets.length === 0) return
    ctx.save()
    for (const p of this.pellets) {
      const u = p.t / PELLET_FLIGHT
      const x = p.from.x + (p.to.x - p.from.x) * u
      const y = p.from.y + (p.to.y - p.from.y) * u - Math.sin(u * Math.PI) * PELLET_ARC
      drawPellet(ctx, x, y, PELLET_SIZE * (1 + 0.15 * Math.sin(u * Math.PI)), u * 6)
    }
    ctx.restore()
  }
}

function makeSpecks(random: () => number): Speck[] {
  const specks: Speck[] = []
  const add = (radius: number, size: number, color: RGB) => {
    const a = random() * Math.PI * 2
    specks.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, size, color })
  }
  for (let i = 0; i < CORE_SPECKS; i++) {
    const rr = CORE_RADIUS * Math.sqrt(random())
    const edge = rr / CORE_RADIUS
    const u = random()
    // Bigger, brighter grains in the middle; olive grit towards the rim.
    const color = edge > 0.8 && u < 0.6 ? SAND_OLIVE : mix(SAND_DARK, SAND_LIGHT, random())
    add(rr, 1 + 7 * random() ** 2 * (1 - 0.5 * edge), color)
  }
  for (let i = 0; i < STRAY_SPECKS; i++) {
    const rr = CORE_RADIUS + (OUTER_RADIUS - CORE_RADIUS) * random()
    add(rr, 1 + 2 * random(), random() < 0.7 ? SAND_OLIVE : SAND_DARK)
  }
  // Draw small grains over big ones so the cloud reads as texture.
  specks.sort((a, b) => b.size - a.size)
  return specks
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function rgb(c: RGB): string {
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`
}

function drawZone(ctx: CanvasRenderingContext2D, z: Zone, presence: number): void {
  const pop = Math.min(1, z.age / ZONE_POP)
  // Ease-out with a small overshoot as the pit bursts open.
  const scale = 1 - (1 - pop) ** 3 + Math.sin(pop * Math.PI) * 0.06
  const dying = clamp((z.age - ZONE_DURATION) / ZONE_FADE, 0, 1)
  const alpha = presence * (1 - dying)
  if (alpha <= 0 || scale <= 0) return
  const { x, y } = z.pos

  ctx.globalAlpha = alpha
  const glow = ctx.createRadialGradient(x, y, 0, x, y, CORE_RADIUS * scale)
  glow.addColorStop(0, `rgba(217,194,30,${0.38 * (1 - dying)})`)
  glow.addColorStop(0.8, `rgba(163,154,26,${0.22 * (1 - dying)})`)
  glow.addColorStop(1, 'rgba(163,154,26,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, CORE_RADIUS * scale, 0, Math.PI * 2)
  ctx.fill()

  for (const s of z.specks) {
    ctx.fillStyle = dying > 0 ? rgb(mix(s.color, SAND_BROWN, dying)) : rgb(s.color)
    ctx.beginPath()
    ctx.arc(x + s.x * scale, y + s.y * scale, s.size * 0.5 * Math.max(0.3, scale), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawPellet(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, spin: number): void {
  const r = size * 0.5
  ctx.fillStyle = '#d9c21e'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#f0d030'
  for (let i = 0; i < 4; i++) {
    const a = spin + (i * Math.PI) / 2
    ctx.beginPath()
    ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#a39a1a'
  ctx.beginPath()
  ctx.arc(x + Math.cos(spin + 0.8) * r * 0.3, y + Math.sin(spin + 0.8) * r * 0.3, r * 0.22, 0, Math.PI * 2)
  ctx.fill()
}

function drawRimSpecks(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save()
  ctx.fillStyle = '#e8891a'
  for (const [a, size] of RIM_SPECKS) {
    const rr = r - size - 1.5
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, size * (r / BALL_RADIUS), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawQuicksandPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // A small pit at the lower right with a clump arcing towards it.
  const k = r / BALL_RADIUS
  let seed = 7
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const zone: Zone = { pos: { x: cx + r * 1.15, y: cy + r * 1.2 }, age: ZONE_POP, specks: makeSpecks(random) }
  ctx.save()
  ctx.translate(zone.pos.x, zone.pos.y)
  ctx.scale(k * 0.45, k * 0.45)
  ctx.translate(-zone.pos.x, -zone.pos.y)
  drawZone(ctx, zone, 1)
  ctx.restore()
  drawPellet(ctx, cx + r * 0.9, cy - r * 1.55, r * 0.5, 0.6)
  const bx = cx - r * 0.55
  const by = cy - r * 0.2
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bx, by, r * 0.95, 0, Math.PI * 2)
  ctx.fill()
  drawRimSpecks(ctx, bx, by, r * 0.95)
}

export const quicksandDef: CharacterDef = {
  id: 'quicksand',
  name: '流沙',
  nameEn: 'QUICKSAND BALL',
  tagline: '越挣扎陷得越深',
  rules: [
    `每 ${THROW_INTERVAL} 秒往敌人前进的方向扔一团沙，落地变成流沙坑`,
    `流沙坑持续 ${ZONE_DURATION} 秒，场上最多 ${MAX_ZONES} 个`,
    `陷进流沙的敌人速度降到 ${Math.round(SLOW_FACTOR * 100)}%，而且无法攻击`,
    `在流沙里每 ${SAND_TICK} 秒 -${SAND_DAMAGE}，自己不受影响`,
  ],
  palette: { ball: '#ffca20', text: '#ffffff', accent: '#f0c020' },
  mirrorPalette: { ball: '#a16207', text: '#fef9c3', accent: '#d97706' },
  create: (w, b) => new QuicksandAbility(w, b),
  drawPortrait: drawQuicksandPortrait,
}
