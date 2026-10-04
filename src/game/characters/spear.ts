import * as dm from '../core/dmath'
import { closestPointOnSegment } from '../core/geometry'
import { clamp, damp, distSq, len, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS, BASE_SPEED } from '../engine/constants'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

/** Speed multiplier gained per second of fight time. */
export const SPEED_GROWTH = 0.05
export const MAX_GROWTH = 2.5
/** Damage = round(BASE_DAMAGE + DAMAGE_GROWTH × fight seconds). */
export const BASE_DAMAGE = 9
export const DAMAGE_GROWTH = 0.3
/** Minimum gap between two hits on the same target (s). */
export const SPEAR_COOLDOWN = 0.5
const KNOCK = 200
/** How quickly the lance swings round to follow the velocity (1/s). */
const TURN_RATE = 14

/** Lance layout along the heading, as multiples of the ball radius. */
const TAIL_AT = -1.3
const TIP_AT = 2.9
const HEAD_LENGTH = 0.6
/** The hit segment starts at the rim, so the shaft inside the ball never stabs. */
const HIT_START = 1.0
const HIT_SLACK = BALL_RADIUS * 0.15

/** Motion trail: kept this long, shown above this speed. */
const TRAIL_TIME = 0.16
const TRAIL_MIN_SPEED = 450

interface TrailPoint {
  x: number
  y: number
  t: number
}

/**
 * 长矛 SPEAR — a long lance held along the direction of travel, tip
 * leading. Running the enemy through with the tip stabs and shoves it.
 * The ball keeps accelerating and the stabs keep getting heavier the longer
 * the fight lasts.
 */
export class SpearAbility extends Ability {
  private angle: number
  private cooldown = 0
  private trail: TrailPoint[] = []

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.angle = dm.atan2(owner.vel.y, owner.vel.x)
  }

  /** Damage of a stab landed right now (grows with fight time). */
  private get stabDamage(): number {
    return Math.round(BASE_DAMAGE + DAMAGE_GROWTH * this.world.fightTime)
  }

  override prePhysics(): void {
    if (!this.world.combatActive) return
    this.owner.baseSpeed = BASE_SPEED * Math.min(MAX_GROWTH, 1 + SPEED_GROWTH * this.world.fightTime)
  }

  override update(dt: number): void {
    const o = this.owner
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (len(o.vel) > 1) this.angle = lerpAngle(this.angle, dm.atan2(o.vel.y, o.vel.x), damp(TURN_RATE, dt))
    this.recordTrail()

    if (this.cooldown > 0 || o.disarmed || !this.world.combatActive) return
    const e = this.enemy
    if (!e.alive) return
    const R = o.radius
    const dx = dm.cos(this.angle)
    const dy = dm.sin(this.angle)
    const a = { x: o.pos.x + dx * HIT_START * R, y: o.pos.y + dy * HIT_START * R }
    const b = { x: o.pos.x + dx * TIP_AT * R, y: o.pos.y + dy * TIP_AT * R }
    const at = closestPointOnSegment(e.pos, a, b)
    const reach = e.radius + HIT_SLACK
    if (distSq(at, e.pos) > reach * reach) return
    this.cooldown = SPEAR_COOLDOWN
    const dmg = this.stabDamage
    this.world.damage(e, dmg, {
      kind: 'spear',
      source: o,
      at,
      knock: { x: dx * KNOCK, y: dy * KNOCK },
      shake: Math.min(8, dmg / 2),
    })
  }

  private recordTrail(): void {
    if (this.world.headless) return
    const now = this.world.time
    this.trail.push({ x: this.owner.pos.x, y: this.owner.pos.y, t: now })
    while (this.trail.length > 0 && now - this.trail[0].t > TRAIL_TIME) this.trail.shift()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const strength = clamp((len(o.vel) - TRAIL_MIN_SPEED) / 200, 0, 1)
    if (strength <= 0 || this.trail.length < 2) return
    drawMotionTrail(ctx, this.trail, o.radius, o.color, strength)
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawLance(ctx, o.pos.x, o.pos.y, this.angle, o.radius)
  }
}

