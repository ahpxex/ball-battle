import * as dm from '../core/dmath'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'
import { distSq } from '../core/vec'

const FIRST_SPAWN = 0.7
export const SPAWN_INTERVAL = 0.9
export const ORB_DAMAGE = 3
const ORB_RADIUS = 9
/** Ring k sits at RING_BASE + RING_STEP·k from the ball's centre. */
const RING_BASE = BALL_RADIUS * 1.25
const RING_STEP = BALL_RADIUS * 1.13
/** Clockwise angular speed of each ring (rad/s). */
const RING_SPEEDS = [385, 240, 150, 120].map((d) => (d * Math.PI) / 180)
export const RING_COUNT = RING_SPEEDS.length
/** Ring k holds 2k + 1 orbs. */
const capacity = (ring: number) => 2 * ring + 1
export const MAX_ORBS = Array.from({ length: RING_COUNT }, (_, k) => capacity(k)).reduce((a, b) => a + b, 0)
/** How fast orbs slide towards even spacing on their ring (1/s). */
const SPACING_RATE = 1.5
const POP_TIME = 0.12

interface Orb {
  ring: number
  /** Angle relative to the ring's rotating frame. */
  offset: number
  age: number
}

/**
 * 轨道 — grows a solar system of small orbs: one every 0.7 s, filling
 * concentric rings from the inside out (1, 3, 5, 7). Each ring spins at its
 * own speed; an orb that touches the enemy deals 3 and is spent.
 */
export class OrbitAbility extends Ability {
  private orbs: Orb[] = []
  private phases: number[] = RING_SPEEDS.map(() => 0)
  private timer = FIRST_SPAWN

  override update(dt: number): void {
    const active = this.world.combatActive
    if (active) for (let k = 0; k < RING_COUNT; k++) this.phases[k] += RING_SPEEDS[k] * dt
    if (active && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += SPAWN_INTERVAL
        this.spawn()
      }
    }
    this.relax(dt)
    for (const o of this.orbs) o.age += dt
    this.collide()
  }

  private spawn(): void {
    if (this.orbs.length >= MAX_ORBS) return
    for (let k = 0; k < RING_COUNT; k++) {
      if (this.orbs.filter((o) => o.ring === k).length < capacity(k)) {
        this.orbs.push({ ring: k, offset: this.world.rng.range(0, Math.PI * 2), age: 0 })
        return
      }
    }
  }

  /** Eases the orbs on each ring towards an even spread, keeping their order. */
  private relax(dt: number): void {
    const k = 1 - dm.exp(-SPACING_RATE * dt)
    for (let ring = 0; ring < RING_COUNT; ring++) {
      const on = this.orbs.filter((o) => o.ring === ring)
      if (on.length < 2) continue
      on.sort((a, b) => a.offset - b.offset)
      const step = (Math.PI * 2) / on.length
      // Average phase that best fits an even layout.
      let sx = 0
      let sy = 0
      on.forEach((o, i) => {
        sx += dm.cos(o.offset - i * step)
        sy += dm.sin(o.offset - i * step)
      })
      const base = dm.atan2(sy, sx)
      on.forEach((o, i) => {
        let target = base + i * step
        let diff = (target - o.offset) % (Math.PI * 2)
        if (diff > Math.PI) diff -= Math.PI * 2
        if (diff < -Math.PI) diff += Math.PI * 2
        target = o.offset + diff
        o.offset += (target - o.offset) * k
      })
    }
  }

  private orbPos(o: Orb): { x: number; y: number } {
    const a = this.phases[o.ring] + o.offset
    const r = RING_BASE + RING_STEP * o.ring
    return { x: this.owner.pos.x + dm.cos(a) * r, y: this.owner.pos.y + dm.sin(a) * r }
  }

  private collide(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const reach = e.radius + ORB_RADIUS
    this.orbs = this.orbs.filter((o) => {
      if (o.age < POP_TIME) return true
      const p = this.orbPos(o)
      if (distSq(p, e.pos) >= reach * reach) return true
      this.world.damage(e, ORB_DAMAGE, { kind: 'orb', source: this.owner, at: p })
      return false
    })
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const o = this.owner.pos
    ctx.save()
    ctx.globalAlpha = fade * 0.1
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    const used = new Set(this.orbs.map((x) => x.ring))
    for (const ring of used) {
      ctx.beginPath()
      ctx.arc(o.x, o.y, RING_BASE + RING_STEP * ring, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const orb of this.orbs) {
      const p = this.orbPos(orb)
      drawOrbitOrb(ctx, p.x, p.y, ORB_RADIUS * Math.min(1, orb.age / POP_TIME))
    }
    ctx.restore()
  }
}

export function drawOrbitOrb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  if (r <= 0) return
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r)
  g.addColorStop(0, '#ffd1e8')
  g.addColorStop(1, '#ec74aa')
  ctx.save()
  ctx.shadowColor = '#ff8cc6'
  ctx.shadowBlur = r
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawOrbitPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1.5
  for (const k of [1.4, 2.3]) {
    ctx.beginPath()
    ctx.arc(cx, cy, r * k, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  drawOrbitOrb(ctx, cx + r * 1.4, cy, r * 0.25)
  for (const a of [0.6, 2.7, 4.8]) drawOrbitOrb(ctx, cx + dm.cos(a) * r * 2.3, cy + dm.sin(a) * r * 2.3, r * 0.25)
}

export const orbitDef: CharacterDef = {
  id: 'orbit',
  nameEn: 'ORBIT BALL',
  ruleValues: { spawnInterval: SPAWN_INTERVAL, ringCount: RING_COUNT, maxOrbs: MAX_ORBS, orbDamage: ORB_DAMAGE },
  palette: { ball: '#ff70b4', text: '#ffffff', accent: '#f672a8' },
  mirrorPalette: { ball: '#be185d', text: '#fce7f3', accent: '#ec4899' },
  create: (w, b) => new OrbitAbility(w, b),
  drawPortrait: drawOrbitPortrait,
}
