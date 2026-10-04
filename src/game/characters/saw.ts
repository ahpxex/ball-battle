import * as dm from '../core/dmath'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { BallContact, WallBounce } from '../engine/types'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

// ───────────────────────────── V1: orbiting blades ─────────────────────────────

/** Clockwise orbit speed of the blade pair (degrees per second). */
export const ORBIT_DEG = 220
const ORBIT_SPEED = (ORBIT_DEG * Math.PI) / 180
/** Distance from the ball centre to each blade's hub. */
const BLADE_ORBIT = BALL_RADIUS * 2.6
/** Blade radius including the teeth. */
const BLADE_RADIUS = BALL_RADIUS * 0.9
/** Cosmetic spin of each blade about its own hub (rad/s). */
const BLADE_SPIN = 16
export const SAW_DAMAGE = 9
/** Minimum gap between two hits of the same blade on the same target (s). */
export const BLADE_COOLDOWN = 0.35
const BLADE_COUNT = 2
const TOOTH_COUNT = 16

/**
 * 铁锯 SAW BALL — two circular saw blades orbit the ball on opposite sides,
 * spinning on their own hubs as they go. Each blade that cuts into the enemy
 * deals a flat 5, at most once per blade every 0.45 s. The body itself does
 * no contact damage.
 */
export class SawAbility extends Ability {
  private angle: number
  private spin = 0
  /** Per-blade cooldown against the enemy (1v1, so one target per blade). */
  private readonly cooldowns: number[] = new Array<number>(BLADE_COUNT).fill(0)

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.angle = world.rng.range(0, Math.PI * 2)
  }

  private bladeAngle(i: number): number {
    return this.angle + (i * Math.PI * 2) / BLADE_COUNT
  }

  private bladePos(i: number): { x: number; y: number } {
    const a = this.bladeAngle(i)
    const o = this.owner.pos
    return { x: o.x + dm.cos(a) * BLADE_ORBIT, y: o.y + dm.sin(a) * BLADE_ORBIT }
  }

  override update(dt: number): void {
    for (let i = 0; i < BLADE_COUNT; i++) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt)
    if (!this.world.combatActive) return
    // Blades keep turning even while disarmed; they just can't cut.
    this.angle += ORBIT_SPEED * dt
    this.spin += BLADE_SPIN * dt
    if (this.owner.disarmed) return
    const e = this.enemy
    if (!e.alive) return
    const reach = e.radius + BLADE_RADIUS
    for (let i = 0; i < BLADE_COUNT; i++) {
      if (this.cooldowns[i] > 0) continue
      const p = this.bladePos(i)
      const dx = e.pos.x - p.x
      const dy = e.pos.y - p.y
      const d2 = dx * dx + dy * dy
      if (d2 >= reach * reach) continue
      this.cooldowns[i] = BLADE_COOLDOWN
      // Hit point: the enemy's surface facing the blade hub.
      const d = Math.sqrt(d2) || 1
      const at = { x: e.pos.x - (dx / d) * e.radius, y: e.pos.y - (dy / d) * e.radius }
      this.world.damage(e, SAW_DAMAGE, { kind: 'saw', source: this.owner, at, shake: 1.5 })
      if (!e.alive) return
    }
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (let i = 0; i < BLADE_COUNT; i++) {
      const p = this.bladePos(i)
      drawSawBlade(ctx, p.x, p.y, BLADE_RADIUS, this.spin + i * 0.7)
    }
    ctx.restore()
  }
}

/** A grey circular saw blade (radius incl. teeth), teeth rotated by `spin`. */
export function drawSawBlade(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number): void {
  ctx.save()
  // Lighting stays fixed in the world while the teeth turn.
  const steel = ctx.createLinearGradient(x - r, y - r, x + r, y + r)
  steel.addColorStop(0, '#abb0b5')
  steel.addColorStop(1, '#8f999d')
  ctx.translate(x, y)
  ctx.save()
  ctx.rotate(spin)
  const inner = r * 0.8
  const step = (Math.PI * 2) / TOOTH_COUNT
  ctx.beginPath()
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const a = i * step
    // Sawtooth: rise to the tip, then drop straight back to the gullet.
    ctx.lineTo(dm.cos(a) * inner, dm.sin(a) * inner)
    ctx.lineTo(dm.cos(a + step * 0.85) * r, dm.sin(a + step * 0.85) * r)
    ctx.lineTo(dm.cos(a + step) * inner, dm.sin(a + step) * inner)
  }
  ctx.closePath()
  ctx.restore()
  ctx.translate(-x, -y)
  ctx.fillStyle = steel
  ctx.fill()
  ctx.strokeStyle = '#6b7478'
  ctx.lineWidth = 1
  ctx.stroke()
  // Faint curved highlight, upper left.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = Math.max(1, r * 0.08)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.55, Math.PI * 1.05, Math.PI * 1.45)
  ctx.stroke()
  // Hub.
  ctx.fillStyle = '#5f686c'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#3f4649'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawSawPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // Scaled so both blades fit within ±2.5r.
  const k = 0.65
  const br = r * k
  const a = -0.6
  for (let i = 0; i < 2; i++) {
    const ang = a + i * Math.PI
    drawSawBlade(ctx, cx + dm.cos(ang) * br * 2.6, cy + dm.sin(ang) * br * 2.6, br * 0.9, i * 0.5)
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, br, 0, Math.PI * 2)
  ctx.fill()
}

