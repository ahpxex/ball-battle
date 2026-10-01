import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { BallContact, WallBounce } from '../engine/types'
import type { CharacterDef } from './types'

/** Most snowmen standing at once; building another melts the oldest. */
export const MAX_SNOWMEN = 8
/** Time a snowman stands at full strength (s). */
export const SOLID_LIFE = 3.0
/** Melt-away fade after the solid life (s). */
export const MELT_TIME = 0.3
const SPAWN_FADE = 0.2
/** Delay before a fresh snowman's first throw (s). */
export const FIRST_THROW = 0.3
export const THROW_INTERVAL = 0.5
/** Snowball speed (u/s). */
export const SNOWBALL_SPEED = 480
export const SNOWBALL_RADIUS = 4
export const SNOWBALL_DAMAGE = 2
/** Contact reported on consecutive steps counts as one collision (s). */
const CONTACT_GUARD = 0.04
/** How long the throwing arm stays raised after a throw (s). */
const ARM_RAISE = 0.18

// Figure geometry in multiples of BALL_RADIUS, relative to the base centre (y up is negative).
const BASE_R = 0.5
const MID_R = 0.37
const HEAD_R = 0.28
const MID_Y = -0.72
const HEAD_Y = -1.28
/** Distance from the base centre to the top of the head. */
const FIG_TOP = -HEAD_Y + HEAD_R
/** Horizontal reach of the stick arms from the centre line. */
const FIG_HALF_WIDTH = 0.75
/** Base centre sits this far inside the wall it was built against. */
const WALL_INSET = 0.5

interface Snowman {
  /** Base-circle centre. */
  pos: Vec
  age: number
  throwTimer: number
  /** Age at the last throw, for the arm animation. */
  lastThrow: number
}

interface Snowball {
  pos: Vec
  vel: Vec
}

/**
 * 雪人 — a snowball of a ball. Every wall bounce and every collision with the
 * enemy leaves a little snowman standing at the impact point. Each snowman
 * lobs snowballs at the enemy for a few seconds and then melts away.
 */
export class SnowmanAbility extends Ability {
  private snowmen: Snowman[] = []
  private snowballs: Snowball[] = []
  private lastContact = -Infinity

  override onWallBounce(e: WallBounce): void {
    if (this.owner.disarmed || !this.world.combatActive) return
    const inset = WALL_INSET * BALL_RADIUS
    this.build({ x: e.point.x + e.normal.x * inset, y: e.point.y + e.normal.y * inset })
  }

  override onBallContact(c: BallContact): void {
    if (c.other !== this.enemy) return
    const now = this.world.time
    const fresh = now - this.lastContact > CONTACT_GUARD
    this.lastContact = now
    if (!fresh || this.owner.disarmed || !this.world.combatActive) return
    this.build(c.point)
  }

  private build(at: Vec): void {
    const s = this.world.size
    const u = BALL_RADIUS
    const pos = {
      x: clamp(at.x, FIG_HALF_WIDTH * u, s - FIG_HALF_WIDTH * u),
      y: clamp(at.y, FIG_TOP * u, s - BASE_R * u),
    }
    const standing = this.snowmen.filter((m) => m.age < SOLID_LIFE)
    // The array is in build order, so the first standing one is the oldest.
    if (standing.length >= MAX_SNOWMEN) standing[0].age = SOLID_LIFE
    this.snowmen.push({ pos, age: 0, throwTimer: FIRST_THROW, lastThrow: -Infinity })
    this.world.effects.burst({ x: pos.x, y: pos.y - u * 0.5 }, {
      count: 10,
      color: ['#ffffff', '#e0f2fe', '#cbd5e1'],
      speed: [40, 150],
      size: [2, 4],
      life: [0.25, 0.5],
      jitter: u * 0.3,
    })
    this.world.sound('place', 0.35, 1.4)
  }

