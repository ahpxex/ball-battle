import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import { predictPosition } from '../engine/predict'
import type { CharacterDef } from './types'

const FIRST_CAST = 2.0
export const CAST_INTERVAL = 5
/** Each cooldown is CAST_INTERVAL ± this much. */
export const CAST_JITTER = 1
/** Delay between the cast ring and the first rock leaving the sky. */
export const LAUNCH_DELAY = 1.0
export const METEORS_PER_VOLLEY = 3
const LAUNCH_STAGGER = 0.15
export const METEOR_SPEED = 420
/** Each rock aims where the enemy is heading, offset by up to this much. */
const AIM_SPREAD = BALL_RADIUS
const MIN_ROCK_RADIUS = BALL_RADIUS * 0.4
const MAX_ROCK_RADIUS = BALL_RADIUS * 0.9
/** Rocks spawn this far outside the arena edge. */
const SPAWN_OFFSET = BALL_RADIUS * 1.5
/** Spread of the individual spawn points along the chosen edge. */
const SPAWN_JITTER = BALL_RADIUS * 0.6
/** Blast radius around the impact point (the enemy's radius is added on top). */
export const BLAST_RADIUS = BALL_RADIUS * 1.5
export const MIN_DAMAGE = 3
export const MAX_DAMAGE = 11
const DAMAGE_JITTER = 1.5
const KNOCK = 140
const CAST_RING_TIME = 0.5
const IMPACT_RING_TIME = 0.35

interface Rock {
  pos: Vec
  target: Vec
  /** Unit heading. */
  dir: Vec
  remaining: number
  radius: number
  /** 0 for the smallest rock, 1 for the biggest. */
  sizeT: number
  /** Cosmetic seed for the rock's shape and trail. */
  seed: number
}

interface Volley {
  origin: Vec
  age: number
  launched: number
}

interface Impact {
  pos: Vec
  age: number
}

/**
 * 星陨 (Meteor Ball) — every few seconds flashes a ring and calls down a
 * volley of five meteors from beyond the arena edge. Each rock flies
 * straight at where the enemy is heading and explodes on arrival;
 * bigger rocks hit harder.
 */
export class MeteorAbility extends Ability {
  private timer = FIRST_CAST
  private castTime = -Infinity
  private volley: Volley | null = null
  private rocks: Rock[] = []
  private impacts: Impact[] = []
  private rockCount = 0