/** Fading ghost discs along recent positions, oldest faintest and smallest. */
function drawMotionTrail(ctx: CanvasRenderingContext2D, pts: readonly { x: number; y: number }[], r: number, color: string, strength: number): void {
  ctx.save()
  ctx.fillStyle = color
  const n = pts.length
  for (let i = 0; i < n - 1; i++) {
    const u = (i + 1) / n
    ctx.globalAlpha = 0.22 * u * strength
    ctx.beginPath()
    ctx.arc(pts[i].x, pts[i].y, r * (0.45 + 0.5 * u), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** The lance centred on (cx, cy), pointing along `angle`, sized for a ball of radius `r`. */
export function drawLance(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const tail = TAIL_AT * r
  const tip = TIP_AT * r
  const headBase = tip - HEAD_LENGTH * r
  const shaftStart = tail + r * 0.2
  const half = r * 0.15
  // Tail spike.
  ctx.fillStyle = '#dedbdd'
  ctx.strokeStyle = '#6b6b70'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(tail, 0)
  ctx.lineTo(shaftStart + 1, -half * 0.8)
  ctx.lineTo(shaftStart + 1, half * 0.8)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Shaft: lighter top half, darker bottom half.
  ctx.fillStyle = '#9f6946'
  ctx.fillRect(shaftStart, -half, headBase - shaftStart, half)
  ctx.fillStyle = '#824c2d'
  ctx.fillRect(shaftStart, 0, headBase - shaftStart, half)
  // Hatched grip around the centre.
  const gripA = -0.55 * r
  const gripB = 0.35 * r
  ctx.fillStyle = '#6e3f22'
  ctx.fillRect(gripA, -half, gripB - gripA, half * 2)
  ctx.save()
  ctx.beginPath()
  ctx.rect(gripA, -half, gripB - gripA, half * 2)
  ctx.clip()
  ctx.strokeStyle = '#3d2312'
  ctx.lineWidth = 1
  ctx.beginPath()
  const pitch = r * 0.14
  for (let x = gripA - half * 2; x < gripB + half * 2; x += pitch) {
    ctx.moveTo(x, -half)
    ctx.lineTo(x + half * 2, half)
    ctx.moveTo(x + half * 2, -half)
    ctx.lineTo(x, half)
  }
  ctx.stroke()
  ctx.restore()
  // Orange bands.
  ctx.fillStyle = '#f08a24'
  for (const at of [-0.95, 1.5, 2.08]) ctx.fillRect(at * r, -half, r * 0.12, half * 2)
  ctx.strokeStyle = '#4a2a14'
  ctx.lineWidth = 1
  ctx.strokeRect(shaftStart, -half, headBase - shaftStart, half * 2)
  // Arrowhead: a silver leaf with a socket and midrib.
  const headHalf = r * 0.27
  ctx.fillStyle = '#9a979a'
  ctx.fillRect(headBase - r * 0.06, -half * 1.15, r * 0.1, half * 2.3)
  ctx.fillStyle = '#dedbdd'
  ctx.strokeStyle = '#6b6b70'
  ctx.beginPath()
  ctx.moveTo(headBase, -half * 0.9)
  ctx.lineTo(headBase + r * 0.14, -headHalf)
  ctx.lineTo(tip, 0)
  ctx.lineTo(headBase + r * 0.14, headHalf)
  ctx.lineTo(headBase, half * 0.9)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = '#a8a5a8'
  ctx.beginPath()
  ctx.moveTo(headBase + r * 0.06, 0)
  ctx.lineTo(tip - r * 0.08, 0)
  ctx.stroke()
  ctx.restore()
}

export function drawSpearPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const br = r * 0.8
  const x = cx - r * 0.75
  const y = cy + r * 0.75
  const angle = -Math.PI / 4
  const ghosts = Array.from({ length: 8 }, (_, i) => {
    const back = (8 - i) * r * 0.13
    return { x: x - dm.cos(angle) * back, y: y - dm.sin(angle) * back }
  })
  ghosts.push({ x, y })
  drawMotionTrail(ctx, ghosts, br, color, 1)
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  drawLance(ctx, x, y, angle, br)
}

export const spearDef: CharacterDef = {
  id: 'spear',
  nameEn: 'SPEAR',
  ruleValues: { spearCooldown: SPEAR_COOLDOWN, baseDamage: BASE_DAMAGE, damageGrowth: DAMAGE_GROWTH, maxGrowth: MAX_GROWTH },
  palette: { ball: '#00a645', text: '#ffffff', accent: '#00a447' },
  mirrorPalette: { ball: '#14532d', text: '#dcfce7', accent: '#4ade80' },
  create: (w, b) => new SpearAbility(w, b),
  drawPortrait: drawSpearPortrait,
}