  override update(dt: number): void {
    const e = this.enemy
    const canThrow = this.world.combatActive && !this.owner.disarmed && e.alive
    const kept: Snowman[] = []
    for (const m of this.snowmen) {
      m.age += dt
      if (m.age >= SOLID_LIFE + MELT_TIME) continue
      kept.push(m)
      if (m.age >= SOLID_LIFE) continue
      m.throwTimer -= dt
      if (m.throwTimer > 0) continue
      m.throwTimer += THROW_INTERVAL
      if (canThrow) this.throwFrom(m)
    }
    this.snowmen = kept
    this.moveSnowballs(dt)
  }

  private throwFrom(m: Snowman): void {
    const e = this.enemy
    const from = handPoint(m, e.pos.x >= m.pos.x ? 1 : -1)
    const dx = e.pos.x - from.x
    const dy = e.pos.y - from.y
    const d = Math.hypot(dx, dy) || 1
    this.snowballs.push({ pos: from, vel: { x: (dx / d) * SNOWBALL_SPEED, y: (dy / d) * SNOWBALL_SPEED } })
    m.lastThrow = m.age
    this.world.sound('throw', 0.18, 1.5)
  }

  private moveSnowballs(dt: number): void {
    const s = this.world.size
    const e = this.enemy
    const reach = e.radius + SNOWBALL_RADIUS
    const kept: Snowball[] = []
    for (const b of this.snowballs) {
      b.pos.x += b.vel.x * dt
      b.pos.y += b.vel.y * dt
      const r = SNOWBALL_RADIUS
      if (b.pos.x < r || b.pos.x > s - r || b.pos.y < r || b.pos.y > s - r) {
        this.world.effects.burst(
          { x: clamp(b.pos.x, 0, s), y: clamp(b.pos.y, 0, s) },
          { count: 3, color: ['#ffffff', '#e0f2fe'], speed: [20, 80], size: [1.2, 2.4], life: [0.15, 0.3] },
        )
        continue
      }
      if (e.alive && (e.pos.x - b.pos.x) ** 2 + (e.pos.y - b.pos.y) ** 2 < reach * reach) {
        this.world.damage(e, SNOWBALL_DAMAGE, { kind: 'snowball', source: this.owner, at: { x: b.pos.x, y: b.pos.y } })
        continue
      }
      kept.push(b)
    }
    this.snowballs = kept
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    // Faint grey shading so the white ball reads as a packed snowball.
    const o = this.owner
    const r = o.radius * o.drawScale
    const g = ctx.createRadialGradient(o.pos.x - r * 0.35, o.pos.y - r * 0.4, r * 0.1, o.pos.x, o.pos.y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.35)')
    g.addColorStop(0.55, 'rgba(203,213,225,0.08)')
    g.addColorStop(1, 'rgba(100,116,139,0.32)')
    ctx.save()
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  override renderOverlay(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.snowmen.length === 0) return
    const e = this.enemy
    for (const m of this.snowmen) {
      const look = e.pos.x >= m.pos.x ? 1 : -1
      const raised = m.age - m.lastThrow < ARM_RAISE
      let alpha = 1
      let tint: string | null = null
      let tintAmount = 0
      if (m.age < SPAWN_FADE) {
        // Builds up from a translucent grey lump to bright snow.
        const k = m.age / SPAWN_FADE
        alpha = 0.35 + 0.65 * k
        tint = '#9ca3af'
        tintAmount = 1 - k
      } else if (m.age >= SOLID_LIFE) {
        // Melts into a dark grey silhouette and vanishes.
        const k = clamp((m.age - SOLID_LIFE) / MELT_TIME, 0, 1)
        alpha = 1 - k * k
        tint = '#374151'
        tintAmount = clamp(k * 2, 0, 1)
      }
      ctx.save()
      ctx.globalAlpha = fade * alpha
      drawSnowmanFigure(ctx, m.pos.x, m.pos.y, BALL_RADIUS, look, raised)
      if (tint && tintAmount > 0) {
        ctx.globalAlpha = fade * alpha * tintAmount
        drawSnowmanSilhouette(ctx, m.pos.x, m.pos.y, BALL_RADIUS, look, raised, tint)
      }
      ctx.restore()
    }
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.snowballs.length === 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const b of this.snowballs) {
      const sp = Math.hypot(b.vel.x, b.vel.y) || 1
      // Short frosty trail behind the ball.
      ctx.strokeStyle = 'rgba(224,242,254,0.35)'
      ctx.lineWidth = SNOWBALL_RADIUS * 1.4
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(b.pos.x - (b.vel.x / sp) * 10, b.pos.y - (b.vel.y / sp) * 10)
      ctx.lineTo(b.pos.x, b.pos.y)
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = 'rgba(100,116,139,0.6)'
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.arc(b.pos.x, b.pos.y, SNOWBALL_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }
}

/** Where a snowman's hand on the given side is (snowballs leave from here). */
function handPoint(m: Snowman, side: number): Vec {
  const u = BALL_RADIUS
  return { x: m.pos.x + side * u * 0.7, y: m.pos.y + (MID_Y - 0.3) * u }
}

/** Stick-arm endpoints (shoulder, hand, twig) for one side. */
function armPoints(x: number, y: number, u: number, side: number, raised: boolean): [Vec, Vec, Vec] {
  const my = y + MID_Y * u
  const shoulder = { x: x + side * MID_R * u * 0.75, y: my - 0.05 * u }
  const hand = raised ? { x: x + side * 0.55 * u, y: my - 0.62 * u } : { x: x + side * 0.7 * u, y: my - 0.3 * u }
  const twig = { x: hand.x + side * 0.02 * u - (raised ? side * 0.12 * u : 0), y: hand.y - 0.12 * u }
  return [shoulder, hand, twig]
}

function strokeArms(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, look: number, raised: boolean): void {
  for (const side of [-1, 1]) {
    const [shoulder, hand, twig] = armPoints(x, y, u, side, raised && side === look)
    const mid = { x: shoulder.x + (hand.x - shoulder.x) * 0.65, y: shoulder.y + (hand.y - shoulder.y) * 0.65 }
    ctx.beginPath()
    ctx.moveTo(shoulder.x, shoulder.y)
    ctx.lineTo(hand.x, hand.y)
    ctx.moveTo(mid.x, mid.y)
    ctx.lineTo(twig.x, twig.y)
    ctx.stroke()
  }
}

function noseTip(x: number, y: number, u: number, look: number): Vec {
  return { x: x + look * (HEAD_R + 0.2) * u, y: y + (HEAD_Y + 0.04) * u }
}

function fillSnowBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.6, '#f1f5f9')
  g.addColorStop(1, '#c7dcf0')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(100,116,139,0.35)'
  ctx.lineWidth = 1
  ctx.stroke()
}

