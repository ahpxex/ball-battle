import { type Vec, len } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

/** How long the icy trail stays active (s). */
export const TRAIL_LIFETIME = 3.4
/** Shards darken and fade during their last this-many seconds. */
const FADE_TIME = 0.7
export const FROST_DAMAGE = 2
export const FROST_TICK = 0.5
/** Freeze/disarm duration refreshed every step the enemy spends on the ice. */
const FREEZE_REFRESH = 0.15
/** A trail sample is recorded every this many units of travel. */
const SAMPLE_SPACING = 8
/** Half-width of the effective band around the path (beyond the enemy radius). */
const BAND_HALF_WIDTH = BALL_RADIUS * 1.0
/** Cosmetic shards: emission and look. */
const SHARD_INTERVAL = 0.05
const SHARDS_PER_DROP = 3
const SHARD_SPREAD = BALL_RADIUS * 1.1
const SHARD_MIN = BALL_RADIUS * 0.3
const SHARD_MAX = BALL_RADIUS * 0.6
const SHARD_GROW = 0.12
const SHARD_COLORS = ['#e6f7ff', '#9fdcf5', '#5bb5e0'] as const
const SHARD_EDGE = '#2f7fb5'

interface TrailSample {
  x: number
  y: number
  born: number
}

interface Shard {
  x: number
  y: number
  born: number
  color: number
  /** Triangle vertices relative to (x, y), already scaled and rotated. */
  pts: [number, number, number, number, number, number]
}

/** One jagged crack, in units of the target's radius. */
type Crack = Vec[]

/**
 * 冰霜 FROST BALL — drags a carpet of ice shards behind it. Any enemy on
 * the fresh ice freezes up: it grinds to a halt, can't attack, and takes
 * steady frost damage until it gets off the trail. The ice melts after a
 * few seconds and never affects Frost itself.
 */
