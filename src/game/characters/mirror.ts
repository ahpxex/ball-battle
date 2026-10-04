import * as dm from '../core/dmath'
import { closestPointOnSegment } from '../core/geometry'
import { type Vec, clamp, distSq } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import type { DamageOptions } from '../engine/types'
import { drawBeam } from './laser'
import type { CharacterDef } from './types'

/** Share of every credited hit the mirror takes that is bounced back at the attacker. */
export const REFLECT_RATIO = 0.5
/** Damage of the banked light beam. */
export const BEAM_DAMAGE = 6
/** Time between two beams (s), counted from the previous shot. */
export const BEAM_INTERVAL = 3.0
/** Delay before the very first beam (s). */
const FIRST_BEAM = 1.6
/** Aiming time: the bank path is shown and follows the enemy (s). */
const CHARGE_TIME = 0.6
/** Final part of the charge during which the aim no longer moves (s). */
const LOCK_TIME = 0.16
const BEAM_HALF_WIDTH = 6
/** How long a fired beam stays on screen (s). */
const BEAM_SHOW = 0.24
/** How long a reflection streak stays on screen (s). */
const REFLECT_SHOW = 0.32
/** Beams re-try this soon after a disarm cancelled the charge (s). */
const RETRY_DELAY = 0.4

const BEAM_GLOW = '#7dd3fc'
const BEAM_CORE = '#ffffff'

interface BankShot {
  /** Mirror (beam origin), bounce point on the wall, and where the ray leaves the arena. */
  from: Vec
  bounce: Vec
  end: Vec
}

interface Streak {
  from: Vec
  to: Vec
  born: number
}

type Phase = 'idle' | 'charge'

/**
 * 镜子 — a polished mirror ball. Part of every hit it takes is reflected
 * straight back at the attacker; on its own it periodically banks a beam of
 * light off the nearest wall into the enemy.
 */
export class MirrorAbility extends Ability {
  private phase: Phase = 'idle'
  private timer = FIRST_BEAM
  /** Locked or tracking aim point of the current charge. */
  private aim: Vec = { x: 0, y: 0 }
  private shot: BankShot | null = null
  /** Last fired beam, kept for drawing. */
  private fired: BankShot | null = null
  private firedAt = -Infinity
  /** Fractional reflected damage not yet paid out. */
  private carry = 0
  private streaks: Streak[] = []
  private lastReflect = -Infinity
  /** Attacker owed the reflected damage in `carry`. */
  private pendingTarget: Ball | null = null

  // ───────────────────────────── reflection ─────────────────────────────

  override onOwnerDamaged(amount: number, opts: DamageOptions): void {
    const o = this.owner
    const src = opts.source
    // Only credited hits from the other side; never reflections (mirror vs mirror would loop),
    // never the overtime drain, and not the blow that shatters the mirror.
    if (!src || src.team === o.team || opts.noCredit || opts.kind === 'overtime' || opts.kind === 'reflect') return
    if (o.hp <= 0) return
    // Paid out in update(): hitting the attacker from inside its own damage call would
    // re-enter whatever loop it is running (e.g. a splitter walking its pieces).
    this.carry += amount * REFLECT_RATIO
    this.pendingTarget = src
  }

  /** Bounces the whole damage owed so far back at the attacker. */
  private payReflection(): void {
    const src = this.pendingTarget
    if (!src) return
    const n = Math.floor(this.carry)
    if (n < 1) return
    if (!src.alive) {
      this.carry = 0
      this.pendingTarget = null
      return
    }
    // Light can't hurt an invulnerable ball; the reflection is held until it can.
    if (src.invulnerable) return
    this.carry -= n
    this.pendingTarget = null
    const o = this.owner
    const d = dm.hypot(src.pos.x - o.pos.x, src.pos.y - o.pos.y) || 1
    const ux = (src.pos.x - o.pos.x) / d
    const uy = (src.pos.y - o.pos.y) / d
    const from = { x: o.pos.x + ux * o.radius, y: o.pos.y + uy * o.radius }
    const at = { x: src.pos.x - ux * src.radius, y: src.pos.y - uy * src.radius }
    this.world.damage(src, n, { kind: 'reflect', source: o, at })
    this.lastReflect = this.world.time
    this.streaks.push({ from, to: at, born: this.world.time })
    if (this.streaks.length > 6) this.streaks.shift()
    this.world.effects.burst(from, {
      count: 6,
      color: ['#ffffff', '#e0f2fe', BEAM_GLOW],
      shape: 'spark',
      speed: [60, 200],
      size: [1.5, 3],
      life: [0.15, 0.3],
      direction: dm.atan2(uy, ux),
      spread: 0.9,
    })
  }

  // ───────────────────────────── banked beam ─────────────────────────────

