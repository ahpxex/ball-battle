import { closestPointOnSegment } from '../core/geometry'
import { type Vec, damp, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

const FIRST_THROW = 0.3
/** Time between throws, measured from the previous throw (s). */
export const THROW_INTERVAL = 3.3
/** The trident swings round to face the enemy this long before it is thrown (s). */
const AIM_TIME = 0.18
export const THROW_SPEED = 850
export const MAX_RANGE = 420
export const RETURN_SPEED = 1600
export const TRIDENT_DAMAGE = 14
/** Tip reach added to the enemy's radius. */
const HIT_REACH = BALL_RADIUS * 0.5
/** Time spent stuck in the enemy, or hanging in the air after a miss (s). */
export const STICK_TIME = 0.35
const HIT_SHAKE = 6
/** Total length, butt spike to centre-prong tip. */
export const TRIDENT_LENGTH = BALL_RADIUS * 3.7
/** Span across the outer prongs. */
export const HEAD_WIDTH = BALL_RADIUS * 1.1
/** Resting spot relative to the heading: behind the ball and off to its right ("below" when moving right). */
const REST_BACK = BALL_RADIUS * 0.85
const REST_SIDE = BALL_RADIUS * 1.35
/** How deep the tip sinks into a struck ball, as a fraction of its radius. */
const EMBED_DEPTH = 0.55
/** Rate the resting trident follows the heading (1/s). */
const FOLLOW_RATE = 9
const AIM_RATE = 22

type TridentState = 'home' | 'flying' | 'stuck' | 'hanging' | 'returning'

/**
 * 三叉戟 — Trident: a steel trident floats beside the ball. Every two seconds
 * it swings towards the enemy and is hurled straight at where the enemy is
 * standing. A hit skewers the target for a moment before the trident flies
 * back to its owner; a dodged throw hangs at the end of its range, then
 * returns.
 */
export class TridentAbility extends Ability {
  private state: TridentState = 'home'
  /** Centre of the trident. */
  private pos: Vec
  /** Direction the tip points (rad). */
  private angle: number
  /** Smoothed heading of the owner, used for the resting pose. */
  private heading: number
  private nextThrowAt = FIRST_THROW
  private aimTimer = 0
  private origin: Vec = { x: 0, y: 0 }
  private dir: Vec = { x: 1, y: 0 }
  /** Unit direction of travel while flying or returning (for the streaks). */
  private motion: Vec = { x: 1, y: 0 }
  private stateTimer = 0
  /** Centre offset from the skewered ball while stuck. */
  private stuckOffset: Vec = { x: 0, y: 0 }
  private stuckIn: Ball | null = null

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.heading = Math.atan2(owner.vel.y, owner.vel.x)
    this.angle = this.heading
    this.pos = this.restPosition()
  }

  private restPosition(): Vec {
    const o = this.owner.pos
    const c = Math.cos(this.heading)
    const s = Math.sin(this.heading)
    // Back along the heading plus a sideways offset to the right of travel.
    return { x: o.x - c * REST_BACK - s * REST_SIDE, y: o.y - s * REST_BACK + c * REST_SIDE }
  }

  private get tip(): Vec {
    const h = TRIDENT_LENGTH / 2
    return { x: this.pos.x + Math.cos(this.angle) * h, y: this.pos.y + Math.sin(this.angle) * h }
  }

  override update(dt: number): void {
    const v = this.owner.vel
    if (v.x * v.x + v.y * v.y > 1) this.heading = lerpAngle(this.heading, Math.atan2(v.y, v.x), damp(FOLLOW_RATE, dt))
    switch (this.state) {
      case 'home':
        this.updateHome(dt)
        break
      case 'flying':
        this.updateFlight(dt)
        break
      case 'stuck':
        this.updateStuck(dt)
        break
      case 'hanging':
        this.stateTimer -= dt
        if (this.stateTimer <= 0) this.startReturn()
        break
      case 'returning':
        this.updateReturn(dt)
        break
    }
  }

  private updateHome(dt: number): void {
    this.pos = this.restPosition()
    const e = this.enemy
    const canThrow = this.world.combatActive && !this.owner.disarmed && e.alive
    const aiming = canThrow && this.world.fightTime >= this.nextThrowAt - AIM_TIME
    if (aiming) {
      this.aimTimer += dt
      const aim = Math.atan2(e.pos.y - this.pos.y, e.pos.x - this.pos.x)
      this.angle = lerpAngle(this.angle, aim, damp(AIM_RATE, dt))
      if (this.aimTimer >= AIM_TIME && this.world.fightTime >= this.nextThrowAt) this.throw()
      return
    }
    this.aimTimer = 0
    this.angle = lerpAngle(this.angle, this.heading, damp(FOLLOW_RATE, dt))
  }

  private throw(): void {
    const e = this.enemy.pos
    const dx = e.x - this.pos.x
    const dy = e.y - this.pos.y
    const d = Math.hypot(dx, dy) || 1
    this.dir = { x: dx / d, y: dy / d }
    this.motion = this.dir
    this.angle = Math.atan2(dy, dx)
    this.origin = { x: this.pos.x, y: this.pos.y }
    this.state = 'flying'
    this.aimTimer = 0
    this.nextThrowAt = this.world.fightTime + THROW_INTERVAL
    this.world.sound('throw', 0.7, 0.75)
  }

  private updateFlight(dt: number): void {
    const before = this.tip
    const travelled = Math.hypot(this.pos.x - this.origin.x, this.pos.y - this.origin.y)
    const step = Math.min(THROW_SPEED * dt, MAX_RANGE - travelled)
    this.pos.x += this.dir.x * step
    this.pos.y += this.dir.y * step
    const after = this.tip

    const e = this.enemy
    if (e.alive && this.world.combatActive) {
      // Swept test so the tip can never skip past the target.
      const p = closestPointOnSegment(e.pos, before, after)
      const reach = e.radius + HIT_REACH
      if ((p.x - e.pos.x) ** 2 + (p.y - e.pos.y) ** 2 < reach * reach) {
        const dealt = this.world.damage(e, TRIDENT_DAMAGE, { kind: 'trident', source: this.owner, at: p, shake: HIT_SHAKE })
        if (dealt > 0) this.stick(e)
        else this.hang()
        return
      }
    }
    if (travelled + step >= MAX_RANGE - 1e-6) this.hang()
  }

  private stick(e: Ball): void {
    // Sink the tip into the ball along the line it was flying.
    const t = this.tip
    const ox = t.x - e.pos.x
    const oy = t.y - e.pos.y
    const d = Math.hypot(ox, oy) || 1
    const depth = e.radius * EMBED_DEPTH
    const tip = { x: e.pos.x + (ox / d) * depth, y: e.pos.y + (oy / d) * depth }
    const h = TRIDENT_LENGTH / 2
    this.pos = { x: tip.x - Math.cos(this.angle) * h, y: tip.y - Math.sin(this.angle) * h }
    this.stuckOffset = { x: this.pos.x - e.pos.x, y: this.pos.y - e.pos.y }
    this.stuckIn = e
    this.state = 'stuck'
    this.stateTimer = STICK_TIME
  }

  private hang(): void {
    this.state = 'hanging'
    this.stateTimer = STICK_TIME
  }

  private updateStuck(dt: number): void {
    const e = this.stuckIn
    if (e) this.pos = { x: e.pos.x + this.stuckOffset.x, y: e.pos.y + this.stuckOffset.y }
    this.stateTimer -= dt
    if (this.stateTimer <= 0) this.startReturn()
  }

  private startReturn(): void {
    this.state = 'returning'
    this.stuckIn = null
    this.world.sound('whoosh', 0.35, 1.2)
  }

  private updateReturn(dt: number): void {
    const home = this.restPosition()
    const dx = home.x - this.pos.x
    const dy = home.y - this.pos.y
    const d = Math.hypot(dx, dy)
    const step = RETURN_SPEED * dt
    if (d <= step) {
      this.pos = home
      this.state = 'home'
      this.world.sound('clack', 0.25, 1.6)
      return
    }
    this.motion = { x: dx / d, y: dy / d }
    this.pos.x += (dx / d) * step
    this.pos.y += (dy / d) * step
    // Pulled back butt-first, settling into the resting pose on arrival.
    const away = Math.atan2(-dy, -dx)
    const target = d < BALL_RADIUS * 3 ? this.heading : away
    this.angle = lerpAngle(this.angle, target, damp(12, dt))
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    if (this.state !== 'home') return
    ctx.save()
    ctx.globalAlpha = this.presence
    drawTrident(ctx, this.pos.x, this.pos.y, this.angle, BALL_RADIUS)
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.state === 'home') return
    ctx.save()
    ctx.globalAlpha = fade
    if (this.state === 'flying' || this.state === 'returning') {
      // Speed streaks trailing behind the direction of travel.
      const m = this.motion
      const n = { x: -m.y, y: m.x }
      const rear = { x: this.pos.x - m.x * TRIDENT_LENGTH * 0.5, y: this.pos.y - m.y * TRIDENT_LENGTH * 0.5 }
      ctx.strokeStyle = 'rgba(160,236,240,0.28)'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (const off of [-0.3, 0, 0.3]) {
        const sx = rear.x + n.x * off * HEAD_WIDTH
        const sy = rear.y + n.y * off * HEAD_WIDTH
        const len = TRIDENT_LENGTH * (off === 0 ? 0.8 : 0.5)
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx - m.x * len, sy - m.y * len)
      }
      ctx.stroke()
    }
    drawTrident(ctx, this.pos.x, this.pos.y, this.angle, BALL_RADIUS)
    ctx.restore()
  }
}

