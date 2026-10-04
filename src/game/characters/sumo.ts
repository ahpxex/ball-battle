import * as dm from '../core/dmath'
import { type Vec, clamp, lerp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { BallContact, Wall } from '../engine/types'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

/** The wrestler is this many times heavier than a normal ball: bumping into it barely moves it. */
const SUMO_MASS = 3
/** Minimum time between two shoves. */
export const SHOVE_COOLDOWN = 1.2
/** Shove speed added to the enemy, away from the sumo: base + share of the closing speed. */
const SHOVE_BASE = 520
const SHOVE_PER_CLOSING = 0.6
const SHOVE_MAX = 1100
/** A wall hit this soon after a shove is a slam. */
export const SLAM_WINDOW = 1
/** Wall impacts slower than this (speed into the wall) don't count as a slam. */
const SLAM_MIN_SPEED = 280
export const SLAM_MIN_DAMAGE = 5
export const SLAM_MAX_DAMAGE = 17
/** Impact speed (into the wall) that deals the maximum slam damage. */
const SLAM_FULL_SPEED = 950
/** A ball counts as touching a wall when its rim is this close to it. */
const CONTACT_EPS = 1
/** Stomp (shiko): starts when the enemy centre comes this close, then shakes the ground around the sumo. */
export const STOMP_COOLDOWN = 4
const STOMP_WINDUP = 0.35
const STOMP_RANGE = BALL_RADIUS * 4.6
/** The stomp lands on anything this close when the foot comes down. */
const STOMP_REACH = BALL_RADIUS * 5.2
export const STOMP_DAMAGE = 2
/** Push of the stomp shockwave: strongest point blank, weaker at the edge. */
const STOMP_PUSH_NEAR = 760
const STOMP_PUSH_FAR = 460
const STOMP_RING_LIFE = 0.45

const PALM_LIFE = 0.28
const CRACK_LIFE = 0.9
const WALLS: readonly Wall[] = ['left', 'right', 'top', 'bottom']

interface Palm {
  pos: Vec
  angle: number
  age: number
}

interface Crack {
  pos: Vec
  wall: Wall
  age: number
  power: number
  /** Cosmetic per-crack variation. */
  seed: number
}

/** Unit normal of `wall` pointing into the arena. */
function inward(wall: Wall): Vec {
  switch (wall) {
    case 'left':
      return { x: 1, y: 0 }
    case 'right':
      return { x: -1, y: 0 }
    case 'top':
      return { x: 0, y: 1 }
    case 'bottom':
      return { x: 0, y: -1 }
  }
}

/** Gap between the ball's rim and `wall`. */
function gapTo(b: Ball, wall: Wall, size: number): number {
  switch (wall) {
    case 'left':
      return b.pos.x - b.radius
    case 'right':
      return size - b.radius - b.pos.x
    case 'top':
      return b.pos.y - b.radius
    case 'bottom':
      return size - b.radius - b.pos.y
  }
}

/**
 * 相扑 SUMO — no weapon, just weight. Bumping into the enemy shoves it away
 * hard; if the shoved enemy is smashed into a wall shortly after, the wall
 * does the damage.
 */
export class SumoAbility extends Ability {
  private cooldown = 0
  /** Time left in which a wall hit counts as a slam (0 = no shove in flight). */
  private slamWindow = 0
  /** Enemy velocity before this step's physics, to spot wall bounces. */
  private prevVel: Vec = { x: 0, y: 0 }
  private palms: Palm[] = []
  private cracks: Crack[] = []
  /** Seconds left of the post-shove body squash (visual). */
  private squash = 0
  private stompCooldown = 1.5
  /** Time spent winding up the stomp, or -1 while not stomping. */
  private windup = -1
  /** Expanding shockwaves (age in s). */
  private rings: { pos: Vec; age: number }[] = []

  constructor(world: World, owner: Ball) {
    super(world, owner)
    owner.mass = SUMO_MASS
  }

  override prePhysics(_dt: number): void {
    const e = this.enemy
    this.prevVel = { x: e.vel.x, y: e.vel.y }
  }

  override onBallContact(c: BallContact): void {
    const o = this.owner
    const e = c.other
    if (this.cooldown > 0 || o.disarmed || !this.world.combatActive || !e.alive) return
    // Held balls stay where their holder keeps them.
    if (!e.movable || e.attachedTo || o.attachedTo) return
    const n = c.normal
    this.push(e, n, Math.min(SHOVE_MAX, SHOVE_BASE + c.closingSpeed * SHOVE_PER_CLOSING))
    this.cooldown = SHOVE_COOLDOWN
    this.squash = PALM_LIFE
    this.palms.push({ pos: { x: c.point.x, y: c.point.y }, angle: dm.atan2(n.y, n.x), age: 0 })
    this.world.addShake(3)
    this.world.sound('heavyHit', 0.55, 0.55)
    this.world.effects.burst(c.point, {
      count: 10,
      color: ['#fde68a', '#f59e0b', '#ffffff'],
      shape: 'spark',
      speed: [120, 320],
      size: [2, 4],
      life: [0.15, 0.35],
      direction: dm.atan2(n.y, n.x),
      spread: 0.9,
    })
    this.world.effects.burst(c.point, {
      count: 1,
      color: '#fef3c7',
      shape: 'ring',
      speed: [0, 0],
      size: [BALL_RADIUS * 0.5, BALL_RADIUS * 0.5],
      life: [0.3, 0.3],
      endScale: 3.2,
    })
  }

  /** Sends `e` flying along `n` and opens the slam window. */
  private push(e: Ball, n: Vec, power: number): void {
    // Keep the sideways part of its motion, replace the part along the push.
    const along = e.vel.x * n.x + e.vel.y * n.y
    const add = Math.max(0, along) + power - along
    e.vel.x += n.x * add
    e.vel.y += n.y * add
    this.slamWindow = SLAM_WINDOW
  }

  private enemyDistance(): number {
    const o = this.owner.pos
    const e = this.enemy.pos
    return dm.hypot(e.x - o.x, e.y - o.y)
  }

  private updateStomp(dt: number): void {
    const o = this.owner
    const e = this.enemy
    if (this.windup >= 0) {
      if (o.disarmed || !this.world.combatActive || !e.alive) {
        this.windup = -1
        return
      }
      this.windup += dt
      if (this.windup >= STOMP_WINDUP) this.stomp()
      return
    }
    this.stompCooldown = Math.max(0, this.stompCooldown - dt)
    if (this.stompCooldown > 0 || o.disarmed || !this.world.combatActive || !e.alive) return
    // Can't plant its feet while something else holds it.
    if (o.pinned || o.rooted || o.attachedTo) return
    if (this.enemyDistance() > STOMP_RANGE) return
    this.windup = 0
    this.world.sound('whoosh', 0.3, 0.5)
  }

  private stomp(): void {
    const o = this.owner
    const e = this.enemy
    this.windup = -1
    this.stompCooldown = STOMP_COOLDOWN
    this.rings.push({ pos: { x: o.pos.x, y: o.pos.y }, age: 0 })
    this.world.addShake(4)
    this.world.sound('heavyHit', 0.7, 0.45)
    const fx = this.world.effects
    fx.burst(o.pos, {
      count: 16,
      color: ['#e7d3b5', '#d6c3a5', '#a8a29e'],
      shape: 'smoke',
      speed: [140, 300],
      size: [7, 13],
      life: [0.35, 0.7],
      endScale: 2,
      drag: 4,
      jitter: o.radius * 0.6,
      front: false,
    })
    const d = this.enemyDistance()
    if (d > STOMP_REACH) return
    const n = d > 1e-6 ? { x: (e.pos.x - o.pos.x) / d, y: (e.pos.y - o.pos.y) / d } : { x: 1, y: 0 }
    const at = { x: e.pos.x - n.x * e.radius, y: e.pos.y - n.y * e.radius }
    const dealt = this.world.damage(e, STOMP_DAMAGE, { kind: 'slam', source: o, at })
    if (dealt <= 0 || !e.alive || !e.movable || e.attachedTo) return
    const u = clamp((d - o.radius - e.radius) / (STOMP_REACH - o.radius - e.radius), 0, 1)
    this.push(e, n, lerp(STOMP_PUSH_NEAR, STOMP_PUSH_FAR, u))
  }

  override update(dt: number): void {
    this.updateStomp(dt)
    for (const r of this.rings) r.age += dt
    this.rings = this.rings.filter((r) => r.age < STOMP_RING_LIFE)
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.squash = Math.max(0, this.squash - dt)
    for (const p of this.palms) p.age += dt
    this.palms = this.palms.filter((p) => p.age < PALM_LIFE)
    for (const k of this.cracks) k.age += dt
    this.cracks = this.cracks.filter((k) => k.age < CRACK_LIFE)
    if (this.slamWindow <= 0) return
    this.slamWindow = Math.max(0, this.slamWindow - dt)
    this.detectSlam()
  }

  /** A wall bounced the shoved enemy this step: the wall hits it. */
  private detectSlam(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const s = this.world.size
    let best: Wall | null = null
    let bestSpeed = 0
    for (const w of WALLS) {
      if (gapTo(e, w, s) > CONTACT_EPS) continue
      const n = inward(w)
      const before = -(this.prevVel.x * n.x + this.prevVel.y * n.y)
      const after = e.vel.x * n.x + e.vel.y * n.y
      // Was moving into the wall, now moving away from it.
      if (before <= 0 || after <= 0) continue
      if (after > bestSpeed) {
        best = w
        bestSpeed = after
      }
    }
    if (best === null) return
    // Any wall hit ends the window; only a hard one hurts.
    this.slamWindow = 0
    if (bestSpeed < SLAM_MIN_SPEED) return
    const u = clamp((bestSpeed - SLAM_MIN_SPEED) / (SLAM_FULL_SPEED - SLAM_MIN_SPEED), 0, 1)
    const dmg = Math.round(lerp(SLAM_MIN_DAMAGE, SLAM_MAX_DAMAGE, u))
    const n = inward(best)
    const at = { x: e.pos.x - n.x * e.radius, y: e.pos.y - n.y * e.radius }
    const dealt = this.world.damage(e, dmg, { kind: 'slam', source: this.owner, at, shake: 2 + dmg * 0.4 })
    if (dealt <= 0) return
    this.cracks.push({ pos: at, wall: best, age: 0, power: u, seed: this.world.effects.random() })
    const fx = this.world.effects
    const dir = dm.atan2(n.y, n.x)
    fx.burst(at, {
      count: 5 + Math.round(u * 8),
      color: ['#a8a29e', '#78716c', '#d6d3d1'],
      shape: 'shard',
      speed: [120, 360],
      size: [2.5, 6],
      life: [0.35, 0.8],
      direction: dir,
      spread: 1.2,
      gravity: 0,
    })
    fx.burst(at, {
      count: 6,
      color: ['#fde68a', '#f5d0a9', '#ffffff'],
      shape: 'smoke',
      speed: [40, 160],
      size: [6, 12],
      life: [0.4, 0.8],
      endScale: 2.2,
      direction: dir,
      spread: 1.4,
      front: false,
    })
  }

  // ───────────────────────────── rendering ─────────────────────────────

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    // Speed lines behind a freshly shoved enemy.
    const e = this.enemy
    if (this.slamWindow > 0 && e.alive) {
      const sp = dm.hypot(e.vel.x, e.vel.y)
      const u = clamp((sp - 320) / 500, 0, 1) * fade
      if (u > 0) drawShoveTrail(ctx, e, u)
    }
    for (const k of this.cracks) drawCrack(ctx, k, fade)
    for (const r of this.rings) drawShockwave(ctx, r.pos, r.age / STOMP_RING_LIFE, fade)
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    if (this.windup < 0) return
    // Stomp telegraph: the ground ring tightens around the wrestler as the foot rises.
    const o = this.owner
    const u = clamp(this.windup / STOMP_WINDUP, 0, 1)
    const r = lerp(STOMP_REACH, o.radius * 1.1, u * u)
    ctx.save()
    ctx.strokeStyle = `rgba(245,158,11,${0.25 + 0.6 * u})`
    ctx.lineWidth = 2 + 2 * u
    ctx.setLineDash([10, 8])
    ctx.lineDashOffset = -this.world.time * 60
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = `rgba(41,37,36,${0.35 * u})`
    ctx.beginPath()
    ctx.ellipse(o.pos.x, o.pos.y + o.radius * 0.9, o.radius * (1 + 0.2 * u), o.radius * 0.35, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawSumoBody(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, this.squash > 0 ? this.squash / PALM_LIFE : 0)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.palms.length === 0) return
    ctx.save()
    for (const p of this.palms) {
      const u = p.age / PALM_LIFE
      // Thrust out fast, then fade.
      const reach = BALL_RADIUS * (0.15 + 0.5 * Math.min(1, u * 4))
      ctx.globalAlpha = fade * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)
      drawPalm(
        ctx,
        p.pos.x + dm.cos(p.angle) * reach - dm.cos(p.angle) * BALL_RADIUS * 0.35,
        p.pos.y + dm.sin(p.angle) * reach - dm.sin(p.angle) * BALL_RADIUS * 0.35,
        p.angle,
        BALL_RADIUS * 1.35,
      )
    }
    ctx.restore()
  }
}

