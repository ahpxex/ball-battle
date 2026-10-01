import { closestPointOnSegment } from '../core/geometry'
import { type Vec, clamp, damp, lerp, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

/** Jabs are thrown while the enemy centre is within this distance. */
const PUNCH_RANGE = BALL_RADIUS * 5.5
/** Gap between two jabs (gloves alternate, so one may start while the other returns). */
export const PUNCH_COOLDOWN = 0.2
export const JAB_DAMAGE = 3
/** Jab timeline (s): wind up, snap out, come back. */
const PULL_TIME = 0.06
const THRUST_TIME = 0.08
const RETURN_TIME = 0.1
/** Glove tip distance from the ball centre at full extension. */
const TIP_REACH = BALL_RADIUS * 4.5
/** A jab lands when the glove's path (rim → tip) passes within the enemy radius plus this. */
const HIT_SLACK = BALL_RADIUS * 0.3
/** Landed jabs needed to start charging the haymaker. */
export const COMBO_HITS = 4
export const CHARGE_TIME = 0.7
/** The haymaker only connects if the enemy is this close when the charge ends. */
const HAYMAKER_RANGE = BALL_RADIUS * 5
export const HAYMAKER_DAMAGE = 15
const HAYMAKER_KNOCK = 360
const HAYMAKER_RETURN = 0.18
const GLOVE_REST = BALL_RADIUS * 1.45
const GLOVE_SPREAD = BALL_RADIUS * 1.85
const GLOVE_LENGTH = BALL_RADIUS * 1.2
/** Glove centre sits this far behind its tip. */
const TIP_OFFSET = GLOVE_LENGTH * 0.5
const AIM_SMOOTHING = 12
const RING_INNER = BALL_RADIUS * 1.3
const RING_OUTER = BALL_RADIUS * 3
const RINGS = 3
const SPARK_TIME = 0.4

interface Punch {
  /** Time since the punch started. */
  t: number
  /** Punch direction (rad); tracks the enemy until the thrust starts. */
  dir: number
  pull: number
  thrust: number
  ret: number
  /** Whether full extension has been resolved. */
  resolved: boolean
}

interface GlovePose {
  /** Glove centre relative to the ball centre. */
  x: number
  y: number
  /** Direction the fist points (rad). */
  angle: number
}

/**
 * 拳皇 BOXER — two boxing gloves held at its sides. At close range it fires
 * rapid alternating jabs; every fifth landed jab it winds up for a moment
 * and throws a heavy haymaker that sends the enemy flying.
 */
export class BoxerAbility extends Ability {
  /** Smoothed direction to the enemy, for the guard pose. */
  private aim: number
  private cooldown = 0
  private nextGlove = 0
  private punches: [Punch | null, Punch | null] = [null, null]
  private combo = 0
  /** Time spent charging, or -1 while not charging. */
  private charge = -1
  private spark: { pos: Vec; age: number } | null = null

  constructor(world: World, owner: Ball) {
    super(world, owner)
    const e = this.enemy
    this.aim = Math.atan2(e.pos.y - owner.pos.y, e.pos.x - owner.pos.x)
  }

  private toEnemy(): number {
    const o = this.owner.pos
    const e = this.enemy.pos
    return Math.atan2(e.y - o.y, e.x - o.x)
  }

  private enemyDistance(): number {
    const o = this.owner.pos
    const e = this.enemy.pos
    return Math.hypot(e.x - o.x, e.y - o.y)
  }

  override update(dt: number): void {
    const e = this.enemy
    if (e.alive) this.aim = lerpAngle(this.aim, this.toEnemy(), damp(AIM_SMOOTHING, dt))
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (this.spark) {
      this.spark.age += dt
      if (this.spark.age >= SPARK_TIME) this.spark = null
    }
    for (let i = 0; i < 2; i++) this.advancePunch(i, dt)
    if (!this.world.combatActive || !e.alive) return

    if (this.charge >= 0) {
      this.charge += dt
      if (this.charge >= CHARGE_TIME) this.releaseCharge()
      return
    }
    if (this.owner.disarmed || this.cooldown > 0) return
    if (this.enemyDistance() > PUNCH_RANGE) return
    const g = this.nextGlove
    if (this.punches[g]) return
    this.punches[g] = { t: 0, dir: this.toEnemy(), pull: PULL_TIME, thrust: THRUST_TIME, ret: RETURN_TIME, resolved: false }
    this.nextGlove = 1 - g
    this.cooldown = PUNCH_COOLDOWN
    this.world.sound('whoosh', 0.18, 1.8)
  }

  private advancePunch(i: number, dt: number): void {
    const p = this.punches[i]
    if (!p) return
    p.t += dt
    // Keep tracking the enemy during the wind-up.
    if (p.t < p.pull && this.enemy.alive) p.dir = this.toEnemy()
    if (!p.resolved && p.t >= p.pull + p.thrust) {
      p.resolved = true
      this.resolveJab(p)
    }
    if (p.t >= p.pull + p.thrust + p.ret) this.punches[i] = null
  }

  private resolveJab(p: Punch): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const o = this.owner.pos
    const nx = Math.cos(p.dir)
    const ny = Math.sin(p.dir)
    const tip = { x: o.x + nx * TIP_REACH, y: o.y + ny * TIP_REACH }
    // The glove sweeps from the body out to full reach, so an enemy pressed
    // against the boxer is hit too, not only one sitting right at the tip.
    const rim = { x: o.x + nx * this.owner.radius, y: o.y + ny * this.owner.radius }
    const contact = closestPointOnSegment(e.pos, rim, tip)
    if (Math.hypot(contact.x - e.pos.x, contact.y - e.pos.y) > e.radius + HIT_SLACK) return
    const dealt = this.world.damage(e, JAB_DAMAGE, { kind: 'punch', source: this.owner, at: contact })
    if (dealt <= 0 || this.charge >= 0) return
    this.combo += 1
    if (this.combo >= COMBO_HITS) {
      this.charge = 0
      this.world.sound('zap', 0.3, 0.5)
    }
  }

  private releaseCharge(): void {
    this.charge = -1
    this.combo = 0
    const e = this.enemy
    if (this.owner.disarmed || this.enemyDistance() > HAYMAKER_RANGE) return
    const dir = this.toEnemy()
    // The charge was the wind-up: the glove is already out on the hit frame.
    const g = this.nextGlove
    this.punches[g] = { t: 0, dir, pull: 0, thrust: 0, ret: HAYMAKER_RETURN, resolved: true }
    this.nextGlove = 1 - g
    this.cooldown = PUNCH_COOLDOWN
    const nx = Math.cos(dir)
    const ny = Math.sin(dir)
    const at = { x: e.pos.x - nx * e.radius, y: e.pos.y - ny * e.radius }
    const dealt = this.world.damage(e, HAYMAKER_DAMAGE, {
      kind: 'punch',
      source: this.owner,
      at,
      knock: { x: nx * HAYMAKER_KNOCK, y: ny * HAYMAKER_KNOCK },
      shake: 7,
    })
    if (dealt > 0) this.spark = { pos: { x: e.pos.x, y: e.pos.y }, age: 0 }
  }

  /** Guard pose: gloves on either side, pointing away from the body. */
  private restPose(side: number, dist: number): GlovePose {
    const a = this.aim + side * (Math.PI / 2)
    return { x: Math.cos(a) * dist, y: Math.sin(a) * dist, angle: a }
  }

  private glovePose(i: number): GlovePose {
    const side = i === 0 ? -1 : 1
    const charging = this.charge >= 0
    const rest = this.restPose(side, charging ? lerp(GLOVE_REST, GLOVE_SPREAD, clamp(this.charge / 0.15, 0, 1)) : GLOVE_REST)
    if (charging) {
      // Trembling with effort.
      const j = Math.sin(this.world.time * 70 + i * 2) * 1.5
      rest.x += Math.cos(rest.angle) * j
      rest.y += Math.sin(rest.angle) * j
    }
    const p = this.punches[i]
    if (!p) return rest
    const d = p.dir
    const perp = d + side * (Math.PI / 2)
    const cocked: GlovePose = {
      x: Math.cos(d) * BALL_RADIUS * 0.7 + Math.cos(perp) * BALL_RADIUS * 0.75,
      y: Math.sin(d) * BALL_RADIUS * 0.7 + Math.sin(perp) * BALL_RADIUS * 0.75,
      angle: d,
    }
    const out: GlovePose = { x: Math.cos(d) * (TIP_REACH - TIP_OFFSET), y: Math.sin(d) * (TIP_REACH - TIP_OFFSET), angle: d }
    if (p.t < p.pull) return blendPose(rest, cocked, easeOut(p.t / p.pull))
    if (p.t < p.pull + p.thrust) return blendPose(cocked, out, easeOut((p.t - p.pull) / p.thrust))
    return blendPose(out, rest, easeInOut((p.t - p.pull - p.thrust) / p.ret))
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    if (this.charge < 0) return
    const o = this.owner.pos
    ctx.save()
    ctx.lineWidth = 1.5
    for (let k = 0; k < RINGS; k++) {
      const u = (this.charge * 2.2 + k / RINGS) % 1
      ctx.strokeStyle = `rgba(209,213,219,${0.75 * (1 - u)})`
      ctx.beginPath()
      ctx.arc(o.x, o.y, lerp(RING_INNER, RING_OUTER, u), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade * this.owner.opacity
    if (this.owner.alive) {
      const o = this.owner.pos
      for (let i = 0; i < 2; i++) {
        const pose = this.glovePose(i)
        drawGlove(ctx, o.x + pose.x, o.y + pose.y, pose.angle, GLOVE_LENGTH, i === 0 ? -1 : 1)
      }
    }
    if (this.spark) {
      const u = this.spark.age / SPARK_TIME
      ctx.globalAlpha = fade * (1 - u)
      drawCrossedSwords(ctx, this.spark.pos.x, this.spark.pos.y - BALL_RADIUS * 0.2, BALL_RADIUS * (1.1 + 0.4 * u))
    }
    ctx.restore()
  }
}

function easeOut(u: number): number {
  const x = clamp(u, 0, 1)
  return 1 - (1 - x) * (1 - x)
}

function easeInOut(u: number): number {
  const x = clamp(u, 0, 1)
  return x * x * (3 - 2 * x)
}

function blendPose(a: GlovePose, b: GlovePose, t: number): GlovePose {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), angle: lerpAngle(a.angle, b.angle, t) }
}

