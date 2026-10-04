import * as dm from '../core/dmath'
import { type Vec, distSq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { WallBounce } from '../engine/types'
import type { CharacterDef } from './types'

export const MIN_SHARDS = 2
export const MAX_SHARDS = 5
export const SHARD_DAMAGE = 2
export const MAX_LIVE_SHARDS = 60
/** Collision radius of a shard. */
const SHARD_RADIUS = BALL_RADIUS * 0.3
/** Shards skid this far into the arena before settling. */
const SKID = BALL_RADIUS * 1.0
const SETTLE_RATE = 10

interface Shard {
  pos: Vec
  vel: Vec
  /** Polygon vertices relative to `pos`. */
  shape: Vec[]
  born: number
}

/**
 * 玻璃渣 — every wall bounce shatters a handful of glass splinters onto the
 * floor by the wall. They stay until something rolls over them; each one
 * the enemy crosses cuts it for 1.
 */
export class GlassAbility extends Ability {
  private shards: Shard[] = []

  override onWallBounce(e: WallBounce): void {
    if (this.owner.disarmed) return
    const rng = this.world.rng
    const n = rng.int(MIN_SHARDS, MAX_SHARDS)
    const inward = dm.atan2(e.normal.y, e.normal.x)
    for (let i = 0; i < n; i++) {
      const a = inward + rng.range(-1.05, 1.05)
      const dist = SKID * rng.range(0.4, 1.4)
      // With exponential damping the shard travels speed/rate before stopping.
      const speed = dist * SETTLE_RATE
      const sides = rng.int(3, 5)
      const size = BALL_RADIUS * rng.range(0.15, 0.45)
      const rot = rng.range(0, Math.PI * 2)
      const shape: Vec[] = []
      for (let k = 0; k < sides; k++) {
        const t = rot + (k / sides) * Math.PI * 2 + rng.range(-0.3, 0.3)
        const r = size * rng.range(0.6, 1)
        shape.push({ x: dm.cos(t) * r, y: dm.sin(t) * r })
      }
      this.shards.push({ pos: { x: e.point.x, y: e.point.y }, vel: { x: dm.cos(a) * speed, y: dm.sin(a) * speed }, shape, born: this.world.time })
    }
    while (this.shards.length > MAX_LIVE_SHARDS) this.shards.shift()
    this.world.effects.burst(e.point, { count: 4, color: ['#e2e8f0', '#64748b'], speed: [40, 120], size: [1, 2.5], life: [0.15, 0.3] })
    this.world.sound('clack', 0.35, 2)
  }

  override update(dt: number): void {
    const k = dm.exp(-SETTLE_RATE * dt)
    const s = this.world.size
    for (const sh of this.shards) {
      sh.vel.x *= k
      sh.vel.y *= k
      sh.pos.x = Math.min(s - 4, Math.max(4, sh.pos.x + sh.vel.x * dt))
      sh.pos.y = Math.min(s - 4, Math.max(4, sh.pos.y + sh.vel.y * dt))
    }
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const reach = e.radius + SHARD_RADIUS
    this.shards = this.shards.filter((sh) => {
      if (distSq(sh.pos, e.pos) >= reach * reach) return true
      this.world.damage(e, SHARD_DAMAGE, { kind: 'glass', source: this.owner, at: sh.pos })
      return false
    })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const sh of this.shards) drawShard(ctx, sh.pos, sh.shape)
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    // Glassy sheen: soft highlight at the upper left and a thin bright rim.
    const o = this.owner
    const r = o.radius
    const g = ctx.createRadialGradient(o.pos.x - r * 0.4, o.pos.y - r * 0.4, r * 0.05, o.pos.x, o.pos.y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.55)')
    g.addColorStop(0.35, 'rgba(195,217,230,0.15)')
    g.addColorStop(1, 'rgba(120,160,200,0.25)')
    ctx.save()
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }
}

function drawShard(ctx: CanvasRenderingContext2D, pos: Vec, shape: Vec[]): void {
  ctx.fillStyle = 'rgba(150,170,196,0.6)'
  ctx.strokeStyle = 'rgba(226,236,248,0.85)'
  ctx.lineWidth = 1
  ctx.beginPath()
  shape.forEach((v, i) => {
    if (i === 0) ctx.moveTo(pos.x + v.x, pos.y + v.y)
    else ctx.lineTo(pos.x + v.x, pos.y + v.y)
  })
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Faint inner facet line.
  ctx.beginPath()
  ctx.moveTo(pos.x + shape[0].x * 0.6, pos.y + shape[0].y * 0.6)
  ctx.lineTo(pos.x + shape[1].x * 0.6, pos.y + shape[1].y * 0.6)
  ctx.stroke()
}

export function drawGlassPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const pieces: [number, number, number][] = [
    [-1.9, 1.7, 0.3],
    [-1.4, 2.0, 1.4],
    [1.6, 1.8, 2.2],
    [2.0, 1.4, 0.9],
    [1.9, -1.6, 2.8],
  ]
  for (const [dx, dy, rot] of pieces) {
    const shape = [0, 1, 2].map((k) => ({ x: dm.cos(rot + k * 2.1) * r * 0.32, y: dm.sin(rot + k * 2.1) * r * 0.32 }))
    drawShard(ctx, { x: cx + dx * r, y: cy + dy * r }, shape)
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r * 0.9)
  g.addColorStop(0, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(120,160,200,0.2)')
  ctx.fillStyle = g
  ctx.fill()
}

export const glassDef: CharacterDef = {
  id: 'glass',
  nameEn: 'GLASS BALL',
  ruleValues: { minShards: MIN_SHARDS, maxShards: MAX_SHARDS, shardDamage: SHARD_DAMAGE, maxLiveShards: MAX_LIVE_SHARDS },
  palette: { ball: '#a9cce0', text: '#ffffff', accent: '#b8c8d8' },
  mirrorPalette: { ball: '#64748b', text: '#f1f5f9', accent: '#94a3b8' },
  create: (w, b) => new GlassAbility(w, b),
  drawPortrait: drawGlassPortrait,
}
