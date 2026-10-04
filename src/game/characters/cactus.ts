import * as dm from '../core/dmath'
import { type Vec, clamp, cube, distSq, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { BallContact } from '../engine/types'
import type { CharacterDef } from './types'

export const CONTACT_DAMAGE = 3
/** Minimum gap between two body hits on the enemy (s). */
export const CONTACT_COOLDOWN = 0.7
/** A contact hit may trigger a seed burst at most this often (s). */
export const BURST_COOLDOWN = 6.0
/** Without a contact-triggered burst for BURST_COOLDOWN seconds, the cactus bursts on its own. */
const FIRST_AUTO_BURST = 3.0
/** Delay between the triggering contact and the burst (s). */
const BURST_DELAY = 0.25
export const SEEDS = 8
const SEED_MIN_DISTANCE = 120
const SEED_MAX_DISTANCE = 330
const SEED_FLIGHT = 0.5
/** Steepness of the seeds' exponential ease-out. */
const SEED_EASE = 5
const SEED_RADIUS = BALL_RADIUS * 0.15
/** Planted cacti last this long (s). */
export const CACTUS_LIFETIME = 6
export const CACTUS_DAMAGE = 3
/** Per-cactus gap between two hits on the enemy (s). */
export const CACTUS_HIT_COOLDOWN = 0.5
/** A cactus hits when the enemy centre is within enemy.radius + this. */
const CACTUS_REACH = BALL_RADIUS * 0.55
const CACTUS_HEIGHT = BALL_RADIUS * 1.5
const SPROUT_TIME = 0.3
const VANISH_TIME = 0.3

interface Seed {
  from: Vec
  to: Vec
  age: number
}

interface Cactus {
  pos: Vec
  age: number
  /** World time of this cactus's last hit on the enemy. */
  lastHit: number
}

/**
 * 仙人掌 CACTUS — a spiky ball that pricks the enemy on contact. Landing a
 * prick (or simply waiting long enough) makes it burst eight seeds across
 * the arena; each seed grows into a small saguaro that stabs the enemy
 * whenever it brushes past, until the whole batch withers away.
 */
export class CactusAbility extends Ability {
  private contactCooldown = 0
  /** Remaining cooldown before a contact hit can trigger another burst. */
  private burstCooldown = 0
  /** Counts down to the next automatic burst; reset by every burst. */
  private autoTimer = FIRST_AUTO_BURST
  /** Countdown to a scheduled burst, or -1 when none is pending. */
  private pendingBurst = -1
  private seeds: Seed[] = []
  private cacti: Cactus[] = []

  override onBallContact(c: BallContact): void {
    const e = this.enemy
    if (c.other !== e || !this.world.combatActive || this.owner.disarmed) return
    if (this.contactCooldown > 0) return
    this.contactCooldown = CONTACT_COOLDOWN
    const dealt = this.world.damage(e, CONTACT_DAMAGE, { kind: 'thorn', source: this.owner, at: c.point })
    if (dealt > 0 && this.burstCooldown <= 0 && this.pendingBurst < 0) {
      this.burstCooldown = BURST_COOLDOWN
      this.pendingBurst = BURST_DELAY
    }
  }

  override update(dt: number): void {
    this.contactCooldown = Math.max(0, this.contactCooldown - dt)
    this.burstCooldown = Math.max(0, this.burstCooldown - dt)
    if (this.world.combatActive) {
      if (this.pendingBurst >= 0) {
        this.pendingBurst -= dt
        if (this.pendingBurst <= 0) {
          this.pendingBurst = -1
          this.burst()
        }
      } else if (!this.owner.disarmed) {
        this.autoTimer -= dt
        if (this.autoTimer <= 0) this.burst()
      }
    }
    this.updateSeeds(dt)
    this.updateCacti(dt)
  }

  private burst(): void {
    this.autoTimer = BURST_COOLDOWN
    const rng = this.world.rng
    const s = this.world.size
    const margin = BALL_RADIUS * 0.5
    const o = this.owner.pos
    for (let i = 0; i < SEEDS; i++) {
      const a = rng.range(0, Math.PI * 2)
      const d = rng.range(SEED_MIN_DISTANCE, SEED_MAX_DISTANCE)
      this.seeds.push({
        from: { x: o.x, y: o.y },
        to: { x: clamp(o.x + dm.cos(a) * d, margin, s - margin), y: clamp(o.y + dm.sin(a) * d, margin, s - margin) },
        age: 0,
      })
    }
    this.world.effects.burst(o, { count: 12, color: ['#1e8a30', '#4ade80', '#bbf7d0'], speed: [80, 260], size: [2, 4], life: [0.25, 0.5] })
    this.world.sound('throw', 0.55, 0.8)
  }

  private updateSeeds(dt: number): void {
    const kept: Seed[] = []
    for (const sd of this.seeds) {
      sd.age += dt
      if (sd.age < SEED_FLIGHT) {
        kept.push(sd)
        continue
      }
      this.cacti.push({ pos: sd.to, age: 0, lastHit: -Infinity })
      this.world.effects.burst(sd.to, { count: 8, color: ['#ffffff', '#bbf7d0', '#4ade80'], shape: 'spark', speed: [40, 140], size: [1.2, 2.5], life: [0.2, 0.35] })
    }
    if (kept.length < this.seeds.length) this.world.sound('place', 0.35, 1.3)
    this.seeds = kept
  }

  private updateCacti(dt: number): void {
    const now = this.world.time
    const e = this.enemy
    const kept: Cactus[] = []
    for (const c of this.cacti) {
      c.age += dt
      if (c.age >= CACTUS_LIFETIME) continue
      kept.push(c)
      if (!e.alive || now - c.lastHit < CACTUS_HIT_COOLDOWN) continue
      const reach = e.radius + CACTUS_REACH
      if (distSq(e.pos, c.pos) >= reach * reach) continue
      c.lastHit = now
      const dx = e.pos.x - c.pos.x
      const dy = e.pos.y - c.pos.y
      const d = dm.hypot(dx, dy) || 1
      const at = { x: c.pos.x + (dx / d) * CACTUS_REACH, y: c.pos.y + (dy / d) * CACTUS_REACH }
      this.world.damage(e, CACTUS_DAMAGE, { kind: 'thorn', source: this.owner, at })
    }
    this.cacti = kept
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    for (const c of this.cacti) {
      const grow = clamp(c.age / SPROUT_TIME, 0, 1)
      // Ease-out-back so sprouts overshoot slightly.
      const g = 1 + 2.2 * cube(grow - 1) + 1.2 * sq(grow - 1)
      const vanish = clamp((CACTUS_LIFETIME - c.age) / VANISH_TIME, 0, 1)
      ctx.globalAlpha = fade * vanish
      drawSaguaro(ctx, c.pos.x, c.pos.y, CACTUS_HEIGHT * Math.max(0.05, g))
      if (grow < 1) {
        ctx.globalAlpha = fade * (1 - grow) * 0.8
        ctx.strokeStyle = '#ecfccb'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(c.pos.x, c.pos.y, BALL_RADIUS * (0.3 + 0.7 * grow), 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.seeds.length === 0) return
    const norm = 1 - dm.exp(-SEED_EASE)
    ctx.save()
    ctx.globalAlpha = fade
    ctx.fillStyle = '#1e8a30'
    ctx.strokeStyle = '#0f4d1a'
    ctx.lineWidth = 1
    for (const sd of this.seeds) {
      const u = clamp(sd.age / SEED_FLIGHT, 0, 1)
      const k = (1 - dm.exp(-SEED_EASE * u)) / norm
      ctx.beginPath()
      ctx.arc(sd.from.x + (sd.to.x - sd.from.x) * k, sd.from.y + (sd.to.y - sd.from.y) * k, SEED_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawSpines(ctx, o.pos.x, o.pos.y, o.radius)
    drawFlower(ctx, o.pos.x + o.radius * 0.62, o.pos.y - o.radius * 0.62, o.radius * 0.4)
  }
}

/** Small white "v" marks around the rim, pointing outward. */
function drawSpines(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = Math.max(1, r * 0.045)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const s = r * 0.12
  ctx.beginPath()
  for (const a of [2.35, 3.3, 4.1, 0.25, 1.15, 1.8]) {
    const px = cx + dm.cos(a) * r * 0.78
    const py = cy + dm.sin(a) * r * 0.78
    const ox = dm.cos(a)
    const oy = dm.sin(a)
    // "v" opening towards the centre, tip on the outside.
    ctx.moveTo(px - ox * s - oy * s * 0.7, py - oy * s + ox * s * 0.7)
    ctx.lineTo(px, py)
    ctx.lineTo(px - ox * s + oy * s * 0.7, py - oy * s - ox * s * 0.7)
  }
  ctx.stroke()
  ctx.restore()
}

function drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save()
  ctx.fillStyle = '#f472b6'
  ctx.strokeStyle = '#be185d'
  ctx.lineWidth = Math.max(0.8, size * 0.06)
  const pr = size * 0.3
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(x + dm.cos(a) * size * 0.27, y + dm.sin(a) * size * 0.27, pr, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.fillStyle = '#fde047'
  ctx.beginPath()
  ctx.arc(x, y, size * 0.17, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** A cartoon saguaro (body + two arms), `h` tall and 0.6·h wide, centred on (x, y). */
export function drawSaguaro(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  const w = h * 0.24
  const top = y - h / 2
  const bottom = y + h / 2
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const shape = () => {
    ctx.beginPath()
    // Trunk.
    ctx.moveTo(x, bottom - w / 2)
    ctx.lineTo(x, top + w / 2)
    // Left arm: out, then up.
    ctx.moveTo(x, y + h * 0.08)
    ctx.lineTo(x - h * 0.18, y + h * 0.08)
    ctx.lineTo(x - h * 0.18, y - h * 0.2)
    // Right arm, a little higher.
    ctx.moveTo(x, y - h * 0.06)
    ctx.lineTo(x + h * 0.18, y - h * 0.06)
    ctx.lineTo(x + h * 0.18, y - h * 0.3)
  }
  // Dark outline, then the body, then a lighter stripe.
  shape()
  ctx.strokeStyle = '#14532d'
  ctx.lineWidth = w + Math.max(2, h * 0.05)
  ctx.stroke()
  ctx.strokeStyle = '#3fa34d'
  ctx.lineWidth = w
  ctx.stroke()
  ctx.strokeStyle = 'rgba(190,242,100,0.45)'
  ctx.lineWidth = w * 0.22
  ctx.beginPath()
  ctx.moveTo(x - w * 0.15, bottom - w / 2)
  ctx.lineTo(x - w * 0.15, top + w / 2)
  ctx.stroke()
  // Tiny spine dots.
  ctx.fillStyle = '#ffffff'
  const dot = Math.max(0.8, h * 0.022)
  const spots: readonly (readonly [number, number])[] = [
    [0.12, -0.38], [-0.12, -0.2], [0.12, 0.02], [-0.12, 0.22], [0.12, 0.36],
    [-0.21, -0.14], [-0.15, 0.0], [0.15, -0.24], [0.21, -0.12],
  ]
  for (const [sx, sy] of spots) {
    ctx.beginPath()
    ctx.arc(x + sx * h, y + sy * h, dot, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawCactusPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawSaguaro(ctx, cx + r * 1.55, cy - r * 1.05, r * 1.5)
  drawSaguaro(ctx, cx - r * 1.6, cy - r * 1.35, r * 1.2)
  drawSaguaro(ctx, cx + r * 1.7, cy + r * 1.35, r * 1.1)
  const bx = cx - r * 0.2
  const by = cy + r * 0.5
  const br = r * 0.9
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fill()
  drawSpines(ctx, bx, by, br)
  drawFlower(ctx, bx + br * 0.62, by - br * 0.62, br * 0.4)
}

export const cactusDef: CharacterDef = {
  id: 'cactus',
  nameEn: 'CACTUS',
  ruleValues: { contactDamage: CONTACT_DAMAGE, contactCooldown: CONTACT_COOLDOWN, seeds: SEEDS, burstCooldown: BURST_COOLDOWN, cactusDamage: CACTUS_DAMAGE, cactusHitCooldown: CACTUS_HIT_COOLDOWN, cactusLifetime: CACTUS_LIFETIME },
  palette: { ball: '#619242', text: '#ffffff', accent: '#609040' },
  mirrorPalette: { ball: '#3f6212', text: '#ecfccb', accent: '#84cc16' },
  create: (w, b) => new CactusAbility(w, b),
  drawPortrait: drawCactusPortrait,
}