export class FrostAbility extends Ability {
  private samples: TrailSample[] = []
  private shards: Shard[] = []
  private shardTimer = 0
  /** Time the enemy has spent on the ice since entering (drives the damage ticks). */
  private iceTime = 0
  /** 0..1 strength of the frozen overlay on the enemy. */
  private frozenLook = 0
  private readonly cracks: Crack[]

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.cracks = makeCracks(() => world.effects.random())
  }

  override update(dt: number): void {
    const now = this.world.time
    while (this.samples.length > 0 && now - this.samples[0].born > TRAIL_LIFETIME) this.samples.shift()
    while (this.shards.length > 0 && now - this.shards[0].born > TRAIL_LIFETIME) this.shards.shift()

    if (this.world.combatActive && !this.owner.disarmed) this.layTrail(dt)
    this.chill(dt)
  }

  private layTrail(dt: number): void {
    const o = this.owner
    const now = this.world.time
    const last = this.samples[this.samples.length - 1]
    if (!last || (o.pos.x - last.x) ** 2 + (o.pos.y - last.y) ** 2 >= SAMPLE_SPACING * SAMPLE_SPACING) {
      this.samples.push({ x: o.pos.x, y: o.pos.y, born: now })
    }
    if (this.world.headless) return
    this.shardTimer -= dt
    while (this.shardTimer <= 0) {
      this.shardTimer += SHARD_INTERVAL
      this.dropShards()
    }
  }

  private dropShards(): void {
    const o = this.owner
    const rnd = () => this.world.effects.random()
    const sp = len(o.vel)
    // Spread across the direction of travel (any axis if standing still).
    const heading = sp > 1 ? Math.atan2(o.vel.y, o.vel.x) : rnd() * Math.PI * 2
    const px = -Math.sin(heading)
    const py = Math.cos(heading)
    const fx = Math.cos(heading)
    const fy = Math.sin(heading)
    const along = sp * SHARD_INTERVAL * 0.5
    for (let i = 0; i < SHARDS_PER_DROP; i++) {
      const side = (rnd() * 2 - 1) * SHARD_SPREAD
      const fwd = (rnd() * 2 - 1) * along
      const size = SHARD_MIN + rnd() * (SHARD_MAX - SHARD_MIN)
      const rot = rnd() * Math.PI * 2
      const pts: Shard['pts'] = [0, 0, 0, 0, 0, 0]
      for (let k = 0; k < 3; k++) {
        // Irregular triangle: jittered vertex angles and radii.
        const a = rot + (k / 3) * Math.PI * 2 + (rnd() - 0.5) * 0.9
        const rr = size * (0.4 + rnd() * 0.35)
        pts[k * 2] = Math.cos(a) * rr
        pts[k * 2 + 1] = Math.sin(a) * rr
      }
      this.shards.push({
        x: o.pos.x + px * side + fx * fwd,
        y: o.pos.y + py * side + fy * fwd,
        born: this.world.time,
        color: Math.floor(rnd() * SHARD_COLORS.length),
        pts,
      })
    }
  }

  private inTrail(e: Ball): boolean {
    const reach = e.radius + BAND_HALF_WIDTH
    const r2 = reach * reach
    for (const s of this.samples) {
      if ((e.pos.x - s.x) ** 2 + (e.pos.y - s.y) ** 2 <= r2) return true
    }
    return false
  }

  private chill(dt: number): void {
    const e = this.enemy
    const onIce = e.alive && this.world.combatActive && this.inTrail(e)
    this.frozenLook = onIce && !e.invulnerable ? Math.min(1, this.frozenLook + dt * 8) : Math.max(0, this.frozenLook - dt / FREEZE_REFRESH)
    if (!onIce) {
      this.iceTime = 0
      return
    }
    if (!e.invulnerable) {
      e.applySlow(0, FREEZE_REFRESH)
      e.applyDisarm(FREEZE_REFRESH)
    }
    this.iceTime += dt
    if (this.iceTime >= FROST_TICK) {
      this.iceTime -= FROST_TICK
      this.world.damage(e, FROST_DAMAGE, { kind: 'frost', source: this.owner, at: e.pos })
    }
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.shards.length === 0) return
    const now = this.world.time
    ctx.save()
    ctx.globalAlpha = fade
    ctx.lineJoin = 'round'
    ctx.lineWidth = 1
    // Fresh shards are batched into one path per colour plus a shared outline.
    const fresh: Path2D[] = SHARD_COLORS.map(() => new Path2D())
    const outline = new Path2D()
    const dying: Shard[] = []
    for (const s of this.shards) {
      const age = now - s.born
      if (age > TRAIL_LIFETIME - FADE_TIME) {
        dying.push(s)
        continue
      }
      const g = Math.min(1, age / SHARD_GROW)
      shardPath(fresh[s.color], s, g)
      shardPath(outline, s, g)
    }
    fresh.forEach((p, i) => {
      ctx.fillStyle = SHARD_COLORS[i]
      ctx.fill(p)
    })
    ctx.strokeStyle = SHARD_EDGE
    ctx.stroke(outline)
    // Melting shards: translucent blue-grey, fading out.
    for (const s of dying) {
      const k = Math.max(0, (TRAIL_LIFETIME - (now - s.born)) / FADE_TIME)
      const p = new Path2D()
      shardPath(p, s, 1)
      ctx.fillStyle = `rgba(92,122,150,${0.75 * k})`
      ctx.fill(p)
      ctx.strokeStyle = `rgba(42,72,102,${0.8 * k})`
      ctx.stroke(p)
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const e = this.enemy
    const v = this.frozenLook * this.presence
    if (v <= 0 || !e.alive) return
    drawFrozenOverlay(ctx, e.pos.x, e.pos.y, e.radius * e.drawScale, this.cracks, v * e.opacity)
  }
}

function shardPath(p: Path2D, s: Shard, scale: number): void {
  const q = s.pts
  p.moveTo(s.x + q[0] * scale, s.y + q[1] * scale)
  p.lineTo(s.x + q[2] * scale, s.y + q[3] * scale)
  p.lineTo(s.x + q[4] * scale, s.y + q[5] * scale)
  p.closePath()
}

