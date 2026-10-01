import { type Vec, angleOf, clamp, dist, len } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

const FIRST_SHOT_DELAY = 2.0
/** Cooldown from launch when the web catches something (s). */
export const HIT_COOLDOWN = 6.5
/** Cooldown from launch when the web misses (s). */
const MISS_COOLDOWN = 3.0
const WEB_RADIUS = BALL_RADIUS * 1.4
const WEB_RANGE = 420
const WEB_FLIGHT_TIME = 0.9
/** The web lingers this long after landing empty (s). */
const MISS_LINGER = 0.4
export const TRAP_DURATION = 2.6
/** The trapped enemy's disarm is refreshed every step it stays in the web, so it ends with the trap. */
const DISARM_REFRESH = 0.1
/** Speed at which the spider scuttles to its catch. */
const APPROACH_SPEED = 520
/** Centre distance while the spider is clamped onto its prey. */
const GRIP_DISTANCE = BALL_RADIUS * 1.5
export const BITE_DAMAGE = 1
/** Bites per second ramps up with fight time: base + slope·t, capped. */
const BITE_RATE_BASE = 5
const BITE_RATE_SLOPE = 0.12
const BITE_RATE_MAX = 9
const LEG_REACH = BALL_RADIUS * 2.5

type WebState =
  | { kind: 'flying'; from: Vec; to: Vec; t: number }
  | { kind: 'landed'; at: Vec; linger: number }
  | { kind: 'caught'; prey: Ball; time: number }

/** Bite rate (per second) at a given fight time. */
export function biteRate(fightTime: number): number {
  return Math.min(BITE_RATE_MAX, BITE_RATE_BASE + BITE_RATE_SLOPE * fightTime)
}

/**
 * 蜘蛛 — shoots a web at the enemy. A caught enemy is stuck in place for a
 * few seconds while the spider scuttles over, clamps on and bites
 * rapidly. Bites get faster the longer the fight lasts. A trapped enemy
 * is disarmed: it can't start new attacks until the web lets go.
 */
