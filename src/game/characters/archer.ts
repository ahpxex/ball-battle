import { closestPointOnSegment } from '../core/geometry'
import { type Vec, clamp, damp, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

export const ARROW_DAMAGE = 1
/** Arrow flight speed (units/s); arrows fly straight and break on the walls. */
export const ARROW_SPEED = 800
/** Delay before the first shot of the fight (s). */
export const FIRST_SHOT = 0.5
/** Fire interval before the ramp starts (s). */
export const BASE_INTERVAL = 0.45
/** The interval is multiplied by this every second once the ramp starts. */
export const INTERVAL_DECAY = 0.85
/** Fight time after which the fire rate starts ramping up (s). */
export const RAMP_START = 0.8
/** Fastest possible fire interval (s) — a stream of ~10 arrows per second. */
export const MIN_INTERVAL = 0.2
/** Fraction of each interval spent at full draw before the release. */
const DRAW_FRACTION = 0.4
/** Below this interval the bow is held at full draw permanently (s). */
const ALWAYS_DRAWN_BELOW = 0.2

/** Arrow length, tail to head tip. */
const ARROW_LENGTH = BALL_RADIUS * 2.5
/** Collision reach of the arrow head beyond the enemy's radius. */
const ARROW_HIT_SLACK = BALL_RADIUS * 0.15
/** Safety cap; at the top fire rate only ~8 arrows are ever in the air. */
const MAX_ARROWS = 40

/** Bow layout along the aim direction, as multiples of the ball radius. */
const BOW_APEX = 1.4
const BOW_TIP_X = 0.7
const BOW_HALF_SPAN = 1.2
/** How quickly the bow swings round to follow the enemy between shots (1/s). */
const BOW_TURN_RATE = 12

/** Seconds between shots at combat time `t`. */
export function fireInterval(t: number): number {
  return Math.max(MIN_INTERVAL, BASE_INTERVAL * INTERVAL_DECAY ** Math.max(0, t - RAMP_START))
}

interface Arrow {
  /** Head tip position. */
  head: Vec
  dir: Vec
  age: number
}

/**
 * 弓箭手 ARCHER V2 — draws a recurve bow at the enemy and looses arrows
 * straight at its current position for 1 damage each. The fire rate keeps
 * ramping up until the bow pours out a continuous stream of arrows.
 */
export class ArcherAbility extends Ability {
  private arrows: Arrow[] = []
  /** Combat time since this ability came into play (drives the ramp). */
  private clock = 0
  private timer = FIRST_SHOT
  /** Length of the current shot cycle, for the draw animation. */
  private interval = FIRST_SHOT
  private bowAngle: number

  constructor(world: World, owner: Ball) {
    super(world, owner)
    const e = world.opponentOf(owner)
    this.bowAngle = Math.atan2(e.pos.y - owner.pos.y, e.pos.x - owner.pos.x)
  }

  private get aimAngle(): number {
    const o = this.owner.pos
    const e = this.enemy.pos
    return Math.atan2(e.y - o.y, e.x - o.x)
  }

  override update(dt: number): void {
    if (this.enemy.alive) this.bowAngle = lerpAngle(this.bowAngle, this.aimAngle, damp(BOW_TURN_RATE, dt))
    this.updateShooting(dt)
    this.updateArrows(dt)
  }

  private updateShooting(dt: number): void {
    if (!this.world.combatActive) return
    this.clock += dt
    if (this.owner.disarmed || !this.enemy.alive) return
    this.timer -= dt
    if (this.timer > 0) return
    this.shoot()
    this.interval = fireInterval(this.clock)
    this.timer += this.interval
    if (this.timer <= 0) this.timer = this.interval
  }

  private shoot(): void {
    const o = this.owner
    const angle = this.aimAngle
    this.bowAngle = angle
    const dir = { x: Math.cos(angle), y: Math.sin(angle) }
    // Released from full draw: the tail leaves the ball centre.
    if (this.arrows.length >= MAX_ARROWS) this.arrows.shift()
    const arrow: Arrow = { head: { x: o.pos.x + dir.x * ARROW_LENGTH, y: o.pos.y + dir.y * ARROW_LENGTH }, dir, age: 0 }
    this.arrows.push(arrow)
    // The head sweeps from the rim to its spawn point on the release step.
    this.tryHit(arrow, { x: o.pos.x + dir.x * o.radius, y: o.pos.y + dir.y * o.radius })

    const apex = { x: o.pos.x + dir.x * BOW_APEX * o.radius, y: o.pos.y + dir.y * BOW_APEX * o.radius }
    this.world.effects.burst(apex, { count: 5, color: ['#c4b5fd', '#ddd6fe', '#ffffff'], shape: 'spark', speed: [50, 160], size: [1.2, 2.6], life: [0.1, 0.25], direction: angle, spread: 1.3 })
    this.world.sound('whoosh', 0.22, 1.7)
  }

  /** Checks the head's path since `from`; consumes the arrow on a hit. */
  private tryHit(arrow: Arrow, from: Vec): boolean {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return false
    const at = closestPointOnSegment(e.pos, from, arrow.head)
    const reach = e.radius + ARROW_HIT_SLACK
    if ((at.x - e.pos.x) ** 2 + (at.y - e.pos.y) ** 2 > reach * reach) return false
    this.world.damage(e, ARROW_DAMAGE, { kind: 'arrow', source: this.owner, at })
    arrow.age = -1
    return true
  }

  private updateArrows(dt: number): void {
    const s = this.world.size
    const kept: Arrow[] = []
    for (const a of this.arrows) {
      if (a.age < 0) continue
      a.age += dt
      const from = { x: a.head.x, y: a.head.y }
      a.head.x += a.dir.x * ARROW_SPEED * dt
      a.head.y += a.dir.y * ARROW_SPEED * dt
      if (this.tryHit(a, from)) continue
      const h = a.head
      if (h.x < 0 || h.x > s || h.y < 0 || h.y > s) {
        const wall = { x: clamp(h.x, 0, s), y: clamp(h.y, 0, s) }
        this.world.effects.burst(wall, { count: 3, color: ['#d1d5db', '#9ca3af'], shape: 'spark', speed: [40, 120], size: [1, 2], life: [0.1, 0.2] })
        continue
      }
      kept.push(a)
    }
    this.arrows = kept
  }

  /** 0 = relaxed string, 1 = full draw with the tail at the ball centre. */
  private get pull(): number {
    if (!this.world.combatActive || this.owner.disarmed || !this.enemy.alive) return 0
    const interval = fireInterval(this.clock)
    if (interval < ALWAYS_DRAWN_BELOW) return 1
    const window = DRAW_FRACTION * this.interval
    if (this.timer > window) return 0
    // Pull back quickly over the first half of the draw window, then hold.
    return clamp((window - this.timer) / (window * 0.5), 0, 1)
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const o = this.owner
    ctx.save()
    ctx.globalAlpha = fade
    drawBow(ctx, o.pos.x, o.pos.y, this.bowAngle, o.radius, this.pull)
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.arrows.length === 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const a of this.arrows) {
      const tail = { x: a.head.x - a.dir.x * ARROW_LENGTH, y: a.head.y - a.dir.y * ARROW_LENGTH }
      drawArrow(ctx, tail.x, tail.y, Math.atan2(a.dir.y, a.dir.x), BALL_RADIUS, true)
    }
    ctx.restore()
  }
}