  override update(dt: number): void {
    for (const im of this.impacts) im.age += dt
    this.impacts = this.impacts.filter((im) => im.age < IMPACT_RING_TIME)
    this.updateRocks(dt)
    if (!this.world.combatActive) return
    this.updateVolley(dt)
    if (this.owner.disarmed) return
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer += CAST_INTERVAL + this.world.rng.range(-CAST_JITTER, CAST_JITTER)
      this.cast()
    }
  }

  private cast(): void {
    const rng = this.world.rng
    const s = this.world.size
    const edge = rng.int(0, 3)
    const along = rng.range(0.1, 0.9) * s
    const origin =
      edge === 0
        ? { x: along, y: -SPAWN_OFFSET }
        : edge === 1
          ? { x: s + SPAWN_OFFSET, y: along }
          : edge === 2
            ? { x: along, y: s + SPAWN_OFFSET }
            : { x: -SPAWN_OFFSET, y: along }
    this.volley = { origin, age: 0, launched: 0 }
    this.castTime = this.world.time
    this.world.sound('whoosh', 0.5, 0.6)
  }

  private updateVolley(dt: number): void {
    const v = this.volley
    if (!v) return
    v.age += dt
    while (v.launched < METEORS_PER_VOLLEY && v.age >= LAUNCH_DELAY + v.launched * LAUNCH_STAGGER) {
      this.launch(v.origin)
      v.launched += 1
    }
    if (v.launched >= METEORS_PER_VOLLEY) this.volley = null
  }

  private launch(origin: Vec): void {
    const rng = this.world.rng
    const s = this.world.size
    // Jitter the spawn point along the edge it sits outside of.
    const onVerticalEdge = origin.x < 0 || origin.x > s
    const j = rng.range(-SPAWN_JITTER, SPAWN_JITTER)
    const from = onVerticalEdge ? { x: origin.x, y: origin.y + j } : { x: origin.x + j, y: origin.y }
    // Lead the target: aim where the enemy will be when the rock arrives
    // (two refinement passes on the flight time are plenty).
    let e = this.enemy.pos
    for (let i = 0; i < 2; i++) {
      const t = Math.hypot(e.x - from.x, e.y - from.y) / METEOR_SPEED
      e = predictPosition(this.enemy, t, s)
    }
    const a = rng.range(0, Math.PI * 2)
    const off = Math.sqrt(rng.next()) * AIM_SPREAD
    const target = { x: e.x + Math.cos(a) * off, y: e.y + Math.sin(a) * off }
    const dx = target.x - from.x
    const dy = target.y - from.y
    const d = Math.hypot(dx, dy) || 1
    const sizeT = rng.next()
    this.rocks.push({
      pos: from,
      target,
      dir: { x: dx / d, y: dy / d },
      remaining: d,
      radius: MIN_ROCK_RADIUS + (MAX_ROCK_RADIUS - MIN_ROCK_RADIUS) * sizeT,
      sizeT,
      seed: (this.rockCount += 1) * 7.31 + this.owner.team * 101,
    })
    this.world.sound('whoosh', 0.3 + 0.2 * sizeT, 0.9 - 0.3 * sizeT)
  }

  private updateRocks(dt: number): void {
    const step = METEOR_SPEED * dt
    const kept: Rock[] = []
    for (const r of this.rocks) {
      if (step >= r.remaining) {
        r.pos = { x: r.target.x, y: r.target.y }
        this.explode(r)
        continue
      }
      r.remaining -= step
      r.pos.x += r.dir.x * step
      r.pos.y += r.dir.y * step
      kept.push(r)
    }
    this.rocks = kept
  }

  private explode(r: Rock): void {
    const at = r.pos
    const fx = this.world.effects
    this.impacts.push({ pos: { x: at.x, y: at.y }, age: 0 })
    fx.burst(at, { count: 8, color: ['#6b4535', '#4a291b', '#a8a29e'], shape: 'smoke', speed: [30, 140], size: [5, 10], life: [0.4, 0.8], endScale: 2 })
    this.world.addShake(1.5 + 1.5 * r.sizeT)

    const e = this.enemy
    let dealt = 0
    if (e.alive) {
      const dx = e.pos.x - at.x
      const dy = e.pos.y - at.y
      const d = Math.hypot(dx, dy)
      if (d < BLAST_RADIUS + e.radius) {
        const raw = Math.round(MIN_DAMAGE + (MAX_DAMAGE - MIN_DAMAGE) * r.sizeT + this.world.rng.range(-DAMAGE_JITTER, DAMAGE_JITTER))
        const dmg = clamp(raw, MIN_DAMAGE, MAX_DAMAGE)
        const nx = d > 1e-3 ? dx / d : r.dir.x
        const ny = d > 1e-3 ? dy / d : r.dir.y
        dealt = this.world.damage(e, dmg, { kind: 'meteor', source: this.owner, at: { x: at.x, y: at.y }, knock: { x: nx * KNOCK, y: ny * KNOCK } })
      }
    }
    // On a hit the 'meteor' hit effect provides the burst and sound.
    if (dealt === 0) {
      fx.burst(at, { count: 22, color: ['#ffffff', '#fde047', '#fb923c'], speed: [80, 300], size: [2, 5], life: [0.3, 0.7] })
      this.world.sound('explosion', 0.45, 1.15)
    }
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const t = (this.world.time - this.castTime) / CAST_RING_TIME
    if (t < 0 || t >= 1) return
    const o = this.owner
    ctx.save()
    ctx.strokeStyle = `rgba(255,140,50,${0.9 * (1 - t)})`
    ctx.lineWidth = 3 * (1 - t) + 1
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, o.radius * (1.1 + 1.2 * t), 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const time = this.world.time
    ctx.save()
    ctx.globalAlpha = fade
    for (const im of this.impacts) {
      const t = im.age / IMPACT_RING_TIME
      ctx.strokeStyle = `rgba(255,214,150,${0.8 * (1 - t)})`
      ctx.lineWidth = 3.5 * (1 - t) + 0.5
      ctx.beginPath()
      ctx.arc(im.pos.x, im.pos.y, BLAST_RADIUS * (0.3 + 0.7 * t), 0, Math.PI * 2)
      ctx.stroke()
    }
    for (const r of this.rocks) {
      const trail = BALL_RADIUS * (2 + 2 * r.sizeT)
      drawMeteor(ctx, r.pos.x, r.pos.y, r.radius, Math.atan2(r.dir.y, r.dir.x), r.seed, time, trail)
    }
    ctx.restore()
  }
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

const TRAIL_DOTS = 16

/**
 * A burning rock heading along `angle`, with a glowing leading edge and a
 * streaming trail of sparks behind it.
 */
