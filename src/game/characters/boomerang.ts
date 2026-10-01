import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

const FIRST_THROW = 2.2
/** Idle time after each catch before the next throw (s). */
export const THROW_COOLDOWN = 1.5
/** Flight time of one out-and-back throw (s). */
export const FLIGHT_TIME = 1.3
export const BOOMERANG_DAMAGE = 10
/** Per-target cooldown so the outbound and the return pass can both hit. */
const HIT_COOLDOWN = 0.3
/** Hit reach added to the enemy's radius, measured from the boomerang's centre. */
const HIT_REACH = BALL_RADIUS * 0.8
const ORBIT_RADIUS = BALL_RADIUS * 1.4
/** Clockwise orbit speed while idle (rad/s): 1 rev/s. */
const ORBIT_SPEED = Math.PI * 2
/** Throw reach = distance to the enemy + this, clamped to [MIN_REACH, MAX_REACH]. */
const REACH_EXTRA = BALL_RADIUS * 2.5
const MIN_REACH = BALL_RADIUS * 4
const MAX_REACH = 450
/** Sideways bulge of the loop as a fraction of the reach. */
const LOOP_WIDTH = 0.3
const SPIN_IDLE = Math.PI * 2 * 2
const SPIN_THROWN = Math.PI * 2 * 4.5
const TRAIL_TIME = 0.18

const ARM_SHORT = BALL_RADIUS * 1.2
const ARM_LONG = BALL_RADIUS * 1.35
const THICKNESS = BALL_RADIUS * 0.4

interface Throw {
  /** Unit direction towards the enemy at release. */
  dir: Vec
  reach: number
  side: 1 | -1
  t: number
}

interface TrailPoint {
  x: number
  y: number
  time: number
}

/**
 * 回旋镖 (Boomerang) — a single boomerang circles its owner. Every few
 * seconds it is hurled towards the enemy along an out-and-back loop that
 * returns to the (moving) owner, slicing through anything on the way; the
 * enemy can be hit both going out and coming back, and by the idle orbit.
 */
export class BoomerangAbility extends Ability {
  private orbitAngle = -Math.PI / 2
  private spin = 0
  private idleTimer = FIRST_THROW
  private flight: Throw | null = null
  private hitCooldown = 0
  private pos: Vec
  private trail: TrailPoint[] = []

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.pos = this.orbitPos()
  }

  override update(dt: number): void {
    this.orbitAngle += ORBIT_SPEED * dt
    this.spin += (this.flight ? SPIN_THROWN : SPIN_IDLE) * dt
    this.hitCooldown = Math.max(0, this.hitCooldown - dt)

    if (this.flight) {
      this.flight.t += dt
      if (this.flight.t >= FLIGHT_TIME) {
        this.flight = null
        this.idleTimer = THROW_COOLDOWN
        this.world.sound('whoosh', 0.3, 1.4)
      }
    } else if (this.world.combatActive && !this.owner.disarmed) {
      this.idleTimer -= dt
      if (this.idleTimer <= 0 && this.enemy.alive) this.throw()
    }

    this.pos = this.flight ? this.flightPos(this.flight) : this.orbitPos()
    if (this.flight) this.trail.push({ x: this.pos.x, y: this.pos.y, time: this.world.time })
    this.trail = this.trail.filter((p) => this.world.time - p.time < TRAIL_TIME)
    this.collide()
  }

  private throw(): void {
    const o = this.owner.pos
    const e = this.enemy.pos
    const dx = e.x - o.x
    const dy = e.y - o.y
    const d = Math.hypot(dx, dy)
    const dir = d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 }
    this.flight = { dir, reach: clamp(d + REACH_EXTRA, MIN_REACH, MAX_REACH), side: this.world.rng.sign(), t: 0 }
    this.world.sound('throw', 0.7, 0.8)
  }

  private orbitPos(): Vec {
    const o = this.owner.pos
    return { x: o.x + Math.cos(this.orbitAngle) * ORBIT_RADIUS, y: o.y + Math.sin(this.orbitAngle) * ORBIT_RADIUS }
  }

  /**
   * owner + u·A·sin(πt/T) + perp(u)·0.3A·side·sin(2πt/T). The idle orbit
   * offset is blended in with weight cos²(πt/T) so release and catch join the
   * orbit seamlessly instead of snapping to the owner's centre.
   */
  private flightPos(f: Throw): Vec {
    const o = this.owner.pos
    const ph = (Math.PI * f.t) / FLIGHT_TIME
    const out = f.reach * Math.sin(ph)
    const lateral = LOOP_WIDTH * f.reach * f.side * Math.sin(2 * ph)
    const w = Math.cos(ph) ** 2
    const orbit = this.orbitPos()
    return {
      x: o.x + f.dir.x * out - f.dir.y * lateral + (orbit.x - o.x) * w,
      y: o.y + f.dir.y * out + f.dir.x * lateral + (orbit.y - o.y) * w,
    }
  }

  private collide(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive || this.hitCooldown > 0) return
    // A boomerang already in flight still lands; the one held in orbit can't strike while disarmed.
    if (!this.flight && this.owner.disarmed) return
    const reach = e.radius + HIT_REACH
    const dx = e.pos.x - this.pos.x
    const dy = e.pos.y - this.pos.y
    if (dx * dx + dy * dy >= reach * reach) return
    const d = Math.hypot(dx, dy) || 1
    const at = { x: e.pos.x - (dx / d) * e.radius, y: e.pos.y - (dy / d) * e.radius }
    // Cooldown applies even when blocked, so a shielded target isn't re-checked every step.
    this.hitCooldown = HIT_COOLDOWN
    this.world.damage(e, BOOMERANG_DAMAGE, { kind: 'boomerang', source: this.owner, at, shake: 3 })
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    const now = this.world.time
    const pts = this.trail.filter((p) => now - p.time < TRAIL_TIME)
    if (pts.length > 1) {
      ctx.lineCap = 'round'
      ctx.strokeStyle = '#ff8a1f'
      for (let i = 1; i < pts.length; i++) {
        const age = (now - pts[i].time) / TRAIL_TIME
        ctx.globalAlpha = fade * 0.28 * (1 - age)
        ctx.lineWidth = THICKNESS * (1.4 - age)
        ctx.beginPath()
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
        ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()
      }
      ctx.globalAlpha = fade
    }
    drawBoomerang(ctx, this.pos.x, this.pos.y, this.spin, 1)
    ctx.restore()
  }
}

