import * as dm from '../core/dmath'
import { type Vec, clamp, damp, distSq, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import { roundRectPath } from '../render/draw'
import type { CharacterDef } from './types'

/** Distance from the ball centre to the drill tip. */
const TIP_REACH = BALL_RADIUS * 2.7
/** The bit can't reach anything hugging the ball closer than this (centre distance). */
const MIN_RANGE = BALL_RADIUS * 2.2
/** Centre distance at which a drilled enemy is held. */
const HOLD_DISTANCE = BALL_RADIUS * 3.3
export const DRILL_TICKS = 7
export const DRILL_DAMAGE = 2
const TICK_INTERVAL = 0.12
/** Cooldown measured from the start of an episode (s). */
export const DRILL_COOLDOWN = 1.6
const INITIAL_COOLDOWN = 1.3
/** Both balls creep along the drill axis while grinding. */
const DRIFT_SPEED = 140

interface Episode {
  target: Ball
  axis: Vec
  ticksLeft: number
  tickTimer: number
  /** Whether we are holding the target in place (false if its own ability pins it). */
  holding: boolean
  /** The target's own velocity when it was caught; it resumes this course on release. */
  resume: Vec
  /** The drill's own velocity when it bit in. */
  ownResume: Vec
}

/**
 * 电钻 — a drill bit that always points at the enemy. When the tip sinks
 * into the enemy it bites in: both balls lock together while the drill
 * grinds a burst of quick hits, then both carry on along their own courses.
 */
export class DrillAbility extends Ability {
  private angle = 0
  private cooldown = INITIAL_COOLDOWN
  private episode: Episode | null = null
  private spin = 0

  private get tip(): Vec {
    const o = this.owner.pos
    return { x: o.x + dm.cos(this.angle) * TIP_REACH, y: o.y + dm.sin(this.angle) * TIP_REACH }
  }

  override update(dt: number): void {
    const e = this.enemy
    const o = this.owner
    if (this.episode) {
      this.grind(this.episode, dt)
      return
    }
    if (this.world.combatActive) {
      const target = dm.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)
      this.angle = lerpAngle(this.angle, target, damp(30, dt))
    }
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (this.cooldown > 0 || o.disarmed || !this.world.combatActive || !e.alive) return
    if (distSq(e.pos, o.pos) < MIN_RANGE * MIN_RANGE) return
    const tip = this.tip
    if (distSq(tip, e.pos) >= e.radius * e.radius) return
    this.start(e)
  }

  private start(target: Ball): void {
    const o = this.owner
    o.pinned = true
    const holding = !target.pinned
    if (holding) target.attachedTo = o
    this.episode = {
      target,
      axis: { x: dm.cos(this.angle), y: dm.sin(this.angle) },
      ticksLeft: DRILL_TICKS,
      tickTimer: 0,
      holding,
      resume: { x: target.vel.x, y: target.vel.y },
      ownResume: { x: o.vel.x, y: o.vel.y },
    }
    this.cooldown = DRILL_COOLDOWN
  }

  private grind(ep: Episode, dt: number): void {
    const o = this.owner
    const t = ep.target
    this.spin += dt * 30
    if (!t.alive || !this.world.combatActive) {
      this.finish(ep)
      return
    }
    const s = this.world.size
    if (!ep.holding || t.pinned) {
      // The target is fixed in place by something else: grind on the spot instead of pushing into it.
      o.vel = { x: 0, y: 0 }
    } else {
      // Creep forward along the axis together, keeping both balls inside the arena.
      const r = o.radius
      o.pos.x = clamp(o.pos.x + ep.axis.x * DRIFT_SPEED * dt, r, s - r)
      o.pos.y = clamp(o.pos.y + ep.axis.y * DRIFT_SPEED * dt, r, s - r)
      o.vel = { x: ep.axis.x * DRIFT_SPEED, y: ep.axis.y * DRIFT_SPEED }
      t.pos.x = clamp(o.pos.x + ep.axis.x * HOLD_DISTANCE, t.radius, s - t.radius)
      t.pos.y = clamp(o.pos.y + ep.axis.y * HOLD_DISTANCE, t.radius, s - t.radius)
      t.vel = { x: o.vel.x, y: o.vel.y }
    }
    this.angle = dm.atan2(t.pos.y - o.pos.y, t.pos.x - o.pos.x)

    ep.tickTimer -= dt
    if (ep.tickTimer > 0) return
    ep.tickTimer += TICK_INTERVAL
    ep.ticksLeft -= 1
    const last = ep.ticksLeft === 0
    this.world.damage(t, DRILL_DAMAGE, { kind: 'drill', source: o, at: this.tip, shake: 1.5 })
    if (last || !t.alive) this.finish(ep)
  }

  private finish(ep: Episode): void {
    const o = this.owner
    o.pinned = false
    const t = ep.target
    if (t.attachedTo === o) t.attachedTo = null
    // The lock only suspended both balls' motion: each carries on along its own course.
    if (ep.holding && t.movable) t.vel = { x: ep.resume.x, y: ep.resume.y }
    o.vel = { x: ep.ownResume.x, y: ep.ownResume.y }
    this.episode = null
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawDrill(ctx, o.pos.x, o.pos.y, this.angle, o.radius, this.spin)
  }
}