/** Ground shockwave of a stomp at progress `u` (0..1): a sandy ring with short radial cracks. */
function drawShockwave(ctx: CanvasRenderingContext2D, pos: Vec, u: number, fade: number): void {
  const r = lerp(BALL_RADIUS * 1.1, STOMP_REACH, 1 - (1 - u) * (1 - u))
  const a = fade * (1 - u)
  ctx.save()
  ctx.strokeStyle = `rgba(253,230,138,${0.85 * a})`
  ctx.lineWidth = 3 + 7 * (1 - u)
  ctx.beginPath()
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = `rgba(245,158,11,${0.6 * a})`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(pos.x, pos.y, r * 0.78, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = `rgba(168,162,158,${0.8 * a})`
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + 0.3
    const r0 = BALL_RADIUS * 1.05
    const r1 = r0 + (r - r0) * (0.35 + 0.15 * (i % 3))
    ctx.moveTo(pos.x + dm.cos(ang) * r0, pos.y + dm.sin(ang) * r0)
    ctx.lineTo(pos.x + dm.cos(ang + 0.08) * (r0 + r1) * 0.5, pos.y + dm.sin(ang + 0.08) * (r0 + r1) * 0.5)
    ctx.lineTo(pos.x + dm.cos(ang - 0.04) * r1, pos.y + dm.sin(ang - 0.04) * r1)
  }
  ctx.stroke()
  ctx.restore()
}

