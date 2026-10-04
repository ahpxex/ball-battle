import * as dm from '../core/dmath'
import { type Vec, angleDiff, clamp, damp, distSq, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import { predictPosition } from '../engine/predict'
import type { World } from '../engine/World'
import { roundRectPath } from '../render/draw'
import type { CharacterDef } from './types'

const FIRST_SHOT = 0.5
/** Cooldown at the start of the fight (s). */
export const COOLDOWN_START = 2.9
/** Cooldown once the ramp has finished (s). */
export const COOLDOWN_END = 2.0
/** Fight time over which the cooldown ramps from start to end (s). */
export const COOLDOWN_RAMP = 10
const COOLDOWN_JITTER = 0.3
/** The barrel swings onto the enemy this long before each shot (s). */
export const AIM_TIME = 0.5
/** Barrel turn smoothing rate (1/s). */
const TURN_RATE = 7
export const SHELL_DAMAGE = 9
const SHELL_SPEED = 500
const SHELL_RADIUS = BALL_RADIUS * 0.3
/** Shells leave the muzzle this far from the ball centre. */
const MUZZLE_DISTANCE = BALL_RADIUS * 2.7
/** Barrel geometry, in multiples of the ball radius. */
const BARREL_LENGTH = 2.8
const BARREL_BASE_WIDTH = 1.1
const BARREL_MOUTH_WIDTH = 1.75
const RECOIL_TIME = 0.22

interface Shell {
  pos: Vec
  vel: Vec
}

/**
 * 大炮 CANNON — a heavy cannon on a wooden carriage. The barrel trails the
 * ball's heading, swings onto the enemy's path just before each shot (leading a
 * moving target) and fires a glowing shell straight ahead. Cadence speeds up over the first seconds.
 */
export class CannonAbility extends Ability {
  private angle: number
  private timer = FIRST_SHOT
  private shells: Shell[] = []
  /** Seconds since the last shot, for recoil and the muzzle flash. */
  private sinceShot = Infinity

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.angle = dm.atan2(owner.vel.y, owner.vel.x)
  }

  override update(dt: number): void {
    this.sinceShot += dt
    const armed = this.world.combatActive && !this.owner.disarmed
    this.aim(dt, armed)
    if (armed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += this.nextCooldown()
        this.fire()
      }
    }
    this.updateShells(dt)
  }

  private aim(dt: number, armed: boolean): void {
    const o = this.owner
    const e = this.enemy
    let target = this.angle
    if (armed && this.timer <= AIM_TIME && e.alive) {
      target = this.leadAngle()
    } else if (o.vel.x !== 0 || o.vel.y !== 0) {
      target = dm.atan2(o.vel.y, o.vel.x)
    }
    this.angle += angleDiff(this.angle, target) * damp(TURN_RATE, dt)
  }

  /** Direction that intercepts the enemy's current (wall-reflected) path with a shell fired now. */
  private leadAngle(): number {
    const o = this.owner.pos
    const e = this.enemy
    let p = e.pos
    for (let i = 0; i < 2; i++) {
      const t = Math.max(0, dm.hypot(p.x - o.x, p.y - o.y) - MUZZLE_DISTANCE) / SHELL_SPEED
      p = predictPosition(e, t, this.world.size)
    }
    return dm.atan2(p.y - o.y, p.x - o.x)
  }

  /** Linear ramp from COOLDOWN_START to COOLDOWN_END over the first COOLDOWN_RAMP seconds, plus jitter. */
  private nextCooldown(): number {
    const u = clamp(this.world.fightTime / COOLDOWN_RAMP, 0, 1)
    const base = COOLDOWN_START + (COOLDOWN_END - COOLDOWN_START) * u
    return base + this.world.rng.range(-COOLDOWN_JITTER, COOLDOWN_JITTER)
  }

  private fire(): void {
    const o = this.owner.pos
    const dx = dm.cos(this.angle)
    const dy = dm.sin(this.angle)
    const muzzle = { x: o.x + dx * MUZZLE_DISTANCE, y: o.y + dy * MUZZLE_DISTANCE }
    this.shells.push({ pos: muzzle, vel: { x: dx * SHELL_SPEED, y: dy * SHELL_SPEED } })
    this.sinceShot = 0
    const fx = this.world.effects
    fx.burst(muzzle, { count: 14, color: ['#fffbeb', '#fde68a', '#facc15', '#ffffff'], shape: 'spark', direction: this.angle, spread: 0.6, speed: [160, 420], size: [1.5, 3.5], life: [0.12, 0.3] })
    fx.burst(muzzle, { count: 5, color: ['#d6d3d1', '#a8a29e'], shape: 'smoke', direction: this.angle, spread: 0.8, speed: [30, 110], size: [5, 9], life: [0.35, 0.7], endScale: 2 })
    this.world.sound('explosion', 0.45)
    this.world.addShake(2)
  }

  private updateShells(dt: number): void {
    const s = this.world.size
    const e = this.enemy
    const fx = this.world.effects
    const kept: Shell[] = []
    for (const sh of this.shells) {
      sh.pos.x += sh.vel.x * dt
      sh.pos.y += sh.vel.y * dt
      const reach = e.radius + SHELL_RADIUS
      if (e.alive && this.world.combatActive && distSq(sh.pos, e.pos) < reach * reach) {
        this.world.damage(e, SHELL_DAMAGE, { kind: 'shell', source: this.owner, at: sh.pos, shake: 5 })
        continue
      }
      const p = sh.pos
      if (p.x < SHELL_RADIUS || p.x > s - SHELL_RADIUS || p.y < SHELL_RADIUS || p.y > s - SHELL_RADIUS) {
        fx.burst({ x: clamp(p.x, 0, s), y: clamp(p.y, 0, s) }, { count: 8, color: ['#fde68a', '#fb923c', '#ffffff'], shape: 'spark', speed: [80, 240], size: [1.5, 3], life: [0.12, 0.3] })
        continue
      }
      // Sparks shed along the flight path.
      if (fx.random() < 0.45) {
        const a = dm.atan2(-sh.vel.y, -sh.vel.x)
        fx.burst(p, { count: 1, color: ['#fde68a', '#fb923c', '#fbbf24'], shape: 'spark', direction: a, spread: 0.5, speed: [40, 120], size: [1.2, 2.4], life: [0.1, 0.25], front: false })
      }
      kept.push(sh)
    }
    this.shells = kept
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner.pos
    // Instant kick back, easing out over RECOIL_TIME.
    const recoil = this.sinceShot < RECOIL_TIME ? sq(1 - this.sinceShot / RECOIL_TIME) : 0
    drawCannon(ctx, o.x, o.y, this.angle, this.owner.radius, recoil)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    // Muzzle flash right after a shot.
    if (this.owner.alive && this.sinceShot < 0.09) {
      const o = this.owner.pos
      const u = 1 - this.sinceShot / 0.09
      const mx = o.x + dm.cos(this.angle) * MUZZLE_DISTANCE
      const my = o.y + dm.sin(this.angle) * MUZZLE_DISTANCE
      drawSparkBurst(ctx, mx, my, this.angle, BALL_RADIUS * (0.6 + 0.5 * u), u)
    }
    for (const sh of this.shells) drawShell(ctx, sh.pos.x, sh.pos.y, dm.atan2(sh.vel.y, sh.vel.x), SHELL_RADIUS)
    ctx.restore()
  }
}

