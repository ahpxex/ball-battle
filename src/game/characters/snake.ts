import { type Vec, damp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

export const START_SEGMENTS = 3
/** Fight time between two growth spurts (s). */
export const GROW_INTERVAL = 5.0
export const MAX_SEGMENTS = 12
export const SEGMENT_DAMAGE = 4
/** Minimum gap between two hits from the same segment (s). */
export const SEGMENT_COOLDOWN = 0.4
/** Body segment radius relative to the head's radius. */
const SEGMENT_SCALE = 0.95
/** Radii of the last two segments relative to the head (tail taper). */
const TAPER_SCALES = [0.6, 0.35] as const
/** Path distance between consecutive full-size circles, in head radii. */
const SPACING_SCALE = 1.88
/** The tail tip pokes this far (in last-segment radii) past the last circle. */
const NUB_REACH = 1.3
/** Minimum head travel before a new path point is recorded. */
const TRAIL_STEP = 3
/** Rate at which segment radii ease toward their target size (1/s). */
const GROW_RATE = 9
const OUTLINE = 'rgba(0,0,0,0.38)'

interface Segment {
  x: number
  y: number
  r: number
}

/**
 * 蟒蛇 — the ball is the head of a snake whose body follows the exact path
 * the head took. The body grows a segment every few seconds; every body
 * segment that touches the enemy bites it. The body doesn't block anything
 * and the head itself has no special contact effect.
 */
export class SnakeAbility extends Ability {
  /** Recorded head positions, oldest first. */
  private trail: Vec[] = []
  /** Current (animated) radius of each body segment, nearest to the head first. */
  private radii: number[] = []
  /** World time each segment last bit the enemy. */
  private lastBite: number[] = []
  private growTimer = GROW_INTERVAL

  constructor(world: World, owner: Ball) {
    super(world, owner)
    for (let i = 0; i < START_SEGMENTS; i++) {
      this.radii.push(this.targetRadius(i, START_SEGMENTS))
      this.lastBite.push(-Infinity)
    }
    this.prefillTrail()
  }

  /** Path length needed to lay out the longest possible body. */
  private get maxTrailLength(): number {
    return this.owner.radius * (SPACING_SCALE * (MAX_SEGMENTS + 1) + 2)
  }

  private targetRadius(index: number, count: number): number {
    const fromEnd = count - 1 - index
    const scale = fromEnd < TAPER_SCALES.length ? TAPER_SCALES[TAPER_SCALES.length - 1 - fromEnd] : SEGMENT_SCALE
    return this.owner.radius * scale
  }

  /**
   * Seeds the path behind the head (opposite its launch direction, folded
   * off the walls) so the body is laid out from the first frame.
   */
  private prefillTrail(): void {
    const o = this.owner
    const s = this.world.size
    const r = o.radius
    const sp = Math.hypot(o.vel.x, o.vel.y)
    let dx = sp > 1e-6 ? -o.vel.x / sp : -1
    let dy = sp > 1e-6 ? -o.vel.y / sp : 0
    let x = o.pos.x
    let y = o.pos.y
    const pts: Vec[] = []
    for (let d = 0; d < this.maxTrailLength; d += TRAIL_STEP) {
      x += dx * TRAIL_STEP
      y += dy * TRAIL_STEP
      if (x < r) {
        x = 2 * r - x
        dx = -dx
      } else if (x > s - r) {
        x = 2 * (s - r) - x
        dx = -dx
      }
      if (y < r) {
        y = 2 * r - y
        dy = -dy
      } else if (y > s - r) {
        y = 2 * (s - r) - y
        dy = -dy
      }
      pts.push({ x, y })
    }
    pts.reverse()
    this.trail = pts
  }

  override update(dt: number): void {
    this.recordTrail()
    if (this.world.combatActive) {
      // Growth is passive: it keeps going even while disarmed.
      this.growTimer -= dt
      if (this.growTimer <= 0) {
        this.growTimer += GROW_INTERVAL
        this.grow()
      }
    }
    const k = damp(GROW_RATE, dt)
    const n = this.radii.length
    for (let i = 0; i < n; i++) this.radii[i] += (this.targetRadius(i, n) - this.radii[i]) * k
    this.bite()
  }

  private recordTrail(): void {
    const p = this.owner.pos
    const last = this.trail[this.trail.length - 1]
    if (last && (p.x - last.x) ** 2 + (p.y - last.y) ** 2 < TRAIL_STEP * TRAIL_STEP) return
    this.trail.push({ x: p.x, y: p.y })
    // Drop path points beyond what the longest body could ever need.
    const max = this.maxTrailLength
    let acc = 0
    for (let i = this.trail.length - 1; i > 0; i--) {
      const a = this.trail[i]
      const b = this.trail[i - 1]
      acc += Math.hypot(a.x - b.x, a.y - b.y)
      if (acc > max) {
        this.trail.splice(0, i - 1)
        return
      }
    }
  }

  private grow(): void {
    if (this.radii.length >= MAX_SEGMENTS) return
    // The new segment sprouts from the tail; the taper slides back with it.
    this.radii.push(0)
    this.lastBite.push(-Infinity)
    const tail = this.body()
    const end = tail[tail.length - 1]
    this.world.effects.burst(end, { count: 6, color: [this.owner.color, '#ffffff'], speed: [30, 110], size: [2, 3.5], life: [0.25, 0.5], front: false })
    this.world.sound('place', 0.3, 1.4)
  }

  private bite(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive || this.owner.disarmed) return
    const now = this.world.time
    const segs = this.body()
    for (let i = 0; i < segs.length; i++) {
      if (now - this.lastBite[i] < SEGMENT_COOLDOWN) continue
      const s = segs[i]
      const dx = e.pos.x - s.x
      const dy = e.pos.y - s.y
      const reach = s.r + e.radius
      const d2 = dx * dx + dy * dy
      if (d2 >= reach * reach) continue
      this.lastBite[i] = now
      const d = Math.sqrt(d2) || 1
      const at = { x: s.x + (dx / d) * s.r, y: s.y + (dy / d) * s.r }
      this.world.damage(e, SEGMENT_DAMAGE, { kind: 'snake', source: this.owner, at })
      if (!e.alive) return
    }
  }

  /** Distance along the path between circles of radius `a` and `b`. */
  private spacing(a: number, b: number): number {
    const full = this.owner.radius * SPACING_SCALE
    // Full-size circles sit SPACING apart; smaller ones close up so the chain stays joined.
    return Math.min(full, ((a + b) * SPACING_SCALE) / (2 * SEGMENT_SCALE))
  }

  /** Arc-length distances from the head of every body circle (plus the tail tip last). */
  private layout(): number[] {
    const dists: number[] = []
    let prev = this.owner.radius
    let d = 0
    for (const r of this.radii) {
      d += this.spacing(prev, r)
      dists.push(d)
      prev = r
    }
    dists.push(d + prev * NUB_REACH)
    return dists
  }

  /** Samples the head's path at increasing arc-length distances behind it. */
  private sample(dists: readonly number[]): Vec[] {
    const out: Vec[] = []
    let k = 0
    let acc = 0
    let px = this.owner.pos.x
    let py = this.owner.pos.y
    for (let i = this.trail.length - 1; i >= 0 && k < dists.length; i--) {
      const q = this.trail[i]
      const seg = Math.hypot(q.x - px, q.y - py)
      while (k < dists.length && dists[k] <= acc + seg) {
        const u = seg > 0 ? (dists[k] - acc) / seg : 0
        out.push({ x: px + (q.x - px) * u, y: py + (q.y - py) * u })
        k++
      }
      acc += seg
      px = q.x
      py = q.y
    }
    while (k < dists.length) {
      out.push({ x: px, y: py })
      k++
    }
    return out
  }

  /** Body circles, nearest to the head first. */
  private body(): Segment[] {
    const pts = this.sample(this.layout())
    return this.radii.map((r, i) => ({ x: pts[i].x, y: pts[i].y, r }))
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const pts = this.sample(this.layout())
    const n = this.radii.length
    const segs = this.radii.map((r, i) => ({ x: pts[i].x, y: pts[i].y, r }))
    const tip = pts[n]
    const now = this.world.time
    ctx.save()
    ctx.globalAlpha *= fade
    ctx.fillStyle = this.owner.color
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 2
    if (n > 0) drawTailNub(ctx, segs[n - 1], tip)
    // Tail first so segments nearer the head overlap the ones behind.
    for (let i = n - 1; i >= 0; i--) {
      const s = segs[i]
      if (s.r < 0.5) continue
      ctx.fillStyle = this.owner.color
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      const flash = 1 - (now - this.lastBite[i]) / 0.12
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.6})`
        ctx.fill()
      }
    }
    ctx.restore()
  }
}

/** Pointed tail tip running from the last segment to `tip`. Fill/stroke styles are the caller's. */
function drawTailNub(ctx: CanvasRenderingContext2D, last: Segment, tip: Vec): void {
  const dx = last.x - tip.x
  const dy = last.y - tip.y
  const d = Math.hypot(dx, dy)
  if (d < 0.5 || last.r < 0.5) return
  const nx = -dy / d
  const ny = dx / d
  const w = last.r * 0.8
  ctx.beginPath()
  ctx.moveTo(last.x + nx * w, last.y + ny * w)
  ctx.quadraticCurveTo(tip.x + dx * 0.25 + nx * w * 0.3, tip.y + dy * 0.25 + ny * w * 0.3, tip.x, tip.y)
  ctx.quadraticCurveTo(tip.x + dx * 0.25 - nx * w * 0.3, tip.y + dy * 0.25 - ny * w * 0.3, last.x - nx * w, last.y - ny * w)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

export function drawSnakePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // A body curled around the centre, head at the upper right.
  const ox = cx - r * 0.15
  const oy = cy + r * 0.35
  const ring = r * 1.5
  const headR = r * 0.85
  const radii = [r * 0.78, r * 0.78, r * 0.5, r * 0.3]
  const circles: Segment[] = []
  let ang = -0.95
  let prev = headR
  for (const rr of radii) {
    ang += ((prev + rr) * 0.97) / ring
    circles.push({ x: ox + Math.cos(ang) * ring, y: oy + Math.sin(ang) * ring, r: rr })
    prev = rr
  }
  const tipAng = ang + (prev * NUB_REACH) / ring
  const tip = { x: ox + Math.cos(tipAng) * ring, y: oy + Math.sin(tipAng) * ring }
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 1.6
  drawTailNub(ctx, circles[circles.length - 1], tip)
  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i]
    ctx.beginPath()
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  const hx = ox + Math.cos(-0.95) * ring
  const hy = oy + Math.sin(-0.95) * ring
  // Forked tongue flicking forward.
  const fwd = -0.95 - Math.PI / 2
  const tx = hx + Math.cos(fwd) * headR
  const ty = hy + Math.sin(fwd) * headR
  const tl = r * 0.55
  const ex = tx + Math.cos(fwd) * tl
  const ey = ty + Math.sin(fwd) * tl
  ctx.strokeStyle = '#e11d48'
  ctx.lineWidth = r * 0.08
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(tx, ty)
  ctx.lineTo(ex, ey)
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex + Math.cos(fwd - 0.5) * tl * 0.35, ey + Math.sin(fwd - 0.5) * tl * 0.35)
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex + Math.cos(fwd + 0.5) * tl * 0.35, ey + Math.sin(fwd + 0.5) * tl * 0.35)
  ctx.stroke()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(hx, hy, headR, 0, Math.PI * 2)
  ctx.fill()
  // Eyes looking along the tongue.
  for (const side of [-1, 1]) {
    const a = fwd + side * 0.55
    const x = hx + Math.cos(a) * headR * 0.55
    const y = hy + Math.sin(a) * headR * 0.55
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, r * 0.17, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#0a0a0a'
    ctx.beginPath()
    ctx.arc(x + Math.cos(fwd) * r * 0.05, y + Math.sin(fwd) * r * 0.05, r * 0.08, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export const snakeDef: CharacterDef = {
  id: 'snake',
  name: '蟒蛇',
  nameEn: 'SNAKE',
  tagline: '越长越难躲',
  rules: [
    `身后拖着 ${START_SEGMENTS} 节身体，每 ${GROW_INTERVAL} 秒长出一节（最多 ${MAX_SEGMENTS} 节）`,
    `身体的每一节碰到敌人都会 -${SEGMENT_DAMAGE}，好几节可以同时咬`,
    `同一节每 ${SEGMENT_COOLDOWN} 秒最多咬一次`,
    '身体不挡路，敌人能直接穿过；蛇头本身没有伤害',
  ],
  palette: { ball: '#00db42', text: '#ffffff', accent: '#00d848' },
  mirrorPalette: { ball: '#0f766e', text: '#ccfbf1', accent: '#2dd4bf' },
  create: (w, b) => new SnakeAbility(w, b),
  drawPortrait: drawSnakePortrait,
}
