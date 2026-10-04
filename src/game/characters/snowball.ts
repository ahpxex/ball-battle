import * as dm from '../core/dmath'
import { clamp, lerp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS, BASE_SPEED } from '../engine/constants'
import type { BallContact, DamageOptions } from '../engine/types'
import type { CharacterDef } from './types'

/** Size at the start of the fight (× normal ball radius); also the smallest it can shrink to. */
export const START_SCALE = 0.7
/** Largest size (× normal ball radius). */
export const MAX_SCALE = 1.8
/** Size gained per unit of distance rolled (× normal radius). */
const GROWTH_PER_UNIT = 0.0004
/** Size lost per point of damage taken (× normal radius). */
export const SHRINK_PER_DAMAGE = 0.03
/** Ram damage at the smallest and at the largest size. */
export const MIN_RAM_DAMAGE = 4
export const MAX_RAM_DAMAGE = 22
/** Minimum gap between two rams on the enemy (s). */
export const RAM_COOLDOWN = 0.5
/** Retry delay after a ram was blocked (invulnerable target) (s). */
const BLOCKED_RETRY = 0.2
const MIN_KNOCK = 120
const MAX_KNOCK = 420

/** Snow track left on the ground (cosmetic). */
const TRACK_LIFE = 1.1
const TRACK_SPACING = 0.04

interface TrackSample {
  x: number
  y: number
  r: number
  t: number
}

/** A mark painted on the snowball's surface (a point on the unit sphere). */
interface SurfaceMark {
  x: number
  y: number
  z: number
  /** Size relative to the ball radius. */
  size: number
  kind: 'clump' | 'speck'
}

/** Evenly spread marks (Fibonacci sphere), deterministic and shared by every snowball. */
const MARKS: readonly SurfaceMark[] = (() => {
  const n = 46
  const golden = Math.PI * (3 - Math.sqrt(5))
  const out: SurfaceMark[] = []
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n
    const rr = Math.sqrt(1 - z * z)
    const a = i * golden
    const clump = i % 3 !== 1
    out.push({
      x: dm.cos(a) * rr,
      y: dm.sin(a) * rr,
      z,
      size: clump ? 0.16 + ((i * 7) % 5) * 0.025 : 0.05 + ((i * 3) % 4) * 0.012,
      kind: clump ? 'clump' : 'speck',
    })
  }
  return out
})()

/** Rotation matrix (row-major 3×3) of the rolling ball; identity at rest. */
type Mat3 = [number, number, number, number, number, number, number, number, number]

/**
 * 雪球 SNOWBALL — starts small and gathers snow as it rolls, up to almost
 * twice the normal size. Ramming the enemy hurts more the bigger it is, but
 * every hit it takes knocks snow off and shrinks it again: a race between
 * growing and being whittled down.
 */
export class SnowballAbility extends Ability {
  /** Current size (× normal ball radius). */
  private scale = START_SCALE
  private nextRam = 0
  private wasMax = false
  /** Cosmetic: orientation of the rolling surface texture. */
  private rot: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  private track: TrackSample[] = []
  private trackTimer = 0
  private orthoCounter = 0

  constructor(...args: ConstructorParameters<typeof Ability>) {
    super(...args)
    this.applySize()
  }

  /** 0 at the smallest size, 1 at the largest. */
  private get growth(): number {
    return (this.scale - START_SCALE) / (MAX_SCALE - START_SCALE)
  }

  private applySize(): void {
    const o = this.owner
    o.radius = BALL_RADIUS * this.scale
    // Mass grows with the area of the (flat) ball.
    o.mass = this.scale * this.scale
    const s = this.world.size
    o.pos.x = clamp(o.pos.x, o.radius, s - o.radius)
    o.pos.y = clamp(o.pos.y, o.radius, s - o.radius)
  }

