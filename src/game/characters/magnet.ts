import { type Vec, angleDiff, clamp, fromAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const R = BALL_RADIUS
const FIRST_SPAWN = 1.5
export const SPAWN_INTERVAL = 1.6
/** Bars appear within this distance of the owner. */
const SPAWN_SPREAD = R * 3
export const MAX_BARS = 8
const BAR_LENGTH = R * 1.6
const BAR_WIDTH = R * 0.4
const GROW_TIME = 0.4
/** An unlinked bar seeks the nearest other unlinked bar within this range. */
export const PAIR_RANGE_R = 6
const PAIR_RANGE = R * PAIR_RANGE_R
const SEEK_SPEED = 140
/** Lonely bars creep towards the enemy ball. */
const DRIFT_SPEED = 90
const TURN_RATE = 5
/** Two bars whose centres come this close snap together. */
const LINK_DISTANCE = R * 1.4
/** Delay between snapping together and exploding (s). */
export const FUSE_TIME = 0.8
export const MAX_DAMAGE = 24
/** Damage lost per ball radius of distance from the blast centre. */
export const FALLOFF = 2.0
const BLAST_KNOCK = 200
const BLAST_SHAKE = 4
const SPAWN_FLASH = 0.35
const RING_TIME = 0.3

const RED = '#f84438'
const BLUE = '#1068f8'

interface Bar {
  pos: Vec
  angle: number
  age: number
  linked: boolean
}

interface Link {
  a: Bar
  b: Bar
  mid: Vec
  t: number
  seed: number
}

interface Blast {
  pos: Vec
  age: number
}

/** Bar-magnet damage at distance `d` (world units) from the blast centre. */
export function blastDamage(d: number): number {
  return Math.round(Math.max(0, MAX_DAMAGE - (FALLOFF * d) / R))
}

/**
 * 磁铁 MAGNET BALL — drops a red/blue bar magnet near itself every few
 * seconds. Bars attract each other: nearby pairs slide together and snap
 * pole to pole, crackle for a moment and then explode, hurting the enemy
 * more the closer it is to the blast. A bar with no partner in range creeps
 * towards the enemy.
 */
export class MagnetAbility extends Ability {
  private bars: Bar[] = []
  private links: Link[] = []
  private blasts: Blast[] = []
  private timer = FIRST_SPAWN
  /** Time since the last spawn, for the cast ring on the owner. */
  private sinceSpawn = Infinity

  override update(dt: number): void {
    this.sinceSpawn += dt
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += SPAWN_INTERVAL
        this.spawn()
      }
    }
    for (const b of this.bars) b.age += dt
    for (const b of this.blasts) b.age += dt
    this.blasts = this.blasts.filter((b) => b.age < RING_TIME)
    this.moveBars(dt)
    this.linkBars()
    this.tickLinks(dt)
  }

  private spawn(): void {
    if (this.bars.length >= MAX_BARS) {
      // Linked bars are about to blow anyway, so only an unlinked one is dropped.
      const oldest = this.bars.find((b) => !b.linked)
      if (oldest) {
        this.bars = this.bars.filter((b) => b !== oldest)
        this.world.effects.burst(oldest.pos, { count: 6, color: '#9ca3af', shape: 'smoke', speed: [10, 50], size: [4, 8], life: [0.3, 0.5], endScale: 1.6, front: false })
      }
    }
    const rng = this.world.rng
    const s = this.world.size
    const o = this.owner.pos
    const a = rng.range(0, Math.PI * 2)
    const d = Math.sqrt(rng.next()) * SPAWN_SPREAD
    const m = BAR_LENGTH / 2
    this.bars.push({
      pos: { x: clamp(o.x + Math.cos(a) * d, m, s - m), y: clamp(o.y + Math.sin(a) * d, m, s - m) },
      angle: rng.range(0, Math.PI * 2),
      age: 0,
      linked: false,
    })
    this.sinceSpawn = 0
    this.world.sound('place', 0.4, 1.3)
  }

  /** Free bars slide towards their nearest free neighbour, or drift towards the enemy. */
  private moveBars(dt: number): void {
    const free = this.bars.filter((b) => !b.linked)
    const e = this.enemy
    // Pick every target from the same snapshot so update order doesn't matter.
    const plans = free.map((b) => {
      let best: Bar | null = null
      let bestD = PAIR_RANGE
      for (const other of free) {
        if (other === b) continue
        const d = Math.hypot(other.pos.x - b.pos.x, other.pos.y - b.pos.y)
        if (d < bestD) {
          bestD = d
          best = other
        }
      }
      if (best) return { bar: b, to: { x: best.pos.x, y: best.pos.y }, speed: SEEK_SPEED, align: true }
      if (e.alive) return { bar: b, to: { x: e.pos.x, y: e.pos.y }, speed: DRIFT_SPEED, align: false }
      return null
    })
    const s = this.world.size
    const m = BAR_LENGTH / 2
    for (const p of plans) {
      if (!p) continue
      const b = p.bar
      const dx = p.to.x - b.pos.x
      const dy = p.to.y - b.pos.y
      const d = Math.hypot(dx, dy)
      if (d < 1e-6) continue
      const step = Math.min(d, p.speed * dt)
      b.pos.x = clamp(b.pos.x + (dx / d) * step, m, s - m)
      b.pos.y = clamp(b.pos.y + (dy / d) * step, m, s - m)
      if (p.align) {
        // Turn the bar's long axis onto the line to its partner (either polarity).
        const axis = Math.atan2(dy, dx)
        const d0 = angleDiff(b.angle, axis)
        const d1 = angleDiff(b.angle, axis + Math.PI)
        const turn = Math.abs(d0) <= Math.abs(d1) ? d0 : d1
        b.angle += clamp(turn, -TURN_RATE * dt, TURN_RATE * dt)
      }
    }
  }

  private linkBars(): void {
    for (const a of this.bars) {
      if (a.linked) continue
      let best: Bar | null = null
      let bestD = LINK_DISTANCE
      for (const b of this.bars) {
        if (b === a || b.linked) continue
        const d = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y)
        if (d <= bestD) {
          bestD = d
          best = b
        }
      }
      if (best) this.link(a, best)
    }
  }

  /** Snaps two bars end to end at their midpoint, red pole against blue pole. */
  private link(a: Bar, b: Bar): void {
    const mid = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 }
    const dx = b.pos.x - a.pos.x
    const dy = b.pos.y - a.pos.y
    const axis = Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : a.angle
    // Both bars share one heading; pick the polarity needing the least rotation.
    const cost = (t: number) => Math.abs(angleDiff(a.angle, t)) + Math.abs(angleDiff(b.angle, t))
    const heading = cost(axis) <= cost(axis + Math.PI) ? axis : axis + Math.PI
    const u = fromAngle(axis, BAR_LENGTH / 2)
    a.pos = { x: mid.x - u.x, y: mid.y - u.y }
    b.pos = { x: mid.x + u.x, y: mid.y + u.y }
    a.angle = heading
    b.angle = heading
    a.linked = true
    b.linked = true
    this.links.push({ a, b, mid, t: 0, seed: this.world.effects.random() * 1000 })
    this.world.effects.burst(mid, { count: 8, color: ['#ffffff', '#dbeafe'], shape: 'spark', speed: [80, 200], size: [1.2, 2.5], life: [0.12, 0.25], front: false })
    this.world.sound('zap', 0.35, 1.4)
  }

  private tickLinks(dt: number): void {
    const kept: Link[] = []
    for (const l of this.links) {
      l.t += dt
      if (l.t < FUSE_TIME) {
        kept.push(l)
        continue
      }
      this.bars = this.bars.filter((b) => b !== l.a && b !== l.b)
      this.explode(l.mid)
    }
    this.links = kept
  }

  private explode(at: Vec): void {
    const fx = this.world.effects
    fx.burst(at, { count: 22, color: ['#ffffff', '#ffffff', BLUE, RED, '#93c5fd'], shape: 'spark', speed: [140, 340], size: [1.5, 3.5], life: [0.2, 0.45], drag: 4.5 })
    fx.burst(at, { count: 10, color: ['#9ca3af', '#6b7280', '#d1d5db'], shape: 'smoke', speed: [20, 90], size: [8, 14], life: [0.5, 0.9], endScale: 2 })
    this.blasts.push({ pos: { x: at.x, y: at.y }, age: 0 })
    this.world.sound('explosion', 0.65, 1.15)

    const e = this.enemy
    if (!e.alive) return
    const dx = e.pos.x - at.x
    const dy = e.pos.y - at.y
    const d = Math.hypot(dx, dy)
    const dmg = blastDamage(d)
    if (dmg < 1) return
    const dir = d > 1e-6 ? { x: dx / d, y: dy / d } : fromAngle(this.world.rng.range(0, Math.PI * 2))
    // Particles land on the side of the enemy facing the blast.
    const hit = d > e.radius ? { x: e.pos.x - dir.x * e.radius, y: e.pos.y - dir.y * e.radius } : { x: e.pos.x, y: e.pos.y }
    this.world.damage(e, dmg, {
      kind: 'magnet',
      source: this.owner,
      at: hit,
      knock: { x: dir.x * BLAST_KNOCK, y: dir.y * BLAST_KNOCK },
      shake: BLAST_SHAKE,
    })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const time = this.world.time
    ctx.save()
    ctx.globalAlpha = fade
    for (const b of this.bars) {
      const g = clamp(b.age / GROW_TIME, 0, 1)
      // Slight overshoot as the bar pops in.
      const scale = g < 1 ? Math.sin(g * Math.PI * 0.5) * (1 + 0.15 * Math.sin(g * Math.PI)) : 1
      drawBarMagnet(ctx, b.pos.x, b.pos.y, b.angle, BAR_LENGTH * scale, BAR_WIDTH * scale)
    }
    for (const l of this.links) {
      const u = l.t / FUSE_TIME
      // Bars glow hotter as the fuse runs down.
      const pulse = u * (0.5 + 0.5 * Math.sin(l.t * (18 + 30 * u)))
      if (pulse > 0.02) {
        ctx.save()
        ctx.globalAlpha = fade * pulse * 0.6
        drawBarMagnet(ctx, l.a.pos.x, l.a.pos.y, l.a.angle, BAR_LENGTH, BAR_WIDTH, '#ffffff')
        drawBarMagnet(ctx, l.b.pos.x, l.b.pos.y, l.b.angle, BAR_LENGTH, BAR_WIDTH, '#ffffff')
        ctx.restore()
      }
      const flick = l.seed + Math.floor(time * 20) * 13
      drawCrackle(ctx, l.a.pos, l.b.pos, flick)
      drawCrackle(ctx, l.a.pos, l.b.pos, flick + 7)
    }
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    if (this.sinceSpawn >= SPAWN_FLASH) return
    const o = this.owner
    const u = this.sinceSpawn / SPAWN_FLASH
    ctx.save()
    ctx.globalAlpha *= 1 - u
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    const a0 = this.world.time * 7
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, o.radius * (1.1 + 0.15 * u), a0, a0 + Math.PI * 1.3)
    ctx.stroke()
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    for (const b of this.blasts) {
      const u = b.age / RING_TIME
      ctx.save()
      ctx.globalAlpha = fade * (1 - u)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3.5 * (1 - u) + 0.5
      ctx.beginPath()
      ctx.arc(b.pos.x, b.pos.y, R * (0.5 + 1.8 * Math.sqrt(u)), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** Thin flickering white arc between two points. */
function drawCrackle(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, seed: number): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const nx = -dy / length
  const ny = dx / length
  const segs = 6
  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.shadowColor = '#93c5fd'
  ctx.shadowBlur = 6
  ctx.lineWidth = 1.2
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  for (let i = 1; i < segs; i++) {
    const u = i / segs
    const off = (hash(seed + i) - 0.5) * BAR_WIDTH * 1.8
    ctx.lineTo(from.x + dx * u + nx * off, from.y + dy * u + ny * off)
  }
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.restore()
}

/**
 * A bar magnet with slightly pointed ends: red pole along +angle, blue pole
 * behind. Passing `tint` fills the whole shape in one colour (for flashes).
 */
export function drawBarMagnet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  tint?: string,
): void {
  if (length <= 0.5) return
  const h = length / 2
  const w = width / 2
  const p = width * 0.35
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  const half = (dir: 1 | -1) => {
    ctx.beginPath()
    ctx.moveTo(0, -w)
    ctx.lineTo(dir * (h - p), -w)
    ctx.lineTo(dir * h, 0)
    ctx.lineTo(dir * (h - p), w)
    ctx.lineTo(0, w)
    ctx.closePath()
  }
  ctx.fillStyle = tint ?? RED
  half(1)
  ctx.fill()
  ctx.fillStyle = tint ?? BLUE
  half(-1)
  ctx.fill()
  if (!tint) {
    // Outline, pole seam and a soft highlight.
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-h, 0)
    ctx.lineTo(-(h - p), -w)
    ctx.lineTo(h - p, -w)
    ctx.lineTo(h, 0)
    ctx.lineTo(h - p, w)
    ctx.lineTo(-(h - p), w)
    ctx.closePath()
    ctx.moveTo(0, -w)
    ctx.lineTo(0, w)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = Math.max(1, width * 0.12)
    ctx.beginPath()
    ctx.moveTo(-(h - p), -w * 0.45)
    ctx.lineTo(h - p, -w * 0.45)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawMagnetPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const len = r * 1.6
  const wid = r * 0.4
  // A linked pair crackling at the top right.
  const ang = -0.5
  const ux = Math.cos(ang) * len * 0.5
  const uy = Math.sin(ang) * len * 0.5
  const mx = cx + r * 1.1
  const my = cy - r * 1.4
  drawBarMagnet(ctx, mx - ux, my - uy, ang, len, wid)
  drawBarMagnet(ctx, mx + ux, my + uy, ang, len, wid)
  drawCrackle(ctx, { x: mx - ux, y: my - uy }, { x: mx + ux, y: my + uy }, 4)
  // A lone bar at the lower left.
  drawBarMagnet(ctx, cx - r * 1.55, cy + r * 1.35, 0.9, len, wid)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.2, cy + r * 0.25, r * 0.95, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx - r * 0.2, cy + r * 0.25, r * 1.15, 2.2, 2.2 + Math.PI * 1.3)
  ctx.stroke()
}

export const magnetDef: CharacterDef = {
  id: 'magnet',
  name: '磁铁',
  nameEn: 'MAGNET BALL',
  tagline: '异极相吸，一碰就炸',
  rules: [
    `每 ${SPAWN_INTERVAL} 秒在身边放下一根条形磁铁（场上最多 ${MAX_BARS} 根）`,
    `磁铁会互相吸引，${PAIR_RANGE_R} 个身位内的两根会滑到一起；落单的磁铁慢慢飘向敌人`,
    `两根磁铁吸在一起 ${FUSE_TIME} 秒后爆炸`,
    `爆炸中心最高 -${MAX_DAMAGE}，离得越远伤害越低（每个身位少 ${FALLOFF}）`,
  ],
  palette: { ball: '#8043c8', text: '#ffffff', accent: '#7c4ddb' },
  mirrorPalette: { ball: '#4c1d95', text: '#ede9fe', accent: '#a78bfa' },
  create: (w, b) => new MagnetAbility(w, b),
  drawPortrait: drawMagnetPortrait,
}
