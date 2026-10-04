import * as dm from '../core/dmath'
import { type Vec, clamp, distSq } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const FIRST_SPAWN = 1.5
export const SPAWN_INTERVAL = 2.7
/** The cast ring shows this long before a tornado appears (s). */
const TELEGRAPH = 0.5
export const TORNADO_RADIUS = BALL_RADIUS * 1.55
const SEEK_SPEED = 108
const CARRY_SPEED = 52
const TURN_RATE = 2.2
const IDLE_LIFETIME = 9
const MAX_TORNADOES = 4
const GROW_TIME = 0.25
/** Capture timeline: damage starts after HOLD_DELAY, then TICKS ticks. */
const HOLD_DELAY = 0.75
export const TICKS = 4
const TICK_INTERVAL = 0.25
export const TICK_DAMAGE = 2
const HOLD_TIME = 1.8
const FADE_TIME = 0.25

interface Tornado {
  pos: Vec
  heading: number
  age: number
  spin: number
  captured: Ball | null
  holdT: number
  ticksDone: number
  /** Set once the tornado has spent itself; counts down the fade. */
  dying: number
}

/**
 * 飓风 — leaves a slow, homing tornado behind every few seconds. A tornado
 * that reaches the enemy sweeps it up, holds it spinning in the eye for a
 * moment while battering it, then blows itself out.
 */
export class TornadoAbility extends Ability {
  private tornadoes: Tornado[] = []
  private timer = FIRST_SPAWN

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += SPAWN_INTERVAL
        this.spawn()
      }
    }
    const e = this.enemy
    const s = this.world.size
    const kept: Tornado[] = []
    for (const t of this.tornadoes) {
      t.age += dt
      t.spin += dt * 4.5
      if (t.dying >= 0) {
        t.dying -= dt
        if (t.dying > 0) kept.push(t)
        continue
      }
      if (t.age > IDLE_LIFETIME && !t.captured) {
        t.dying = FADE_TIME
        kept.push(t)
        continue
      }
      // Drift towards the enemy with a limited turn rate.
      if (e.alive) {
        const want = dm.atan2(e.pos.y - t.pos.y, e.pos.x - t.pos.x)
        let diff = want - t.heading
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        t.heading += clamp(diff, -TURN_RATE * dt, TURN_RATE * dt)
      }
      const sp = t.captured ? CARRY_SPEED : SEEK_SPEED
      t.pos.x = clamp(t.pos.x + dm.cos(t.heading) * sp * dt, TORNADO_RADIUS * 0.5, s - TORNADO_RADIUS * 0.5)
      t.pos.y = clamp(t.pos.y + dm.sin(t.heading) * sp * dt, TORNADO_RADIUS * 0.5, s - TORNADO_RADIUS * 0.5)
      if (t.captured) this.hold(t, dt)
      else if (t.age > GROW_TIME && e.alive && this.world.combatActive && !e.pinned && !this.isHeld(e)) {
        if (distSq(e.pos, t.pos) < TORNADO_RADIUS * TORNADO_RADIUS) {
          t.captured = e
          t.holdT = 0
          t.ticksDone = 0
          e.applyRoot(HOLD_TIME)
          this.world.sound('whoosh', 0.6, 0.6)
        }
      }
      kept.push(t)
    }
    this.tornadoes = kept
  }

  private isHeld(b: Ball): boolean {
    return this.tornadoes.some((t) => t.captured === b && t.dying < 0)
  }

  private spawn(): void {
    if (this.tornadoes.length >= MAX_TORNADOES) {
      const idle = this.tornadoes.find((t) => !t.captured && t.dying < 0)
      if (idle) idle.dying = FADE_TIME
    }
    const o = this.owner
    this.tornadoes.push({
      pos: { x: o.pos.x, y: o.pos.y },
      heading: dm.atan2(this.enemy.pos.y - o.pos.y, this.enemy.pos.x - o.pos.x),
      age: 0,
      spin: this.world.rng.range(0, Math.PI * 2),
      captured: null,
      holdT: 0,
      ticksDone: 0,
      dying: -1,
    })
    this.world.sound('whoosh', 0.5, 0.8)
  }

  private hold(t: Tornado, dt: number): void {
    const e = t.captured!
    t.holdT += dt
    if (!e.alive || t.holdT >= HOLD_TIME) {
      t.captured = null
      t.dying = FADE_TIME
      return
    }
    if (!e.pinned) {
      // Reel the victim into the eye.
      const k = 1 - dm.exp(-10 * dt)
      e.pos.x += (t.pos.x - e.pos.x) * k
      e.pos.y += (t.pos.y - e.pos.y) * k
    }
    const due = Math.floor((t.holdT - HOLD_DELAY) / TICK_INTERVAL) + 1
    while (t.ticksDone < Math.min(TICKS, due) && t.holdT >= HOLD_DELAY) {
      t.ticksDone += 1
      this.world.damage(e, TICK_DAMAGE, { kind: 'wind', source: this.owner, at: e.pos })
    }
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    // Cast telegraph: a rotating dotted ring around the ball.
    if (!this.world.combatActive || this.timer > TELEGRAPH || this.owner.disarmed) return
    const o = this.owner
    const u = 1 - this.timer / TELEGRAPH
    ctx.save()
    ctx.globalAlpha = 0.25 + 0.5 * u
    ctx.strokeStyle = '#71717a'
    ctx.lineWidth = 1.5
    const a0 = this.world.time * 5
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, o.radius * 1.45, a0, a0 + Math.PI * 1.4)
    ctx.stroke()
    ctx.fillStyle = '#e4e4e7'
    for (let i = 0; i < 3; i++) {
      const a = a0 + i * 2.1
      ctx.beginPath()
      ctx.arc(o.pos.x + dm.cos(a) * o.radius * 1.45, o.pos.y + dm.sin(a) * o.radius * 1.45, 2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    for (const t of this.tornadoes) {
      const grow = clamp(t.age / GROW_TIME, 0.25, 1)
      const alpha = t.dying >= 0 ? clamp(t.dying / FADE_TIME, 0, 1) : 1
      ctx.save()
      ctx.globalAlpha = fade * alpha
      if (t.captured) {
        const c = t.captured
        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.beginPath()
        ctx.arc(c.pos.x, c.pos.y, c.radius, 0, Math.PI * 2)
        ctx.fill()
      }
      drawTornado(ctx, t.pos.x, t.pos.y, TORNADO_RADIUS * grow, t.spin, this.world.time)
      ctx.restore()
    }
  }
}

