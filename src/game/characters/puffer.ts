import * as dm from '../core/dmath'
import { clamp, cube, damp, lerpAngle, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

/** Seconds from the start of one puff to the start of the next (while nothing blocks it). */
export const PUFF_PERIOD = 4.5
/** First puff after the fight starts (s). */
const FIRST_PUFF = 1.6
/** Time to blow up to full size (s). */
const INFLATE_TIME = 0.22
/** Time held at full size (s). */
export const HOLD_TIME = 1.8
/** Time to let the air out again (s). */
export const DEFLATE_TIME = 1.2
/** Radius multiplier when fully puffed. */
export const PUFF_SCALE = 2.0
/** Mass multiplier when fully puffed. */
export const PUFF_MASS = 3
export const SPIKE_DAMAGE = 17
/** Minimum gap between two spike hits on the enemy (s). */
export const HIT_COOLDOWN = 0.6
/** Retry delay after a hit was blocked (invulnerable target) (s). */
const BLOCKED_RETRY = 0.2
const SPIKE_KNOCK = 520
/** Spikes hurt while the puff is at least this far along (0 = normal size, 1 = fully puffed). */
const SPIKE_ACTIVE = 0.5
/** Spike tips reach this far beyond the body (× current radius) when fully puffed. */
const SPIKE_LENGTH = 0.26
const SPIKE_COUNT = 22
/** Overshoot of the inflate "pop" (ease-out-back constant). */
const POP_OVERSHOOT = 1.4

type Phase = 'calm' | 'inflate' | 'hold' | 'deflate'

const easeOutBack = (u: number): number => 1 + (POP_OVERSHOOT + 1) * cube(u - 1) + POP_OVERSHOOT * sq(u - 1)
const smoothstep = (u: number): number => u * u * (3 - 2 * u)

/**
 * 河豚 PUFFERFISH — swims around harmlessly, then every few seconds gulps
 * water and pops up to twice its size, bristling with spikes. While puffed
 * it is heavier and every touch spikes the enemy and flings it away; after
 * a short hold it slowly lets the air out again.
 */
export class PufferAbility extends Ability {
  private phase: Phase = 'calm'
  private timer = FIRST_PUFF
  /** Current radius multiplier. */
  private scale = 1
  /** World time before which the spikes can't hit again. */
  private nextHit = 0
  /** Cosmetic: smoothed swimming direction. */
  private facing = 0
  /** Cosmetic: fin flapping phase. */
  private flap = 0
  /** Cosmetic: world time of the last spike hit (spikes flash). */
  private lastHitAt = -Infinity

  /** 0 at normal size, 1 when fully puffed (slightly above during the pop). */
  private get puff(): number {
    return (this.scale - 1) / (PUFF_SCALE - 1)
  }

  /** Whether the owner is being held by something and can't start a puff. */
  private get held(): boolean {
    const o = this.owner
    return o.pinned || o.attachedTo !== null || o.rooted
  }

  override prePhysics(dt: number): void {
    const o = this.owner
    this.timer -= dt
    switch (this.phase) {
      case 'calm':
        // The countdown waits while puffing is impossible; it fires as soon as it's allowed again.
        if (!this.world.combatActive) this.timer = Math.max(this.timer, FIRST_PUFF)
        if (this.timer <= 0 && !o.disarmed && !this.held) this.startPuff()
        else if (this.timer < 0) this.timer = 0
        break
      case 'inflate':
        if (this.timer <= 0) {
          this.phase = 'hold'
          this.timer += HOLD_TIME
        }
        break
      case 'hold':
        if (this.timer <= 0) {
          this.phase = 'deflate'
          this.timer += DEFLATE_TIME
          this.world.sound('whoosh', 0.35, 1.6)
        }
        break
      case 'deflate':
        if (this.timer <= 0) {
          this.phase = 'calm'
          this.timer += PUFF_PERIOD - INFLATE_TIME - HOLD_TIME - DEFLATE_TIME
        }
        break
    }
    this.applySize()
  }

  private startPuff(): void {
    const o = this.owner
    this.phase = 'inflate'
    this.timer = INFLATE_TIME
    const e = this.world.effects
    e.burst(o.pos, { count: 1, color: '#fff7d6', shape: 'ring', speed: [0, 0], size: [o.radius, o.radius], life: [0.35, 0.35], endScale: PUFF_SCALE + 0.6 })
    e.burst(o.pos, { count: 14, color: ['#e0f2fe', '#ffffff', '#bae6fd'], speed: [140, 320], size: [1.5, 3.5], life: [0.25, 0.5], jitter: o.radius * 0.5 })
    this.world.sound('whoosh', 0.7, 0.55)
    this.world.sound('spike', 0.45, 0.8)
  }

  /** Sets radius and mass from the puff phase and keeps the grown ball inside the arena. */
  private applySize(): void {
    const o = this.owner
    let s = 1
    if (this.phase === 'inflate') s = 1 + (PUFF_SCALE - 1) * easeOutBack(clamp(1 - this.timer / INFLATE_TIME, 0, 1))
    else if (this.phase === 'hold') s = PUFF_SCALE
    else if (this.phase === 'deflate') s = PUFF_SCALE - (PUFF_SCALE - 1) * smoothstep(clamp(1 - this.timer / DEFLATE_TIME, 0, 1))
    this.scale = s
    o.radius = BALL_RADIUS * s
    o.mass = 1 + (PUFF_MASS - 1) * clamp(this.puff, 0, 1)
    const size = this.world.size
    o.pos.x = clamp(o.pos.x, o.radius, size - o.radius)
    o.pos.y = clamp(o.pos.y, o.radius, size - o.radius)
  }

  override update(dt: number): void {
    const o = this.owner
    // Cosmetic swimming direction and fin flapping.
    if (o.vel.x !== 0 || o.vel.y !== 0) this.facing = lerpAngle(this.facing, dm.atan2(o.vel.y, o.vel.x), damp(7, dt))
    this.flap += dt * (this.phase === 'calm' ? 14 : 26)
    if (this.phase === 'deflate') this.bubbles()
    this.spikeEnemy()
  }

  /** Spikes hurt on touch, even while something holds either ball (the pair may not collide then). */
  private spikeEnemy(): void {
    const o = this.owner
    const e = this.enemy
    const now = this.world.time
    if (!this.world.combatActive || !e.alive || o.disarmed || now < this.nextHit) return
    if (this.puff < SPIKE_ACTIVE) return
    const dx = e.pos.x - o.pos.x
    const dy = e.pos.y - o.pos.y
    const reach = o.radius * (1 + SPIKE_LENGTH * 0.6) + e.radius
    if (dx * dx + dy * dy > reach * reach) return
    const d = dm.hypot(dx, dy)
    // Concentric balls (e.g. swallowed): push along the swimming direction.
    const nx = d > 1e-6 ? dx / d : dm.cos(this.facing)
    const ny = d > 1e-6 ? dy / d : dm.sin(this.facing)
    const at = { x: o.pos.x + nx * o.radius, y: o.pos.y + ny * o.radius }
    const dealt = this.world.damage(e, SPIKE_DAMAGE, {
      kind: 'puffer',
      source: o,
      at,
      knock: { x: nx * SPIKE_KNOCK, y: ny * SPIKE_KNOCK },
      shake: 3,
    })
    this.nextHit = now + (dealt > 0 ? HIT_COOLDOWN : BLOCKED_RETRY)
    if (dealt <= 0) return
    this.lastHitAt = now
    this.world.effects.burst(at, {
      count: 8,
      color: ['#fff3c4', '#f6d365', '#ffffff'],
      shape: 'shard',
      direction: dm.atan2(ny, nx),
      spread: 0.9,
      speed: [160, 380],
      size: [2, 4],
      life: [0.2, 0.45],
    })
  }

  /** Cosmetic air bubbles escaping from the mouth while deflating. */
  private bubbles(): void {
    const fx = this.world.effects
    if (!fx.enabled || fx.random() > 0.25) return
    const o = this.owner
    const mouth = { x: o.pos.x + dm.cos(this.facing) * o.radius, y: o.pos.y + dm.sin(this.facing) * o.radius }
    fx.burst(mouth, {
      count: 1,
      color: ['#e0f2fe', '#ffffff'],
      shape: 'ring',
      speed: [30, 90],
      direction: this.facing,
      spread: 0.6,
      size: [2, 4.5],
      life: [0.4, 0.7],
      endScale: 1.6,
      front: false,
    })
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const fade = this.presence
    if (fade <= 0) return
    const r = o.radius * o.drawScale
    const p = clamp(this.puff, 0, 1.15)
    const armed = !o.disarmed
    const flash = clamp(1 - (this.world.time - this.lastHitAt) / 0.25, 0, 1)
    ctx.save()
    ctx.globalAlpha *= fade
    drawFins(ctx, o.pos.x, o.pos.y, r / (1 + 0.45 * p), r, this.facing, this.flap, p)
    // Disarmed: the spikes lie flat and turn dull.
    const len = armed ? 0.06 + (SPIKE_LENGTH - 0.06) * p : 0.06 + 0.04 * p
    drawSpikes(ctx, o.pos.x, o.pos.y, r, this.facing, len, armed ? flash : 0, armed)
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const r = o.radius * o.drawScale
    drawPufferBody(ctx, o.pos.x, o.pos.y, r, this.facing, clamp(this.puff, 0, 1.15))
  }
}

/** Tail fin behind and two small pectoral fins; `size` is the un-puffed body radius, `r` the current one. */
function drawFins(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, r: number, facing: number, flap: number, puff: number): void {
  const back = facing + Math.PI
  const cos = dm.cos(back)
  const sin = dm.sin(back)
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.fillStyle = '#e8a93a'
  ctx.strokeStyle = '#8a5a12'
  ctx.lineWidth = Math.max(1, size * 0.05)
  // Tail: a fan with a notch, wagging sideways.
  const wag = dm.sin(flap * 0.7) * 0.25
  const base = r * 0.82
  const tl = size * (0.75 - 0.15 * puff)
  const tw = size * 0.55
  const ta = back + wag
  const tx = cx + cos * base
  const ty = cy + sin * base
  const ux = dm.cos(ta)
  const uy = dm.sin(ta)
  ctx.beginPath()
  ctx.moveTo(tx - uy * size * 0.12, ty + ux * size * 0.12)
  ctx.lineTo(tx + ux * tl - uy * tw, ty + uy * tl + ux * tw)
  ctx.quadraticCurveTo(tx + ux * tl * 0.7, ty + uy * tl * 0.7, tx + ux * tl + uy * tw, ty + uy * tl - ux * tw)
  ctx.lineTo(tx + uy * size * 0.12, ty - ux * size * 0.12)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Pectoral fins, flapping.
  for (const side of [-1, 1]) {
    const a = facing + side * (1.75 + dm.sin(flap + side) * 0.18)
    const fx = cx + dm.cos(a) * r * 0.9
    const fy = cy + dm.sin(a) * r * 0.9
    const fa = a + side * 0.6
    const fl = size * 0.42
    ctx.beginPath()
    ctx.ellipse(fx + dm.cos(fa) * fl * 0.4, fy + dm.sin(fa) * fl * 0.4, fl * 0.55, fl * 0.28, fa, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Ring of spikes around a body of radius `r`; `len` is the tip length as a
 * fraction of `r`, `flash` (0..1) whitens them after a hit.
 */
function drawSpikes(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number, len: number, flash: number, sharp: boolean): void {
  const tip = r * (1 + len)
  const base = r * 0.93
  const half = (Math.PI / SPIKE_COUNT) * (sharp ? 0.42 : 0.55)
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < SPIKE_COUNT; i++) {
    const a = rot + ((i + 0.5) / SPIKE_COUNT) * Math.PI * 2
    ctx.moveTo(cx + dm.cos(a - half) * base, cy + dm.sin(a - half) * base)
    ctx.lineTo(cx + dm.cos(a) * tip, cy + dm.sin(a) * tip)
    ctx.lineTo(cx + dm.cos(a + half) * base, cy + dm.sin(a + half) * base)
    ctx.closePath()
  }
  const c = (v: number) => Math.round(v + (255 - v) * flash)
  ctx.fillStyle = sharp ? `rgb(${c(255)},${c(243)},${c(196)})` : '#c9b98a'
  ctx.fill()
  ctx.strokeStyle = sharp ? '#8a5a12' : '#7c6f4f'
  ctx.lineWidth = Math.max(0.8, r * 0.025)
  ctx.stroke()
  ctx.restore()
}

/** Shading, spots, pale belly, eyes and mouth over the plain ball fill. */
function drawPufferBody(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, facing: number, puff: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  // Pale belly towards the front, darker back.
  const fx = dm.cos(facing)
  const fy = dm.sin(facing)
  const g = ctx.createLinearGradient(cx - fx * r, cy - fy * r, cx + fx * r, cy + fy * r)
  g.addColorStop(0, 'rgba(138,90,18,0.35)')
  g.addColorStop(0.55, 'rgba(255,255,255,0)')
  g.addColorStop(1, 'rgba(255,250,225,0.45)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  // Brown spots on the back half; they spread apart as the body stretches.
  ctx.fillStyle = 'rgba(122,79,14,0.55)'
  const spots: readonly (readonly [number, number, number])[] = [
    [2.6, 0.72, 0.09],
    [3.3, 0.55, 0.075],
    [3.9, 0.74, 0.085],
    [2.2, 0.45, 0.06],
    [4.4, 0.45, 0.065],
    [3.0, 0.86, 0.06],
    [3.6, 0.88, 0.055],
  ]
  for (const [a, d, s] of spots) {
    const sa = facing + a
    ctx.beginPath()
    ctx.arc(cx + dm.cos(sa) * r * d, cy + dm.sin(sa) * r * d, r * s * (1 - 0.25 * puff), 0, Math.PI * 2)
    ctx.fill()
  }
  // Soft highlight.
  const hl = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx - r * 0.35, cy - r * 0.4, r * 0.7)
  hl.addColorStop(0, 'rgba(255,255,255,0.35)')
  hl.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hl
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.restore()

  // Eyes sit on the rim either side of the snout; they stay the same size, so a puffed body dwarfs them.
  const size = r / (1 + 0.45 * puff)
  const er = size * 0.2
  for (const side of [-1, 1]) {
    const a = facing + side * (0.62 - 0.12 * puff)
    const ex = cx + dm.cos(a) * r * 0.8
    const ey = cy + dm.sin(a) * r * 0.8
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#7a4f0e'
    ctx.lineWidth = Math.max(1, size * 0.04)
    ctx.beginPath()
    ctx.arc(ex, ey, er, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#111111'
    ctx.beginPath()
    ctx.arc(ex + fx * er * 0.3, ey + fy * er * 0.3, er * (0.55 - 0.15 * Math.min(1, puff)), 0, Math.PI * 2)
    ctx.fill()
    // Angry brow while puffed.
    if (puff > 0.3) {
      const bx = ex - dm.cos(a) * er * 1.25
      const by = ey - dm.sin(a) * er * 1.25
      const ta = a + (side * Math.PI) / 2
      ctx.strokeStyle = `rgba(80,50,8,${clamp((puff - 0.3) * 2, 0, 1)})`
      ctx.lineWidth = Math.max(1.2, size * 0.07)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(bx - dm.cos(ta) * er + fx * er * 0.4, by - dm.sin(ta) * er + fy * er * 0.4)
      ctx.lineTo(bx + dm.cos(ta) * er * 0.6 - fx * er * 0.2, by + dm.sin(ta) * er * 0.6 - fy * er * 0.2)
      ctx.stroke()
    }
  }
  // Little round mouth at the snout: an "o" when puffed, a small pout otherwise.
  const mx = cx + fx * r * 0.95
  const my = cy + fy * r * 0.95
  ctx.fillStyle = '#e8737a'
  ctx.strokeStyle = '#7a2e33'
  ctx.lineWidth = Math.max(1, size * 0.04)
  ctx.beginPath()
  ctx.ellipse(mx, my, size * (0.09 + 0.04 * puff), size * (0.13 + 0.05 * puff), facing, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

export function drawPufferPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const facing = -0.35
  const br = r * 1.15
  const x = cx - r * 0.1
  const y = cy + r * 0.1
  // A few bubbles drifting from the mouth.
  ctx.save()
  ctx.strokeStyle = 'rgba(224,242,254,0.9)'
  ctx.lineWidth = 1.5
  const bubbles: readonly (readonly [number, number, number])[] = [
    [1.75, -0.95, 0.12],
    [2.1, -1.45, 0.08],
    [1.6, -1.75, 0.06],
  ]
  for (const [bx, by, bs] of bubbles) {
    ctx.beginPath()
    ctx.arc(cx + bx * r, cy + by * r, bs * r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
  drawFins(ctx, x, y, r * 0.8, br, facing, 0.6, 1)
  drawSpikes(ctx, x, y, br, facing, SPIKE_LENGTH, 0, true)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  drawPufferBody(ctx, x, y, br, facing, 1)
}

export const pufferDef: CharacterDef = {
  id: 'puffer',
  nameEn: 'PUFFERFISH',
  ruleValues: {
    puffPeriod: PUFF_PERIOD,
    puffScale: PUFF_SCALE,
    spikeDamage: SPIKE_DAMAGE,
    hitCooldown: HIT_COOLDOWN,
    holdTime: HOLD_TIME,
    deflateTime: DEFLATE_TIME,
    puffMass: PUFF_MASS,
  },
  palette: { ball: '#f2c94c', text: '#3b2f00', accent: '#f6d365' },
  mirrorPalette: { ball: '#a16207', text: '#fef9c3', accent: '#facc15' },
  create: (w, b) => new PufferAbility(w, b),
  drawPortrait: drawPufferPortrait,
}