/**
 * A three-ball snowman standing upright, base centre at (x, y), sized in
 * units of `u` (one ball radius). `look` (±1) is the side it faces.
 */
export function drawSnowmanFigure(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, look: number, raised = false): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#6b4423'
  ctx.lineWidth = Math.max(1.2, u * 0.06)
  strokeArms(ctx, x, y, u, look, raised)

  fillSnowBall(ctx, x, y, BASE_R * u)
  fillSnowBall(ctx, x, y + MID_Y * u, MID_R * u)
  fillSnowBall(ctx, x, y + HEAD_Y * u, HEAD_R * u)

  // Buttons down the middle ball.
  ctx.fillStyle = '#111827'
  for (const dy of [-0.12, 0.05, 0.22]) {
    ctx.beginPath()
    ctx.arc(x + look * 0.03 * u, y + (MID_Y + dy) * u, Math.max(1, 0.045 * u), 0, Math.PI * 2)
    ctx.fill()
  }

  // Scarf around the neck with a tail hanging on the far side.
  const neckY = y + (HEAD_Y + HEAD_R - 0.05) * u
  ctx.fillStyle = '#3d7fd0'
  ctx.beginPath()
  ctx.ellipse(x, neckY, 0.3 * u, 0.08 * u, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.save()
  ctx.translate(x - look * 0.13 * u, neckY)
  ctx.rotate(look * 0.18)
  ctx.fillRect(-0.06 * u, 0, 0.12 * u, 0.34 * u)
  ctx.fillStyle = '#2f69b3'
  ctx.fillRect(-0.06 * u, 0.26 * u, 0.12 * u, 0.04 * u)
  ctx.restore()
  ctx.fillStyle = '#2f69b3'
  ctx.fillRect(x - 0.3 * u, neckY - 0.012 * u, 0.6 * u, 0.024 * u)

  // Face: dot eyes and a carrot nose pointing at the enemy's side.
  const hy = y + HEAD_Y * u
  ctx.fillStyle = '#111827'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(x + side * 0.1 * u + look * 0.04 * u, hy - 0.07 * u, Math.max(1, 0.04 * u), 0, Math.PI * 2)
    ctx.fill()
  }
  const tip = noseTip(x, y, u, look)
  ctx.fillStyle = '#f97316'
  ctx.beginPath()
  ctx.moveTo(x + look * 0.06 * u, hy - 0.01 * u)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(x + look * 0.06 * u, hy + 0.08 * u)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** The snowman's outline filled with one flat colour (spawn / melt tint). */
