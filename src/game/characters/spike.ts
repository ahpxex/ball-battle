import * as dm from '../core/dmath'
import { closestPointOnSegment, pointInTriangle } from '../core/geometry'
import { type Vec, clamp, dist } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { WallBounce } from '../engine/types'
import type { CharacterDef } from './types'

/** Delay between a wall bounce and its spike popping out (s). */
export const SPIKE_DELAY = 0.65
export const SPIKE_DAMAGE = 5
/** The spike ball knows where its own spikes are and only grazes them. */
export const SELF_DAMAGE = 1
export const MAX_SPIKES = 30
/** Per-spike, per-ball re-hit cooldown (s). */
export const SPIKE_COOLDOWN = 0.4
const SPIKE_HALF_WIDTH = BALL_RADIUS * 0.5
const SPIKE_HEIGHT = BALL_RADIUS * 1.3
const GROW_TIME = 0.15
/** Extra reach of the hit test beyond the ball's radius. */
const HIT_MARGIN = BALL_RADIUS * 0.12
/** Spikes evicted by the cap fade out over this long. */
const EVICT_FADE = 0.25

interface PendingSpike {
  point: Vec
  normal: Vec
  /** World time the spike pops out. */
  due: number
}

interface IronSpike {
  base: Vec
  /** Unit normal of the wall, pointing into the arena (= spike direction). */
  normal: Vec
  born: number
  /** Last hit time per team (index = Ball.team). */
  lastHit: [number, number]
  /** World time the spike started fading out, or -1. */
  evicted: number
}

interface SpikeTriangle {
  tip: Vec
  left: Vec
  right: Vec
}

/**
 * 铁刺 (SPIKE) — every wall bounce leaves a puff of smoke, and a moment later
 * a permanent steel spike pops out of the wall at that spot. Spikes hurt ANY
 * ball that touches them, the spike ball included, so the arena slowly turns
 * into a hazard for both fighters.
 */
export class SpikeAbility extends Ability {
  private pending: PendingSpike[] = []
  private spikes: IronSpike[] = []

  override onWallBounce(e: WallBounce): void {
    if (this.owner.disarmed || !this.world.combatActive) return
    const n = e.normal
    this.pending.push({ point: { x: e.point.x, y: e.point.y }, normal: { x: n.x, y: n.y }, due: this.world.time + SPIKE_DELAY })

    const dir = dm.atan2(n.y, n.x)
    const puffAt = { x: e.point.x + n.x * BALL_RADIUS * 0.35, y: e.point.y + n.y * BALL_RADIUS * 0.35 }
    this.world.effects.burst(puffAt, {
      count: 9,
      color: ['#f4f4f5', '#e4e4e7', '#d4d4d8'],
      shape: 'smoke',
      speed: [15, 70],
      size: [BALL_RADIUS * 0.2, BALL_RADIUS * 0.36],
      life: [0.35, 0.5],
      endScale: 2,
      drag: 3.5,
      direction: dir,
      spread: 1.3,
      jitter: BALL_RADIUS * 0.25,
      front: false,
    })
    this.world.effects.burst(e.point, {
      count: 4,
      color: ['#ffffff', '#e5e7eb'],
      shape: 'spark',
      speed: [140, 300],
      size: [1.2, 2.4],
      life: [0.12, 0.28],
      direction: dir,
      spread: 1.1,
    })
  }

  override update(): void {
    const now = this.world.time
    this.spawnDue(now)
    this.spikes = this.spikes.filter((sp) => sp.evicted < 0 || now - sp.evicted < EVICT_FADE)
    if (!this.world.combatActive) return
    this.hitTest(this.enemy, now)
    this.hitTest(this.owner, now)
  }

  private spawnDue(now: number): void {
    if (this.pending.length === 0 || this.pending[0].due > now) return
    const due = this.pending.filter((p) => p.due <= now)
    this.pending = this.pending.filter((p) => p.due > now)
    for (const p of due) {
      this.spikes.push({ base: p.point, normal: p.normal, born: now, lastHit: [-Infinity, -Infinity], evicted: -1 })
      const alive = this.spikes.filter((sp) => sp.evicted < 0)
      if (alive.length > MAX_SPIKES) alive[0].evicted = now
      this.world.effects.burst(
        { x: p.point.x + p.normal.x * SPIKE_HEIGHT * 0.5, y: p.point.y + p.normal.y * SPIKE_HEIGHT * 0.5 },
        { count: 3, color: ['#ffffff', '#d1d5db'], shape: 'spark', speed: [60, 160], size: [1, 2], life: [0.1, 0.2] },
      )
      this.world.sound('place', 0.35, 0.75)
    }
  }

  private hitTest(ball: Ball, now: number): void {
    if (!ball.alive) return
    const self = ball === this.owner
    for (const sp of this.spikes) {
      if (sp.evicted >= 0) continue
      if (now - sp.lastHit[ball.team] < SPIKE_COOLDOWN) continue
      const tri = this.triangle(sp, false)
      const at = closestPointOnTriangle(ball.pos, tri)
      if (dist(at, ball.pos) >= ball.radius + HIT_MARGIN) continue
      sp.lastHit[ball.team] = now
      // The self-hit carries no source: nobody "attacked" the spike ball.
      if (self) this.world.damage(ball, SELF_DAMAGE, { kind: 'ironSpike', at, shake: 1.5, noCredit: true })
      else this.world.damage(ball, SPIKE_DAMAGE, { kind: 'ironSpike', source: this.owner, at, shake: 1.5 })
    }
  }

