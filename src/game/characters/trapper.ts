import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import { predictPosition } from '../engine/predict'
import type { CharacterDef } from './types'

const FIRST_CAST = 2.4
/** Time between casts (s). */
export const CAST_INTERVAL = 4.5
export const TRAPS_PER_CAST = 3
const FLIGHT_TIME = 0.25
const EXPAND_TIME = 0.15
/** Lifetime after landing (s). */
export const TRAP_LIFETIME = 3.0
export const TRAP_RADIUS = BALL_RADIUS * 2.05
/** Side of the triangle formed by the three traps. */
const CLUSTER_SIDE = BALL_RADIUS * 5.4
const AIM_LEAD = 0.5
export const BOUNCE_DAMAGE = 1
/** Guard against double-counting one bounce across consecutive steps (s). */
const BOUNCE_GUARD = 0.04
const BARBS = 18

interface Trap {
  from: Vec
  at: Vec
  /** Time since the throw. */
  age: number
  caged: Ball | null
  lastBounce: number
  flashAt: Vec | null
}

/**
 * 陷阱师 — every few seconds throws three barbed cages, one right where the
 * enemy is heading. An enemy that ends up fully inside a cage is trapped:
 * it ricochets off the barbed rim, losing HP on every bounce, until the
 * cages vanish.
 */
export class TrapperAbility extends Ability {
  private traps: Trap[] = []
  private timer = FIRST_CAST

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += CAST_INTERVAL
        this.cast()
      }
    }
    const now = this.world.time
    const e = this.enemy
    const kept: Trap[] = []
    for (const t of this.traps) {
      t.age += dt
      if (t.age >= FLIGHT_TIME + TRAP_LIFETIME) continue
      kept.push(t)
      if (t.age < FLIGHT_TIME + EXPAND_TIME || !e.alive) continue
      this.cage(t, e, now)
    }
    this.traps = kept
  }

  private cast(): void {
    const rng = this.world.rng
    const s = this.world.size
    const margin = TRAP_RADIUS * 0.6
    const aim = predictPosition(this.enemy, AIM_LEAD + FLIGHT_TIME, s)
    // The aimed trap is one corner of an equilateral triangle; the other two sit beside it.
    const rot = rng.range(0, Math.PI * 2)
    const corners: Vec[] = [aim]
    for (const k of [0, 1]) {
      const a = rot + k * (Math.PI / 3)
      corners.push({ x: aim.x + Math.cos(a) * CLUSTER_SIDE, y: aim.y + Math.sin(a) * CLUSTER_SIDE })
    }
    for (const c of corners) {
      this.traps.push({
        from: { x: this.owner.pos.x, y: this.owner.pos.y },
        at: { x: clamp(c.x, margin, s - margin), y: clamp(c.y, margin, s - margin) },
        age: 0,
        caged: null,
        lastBounce: -Infinity,
        flashAt: null,
      })
    }
    this.world.sound('throw', 0.5, 1.3)
  }

  private cage(t: Trap, e: Ball, now: number): void {
    const dx = e.pos.x - t.at.x
    const dy = e.pos.y - t.at.y
    const d = Math.hypot(dx, dy)
    const free = TRAP_RADIUS - e.radius
    if (!t.caged) {
      // Snaps shut once the enemy is entirely inside the ring.
      if (d > free || e.pinned) return
      t.caged = e
      this.world.sound('place', 0.5, 0.6)
    }
    if (e.pinned || d <= free) return
    const nx = dx / (d || 1)
    const ny = dy / (d || 1)
    e.pos.x = t.at.x + nx * free
    e.pos.y = t.at.y + ny * free
    const vn = e.vel.x * nx + e.vel.y * ny
    if (vn <= 0) return
    e.vel.x -= 2 * vn * nx
    e.vel.y -= 2 * vn * ny
    if (now - t.lastBounce < BOUNCE_GUARD) return
    t.lastBounce = now
    const rim = { x: t.at.x + nx * TRAP_RADIUS, y: t.at.y + ny * TRAP_RADIUS }
    t.flashAt = rim
    this.world.damage(e, BOUNCE_DAMAGE, { kind: 'trap', source: this.owner, at: rim })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const now = this.world.time
    for (const t of this.traps) {
      ctx.save()
      ctx.globalAlpha = fade
      if (t.age < FLIGHT_TIME) {
        // Caltrop in flight with a dashed trail.
        const u = t.age / FLIGHT_TIME
        const x = t.from.x + (t.at.x - t.from.x) * u
        const y = t.from.y + (t.at.y - t.from.y) * u
        ctx.setLineDash([3, 4])
        ctx.strokeStyle = 'rgba(216,180,254,0.6)'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(t.from.x, t.from.y)
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.setLineDash([])
        drawTrapRing(ctx, x, y, 7, now)
      } else {
        const grow = clamp((t.age - FLIGHT_TIME) / EXPAND_TIME, 0, 1)
        drawTrapRing(ctx, t.at.x, t.at.y, TRAP_RADIUS * (0.15 + 0.85 * grow), now)
        if (t.flashAt && now - t.lastBounce < 0.2) drawCrossedDaggers(ctx, t.flashAt.x, t.flashAt.y, 1 - (now - t.lastBounce) / 0.2)
      }
      ctx.restore()
    }
  }
}