/** A few jagged cracks radiating from a point near the centre, in radius units. */
function makeCracks(rnd: () => number): Crack[] {
  const origin = { x: (rnd() - 0.5) * 0.4, y: (rnd() - 0.5) * 0.4 }
  const count = 5
  const cracks: Crack[] = []
  for (let i = 0; i < count; i++) {
    const heading = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.8
    const pts: Vec[] = [origin]
    let x = origin.x
    let y = origin.y
    const segs = 3 + Math.floor(rnd() * 2)
    const step = 1.15 / segs
    for (let k = 0; k < segs; k++) {
      const a = heading + (rnd() - 0.5) * 1.1
      x += Math.cos(a) * step
      y += Math.sin(a) * step
      pts.push({ x, y })
    }
    cracks.push(pts)
    // Occasional short branch off the middle of the crack.
    if (rnd() < 0.6) {
      const mid = pts[Math.min(2, pts.length - 1)]
      const a = heading + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.5)
      cracks.push([mid, { x: mid.x + Math.cos(a) * 0.35, y: mid.y + Math.sin(a) * 0.35 }])
    }
  }
  return cracks
}

function drawFrozenOverlay(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, cracks: readonly Crack[], alpha: number): void {
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(186,230,253,0.42)'
  ctx.fill()
  ctx.clip()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'miter'
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const c of cracks) {
    ctx.moveTo(cx + c[0].x * r, cy + c[0].y * r)
    for (let i = 1; i < c.length; i++) ctx.lineTo(cx + c[i].x * r, cy + c[i].y * r)
  }
  ctx.stroke()
  // Frosted rim.
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawFrostPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // Deterministic pseudo-random shard carpet sweeping in from the lower left.
  const hash = (n: number) => {
    const h = Math.sin(n * 12.9898) * 43758.5453
    return h - Math.floor(h)
  }
  const k = r / BALL_RADIUS
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 1
  ctx.strokeStyle = SHARD_EDGE
  for (let i = 0; i < 70; i++) {
    const t = i / 70
    // Path: a gentle arc from (-1.5r, 1.3r) to the ball centre, kept within ±2.5r.
    const bx = cx + r * (-1.5 + 1.5 * t)
    const by = cy + r * (1.3 - 1.3 * t - 0.5 * Math.sin(t * Math.PI))
    const side = (hash(i + 1) * 2 - 1) * SHARD_SPREAD * k * 0.7
    const nx = 0.63
    const ny = 0.78
    const x = bx + nx * side
    const y = by + ny * side
    const size = (SHARD_MIN + hash(i + 50) * (SHARD_MAX - SHARD_MIN)) * k
    const rot = hash(i + 100) * Math.PI * 2
    const pts: Shard['pts'] = [0, 0, 0, 0, 0, 0]
    for (let v = 0; v < 3; v++) {
      const a = rot + (v / 3) * Math.PI * 2 + (hash(i * 3 + v + 200) - 0.5) * 0.9
      const rr = size * (0.4 + hash(i * 3 + v + 400) * 0.35)
      pts[v * 2] = Math.cos(a) * rr
      pts[v * 2 + 1] = Math.sin(a) * rr
    }
    const p = new Path2D()
    shardPath(p, { x, y, born: 0, color: 0, pts }, 1)
    ctx.globalAlpha = t < 0.2 ? 0.35 + t * 3 : 1
    ctx.fillStyle = t < 0.2 ? 'rgb(92,122,150)' : SHARD_COLORS[Math.floor(hash(i + 300) * SHARD_COLORS.length)]
    ctx.fill(p)
    ctx.stroke(p)
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export const frostDef: CharacterDef = {
  id: 'frost',
  name: '冰霜',
  nameEn: 'FROST BALL',
  tagline: '踩上冰路就别想走',
  rules: [
    `走过的地方留下一条冰晶路，持续 ${TRAIL_LIFETIME} 秒`,
    '敌人踏上冰路就会被冻住：逐渐停下并被缴械',
    `待在冰路上每 ${FROST_TICK} 秒 -${FROST_DAMAGE}`,
    '自己不受冰路影响，撞击没有伤害',
  ],
  palette: { ball: '#50ccfc', text: '#ffffff', accent: '#4fc3f7' },
  mirrorPalette: { ball: '#1e6fa8', text: '#e0f2fe', accent: '#7dd3fc' },
  create: (w, b) => new FrostAbility(w, b),
  drawPortrait: drawFrostPortrait,
}