  /** Current triangle of a spike; `visual` adds a small pop overshoot to the grow-in. */
  private triangle(sp: IronSpike, visual: boolean): SpikeTriangle {
    const t = this.world.time
    const u = clamp((t - sp.born) / GROW_TIME, 0, 1)
    const grow = visual ? easeOutBack(u) : u
    const shrink = sp.evicted >= 0 ? clamp(1 - (t - sp.evicted) / EVICT_FADE, 0, 1) : 1
    const h = SPIKE_HEIGHT * grow * shrink
    const w = SPIKE_HALF_WIDTH * (0.35 + 0.65 * u) * shrink
    const n = sp.normal
    // Tangent along the wall.
    const tx = -n.y
    const ty = n.x
    return {
      tip: { x: sp.base.x + n.x * h, y: sp.base.y + n.y * h },
      left: { x: sp.base.x + tx * w, y: sp.base.y + ty * w },
      right: { x: sp.base.x - tx * w, y: sp.base.y - ty * w },
    }
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const now = this.world.time
    for (const sp of this.spikes) {
      const tri = this.triangle(sp, true)
      const shrink = sp.evicted >= 0 ? clamp(1 - (now - sp.evicted) / EVICT_FADE, 0, 1) : 1
      drawIronSpike(ctx, tri.tip, tri.left, tri.right, fade * shrink)
    }
  }
}

function easeOutBack(u: number): number {
  const c = 1.9
  const v = u - 1
  return 1 + (c + 1) * v * v * v + c * v * v
}

function closestPointOnTriangle(p: Vec, tri: SpikeTriangle): Vec {
  if (pointInTriangle(p, tri.tip, tri.left, tri.right)) return { x: p.x, y: p.y }
  let best = closestPointOnSegment(p, tri.left, tri.tip)
  let bestD = dist(p, best)
  for (const c of [closestPointOnSegment(p, tri.tip, tri.right), closestPointOnSegment(p, tri.right, tri.left)]) {
    const d = dist(p, c)
    if (d < bestD) {
      best = c
      bestD = d
    }
  }
  return best
}

/** A grey steel spike: lit gradient face on one side, shaded face on the other, dark outline. */
export function drawIronSpike(ctx: CanvasRenderingContext2D, tip: Vec, left: Vec, right: Vec, alpha = 1): void {
  if (alpha <= 0) return
  const midX = (left.x + right.x) / 2
  const midY = (left.y + right.y) / 2
  if (dm.hypot(tip.x - midX, tip.y - midY) < 0.5) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineJoin = 'round'

  // Shaded half.
  const dark = ctx.createLinearGradient(midX, midY, tip.x, tip.y)
  dark.addColorStop(0, '#3f434b')
  dark.addColorStop(1, '#6b7079')
  ctx.beginPath()
  ctx.moveTo(right.x, right.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(midX, midY)
  ctx.closePath()
  ctx.fillStyle = dark
  ctx.fill()

  // Lit half.
  const lit = ctx.createLinearGradient(midX, midY, tip.x, tip.y)
  lit.addColorStop(0, '#8b9099')
  lit.addColorStop(0.6, '#c4c8cf')
  lit.addColorStop(1, '#eef0f3')
  ctx.beginPath()
  ctx.moveTo(left.x, left.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(midX, midY)
  ctx.closePath()
  ctx.fillStyle = lit
  ctx.fill()

  // Ridge highlight.
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 0.8
  ctx.beginPath()
  ctx.moveTo(midX, midY)
  ctx.lineTo(tip.x, tip.y)
  ctx.stroke()

  ctx.strokeStyle = '#25282e'
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.moveTo(left.x, left.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(right.x, right.y)
  ctx.stroke()
  ctx.restore()
}

export function drawSpikePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // A cluster of spikes on the floor and one jutting from the left wall.
  const floor = cy + r * 1.8
  for (const [dx, h] of [[-1.75, 0.95], [-1.25, 1.2], [1.1, 1.25], [1.6, 0.9]] as const) {
    const x = cx + dx * r
    drawIronSpike(ctx, { x, y: floor - h * r }, { x: x - r * 0.42, y: floor }, { x: x + r * 0.42, y: floor })
  }
  const wall = cx - r * 2.4
  const wy = cy - r * 1.05
  drawIronSpike(ctx, { x: wall + r * 1.1, y: wy }, { x: wall, y: wy + r * 0.42 }, { x: wall, y: wy - r * 0.42 })

  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy - r * 0.1, r, 0, Math.PI * 2)
  ctx.fill()
  // Subtle steel sheen.
  const sheen = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.5, r * 0.1, cx, cy - r * 0.1, r)
  sheen.addColorStop(0, 'rgba(255,255,255,0.28)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fill()
}

export const spikeDef: CharacterDef = {
  id: 'spike',
  nameEn: 'SPIKE',
  ruleValues: { spikeDelay: SPIKE_DELAY, spikeDamage: SPIKE_DAMAGE, selfDamage: SELF_DAMAGE, spikeCooldown: SPIKE_COOLDOWN, maxSpikes: MAX_SPIKES },
  palette: { ball: '#808088', text: '#ffffff', accent: '#9ca3af' },
  mirrorPalette: { ball: '#4b4f58', text: '#f4f4f5', accent: '#cbd5e1' },
  create: (w, b) => new SpikeAbility(w, b),
  drawPortrait: drawSpikePortrait,
}
