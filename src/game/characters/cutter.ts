import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { Wall, WallBounce } from '../engine/types'
import type { CharacterDef } from './types'

export const MAX_LINES = 3
/** Lifetime of a cut line and its zone (s). */
export const LINE_LIFE = 4.5
const FADE_OUT = 0.3
/** Duration of the slash animation when a line appears (s). */
const SLASH_TIME = 0.12
export const CUT_DAMAGE = 3
/** Damage interval inside one zone (s). */
export const CUT_TICK = 0.4
/** Damage interval while inside two or more zones (s). */
export const CUT_TICK_STACKED = 0.3
/** Chords shorter than this would only cut off a sliver of a corner; skip them. */
const MIN_CHORD = BALL_RADIUS * 2
const TRAIL_POINTS = 48
const SPARKLES = 4

interface CutLine {
  a: Vec
  b: Vec
  /** +1 / -1: which side of a→b is the danger zone (sign of cross(b - a, p - a)). */
  side: number
  /** The smaller of the two pieces the chord cuts the arena into. */
  zone: Vec[]
  age: number
  seed: number
}

/** Cross product of (b - a) and (p - a): the sign tells which side of a→b the point lies on. */
function sideOf(p: Vec, a: Vec, b: Vec): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

/** The square [0,size]² clipped to the half-plane `side · sideOf(p) >= 0` (one Sutherland–Hodgman pass). */
function clipSquare(size: number, a: Vec, b: Vec, side: number): Vec[] {
  const square: Vec[] = [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ]
  const out: Vec[] = []
  for (let i = 0; i < square.length; i++) {
    const p = square[i]
    const q = square[(i + 1) % square.length]
    const dp = side * sideOf(p, a, b)
    const dq = side * sideOf(q, a, b)
    if (dp >= 0) out.push(p)
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq)
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
    }
  }
  return out
}

function polygonArea(poly: readonly Vec[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    s += p.x * q.y - q.x * p.y
  }
  return Math.abs(s) / 2
}

/**
 * 切割者 CUTTER — every flight between two wall bounces slices the arena.
 * The chord joining the two bounce points becomes a cut line for a few
 * seconds, and the smaller piece of the arena it cuts off turns into a
 * danger zone that keeps nicking the enemy while it stays inside.
 */
export class CutterAbility extends Ability {
  private lines: CutLine[] = []
  private prevPoint: Vec | null = null
  private prevWall: Wall | null = null
  private tickTimer = 0
  private trail: Vec[] = []

  override onWallBounce(e: WallBounce): void {
    const point = { x: e.point.x, y: e.point.y }
    const prev = this.prevPoint
    const sameWall = this.prevWall === e.wall
    this.prevPoint = point
    this.prevWall = e.wall
    if (!prev || sameWall) return
    if (!this.world.combatActive || this.owner.disarmed || this.lines.length >= MAX_LINES) return
    if (Math.hypot(point.x - prev.x, point.y - prev.y) < MIN_CHORD) return
    this.addLine(prev, point)
  }

  private addLine(a: Vec, b: Vec): void {
    const s = this.world.size
    const left = clipSquare(s, a, b, 1)
    const right = clipSquare(s, a, b, -1)
    const leftSmaller = polygonArea(left) <= polygonArea(right)
    this.lines.push({
      a,
      b,
      side: leftSmaller ? 1 : -1,
      zone: leftSmaller ? left : right,
      age: 0,
      seed: this.world.effects.random(),
    })
    this.world.sound('whoosh', 0.45, 1.9)
    this.world.effects.burst(b, { count: 8, color: ['#fecaca', '#ffffff', '#ef4444'], shape: 'spark', speed: [80, 240], size: [1.5, 3], life: [0.15, 0.35] })
  }

  override update(dt: number): void {
    const o = this.owner.pos
    this.trail.push({ x: o.x, y: o.y })
    if (this.trail.length > TRAIL_POINTS) this.trail.shift()

    for (const l of this.lines) l.age += dt
    this.lines = this.lines.filter((l) => l.age < LINE_LIFE)

    this.tickTimer = Math.max(0, this.tickTimer - dt)
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    let inside = 0
    for (const l of this.lines) if (l.side * sideOf(e.pos, l.a, l.b) > 0) inside++
    if (inside === 0) return
    const interval = inside >= 2 ? CUT_TICK_STACKED : CUT_TICK
    this.tickTimer = Math.min(this.tickTimer, interval)
    if (this.tickTimer > 0) return
    this.tickTimer = interval
    this.world.damage(e, CUT_DAMAGE, { kind: 'cut', source: this.owner, at: e.pos })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const now = this.world.time
    ctx.save()
    ctx.globalAlpha = fade
    drawTrail(ctx, this.trail)
    for (const l of this.lines) {
      const alpha = clamp((LINE_LIFE - l.age) / FADE_OUT, 0, 1)
      const grow = clamp(l.age / SLASH_TIME, 0, 1)
      drawZone(ctx, l.zone, l.a, l.b, l.side, alpha * grow)
    }
    for (const l of this.lines) {
      const alpha = clamp((LINE_LIFE - l.age) / FADE_OUT, 0, 1)
      const grow = clamp(l.age / SLASH_TIME, 0, 1)
      const end = { x: l.a.x + (l.b.x - l.a.x) * grow, y: l.a.y + (l.b.y - l.a.y) * grow }
      drawCutLine(ctx, l.a, end, alpha, now, l.seed)
    }
    ctx.restore()
  }
}

