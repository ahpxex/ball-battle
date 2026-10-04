import * as dm from '../core/dmath'
import { type Vec, clamp, distSq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { PIXEL_FONT } from '../render/draw'
import type { CharacterDef } from './types'

/** Time from one roll starting to the next (s). */
export const ROLL_INTERVAL = 1.6
/** How long the digits spin before locking in (s). */
const ROLL_TIME = 0.7
/** The locked number hovers this long before being thrown (s). */
const SHOW_TIME = 0.2
export const MAX_NUMBER = 999
/**
 * Tail exponent of the Pareto roll: P(n ≥ x) ≈ x^-ALPHA. Smaller means
 * more frequent huge numbers.
 */
const ALPHA = 1.0
const THROW_SPEED = 470
/** Homing turn rate (rad/s) — thrown numbers curve, but can be dodged. */
const TURN_RATE = 2.4
const THROW_LIFETIME = 2.6
const HIT_PADDING = 6

/** Rolls one number in [1, MAX_NUMBER] from a heavy-tailed distribution. */
export function rollNumber(u: number): number {
  // Inverse-CDF sampling of a Pareto distribution with x_min = 1.
  const v = Math.floor(1 / dm.pow(Math.max(u, 1e-9), 1 / ALPHA))
  return clamp(v, 1, MAX_NUMBER)
}

/** Probability that a single roll is at least `x`. */
export function chanceAtLeast(x: number): number {
  return dm.pow(x, -ALPHA)
}

interface Thrown {
  value: number
  pos: Vec
  vel: Vec
  age: number
}

type RollState =
  | { kind: 'idle'; timer: number }
  | { kind: 'rolling'; t: number; value: number; flicker: number }
  | { kind: 'showing'; t: number; value: number }

/** Visual tier of a number: colour, size and how dramatic the hit is. */
function tier(value: number): { color: string; size: number; glow: number } {
  if (value >= 100) return { color: '#ff3b3b', size: 40, glow: 22 }
  if (value >= 50) return { color: '#fb923c', size: 34, glow: 14 }
  if (value >= 10) return { color: '#facc15', size: 28, glow: 8 }
  return { color: '#f8fafc', size: 22, glow: 0 }
}

/**
 * 术理球 — keeps doing sums. Every so often it rolls a random number,
 * usually tiny but occasionally in the hundreds, and hurls it at the
 * enemy: whatever the number says is the damage.
 */
export class MathBallAbility extends Ability {
  private state: RollState = { kind: 'idle', timer: 0.8 }
  private thrown: Thrown[] = []
  /** Cosmetic digits shown while rolling. */
  private shownDigits = 0

  override update(dt: number): void {
    this.updateRoll(dt)
    this.updateThrown(dt)
  }

  private updateRoll(dt: number): void {
    const st = this.state
    switch (st.kind) {
      case 'idle':
        if (!this.world.combatActive || this.owner.disarmed) return
        st.timer -= dt
        if (st.timer <= 0) {
          // The outcome is decided now (deterministic); the spin is just theatre.
          this.state = { kind: 'rolling', t: 0, value: rollNumber(this.world.rng.next()), flicker: 0 }
        }
        break
      case 'rolling':
        st.t += dt
        st.flicker -= dt
        if (st.flicker <= 0) {
          st.flicker = 0.05
          this.shownDigits = 1 + Math.floor(this.world.effects.random() * 99)
          this.world.sound('roll', 0.25, 0.9 + st.t)
        }
        if (st.t >= ROLL_TIME) {
          this.state = { kind: 'showing', t: 0, value: st.value }
          this.world.sound(st.value >= 50 ? 'jackpot' : 'place', st.value >= 50 ? 0.9 : 0.5, 1.4)
        }
        break
      case 'showing':
        st.t += dt
        if (st.t >= SHOW_TIME) {
          this.throwNumber(st.value)
          this.state = { kind: 'idle', timer: ROLL_INTERVAL - ROLL_TIME - SHOW_TIME }
        }
        break
    }
  }

  private throwNumber(value: number): void {
    const o = this.owner
    const e = this.enemy
    const dx = e.pos.x - o.pos.x
    const dy = e.pos.y - o.pos.y
    const d = dm.hypot(dx, dy) || 1
    this.thrown.push({
      value,
      pos: { x: o.pos.x, y: o.pos.y - o.radius - 14 },
      vel: { x: (dx / d) * THROW_SPEED, y: (dy / d) * THROW_SPEED },
      age: 0,
    })
    this.world.sound('throw', 0.5, value >= 50 ? 0.7 : 1.1)
  }

  private updateThrown(dt: number): void {
    const e = this.enemy
    const s = this.world.size
    const kept: Thrown[] = []
    for (const t of this.thrown) {
      t.age += dt
      if (e.alive) {
        // Steer towards the enemy with a limited turn rate.
        const want = dm.atan2(e.pos.y - t.pos.y, e.pos.x - t.pos.x)
        const cur = dm.atan2(t.vel.y, t.vel.x)
        let diff = want - cur
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        const a = cur + clamp(diff, -TURN_RATE * dt, TURN_RATE * dt)
        t.vel = { x: dm.cos(a) * THROW_SPEED, y: dm.sin(a) * THROW_SPEED }
      }
      t.pos.x += t.vel.x * dt
      t.pos.y += t.vel.y * dt
      const reach = e.radius + HIT_PADDING + tier(t.value).size * 0.3
      if (e.alive && this.world.combatActive && distSq(t.pos, e.pos) < reach * reach) {
        const big = t.value >= 50
        this.world.damage(e, t.value, {
          kind: 'math',
          source: this.owner,
          at: t.pos,
          knock: { x: (t.vel.x / THROW_SPEED) * Math.min(500, 120 + t.value * 3), y: (t.vel.y / THROW_SPEED) * Math.min(500, 120 + t.value * 3) },
          shake: big ? Math.min(14, 4 + t.value / 15) : 1,
        })
        continue
      }
      const out = t.pos.x < -40 || t.pos.x > s + 40 || t.pos.y < -40 || t.pos.y > s + 40
      if (t.age < THROW_LIFETIME && !out) kept.push(t)
    }
    this.thrown = kept
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const o = this.owner
    ctx.save()
    ctx.globalAlpha = fade
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    const st = this.state
    if (st.kind === 'rolling') {
      drawNumber(ctx, this.shownDigits, o.pos.x, o.pos.y - o.radius - 16, '#a5b4fc', 22, 0, 1)
    } else if (st.kind === 'showing') {
      const pop = 1 + Math.max(0, 0.12 - st.t) * 4
      const tr = tier(st.value)
      drawNumber(ctx, st.value, o.pos.x, o.pos.y - o.radius - 16, tr.color, tr.size, tr.glow, pop)
    }
    for (const t of this.thrown) {
      const tr = tier(t.value)
      const life = Math.min(1, (THROW_LIFETIME - t.age) / 0.3)
      ctx.globalAlpha = fade * life * 0.35
      const sp = dm.hypot(t.vel.x, t.vel.y) || 1
      ctx.strokeStyle = tr.color
      ctx.lineWidth = Math.max(2, tr.size * 0.25)
      ctx.beginPath()
      ctx.moveTo(t.pos.x, t.pos.y)
      ctx.lineTo(t.pos.x - (t.vel.x / sp) * tr.size * 1.2, t.pos.y - (t.vel.y / sp) * tr.size * 1.2)
      ctx.stroke()
      ctx.globalAlpha = fade * life
      drawNumber(ctx, t.value, t.pos.x, t.pos.y, tr.color, tr.size, tr.glow, 1)
    }
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    // A little "Σ" mark on the ball face.
    const o = this.owner
    ctx.save()
    ctx.globalAlpha = 0.25
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${Math.round(o.radius * 1.5)}px serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Σ', o.pos.x, o.pos.y + 2)
    ctx.restore()
  }
}

function drawNumber(
  ctx: CanvasRenderingContext2D,
  value: number,
  x: number,
  y: number,
  color: string,
  size: number,
  glow: number,
  scale: number,
): void {
  ctx.font = `700 ${Math.round(size * scale)}px ${PIXEL_FONT}`
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.lineWidth = 4
  ctx.strokeText(String(value), x, y)
  if (glow > 0) {
    ctx.shadowColor = color
    ctx.shadowBlur = glow
  }
  ctx.fillStyle = color
  ctx.fillText(String(value), x, y)
  ctx.shadowBlur = 0
}

export function drawMathBallPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.5, cy + r * 0.5, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  drawNumber(ctx, 7, cx - r * 1.6, cy - r * 1.3, '#f8fafc', r * 0.6, 0, 1)
  drawNumber(ctx, 42, cx + r * 0.4, cy - r * 1.6, '#facc15', r * 0.75, 6, 1)
  drawNumber(ctx, 365, cx + r * 1.3, cy - r * 0.2, '#ff3b3b', r * 0.9, 14, 1)
}

export const mathBallDef: CharacterDef = {
  id: 'mathBall',
  nameEn: 'MATH BALL',
  ruleValues: { rollInterval: ROLL_INTERVAL, maxNumber: MAX_NUMBER, chanceTwoDigitsPercent: Math.round(chanceAtLeast(10) * 100), chanceThreeDigitsPercent: (chanceAtLeast(100) * 100).toFixed(1) },
  palette: { ball: '#c026d3', text: '#ffffff', accent: '#e879f9' },
  mirrorPalette: { ball: '#6d28d9', text: '#ede9fe', accent: '#a78bfa' },
  create: (w, b) => new MathBallAbility(w, b),
  drawPortrait: drawMathBallPortrait,
}