/**
 * A recurve bow facing `angle` around a ball of radius `r` at (cx, cy).
 * `pull` 0..1 draws the string back towards the centre; any pull shows a
 * nocked arrow on the string.
 */
export function drawBow(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number, pull: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const apex = BOW_APEX * r
  const tipX = BOW_TIP_X * r
  const span = BOW_HALF_SPAN * r
  const nockX = tipX * (1 - pull)

  // String behind the limbs.
  ctx.strokeStyle = '#d4d4d8'
  ctx.lineWidth = Math.max(0.8, r * 0.035)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(tipX, -span)
  ctx.lineTo(nockX, 0)
  ctx.lineTo(tipX, span)
  ctx.stroke()
  if (pull > 0) drawArrow(ctx, nockX, 0, 0, r, false)

  // Limbs: from the grip at the apex, curving back to tips that flick forward (recurve).
  const limb = (side: 1 | -1): void => {
    ctx.moveTo(apex, 0)
    ctx.bezierCurveTo(apex + r * 0.02, side * r * 0.7, tipX - r * 0.25, side * span * 0.82, tipX, side * span)
  }
  ctx.beginPath()
  limb(-1)
  limb(1)
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#3f1d0e'
  ctx.lineWidth = r * 0.2
  ctx.stroke()
  const wood = ctx.createLinearGradient(tipX, -span, apex, span)
  wood.addColorStop(0, '#7d3c1f')
  wood.addColorStop(0.5, '#a0522d')
  wood.addColorStop(1, '#7d3c1f')
  ctx.strokeStyle = wood
  ctx.lineWidth = r * 0.13
  ctx.stroke()
  // Leather grip wrap at the apex.
  ctx.fillStyle = '#4a2512'
  ctx.fillRect(apex - r * 0.1, -r * 0.2, r * 0.18, r * 0.4)
  ctx.fillStyle = '#c08457'
  ctx.fillRect(apex - r * 0.1, -r * 0.02, r * 0.18, r * 0.04)
  // Nock tips.
  ctx.fillStyle = '#e5e7eb'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(tipX, side * span, r * 0.05, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** An arrow with its tail at (x, y) pointing along `angle`, sized for a ball of radius `r`. */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, r: number, trail: boolean): void {
  const L = ARROW_LENGTH * (r / BALL_RADIUS)
  const headLen = r * 0.42
  const headHalf = r * 0.15
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  if (trail) {
    // Short dotted white trail behind the fletching.
    ctx.fillStyle = '#ffffff'
    for (let i = 1; i <= 4; i++) {
      ctx.globalAlpha *= 0.78
      ctx.beginPath()
      ctx.arc(-i * r * 0.28, 0, Math.max(0.7, r * 0.04), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  // Shaft.
  ctx.strokeStyle = '#8b3a2a'
  ctx.lineWidth = Math.max(1.2, r * 0.07)
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(L - headLen + 1, 0)
  ctx.stroke()
  // Fletching: two vanes at the tail.
  ctx.fillStyle = '#e5e7eb'
  ctx.strokeStyle = '#9ca3af'
  ctx.lineWidth = 0.75
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(r * 0.04, 0)
    ctx.lineTo(0, side * r * 0.17)
    ctx.lineTo(r * 0.22, side * r * 0.17)
    ctx.lineTo(r * 0.52, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  // Silver triangular head.
  const steel = ctx.createLinearGradient(L - headLen, -headHalf, L - headLen, headHalf)
  steel.addColorStop(0, '#f3f4f6')
  steel.addColorStop(1, '#9ca3af')
  ctx.fillStyle = steel
  ctx.strokeStyle = '#4b5563'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(L, 0)
  ctx.lineTo(L - headLen, -headHalf)
  ctx.lineTo(L - headLen * 0.82, 0)
  ctx.lineTo(L - headLen, headHalf)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

export function drawArcherPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const br = r * 0.85
  const x = cx - r * 0.7
  const y = cy + r * 0.55
  const angle = -0.55
  // An arrow already in flight, with its dotted trail.
  drawArrow(ctx, cx - r * 0.35, cy - r * 1.55, angle, br * 0.8, true)
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  drawBow(ctx, x, y, angle, br, 1)
}

export const archerDef: CharacterDef = {
  id: 'archer',
  name: '弓箭手',
  nameEn: 'ARCHER V2',
  tagline: '箭雨越下越密',
  rules: [
    '弓始终瞄准敌人当前所在的位置，射出直飞的箭',
    `每支箭命中 -${ARROW_DAMAGE}，飞到墙上就会折断`,
    `开战约 ${FIRST_SHOT} 秒射出第一箭，起初每 ${BASE_INTERVAL} 秒一箭`,
    `${RAMP_START} 秒后射速越来越快，最终每 ${MIN_INTERVAL} 秒一箭，连成箭流`,
  ],
  palette: { ball: '#8b52ec', text: '#ffffff', accent: '#8256e4' },
  mirrorPalette: { ball: '#5b21b6', text: '#ede9fe', accent: '#a78bfa' },
  create: (w, b) => new ArcherAbility(w, b),
  drawPortrait: drawArcherPortrait,
}