const OUTLINE = '#0b3338'
const STEEL = '#3f9aa0'
const HIGHLIGHT = '#a6e6e8'

/**
 * A trident centred on (x, y) with its centre prong pointing along `angle`.
 * `r` is the ball radius the proportions are based on.
 */
export function drawTrident(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, r: number): void {
  const k = r
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Skeleton (local units of r, tip at +1.85, butt at -1.85).
  const skeleton = () => {
    ctx.beginPath()
    // Shaft.
    ctx.moveTo(-1.62 * k, 0)
    ctx.lineTo(0.95 * k, 0)
    // Crossbar bowl joining the outer prongs.
    ctx.moveTo(0.98 * k, -0.36 * k)
    ctx.quadraticCurveTo(0.7 * k, 0, 0.98 * k, 0.36 * k)
    // Centre prong.
    ctx.moveTo(0.85 * k, 0)
    ctx.lineTo(1.6 * k, 0)
    // Outer prongs flaring outwards.
    for (const s of [-1, 1]) {
      ctx.moveTo(0.98 * k, 0.36 * s * k)
      ctx.quadraticCurveTo(1.25 * k, 0.38 * s * k, 1.44 * k, 0.48 * s * k)
    }
  }
  // Barbed heads as filled polygons.
  const heads = () => {
    ctx.beginPath()
    ctx.moveTo(1.85 * k, 0)
    ctx.lineTo(1.55 * k, 0.15 * k)
    ctx.lineTo(1.6 * k, 0)
    ctx.lineTo(1.55 * k, -0.15 * k)
    ctx.closePath()
    for (const s of [-1, 1]) {
      ctx.moveTo(1.66 * k, 0.55 * s * k)
      ctx.lineTo(1.42 * k, 0.56 * s * k)
      ctx.lineTo(1.43 * k, 0.4 * s * k)
      ctx.lineTo(1.39 * k, 0.32 * s * k)
      ctx.lineTo(1.5 * k, 0.43 * s * k)
      ctx.closePath()
    }
    // Pointed butt cap.
    ctx.moveTo(-1.85 * k, 0)
    ctx.lineTo(-1.6 * k, 0.09 * k)
    ctx.lineTo(-1.6 * k, -0.09 * k)
    ctx.closePath()
  }

  const w = 0.13 * k
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = w + 2.4
  skeleton()
  ctx.stroke()
  ctx.fillStyle = STEEL
  heads()
  ctx.lineWidth = 2.4
  ctx.stroke()
  ctx.fill()

  ctx.strokeStyle = STEEL
  ctx.lineWidth = w
  skeleton()
  ctx.stroke()

  // Collar where the head meets the shaft.
  ctx.fillStyle = STEEL
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.rect(0.6 * k, -0.11 * k, 0.14 * k, 0.22 * k)
  ctx.fill()
  ctx.stroke()

  // Lighter highlights along the upper edge.
  ctx.strokeStyle = HIGHLIGHT
  ctx.lineWidth = Math.max(0.8, w * 0.35)
  ctx.beginPath()
  ctx.moveTo(-1.5 * k, -w * 0.22)
  ctx.lineTo(0.55 * k, -w * 0.22)
  ctx.moveTo(0.9 * k, -w * 0.22)
  ctx.lineTo(1.62 * k, -w * 0.22)
  ctx.moveTo(1.02 * k, -0.38 * k)
  ctx.quadraticCurveTo(1.25 * k, -0.41 * k, 1.42 * k, -0.5 * k)
  ctx.stroke()
  ctx.fillStyle = HIGHLIGHT
  ctx.beginPath()
  ctx.moveTo(1.82 * k, -0.01 * k)
  ctx.lineTo(1.58 * k, -0.11 * k)
  ctx.lineTo(1.62 * k, -0.02 * k)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export function drawTridentPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const bx = cx - r * 0.55
  const by = cy + r * 0.45
  drawTrident(ctx, cx + r * 0.45, cy - r * 0.15, -0.95, r)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bx, by, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
}

export const tridentDef: CharacterDef = {
  id: 'trident',
  name: '三叉戟',
  nameEn: 'TRIDENT',
  tagline: '一戟穿心',
  rules: [
    `三叉戟悬在身旁，每 ${THROW_INTERVAL} 秒对准敌人当前位置掷出一次`,
    `直线飞行，最远 ${MAX_RANGE}，命中敌人 -${TRIDENT_DAMAGE}`,
    `命中后插在敌人身上 ${STICK_TIME} 秒，再飞回主人身边`,
    '只瞄准不追踪，敌人走位就能躲开',
  ],
  palette: { ball: '#00b8c0', text: '#ffffff', accent: '#1ab5ba' },
  mirrorPalette: { ball: '#0f766e', text: '#ccfbf1', accent: '#2dd4bf' },
  create: (w, b) => new TridentAbility(w, b),
  drawPortrait: drawTridentPortrait,
}
