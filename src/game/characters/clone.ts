import * as dm from '../core/dmath'
import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const FIRST_DROP = 1.5
/** Time between ghost drops (s). */
export const DROP_INTERVAL = 1.5
export const MAX_GHOSTS = 4
export const GHOST_RADIUS = BALL_RADIUS * 0.85
export const GHOST_DAMAGE = 9
/** A fresh ghost can't go off until it is this old (s). */
export const ARM_TIME = 0.3
const FADE_IN = 0.2
const BLAST_SHOW = 0.25

interface Ghost {
  pos: Vec
  age: number
  /** Cosmetic phase for the idle shimmer. */
  phase: number
}

interface Blast {
  pos: Vec
  age: number
}

/**
 * 克隆 CLONE BALL — leaves translucent copies of itself where it has been.
 * A copy stays put until the enemy runs into it, then bursts: the enemy
 * takes damage and bounces off as if it had hit a solid ball.
 */
export class CloneAbility extends Ability {
  private ghosts: Ghost[] = []
  private blasts: Blast[] = []
  private timer = FIRST_DROP

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += DROP_INTERVAL
        if (this.ghosts.length < MAX_GHOSTS) this.drop()
      }
    }
    for (const g of this.ghosts) g.age += dt
    for (const b of this.blasts) b.age += dt
    this.blasts = this.blasts.filter((b) => b.age < BLAST_SHOW)
    this.trigger()
  }

  private drop(): void {
    const at = { x: this.owner.pos.x, y: this.owner.pos.y }
    this.ghosts.push({ pos: at, age: 0, phase: this.world.effects.random() * Math.PI * 2 })
    this.world.effects.burst(at, { count: 12, color: ['#bfdbfe', '#93c5fd', '#e0f2fe', '#ffffff'], shape: 'spark', speed: [60, 200], size: [1.5, 3], life: [0.2, 0.45], jitter: GHOST_RADIUS * 0.4 })
    this.world.sound('place', 0.4, 1.3)
  }

  private trigger(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const reach = e.radius + GHOST_RADIUS
    const kept: Ghost[] = []
    for (const g of this.ghosts) {
      const dx = e.pos.x - g.pos.x
      const dy = e.pos.y - g.pos.y
      const d2 = dx * dx + dy * dy
      if (g.age < ARM_TIME || d2 >= reach * reach) {
        kept.push(g)
        continue
      }
      this.burst(g, dx, dy, Math.sqrt(d2))
    }
    this.ghosts = kept
  }

  private burst(g: Ghost, dx: number, dy: number, d: number): void {
    const e = this.enemy
    const nx = d > 1e-6 ? dx / d : 1
    const ny = d > 1e-6 ? dy / d : 0
    // Bounce off the ghost like off a solid ball: flip the velocity component heading into it.
    if (e.movable) {
      const vn = e.vel.x * nx + e.vel.y * ny
      if (vn < 0) {
        e.vel.x -= 2 * vn * nx
        e.vel.y -= 2 * vn * ny
      }
    }
    const at = { x: g.pos.x + nx * GHOST_RADIUS, y: g.pos.y + ny * GHOST_RADIUS }
    this.world.damage(e, GHOST_DAMAGE, { kind: 'ghost', source: this.owner, at, shake: 3 })
    this.blasts.push({ pos: { x: g.pos.x, y: g.pos.y }, age: 0 })
    const fx = this.world.effects
    fx.burst(g.pos, { count: 1, color: '#dbeafe', shape: 'ring', speed: [0, 0], size: [BALL_RADIUS * 0.75, BALL_RADIUS * 0.75], life: [0.3, 0.3], endScale: 2 })
    // Bubbly smoke spreading to about 3R.
    fx.burst(g.pos, { count: 16, color: ['#e5e7eb', '#d1d5db', '#f8fafc', '#cbd5e1'], shape: 'smoke', speed: [60, 230], size: [8, 15], life: [0.5, 1.0], endScale: 1.8, drag: 3.2, jitter: GHOST_RADIUS * 0.3 })
    fx.burst(g.pos, { count: 8, color: ['#bfdbfe', '#ffffff'], shape: 'spark', speed: [140, 320], size: [1.5, 3], life: [0.15, 0.35] })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const now = this.world.time
    ctx.save()
    ctx.globalAlpha = fade
    for (const g of this.ghosts) {
      const u = clamp(g.age / FADE_IN, 0, 1)
      const shimmer = 0.9 + 0.1 * dm.sin(now * 3 + g.phase)
      drawGhost(ctx, g.pos.x, g.pos.y, GHOST_RADIUS * (0.7 + 0.3 * u), u * shimmer)
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    if (this.blasts.length === 0) return
    ctx.save()
    for (const b of this.blasts) {
      // Blue-white flash growing to ~1.5R.
      const u = b.age / BLAST_SHOW
      const r = BALL_RADIUS * (0.8 + 0.7 * u)
      const g = ctx.createRadialGradient(b.pos.x, b.pos.y, 0, b.pos.x, b.pos.y, r)
      g.addColorStop(0, `rgba(255,255,255,${0.95 * (1 - u)})`)
      g.addColorStop(0.5, `rgba(191,219,254,${0.7 * (1 - u)})`)
      g.addColorStop(1, 'rgba(96,165,250,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(b.pos.x, b.pos.y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

/** A translucent blue copy of the ball with a soft glow. `alpha` 0..1 scales its opacity. */
export function drawGhost(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  const glow = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 1.45)
  glow.addColorStop(0, 'rgba(59,130,246,0.35)')
  glow.addColorStop(1, 'rgba(59,130,246,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, r * 1.45, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(42,119,253,0.4)'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(147,197,253,0.28)'
  ctx.beginPath()
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(191,219,254,0.5)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawClonePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawGhost(ctx, cx - r * 1.45, cy + r * 1.3, r * 0.7, 0.85)
  drawGhost(ctx, cx - r * 1.4, cy - r * 0.8, r * 0.7, 0.95)
  drawGhost(ctx, cx + r * 1.35, cy - r * 1.35, r * 0.7, 1)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx + r * 0.35, cy + r * 0.45, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
}

export const cloneDef: CharacterDef = {
  id: 'clone',
  nameEn: 'CLONE BALL',
  ruleValues: { dropInterval: DROP_INTERVAL, maxGhosts: MAX_GHOSTS, ghostDamage: GHOST_DAMAGE },
  palette: { ball: '#2a77fd', text: '#ffffff', accent: '#2f71f2' },
  mirrorPalette: { ball: '#1e3a8a', text: '#dbeafe', accent: '#60a5fa' },
  create: (w, b) => new CloneAbility(w, b),
  drawPortrait: drawClonePortrait,
}