export const sawDef: CharacterDef = {
  id: 'saw',
  nameEn: 'SAW BALL',
  ruleValues: { sawDamage: SAW_DAMAGE, bladeCooldown: BLADE_COOLDOWN, orbitDeg: ORBIT_DEG },
  palette: { ball: '#2a9646', text: '#ffffff', accent: '#3a8f54' },
  mirrorPalette: { ball: '#166534', text: '#dcfce7', accent: '#22c55e' },
  create: (w, b) => new SawAbility(w, b),
  drawPortrait: drawSawPortrait,
}

// ───────────────────────────── V2: spiked body, wall charge ─────────────────────────────

export const BODY_DAMAGE = 12
export const CHARGED_DAMAGE = 24
/** Seconds after a wall bounce during which body hits are charged. */
export const CHARGE_WINDOW = 0.65
/** Minimum gap between two body hits on the same target (s). */
export const CONTACT_COOLDOWN = 0.6
const CONTACT_KNOCK = 180
const SPIKE_COUNT = 24
/** Spike tips reach this far from the centre. */
const SPIKE_REACH = BALL_RADIUS * 1.2
/** Slow cosmetic rotation of the spike ring (rad/s). */
const SPIKE_SPIN = 0.6
/** Spin of the thin arc hugging the ball (rad/s). */
const ARC_SPIN = 9
/** How much recent path the speed streak covers (s). */
const STREAK_SPAN = 0.16

interface StreakSample {
  x: number
  y: number
  t: number
}

/**
 * 铁锯 V2 SAW BALL V2 — the blades are gone; the ball itself is ringed with
 * spikes and spins like a saw. Ramming the enemy deals 4, but right after a
 * wall bounce the ball is charged (sparks fly, a white streak trails it) and
 * the next hit within half a second deals double.
 */
export class SawV2Ability extends Ability {
  private lastBounce = -Infinity
  private lastHit = -Infinity
  private spin = 0
  private streak: StreakSample[] = []

  private get charged(): boolean {
    return this.world.time - this.lastBounce <= CHARGE_WINDOW
  }

  override onWallBounce(e: WallBounce): void {
    if (!this.world.combatActive) return
    this.lastBounce = this.world.time
    this.streak = []
    this.world.effects.burst(e.point, {
      count: 12,
      color: ['#ffffff', '#ffffff', '#e5e7eb'],
      shape: 'spark',
      direction: dm.atan2(e.normal.y, e.normal.x),
      spread: 1.3,
      speed: [180, 420],
      size: [1.5, 3],
      life: [0.12, 0.28],
      drag: 5,
    })
    this.world.sound('clack', 0.3, 1.9)
  }

  override onBallContact(c: BallContact): void {
    if (!this.world.combatActive || this.owner.disarmed) return
    const now = this.world.time
    if (now - this.lastHit < CONTACT_COOLDOWN) return
    const charged = this.charged
    const dealt = this.world.damage(c.other, charged ? CHARGED_DAMAGE : BODY_DAMAGE, {
      kind: 'saw',
      source: this.owner,
      at: c.point,
      knock: { x: c.normal.x * CONTACT_KNOCK, y: c.normal.y * CONTACT_KNOCK },
      shake: charged ? 4 : 2,
    })
    // A blocked hit (invulnerable target) doesn't consume the cooldown.
    if (dealt > 0) this.lastHit = now
  }

  override update(dt: number): void {
    if (this.world.combatActive) this.spin += dt
    if (this.world.headless) return
    const now = this.world.time
    if (this.charged) {
      const o = this.owner.pos
      this.streak.push({ x: o.x, y: o.y, t: now })
    }
    while (this.streak.length > 0 && now - this.streak[0].t > STREAK_SPAN) this.streak.shift()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha *= fade
    // Speed streak, fading out with the charge.
    const charge = Math.max(0, 1 - (this.world.time - this.lastBounce) / CHARGE_WINDOW)
    if (charge > 0 && this.streak.length >= 2) drawStreak(ctx, this.streak, o.pos.x, o.pos.y, o.radius * 0.9, charge)
    drawSpikeRing(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, this.spin * SPIKE_SPIN, charge)
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawSpinArc(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, this.spin * ARC_SPIN)
  }
}

