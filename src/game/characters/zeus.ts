import * as dm from '../core/dmath'
import { closestPointOnSegment } from '../core/geometry'
import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const FIRST_STRIKE = 1.35
export const STRIKE_INTERVAL = 4.0
export const TELEGRAPH_TIME = 0.75
export const BOLTS = 3
/** Targets are picked within this distance of Zeus. */
const TARGET_RANGE = BALL_RADIUS * 5.7
const MARK_RADIUS = BALL_RADIUS * 0.55
/** Telegraph marks creep towards the enemy while charging (units/s). */
const MARK_DRIFT = 260
/** Blast radius around each bolt's endpoint. */
const BLAST_RADIUS = BALL_RADIUS * 1.4
const BOLT_HALF_WIDTH = BALL_RADIUS * 0.2
export const BOLT_DAMAGE = 10
const BOLT_SHOW = 0.85

interface Bolt {
  from: Vec
  to: Vec
  age: number
  /** Jagged offsets along the bolt, regenerated as it flickers. */
  seed: number
}

/**
 * 宙斯 — every few seconds marks three spots around itself; the marks
 * creep towards the enemy and then lightning strikes from Zeus to each of
 * them, blasting anything on the bolt or at its end.
 */
export class ZeusAbility extends Ability {
  private timer = FIRST_STRIKE
  private marks: Vec[] = []
  private charge = 0
  private bolts: Bolt[] = []

  override update(dt: number): void {
    for (const b of this.bolts) b.age += dt
    this.bolts = this.bolts.filter((b) => b.age < BOLT_SHOW)
    if (!this.world.combatActive) return
    if (this.marks.length > 0) {
      this.charge += dt
      this.driftMarks(dt)
      if (this.charge >= TELEGRAPH_TIME) this.strike()
      return
    }
    if (this.owner.disarmed) return
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer += STRIKE_INTERVAL
      this.mark()
    }
  }

  private mark(): void {
    const rng = this.world.rng
    const s = this.world.size
    const o = this.owner.pos
    this.marks = []
    for (let i = 0; i < BOLTS; i++) {
      const a = rng.range(0, Math.PI * 2)
      const d = rng.range(BALL_RADIUS * 1.2, TARGET_RANGE)
      this.marks.push({ x: clamp(o.x + dm.cos(a) * d, MARK_RADIUS, s - MARK_RADIUS), y: clamp(o.y + dm.sin(a) * d, MARK_RADIUS, s - MARK_RADIUS) })
    }
    this.charge = 0
    this.world.sound('zap', 0.3, 0.6)
  }

  private driftMarks(dt: number): void {
    const e = this.enemy.pos
    for (const m of this.marks) {
      const dx = e.x - m.x
      const dy = e.y - m.y
      const d = dm.hypot(dx, dy)
      if (d < 1) continue
      const step = Math.min(d, MARK_DRIFT * dt)
      m.x += (dx / d) * step
      m.y += (dy / d) * step
    }
  }

  private strike(): void {
    const o = this.owner.pos
    const e = this.enemy
    for (const m of this.marks) {
      const from = { x: o.x, y: o.y }
      this.bolts.push({ from, to: { x: m.x, y: m.y }, age: 0, seed: this.world.rng.next() * 1000 })
      this.world.effects.burst(m, { count: 16, color: ['#e5e7eb', '#cbd5e1', '#9ca3af'], shape: 'smoke', speed: [30, 150], size: [6, 12], life: [0.4, 0.8], endScale: 2 })
      this.world.effects.burst(m, { count: 10, color: ['#e0f2fe', '#ffffff', '#7dd3fc'], shape: 'spark', speed: [120, 360], size: [1.5, 3.5], life: [0.15, 0.35] })
      if (!e.alive) continue
      const onBolt = (() => {
        const p = closestPointOnSegment(e.pos, from, m)
        return dm.hypot(p.x - e.pos.x, p.y - e.pos.y) < e.radius + BOLT_HALF_WIDTH
      })()
      const inBlast = dm.hypot(e.pos.x - m.x, e.pos.y - m.y) < e.radius + BLAST_RADIUS
      if (onBolt || inBlast) {
        this.world.damage(e, BOLT_DAMAGE, { kind: 'lightning', source: this.owner, at: m, shake: 6 })
      }
    }
    this.marks = []
    this.world.sound('thunder', 1)
    this.world.addShake(3)
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    if (this.presence <= 0 || this.marks.length === 0) return
    const u = clamp(this.charge / TELEGRAPH_TIME, 0, 1)
    ctx.save()
    for (const m of this.marks) {
      ctx.fillStyle = `rgba(13,34,51,${0.5 + 0.3 * u})`
      ctx.beginPath()
      ctx.arc(m.x, m.y, MARK_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = `rgba(186,230,253,${0.5 + 0.5 * u})`
      ctx.lineWidth = 1.5
      ctx.stroke()
      // Shrinking ring counts down to the strike.
      ctx.strokeStyle = 'rgba(186,230,253,0.4)'
      ctx.beginPath()
      ctx.arc(m.x, m.y, MARK_RADIUS + (1 - u) * BLAST_RADIUS, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    for (const b of this.bolts) {
      const life = 1 - b.age / BOLT_SHOW
      // Flicker: re-roll the zigzag a few times per second.
      const seed = b.seed + Math.floor(b.age * 14) * 17
      ctx.save()
      ctx.globalAlpha = fade * life * (0.7 + 0.3 * dm.sin(b.age * 60))
      drawBolt(ctx, b.from, b.to, seed)
      ctx.restore()
    }
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawCrown(ctx, o.pos.x, o.pos.y - o.radius * 0.95, o.radius * 0.9)
  }
}

function pseudo(n: number): number {
  const x = dm.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export function drawBolt(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, seed: number): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = dm.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const segs = Math.max(4, Math.floor(len / 18))
  const pts: Vec[] = [from]
  for (let i = 1; i < segs; i++) {
    const u = i / segs
    const off = (pseudo(seed + i) - 0.5) * 22
    pts.push({ x: from.x + dx * u + nx * off, y: from.y + dy * u + ny * off })
  }
  pts.push(to)
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const p of pts) ctx.lineTo(p.x, p.y)
  }
  ctx.lineJoin = 'round'
  ctx.shadowColor = '#38bdf8'
  ctx.shadowBlur = 14
  ctx.strokeStyle = 'rgba(125,211,252,0.6)'
  ctx.lineWidth = 7
  path()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = '#f0f9ff'
  ctx.lineWidth = 2.5
  path()
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(to.x, to.y, 7, 0, Math.PI * 2)
  ctx.fill()
}

