import { closestPointOnSegment } from '../core/geometry'
import { type Vec, distSq } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { WallBounce } from '../engine/types'
import type { CharacterDef } from './types'

export const MAX_THREADS = 24
export const THREAD_DAMAGE = 1
/** Per-thread re-hit cooldown (s). */
const THREAD_COOLDOWN = 0.7
/** Sticky silk briefly slows whatever brushes through it. */
const SLOW_FACTOR = 0.72
const SLOW_DURATION = 0.35
const EVICT_FADE = 0.35

interface Thread {
  anchor: Vec
  born: number
  lastHit: number
  evicted: number
}

/**
 * 蜘蛛网 — every wall bounce pins a strand of silk to the wall. All strands
 * stay attached to the ball and sweep across the arena as it moves; any
 * strand the enemy touches cuts it and slows it down.
 */
export class CobwebAbility extends Ability {
  private threads: Thread[] = []
  /** World time until which the enemy shows clinging silk. */
  private silkUntil = -Infinity

  override onWallBounce(e: WallBounce): void {
    if (this.owner.disarmed) return
    this.threads.push({ anchor: { x: e.point.x, y: e.point.y }, born: this.world.time, lastHit: -Infinity, evicted: -1 })
    const alive = this.threads.filter((t) => t.evicted < 0)
    if (alive.length > MAX_THREADS) alive[0].evicted = this.world.time
    this.world.effects.burst(e.point, {
      count: 5,
      color: '#f4f4f5',
      shape: 'spark',
      speed: [40, 140],
      size: [1.5, 3],
      life: [0.2, 0.4],
      direction: Math.atan2(e.normal.y, e.normal.x),
      spread: 1.1,
    })
    this.world.sound('place', 0.3, 1.6)
  }

  override update(): void {
    const now = this.world.time
    this.threads = this.threads.filter((t) => t.evicted < 0 || now - t.evicted < EVICT_FADE)
    const enemy = this.enemy
    if (!enemy.alive) return
    const r2 = enemy.radius * enemy.radius
    const center = this.owner.pos
    for (const t of this.threads) {
      if (t.evicted >= 0 || now - t.lastHit < THREAD_COOLDOWN) continue
      const p = closestPointOnSegment(enemy.pos, t.anchor, center)
      if (distSq(p, enemy.pos) >= r2) continue
      t.lastHit = now
      const dealt = this.world.damage(enemy, THREAD_DAMAGE, { kind: 'thread', source: this.owner, at: p })
      if (dealt > 0) {
        enemy.applySlow(SLOW_FACTOR, SLOW_DURATION)
        this.silkUntil = now + SLOW_DURATION
      }
    }
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const e = this.enemy
    const left = this.silkUntil - this.world.time
    if (!e.alive || left <= 0 || this.presence <= 0) return
    // Silk strands clinging to the slowed enemy.
    const r = e.radius
    ctx.save()
    ctx.globalAlpha = Math.min(1, left / 0.15) * 0.7
    ctx.strokeStyle = '#f4f4f5'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const a of [0.3, 1.4, 2.5, 3.9, 5.1]) {
      ctx.moveTo(e.pos.x + Math.cos(a) * r, e.pos.y + Math.sin(a) * r)
      ctx.lineTo(e.pos.x + Math.cos(a + 2.4) * r, e.pos.y + Math.sin(a + 2.4) * r)
    }
    ctx.stroke()
    ctx.restore()
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const now = this.world.time
    const o = this.owner.pos
    ctx.save()
    ctx.lineCap = 'round'
    for (const t of this.threads) {
      const evict = t.evicted >= 0 ? Math.max(0, 1 - (now - t.evicted) / EVICT_FADE) : 1
      const twang = Math.max(0, 1 - (now - t.lastHit) / 0.3)
      const alpha = fade * evict
      if (alpha <= 0) continue
      ctx.globalAlpha = alpha * (0.75 + 0.25 * twang)
      ctx.strokeStyle = twang > 0 ? '#ffffff' : '#d4d4d8'
      ctx.lineWidth = 1.3 + twang * 1.6
      ctx.beginPath()
      ctx.moveTo(t.anchor.x, t.anchor.y)
      if (twang > 0) {
        // A plucked strand wobbles briefly.
        const mx = (t.anchor.x + o.x) / 2
        const my = (t.anchor.y + o.y) / 2
        const dx = o.x - t.anchor.x
        const dy = o.y - t.anchor.y
        const l = Math.hypot(dx, dy) || 1
        const wob = Math.sin(now * 60) * twang * 7
        ctx.quadraticCurveTo(mx - (dy / l) * wob, my + (dx / l) * wob, o.x, o.y)
      } else {
        ctx.lineTo(o.x, o.y)
      }
      ctx.stroke()
      ctx.fillStyle = '#f4f4f5'
      ctx.beginPath()
      ctx.arc(t.anchor.x, t.anchor.y, 2.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

export function drawCobwebPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save()
  ctx.strokeStyle = '#d4d4d8'
  ctx.lineWidth = 1.2
  const anchors = [
    [-2.3, -1.9], [-0.6, -2.3], [1.4, -2.3], [2.4, -0.6], [2.4, 1.6], [0.5, 2.3], [-1.7, 2.3], [-2.4, 0.4],
  ] as const
  for (const [ax, ay] of anchors) {
    ctx.beginPath()
    ctx.moveTo(cx + ax * r, cy + ay * r)
    ctx.lineTo(cx, cy)
    ctx.stroke()
    ctx.fillStyle = '#f4f4f5'
    ctx.beginPath()
    ctx.arc(cx + ax * r, cy + ay * r, 2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

export const cobwebDef: CharacterDef = {
  id: 'cobweb',
  name: '蜘蛛网',
  nameEn: 'COBWEB',
  tagline: '每一根丝都连着我',
  rules: [
    '每次撞墙都会在墙上固定一根蛛丝，另一端连着自己',
    '蛛丝跟着本体扫过整个场地',
    `敌人每碰到一根蛛丝 -${THREAD_DAMAGE}，并被短暂减速`,
    `蛛丝最多 ${MAX_THREADS} 根，越多越难躲`,
  ],
  palette: { ball: '#f4f4f5', text: '#52525b', accent: '#e4e4e7' },
  mirrorPalette: { ball: '#9ca3af', text: '#1f2937', accent: '#9ca3af' },
  create: (w, b) => new CobwebAbility(w, b),
  drawPortrait: drawCobwebPortrait,
}
