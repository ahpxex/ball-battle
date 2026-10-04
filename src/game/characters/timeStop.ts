import * as dm from '../core/dmath'
import { type Vec, clamp, cube, distSq, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import { predictPosition } from '../engine/predict'
import type { DamageOptions } from '../engine/types'
import type { CharacterDef } from './types'

const R = BALL_RADIUS
const TAU = Math.PI * 2

const FIRST_STOP = 3.0
/** Pause between the end of one time stop and the start of the next (s). */
export const STOP_COOLDOWN = 6.5
/** Length of the first time stop (s). */
export const STOP_START = 0.9
/** Every later time stop lasts this much longer (s)… */
export const STOP_GROWTH = 0.15
/** …up to this length (s). */
export const STOP_MAX = 1.5
/** A knife is thrown into the frozen air this often during a stop (s). */
export const KNIFE_INTERVAL = 0.1
export const KNIFE_DAMAGE = 1
/** Between time stops, a single knife is thrown straight at the enemy this often (s). */
export const TOSS_INTERVAL = 1.2
const FIRST_TOSS = 1.0
/** Time a thrown knife takes to reach its spot in the ring (s). */
const KNIFE_FLY_IN = 0.15
const KNIFE_SPEED = 950
const KNIFE_LENGTH = R * 1.15
/** Distance from the enemy's centre to the hanging knives. */
const RING_RADIUS = R * 2.4
/** Second ring used when the knives have to bunch up (enemy near a wall). */
const RING_OUTER = R * 2.95
/** Hanging knives keep at least this far inside the arena. */
const RING_MARGIN = 12
/** Knives closer together than this along the ring alternate between the inner and outer ring. */
const CROWDED_SPACING = R * 0.75

/** Visual timing of the grey "frozen world" sphere. */
const SPHERE_GROW = 0.35
const RESUME_FADE = 0.35

type KnifeState = 'thrown' | 'hanging' | 'flying'

interface Knife {
  state: KnifeState
  from: Vec
  slot: Vec
  pos: Vec
  /** Direction the blade points (radians). */
  angle: number
  vel: Vec
  /** Time since this knife was thrown. */
  t: number
}

interface Stop {
  /** Time since the stop began. */
  t: number
  duration: number
  /** Ring slots, in throwing order. */
  slots: Vec[]
  thrown: number
  throwTimer: number
}

/**
 * 时停 TIME STOP — every few seconds the owner stops time for the enemy:
 * the enemy freezes in place (rooted and disarmed) and the world turns grey,
 * while the owner keeps moving and throws knives that hang in mid-air in a
 * ring around the frozen enemy. When time resumes all of them fly at once.
 * Each stop lasts a little longer than the previous one, so it fits more
 * knives. Released knives keep flying until they hit or reach a wall.
 */
export class TimeStopAbility extends Ability {
  private cooldown = FIRST_STOP
  private stop: Stop | null = null
  private stops = 0
  private knives: Knife[] = []
  private tossTimer = FIRST_TOSS

  // Cosmetic state for rendering.
  private stopOrigin: Vec = { x: 0, y: 0 }
  private stopBegan = -Infinity
  private stopEnded = -Infinity
  /** Clock hands are frozen at the angle they had when time stopped. */
  private frozenHand = 0

  /** Duration of the n-th time stop (0-based). */
  private durationOf(n: number): number {
    return Math.min(STOP_MAX, STOP_START + STOP_GROWTH * n)
  }

  override update(dt: number): void {
    if (this.stop) this.updateStop(this.stop, dt)
    else {
      this.cooldown = Math.max(0, this.cooldown - dt)
      if (this.canStart()) this.begin()
      else this.updateToss(dt)
    }
    this.updateKnives(dt)
  }

  override onOwnerDamaged(_amount: number, _opts: DamageOptions): void {
    // About to die: time flows again and the knives still hanging just drop.
    if (this.owner.hp > 0 || !this.stop) return
    const fx = this.world.effects
    for (const k of this.knives) {
      if (k.state === 'flying') continue
      fx.burst(k.pos, { count: 4, color: ['#e5e7eb', '#cbd5e1', '#ffffff'], shape: 'spark', speed: [30, 120], size: [1.5, 3], life: [0.2, 0.4], gravity: 300 })
    }
    this.knives = this.knives.filter((k) => k.state === 'flying')
    this.stop = null
    this.stopEnded = this.world.time
  }

  // ───────────────────────────── time stop ─────────────────────────────

  private canStart(): boolean {
    const o = this.owner
    const e = this.enemy
    if (this.cooldown > 0 || !this.world.combatActive || o.disarmed || !e.alive) return false
    // Can't stop time while held by someone else, and a shielded target would shrug off every knife.
    if (o.pinned || o.attachedTo || e.invulnerable) return false
    return true
  }

  private begin(): void {
    const o = this.owner
    const e = this.enemy
    const duration = this.durationOf(this.stops)
    this.stops += 1
    const count = Math.floor((duration - KNIFE_FLY_IN) / KNIFE_INTERVAL + 1e-6) + 1
    this.stop = { t: 0, duration, slots: this.planRing(count), thrown: 0, throwTimer: 0.05 }
    this.freezeEnemy(duration)

    this.stopOrigin = { x: o.pos.x, y: o.pos.y }
    this.stopBegan = this.world.time
    this.frozenHand = this.world.time * 0.9
    const fx = this.world.effects
    fx.burst(o.pos, { count: 1, color: '#fde047', shape: 'ring', speed: [0, 0], size: [o.radius, o.radius], life: [0.45, 0.45], endScale: 6 })
    fx.burst(e.pos, { count: 1, color: '#e2e8f0', shape: 'ring', speed: [0, 0], size: [e.radius * 1.6, e.radius * 1.6], life: [0.35, 0.35], endScale: 0.6 })
    this.world.sound('disarm', 0.9, 0.55)
    this.world.sound('thunder', 0.35, 1.6)
    this.world.addShake(3)
  }

  /** Keeps the enemy frozen (rooted, disarmed) for `remaining` more seconds. */
  private freezeEnemy(remaining: number): void {
    const e = this.enemy
    if (!e.alive || remaining <= 0) return
    e.applyRoot(remaining)
    e.applyDisarm(remaining)
  }

  /**
   * Picks `count` spots on a ring around the enemy that lie inside the arena,
   * spread evenly over the free arc. Throwing order starts on the side facing
   * the owner and alternates outwards from there.
   */
  private planRing(count: number): Vec[] {
    const e = this.enemy.pos
    const o = this.owner.pos
    const s = this.world.size
    const inside = (a: number, r: number): boolean => {
      const x = e.x + dm.cos(a) * r
      const y = e.y + dm.sin(a) * r
      return x >= RING_MARGIN && x <= s - RING_MARGIN && y >= RING_MARGIN && y <= s - RING_MARGIN
    }
    // Sample the ring and find the free angles.
    const SAMPLES = 72
    const free: boolean[] = []
    for (let i = 0; i < SAMPLES; i++) free.push(inside((i / SAMPLES) * TAU, RING_RADIUS))
    const facing = dm.atan2(o.y - e.y, o.x - e.x)
    let angles: number[]
    /** Gap between neighbouring knives along the ring. */
    let spacing: number
    if (free.every((f) => f)) {
      const step = TAU / count
      angles = []
      for (let i = 0; i < count; i++) angles.push(facing + i * step)
      spacing = RING_RADIUS * step
    } else {
      // Longest free run of samples (circular); spread the knives over it.
      let bestStart = 0
      let bestLen = 0
      for (let i = 0; i < SAMPLES; i++) {
        if (!free[i] || free[(i + SAMPLES - 1) % SAMPLES]) continue
        let n = 0
        while (n < SAMPLES && free[(i + n) % SAMPLES]) n++
        if (n > bestLen) {
          bestLen = n
          bestStart = i
        }
      }
      if (bestLen === 0) {
        // Never happens in a 600-wide arena, but stay safe: point at the arena centre.
        bestStart = Math.round((dm.atan2(s / 2 - e.y, s / 2 - e.x) / TAU) * SAMPLES)
        bestLen = 1
      }
      const a0 = (bestStart / SAMPLES) * TAU
      const span = ((bestLen - 1) / SAMPLES) * TAU
      angles = []
      for (let i = 0; i < count; i++) angles.push(a0 + (count === 1 ? span / 2 : (span * i) / (count - 1)))
      spacing = count > 1 ? (RING_RADIUS * span) / (count - 1) : Infinity
    }
    // Throwing order: closest to the owner first, then alternating outwards.
    const order = angles.map((a, i) => ({ a, i, d: Math.abs(dm.atan2(dm.sin(a - facing), dm.cos(a - facing))) }))
    order.sort((p, q) => p.d - q.d || p.i - q.i)
    const crowded = spacing < CROWDED_SPACING
    return order.map(({ a, i }) => {
      const r = crowded && i % 2 === 1 && inside(a, RING_OUTER) ? RING_OUTER : RING_RADIUS
      return { x: e.x + dm.cos(a) * r, y: e.y + dm.sin(a) * r }
    })
  }

  private updateStop(st: Stop, dt: number): void {
    st.t += dt
    const remaining = st.duration - st.t
    if (remaining <= 0 || !this.enemy.alive || !this.world.combatActive) {
      this.resume()
      return
    }
    this.freezeEnemy(remaining)
    // Throwing a knife is a new attack: paused while the owner is disarmed.
    st.throwTimer -= dt
    if (st.throwTimer <= 0 && st.thrown < st.slots.length && !this.owner.disarmed) {
      st.throwTimer += KNIFE_INTERVAL
      this.throwKnife(st.slots[st.thrown])
      st.thrown += 1
    } else if (st.throwTimer < 0) st.throwTimer = 0
  }

  private throwKnife(slot: Vec): void {
    const o = this.owner.pos
    const angle = dm.atan2(slot.y - o.y, slot.x - o.x)
    this.knives.push({ state: 'thrown', from: { x: o.x, y: o.y }, slot, pos: { x: o.x, y: o.y }, angle, vel: { x: 0, y: 0 }, t: 0 })
    this.world.sound('throw', 0.35, 1.5)
  }

  /** Plain knife throws between time stops (a new attack each: not while disarmed or held). */
  private updateToss(dt: number): void {
    const o = this.owner
    const e = this.enemy
    if (!this.world.combatActive || o.disarmed || o.pinned || o.attachedTo || !e.alive) return
    this.tossTimer -= dt
    if (this.tossTimer > 0) return
    this.tossTimer += TOSS_INTERVAL
    // Lead the target along its (wall-reflected) path.
    let p = e.pos
    for (let i = 0; i < 2; i++) {
      const t = Math.max(0, dm.hypot(p.x - o.pos.x, p.y - o.pos.y) - o.radius) / KNIFE_SPEED
      p = predictPosition(e, t, this.world.size)
    }
    const angle = dm.atan2(p.y - o.pos.y, p.x - o.pos.x)
    const dx = dm.cos(angle)
    const dy = dm.sin(angle)
    const start = { x: o.pos.x + dx * o.radius, y: o.pos.y + dy * o.radius }
    this.knives.push({
      state: 'flying',
      from: start,
      slot: start,
      pos: { x: start.x, y: start.y },
      angle,
      vel: { x: dx * KNIFE_SPEED, y: dy * KNIFE_SPEED },
      t: 0,
    })
    this.world.sound('throw', 0.3, 1.6)
  }

  /** Time flows again: every hanging knife flies at the enemy at once. */
  private resume(): void {
    this.stop = null
    this.cooldown = STOP_COOLDOWN
    this.stopEnded = this.world.time
    const e = this.enemy
    let launched = 0
    for (const k of this.knives) {
      if (k.state === 'flying') continue
      if (k.state === 'thrown') k.pos = { x: k.slot.x, y: k.slot.y }
      k.angle = dm.atan2(e.pos.y - k.pos.y, e.pos.x - k.pos.x)
      k.state = 'flying'
      k.vel = { x: dm.cos(k.angle) * KNIFE_SPEED, y: dm.sin(k.angle) * KNIFE_SPEED }
      launched++
    }
    if (launched > 0) this.world.sound('whoosh', 0.8, 1.3)
    this.world.effects.burst(e.pos, {
      count: 1,
      color: '#fde047',
      shape: 'ring',
      speed: [0, 0],
      size: [RING_RADIUS, RING_RADIUS],
      life: [0.25, 0.25],
      endScale: 0.35,
    })
  }

  private updateKnives(dt: number): void {
    const e = this.enemy
    const s = this.world.size
    const fx = this.world.effects
    const kept: Knife[] = []
    for (const k of this.knives) {
      k.t += dt
      if (k.state === 'thrown') {
        const u = clamp(k.t / KNIFE_FLY_IN, 0, 1)
        const ease = 1 - cube(1 - u)
        k.pos = { x: k.from.x + (k.slot.x - k.from.x) * ease, y: k.from.y + (k.slot.y - k.from.y) * ease }
        if (u >= 1) {
          k.state = 'hanging'
          fx.burst(k.pos, { count: 3, color: ['#ffffff', '#e2e8f0'], shape: 'spark', speed: [20, 70], size: [1.2, 2.2], life: [0.12, 0.25] })
        }
      }
      if (k.state !== 'flying') {
        // Blades turn to face the frozen enemy.
        if (e.alive) k.angle = dm.atan2(e.pos.y - k.pos.y, e.pos.x - k.pos.x)
        kept.push(k)
        continue
      }
      k.pos.x += k.vel.x * dt
      k.pos.y += k.vel.y * dt
      const half = KNIFE_LENGTH / 2
      const tip = { x: k.pos.x + dm.cos(k.angle) * half, y: k.pos.y + dm.sin(k.angle) * half }
      if (e.alive && this.world.combatActive && distSq(tip, e.pos) < sq(e.radius)) {
        this.world.damage(e, KNIFE_DAMAGE, { kind: 'knife', source: this.owner, at: tip, shake: 1 })
        continue
      }
      if (tip.x < 0 || tip.x > s || tip.y < 0 || tip.y > s) {
        const at = { x: clamp(tip.x, 0, s), y: clamp(tip.y, 0, s) }
        fx.burst(at, { count: 5, color: ['#e5e7eb', '#ffffff', '#fde047'], shape: 'spark', speed: [60, 200], size: [1.2, 2.5], life: [0.12, 0.28] })
        continue
      }
      kept.push(k)
    }
    this.knives = kept
  }

  // ───────────────────────────── rendering ─────────────────────────────

  /** 0..1 strength of the frozen-world look. */
  private frozenLevel(): number {
    const now = this.world.time
    if (this.stop) return clamp((now - this.stopBegan) / 0.12, 0, 1)
    return clamp(1 - (now - this.stopEnded) / RESUME_FADE, 0, 1)
  }

  override renderOverlay(ctx: CanvasRenderingContext2D): void {
    const level = this.frozenLevel() * this.presence
    if (level <= 0) return
    const s = this.world.size
    const now = this.world.time
    const o = this.stopOrigin
    // The grey sphere spreads out from where time was stopped.
    const far = Math.sqrt(Math.max(sq(o.x), sq(s - o.x)) + Math.max(sq(o.y), sq(s - o.y)))
    const grow = clamp((now - this.stopBegan) / SPHERE_GROW, 0, 1)
    const radius = far * (1 - cube(1 - grow))
    ctx.save()
    ctx.beginPath()
    ctx.arc(o.x, o.y, Math.max(1, radius), 0, TAU)
    ctx.clip()
    ctx.globalAlpha = level
    ctx.globalCompositeOperation = 'saturation'
    ctx.fillStyle = '#808080'
    ctx.fillRect(0, 0, s, s)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = 'rgba(148,163,184,0.13)'
    ctx.fillRect(0, 0, s, s)
    drawClockFace(ctx, s / 2, s / 2, s * 0.36, this.frozenHand, this.remainingFraction(), level)
    ctx.restore()

    // Bright wavefront while the sphere is still growing.
    if (grow < 1 && this.stop) {
      ctx.save()
      ctx.globalAlpha = (1 - grow) * this.presence
      ctx.strokeStyle = '#fef9c3'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(o.x, o.y, Math.max(1, radius), 0, TAU)
      ctx.stroke()
      ctx.restore()
    }
  }

  /** Fraction of the current (or last) stop still to run, for the clock's countdown arc. */
  private remainingFraction(): number {
    if (!this.stop) return 0
    return clamp(1 - this.stop.t / this.stop.duration, 0, 1)
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const level = this.stop ? this.frozenLevel() : 0
    if (level <= 0) return
    const o = this.owner
    const pulse = 0.85 + 0.15 * dm.sin(this.world.time * 12)
    const r = o.radius * 1.75
    const g = ctx.createRadialGradient(o.pos.x, o.pos.y, o.radius * 0.8, o.pos.x, o.pos.y, r)
    g.addColorStop(0, `rgba(253,224,71,${0.55 * level * pulse})`)
    g.addColorStop(1, 'rgba(253,224,71,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, r, 0, TAU)
    ctx.fill()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const charge = this.stop ? 1 : 1 - clamp(this.cooldown / STOP_COOLDOWN, 0, 1)
    drawClockRim(ctx, o.pos.x, o.pos.y, o.radius, charge)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const e = this.enemy
    const level = this.frozenLevel() * fade
    ctx.save()
    if (level > 0 && this.stop && e.alive) {
      // The frozen enemy loses its colour, too.
      ctx.save()
      ctx.beginPath()
      ctx.arc(e.pos.x, e.pos.y, e.radius * e.drawScale + 1, 0, TAU)
      ctx.clip()
      ctx.globalAlpha = level
      ctx.globalCompositeOperation = 'saturation'
      ctx.fillStyle = '#808080'
      ctx.fillRect(e.pos.x - e.radius * 2, e.pos.y - e.radius * 2, e.radius * 4, e.radius * 4)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(203,213,225,0.18)'
      ctx.fillRect(e.pos.x - e.radius * 2, e.pos.y - e.radius * 2, e.radius * 4, e.radius * 4)
      ctx.restore()
      ctx.globalAlpha = level
      drawStopwatch(ctx, e.pos.x - e.radius * 0.8, e.pos.y - e.radius - 10, 8, this.remainingFraction())
    }
    ctx.globalAlpha = fade
    for (const k of this.knives) {
      if (k.state === 'thrown') {
        // A quick spin on the way in, settling on the target.
        const u = clamp(k.t / KNIFE_FLY_IN, 0, 1)
        drawKnife(ctx, k.pos.x, k.pos.y, k.angle + (1 - u) * TAU * 1.25, KNIFE_LENGTH, 0)
      } else if (k.state === 'hanging') {
        drawKnife(ctx, k.pos.x, k.pos.y, k.angle, KNIFE_LENGTH, 0.5 + 0.5 * dm.sin(this.world.time * 6 + k.slot.x * 0.05))
      } else {
        drawKnifeTrail(ctx, k)
        drawKnife(ctx, k.pos.x, k.pos.y, k.angle, KNIFE_LENGTH, 1)
      }
    }
    ctx.restore()
  }
}

function drawKnifeTrail(ctx: CanvasRenderingContext2D, k: Knife): void {
  const back = KNIFE_LENGTH * 1.6
  const dx = dm.cos(k.angle)
  const dy = dm.sin(k.angle)
  const g = ctx.createLinearGradient(k.pos.x - dx * back, k.pos.y - dy * back, k.pos.x, k.pos.y)
  g.addColorStop(0, 'rgba(226,232,240,0)')
  g.addColorStop(1, 'rgba(226,232,240,0.55)')
  ctx.strokeStyle = g
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(k.pos.x - dx * back, k.pos.y - dy * back)
  ctx.lineTo(k.pos.x, k.pos.y)
  ctx.stroke()
}

/**
 * A throwing knife centred at (x, y), blade pointing along `angle`.
 * `glint` 0..1 adds a white shine along the blade.
 */
export function drawKnife(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, glint: number): void {
  const L = length
  const w = L * 0.17
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.lineJoin = 'round'
  // Blade: from the guard (at -0.1L) to the tip (+0.5L).
  ctx.fillStyle = '#e2e8f0'
  ctx.strokeStyle = '#475569'
  ctx.lineWidth = Math.max(0.8, L * 0.035)
  ctx.beginPath()
  ctx.moveTo(-L * 0.1, -w * 0.55)
  ctx.lineTo(L * 0.3, -w * 0.55)
  ctx.quadraticCurveTo(L * 0.45, -w * 0.4, L * 0.5, 0)
  ctx.lineTo(L * 0.3, w * 0.5)
  ctx.lineTo(-L * 0.1, w * 0.5)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  if (glint > 0) {
    ctx.strokeStyle = `rgba(255,255,255,${0.9 * glint})`
    ctx.lineWidth = Math.max(0.8, L * 0.04)
    ctx.beginPath()
    ctx.moveTo(-L * 0.05, -w * 0.15)
    ctx.lineTo(L * 0.36, -w * 0.15)
    ctx.stroke()
  }
  // Guard.
  ctx.fillStyle = '#ca8a04'
  ctx.fillRect(-L * 0.14, -w * 1.05, L * 0.06, w * 2.1)
  // Handle with a pommel ring.
  ctx.fillStyle = '#1f2937'
  ctx.fillRect(-L * 0.46, -w * 0.38, L * 0.33, w * 0.76)
  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  ctx.arc(-L * 0.48, 0, w * 0.48, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/** Twelve hour marks around the inside of the ball and a charge arc that sweeps like a clock hand. */
function drawClockRim(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, charge: number): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(28,25,23,0.55)'
  ctx.lineCap = 'round'
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU
    const long = i % 3 === 0
    ctx.lineWidth = long ? 2.4 : 1.4
    const r0 = r * (long ? 0.74 : 0.8)
    ctx.beginPath()
    ctx.moveTo(x + dm.cos(a) * r0, y + dm.sin(a) * r0)
    ctx.lineTo(x + dm.cos(a) * r * 0.9, y + dm.sin(a) * r * 0.9)
    ctx.stroke()
  }
  if (charge > 0) {
    ctx.strokeStyle = charge >= 1 ? '#fef08a' : 'rgba(254,240,138,0.8)'
    ctx.lineWidth = 2.6
    ctx.beginPath()
    ctx.arc(x, y, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * charge)
    ctx.stroke()
  }
  ctx.restore()
}

/** A big faint clock over the frozen arena: frozen hands and a countdown arc. */
function drawClockFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hand: number, remaining: number, alpha: number): void {
  ctx.save()
  ctx.globalAlpha = alpha * 0.32
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.stroke()
  ctx.lineCap = 'round'
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU
    const long = i % 3 === 0
    ctx.lineWidth = long ? 6 : 3
    const r0 = r * (long ? 0.8 : 0.87)
    ctx.beginPath()
    ctx.moveTo(x + dm.cos(a) * r0, y + dm.sin(a) * r0)
    ctx.lineTo(x + dm.cos(a) * r * 0.95, y + dm.sin(a) * r * 0.95)
    ctx.stroke()
  }
  // Frozen hands.
  const hour = hand / 12
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + dm.cos(hour - Math.PI / 2) * r * 0.48, y + dm.sin(hour - Math.PI / 2) * r * 0.48)
  ctx.stroke()
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + dm.cos(hand - Math.PI / 2) * r * 0.74, y + dm.sin(hand - Math.PI / 2) * r * 0.74)
  ctx.stroke()
  ctx.fillStyle = '#e2e8f0'
  ctx.beginPath()
  ctx.arc(x, y, 8, 0, TAU)
  ctx.fill()
  // Remaining stop time, as a golden arc running down.
  if (remaining > 0) {
    ctx.globalAlpha = alpha * 0.6
    ctx.strokeStyle = '#fde047'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(x, y, r + 9, -Math.PI / 2, -Math.PI / 2 + TAU * remaining)
    ctx.stroke()
  }
  ctx.restore()
}