/**
 * Carriage wheels, rear knob and barrel pointing along `angle`. `recoil`
 * (0..1) pulls the barrel back towards the ball.
 */
export function drawCannon(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number, recoil = 0): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.lineJoin = 'round'

  // Wooden wheel blocks at ±100° from the barrel, long side parallel to it.
  for (const side of [-1, 1]) {
    const a = side * ((100 * Math.PI) / 180)
    const wx = dm.cos(a) * r * 1.12
    const wy = dm.sin(a) * r * 1.12
    ctx.fillStyle = '#aa5a2e'
    ctx.strokeStyle = '#5c2c12'
    ctx.lineWidth = Math.max(1, r * 0.05)
    roundRectPath(ctx, wx - r * 0.5, wy - r * 0.175, r, r * 0.35, r * 0.08)
    ctx.fill()
    ctx.stroke()
    // Tread lines.
    ctx.strokeStyle = 'rgba(92,44,18,0.7)'
    ctx.beginPath()
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(wx + i * r * 0.18, wy - r * 0.175)
      ctx.lineTo(wx + i * r * 0.18, wy + r * 0.175)
    }
    ctx.stroke()
  }

  // Rear knob (cascabel).
  ctx.fillStyle = '#35302f'
  ctx.beginPath()
  ctx.arc(-r * 1.08, 0, r * 0.2, 0, Math.PI * 2)
  ctx.fill()

  // Barrel: tapered tube flaring into a bell at the mouth.
  const back = -recoil * r * 0.3
  const x0 = r * 0.7 + back
  const x1 = r * BARREL_LENGTH + back
  const flareStart = x0 + (x1 - x0) * 0.72
  const hb = (r * BARREL_BASE_WIDTH) / 2
  const hm = (r * BARREL_MOUTH_WIDTH) / 2
  const hn = hb * 1.08
  const barrelPath = () => {
    ctx.beginPath()
    ctx.moveTo(x0, -hb)
    ctx.lineTo(flareStart, -hn)
    ctx.quadraticCurveTo(x1 - r * 0.12, -hn, x1, -hm)
    ctx.lineTo(x1, hm)
    ctx.quadraticCurveTo(x1 - r * 0.12, hn, flareStart, hn)
    ctx.lineTo(x0, hb)
    ctx.closePath()
  }
  const steel = ctx.createLinearGradient(0, -hm, 0, hm)
  steel.addColorStop(0, '#1f1b1a')
  steel.addColorStop(0.3, '#57504e')
  steel.addColorStop(0.55, '#35302f')
  steel.addColorStop(1, '#1a1716')
  ctx.fillStyle = steel
  barrelPath()
  ctx.fill()
  ctx.strokeStyle = '#141110'
  ctx.lineWidth = Math.max(1, r * 0.05)
  ctx.stroke()
  // Reinforcing bands.
  ctx.strokeStyle = 'rgba(120,112,108,0.55)'
  ctx.lineWidth = Math.max(1, r * 0.07)
  ctx.beginPath()
  for (const u of [0.3, 0.6]) {
    const x = x0 + (flareStart - x0) * u + (x1 - x0) * 0.05
    const h = hb + (hn - hb) * u
    ctx.moveTo(x, -h)
    ctx.lineTo(x, h)
  }
  ctx.stroke()
  // Orange rim at the mouth.
  ctx.fillStyle = '#e08a24'
  ctx.strokeStyle = '#8a4b0c'
  ctx.lineWidth = Math.max(1, r * 0.04)
  roundRectPath(ctx, x1 - r * 0.2, -hm, r * 0.22, hm * 2, r * 0.06)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** A glowing orange shell with a pale core and a short tail. */
