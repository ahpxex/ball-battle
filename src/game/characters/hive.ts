import { type Vec, angleDiff, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const FIRST_BATCH = 3.0
export const BATCH_INTERVAL = 3.2
export const BATCH_START = 5
export const BATCH_MAX = 6
export const MAX_BEES = 16
export const BEE_LIFE = 1.65
const BEE_SPEED = 520
/** Max steering rate (rad/s). */
const BEE_TURN_RATE = 6
/** Lateral wobble added to the flight direction so bees don't stack (rad). */
const WOBBLE_AMPLITUDE = 0.4
export const STING_DAMAGE = 1
const STING_COOLDOWN = 0.6
/** Contact radius of a bee. */
const BEE_RADIUS = BALL_RADIUS * 0.3
/** A freshly emerged bee can't sting yet (s). */
const SPAWN_DELAY = 0.1
/** Delay between consecutive bees leaving the hive within one batch (s). */
const EMERGE_GAP = 0.05
/** Angular spacing of a batch's initial headings (rad). */
const FAN_STEP = 0.45
const POP_TIME = 0.12
const FADE_TIME = 0.25
/** Entrance hole offset below the hive centre, in radii. */
const HOLE_OFFSET = 0.52
const HOLE_RADIUS = 0.15

interface Bee {
  pos: Vec
  /** Steered heading; the actual flight direction adds the wobble. */
  heading: number
  /** Current flight direction (heading + wobble), used for drawing. */
  dir: number
  age: number
  life: number
  cooldown: number
  wobblePhase: number
  wobbleFreq: number
}

/**
 * 蜂巢 (HIVE) — a skep beehive. Every few seconds a batch of bees pours out
 * of its entrance hole, each batch one bee bigger than the last. Bees home in
 * on the enemy, sting on touch and buzz back off before diving in again; they
 * only live a couple of seconds.
 */
export class HiveAbility extends Ability {
  private bees: Bee[] = []
  private timer = FIRST_BATCH
  private batches = 0
  /** Bees of the current batch still waiting to leave the hive. */
  private queued = 0
  private queueIndex = 0
  private queueSize = 0
  private emergeTimer = 0

  private get hole(): Vec {
    const o = this.owner
    return { x: o.pos.x, y: o.pos.y + o.radius * HOLE_OFFSET }
  }

  override update(dt: number): void {
    const armed = this.world.combatActive && !this.owner.disarmed
    if (armed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += BATCH_INTERVAL
        this.startBatch()
      }
      if (this.queued > 0) {
        this.emergeTimer -= dt
        while (this.queued > 0 && this.emergeTimer <= 0) {
          this.emergeTimer += EMERGE_GAP
          this.emerge()
        }
      }
    }
    this.updateBees(dt)
  }

  private startBatch(): void {
    const size = Math.min(BATCH_MAX, BATCH_START + this.batches)
    this.batches += 1
    this.queueSize = size
    this.queueIndex = 0
    this.queued = size
    this.emergeTimer = 0
    this.world.effects.burst(this.hole, { count: 12, color: ['#ff9a1f', '#ffc247', '#ff6a00'], shape: 'spark', speed: [60, 200], size: [1.5, 3], life: [0.15, 0.35], direction: Math.PI / 2, spread: 1.2 })
    this.world.sound('whoosh', 0.35, 1.7)
  }

  private emerge(): void {
    const index = this.queueIndex
    this.queueIndex += 1
    this.queued -= 1
    // Batches that would overflow the cap simply release fewer bees.
    if (this.bees.length >= MAX_BEES) return
    const rng = this.world.rng
    const hole = this.hole
    const e = this.enemy.pos
    const toEnemy = Math.atan2(e.y - hole.y, e.x - hole.x)
    const heading = toEnemy + (index - (this.queueSize - 1) / 2) * FAN_STEP + rng.range(-0.15, 0.15)
    this.bees.push({
      pos: { x: hole.x, y: hole.y },
      heading,
      dir: heading,
      age: 0,
      life: BEE_LIFE,
      cooldown: SPAWN_DELAY,
      wobblePhase: rng.range(0, Math.PI * 2),
      wobbleFreq: rng.range(8, 12),
    })
    this.world.effects.burst(hole, { count: 3, color: ['#ff9a1f', '#ffc247'], shape: 'spark', speed: [40, 140], size: [1.2, 2.4], life: [0.12, 0.25], direction: heading, spread: 0.8 })
  }

  private updateBees(dt: number): void {
    const target = this.enemy
    const size = this.world.size
    const kept: Bee[] = []
    for (const b of this.bees) {
      b.age += dt
      b.life -= dt
      b.cooldown = Math.max(0, b.cooldown - dt)
      if (b.life <= 0) continue
      kept.push(b)
      if (target.alive) {
        const want = Math.atan2(target.pos.y - b.pos.y, target.pos.x - b.pos.x)
        const turn = BEE_TURN_RATE * dt
        b.heading += clamp(angleDiff(b.heading, want), -turn, turn)
      }
      b.dir = b.heading + WOBBLE_AMPLITUDE * Math.sin(b.wobblePhase + b.age * b.wobbleFreq)
      b.pos.x = clamp(b.pos.x + Math.cos(b.dir) * BEE_SPEED * dt, BEE_RADIUS, size - BEE_RADIUS)
      b.pos.y = clamp(b.pos.y + Math.sin(b.dir) * BEE_SPEED * dt, BEE_RADIUS, size - BEE_RADIUS)
      this.trySting(b, target)
    }
    this.bees = kept
  }

  private trySting(b: Bee, target: Ball): void {
    if (!target.alive || !this.world.combatActive || b.cooldown > 0) return
    const dx = target.pos.x - b.pos.x
    const dy = target.pos.y - b.pos.y
    const reach = target.radius + BEE_RADIUS
    if (dx * dx + dy * dy >= reach * reach) return
    b.cooldown = STING_COOLDOWN
    const d = Math.hypot(dx, dy) || 1
    this.world.damage(target, STING_DAMAGE, {
      kind: 'sting',
      source: this.owner,
      at: { x: b.pos.x + (dx / d) * BEE_RADIUS, y: b.pos.y + (dy / d) * BEE_RADIUS },
    })
    // Buzz back off so the bee circles round for another pass.
    b.heading = Math.atan2(-dy, -dx)
    b.dir = b.heading
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawHiveBody(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, o.flash)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.bees.length === 0) return
    const t = this.world.time
    const R = BALL_RADIUS
    ctx.save()
    for (const b of this.bees) {
      const pop = clamp(b.age / POP_TIME, 0.3, 1)
      ctx.globalAlpha = fade * clamp(b.life / FADE_TIME, 0, 1)
      drawBee(ctx, b.pos.x, b.pos.y, b.dir, R * pop, Math.sin(t * 55 + b.wobblePhase * 3))
    }
    ctx.restore()
  }
}

