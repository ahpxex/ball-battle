import * as dm from '../core/dmath'
import { type Vec, angleDiff, clamp, cube, damp, lerpAngle, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { DamageOptions } from '../engine/types'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

const R = BALL_RADIUS

// ───────────────────────────── fire feathers ─────────────────────────────

const FIRST_VOLLEY = 1.4
/** Time between two wing beats that fling feathers (s). */
export const VOLLEY_INTERVAL = 3.2
/** After rebirth the wings beat faster. */
export const REBORN_VOLLEY_INTERVAL = 2.2
export const FEATHERS = 4
export const REBORN_FEATHERS = 6
export const FEATHER_DAMAGE = 2
const FEATHER_SPEED = 430
/** Feathers curve towards the enemy for this long after launch, then fly straight (s). */
const STEER_TIME = 0.75
/** Maximum turn rate while steering (rad/s). */
const TURN_RATE = 4.2
const FEATHER_LIFE = 2.2
/** A feather hits when the enemy centre is within enemy.radius + this. */
const FEATHER_HIT_RADIUS = R * 0.28
const FEATHER_LENGTH = R * 0.78
/** Launch spread to each side of the enemy direction (rad): fanned out like opened wings. */
const SPREAD_MIN = 0.75
const SPREAD_MAX = 1.55
const TRAIL_SPAN = 0.12

// ───────────────────────────── rebirth ─────────────────────────────

/** HP the phoenix rises again with after its first death. */
export const REBIRTH_HP = 30
/** Invulnerability right after rising (s). Overtime drain still applies. */
export const REBIRTH_INVULN = 1.2
/** The rebirth blast hits an enemy whose centre is within this many ball radii. */
export const BURST_RADIUS_R = 4
const BURST_RADIUS = R * BURST_RADIUS_R
export const BURST_DAMAGE = 10
const BURST_KNOCK = 680
/** The phoenix smoulders this long before the rebirth blast goes off (s). */
const BLAST_DELAY = 0.3
/** Cosmetic: the charred shell glows back to life over this long (s). */
const ASH_TIME = BLAST_DELAY + 0.1
/** Cosmetic: duration of the expanding blast ring (s). */
const RING_TIME = 0.5

/** Balls that already used their one rebirth (per ball, so a mimic can't rise twice either). */
const reborn = new WeakSet<Ball>()

interface Feather {
  pos: Vec
  angle: number
  age: number
  /** Cosmetic trail of recent positions. */
  trail: { x: number; y: number; t: number }[]
}

/**
 * 凤凰 PHOENIX — every few seconds its wings of flame beat and fling a fan of
 * burning feathers outwards; they curve round towards the enemy. The first
 * time it would die it bursts into flame instead: it rises again with
 * REBIRTH_HP, briefly invulnerable, and the blast scorches and hurls away an
 * enemy close by. Reborn, it beats its wings faster and throws more feathers.
 */
export class PhoenixAbility extends Ability {
  private volleyTimer = FIRST_VOLLEY
  private feathers: Feather[] = []
  /** World time of the rebirth, or -Infinity before it. */
  private rebirthAt = -Infinity
  /** Countdown to the rebirth blast, or -1 when none is pending. */
  private blastIn = -1
  /** World time of the rebirth blast (cosmetic ring). */
  private blastAt = -Infinity
  private invulnLeft = 0
  // Cosmetic state.
  private look: number
  private flap = 0
  /** 0..1 burst of wing energy right after a volley. */
  private beat = 0

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.look = dm.atan2(owner.vel.y, owner.vel.x)
  }

  private get isReborn(): boolean {
    return reborn.has(this.owner)
  }

  override update(dt: number): void {
    const o = this.owner
    if (this.invulnLeft > 0) {
      this.invulnLeft -= dt
      if (this.invulnLeft <= 0) {
        this.invulnLeft = 0
        o.invulnerable = false
      }
    }

    if (this.blastIn >= 0) {
      this.blastIn -= dt
      if (this.blastIn <= 0) {
        this.blastIn = -1
        this.blast()
      }
    }

    if (this.world.combatActive) {
      this.volleyTimer -= dt
      // Held by an enemy (swallowed, hooked) or disarmed: the wings can't beat.
      if (this.volleyTimer <= 0 && !o.disarmed && !o.attachedTo && this.enemy.alive) this.volley()
    }
    this.updateFeathers(dt)

    // Cosmetic: smooth heading and wing flap.
    const speed = dm.hypot(o.vel.x, o.vel.y)
    if (speed > 1) this.look = lerpAngle(this.look, dm.atan2(o.vel.y, o.vel.x), damp(8, dt))
    this.beat = Math.max(0, this.beat - dt * 2.2)
    this.flap += dt * (5 + 9 * this.beat)
  }

  override onOwnerDamaged(_amount: number, opts: DamageOptions): void {
    const o = this.owner
    if (o.hp > 0 || reborn.has(o)) return
    this.rise(opts)
  }

  // ───────────────────────────── feathers ─────────────────────────────

  private volley(): void {
    const o = this.owner
    const e = this.enemy
    const isReborn = this.isReborn
    this.volleyTimer = isReborn ? REBORN_VOLLEY_INTERVAL : VOLLEY_INTERVAL
    const count = isReborn ? REBORN_FEATHERS : FEATHERS
    const aim = dm.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)
    const perSide = count >> 1
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < perSide; i++) {
        const u = perSide === 1 ? 0.5 : i / (perSide - 1)
        const angle = aim + side * (SPREAD_MIN + (SPREAD_MAX - SPREAD_MIN) * u)
        // Launched from the wing on that side.
        const wing = aim + side * Math.PI * 0.5
        this.feathers.push({
          pos: { x: o.pos.x + dm.cos(wing) * o.radius * 0.9, y: o.pos.y + dm.sin(wing) * o.radius * 0.9 },
          angle,
          age: 0,
          trail: [],
        })
      }
    }
    this.beat = 1
    this.world.sound('whoosh', 0.5, isReborn ? 1.25 : 1.05)
    this.world.effects.burst(o.pos, {
      count: 10,
      color: ['#ffb02e', '#fde68a', '#ff5a1f'],
      speed: [60, 200],
      size: [1.5, 3.5],
      life: [0.25, 0.5],
      gravity: -80,
      jitter: o.radius * 0.6,
    })
  }

  private updateFeathers(dt: number): void {
    if (this.feathers.length === 0) return
    const e = this.enemy
    const s = this.world.size
    const now = this.world.time
    const kept: Feather[] = []
    for (const f of this.feathers) {
      f.age += dt
      if (f.age < STEER_TIME && e.alive) {
        const want = dm.atan2(e.pos.y - f.pos.y, e.pos.x - f.pos.x)
        const turn = clamp(angleDiff(f.angle, want), -TURN_RATE * dt, TURN_RATE * dt)
        f.angle += turn
      }
      f.pos.x += dm.cos(f.angle) * FEATHER_SPEED * dt
      f.pos.y += dm.sin(f.angle) * FEATHER_SPEED * dt
      if (!this.world.headless) {
        f.trail.push({ x: f.pos.x, y: f.pos.y, t: now })
        while (f.trail.length > 0 && now - f.trail[0].t > TRAIL_SPAN) f.trail.shift()
      }

      if (f.pos.x < 0 || f.pos.y < 0 || f.pos.x > s || f.pos.y > s || f.age >= FEATHER_LIFE) {
        this.world.effects.burst(
          { x: clamp(f.pos.x, 0, s), y: clamp(f.pos.y, 0, s) },
          { count: 5, color: ['#ff8a3d', '#fde68a'], speed: [30, 110], size: [1.2, 2.5], life: [0.2, 0.4], gravity: -60 },
        )
        continue
      }
      const reach = e.radius + FEATHER_HIT_RADIUS
      if (e.alive && this.world.combatActive && sq(e.pos.x - f.pos.x) + sq(e.pos.y - f.pos.y) <= reach * reach) {
        const k = 60
        this.world.damage(e, FEATHER_DAMAGE, {
          kind: 'rebirth',
          source: this.owner,
          at: { x: f.pos.x, y: f.pos.y },
          knock: { x: dm.cos(f.angle) * k, y: dm.sin(f.angle) * k },
        })
        continue
      }
      kept.push(f)
    }
    this.feathers = kept
  }

  // ───────────────────────────── rebirth ─────────────────────────────

  /**
   * Lethal damage: rise again at once (HP restored, invulnerable, cleansed).
   * The blast itself goes off from update() a moment later, never from inside
   * the attacker's damage call.
   */
  private rise(opts: DamageOptions): void {
    const o = this.owner
    const w = this.world
    reborn.add(o)
    this.rebirthAt = w.time
    this.blastIn = BLAST_DELAY
    // Rise from the ashes: clean slate, then the restored HP.
    o.hp = 0
    w.heal(o, REBIRTH_HP)
    o.poison = []
    o.slowTimer = 0
    o.disarmTimer = 0
    // Overtime keeps draining through the invulnerability, so matches still end.
    o.invulnerable = true
    this.invulnLeft = REBIRTH_INVULN
    this.beat = 1

    w.addShake(opts.kind === 'overtime' ? 3 : 5)
    w.sound('death', 0.6, 1.3)
    w.effects.burst(o.pos, {
      count: 14,
      color: ['#3f3f46', '#52525b', '#71717a'],
      shape: 'smoke',
      speed: [20, 90],
      size: [8, 15],
      life: [0.5, 0.9],
      endScale: 2,
      drag: 2,
      front: false,
    })
    w.effects.burst(o.pos, {
      count: 10,
      color: ['#ff8a1a', '#ffb02e'],
      speed: [20, 80],
      size: [1.5, 3],
      life: [0.3, 0.6],
      gravity: -120,
      jitter: o.radius * 0.7,
    })
  }

  /** The reborn phoenix erupts: the blast scorches and hurls away a nearby enemy. */
  private blast(): void {
    const o = this.owner
    const w = this.world
    this.blastAt = w.time
    // The wings flare and the next volley comes right away.
    this.volleyTimer = Math.min(this.volleyTimer, 0.3)
    this.beat = 1

    const e = this.enemy
    const dx = e.pos.x - o.pos.x
    const dy = e.pos.y - o.pos.y
    const d = dm.hypot(dx, dy)
    if (e.alive && w.combatActive && d <= BURST_RADIUS) {
      const nx = d > 1e-6 ? dx / d : 1
      const ny = d > 1e-6 ? dy / d : 0
      w.damage(e, BURST_DAMAGE, {
        kind: 'rebirth',
        source: o,
        at: { x: e.pos.x - nx * e.radius, y: e.pos.y - ny * e.radius },
        knock: { x: nx * BURST_KNOCK, y: ny * BURST_KNOCK },
        shake: 6,
      })
    }

    w.addShake(8)
    w.sound('explosion', 0.9, 0.75)
    w.sound('jackpot', 0.5, 1.2)
    const fx = w.effects
    fx.burst(o.pos, {
      count: 46,
      color: ['#ff5a1f', '#ff8a3d', '#ffb02e', '#fde68a', '#ffffff'],
      speed: [140, 520],
      size: [2.5, 6.5],
      life: [0.4, 0.9],
      drag: 3.2,
      gravity: -90,
    })
    fx.burst(o.pos, { count: 16, color: ['#ffd54a', '#fff1b8', '#ff8a1a'], shape: 'shard', speed: [180, 420], size: [2.5, 5], life: [0.4, 0.8], drag: 2.5 })
    fx.burst(o.pos, { count: 1, color: '#fde68a', shape: 'ring', speed: [0, 0], size: [R, R], life: [0.45, 0.45], endScale: BURST_RADIUS_R })
  }

  // ───────────────────────────── rendering ─────────────────────────────

  override renderBack(ctx: CanvasRenderingContext2D): void {
    // Expanding blast ring of the rebirth (drawn on the floor, beneath the balls).
    const t = this.world.time - this.blastAt
    if (t < 0 || t > RING_TIME) return
    const u = t / RING_TIME
    const k = 1 - cube(1 - u)
    const o = this.owner
    const rad = R + (BURST_RADIUS - R) * k
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const g = ctx.createRadialGradient(o.pos.x, o.pos.y, rad * 0.35, o.pos.x, o.pos.y, rad)
    g.addColorStop(0, 'rgba(255,90,20,0)')
    g.addColorStop(0.7, `rgba(255,120,30,${0.32 * (1 - u)})`)
    g.addColorStop(1, `rgba(255,214,120,${0.75 * (1 - u)})`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, rad, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const fade = this.presence
    if (fade <= 0) return
    const time = this.world.time
    const isReborn = this.isReborn
    const r = o.radius * o.drawScale
    const invuln = o.invulnerable && this.invulnLeft > 0
    ctx.save()
    ctx.globalAlpha *= fade
    if (invuln) drawFlameAura(ctx, o.pos.x, o.pos.y, r, time, this.invulnLeft / REBIRTH_INVULN)
    drawPhoenixBody(ctx, o.pos.x, o.pos.y, r, this.look, this.flap, this.beat, time, isReborn)
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const r = o.radius * o.drawScale
    const t = this.world.time - this.rebirthAt
    ctx.save()
    if (t >= 0 && t < ASH_TIME) drawAshes(ctx, o.pos.x, o.pos.y, r, t / ASH_TIME)
    if (this.isReborn) {
      // A golden rim marks the second life.
      const pulse = 0.65 + 0.35 * dm.sin(this.world.time * 6)
      ctx.strokeStyle = `rgba(255,214,102,${0.55 + 0.35 * pulse})`
      ctx.lineWidth = 2.5
      ctx.shadowColor = '#ffb02e'
      ctx.shadowBlur = 8 + 6 * pulse
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, r - 1.5, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      // Still holding its rebirth: a small ember flame floats beside it.
      drawEmberIcon(ctx, o.pos.x - r * 0.78, o.pos.y - r - 9 + dm.sin(this.world.time * 4) * 1.5, this.world.time)
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.feathers.length === 0) return
    ctx.save()
    ctx.globalAlpha = fade
    const now = this.world.time
    for (const f of this.feathers) {
      // Ember trail.
      if (f.trail.length >= 2) {
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        for (let i = 1; i < f.trail.length; i++) {
          const a = f.trail[i - 1]
          const b = f.trail[i]
          const k = 1 - (now - b.t) / TRAIL_SPAN
          ctx.strokeStyle = `rgba(255,140,40,${0.5 * k})`
          ctx.lineWidth = 1 + 4 * k
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
      const grow = clamp(f.age / 0.12, 0.3, 1)
      drawFireFeather(ctx, f.pos.x, f.pos.y, f.angle, FEATHER_LENGTH * grow, now + f.age)
    }
    ctx.restore()
  }
}

// ───────────────────────────── drawing helpers ─────────────────────────────

/** A burning feather pointing along `angle`, tip at (x, y). */
function drawFireFeather(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, time: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  const w = len * 0.22
  // Glow.
  ctx.globalCompositeOperation = 'lighter'
  const glow = ctx.createRadialGradient(-len * 0.35, 0, 0, -len * 0.35, 0, len * 0.75)
  glow.addColorStop(0, 'rgba(255,170,60,0.45)')
  glow.addColorStop(1, 'rgba(255,90,20,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(-len * 0.35, 0, len * 0.75, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  // Vane: leaf shape from the quill (back) to the tip (front), with flickering flame barbs at the back.
  const flick = 0.12 * dm.sin(time * 31)
  const g = ctx.createLinearGradient(-len, 0, 0, 0)
  g.addColorStop(0, '#d9300c')
  g.addColorStop(0.45, '#ff8a1a')
  g.addColorStop(1, '#ffe9a3')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(-len * 0.35, -w * 1.25, -len * 0.82, -w * (0.9 + flick))
  ctx.lineTo(-len * (1.05 + flick * 0.5), -w * 0.35)
  ctx.lineTo(-len * 0.88, 0)
  ctx.lineTo(-len * (1.05 - flick * 0.5), w * 0.35)
  ctx.lineTo(-len * 0.82, w * (0.9 - flick))
  ctx.quadraticCurveTo(-len * 0.35, w * 1.25, 0, 0)
  ctx.closePath()
  ctx.fill()
  // Quill.
  ctx.strokeStyle = 'rgba(255,248,220,0.9)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(-len * 0.08, 0)
  ctx.lineTo(-len * 0.95, 0)
  ctx.stroke()
  ctx.restore()
}

/** One flame-feather of a wing: from the shoulder (0,0) along +x, `len` long. */
function wingFeatherPath(ctx: CanvasRenderingContext2D, len: number, w: number, wave: number): void {
  ctx.beginPath()
  ctx.moveTo(0, -w * 0.5)
  ctx.quadraticCurveTo(len * 0.5, -w * (1.1 + wave), len, wave * w * 1.6)
  ctx.quadraticCurveTo(len * 0.55, w * (0.9 - wave), 0, w * 0.5)
  ctx.closePath()
}

/**
 * Wings, tail and beak around a ball heading along `look`. `beat` (0..1)
 * spreads the wings wide right after a volley.
 */
function drawPhoenixBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  look: number,
  flap: number,
  beat: number,
  time: number,
  isReborn: boolean,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(look)
  const size = isReborn ? 1.15 : 1
  const hot = isReborn ? ['#ff6a1a', '#ffc53d', '#fff6d8'] : ['#e8330c', '#ff8a1a', '#ffe08a']

  // Tail: three flickering flame streamers behind.
  ctx.globalCompositeOperation = 'lighter'
  for (let i = -1; i <= 1; i++) {
    const wob = dm.sin(time * 9 + i * 1.9)
    const len = r * (1.25 + 0.35 * (1 - Math.abs(i)) + 0.12 * wob) * size
    const g = ctx.createLinearGradient(-r * 0.6, 0, -r * 0.6 - len, 0)
    g.addColorStop(0, hot[1])
    g.addColorStop(1, 'rgba(255,80,10,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(-r * 0.55, i * r * 0.32 - r * 0.2)
    ctx.quadraticCurveTo(-r * 0.6 - len * 0.5, i * r * 0.5 + wob * r * 0.2, -r * 0.6 - len, i * r * 0.62 + wob * r * 0.25)
    ctx.quadraticCurveTo(-r * 0.6 - len * 0.45, i * r * 0.3 + wob * r * 0.1, -r * 0.55, i * r * 0.32 + r * 0.2)
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  // Wings: a fan of flame feathers from each shoulder, sweeping back.
  const flapAngle = 0.28 * dm.sin(flap) + 0.35 * beat
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.translate(-r * 0.15, side * r * 0.72)
    for (let i = 3; i >= 0; i--) {
      const base = side * (1.35 + i * 0.32 - flapAngle * (1 - i * 0.18))
      const len = r * (1.25 - i * 0.14) * size * (1 + 0.05 * dm.sin(time * 13 + i * 2.1 + side))
      const wave = 0.18 * dm.sin(time * 11 + i * 1.3 + side * 0.7) * side
      ctx.save()
      ctx.rotate(base)
      const g = ctx.createLinearGradient(0, 0, len, 0)
      g.addColorStop(0, hot[0])
      g.addColorStop(0.55, hot[1])
      g.addColorStop(1, hot[2])
      ctx.fillStyle = g
      wingFeatherPath(ctx, len, r * 0.34 * size, wave)
      ctx.fill()
      ctx.strokeStyle = 'rgba(120,20,0,0.35)'
      ctx.lineWidth = 0.8
      ctx.stroke()
      ctx.restore()
    }
    ctx.restore()
  }

  // Beak.
  ctx.fillStyle = '#ffc53d'
  ctx.strokeStyle = '#9a3412'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(r * 0.9, -r * 0.2)
  ctx.quadraticCurveTo(r * 1.25, -r * 0.12, r * 1.42, r * 0.06)
  ctx.quadraticCurveTo(r * 1.2, r * 0.12, r * 0.9, r * 0.2)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** Flickering golden flames licking around the ball while it is invulnerable. */
function drawFlameAura(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, time: number, k: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const a = clamp(k * 1.6, 0, 1)
  const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.9)
  g.addColorStop(0, `rgba(255,214,102,${0.6 * a})`)
  g.addColorStop(1, 'rgba(255,90,20,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2)
  ctx.fill()
  const n = 12
  ctx.fillStyle = `rgba(255,170,50,${0.75 * a})`
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + time * 1.5
    const len = r * (1.35 + 0.22 * dm.sin(time * 17 + i * 2.7))
    const half = Math.PI / n
    ctx.moveTo(cx + dm.cos(ang - half) * r * 0.95, cy + dm.sin(ang - half) * r * 0.95)
    ctx.quadraticCurveTo(cx + dm.cos(ang) * r * 1.1, cy + dm.sin(ang) * r * 1.1, cx + dm.cos(ang + 0.15) * len, cy + dm.sin(ang + 0.15) * len)
    ctx.quadraticCurveTo(
      cx + dm.cos(ang + half) * r * 1.1,
      cy + dm.sin(ang + half) * r * 1.1,
      cx + dm.cos(ang + half) * r * 0.95,
      cy + dm.sin(ang + half) * r * 0.95,
    )
  }
  ctx.fill()
  ctx.restore()
}

/** Charred shell with glowing cracks, fading out as the phoenix reignites (`u` 0 → 1). */
function drawAshes(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, u: number): void {
  const a = 1 - u
  ctx.save()
  ctx.fillStyle = `rgba(43,35,33,${0.92 * a})`
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = `rgba(255,170,60,${a})`
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  const cracks: [number, number][] = [
    [0.3, 0.9],
    [2.2, 0.8],
    [3.9, 0.95],
    [5.1, 0.7],
  ]
  for (const [ang, len] of cracks) {
    ctx.moveTo(cx + dm.cos(ang) * r * 0.15, cy + dm.sin(ang) * r * 0.15)
    ctx.lineTo(cx + dm.cos(ang + 0.35) * r * 0.5 * len, cy + dm.sin(ang + 0.35) * r * 0.5 * len)
    ctx.lineTo(cx + dm.cos(ang - 0.1) * r * 0.95 * len, cy + dm.sin(ang - 0.1) * r * 0.95 * len)
  }
  ctx.stroke()
  ctx.restore()
}

/** Small flame icon: the phoenix still has its rebirth. */
function drawEmberIcon(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const f = 1 + 0.08 * dm.sin(time * 14)
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(f, f)
  ctx.shadowColor = '#ff8a1a'
  ctx.shadowBlur = 8
  ctx.fillStyle = '#ff6a1a'
  flamePath(ctx, 6.5, 9)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#ffe08a'
  ctx.translate(0, 2.5)
  flamePath(ctx, 3.4, 5)
  ctx.fill()
  ctx.restore()
}

/** Teardrop flame centred at the origin: `w` half-width, `h` half-height, tip up. */
function flamePath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.beginPath()
  ctx.moveTo(0, -h * 1.2)
  ctx.bezierCurveTo(w * 0.6, -h * 0.4, w * 1.1, h * 0.1, w * 0.75, h * 0.6)
  ctx.quadraticCurveTo(0, h * 1.25, -w * 0.75, h * 0.6)
  ctx.bezierCurveTo(-w * 1.1, h * 0.1, -w * 0.3, -h * 0.2, 0, -h * 1.2)
  ctx.closePath()
}

export function drawPhoenixPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const k = 0.82
  const br = r * k
  const x = cx
  const y = cy + r * 0.35
  // Heading up and to the right; wings spread wide for a beat.
  drawPhoenixBody(ctx, x, y, br, -Math.PI / 2 + 0.35, Math.PI / 2, 1, 0.3, false)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  // A pair of feathers in flight.
  drawFireFeather(ctx, cx + r * 1.85, cy - r * 1.05, -0.55, r * 0.8, 0.2)
  drawFireFeather(ctx, cx - r * 1.55, cy - r * 1.7, -1.9, r * 0.8, 0.9)
  drawEmberIcon(ctx, x - br * 0.05, y - br * 0.05, 0)
}

export const phoenixDef: CharacterDef = {
  id: 'phoenix',
  nameEn: 'PHOENIX',
  ruleValues: {
    volleyInterval: VOLLEY_INTERVAL,
    feathers: FEATHERS,
    featherDamage: FEATHER_DAMAGE,
    rebirthHp: REBIRTH_HP,
    rebirthInvuln: REBIRTH_INVULN,
    burstRadius: BURST_RADIUS_R,
    burstDamage: BURST_DAMAGE,
    rebornVolleyInterval: REBORN_VOLLEY_INTERVAL,
    rebornFeathers: REBORN_FEATHERS,
  },
  palette: { ball: '#ff5a1f', text: '#ffffff', accent: '#ff8a3d' },
  mirrorPalette: { ball: '#9a3412', text: '#ffedd5', accent: '#fb923c' },
  create: (w, b) => new PhoenixAbility(w, b),
  drawPortrait: drawPhoenixPortrait,
}