export function drawMeteor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rr: number,
  angle: number,
  seed: number,
  time: number,
  trail: number,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)

  // Soft tapered glow streak behind the rock.
  ctx.globalCompositeOperation = 'lighter'
  const streak = ctx.createLinearGradient(0, 0, -trail, 0)
  streak.addColorStop(0, 'rgba(255,190,110,0.55)')
  streak.addColorStop(0.4, 'rgba(255,124,25,0.25)')
  streak.addColorStop(1, 'rgba(255,90,20,0)')
  ctx.fillStyle = streak
  ctx.beginPath()
  ctx.moveTo(rr * 0.2, -rr * 0.85)
  ctx.quadraticCurveTo(-trail * 0.4, -rr * 0.55, -trail, 0)
  ctx.quadraticCurveTo(-trail * 0.4, rr * 0.55, rr * 0.2, rr * 0.85)
  ctx.closePath()
  ctx.fill()

  // Spark dots streaming backwards.
  for (let i = 0; i < TRAIL_DOTS; i++) {
    const h1 = hash(seed + i * 3.1)
    const h2 = hash(seed + i * 5.7 + 1.3)
    const u = (i / TRAIL_DOTS + time * (1.6 + h1 * 0.8) + h2) % 1
    const px = -rr * 0.5 - u * trail
    const py = (h2 - 0.5) * rr * 1.5 * (0.35 + u)
    const size = Math.max(0.8, rr * 0.26 * (1 - u))
    ctx.globalAlpha = (1 - u) * 0.95
    ctx.fillStyle = u < 0.22 ? '#ffffff' : u < 0.5 ? (h1 < 0.5 ? '#fff1b8' : '#fde047') : h1 < 0.5 ? '#fb923c' : '#ff7c19'
    ctx.beginPath()
    ctx.arc(px, py, size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Hot halo around the leading side.
  const halo = ctx.createRadialGradient(rr * 0.35, 0, rr * 0.2, rr * 0.2, 0, rr * 1.7)
  halo.addColorStop(0, 'rgba(255,220,160,0.55)')
  halo.addColorStop(1, 'rgba(255,124,25,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(rr * 0.2, 0, rr * 1.7, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'

  // Irregular rock body, slowly tumbling.
  const spin = time * (1 + hash(seed + 9.9) * 2) * (hash(seed + 4.4) < 0.5 ? -1 : 1) + seed
  const n = 9
  const body = () => {
    ctx.beginPath()
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + spin
      const rad = rr * (0.82 + 0.18 * hash(seed + k * 1.7))
      const vx = Math.cos(a) * rad
      const vy = Math.sin(a) * rad
      if (k === 0) ctx.moveTo(vx, vy)
      else ctx.lineTo(vx, vy)
    }
    ctx.closePath()
  }
  const fill = ctx.createLinearGradient(rr, 0, -rr, 0)
  fill.addColorStop(0, '#6b4535')
  fill.addColorStop(1, '#4a291b')
  ctx.fillStyle = fill
  body()
  ctx.fill()

  // Craters tumble with the rock.
  ctx.save()
  body()
  ctx.clip()
  ctx.fillStyle = 'rgba(38,20,12,0.7)'
  for (let k = 0; k < 3; k++) {
    const a = spin + k * 2.1 + hash(seed + k * 2.3)
    const d = rr * (0.25 + 0.35 * hash(seed + k * 6.1))
    const cr = rr * (0.16 + 0.12 * hash(seed + k * 8.7))
    ctx.beginPath()
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d, cr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // White-hot leading edge, fading towards the sides.
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, -rr * 2, rr * 2, rr * 4)
  ctx.clip()
  const edge = ctx.createLinearGradient(0, 0, rr, 0)
  edge.addColorStop(0, 'rgba(255,140,40,0)')
  edge.addColorStop(0.45, '#ff9a3c')
  edge.addColorStop(1, '#fff6d8')
  ctx.strokeStyle = edge
  ctx.lineJoin = 'round'
  ctx.shadowColor = '#ff9a3c'
  ctx.shadowBlur = rr * 0.8
  ctx.lineWidth = Math.max(1.5, rr * 0.3)
  body()
  ctx.stroke()
  ctx.restore()

  ctx.restore()
}

export function drawMeteorPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const heading = Math.PI * 0.75
  drawMeteor(ctx, cx + r * 1.55, cy - r * 1.35, r * 0.42, heading, 3.3, 0.15, r * 1.0)
  drawMeteor(ctx, cx - r * 0.2, cy - r * 1.75, r * 0.3, heading, 8.1, 0.55, r * 0.75)
  drawMeteor(ctx, cx + r * 1.85, cy + r * 0.2, r * 0.32, heading, 5.6, 0.35, r * 0.6)
  ctx.save()
  ctx.strokeStyle = 'rgba(255,140,50,0.6)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx - r * 0.45, cy + r * 0.55, r * 1.2, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.45, cy + r * 0.55, r * 0.95, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export const meteorDef: CharacterDef = {
  id: 'meteor',
  name: '星陨',
  nameEn: 'METEOR BALL',
  tagline: '天降流星雨',
  rules: [
    `每 ${CAST_INTERVAL}±${CAST_JITTER} 秒召唤一次流星雨，${LAUNCH_DELAY} 秒后从场外连续飞来 ${METEORS_PER_VOLLEY} 颗陨石`,
    '每颗陨石瞄准敌人发射那一刻的位置，直线飞行后落地爆炸',
    `爆炸波及敌人 -${MIN_DAMAGE}~${MAX_DAMAGE}，陨石越大伤害越高`,
    `爆炸半径约 ${(BLAST_RADIUS / BALL_RADIUS).toFixed(1)} 个球半径，会把敌人震开`,
  ],
  palette: { ball: '#ff7c19', text: '#ffffff', accent: '#e87830' },
  mirrorPalette: { ball: '#9a3412', text: '#ffedd5', accent: '#fb923c' },
  create: (w, b) => new MeteorAbility(w, b),
  drawPortrait: drawMeteorPortrait,
}