/**
 * Amber V-shaped boomerang spinning about its centroid at (x, y). `scale`
 * multiplies the engine size (arms ≈1.2 ball radii, thickness ≈0.4).
 */
export function drawBoomerang(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale: number): void {
  const half = 0.95 // half opening angle of the V (rad)
  const a1 = ARM_SHORT * scale
  const a2 = ARM_LONG * scale
  const th = THICKNESS * scale
  const tip1 = { x: Math.cos(half) * a1, y: -Math.sin(half) * a1 }
  const tip2 = { x: Math.cos(half) * a2, y: Math.sin(half) * a2 }
  // Shift so the rotation centre sits roughly at the shape's centroid.
  const shiftX = -(tip1.x + tip2.x) / 3
  const shiftY = -(tip1.y + tip2.y) / 3
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(tip1.x + shiftX, tip1.y + shiftY)
    ctx.lineTo(shiftX, shiftY)
    ctx.lineTo(tip2.x + shiftX, tip2.y + shiftY)
  }
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#c85a0a'
  ctx.lineWidth = th + 3 * scale
  path()
  ctx.stroke()
  ctx.strokeStyle = '#ffa726'
  ctx.lineWidth = th
  path()
  ctx.stroke()
  // Lighter highlight along the leading (outer) edge.
  ctx.translate(-th * 0.2, 0)
  ctx.strokeStyle = '#ffd08a'
  ctx.lineWidth = th * 0.28
  path()
  ctx.stroke()
  ctx.restore()
}

export function drawBoomerangPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const s = r / BALL_RADIUS
  // Dashed out-and-back loop.
  ctx.save()
  ctx.strokeStyle = 'rgba(255,138,31,0.35)'
  ctx.lineWidth = 2
  ctx.setLineDash([5, 6])
  ctx.beginPath()
  const reach = r * 2.3
  for (let i = 0; i <= 40; i++) {
    const ph = (Math.PI * i) / 40
    const out = reach * Math.sin(ph)
    const lat = LOOP_WIDTH * reach * Math.sin(2 * ph) * 1.4
    const px = cx + out * Math.cos(-0.5) - lat * Math.sin(-0.5)
    const py = cy + out * Math.sin(-0.5) + lat * Math.cos(-0.5)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  drawBoomerang(ctx, cx + r * 1.5, cy - r * 1.15, 0.6, s * 0.8)
}

export const boomerangDef: CharacterDef = {
  id: 'boomerang',
  name: '回旋镖',
  nameEn: 'BOOMERANG',
  tagline: '去了还会回来',
  rules: [
    '一只回旋镖绕着本体旋转，碰到敌人也会造成伤害（被缴械时转着的不伤人）',
    `每隔 ${THROW_COOLDOWN} 秒朝敌人掷出，画一个来回的弧线飞回本体（约 ${FLIGHT_TIME} 秒）`,
    `命中敌人 -${BOOMERANG_DAMAGE}，回旋镖直接穿过`,
    '去程和回程都能打中，一次投掷可以命中两下',
  ],
  palette: { ball: '#ff9a1f', text: '#ffffff', accent: '#ff8a1f' },
  mirrorPalette: { ball: '#c2410c', text: '#ffedd5', accent: '#f97316' },
  create: (w, b) => new BoomerangAbility(w, b),
  drawPortrait: drawBoomerangPortrait,
}