  override update(dt: number): void {
    const o = this.owner
    const speed = dm.hypot(o.vel.x, o.vel.y)
    // Only rolling under its own power gathers snow (not while dragged, held or frozen in place).
    const rolling = this.world.combatActive && o.movable && o.attachedTo === null
    if (rolling && this.scale < MAX_SCALE) {
      this.scale = Math.min(MAX_SCALE, this.scale + speed * dt * GROWTH_PER_UNIT)
      this.applySize()
      if (this.scale >= MAX_SCALE && !this.wasMax) this.reachedMax()
    }
    if (this.scale < MAX_SCALE) this.wasMax = false
    if (rolling) this.roll(dt, speed)
  }

  private reachedMax(): void {
    this.wasMax = true
    const o = this.owner
    this.world.effects.burst(o.pos, { count: 1, color: '#e0f2fe', shape: 'ring', speed: [0, 0], size: [o.radius, o.radius], life: [0.45, 0.45], endScale: 1.6 })
    this.world.effects.burst(o.pos, {
      count: 14,
      color: ['#ffffff', '#e0f2fe', '#7dd3fc'],
      shape: 'spark',
      speed: [100, 260],
      size: [1.5, 3],
      life: [0.25, 0.5],
      jitter: o.radius * 0.6,
    })
    this.world.sound('place', 0.5, 0.7)
  }

  /** Cosmetic: spins the surface texture and lays the snow track. */
  private roll(dt: number, speed: number): void {
    if (this.world.headless) return
    const o = this.owner
    if (speed > 1e-6) {
      // Rolling on the ground seen from above: rotation axis is horizontal, perpendicular to the motion.
      const angle = (speed * dt) / o.radius
      const nx = -o.vel.y / speed
      const ny = o.vel.x / speed
      this.rotate(nx, ny, angle)
    }
    this.trackTimer -= dt
    if (this.trackTimer <= 0) {
      this.trackTimer = TRACK_SPACING
      this.track.push({ x: o.pos.x, y: o.pos.y, r: o.radius, t: this.world.time })
    }
    const now = this.world.time
    while (this.track.length > 0 && now - this.track[0].t > TRACK_LIFE) this.track.shift()
  }

  /** Pre-multiplies the texture rotation by a rotation of `angle` about the horizontal axis (nx, ny, 0). */
  private rotate(nx: number, ny: number, angle: number): void {
    const c = dm.cos(angle)
    const s = dm.sin(angle)
    const t = 1 - c
    // Rodrigues with nz = 0.
    const r00 = c + t * nx * nx
    const r01 = t * nx * ny
    const r02 = s * ny
    const r10 = t * nx * ny
    const r11 = c + t * ny * ny
    const r12 = -s * nx
    const r20 = -s * ny
    const r21 = s * nx
    const r22 = c
    const m = this.rot
    const out: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    for (let j = 0; j < 3; j++) {
      const a = m[j]
      const b = m[3 + j]
      const d = m[6 + j]
      out[j] = r00 * a + r01 * b + r02 * d
      out[3 + j] = r10 * a + r11 * b + r12 * d
      out[6 + j] = r20 * a + r21 * b + r22 * d
    }
    this.rot = out
    if (++this.orthoCounter >= 60) {
      this.orthoCounter = 0
      this.rot = orthonormalize(this.rot)
    }
  }

  override onBallContact(c: BallContact): void {
    const now = this.world.time
    if (c.other !== this.enemy || !this.world.combatActive || this.owner.disarmed || now < this.nextRam) return
    const g = this.growth
    const knock = lerp(MIN_KNOCK, MAX_KNOCK, g)
    const dealt = this.world.damage(c.other, Math.round(lerp(MIN_RAM_DAMAGE, MAX_RAM_DAMAGE, g)), {
      kind: 'snowRoll',
      source: this.owner,
      at: c.point,
      knock: { x: c.normal.x * knock, y: c.normal.y * knock },
      shake: 1 + 4 * g,
    })
    this.nextRam = now + (dealt > 0 ? RAM_COOLDOWN : BLOCKED_RETRY)
    if (dealt <= 0) return
    this.world.effects.burst(c.point, {
      count: 4 + Math.round(10 * g),
      color: ['#ffffff', '#f0f9ff', '#e0f2fe'],
      shape: 'smoke',
      speed: [30, 120 + 120 * g],
      size: [4, 7 + 6 * g],
      life: [0.35, 0.8],
      endScale: 2,
      drag: 2.5,
    })
  }