export function drawTornado(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number, time: number): void {
  ctx.save()
  // Dark translucent core.
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, 'rgba(63,63,70,0.45)')
  g.addColorStop(1, 'rgba(63,63,70,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  // Wobbly hexagonal outline that jitters every frame.
  ctx.strokeStyle = 'rgba(212,212,216,0.55)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  const jit = Math.floor(time * 20)
  for (let i = 0; i <= 6; i++) {
    const a = spin * 0.5 + (i / 6) * Math.PI * 2
    const w = 1 + 0.06 * dm.sin(jit * 1.7 + i * 2.3)
    const px = x + dm.cos(a) * r * w
    const py = y + dm.sin(a) * r * w
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
  // Curling spiral arms.
  ctx.strokeStyle = '#f4f4f5'
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  for (let arm = 0; arm < 4; arm++) {
    ctx.beginPath()
    for (let k = 0; k <= 14; k++) {
      const u = k / 14
      const a = spin + arm * (Math.PI / 2) + u * 3.2
      const rr = r * (0.12 + 0.8 * u)
      const px = x + dm.cos(a) * rr
      const py = y + dm.sin(a) * rr
      if (k === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
  ctx.restore()
}

export function drawTornadoPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawTornado(ctx, cx + r * 1.1, cy - r * 0.9, r * 1.3, 0.8, 0)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.7, cy + r * 0.8, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
}

export const tornadoDef: CharacterDef = {
  id: 'tornado',
  nameEn: 'TORNADO',
  ruleValues: { spawnInterval: SPAWN_INTERVAL, ticks: TICKS, tickDamage: TICK_DAMAGE },
  palette: { ball: '#4d7d89', text: '#ffffff', accent: '#6f9aa6' },
  mirrorPalette: { ball: '#334155', text: '#e2e8f0', accent: '#94a3b8' },
  create: (w, b) => new TornadoAbility(w, b),
  drawPortrait: drawTornadoPortrait,
}