/** A white wedge tapering from the ball back along its recent path. */
function drawStreak(ctx: CanvasRenderingContext2D, pts: readonly StreakSample[], hx: number, hy: number, halfWidth: number, alpha: number): void {
  const path = [...pts.map((p) => ({ x: p.x, y: p.y })), { x: hx, y: hy }]
  const n = path.length
  const left: { x: number; y: number }[] = []
  const right: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)]
    const b = path[Math.min(n - 1, i + 1)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const l = dm.hypot(dx, dy) || 1
    const w = halfWidth * (i / (n - 1))
    left.push({ x: path[i].x - (dy / l) * w, y: path[i].y + (dx / l) * w })
    right.push({ x: path[i].x + (dy / l) * w, y: path[i].y - (dx / l) * w })
  }
  const tail = path[0]
  const g = ctx.createLinearGradient(tail.x, tail.y, hx, hy)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(1, `rgba(255,255,255,${0.75 * alpha})`)
  ctx.fillStyle = g
  ctx.beginPath()
  left.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y)
  ctx.closePath()
  ctx.fill()
}

/** Ring of small sharp spikes around a ball of radius `r`; `glow` (0..1) whitens them. */
function drawSpikeRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number, glow: number): void {
  const tip = r * (SPIKE_REACH / BALL_RADIUS)
  const base = r * 0.92
  const half = (Math.PI / SPIKE_COUNT) * 0.55
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < SPIKE_COUNT; i++) {
    const a = rot + (i / SPIKE_COUNT) * Math.PI * 2
    ctx.moveTo(cx + dm.cos(a - half) * base, cy + dm.sin(a - half) * base)
    ctx.lineTo(cx + dm.cos(a) * tip, cy + dm.sin(a) * tip)
    ctx.lineTo(cx + dm.cos(a + half) * base, cy + dm.sin(a + half) * base)
    ctx.closePath()
  }
  ctx.fillStyle = glow > 0 ? mixGrey(glow) : '#c3c9d1'
  ctx.fill()
  ctx.strokeStyle = '#4b5563'
  ctx.lineWidth = 0.8
  ctx.stroke()
  ctx.restore()
}

/** Steel grey blended toward white by `t`. */
function mixGrey(t: number): string {
  const c = (v: number) => Math.round(v + (255 - v) * t)
  return `rgb(${c(195)},${c(201)},${c(209)})`
}

/** Thin partial arcs just inside the rim, suggesting fast spin. */
function drawSpinArc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.82, rot, rot + 1.9)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.82, rot + Math.PI, rot + Math.PI + 1.1)
  ctx.stroke()
  ctx.restore()
}

export function drawSawV2Portrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const br = r * 0.85
  const x = cx + r * 0.45
  const y = cy - r * 0.35
  // Streak trailing down-left from the ball.
  const streak: StreakSample[] = Array.from({ length: 8 }, (_, i) => {
    const t = i / 7
    return { x: x - r * 2.2 * (1 - t), y: y + r * 1.7 * (1 - t), t: 0 }
  })
  drawStreak(ctx, streak, x, y, br * 0.9, 0.8)
  // Wall sparks off to the upper right.
  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  const sx = x + br * 1.25
  const sy = y - br * 1.0
  ctx.beginPath()
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.55 + (i / 6) * Math.PI * 0.9
    ctx.moveTo(sx + dm.cos(a) * r * 0.2, sy + dm.sin(a) * r * 0.2)
    ctx.lineTo(sx + dm.cos(a) * r * (0.5 + (i % 2) * 0.2), sy + dm.sin(a) * r * (0.5 + (i % 2) * 0.2))
  }
  ctx.stroke()
  ctx.restore()
  drawSpikeRing(ctx, x, y, br, 0.1, 0.4)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  drawSpinArc(ctx, x, y, br, -0.8)
}

export const sawV2Def: CharacterDef = {
  id: 'sawV2',
  nameEn: 'SAW BALL V2',
  ruleValues: { bodyDamage: BODY_DAMAGE, contactCooldown: CONTACT_COOLDOWN, chargeWindow: CHARGE_WINDOW, chargedDamage: CHARGED_DAMAGE },
  palette: { ball: '#5b6574', text: '#ffffff', accent: '#6b7280' },
  mirrorPalette: { ball: '#334155', text: '#e2e8f0', accent: '#94a3b8' },
  create: (w, b) => new SawV2Ability(w, b),
  drawPortrait: drawSawV2Portrait,
}
