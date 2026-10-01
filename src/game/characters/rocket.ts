import { closestPointOnSegment } from '../core/geometry'
import { type Vec, angleDiff, clamp, damp, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import type { DamageOptions } from '../engine/types'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

const FIRST_CHARGE = 1.5
/** Cooldown measured from the end of a dash (s). */
export const DASH_COOLDOWN = 3.0
export const CHARGE_TIME = 0.8
export const DASH_TIME = 0.45
export const DASH_SPEED = 900
/** Max turn rate of the nose while aiming (rad/s). */
const AIM_TURN_RATE = 10
/** Smoothing rate of the heading following the velocity while cruising (1/s). */
const HEADING_FOLLOW = 12
/** Nose tip distance from the centre, in radii (the hit segment runs centre → tip). */
const NOSE_REACH = 2.3
export const RAM_DAMAGE = 22
const RAM_KNOCK = 400
const RAM_SHAKE = 8

/** Sprite proportions, in radii, along the heading (+x) axis. */
const BODY_RADIUS = 1.08
const NOSE_BASE = 0.7
const NOSE_HALF_WIDTH = 0.55
const BOOSTER_FRONT = -0.6
const BOOSTER_BACK = -1.7
const BOOSTER_OFFSET = 0.4
const BOOSTER_HALF = 0.25

type Phase = 'cruise' | 'charge' | 'dash'

/**
 * 火箭 (ROCKET) — an octagonal rocket that bounces around nose-first. Every
 * few seconds it stops dead, swings its nose onto the enemy, then fires its
 * boosters and rockets forward in a straight line. Spearing the enemy with
 * the nose deals a heavy blow and ends the dash.
 */
export class RocketAbility extends Ability {
  private phase: Phase = 'cruise'
  private cooldown = FIRST_CHARGE
  private heading = 0
  private phaseTime = 0
  private dashDir: Vec = { x: 1, y: 0 }

  constructor(world: World, owner: Ball) {
    super(world, owner)
    const v = owner.vel
    if (v.x !== 0 || v.y !== 0) this.heading = Math.atan2(v.y, v.x)
  }

  override prePhysics(dt: number): void {
    if (this.phase === 'dash') this.dashStep(dt)
  }

  override update(dt: number): void {
    const o = this.owner
    if (!this.world.combatActive) {
      if (this.phase !== 'cruise') this.stop(false)
      this.followVelocity(dt)
      return
    }
    switch (this.phase) {
      case 'cruise': {
        this.followVelocity(dt)
        this.cooldown = Math.max(0, this.cooldown - dt)
        const e = this.enemy
        if (this.cooldown > 0 || o.disarmed || o.rooted || o.attachedTo || !e.alive) return
        this.beginCharge()
        return
      }
      case 'charge': {
        // A disarm or root interrupts the wind-up.
        if (o.disarmed || o.rooted) {
          this.stop(true)
          return
        }
        this.phaseTime += dt
        const e = this.enemy
        const want = Math.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)
        const turn = AIM_TURN_RATE * dt
        this.heading += clamp(angleDiff(this.heading, want), -turn, turn)
        if (this.phaseTime >= CHARGE_TIME) this.beginDash()
        return
      }
      case 'dash':
        // Movement and hits happen in prePhysics so the contact resolves this step.
        return
    }
  }

  override onOwnerDamaged(_amount: number, _opts: DamageOptions): void {
    // Don't leave a dead rocket pinned in mid-air.
    if (this.owner.hp <= 0 && this.phase !== 'cruise') this.stop(false)
  }

  private followVelocity(dt: number): void {
    const v = this.owner.vel
    if (v.x * v.x + v.y * v.y < 1) return
    this.heading = lerpAngle(this.heading, Math.atan2(v.y, v.x), damp(HEADING_FOLLOW, dt))
  }

  private beginCharge(): void {
    const o = this.owner
    this.phase = 'charge'
    this.phaseTime = 0
    o.pinned = true
    o.vel = { x: 0, y: 0 }
    this.world.sound('zap', 0.3, 0.6)
  }

  private beginDash(): void {
    const o = this.owner
    this.phase = 'dash'
    this.phaseTime = 0
    this.dashDir = { x: Math.cos(this.heading), y: Math.sin(this.heading) }
    // Expose the dash velocity so ball contacts this step bounce the enemy properly.
    o.vel = { x: this.dashDir.x * DASH_SPEED, y: this.dashDir.y * DASH_SPEED }
    this.world.sound('whoosh', 0.9, 0.7)
    this.world.sound('explosion', 0.25, 1.8)
  }

  private dashStep(dt: number): void {
    const o = this.owner
    if (!this.world.combatActive || o.rooted) {
      this.stop(false)
      return
    }
    const d = this.dashDir
    const s = this.world.size
    const r = o.radius
    const nx = o.pos.x + d.x * DASH_SPEED * dt
    const ny = o.pos.y + d.y * DASH_SPEED * dt
    o.pos.x = clamp(nx, r, s - r)
    o.pos.y = clamp(ny, r, s - r)
    const hitWall = o.pos.x !== nx || o.pos.y !== ny
    this.heading = Math.atan2(d.y, d.x)
    this.emitExhaust()

    const e = this.enemy
    if (e.alive) {
      const tip = { x: o.pos.x + d.x * r * NOSE_REACH, y: o.pos.y + d.y * r * NOSE_REACH }
      const p = closestPointOnSegment(e.pos, o.pos, tip)
      if ((p.x - e.pos.x) ** 2 + (p.y - e.pos.y) ** 2 < e.radius * e.radius) {
        this.world.damage(e, RAM_DAMAGE, {
          kind: 'ram',
          source: o,
          at: p,
          knock: { x: d.x * RAM_KNOCK, y: d.y * RAM_KNOCK },
          shake: RAM_SHAKE,
        })
        this.stop(true)
        return
      }
    }

    this.phaseTime += dt
    if (hitWall || this.phaseTime >= DASH_TIME) this.stop(true)
  }

  /**
   * Returns to cruising: unpins the owner and relaunches it along the dash
   * direction (or the current heading after an interrupted charge).
   */
  private stop(restartCooldown: boolean): void {
    const o = this.owner
    const dir = this.phase === 'dash' ? this.dashDir : { x: Math.cos(this.heading), y: Math.sin(this.heading) }
    this.phase = 'cruise'
    this.phaseTime = 0
    o.pinned = false
    if (!o.rooted) o.vel = { x: dir.x * o.baseSpeed, y: dir.y * o.baseSpeed }
    if (restartCooldown) this.cooldown = DASH_COOLDOWN
  }

  /** Ember particles streaming from both booster nozzles, leaving a trail. */
  private emitExhaust(): void {
    const o = this.owner
    const r = o.radius
    const c = Math.cos(this.heading)
    const sn = Math.sin(this.heading)
    const back = this.heading + Math.PI
    for (const side of [-1, 1]) {
      const lx = (BOOSTER_BACK - 0.05) * r
      const ly = side * BOOSTER_OFFSET * r
      const at = { x: o.pos.x + lx * c - ly * sn, y: o.pos.y + lx * sn + ly * c }
      this.world.effects.burst(at, { count: 2, color: ['#ff7a1a', '#ffb02e', '#ffe066', '#e2401c'], speed: [60, 220], size: [2, 4], life: [0.25, 0.5], direction: back, spread: 0.35, drag: 2.5, front: false, jitter: 2 })
    }
    if (this.world.effects.random() < 0.25) {
      const lx = BOOSTER_BACK * r
      this.world.effects.burst({ x: o.pos.x + lx * c, y: o.pos.y + lx * sn }, { count: 1, color: ['#6b7280', '#9ca3af'], shape: 'smoke', speed: [20, 60], size: [5, 8], life: [0.4, 0.7], direction: back, spread: 0.6, endScale: 2, front: false })
    }
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const r = o.radius * o.drawScale
    const t = this.world.time
    let flame = 0
    if (this.phase === 'charge') {
      const u = clamp(this.phaseTime / CHARGE_TIME, 0, 1)
      flame = 0.15 + 0.35 * u
      // Thin blue ring tightening around the ball as the charge builds.
      ctx.save()
      ctx.strokeStyle = `rgba(79,179,255,${0.45 + 0.5 * u})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, r * (1.6 - 0.3 * u), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    } else if (this.phase === 'dash') {
      flame = 1.1
    }
    drawRocket(ctx, o.pos.x, o.pos.y, this.heading, r, o.color, flame, t, o.flash)
  }
}

function octagonPath(ctx: CanvasRenderingContext2D, R: number): void {
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4
    const px = Math.cos(a) * R
    const py = Math.sin(a) * R
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

/**
 * The rocket sprite centred on the ball, nose along `angle`. `flame` is the
 * exhaust length in radii (0 = off); `time` drives its flicker; `flash`
 * re-applies the hit flash the opaque body would otherwise hide.
 */
export function drawRocket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  r: number,
  color: string,
  flame: number,
  time: number,
  flash = 0,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.lineJoin = 'round'

  // Exhaust flames behind the nozzles.
  if (flame > 0) {
    for (const side of [-1, 1]) {
      const fy = side * BOOSTER_OFFSET * r
      const flick = 0.8 + 0.2 * Math.sin(time * 70 + side * 2.1) + 0.1 * Math.sin(time * 113 + side)
      const len = flame * r * flick
      const x0 = BOOSTER_BACK * r
      ctx.fillStyle = 'rgba(255,122,26,0.9)'
      ctx.beginPath()
      ctx.moveTo(x0, fy - BOOSTER_HALF * r * 0.9)
      ctx.quadraticCurveTo(x0 - len * 0.6, fy - BOOSTER_HALF * r * 0.7, x0 - len, fy)
      ctx.quadraticCurveTo(x0 - len * 0.6, fy + BOOSTER_HALF * r * 0.7, x0, fy + BOOSTER_HALF * r * 0.9)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255,230,110,0.95)'
      ctx.beginPath()
      ctx.moveTo(x0, fy - BOOSTER_HALF * r * 0.45)
      ctx.quadraticCurveTo(x0 - len * 0.35, fy - BOOSTER_HALF * r * 0.35, x0 - len * 0.55, fy)
      ctx.quadraticCurveTo(x0 - len * 0.35, fy + BOOSTER_HALF * r * 0.35, x0, fy + BOOSTER_HALF * r * 0.45)
      ctx.closePath()
      ctx.fill()
    }
  }

  // Swept fins outside the boosters (body colour, darkened).
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(-0.45 * r, side * 0.6 * r)
    ctx.lineTo(-1.45 * r, side * 1.2 * r)
    ctx.lineTo(-1.78 * r, side * 1.12 * r)
    ctx.lineTo(-1.3 * r, side * 0.55 * r)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.fillStyle = 'rgba(40,0,0,0.45)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  // Booster cylinders with a coloured stripe and a dark nozzle.
  for (const side of [-1, 1]) {
    const cy = side * BOOSTER_OFFSET * r
    const h = BOOSTER_HALF * r
    const x0 = BOOSTER_BACK * r
    const x1 = BOOSTER_FRONT * r
    ctx.fillStyle = '#2b2f36'
    ctx.beginPath()
    ctx.moveTo(x0 - 0.08 * r, cy - h * 0.8)
    ctx.lineTo(x0 + 0.06 * r, cy - h)
    ctx.lineTo(x0 + 0.06 * r, cy + h)
    ctx.lineTo(x0 - 0.08 * r, cy + h * 0.8)
    ctx.closePath()
    ctx.fill()
    const grad = ctx.createLinearGradient(0, cy - h, 0, cy + h)
    grad.addColorStop(0, '#7b828d')
    grad.addColorStop(0.35, '#4b515a')
    grad.addColorStop(1, '#2f343b')
    ctx.fillStyle = grad
    ctx.fillRect(x0, cy - h, x1 - x0, h * 2)
    ctx.fillStyle = color
    ctx.fillRect(x0 + 0.18 * r, cy - h, 0.16 * r, h * 2)
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.lineWidth = 1
    ctx.strokeRect(x0, cy - h, x1 - x0, h * 2)
  }

  // Silver nose cone; its base tucks under the body.
  const tip = NOSE_REACH * r
  const base = NOSE_BASE * r
  const hw = NOSE_HALF_WIDTH * r
  const nose = ctx.createLinearGradient(0, -hw, 0, hw)
  nose.addColorStop(0, '#f4f6f8')
  nose.addColorStop(0.45, '#c3c9d1')
  nose.addColorStop(1, '#7d8590')
  ctx.fillStyle = nose
  ctx.beginPath()
  ctx.moveTo(base, -hw)
  ctx.quadraticCurveTo(base + (tip - base) * 0.55, -hw * 0.85, tip, 0)
  ctx.quadraticCurveTo(base + (tip - base) * 0.55, hw * 0.85, base, hw)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#5b626c'
  ctx.lineWidth = 1.2
  ctx.stroke()

  // Octagonal body with an inner bevel.
  const R = BODY_RADIUS * r
  const inner = R * 0.78
  octagonPath(ctx, R)
  ctx.fillStyle = color
  ctx.fill()
  ctx.save()
  ctx.clip()
  octagonPath(ctx, inner)
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner)
    ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R)
  }
  ctx.stroke()
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash / 0.12) * 0.75})`
    ctx.fillRect(-R, -R, R * 2, R * 2)
  }
  ctx.restore()
  octagonPath(ctx, R)
  ctx.strokeStyle = 'rgba(60,0,0,0.75)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

export function drawRocketPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const a = -0.62
  // Shift back along the heading so nose and flame both fit.
  const x = cx - Math.cos(a) * r * 0.2
  const y = cy - Math.sin(a) * r * 0.2
  drawRocket(ctx, x, y, a, r * 0.95, color, 0.7, 0.3)
}

export const rocketDef: CharacterDef = {
  id: 'rocket',
  name: '火箭',
  nameEn: 'ROCKET',
  tagline: '瞄准，点火！',
  rules: [
    '平时像普通球一样弹跳，火箭头朝着前进方向',
    `每 ${DASH_COOLDOWN} 秒停下蓄力 ${CHARGE_TIME} 秒，把火箭头对准敌人`,
    `随后点火沿瞄准方向高速冲刺 ${DASH_TIME} 秒，撞墙即停`,
    `火箭头撞中敌人 -${RAM_DAMAGE} 并把对方撞飞`,
  ],
  palette: { ball: '#e73125', text: '#ffffff', accent: '#e73125' },
  mirrorPalette: { ball: '#2563eb', text: '#ffffff', accent: '#3b82f6' },
  create: (w, b) => new RocketAbility(w, b),
  drawPortrait: drawRocketPortrait,
}
