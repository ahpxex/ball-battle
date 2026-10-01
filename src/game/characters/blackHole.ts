import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const FIRST_SPAWN = 2.0
/** Average gap between new holes (s); each gap is randomised ±30%. */
export const SPAWN_INTERVAL = 1.5
export const HOLE_LIFETIME = 3.5
const GROW_TIME = 0.5
const FADE_TIME = 0.5
/** Capture radius: the enemy is caught once its centre is inside. */
export const HOLE_RADIUS = BALL_RADIUS * 1.8
const MAX_HOLES = 4
export const HOLE_DAMAGE = 5
export const HOLE_TICK = 0.75
/**
 * Spring constant of the pull towards the centre (1/s²). A ball cruising
 * at speed v settles into an orbit of radius v/√k.
 */
const PULL = 110

interface Hole {
  pos: Vec
  age: number
  captured: Ball | null
  tick: number
  spin: number
}

/**
 * 黑洞 — keeps opening small black holes at random spots. An enemy that
 * drifts into one is caught in its gravity, orbiting the centre and taking
 * heavy damage until the hole collapses.
 */
export class BlackHoleAbility extends Ability {
  private holes: Hole[] = []
  private timer = FIRST_SPAWN

  override update(dt: number): void {
    const rng = this.world.rng
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += SPAWN_INTERVAL * rng.range(0.7, 1.3)
        this.spawn()
      }
    }
    const e = this.enemy
    const kept: Hole[] = []
    for (const h of this.holes) {
      h.age += dt
      h.spin += dt
      if (h.age >= HOLE_LIFETIME) continue
      kept.push(h)
      const collapsing = h.age > HOLE_LIFETIME - FADE_TIME
      if (!e.alive || h.age < GROW_TIME * 0.6 || collapsing) {
        h.captured = null
        continue
      }
      const dx = e.pos.x - h.pos.x
      const dy = e.pos.y - h.pos.y
      if (!h.captured) {
        if (dx * dx + dy * dy > HOLE_RADIUS * HOLE_RADIUS || e.pinned) continue
        h.captured = e
        h.tick = 0
        this.world.sound('whoosh', 0.4, 0.5)
      }
      if (e.movable) {
        e.vel.x -= dx * PULL * dt
        e.vel.y -= dy * PULL * dt
      }
      h.tick -= dt
      if (h.tick <= 0 && this.world.combatActive) {
        h.tick += HOLE_TICK
        this.world.damage(e, HOLE_DAMAGE, { kind: 'gravity', source: this.owner, at: e.pos })
      }
    }
    this.holes = kept
  }

  private spawn(): void {
    const rng = this.world.rng
    const s = this.world.size
    const m = HOLE_RADIUS
    if (this.holes.length >= MAX_HOLES) this.holes.shift()
    this.holes.push({
      pos: { x: rng.range(m, s - m), y: rng.range(m, s - m) },
      age: 0,
      captured: null,
      tick: 0,
      spin: rng.range(0, Math.PI * 2),
    })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    for (const h of this.holes) {
      const grow = clamp(h.age / GROW_TIME, 0, 1)
      const shrink = clamp((HOLE_LIFETIME - h.age) / FADE_TIME, 0, 1)
      const r = HOLE_RADIUS * (0.3 + 0.7 * grow)
      ctx.save()
      ctx.globalAlpha = fade * shrink
      drawBlackHole(ctx, h.pos.x, h.pos.y, r, h.spin, h.captured !== null)
      ctx.restore()
    }
  }
}

export function drawBlackHole(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number, active: boolean): void {
  // Dark indigo band with a bright event-horizon ring and swirling wisps.
  const band = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 1.35)
  band.addColorStop(0, 'rgba(30,27,75,0)')
  band.addColorStop(0.35, 'rgba(30,27,100,0.75)')
  band.addColorStop(1, 'rgba(30,27,75,0)')
  ctx.fillStyle = band
  ctx.beginPath()
  ctx.arc(x, y, r * 1.35, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = active ? '#f5f3ff' : '#c7d2fe'
  ctx.lineWidth = active ? 2.4 : 1.6
  ctx.shadowColor = '#a5b4fc'
  ctx.shadowBlur = active ? 12 : 6
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(199,210,254,0.55)'
  ctx.lineWidth = 1.2
  for (let i = 0; i < 6; i++) {
    const a0 = spin * 2.2 + (i / 6) * Math.PI * 2
    const rr = r * (1.08 + 0.18 * ((i * 37) % 5) / 5)
    ctx.beginPath()
    ctx.arc(x, y, rr, a0, a0 + 0.7)
    ctx.stroke()
  }
}

export function drawBlackHolePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawBlackHole(ctx, cx + r * 1.0, cy - r * 0.9, r * 1.2, 0.6, true)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.7, cy + r * 0.8, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(165,180,252,0.5)'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

export const blackHoleDef: CharacterDef = {
  id: 'blackHole',
  name: '黑洞',
  nameEn: 'BLACK HOLE',
  tagline: '掉进去就出不来',
  rules: [
    `大约每 ${SPAWN_INTERVAL} 秒在场地随机位置打开一个小黑洞`,
    '敌人中心进入黑洞后被引力困住，只能绕着中心打转',
    `被困期间每 ${HOLE_TICK} 秒 -${HOLE_DAMAGE}，多个黑洞可叠加`,
    `黑洞 ${HOLE_LIFETIME} 秒后坍缩，敌人才能逃脱`,
  ],
  palette: { ball: '#12184e', text: '#ffffff', accent: '#4f5fd6' },
  mirrorPalette: { ball: '#1e1b4b', text: '#e0e7ff', accent: '#818cf8' },
  create: (w, b) => new BlackHoleAbility(w, b),
  drawPortrait: drawBlackHolePortrait,
}