/**
 * The skep hive drawn over the ball: banded straw coils, a warm highlight and
 * the dark entrance hole. Re-applies the hit flash the bands would hide.
 */
export function drawHiveBody(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, flash = 0): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()
  // Highlight towards the top-left.
  const hl = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.05, x - r * 0.35, y - r * 0.45, r * 0.8)
  hl.addColorStop(0, 'rgba(255,202,91,0.95)')
  hl.addColorStop(1, 'rgba(255,202,91,0)')
  ctx.fillStyle = hl
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
  // Horizontal straw coils: a dark seam with a softer band above it.
  for (let i = -2; i <= 2; i++) {
    const by = y + i * r * 0.36 + r * 0.16
    ctx.fillStyle = '#db9725'
    ctx.fillRect(x - r, by - r * 0.11, r * 2, r * 0.09)
    ctx.fillStyle = '#ca762e'
    ctx.fillRect(x - r, by - r * 0.03, r * 2, r * 0.07)
  }
  // Rim shading so the coils read as a sphere.
  const rim = ctx.createRadialGradient(x, y, r * 0.55, x, y, r)
  rim.addColorStop(0, 'rgba(120,60,10,0)')
  rim.addColorStop(1, 'rgba(120,60,10,0.35)')
  ctx.fillStyle = rim
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
  // Entrance hole: an arch with a flat sill.
  const hx = x
  const hy = y + r * HOLE_OFFSET
  const hr = r * HOLE_RADIUS
  ctx.fillStyle = '#210906'
  ctx.beginPath()
  ctx.arc(hx, hy, hr * 1.25, Math.PI, 0)
  ctx.lineTo(hx + hr * 1.25, hy + hr * 0.6)
  ctx.lineTo(hx - hr * 1.25, hy + hr * 0.6)
  ctx.closePath()
  ctx.fill()
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, flash / 0.12) * 0.75})`
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.restore()
}

/**
 * Cartoon side-view bee centred at (x, y) facing `angle`. `R` is the ball
 * radius the proportions are based on (≈1.3R long, ≈0.5R thick); `flap` in
 * [-1, 1] drives the wing flutter.
 */
export function drawBee(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, R: number, flap: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  // Keep the bee upright (wing on top) when flying leftwards.
  if (Math.cos(angle) < 0) ctx.scale(1, -1)
  ctx.lineWidth = Math.max(0.8, R * 0.035)
  ctx.strokeStyle = '#1c1206'
  // Stinger.
  ctx.fillStyle = '#1c1206'
  ctx.beginPath()
  ctx.moveTo(-R * 0.5, -R * 0.07)
  ctx.lineTo(-R * 0.66, 0)
  ctx.lineTo(-R * 0.5, R * 0.07)
  ctx.closePath()
  ctx.fill()
  // Striped abdomen.
  const bx = -R * 0.06
  const rx = R * 0.48
  const ry = R * 0.25
  ctx.beginPath()
  ctx.ellipse(bx, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#ffd23f'
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = '#1c1206'
  for (const sx of [-0.36, -0.08, 0.2]) ctx.fillRect(bx + sx * R, -ry, R * 0.13, ry * 2)
  ctx.restore()
  ctx.beginPath()
  ctx.ellipse(bx, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  // Head with an eye.
  ctx.fillStyle = '#6b4219'
  ctx.beginPath()
  ctx.arc(R * 0.48, -R * 0.02, R * 0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(R * 0.55, -R * 0.07, R * 0.055, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#000000'
  ctx.beginPath()
  ctx.arc(R * 0.57, -R * 0.07, R * 0.028, 0, Math.PI * 2)
  ctx.fill()
  // Fluttering wing, hinged at the top of the body.
  const wingH = R * (0.1 + 0.16 * (0.5 + 0.5 * flap))
  ctx.fillStyle = 'rgba(200,232,255,0.6)'
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath()
  ctx.ellipse(-R * 0.02, -ry - wingH * 0.85, R * 0.26, wingH, -0.25, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

export function drawHivePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const bees: [number, number, number, number][] = [
    [1.75, -1.3, 0.5, 0.8],
    [-1.8, -1.0, 2.7, -0.4],
    [1.5, 1.55, 2.2, 0.2],
    [-1.4, 1.75, -0.6, 1],
  ]
  for (const [dx, dy, a, f] of bees) drawBee(ctx, cx + dx * r, cy + dy * r, a, r * 0.85, f)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  drawHiveBody(ctx, cx, cy, r)
}

export const hiveDef: CharacterDef = {
  id: 'hive',
  name: '蜂巢',
  nameEn: 'HIVE',
  tagline: '蜂拥而至',
  rules: [
    `每 ${BATCH_INTERVAL} 秒从蜂巢口放出一群蜜蜂`,
    `第一批 ${BATCH_START} 只，之后每批多 1 只，最多 ${BATCH_MAX} 只`,
    `蜜蜂追着敌人蜇，每下 -${STING_DAMAGE}`,
    `蜜蜂只活 ${BEE_LIFE} 秒，场上最多 ${MAX_BEES} 只`,
  ],
  palette: { ball: '#feac31', text: '#ffffff', accent: '#c08a2a' },
  mirrorPalette: { ball: '#e8863a', text: '#ffffff', accent: '#a8561c' },
  create: (w, b) => new HiveAbility(w, b),
  drawPortrait: drawHivePortrait,
}
