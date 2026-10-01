import { type Vec, clamp, dist } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const FIRST_PULSE = 0.5
export const PULSE_INTERVAL = 1.15
export const RINGS_PER_PULSE = 5
/** Delay between consecutive rings of one pulse (s). */
const RING_GAP = 0.065
const RING_START_RADIUS = BALL_RADIUS * 0.7
/** Ring expansion speed (u/s). */
const RING_SPEED = 280
/** Rings vanish at this radius, in ball radii. */
export const RING_REACH = 5.5
const RING_MAX_RADIUS = BALL_RADIUS * RING_REACH
export const RING_MAX_DAMAGE = 3
export const RING_MIN_DAMAGE = 2
const DASHES = 5
/** Fraction of each dash slot that is drawn. */
const DASH_FILL = 0.62

interface Ring {
  center: Vec
  /** World time the ring appears (may be in the future for later rings of a pulse). */
  born: number
  hit: boolean
  /** Rotation of the dash pattern (rad). */
  phase: number
}

/**
 * 音波 (SONIC BALL) — about once a second it emits a pulse of five sound
 * rings from where it stands. Each ring sweeps outwards and hits the enemy
 * once as it passes over it, harder the closer the enemy is to the source.
 */
export class SonicAbility extends Ability {
  private timer = FIRST_PULSE
  private rings: Ring[] = []
  private pulses = 0

  override update(dt: number): void {
    const now = this.world.time
    this.rings = this.rings.filter((r) => this.radiusOf(r, now) <= RING_MAX_RADIUS)
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += PULSE_INTERVAL
        this.emitPulse(now)
      }
    }
    if (this.world.combatActive) this.hitTest(now)
  }

  private radiusOf(r: Ring, now: number): number {
    return RING_START_RADIUS + RING_SPEED * Math.max(0, now - r.born)
  }

  private emitPulse(now: number): void {
    const center = { x: this.owner.pos.x, y: this.owner.pos.y }
    const base = this.pulses * 1.37
    this.pulses += 1
    for (let i = 0; i < RINGS_PER_PULSE; i++) {
      this.rings.push({ center, born: now + i * RING_GAP, hit: false, phase: base + i * 0.47 })
    }
    this.world.sound('whoosh', 0.18, 1.7)
  }

  private hitTest(now: number): void {
    const enemy = this.enemy
    if (!enemy.alive) return
    for (const r of this.rings) {
      if (r.hit || now < r.born) continue
      const radius = this.radiusOf(r, now)
      const d = dist(enemy.pos, r.center)
      if (Math.abs(d - radius) >= enemy.radius) continue
      r.hit = true
      const amount = clamp(Math.round(RING_MAX_DAMAGE * (1 - d / RING_MAX_RADIUS)), RING_MIN_DAMAGE, RING_MAX_DAMAGE)
      this.world.damage(enemy, amount, { kind: 'sonic', source: this.owner })
      if (!enemy.alive) return
    }
  }

  override renderOverlay(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.rings.length === 0) return
    const now = this.world.time
    ctx.save()
    ctx.strokeStyle = '#c8d0ff'
    ctx.lineCap = 'round'
    for (const r of this.rings) {
      if (now < r.born) continue
      const radius = this.radiusOf(r, now)
      if (radius > RING_MAX_RADIUS) continue
      const u = (radius - RING_START_RADIUS) / (RING_MAX_RADIUS - RING_START_RADIUS)
      ctx.globalAlpha = fade * 0.8 * Math.pow(1 - u, 0.9)
      ctx.lineWidth = 2.2 - u * 0.8
      drawDashedRing(ctx, r.center.x, r.center.y, radius, r.phase)
    }
    ctx.restore()
  }
}

/** A broken circle made of DASHES evenly spaced arcs. Uses the current stroke style. */
function drawDashedRing(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, phase: number): void {
  const slot = (Math.PI * 2) / DASHES
  ctx.beginPath()
  for (let i = 0; i < DASHES; i++) {
    const a = phase + i * slot
    ctx.moveTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius)
    ctx.arc(x, y, radius, a, a + slot * DASH_FILL)
  }
  ctx.stroke()
}

export function drawSonicPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save()
  ctx.strokeStyle = '#c8d0ff'
  ctx.lineCap = 'round'
  const radii = [1.3, 1.65, 2.0, 2.35]
  radii.forEach((k, i) => {
    ctx.globalAlpha = 0.85 - i * 0.18
    ctx.lineWidth = 2.6 - i * 0.4
    drawDashedRing(ctx, cx, cy, r * k, 0.3 + i * 0.47)
  })
  ctx.restore()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

export const sonicDef: CharacterDef = {
  id: 'sonic',
  name: '音波',
  nameEn: 'SONIC BALL',
  tagline: '一圈一圈震碎你',
  rules: [
    `每 ${PULSE_INTERVAL} 秒在原地发出一次声波，一次 ${RINGS_PER_PULSE} 圈`,
    `声波环向外扩散，最远到 ${RING_REACH} 个球半径`,
    `每圈扫过敌人时命中一次，造成 ${RING_MIN_DAMAGE}–${RING_MAX_DAMAGE} 伤害`,
    '离声源越近伤害越高，没有击退',
  ],
  palette: { ball: '#2060f8', text: '#ffffff', accent: '#2f6ff0' },
  mirrorPalette: { ball: '#1e3a8a', text: '#dbeafe', accent: '#60a5fa' },
  create: (w, b) => new SonicAbility(w, b),
  drawPortrait: drawSonicPortrait,
}