/**
 * Cartoon boxing glove centred at (x, y), fist pointing along `angle`.
 * `side` mirrors the thumb so the pair reads as left and right.
 */
export function drawGlove(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, side: number): void {
  const L = length
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, L * 0.035)
  ctx.strokeStyle = '#6b0a00'
  // Cuff: white band, then a red wrist.
  ctx.fillStyle = '#c81000'
  ctx.beginPath()
  ctx.rect(-L * 0.5, -L * 0.2, L * 0.22, L * 0.4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#f5f5f4'
  ctx.beginPath()
  ctx.rect(-L * 0.33, -L * 0.22, L * 0.1, L * 0.44)
  ctx.fill()
  ctx.stroke()
  // Thumb bump on one side.
  ctx.fillStyle = '#e01200'
  ctx.beginPath()
  ctx.ellipse(-L * 0.02, side * L * 0.27, L * 0.18, L * 0.11, side * 0.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // Fist.
  const fist = ctx.createLinearGradient(0, -L * 0.33, 0, L * 0.33)
  fist.addColorStop(0, '#ff4a2e')
  fist.addColorStop(0.45, '#fc1400')
  fist.addColorStop(1, '#a80d00')
  ctx.fillStyle = fist
  ctx.beginPath()
  ctx.ellipse(L * 0.12, 0, L * 0.38, L * 0.32, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // Knuckle crease and highlight.
  ctx.strokeStyle = 'rgba(107,10,0,0.55)'
  ctx.beginPath()
  ctx.arc(L * 0.08, 0, L * 0.28, -0.9, 0.9)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.ellipse(L * 0.2, -L * 0.15, L * 0.12, L * 0.055, -0.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** White crossed swords: the haymaker impact mark. */
function drawCrossedSwords(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = 'rgba(30,30,30,0.6)'
  ctx.lineWidth = 1
  ctx.shadowColor = '#ffffff'
  ctx.shadowBlur = 10
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    ctx.save()
    ctx.rotate(a)
    const h = size
    const w = size * 0.09
    // Blade.
    ctx.beginPath()
    ctx.moveTo(-w, h * 0.25)
    ctx.lineTo(-w, -h * 0.5)
    ctx.lineTo(0, -h * 0.62)
    ctx.lineTo(w, -h * 0.5)
    ctx.lineTo(w, h * 0.25)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    // Guard and grip.
    ctx.fillRect(-w * 3, h * 0.25, w * 6, w * 1.4)
    ctx.strokeRect(-w * 3, h * 0.25, w * 6, w * 1.4)
    ctx.fillRect(-w * 0.8, h * 0.25 + w * 1.4, w * 1.6, h * 0.22)
    ctx.restore()
  }
  ctx.restore()
}

export function drawBoxerPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const bx = cx - r * 0.9
  const by = cy + r * 0.6
  const br = r * 0.85
  const k = br / BALL_RADIUS
  const aim = -0.45
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fill()
  // Guard glove on the side, the other one mid-jab.
  const ga = aim + Math.PI / 2
  drawGlove(ctx, bx + Math.cos(ga) * GLOVE_REST * k, by + Math.sin(ga) * GLOVE_REST * k, ga, GLOVE_LENGTH * k, 1)
  const jab = (TIP_REACH - TIP_OFFSET) * k
  drawGlove(ctx, bx + Math.cos(aim) * jab, by + Math.sin(aim) * jab, aim, GLOVE_LENGTH * k, -1)
  // Speed lines behind the jab.
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (const off of [-0.32, 0, 0.32]) {
    const px = Math.cos(aim + Math.PI / 2) * off * br
    const py = Math.sin(aim + Math.PI / 2) * off * br
    ctx.moveTo(bx + px + Math.cos(aim) * br * 1.2, by + py + Math.sin(aim) * br * 1.2)
    ctx.lineTo(bx + px + Math.cos(aim) * br * 2.0, by + py + Math.sin(aim) * br * 2.0)
  }
  ctx.stroke()
}

export const boxerDef: CharacterDef = {
  id: 'boxer',
  name: '拳皇',
  nameEn: 'BOXER',
  tagline: '五连刺拳接重拳',
  rules: [
    `敌人靠近时左右拳交替快速出拳，每 ${PUNCH_COOLDOWN} 秒一拳`,
    `每记刺拳命中 -${JAB_DAMAGE}，不击退`,
    `每命中 ${COMBO_HITS} 拳蓄力 ${CHARGE_TIME} 秒，打出重拳 -${HAYMAKER_DAMAGE} 并把敌人击飞`,
    '没有碰撞伤害，也不会回血',
  ],
  palette: { ball: '#dc1c18', text: '#ffffff', accent: '#d02018' },
  mirrorPalette: { ball: '#7f1d1d', text: '#fee2e2', accent: '#f87171' },
  create: (w, b) => new BoxerAbility(w, b),
  drawPortrait: drawBoxerPortrait,
}