export function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const h = w * 0.55
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-0.15)
  ctx.fillStyle = '#facc15'
  ctx.strokeStyle = '#a16207'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(-w / 2, h / 2)
  ctx.lineTo(-w / 2, -h / 4)
  ctx.lineTo(-w / 4, h / 8)
  ctx.lineTo(0, -h / 2)
  ctx.lineTo(w / 4, h / 8)
  ctx.lineTo(w / 2, -h / 4)
  ctx.lineTo(w / 2, h / 2)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.arc(0, h / 4, w * 0.07, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawZeusPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawBolt(ctx, { x: cx, y: cy }, { x: cx + r * 2, y: cy + r * 1.6 }, 3)
  drawBolt(ctx, { x: cx, y: cy }, { x: cx - r * 2.1, y: cy + r * 1.2 }, 9)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  drawCrown(ctx, cx, cy - r * 0.85, r * 0.85)
}

export const zeusDef: CharacterDef = {
  id: 'zeus',
  nameEn: 'ZEUS',
  ruleValues: { strikeInterval: STRIKE_INTERVAL, bolts: BOLTS, telegraphTime: TELEGRAPH_TIME, boltDamage: BOLT_DAMAGE },
  palette: { ball: '#4cb4f4', text: '#ffffff', accent: '#50b0f8' },
  mirrorPalette: { ball: '#0e7490', text: '#cffafe', accent: '#22d3ee' },
  create: (w, b) => new ZeusAbility(w, b),
  drawPortrait: drawZeusPortrait,
}