/** Topknot and mawashi drawn over the ball body. `punch` (0..1) bulges the belt after a shove. */
function drawSumoBody(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, punch: number): void {
  ctx.save()
  // Mawashi: a dark band across the lower belly, clipped to the body.
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()
  const top = y + r * (0.42 - 0.04 * punch)
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(x - r, top, r * 2, r * 0.3)
  ctx.fillStyle = '#334155'
  ctx.fillRect(x - r, top, r * 2, r * 0.07)
  // Front flap (sagari) with a few cords.
  ctx.fillStyle = '#1e293b'
  ctx.beginPath()
  ctx.moveTo(x - r * 0.2, top + r * 0.28)
  ctx.lineTo(x + r * 0.2, top + r * 0.28)
  ctx.lineTo(x + r * 0.16, y + r)
  ctx.lineTo(x - r * 0.16, y + r)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = Math.max(1, r * 0.04)
  ctx.beginPath()
  for (const dx of [-0.1, 0, 0.1]) {
    ctx.moveTo(x + r * dx, top + r * 0.3)
    ctx.lineTo(x + r * dx, y + r)
  }
  ctx.stroke()
  ctx.restore()
  // Topknot (chonmage) on the crown.
  ctx.fillStyle = '#111827'
  ctx.beginPath()
  ctx.ellipse(x, y - r * 0.93, r * 0.24, r * 0.15, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(x, y - r * 1.1, r * 0.13, r * 0.17, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#f8fafc'
  ctx.lineWidth = Math.max(1, r * 0.05)
  ctx.beginPath()
  ctx.moveTo(x - r * 0.12, y - r * 1.0)
  ctx.lineTo(x + r * 0.12, y - r * 1.0)
  ctx.stroke()
  ctx.restore()
}

/** An open palm (tsuppari) at (x, y), fingers pointing along `angle`. */
export function drawPalm(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number): void {
  const L = size
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#7c2d12'
  ctx.lineWidth = Math.max(1, L * 0.045)
  ctx.fillStyle = '#f5d0a9'
  // Palm.
  ctx.beginPath()
  ctx.ellipse(0, 0, L * 0.3, L * 0.36, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // Four fingers pointing forward.
  for (let i = 0; i < 4; i++) {
    const fy = (i - 1.5) * L * 0.17
    const len = L * (i === 0 || i === 3 ? 0.3 : 0.36)
    ctx.beginPath()
    ctx.ellipse(L * 0.28 + len * 0.5, fy, len * 0.55, L * 0.08, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  // Thumb.
  ctx.beginPath()
  ctx.ellipse(L * 0.12, -L * 0.38, L * 0.2, L * 0.08, -0.7, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // Impact lines ahead of the palm.
  ctx.strokeStyle = 'rgba(254,243,199,0.85)'
  ctx.lineWidth = Math.max(1, L * 0.05)
  ctx.beginPath()
  for (const a of [-0.55, 0, 0.55]) {
    ctx.moveTo(L * 0.82 + dm.cos(a) * L * 0.12, dm.sin(a) * L * 0.5)
    ctx.lineTo(L * 0.82 + dm.cos(a) * L * 0.34, dm.sin(a) * L * 0.7)
  }
  ctx.stroke()
  ctx.restore()
}

/** Amber speed lines trailing a shoved ball. */
function drawShoveTrail(ctx: CanvasRenderingContext2D, e: Ball, alpha: number): void {
  const sp = dm.hypot(e.vel.x, e.vel.y)
  if (sp < 1) return
  const dx = e.vel.x / sp
  const dy = e.vel.y / sp
  const px = -dy
  const py = dx
  const r = e.radius
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = 3
  for (const off of [-0.7, -0.25, 0.25, 0.7]) {
    const sx = e.pos.x + px * off * r - dx * r * 0.5
    const sy = e.pos.y + py * off * r - dy * r * 0.5
    const L = r * (1 + 1.4 * alpha) * (1 - Math.abs(off) * 0.4)
    const g = ctx.createLinearGradient(sx, sy, sx - dx * L, sy - dy * L)
    g.addColorStop(0, `rgba(253,230,138,${0.85 * alpha})`)
    g.addColorStop(1, 'rgba(245,158,11,0)')
    ctx.strokeStyle = g
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(sx - dx * L, sy - dy * L)
    ctx.stroke()
  }
  ctx.restore()
}

/** A dent with radiating cracks where the wall caught a slammed ball. */
function drawCrack(ctx: CanvasRenderingContext2D, k: Crack, fade: number): void {
  const u = k.age / CRACK_LIFE
  const a = fade * (u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5)
  const n = inward(k.wall)
  ctx.save()
  ctx.translate(k.pos.x, k.pos.y)
  // Local frame: +x into the arena, y along the wall.
  ctx.rotate(dm.atan2(n.y, n.x))
  const size = BALL_RADIUS * (0.9 + 1.3 * k.power)
  // Dent glow.
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.7)
  g.addColorStop(0, `rgba(254,243,199,${0.55 * a})`)
  g.addColorStop(1, 'rgba(245,158,11,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, size * 0.7, -Math.PI / 2, Math.PI / 2)
  ctx.fill()
  ctx.strokeStyle = `rgba(231,229,228,${0.9 * a})`
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  const branches = 5
  for (let i = 0; i < branches; i++) {
    const t = (i + 0.5) / branches
    const ang = -1.25 + 2.5 * t + (((k.seed * 97 + i * 31) % 1) - 0.5) * 0.35
    const len = size * (0.55 + 0.45 * ((k.seed * 53 + i * 17) % 1))
    const jag = (((k.seed * 71 + i * 13) % 1) - 0.5) * 0.5
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(dm.cos(ang + jag) * len * 0.45, dm.sin(ang + jag) * len * 0.45)
    ctx.lineTo(dm.cos(ang - jag * 0.6) * len, dm.sin(ang - jag * 0.6) * len)
    ctx.stroke()
  }
  // Pressed wall edge.
  ctx.strokeStyle = `rgba(253,230,138,${a})`
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(1, -size * 0.6)
  ctx.lineTo(1, size * 0.6)
  ctx.stroke()
  ctx.restore()
}

export function drawSumoPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // The wall on the right, cracked by a slammed victim.
  const wallX = cx + r * 2.35
  ctx.fillStyle = '#292524'
  ctx.fillRect(wallX, cy - r * 3, r * 2, r * 6)
  ctx.strokeStyle = '#fde68a'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(wallX, cy - r * 3)
  ctx.lineTo(wallX, cy + r * 3)
  ctx.stroke()
  const vr = r * 0.5
  const vy = cy - r * 0.75
  drawCrack(ctx, { pos: { x: wallX, y: vy }, wall: 'right', age: 0, power: 0.7, seed: 0.37 }, 1)
  ctx.fillStyle = '#d4d4d8'
  ctx.beginPath()
  ctx.arc(wallX - vr, vy, vr, 0, Math.PI * 2)
  ctx.fill()
  // The wrestler, palm still out.
  const bx = cx - r * 0.75
  const by = cy + r * 0.55
  const br = r * 0.95
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fill()
  drawSumoBody(ctx, bx, by, br, 0)
  const aim = -0.45
  drawPalm(ctx, bx + dm.cos(aim) * br * 1.55, by + dm.sin(aim) * br * 1.55, aim, br * 1.3)
}

export const sumoDef: CharacterDef = {
  id: 'sumo',
  nameEn: 'SUMO',
  ruleValues: {
    shoveCooldown: SHOVE_COOLDOWN,
    slamWindow: SLAM_WINDOW,
    slamMinDamage: SLAM_MIN_DAMAGE,
    slamMaxDamage: SLAM_MAX_DAMAGE,
    stompCooldown: STOMP_COOLDOWN,
    stompDamage: STOMP_DAMAGE,
  },
  palette: { ball: '#f5d0a9', text: '#7c2d12', accent: '#f59e0b' },
  mirrorPalette: { ball: '#b45309', text: '#fff7ed', accent: '#fbbf24' },
  create: (w, b) => new SumoAbility(w, b),
  drawPortrait: drawSumoPortrait,
}