  override onOwnerDamaged(amount: number, opts: DamageOptions): void {
    const before = this.scale
    this.scale = Math.max(START_SCALE, this.scale - amount * SHRINK_PER_DAMAGE)
    this.applySize()
    const lost = before - this.scale
    if (lost <= 0) return
    // Snow knocked off, flying away from the hit.
    const o = this.owner
    const at = opts.at ?? o.pos
    let dir = this.world.effects.random() * Math.PI * 2
    if (opts.at) dir = dm.atan2(o.pos.y - at.y, o.pos.x - at.x) + Math.PI
    const chunks = Math.min(26, 3 + Math.round(lost * 90))
    this.world.effects.burst(at, {
      count: chunks,
      color: ['#ffffff', '#f0f9ff', '#dbeafe'],
      speed: [90, 260],
      direction: dir,
      spread: 1.4,
      size: [2.5, 5.5],
      life: [0.4, 0.8],
      gravity: 380,
      drag: 1.6,
    })
    this.world.effects.burst(at, {
      count: Math.ceil(chunks / 3),
      color: ['#bae6fd', '#e0f2fe'],
      shape: 'shard',
      speed: [120, 300],
      direction: dir,
      spread: 1.2,
      size: [2, 4],
      life: [0.3, 0.6],
      gravity: 300,
    })
    this.world.effects.burst(at, { count: 3, color: '#ffffff', shape: 'smoke', speed: [20, 70], size: [6, 10], life: [0.4, 0.7], endScale: 1.8 })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.track.length < 2) return
    const now = this.world.time
    const track = this.track
    ctx.save()
    ctx.lineCap = 'butt'
    // One butt-capped segment at a time: the alpha fades smoothly along the track and no caps overlap.
    for (let i = 1; i < track.length; i++) {
      const p = track[i - 1]
      const q = track[i]
      // Skip jumps (teleports, being flung) so the track doesn't cut across the arena.
      if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > 60) continue
      const life = 1 - (now - q.t) / TRACK_LIFE
      if (life <= 0) continue
      ctx.strokeStyle = `rgba(226,240,252,${0.13 * life * fade})`
      ctx.lineWidth = q.r * 0.9
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawSnowRim(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, this.rot, o.color)
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawSnowSurface(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, this.rot)
  }
}

