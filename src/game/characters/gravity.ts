import * as dm from '../core/dmath'
import { type Vec, clamp, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS, BASE_SPEED } from '../engine/constants'
import type { Wall } from '../engine/types'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

/** Acceleration pulling the enemy towards the floor wall (units/s²). */
const GRAVITY = 1215
/** Seconds between two tilts of the arena. */
export const TILT_INTERVAL = 4
/** The next floor wall is announced this long before the tilt. */
export const WARN_TIME = 1
/** Impacts slower than this (speed into the floor, units/s) are harmless. */
const SLAM_SPEED = 470
/** Every this much impact speed above SLAM_SPEED adds one point of damage. */
const SPEED_PER_DAMAGE = 30
export const MAX_DAMAGE = 14
/** A ball counts as touching a wall when its rim is this close to it. */
const CONTACT_EPS = 1

const IMPACT_LIFE = 0.7
const ARROW_SPACING = 100
const GLOW_DEPTH = BALL_RADIUS * 2.2
const INDIGO = '129,140,248'
const PALE = '224,231,255'

const WALLS: readonly Wall[] = ['left', 'right', 'top', 'bottom']

interface Impact {
  /** Contact point on the wall. */
  pos: Vec
  wall: Wall
  age: number
  /** 0..1 strength of the slam (scales the visuals). */
  power: number
}