/** Faint grey dashed line through the cutter's recent positions. */
function drawTrail(ctx: CanvasRenderingContext2D, pts: readonly Vec[]): void {
  if (pts.length < 2) return
  ctx.save()
  ctx.strokeStyle = 'rgba(203,213,225,0.3)'
  ctx.lineWidth = 1.5
  ctx.lineCap = 'round'
  ctx.setLineDash([5, 6])
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
  ctx.restore()
}

/** Translucent red tint over a zone, a little brighter along its cut edge. */
export function drawZone(ctx: CanvasRenderingContext2D, zone: readonly Vec[], a: Vec, b: Vec, side: number, alpha: number): void {
  if (zone.length < 3 || alpha <= 0) return
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l = Math.hypot(dx, dy) || 1
  // Unit normal pointing into the zone.
  const nx = (-dy / l) * side
  const ny = (dx / l) * side
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const reach = BALL_RADIUS * 4
  const g = ctx.createLinearGradient(mx, my, mx + nx * reach, my + ny * reach)
  g.addColorStop(0, 'rgba(236,54,41,0.17)')
  g.addColorStop(1, 'rgba(236,54,41,0.07)')
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(zone[0].x, zone[0].y)
  for (let i = 1; i < zone.length; i++) ctx.lineTo(zone[i].x, zone[i].y)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Thin bright red cut with a soft glow and tiny white sparkles running along it. */
export function drawCutLine(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, alpha: number, time: number, seed: number): void {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.lineCap = 'round'
  ctx.shadowColor = '#ef4444'
  ctx.shadowBlur = 8
  ctx.strokeStyle = 'rgba(239,68,68,0.35)'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = '#ff3b30'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // Sparkles drift along the line at a steady pace.
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len > 1) {
    const speed = 140 / len
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = '#fecaca'
    ctx.shadowBlur = 4
    for (let i = 0; i < SPARKLES; i++) {
      const raw = seed + i / SPARKLES + time * speed
      const u = raw - Math.floor(raw)
      const twinkle = 0.55 + 0.45 * Math.sin(time * 18 + i * 2.3 + seed * 40)
      ctx.beginPath()
      ctx.arc(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, 1.1 + 0.6 * twinkle, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

export function drawCutterPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const e = r * 2.5
  const a = { x: cx - e, y: cy + r * 0.4 }
  const b = { x: cx + r * 0.9, y: cy - e }
  drawZone(ctx, [{ x: cx - e, y: cy - e }, b, a], a, b, -1, 1)
  drawCutLine(ctx, a, b, 1, 0, 0.15)
  ctx.save()
  ctx.strokeStyle = 'rgba(203,213,225,0.4)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 6])
  ctx.beginPath()
  ctx.moveTo(b.x + r * 0.3, b.y + r * 0.3)
  ctx.lineTo(cx + r * 0.5, cy + r * 0.7)
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx + r * 0.5, cy + r * 0.7, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
}

export const cutterDef: CharacterDef = {
  id: 'cutter',
  name: '切割者',
  nameEn: 'CUTTER',
  tagline: '一刀把场地切开',
  rules: [
    `两次撞墙之间飞过的路线变成一道切割线（最多同时 ${MAX_LINES} 道）`,
    `切割线把场地分成两块，较小的那块变成危险区，持续 ${LINE_LIFE} 秒`,
    `敌人待在危险区里每 ${CUT_TICK} 秒 -${CUT_DAMAGE}，叠在两块以上时加快到每 ${CUT_TICK_STACKED} 秒`,
    '自己不受危险区影响',
  ],
  palette: { ball: '#ec3629', text: '#ffffff', accent: '#e03830' },
  mirrorPalette: { ball: '#b91c1c', text: '#fee2e2', accent: '#f87171' },
  create: (w, b) => new CutterAbility(w, b),
  drawPortrait: drawCutterPortrait,
}