export class SpiderAbility extends Ability {
  private web: WebState | null = null
  private cooldown = FIRST_SHOT_DELAY
  private gripped = false
  private gripAngle = 0
  private biteTimer = 0
  private legPhase = 0
  private heading: number

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.heading = angleOf(owner.vel)
  }

  override update(dt: number): void {
    const o = this.owner
    this.legPhase += dt * 7
    if (len(o.vel) > 5 && !this.gripped) this.heading = angleOf(o.vel)
    this.cooldown = Math.max(0, this.cooldown - dt)
    const web = this.web
    if (!web) {
      if (this.cooldown <= 0 && !o.disarmed && this.world.combatActive && this.enemy.alive) this.shoot()
      return
    }
    switch (web.kind) {
      case 'flying':
        this.updateFlight(web, dt)
        break
      case 'landed':
        web.linger -= dt
        if (web.linger <= 0) this.web = null
        break
      case 'caught':
        this.updateCatch(web, dt)
        break
    }
  }

  private shoot(): void {
    const o = this.owner
    const e = this.enemy
    // Lead the target by part of the flight time.
    const aim = { x: e.pos.x + e.vel.x * 0.35, y: e.pos.y + e.vel.y * 0.35 }
    const dx = aim.x - o.pos.x
    const dy = aim.y - o.pos.y
    const d = Math.hypot(dx, dy) || 1
    const reach = Math.min(WEB_RANGE, d)
    const s = this.world.size
    const to = {
      x: clamp(o.pos.x + (dx / d) * reach, WEB_RADIUS * 0.5, s - WEB_RADIUS * 0.5),
      y: clamp(o.pos.y + (dy / d) * reach, WEB_RADIUS * 0.5, s - WEB_RADIUS * 0.5),
    }
    this.web = { kind: 'flying', from: { x: o.pos.x, y: o.pos.y }, to, t: 0 }
    this.cooldown = MISS_COOLDOWN
    this.world.sound('web', 0.7)
  }

  /** Web position along its eased-out flight. */
  private flightPos(w: { from: Vec; to: Vec; t: number }): Vec {
    const u = clamp(w.t / WEB_FLIGHT_TIME, 0, 1)
    const k = 1 - (1 - u) * (1 - u)
    return { x: w.from.x + (w.to.x - w.from.x) * k, y: w.from.y + (w.to.y - w.from.y) * k }
  }

  private updateFlight(w: { kind: 'flying'; from: Vec; to: Vec; t: number }, dt: number): void {
    w.t += dt
    const p = this.flightPos(w)
    const e = this.enemy
    // Shielded targets slip through the web.
    if (e.alive && !e.invulnerable && this.world.combatActive && dist(p, e.pos) < WEB_RADIUS * 0.75 + e.radius) {
      this.catch(e, w.t)
      return
    }
    if (w.t >= WEB_FLIGHT_TIME) this.web = { kind: 'landed', at: p, linger: MISS_LINGER }
  }

  /** `flightTime` is how long the web flew; the hit cooldown counts from launch. */
  private catch(prey: Ball, flightTime: number): void {
    prey.applyRoot(TRAP_DURATION)
    prey.applyDisarm(DISARM_REFRESH)
    this.web = { kind: 'caught', prey, time: TRAP_DURATION }
    this.cooldown = Math.max(this.cooldown, HIT_COOLDOWN - flightTime)
    this.world.sound('web', 0.9, 0.7)
  }

  private updateCatch(w: { kind: 'caught'; prey: Ball; time: number }, dt: number): void {
    const o = this.owner
    const prey = w.prey
    w.time -= dt
    if (w.time <= 0 || !prey.alive || prey.invulnerable || !this.world.combatActive) {
      this.release()
      return
    }
    // Wrapped up in silk: no new attacks until the trap ends.
    prey.applyDisarm(DISARM_REFRESH)
    if (!this.gripped) {
      // Scuttle straight over to the catch.
      const dx = prey.pos.x - o.pos.x
      const dy = prey.pos.y - o.pos.y
      const d = Math.hypot(dx, dy) || 1
      if (d <= GRIP_DISTANCE + 6) {
        this.gripped = true
        this.gripAngle = Math.atan2(o.pos.y - prey.pos.y, o.pos.x - prey.pos.x)
        o.pinned = true
        o.attachedTo = prey
        this.biteTimer = 0.05
      } else if (o.movable) {
        o.vel = { x: (dx / d) * APPROACH_SPEED, y: (dy / d) * APPROACH_SPEED }
      }
      return
    }
    o.pos.x = prey.pos.x + Math.cos(this.gripAngle) * GRIP_DISTANCE
    o.pos.y = prey.pos.y + Math.sin(this.gripAngle) * GRIP_DISTANCE
    o.vel = { x: 0, y: 0 }
    this.heading = this.gripAngle + Math.PI
    this.biteTimer -= dt
    if (this.biteTimer > 0) return
    this.biteTimer += 1 / biteRate(this.world.fightTime)
    const at = { x: (o.pos.x + prey.pos.x) / 2, y: (o.pos.y + prey.pos.y) / 2 }
    this.world.damage(prey, BITE_DAMAGE, { kind: 'spiderBite', source: o, at })
  }

  private release(): void {
    const o = this.owner
    if (this.gripped) {
      o.pinned = false
      o.attachedTo = null
      const s = o.baseSpeed
      o.vel = { x: Math.cos(this.gripAngle) * s, y: Math.sin(this.gripAngle) * s }
    }
    this.gripped = false
    this.web = null
  }

  override collidesWith(other: Ball): boolean {
    return !(this.web?.kind === 'caught' && this.web.prey === other)
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    const web = this.web
    if (fade <= 0 || !web) return
    const o = this.owner.pos
    let hub: Vec
    let alpha = fade
    if (web.kind === 'flying') hub = this.flightPos(web)
    else if (web.kind === 'landed') {
      hub = web.at
      alpha *= clamp(web.linger / MISS_LINGER, 0, 1)
    } else hub = web.prey.pos
    ctx.save()
    ctx.globalAlpha = alpha
    // Silk line back to the spider until it has arrived.
    if (!this.gripped) {
      ctx.strokeStyle = '#d4d4d8'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(o.x, o.y)
      ctx.lineTo(hub.x, hub.y)
      ctx.stroke()
    }
    const grow = web.kind === 'flying' ? clamp(web.t / 0.15, 0.3, 1) : 1
    drawWeb(ctx, hub.x, hub.y, WEB_RADIUS * grow)
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const web = this.web
    if (!web || web.kind !== 'caught' || this.presence <= 0) return
    const p = web.prey
    // Swirl over the trapped ball and a dagger marker while bites land.
    ctx.save()
    ctx.beginPath()
    ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2)
    ctx.clip()
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
    ctx.lineWidth = 1.6
    const t = this.world.time
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2 + t * 1.5
      ctx.beginPath()
      for (let k = 0; k <= 12; k++) {
        const u = k / 12
        const a = a0 + u * 2.2
        const rr = p.radius * (1 - u * 0.85)
        const x = p.pos.x + Math.cos(a) * rr
        const y = p.pos.y + Math.sin(a) * rr
        if (k === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()
    if (this.gripped) drawDagger(ctx, p.pos.x + p.radius * 0.8, p.pos.y - p.radius * 0.9)
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawSpiderLegs(ctx, o.pos.x, o.pos.y, o.radius, this.heading, this.legPhase, len(o.vel) > 5 || this.gripped)
  }
}