export function drawDrill(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number, spin: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const blockStart = r * 0.55
  const blockEnd = r * 1.55
  const tip = r * 2.7
  const halfW = r * 0.5
  // Motor block.
  ctx.fillStyle = '#1e2228'
  roundRectPath(ctx, blockStart, -halfW, blockEnd - blockStart, halfW * 2, 2)
  ctx.fill()
  ctx.strokeStyle = '#f8fafc'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = '#000'
  ctx.fillRect(blockStart, -halfW, r * 0.14, halfW * 2)
  // Fins.
  ctx.fillStyle = '#f8fafc'
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(blockEnd - r * 0.25, s * halfW)
    ctx.lineTo(blockEnd, s * (halfW + r * 0.22))
    ctx.lineTo(blockEnd, s * halfW)
    ctx.closePath()
    ctx.fill()
  }
  // Cone bit.
  const baseHalf = r * 0.45
  ctx.fillStyle = '#4b5563'
  ctx.beginPath()
  ctx.moveTo(blockEnd, -baseHalf)
  ctx.lineTo(tip, 0)
  ctx.lineTo(blockEnd, baseHalf)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#f8fafc'
  ctx.lineWidth = 1.2
  ctx.stroke()
  // Helical flutes, scrolling while drilling.
  ctx.save()
  ctx.clip()
  ctx.strokeStyle = 'rgba(248,250,252,0.85)'
  ctx.lineWidth = 1
  ctx.beginPath()
  const pitch = r * 0.28
  const phase = (spin * r * 0.05) % pitch
  for (let x = blockEnd - pitch + phase; x < tip; x += pitch) {
    ctx.moveTo(x, -baseHalf)
    ctx.lineTo(x + pitch * 0.9, baseHalf)
  }
  ctx.stroke()
  ctx.restore()
  ctx.strokeStyle = '#f8fafc'
  ctx.beginPath()
  ctx.arc(tip - r * 0.08, 0, r * 0.07, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawDrillPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const x = cx - r * 0.9
  const y = cy + r * 0.5
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  drawDrill(ctx, x, y, -0.45, r, 0)
}

export const drillDef: CharacterDef = {
  id: 'drill',
  nameEn: 'DRILL',
  ruleValues: { drillTicks: DRILL_TICKS, drillDamage: DRILL_DAMAGE, drillCooldown: DRILL_COOLDOWN },
  palette: { ball: '#2c5460', text: '#ffffff', accent: '#4a8798' },
  mirrorPalette: { ball: '#134e4a', text: '#ccfbf1', accent: '#14b8a6' },
  create: (w, b) => new DrillAbility(w, b),
  drawPortrait: drawDrillPortrait,
}