  override update(dt: number): void {
    const o = this.owner
    const e = this.enemy
    const now = this.world.time
    this.streaks = this.streaks.filter((s) => now - s.born < REFLECT_SHOW)
    if (this.world.combatActive) this.payReflection()
    if (!this.world.combatActive || !e.alive) {
      this.phase = 'idle'
      this.shot = null
      return
    }
    this.timer -= dt
    if (this.phase === 'idle') {
      if (this.timer > 0 || o.disarmed) return
      this.phase = 'charge'
      this.timer = CHARGE_TIME
      this.aim = { x: e.pos.x, y: e.pos.y }
      this.shot = this.bankShot(this.aim)
      this.world.sound('laser', 0.18, 2.2)
      return
    }
    // Charging.
    if (o.disarmed) {
      this.phase = 'idle'
      this.shot = null
      this.timer = RETRY_DELAY
      return
    }
    if (this.timer > LOCK_TIME) this.aim = { x: e.pos.x, y: e.pos.y }
    this.shot = this.bankShot(this.aim)
    if (this.timer > 0) return
    this.fire(this.shot)
    this.phase = 'idle'
    this.shot = null
    this.timer = BEAM_INTERVAL - CHARGE_TIME
  }

  private fire(shot: BankShot): void {
    const e = this.enemy
    this.fired = shot
    this.firedAt = this.world.time
    this.world.sound('laser', 0.45, 1.6)
    this.world.effects.burst(shot.bounce, {
      count: 10,
      color: ['#ffffff', '#e0f2fe', BEAM_GLOW],
      shape: 'spark',
      speed: [80, 260],
      size: [1.5, 3.5],
      life: [0.15, 0.35],
    })
    const reach = e.radius + BEAM_HALF_WIDTH
    let hit: Vec | null = null
    for (const [a, b] of [
      [shot.from, shot.bounce],
      [shot.bounce, shot.end],
    ] as const) {
      const p = closestPointOnSegment(e.pos, a, b)
      if (distSq(p, e.pos) < reach * reach) {
        hit = p
        break
      }
    }
    if (hit) this.world.damage(e, BEAM_DAMAGE, { kind: 'reflect', source: this.owner, at: hit, shake: 2 })
  }

  /**
   * The beam path that reaches `target` with one bounce off the closest wall:
   * aim at the target's mirror image behind the wall, then keep going after
   * the bounce until the ray leaves the arena.
   */
  private bankShot(target: Vec): BankShot {
    const m = this.owner.pos
    const s = this.world.size
    const images: Vec[] = [
      { x: -target.x, y: target.y },
      { x: 2 * s - target.x, y: target.y },
      { x: target.x, y: -target.y },
      { x: target.x, y: 2 * s - target.y },
    ]
    let best = images[0]
    let bestD = Infinity
    for (const img of images) {
      const d = distSq(m, img)
      if (d < bestD) {
        bestD = d
        best = img
      }
    }
    // Where the line towards the image crosses the wall.
    let t: number
    if (best.x < 0) t = m.x / (m.x - best.x)
    else if (best.x > s) t = (s - m.x) / (best.x - m.x)
    else if (best.y < 0) t = m.y / (m.y - best.y)
    else t = (s - m.y) / (best.y - m.y)
    t = clamp(t, 0, 1)
    const bounce = { x: m.x + (best.x - m.x) * t, y: m.y + (best.y - m.y) * t }
    // Continue from the bounce through the target to the arena edge.
    let dx = target.x - bounce.x
    let dy = target.y - bounce.y
    const l = dm.hypot(dx, dy) || 1
    dx /= l
    dy /= l
    const tx = dx > 1e-9 ? (s - bounce.x) / dx : dx < -1e-9 ? -bounce.x / dx : Infinity
    const ty = dy > 1e-9 ? (s - bounce.y) / dy : dy < -1e-9 ? -bounce.y / dy : Infinity
    const run = Math.max(l, Math.min(tx, ty))
    return { from: { x: m.x, y: m.y }, bounce, end: { x: bounce.x + dx * run, y: bounce.y + dy * run } }
  }