/** Small stopwatch icon above a frozen ball; the dial empties as the stop runs out. */
function drawStopwatch(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, remaining: number): void {
  ctx.save()
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(x - 2, y - r - 4, 4, 3)
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#ca8a04'
  if (remaining > 0) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.arc(x, y, r * 0.78, -Math.PI / 2, -Math.PI / 2 + TAU * remaining)
    ctx.closePath()
    ctx.fill()
  }
  ctx.strokeStyle = '#1c1917'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

export function drawTimeStopPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // A ring of knives hanging around the ball.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8
    const d = r * 2.05
    drawKnife(ctx, cx + dm.cos(a) * d, cy + dm.sin(a) * d, a + Math.PI, r * 1.25, 0.6)
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, TAU)
  ctx.fill()
  const rr = r * 0.9
  drawClockRim(ctx, cx, cy, rr, 0)
  // Clock hands stopped at ten past ten.
  ctx.save()
  ctx.strokeStyle = '#1c1917'
  ctx.lineCap = 'round'
  ctx.lineWidth = r * 0.12
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + dm.cos(-Math.PI * 0.83) * rr * 0.45, cy + dm.sin(-Math.PI * 0.83) * rr * 0.45)
  ctx.stroke()
  ctx.lineWidth = r * 0.08
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + dm.cos(-Math.PI * 0.17) * rr * 0.65, cy + dm.sin(-Math.PI * 0.17) * rr * 0.65)
  ctx.stroke()
  ctx.fillStyle = '#1c1917'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.09, 0, TAU)
  ctx.fill()
  ctx.restore()
}

export const timeStopDef: CharacterDef = {
  id: 'timeStop',
  nameEn: 'TIME STOP',
  ruleValues: {
    stopCooldown: STOP_COOLDOWN,
    stopStart: STOP_START,
    stopGrowth: STOP_GROWTH,
    stopMax: STOP_MAX,
    knifeInterval: KNIFE_INTERVAL,
    knifeDamage: KNIFE_DAMAGE,
    tossInterval: TOSS_INTERVAL,
  },
  palette: { ball: '#d4af37', text: '#1c1917', accent: '#fde047' },
  mirrorPalette: { ball: '#78350f', text: '#fef9c3', accent: '#facc15' },
  create: (w, b) => new TimeStopAbility(w, b),
  drawPortrait: drawTimeStopPortrait,
}