/** Unit vector pointing from the arena into `wall` (the direction of the pull). */
function wallDir(wall: Wall): Vec {
  switch (wall) {
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
      return { x: 1, y: 0 }
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
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
 * Harmless impact speed for `b`. A ball that cruises faster than normal (e.g.
 * a sped-up spear) gets the same allowance on top, so only the speed gained
 * by falling counts, not its own running speed.
 */
function slamThreshold(b: Ball): number {
  return SLAM_SPEED + Math.max(0, b.baseSpeed * b.speedFactor - BASE_SPEED)
}

/** Damage of a floor impact at `speed` (0 below the threshold). */
function slamDamage(speed: number, threshold: number): number {
  if (speed <= threshold) return 0
  return Math.min(MAX_DAMAGE, Math.floor((speed - threshold) / SPEED_PER_DAMAGE) + 1)
}

/**
 * 重力 GRAVITY — no weapon. While it lives the arena has gravity that pulls
 * only the enemy towards one "floor" wall; hitting the floor hard hurts. Every
 * few seconds the arena tilts and another wall becomes the floor, so the enemy
 * falls all the way across and slams into it.
 */
export class GravityAbility extends Ability {
  private floor: Wall
  /** Wall that becomes the floor at the next tilt, chosen when the warning starts. */
  private nextFloor: Wall | null = null
  private tiltTimer = TILT_INTERVAL
  /** Enemy speed towards the floor before this step's physics. */
  private prevFall = 0
  private impacts: Impact[] = []
  /** Time since the last tilt, for the switch-over flash. */
  private sinceTilt = 99

  constructor(world: World, owner: Ball) {
    super(world, owner)
    // Start with the wall farthest from the enemy: the fight opens with a long fall.
    const e = this.enemy
    let best: Wall = 'left'
    for (const w of WALLS) if (gapTo(e, w, world.size) > gapTo(e, best, world.size)) best = w
    this.floor = best
  }

  /** Whether gravity currently acts on the enemy. */
  private affects(e: Ball): boolean {
    return e.alive && this.world.combatActive && e.movable && !e.attachedTo
  }

  override prePhysics(dt: number): void {
    const e = this.enemy
    const g = wallDir(this.floor)
    if (this.affects(e)) {
      e.vel.x += g.x * GRAVITY * dt
      e.vel.y += g.y * GRAVITY * dt
    }
    this.prevFall = e.vel.x * g.x + e.vel.y * g.y
  }

  override update(dt: number): void {
    this.sinceTilt += dt
    for (const i of this.impacts) i.age += dt
    this.impacts = this.impacts.filter((i) => i.age < IMPACT_LIFE)
    this.detectSlam()
    // Tilting is the attack: a disarmed gravity ball keeps its current floor.
    if (!this.world.combatActive || this.owner.disarmed) return
    this.tiltTimer -= dt
    if (this.tiltTimer <= WARN_TIME && this.nextFloor === null) {
      this.nextFloor = this.pickNextFloor()
      this.world.sound('whoosh', 0.35, 0.45)
    }
    if (this.tiltTimer <= 0) {
      this.tiltTimer += TILT_INTERVAL
      this.floor = this.nextFloor ?? this.pickNextFloor()
      this.nextFloor = null
      this.sinceTilt = 0
      this.world.sound('whoosh', 0.6, 0.35)
      this.world.addShake(2)
    }
  }

  /** One of the other three walls; walls farther from the enemy are likelier (a longer fall). */
  private pickNextFloor(): Wall {
    const e = this.enemy
    const s = this.world.size
    const options = WALLS.filter((w) => w !== this.floor)
    const weights = options.map((w) => Math.max(BALL_RADIUS, gapTo(e, w, s)))
    let total = 0
    for (const w of weights) total += w
    let roll = this.world.rng.range(0, total)
    for (let i = 0; i < options.length; i++) {
      roll -= weights[i]
      if (roll < 0) return options[i]
    }
    return options[options.length - 1]
  }

  /** The bounce flipped the enemy's fall while it touches the floor: that was an impact. */
  private detectSlam(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const g = wallDir(this.floor)
    const fall = e.vel.x * g.x + e.vel.y * g.y
    if (this.prevFall <= 0 || fall >= 0) return
    if (gapTo(e, this.floor, this.world.size) > CONTACT_EPS) return
    const speed = -fall
    const dmg = slamDamage(speed, slamThreshold(e))
    if (dmg <= 0) return
    const at = { x: e.pos.x + g.x * e.radius, y: e.pos.y + g.y * e.radius }
    const dealt = this.world.damage(e, dmg, { kind: 'gravityFall', source: this.owner, at, shake: 1 + dmg * 0.45 })
    if (dealt <= 0) return
    const power = clamp(dmg / MAX_DAMAGE, 0.15, 1)
    this.impacts.push({ pos: at, wall: this.floor, age: 0, power })
    const inward = dm.atan2(-g.y, -g.x)
    const fx = this.world.effects
    // Dust thrown up along the floor, both ways.
    fx.burst(at, {
      count: 6 + Math.round(power * 10),
      color: ['#a5b4fc', '#6366f1', '#e0e7ff'],
      shape: 'smoke',
      speed: [60, 200],
      size: [5, 11],
      life: [0.35, 0.8],
      endScale: 2,
      drag: 4,
      direction: inward,
      spread: 1.45,
      front: false,
    })
    fx.burst(at, {
      count: 4 + Math.round(power * 8),
      color: ['#ffffff', '#c7d2fe'],
      shape: 'shard',
      speed: [160, 420],
      size: [2, 4.5],
      life: [0.25, 0.55],
      direction: inward,
      spread: 1.1,
    })
  }

  // ───────────────────────────── rendering ─────────────────────────────

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const s = this.world.size
    const warn = this.nextFloor !== null ? clamp(1 - this.tiltTimer / WARN_TIME, 0, 1) : 0
    ctx.save()
    // Arrow field: chevrons drifting towards the floor, swinging round while the arena tilts.
    const cur = angleOfWall(this.floor)
    const angle = this.nextFloor ? lerpAngle(cur, angleOfWall(this.nextFloor), easeInOut(warn)) : cur
    this.drawArrowField(ctx, angle, fade)
    // Floor glow; the next floor blinks in during the warning.
    const flash = clamp(1 - this.sinceTilt / 0.35, 0, 1)
    drawFloorGlow(ctx, this.floor, s, fade * (1 - 0.6 * warn), flash)
    if (this.nextFloor) {
      const blink = 0.5 + 0.5 * dm.sin(this.world.time * (10 + 22 * warn))
      drawFloorGlow(ctx, this.nextFloor, s, fade * warn * (0.35 + 0.65 * blink), 0)
      drawWarningChevrons(ctx, this.nextFloor, s, fade * (0.3 + 0.7 * blink) * Math.min(1, warn * 3))
    }
    // Fall streaks behind an enemy that is about to slam.
    const e = this.enemy
    if (e.alive && this.affects(e)) {
      const g = wallDir(this.floor)
      const fall = e.vel.x * g.x + e.vel.y * g.y
      const u = clamp((fall - slamThreshold(e) * 0.75) / 320, 0, 1)
      if (u > 0) drawFallStreaks(ctx, e, g, u * fade)
    }
    for (const i of this.impacts) drawImpact(ctx, i, fade)
    ctx.restore()
  }

  private drawArrowField(ctx: CanvasRenderingContext2D, angle: number, fade: number): void {
    const s = this.world.size
    const cos = dm.cos(angle)
    const sin = dm.sin(angle)
    const scroll = (this.world.time * 55) % ARROW_SPACING
    ctx.save()
    ctx.globalAlpha = fade * 0.13
    ctx.strokeStyle = `rgb(${INDIGO})`
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const half = ARROW_SPACING * 4
    ctx.translate(s / 2, s / 2)
    ctx.rotate(angle)
    // In the rotated frame +x points towards the floor.
    for (let along = -half; along <= half; along += ARROW_SPACING) {
      for (let across = -half; across <= half; across += ARROW_SPACING) {
        const x = along + scroll
        const y = across + ((Math.round(along / ARROW_SPACING) & 1) === 0 ? 0 : ARROW_SPACING / 2)
        // Skip chevrons outside the arena.
        const wx = s / 2 + x * cos - y * sin
        const wy = s / 2 + x * sin + y * cos
        if (wx < -20 || wx > s + 20 || wy < -20 || wy > s + 20) continue
        ctx.beginPath()
        ctx.moveTo(x - 9, y - 13)
        ctx.lineTo(x + 5, y)
        ctx.lineTo(x - 9, y + 13)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    // A gravity well: rings sinking into the ball.
    const o = this.owner
    ctx.save()
    ctx.lineWidth = 1.5
    for (let k = 0; k < 3; k++) {
      const u = 1 - ((this.world.time * 0.9 + k / 3) % 1)
      ctx.strokeStyle = `rgba(${INDIGO},${0.55 * (1 - u)})`
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, o.radius * (1.05 + 0.9 * u), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    // A small arrow on the rim shows which way the arena is falling.
    const o = this.owner
    const a = angleOfWall(this.floor)
    const r = o.radius * 0.8
    ctx.save()
    ctx.translate(o.pos.x + dm.cos(a) * r, o.pos.y + dm.sin(a) * r)
    ctx.rotate(a)
    ctx.fillStyle = `rgba(${PALE},0.9)`
    ctx.beginPath()
    ctx.moveTo(5, 0)
    ctx.lineTo(-4, -6)
    ctx.lineTo(-4, 6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

function angleOfWall(wall: Wall): number {
  const d = wallDir(wall)
  return dm.atan2(d.y, d.x)
}

function easeInOut(u: number): number {
  const x = clamp(u, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Runs `draw` in a frame where the wall lies along y = 0 and +y points into the arena, x spanning 0..size. */
function inWallFrame(ctx: CanvasRenderingContext2D, wall: Wall, size: number, draw: () => void): void {
  ctx.save()
  switch (wall) {
    case 'top':
      break
    case 'bottom':
      ctx.translate(size, size)
      ctx.rotate(Math.PI)
      break
    case 'left':
      ctx.translate(0, size)
      ctx.rotate(-Math.PI / 2)
      break
    case 'right':
      ctx.translate(size, 0)
      ctx.rotate(Math.PI / 2)
      break
  }
  draw()
  ctx.restore()
}

/** Indigo glow rising off the floor wall plus a bright edge line. */
function drawFloorGlow(ctx: CanvasRenderingContext2D, wall: Wall, size: number, alpha: number, flash: number): void {
  if (alpha <= 0.01) return
  inWallFrame(ctx, wall, size, () => {
    ctx.globalAlpha = alpha
    const depth = GLOW_DEPTH * (1 + flash * 0.8)
    const g = ctx.createLinearGradient(0, 0, 0, depth)
    g.addColorStop(0, `rgba(${INDIGO},${0.5 + 0.3 * flash})`)
    g.addColorStop(0.45, `rgba(${INDIGO},0.12)`)
    g.addColorStop(1, `rgba(${INDIGO},0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, depth)
    ctx.strokeStyle = `rgba(${PALE},${0.75 + 0.25 * flash})`
    ctx.shadowColor = `rgb(${INDIGO})`
    ctx.shadowBlur = 12
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(0, 1.5)
    ctx.lineTo(size, 1.5)
    ctx.stroke()
  })
}

/** Big chevrons on the wall that is about to become the floor. */
function drawWarningChevrons(ctx: CanvasRenderingContext2D, wall: Wall, size: number, alpha: number): void {
  if (alpha <= 0.01) return
  inWallFrame(ctx, wall, size, () => {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = `rgb(${PALE})`
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = 1; i <= 3; i++) {
      const x = (size * i) / 4
      for (let k = 0; k < 2; k++) {
        const y = 26 + k * 13
        // Pointing at the wall (towards -y).
        ctx.beginPath()
        ctx.moveTo(x - 13, y + 9)
        ctx.lineTo(x, y)
        ctx.lineTo(x + 13, y + 9)
        ctx.stroke()
      }
    }
  })
}

/** Speed lines trailing an enemy that is falling hard. */
function drawFallStreaks(ctx: CanvasRenderingContext2D, e: Ball, g: Vec, alpha: number): void {
  const r = e.radius
  const px = -g.y
  const py = g.x
  ctx.save()
  ctx.lineCap = 'round'
  for (const off of [-0.65, -0.2, 0.3, 0.7]) {
    const sx = e.pos.x + px * off * r - g.x * r * 0.6
    const sy = e.pos.y + py * off * r - g.y * r * 0.6
    const L = r * (1.2 + 0.9 * alpha) * (1 - Math.abs(off) * 0.35)
    const grad = ctx.createLinearGradient(sx, sy, sx - g.x * L, sy - g.y * L)
    grad.addColorStop(0, `rgba(${PALE},${0.75 * alpha})`)
    grad.addColorStop(1, `rgba(${INDIGO},0)`)
    ctx.strokeStyle = grad
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(sx - g.x * L, sy - g.y * L)
    ctx.stroke()
  }
  ctx.restore()
}

/** A flattened shockwave and cracks spreading along the floor from an impact. */
function drawImpact(ctx: CanvasRenderingContext2D, i: Impact, fade: number): void {
  const u = i.age / IMPACT_LIFE
  const a = (1 - u) * fade
  const g = wallDir(i.wall)
  ctx.save()
  ctx.translate(i.pos.x, i.pos.y)
  // Local frame: +x into the wall, y along it; the arena is on the -x side.
  ctx.rotate(dm.atan2(g.y, g.x))
  const p = i.power
  // Flash where the ball hit.
  const glowR = BALL_RADIUS * (1.2 + 1.6 * p)
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR)
  glow.addColorStop(0, `rgba(${PALE},${0.7 * a * (1 - u)})`)
  glow.addColorStop(1, `rgba(${INDIGO},0)`)
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(0, 0, glowR, Math.PI / 2, (Math.PI * 3) / 2)
  ctx.fill()
  // Two flattened shockwaves racing along the floor.
  for (let k = 0; k < 2; k++) {
    const uk = clamp(u * 1.3 - k * 0.25, 0, 1)
    if (uk <= 0) continue
    const spread = BALL_RADIUS * (1 + 3.2 * p) * (0.3 + 0.7 * Math.sqrt(uk))
    ctx.strokeStyle = `rgba(${k === 0 ? PALE : INDIGO},${0.9 * a * (1 - uk * 0.6)})`
    ctx.lineWidth = (k === 0 ? 3 : 2) + 3 * p * (1 - uk)
    ctx.beginPath()
    ctx.ellipse(0, 0, spread * 0.3, spread, 0, Math.PI / 2, (Math.PI * 3) / 2)
    ctx.stroke()
  }
  // Jagged cracks fanning into the floor.
  ctx.strokeStyle = `rgba(${PALE},${0.9 * a})`
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  const crack = BALL_RADIUS * (0.7 + 1.5 * p)
  ctx.beginPath()
  for (const [ang, len] of [
    [-1.25, 1],
    [-0.55, 0.6],
    [0, 0.45],
    [0.6, 0.65],
    [1.3, 0.95],
  ]) {
    const dir = Math.PI + ang
    const L = crack * len
    ctx.moveTo(0, 0)
    ctx.lineTo(dm.cos(dir + 0.15) * L * 0.5, dm.sin(dir + 0.15) * L * 0.5)
    ctx.lineTo(dm.cos(dir - 0.1) * L, dm.sin(dir - 0.1) * L)
  }
  ctx.stroke()
  ctx.restore()
}

export function drawGravityPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const floorY = cy + r * 1.75
  // Glowing floor.
  const g = ctx.createLinearGradient(0, floorY, 0, floorY - r * 1.3)
  g.addColorStop(0, `rgba(${INDIGO},0.55)`)
  g.addColorStop(1, `rgba(${INDIGO},0)`)
  ctx.fillStyle = g
  ctx.fillRect(cx - r * 3, floorY - r * 1.3, r * 6, r * 1.3)
  ctx.strokeStyle = `rgb(${PALE})`
  ctx.shadowColor = `rgb(${INDIGO})`
  ctx.shadowBlur = 8
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(cx - r * 3, floorY)
  ctx.lineTo(cx + r * 3, floorY)
  ctx.stroke()
  ctx.shadowBlur = 0
  // Chevrons pointing down.
  ctx.strokeStyle = `rgba(${INDIGO},0.65)`
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const [x, y] of [
    [cx + r * 1.35, cy - r * 1.6],
    [cx + r * 1.35, cy - r * 1.05],
    [cx - r * 2.0, cy + r * 0.2],
  ]) {
    ctx.beginPath()
    ctx.moveTo(x - r * 0.28, y - r * 0.18)
    ctx.lineTo(x, y + r * 0.1)
    ctx.lineTo(x + r * 0.28, y - r * 0.18)
    ctx.stroke()
  }
  // The gravity ball with its well.
  const ox = cx - r * 0.55
  const oy = cy - r * 0.55
  const or = r * 0.85
  ctx.lineWidth = 1.5
  for (let k = 1; k <= 2; k++) {
    ctx.strokeStyle = `rgba(${INDIGO},${0.5 / k})`
    ctx.beginPath()
    ctx.arc(ox, oy, or * (1 + 0.28 * k), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(ox, oy, or, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = `rgba(${PALE},0.9)`
  ctx.beginPath()
  ctx.moveTo(ox, oy + or * 0.85)
  ctx.lineTo(ox - or * 0.2, oy + or * 0.55)
  ctx.lineTo(ox + or * 0.2, oy + or * 0.55)
  ctx.closePath()
  ctx.fill()
  // A victim slamming into the floor.
  const vr = r * 0.48
  const vx = cx + r * 1.25
  const vy = floorY - vr
  const streak = { x: 0, y: 1 }
  ctx.lineWidth = 2.5
  for (const off of [-0.6, 0, 0.6]) {
    const sx = vx + off * vr
    const grad = ctx.createLinearGradient(sx, vy - vr * 0.4, sx, vy - vr * 2.6)
    grad.addColorStop(0, `rgba(${PALE},0.8)`)
    grad.addColorStop(1, `rgba(${INDIGO},0)`)
    ctx.strokeStyle = grad
    ctx.beginPath()
    ctx.moveTo(sx, vy - vr * 0.4 * streak.y)
    ctx.lineTo(sx, vy - vr * 2.6)
    ctx.stroke()
  }
  ctx.fillStyle = '#d4d4d8'
  ctx.beginPath()
  ctx.ellipse(vx, vy + vr * 0.12, vr * 1.12, vr * 0.88, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = `rgba(${PALE},0.9)`
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(vx, floorY, vr * 2.0, vr * 0.45, 0, Math.PI, Math.PI * 2)
  ctx.stroke()
}

export const gravityDef: CharacterDef = {
  id: 'gravity',
  nameEn: 'GRAVITY',
  ruleValues: { tiltInterval: TILT_INTERVAL, warnTime: WARN_TIME, maxDamage: MAX_DAMAGE },
  palette: { ball: '#4338ca', text: '#ffffff', accent: '#818cf8' },
  mirrorPalette: { ball: '#312e81', text: '#e0e7ff', accent: '#a5b4fc' },
  create: (w, b) => new GravityAbility(w, b),
  drawPortrait: drawGravityPortrait,
}