  // ───────────────────────────── rendering ─────────────────────────────

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const now = this.world.time
    ctx.save()
    // Aim: a dashed light path that solidifies as the shot locks in.
    if (this.phase === 'charge' && this.shot && this.owner.alive) {
      const p = 1 - clamp(this.timer / CHARGE_TIME, 0, 1)
      const locked = this.timer <= LOCK_TIME
      const shot = this.shot
      const path = () => {
        ctx.beginPath()
        ctx.moveTo(shot.from.x, shot.from.y)
        ctx.lineTo(shot.bounce.x, shot.bounce.y)
        ctx.lineTo(shot.end.x, shot.end.y)
      }
      ctx.lineJoin = 'round'
      // Soft halo under the dashes.
      ctx.globalAlpha = fade * (0.12 + 0.2 * p)
      ctx.strokeStyle = BEAM_GLOW
      ctx.lineWidth = 7
      path()
      ctx.stroke()
      ctx.globalAlpha = fade * (0.5 + 0.5 * p)
      ctx.strokeStyle = locked ? '#ffffff' : '#bae6fd'
      ctx.lineWidth = locked ? 2.6 : 1.8
      ctx.setLineDash([8, 6])
      ctx.lineDashOffset = -now * 60
      path()
      ctx.stroke()
      ctx.setLineDash([])
      // Glint where the light will strike the wall.
      ctx.globalAlpha = fade * (0.4 + 0.6 * p)
      drawGlint(ctx, this.shot.bounce.x, this.shot.bounce.y, 7 + 9 * p, now * 3)
    }
    // Fired beam, fading out.
    const age = now - this.firedAt
    if (this.fired && age < BEAM_SHOW) {
      const k = 1 - age / BEAM_SHOW
      ctx.globalAlpha = fade * k
      const grow = clamp(age / 0.05, 0, 1)
      drawBeam(ctx, this.fired.from, this.fired.bounce, BEAM_GLOW, BEAM_CORE, 3 + 4 * k)
      if (grow > 0) drawBeam(ctx, this.fired.bounce, this.fired.end, BEAM_GLOW, BEAM_CORE, 3 + 4 * k, grow)
      drawGlint(ctx, this.fired.bounce.x, this.fired.bounce.y, 14 * k + 4, 0)
    }
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const now = this.world.time
    drawMirrorSheen(ctx, o.pos.x, o.pos.y, o.radius, now)
    // Bright rim flash right after a reflection.
    const k = 1 - clamp((now - this.lastReflect) / 0.25, 0, 1)
    if (k > 0) {
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.shadowColor = BEAM_GLOW
      ctx.shadowBlur = 12
      ctx.globalAlpha = k
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, o.radius + 1.5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.streaks.length === 0) return
    const now = this.world.time
    ctx.save()
    for (const s of this.streaks) {
      const k = 1 - (now - s.born) / REFLECT_SHOW
      if (k <= 0) continue
      ctx.globalAlpha = fade * k
      drawBeam(ctx, s.from, s.to, BEAM_GLOW, BEAM_CORE, 2 + 3 * k, clamp((now - s.born) / 0.06, 0, 1))
    }
    ctx.restore()
  }
}

/** Four-pointed light glint. */
function drawGlint(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rot: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = BEAM_GLOW
  ctx.shadowBlur = 10
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const r = i % 2 === 0 ? size : size * 0.22
    const px = dm.cos(a) * r
    const py = dm.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Polished-glass look: a bright rim, two diagonal highlights and a glint that sweeps across now and then. */
function drawMirrorSheen(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, time: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  // Cool gradient towards the lower edge.
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  g.addColorStop(0, 'rgba(255,255,255,0.35)')
  g.addColorStop(0.5, 'rgba(255,255,255,0)')
  g.addColorStop(1, 'rgba(15,23,42,0.22)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.translate(cx, cy)
  ctx.rotate(-Math.PI / 4)
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillRect(-r * 0.62, -r * 1.2, r * 0.22, r * 2.4)
  ctx.fillRect(-r * 0.3, -r * 1.2, r * 0.09, r * 2.4)
  // Every 2.6 s a bright band sweeps over the surface.
  const phase = (time % 2.6) / 0.55
  if (phase < 1) {
    const x = -r * 1.3 + phase * r * 2.6
    const sweep = ctx.createLinearGradient(x - r * 0.3, 0, x + r * 0.3, 0)
    sweep.addColorStop(0, 'rgba(255,255,255,0)')
    sweep.addColorStop(0.5, 'rgba(255,255,255,0.75)')
    sweep.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = sweep
    ctx.fillRect(x - r * 0.3, -r * 1.2, r * 0.6, r * 2.4)
  }
  ctx.restore()
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawMirrorPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // A ray of light comes in, strikes the mirror ball and bounces off.
  const hit = { x: cx - r * 0.72, y: cy - r * 0.7 }
  drawBeam(ctx, { x: cx - r * 2.4, y: cy + r * 0.2 }, hit, '#fca5a5', '#fff1f2', 3.5)
  drawBeam(ctx, hit, { x: cx - r * 0.4, y: cy - r * 2.4 }, BEAM_GLOW, BEAM_CORE, 4.5)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  drawMirrorSheen(ctx, cx, cy, r, 0.2)
  drawGlint(ctx, hit.x, hit.y, r * 0.42, 0.3)
  drawGlint(ctx, cx + r * 0.95, cy + r * 1.05, r * 0.2, 0)
}

export const mirrorDef: CharacterDef = {
  id: 'mirror',
  nameEn: 'MIRROR',
  ruleValues: { reflectPercent: Math.round(REFLECT_RATIO * 100), beamInterval: BEAM_INTERVAL, beamDamage: BEAM_DAMAGE },
  palette: { ball: '#cbd5e1', text: '#0f172a', accent: '#e2e8f0' },
  mirrorPalette: { ball: '#64748b', text: '#f8fafc', accent: '#94a3b8' },
  create: (w, b) => new MirrorAbility(w, b),
  drawPortrait: drawMirrorPortrait,
}
