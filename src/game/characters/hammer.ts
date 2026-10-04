import * as dm from '../core/dmath'
import { type OrientedBox, circleBoxContact } from '../core/geometry'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import { roundRectPath } from '../render/draw'
import type { CharacterDef } from './types'

/** Spin rate of the hammer arm (rad/s, clockwise on screen). */
const SPIN_SPEED = (250 * Math.PI) / 180
/** Distance from the ball centre to the centre of the hammer head. */
const HEAD_DISTANCE = BALL_RADIUS * 3.0
/** Head extent across the arm (tangential) and along the arm (radial). */
const HEAD_HALF_LENGTH = BALL_RADIUS * 1.3
const HEAD_HALF_DEPTH = BALL_RADIUS * 0.58
export const HAMMER_DAMAGE = 10
/** Minimum gap between two hits on the same target (s). */
export const HIT_COOLDOWN = 1.45
export const DISARM_DURATION = 2.5
const KNOCK = 360

/**
 * 锤神 — a war hammer bolted to the ball spins around it nonstop. Every
 * head hit smashes for a flat 10 and disarms the victim, stopping it from
 * starting new attacks for a few seconds.
 */
export class HammerAbility extends Ability {
  private angle: number
  private cooldown = 0
  private smashFlash = 0

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.angle = world.rng.range(0, Math.PI * 2)
  }

  private headBox(): OrientedBox {
    const o = this.owner.pos
    return {
      center: { x: o.x + dm.cos(this.angle) * HEAD_DISTANCE, y: o.y + dm.sin(this.angle) * HEAD_DISTANCE },
      // The head's long side runs perpendicular to the arm.
      angle: this.angle + Math.PI / 2,
      halfLength: HEAD_HALF_LENGTH,
      halfWidth: HEAD_HALF_DEPTH,
    }
  }

  override update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.smashFlash = Math.max(0, this.smashFlash - dt)
    if (!this.world.combatActive) return
    this.angle += SPIN_SPEED * dt
    if (this.cooldown > 0 || this.owner.disarmed) return
    const e = this.enemy
    if (!e.alive) return
    const contact = circleBoxContact(e.pos, e.radius, this.headBox())
    if (!contact) return
    this.cooldown = HIT_COOLDOWN
    this.smashFlash = 0.15
    // Knock outward from the ball, plus the swing direction.
    const out = { x: dm.cos(this.angle), y: dm.sin(this.angle) }
    const swing = { x: -dm.sin(this.angle), y: dm.cos(this.angle) }
    const dealt = this.world.damage(e, HAMMER_DAMAGE, {
      kind: 'hammer',
      source: this.owner,
      at: contact,
      knock: { x: (out.x * 0.6 + swing.x * 0.8) * KNOCK, y: (out.y * 0.6 + swing.y * 0.8) * KNOCK },
      shake: 7,
    })
    if (dealt > 0 && e.alive) {
      e.applyDisarm(DISARM_DURATION)
      this.world.sound('disarm', 0.5)
    }
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const o = this.owner.pos
    ctx.save()
    ctx.globalAlpha = fade
    // Motion blur: a translucent sweep behind the head, brightest near it.
    if (this.world.combatActive) {
      ctx.lineCap = 'butt'
      ctx.lineWidth = HEAD_HALF_DEPTH * 2
      const steps = 8
      const sweep = 0.7
      for (let i = 0; i < steps; i++) {
        const a0 = this.angle - sweep + (i / steps) * sweep
        ctx.strokeStyle = `rgba(203,213,225,${0.025 + 0.03 * (i / steps)})`
        ctx.beginPath()
        ctx.arc(o.x, o.y, HEAD_DISTANCE, a0, a0 + sweep / steps + 0.01)
        ctx.stroke()
      }
    }
    drawHammer(ctx, o.x, o.y, this.angle, BALL_RADIUS, this.smashFlash > 0)
    ctx.restore()
  }
}

/** Draws the handle from the ball rim and the head, with the arm pointing at `angle`. */
export function drawHammer(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number, flash: boolean): void {
  const k = r / BALL_RADIUS
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const headX = HEAD_DISTANCE * k
  const depth = HEAD_HALF_DEPTH * k
  const half = HEAD_HALF_LENGTH * k
  // Handle: metal cap, then striped grip.
  const gripW = r * 0.36
  ctx.fillStyle = '#9ca3af'
  ctx.fillRect(r * 0.85, -gripW * 0.6, r * 0.3, gripW * 1.2)
  ctx.fillStyle = '#7f1d1d'
  ctx.fillRect(r * 1.15, -gripW / 2, headX - depth - r * 1.15, gripW)
  ctx.strokeStyle = '#fef2f2'
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let x = r * 1.3; x < headX - depth - 2; x += 7 * k) {
    ctx.moveTo(x, -gripW / 2)
    ctx.lineTo(x + 4 * k, gripW / 2)
  }
  ctx.stroke()
  // Head.
  const steel = ctx.createLinearGradient(0, -half, 0, half)
  steel.addColorStop(0, '#f1f5f9')
  steel.addColorStop(0.5, '#94a3b8')
  steel.addColorStop(1, '#e2e8f0')
  ctx.fillStyle = flash ? '#ffffff' : steel
  roundRectPath(ctx, headX - depth, -half, depth * 2, half * 2, 4 * k)
  ctx.fill()
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // End plates.
  ctx.fillStyle = '#cbd5e1'
  ctx.fillRect(headX - depth, -half, depth * 2, half * 0.22)
  ctx.fillRect(headX - depth, half * 0.78, depth * 2, half * 0.22)
  // Red band with rivet.
  ctx.fillStyle = '#dc2626'
  ctx.fillRect(headX - depth, -half * 0.28, depth * 2, half * 0.56)
  ctx.fillStyle = '#f8fafc'
  ctx.beginPath()
  ctx.arc(headX, 0, depth * 0.32, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawHammerPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawHammer(ctx, cx - r * 0.6, cy + r * 0.5, -0.75, r * 0.72, false)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.6, cy + r * 0.5, r * 0.85, 0, Math.PI * 2)
  ctx.fill()
}

export const hammerDef: CharacterDef = {
  id: 'hammer',
  nameEn: 'HAMMER',
  ruleValues: { hammerDamage: HAMMER_DAMAGE, hitCooldown: HIT_COOLDOWN, disarmDuration: DISARM_DURATION },
  palette: { ball: '#ed362a', text: '#ffffff', accent: '#e0443a' },
  mirrorPalette: { ball: '#9f1239', text: '#ffe4e6', accent: '#f43f5e' },
  create: (w, b) => new HammerAbility(w, b),
  drawPortrait: drawHammerPortrait,
}