export function drawWeb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const spokes = 12
  ctx.strokeStyle = '#e4e4e7'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
  }
  for (let ring = 1; ring <= 4; ring++) {
    const rr = (r * ring) / 4
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2
      const px = x + Math.cos(a) * rr
      const py = y + Math.sin(a) * rr
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
  }
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(x, y, 2.5, 0, Math.PI * 2)
  ctx.fill()
}

function drawDagger(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(Math.PI / 4)
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(-1.5, -10, 3, 12)
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.moveTo(-1.5, 2)
  ctx.lineTo(0, 6)
  ctx.lineTo(1.5, 2)
  ctx.fill()
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(-4, -11, 8, 2)
  ctx.restore()
}

/** Eight legs, two per diagonal, wobbling while the spider moves. */
export function drawSpiderLegs(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  heading: number,
  phase: number,
  moving: boolean,
): void {
  const reach = LEG_REACH * (r / BALL_RADIUS)
  ctx.save()
  ctx.lineCap = 'round'
  // Offsets from the heading's perpendicular axis: two legs per diagonal.
  const offsets = [-0.65, -0.44, 0.44, 0.65]
  let i = 0
  for (const side of [-1, 1]) {
    for (const off of offsets) {
      const wobble = moving ? Math.sin(phase + i * 1.3) * 0.17 : 0
      const a = heading + side * (Math.PI / 2) + off + wobble
      const kneeA = a - side * 0.12
      const kx = cx + Math.cos(kneeA) * reach * 0.6
      const ky = cy + Math.sin(kneeA) * reach * 0.6
      const tx = cx + Math.cos(a) * reach
      const ty = cy + Math.sin(a) * reach
      ctx.strokeStyle = '#1e2a6e'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(kx, ky)
      ctx.lineTo(tx, ty)
      ctx.stroke()
      ctx.strokeStyle = '#c7d2fe'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.moveTo(kx + (tx - kx) * 0.75, ky + (ty - ky) * 0.75)
      ctx.lineTo(tx, ty)
      ctx.stroke()
      i++
    }
  }
  ctx.restore()
}

export function drawSpiderPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawWeb(ctx, cx + r * 1.5, cy + r * 1.4, r * 0.9)
  drawSpiderLegs(ctx, cx, cy, r * 0.8, -Math.PI / 2, 0, false)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2)
  ctx.fill()
}

export const spiderDef: CharacterDef = {
  id: 'spider',
  name: '蜘蛛',
  nameEn: 'SPIDER',
  tagline: '网住你，慢慢吃',
  rules: [
    `朝敌人吐出一张蛛网，网住后敌人原地定身 ${TRAP_DURATION} 秒`,
    `蜘蛛爬过去扒住猎物，每口 -${BITE_DAMAGE}，咬速随时间越来越快`,
    `命中后 ${HIT_COOLDOWN} 秒才能再吐网，落空则冷却更短`,
    '被网住期间敌人被缴械，无法发动新的攻击（已经放出去的照样有效）',
  ],
  palette: { ball: '#1b2a6b', text: '#ffffff', accent: '#5068d8' },
  mirrorPalette: { ball: '#3b0764', text: '#f3e8ff', accent: '#a855f7' },
  create: (w, b) => new SpiderAbility(w, b),
  drawPortrait: drawSpiderPortrait,
}