/** Re-orthonormalizes the rows of a rotation matrix (Gram–Schmidt) against drift. */
function orthonormalize(m: Mat3): Mat3 {
  let ax = m[0],
    ay = m[1],
    az = m[2]
  let l = Math.sqrt(ax * ax + ay * ay + az * az) || 1
  ax /= l
  ay /= l
  az /= l
  let bx = m[3],
    by = m[4],
    bz = m[5]
  const d = ax * bx + ay * by + az * bz
  bx -= d * ax
  by -= d * ay
  bz -= d * az
  l = Math.sqrt(bx * bx + by * by + bz * bz) || 1
  bx /= l
  by /= l
  bz /= l
  return [ax, ay, az, bx, by, bz, ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
}

/** Lumps of packed snow poking out of the outline where clumps roll over the edge. */
function drawSnowRim(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, m: Mat3, color: string): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = 'rgba(125,170,205,0.55)'
  ctx.lineWidth = Math.max(0.8, r * 0.035)
  for (const p of MARKS) {
    if (p.kind !== 'clump') continue
    const z = m[6] * p.x + m[7] * p.y + m[8] * p.z
    if (Math.abs(z) > 0.32) continue
    const x = m[0] * p.x + m[1] * p.y + m[2] * p.z
    const y = m[3] * p.x + m[4] * p.y + m[5] * p.z
    const h = Math.sqrt(x * x + y * y) || 1
    const bump = r * p.size * 0.75 * (1 - Math.abs(z) / 0.32)
    ctx.beginPath()
    ctx.arc(cx + (x / h) * r * 0.97, cy + (y / h) * r * 0.97, bump, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/** Shading plus the rolling clumps and specks on the visible hemisphere. */
function drawSnowSurface(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, m: Mat3): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  const shade = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05)
  shade.addColorStop(0, 'rgba(255,255,255,0.55)')
  shade.addColorStop(0.6, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(56,120,170,0.38)')
  ctx.fillStyle = shade
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  for (const p of MARKS) {
    const z = m[6] * p.x + m[7] * p.y + m[8] * p.z
    if (z <= 0.05) continue
    const x = m[0] * p.x + m[1] * p.y + m[2] * p.z
    const y = m[3] * p.x + m[4] * p.y + m[5] * p.z
    const px = cx + x * r
    const py = cy + y * r
    const s = r * p.size
    const rot = dm.atan2(y, x)
    const alpha = clamp(z * 2.2, 0, 1)
    if (p.kind === 'clump') {
      // A soft clump: bluish shadow on the lower-right, bright cap on the upper-left.
      ctx.fillStyle = `rgba(125,170,215,${0.22 * alpha})`
      ctx.beginPath()
      ctx.ellipse(px + s * 0.16, py + s * 0.18, s * (0.35 + 0.65 * z), s, rot, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.beginPath()
      ctx.ellipse(px - s * 0.06, py - s * 0.08, s * (0.3 + 0.55 * z) * 0.9, s * 0.9, rot, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = `rgba(100,140,180,${0.55 * alpha})`
      ctx.beginPath()
      ctx.ellipse(px, py, s * (0.35 + 0.65 * z), s, rot, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

export function drawSnowballPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // The track it rolled, widening from a small start in the lower left.
  const x = cx + r * 0.35
  const y = cy - r * 0.25
  const br = r * 1.1
  ctx.save()
  ctx.lineCap = 'round'
  const steps = 14
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps
    const t1 = (i + 1) / steps
    const px = (t: number) => cx - r * 2.3 + (x - (cx - r * 2.3)) * t
    const py = (t: number) => cy + r * 2.1 + (y - (cy + r * 2.1)) * t - dm.sin(t * Math.PI) * r * 0.5
    ctx.strokeStyle = `rgba(240,249,255,${0.15 + 0.35 * t1})`
    ctx.lineWidth = br * (0.35 + 0.75 * t1)
    ctx.beginPath()
    ctx.moveTo(px(t0), py(t0))
    ctx.lineTo(px(t1), py(t1))
    ctx.stroke()
  }
  ctx.restore()
  // A few loose clumps flying off.
  ctx.fillStyle = '#ffffff'
  const bits: readonly (readonly [number, number, number])[] = [
    [1.75, -1.25, 0.1],
    [2.05, -0.7, 0.07],
    [1.5, -1.75, 0.06],
  ]
  for (const [bx, by, bs] of bits) {
    ctx.beginPath()
    ctx.arc(cx + bx * r, cy + by * r, bs * r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tilt: Mat3 = orthonormalize([0.9, -0.3, 0.3, 0.35, 0.9, -0.25, -0.2, 0.3, 0.93])
  drawSnowRim(ctx, x, y, br, tilt, color)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  drawSnowSurface(ctx, x, y, br, tilt)
}

const pct = (v: number): number => Math.round(v * 100)

export const snowballDef: CharacterDef = {
  id: 'snowball',
  nameEn: 'SNOWBALL',
  ruleValues: {
    startSize: pct(START_SCALE),
    maxSize: pct(MAX_SCALE),
    // Seconds of rolling at cruise speed from the smallest to the largest size.
    growTime: Math.round((MAX_SCALE - START_SCALE) / (GROWTH_PER_UNIT * BASE_SPEED)),
    minDamage: MIN_RAM_DAMAGE,
    maxDamage: MAX_RAM_DAMAGE,
    ramCooldown: RAM_COOLDOWN,
    shrinkPerDamage: pct(SHRINK_PER_DAMAGE),
  },
  palette: { ball: '#e0f2fe', text: '#0c4a6e', accent: '#bae6fd' },
  mirrorPalette: { ball: '#7dd3fc', text: '#082f49', accent: '#38bdf8' },
  create: (w, b) => new SnowballAbility(w, b),
  drawPortrait: drawSnowballPortrait,
}