function drawSnowmanSilhouette(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, look: number, raised: boolean, color: string): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1.2, u * 0.06)
  strokeArms(ctx, x, y, u, look, raised)
  ctx.beginPath()
  ctx.arc(x, y, BASE_R * u, 0, Math.PI * 2)
  ctx.moveTo(x + MID_R * u, y + MID_Y * u)
  ctx.arc(x, y + MID_Y * u, MID_R * u, 0, Math.PI * 2)
  ctx.moveTo(x + HEAD_R * u, y + HEAD_Y * u)
  ctx.arc(x, y + HEAD_Y * u, HEAD_R * u, 0, Math.PI * 2)
  ctx.fill('nonzero')
  const hy = y + HEAD_Y * u
  const tip = noseTip(x, y, u, look)
  ctx.beginPath()
  ctx.moveTo(x + look * 0.06 * u, hy - 0.01 * u)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(x + look * 0.06 * u, hy + 0.08 * u)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export function drawSnowmanPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const u = r * 0.8
  drawSnowmanFigure(ctx, cx - 1.75 * r, cy + 1.55 * r, u, 1, true)
  drawSnowmanFigure(ctx, cx + 1.8 * r, cy - 0.4 * r, u, -1)
  // Snowballs in flight towards the ball.
  const balls: [number, number][] = [[-1.1, 0.25], [1.15, -0.85], [0.6, 1.6]]
  for (const [dx, dy] of balls) {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cx + dx * r, cy + dy * r, r * 0.11, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2)
  ctx.fill()
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 0.85)
  g.addColorStop(0, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(100,116,139,0.32)')
  ctx.fillStyle = g
  ctx.fill()
}

const num = (v: number): number => +v.toFixed(2)

export const snowmanDef: CharacterDef = {
  id: 'snowman',
  name: '雪人',
  nameEn: 'SNOWMAN',
  tagline: '走到哪儿堆到哪儿',
  rules: [
    `每次撞墙或撞到敌人，都会在碰撞点堆出一个雪人（最多 ${MAX_SNOWMEN} 个）`,
    `雪人原地站 ${num(SOLID_LIFE + MELT_TIME)} 秒后融化，不挡路`,
    `每个雪人每 ${THROW_INTERVAL} 秒朝敌人扔一个雪球`,
    `雪球命中 -${SNOWBALL_DAMAGE}，飞到墙边就碎掉`,
  ],
  palette: { ball: '#f4f4f4', text: '#64748b', accent: '#e5e7eb' },
  mirrorPalette: { ball: '#bcd7ee', text: '#1e3a5f', accent: '#93c5fd' },
  create: (w, b) => new SnowmanAbility(w, b),
  drawPortrait: drawSnowmanPortrait,
}