export function drawTrapRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, time: number): void {
  ctx.save()
  ctx.fillStyle = 'rgba(168,85,247,0.07)'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(192,132,252,0.85)'
  ctx.lineWidth = 1.6
  ctx.setLineDash([5, 4])
  ctx.lineDashOffset = -time * 8
  ctx.stroke()
  ctx.setLineDash([])
  // Barbs pointing along the rim.
  ctx.fillStyle = '#c084fc'
  for (let i = 0; i < BARBS; i++) {
    const a = (i / BARBS) * Math.PI * 2
    const px = x + Math.cos(a) * r
    const py = y + Math.sin(a) * r
    const tx = -Math.sin(a)
    const ty = Math.cos(a)
    const s = Math.max(2, r * 0.07)
    ctx.beginPath()
    ctx.moveTo(px + tx * s * 1.4, py + ty * s * 1.4)
    ctx.lineTo(px - tx * s * 0.6 + Math.cos(a) * s * 0.7, py - ty * s * 0.6 + Math.sin(a) * s * 0.7)
    ctx.lineTo(px - tx * s * 0.6 - Math.cos(a) * s * 0.7, py - ty * s * 0.6 - Math.sin(a) * s * 0.7)
    ctx.closePath()
    ctx.fill()
  }
  // Small triangle mark at the centre.
  const k = Math.max(2.5, r * 0.08)
  ctx.strokeStyle = 'rgba(216,180,254,0.8)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y - k)
  ctx.lineTo(x + k * 0.87, y + k * 0.5)
  ctx.lineTo(x - k * 0.87, y + k * 0.5)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

function drawCrossedDaggers(ctx: CanvasRenderingContext2D, x: number, y: number, alpha: number): void {
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.strokeStyle = '#f8fafc'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - 6, y - 6)
  ctx.lineTo(x + 6, y + 6)
  ctx.moveTo(x + 6, y - 6)
  ctx.lineTo(x - 6, y + 6)
  ctx.stroke()
  ctx.restore()
}

export function drawTrapperPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawTrapRing(ctx, cx + r * 1.0, cy - r * 0.9, r * 1.2, 0)
  drawTrapRing(ctx, cx - r * 1.5, cy - r * 1.4, r * 0.8, 0)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.3, cy + r * 0.8, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
}

export const trapperDef: CharacterDef = {
  id: 'trapper',
  name: '陷阱师',
  nameEn: 'TRAPPER',
  tagline: '进了笼子就别想出来',
  rules: [
    `每 ${CAST_INTERVAL} 秒扔出 ${TRAPS_PER_CAST} 个带刺的笼子，其中一个扔在敌人前进的路上`,
    '敌人整个进入笼子后就被关住，只能在里面来回弹',
    `每撞一次笼壁 -${BOUNCE_DAMAGE}，跑得越快扣得越多`,
    `笼子持续 ${TRAP_LIFETIME} 秒后一起消失`,
  ],
  palette: { ball: '#a855f7', text: '#ffffff', accent: '#b26ef7' },
  mirrorPalette: { ball: '#6b21a8', text: '#f3e8ff', accent: '#d946ef' },
  create: (w, b) => new TrapperAbility(w, b),
  drawPortrait: drawTrapperPortrait,
}