export function drawShell(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, r: number): void {
  ctx.save()
  // Tail.
  const tx = x - dm.cos(angle) * r * 4
  const ty = y - dm.sin(angle) * r * 4
  const tail = ctx.createLinearGradient(x, y, tx, ty)
  tail.addColorStop(0, 'rgba(251,146,60,0.7)')
  tail.addColorStop(1, 'rgba(251,146,60,0)')
  ctx.strokeStyle = tail
  ctx.lineCap = 'round'
  ctx.lineWidth = r * 1.3
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(tx, ty)
  ctx.stroke()
  // Glow.
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2)
  glow.addColorStop(0, 'rgba(255,200,90,0.9)')
  glow.addColorStop(0.45, 'rgba(249,115,22,0.45)')
  glow.addColorStop(1, 'rgba(249,115,22,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, r * 2.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fb923c'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fef9c3'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Star-shaped yellow/white flash pointing along `angle`. */
function drawSparkBurst(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, alpha: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.globalAlpha *= alpha
  const rays = 9
  ctx.fillStyle = '#facc15'
  ctx.beginPath()
  for (let i = 0; i < rays * 2; i++) {
    const a = (i / (rays * 2)) * Math.PI * 2
    // Rays forward of the muzzle are longer.
    const fwd = 0.55 + 0.45 * Math.max(0, dm.cos(a))
    const rr = i % 2 === 0 ? size * fwd : size * 0.32
    const px = dm.cos(a) * rr
    const py = dm.sin(a) * rr
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(size * 0.08, 0, size * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawCannonPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const br = r * 0.8
  const bx = cx - r * 0.85
  const by = cy + r * 0.75
  const a = -0.62
  drawShell(ctx, cx + r * 1.75, cy - r * 1.45, a, r * 0.3)
  drawCannon(ctx, bx, by, a, br)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fill()
  const mx = bx + dm.cos(a) * br * 2.75
  const my = by + dm.sin(a) * br * 2.75
  drawSparkBurst(ctx, mx, my, a, br * 0.7, 0.9)
}

export const cannonDef: CharacterDef = {
  id: 'cannon',
  nameEn: 'CANNON',
  ruleValues: { shellDamage: SHELL_DAMAGE, cooldownStart: COOLDOWN_START, cooldownRamp: COOLDOWN_RAMP, cooldownEnd: COOLDOWN_END, aimTime: AIM_TIME },
  palette: { ball: '#fdbd26', text: '#ffffff', accent: '#ebc134' },
  mirrorPalette: { ball: '#a16207', text: '#fef9c3', accent: '#facc15' },
  create: (w, b) => new CannonAbility(w, b),
  drawPortrait: drawCannonPortrait,
}
