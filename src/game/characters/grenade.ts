import * as dm from '../core/dmath'
import { type Vec, clamp, distSq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import { predictPosition } from '../engine/predict'
import type { CharacterDef } from './types'

const FIRST_WAVE_DELAY = 1.5
export const WAVE_INTERVAL = 2.6
export const MAX_WAVE = 5
/** Grenades orbit the ball at this distance before being released. */
const RING_RADIUS = BALL_RADIUS * 1.55
const RING_HOLD = 0.8
const RING_HOLD_SINGLE = 0.5
const FLOOR_DRAG = 6
/** Grenades are lobbed towards the enemy, landing within this spread of it. */
const THROW_SPREAD = BALL_RADIUS * 3.2
const MAX_THROW = 300
/** Rough time for a lobbed grenade to come to rest, added to the aim lead. */
const SETTLE_TIME = 0.3
const FUSE_MIN = 0.5
const FUSE_MAX = 1.3
export const GRENADE_DAMAGE = 5
/** ≈16% of the arena width, matching the source footage's proportions. */
export const BLAST_RADIUS = BALL_RADIUS * 2.8
const GRENADE_HALF_HEIGHT = 15

interface Grenade {
  pos: Vec
  vel: Vec
  /** Angle on the ring while held. */
  angle: number
  /** Seconds left on the fuse once released; Infinity while held. */
  fuse: number
}

interface Wave {
  grenades: Grenade[]
  hold: number
}

interface Blast {
  pos: Vec
  age: number
}

/**
 * 手榴弹 — on a fixed timer, summons a ring of grenades, then lobs them to
 * where the enemy is heading; they explode a moment later. Every wave carries one more grenade than the
 * last, so it starts slow and ends with carpet bombing. Blasts never hurt
 * the thrower.
 */
export class GrenadeAbility extends Ability {
  private waves: Wave[] = []
  private loose: Grenade[] = []
  private blasts: Blast[] = []
  private timer = FIRST_WAVE_DELAY
  private waveCount = 0

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += WAVE_INTERVAL
        this.spawnWave()
      }
    }
    this.updateWaves(dt)
    this.updateLoose(dt)
    for (const b of this.blasts) b.age += dt
    this.blasts = this.blasts.filter((b) => b.age < 0.5)
  }

  private spawnWave(): void {
    const n = Math.min(MAX_WAVE, this.waveCount + 1)
    this.waveCount += 1
    const offset = this.world.rng.range(0, Math.PI * 2)
    const grenades: Grenade[] = []
    for (let i = 0; i < n; i++) {
      grenades.push({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, angle: offset + (i / n) * Math.PI * 2, fuse: Infinity })
    }
    this.waves.push({ grenades, hold: n === 1 ? RING_HOLD_SINGLE : RING_HOLD })
    this.placeRing(grenades)
    this.world.sound('place', 0.4, 0.6)
  }

  private placeRing(grenades: Grenade[]): void {
    const o = this.owner.pos
    for (const g of grenades) {
      g.pos.x = o.x + dm.cos(g.angle) * RING_RADIUS
      g.pos.y = o.y + dm.sin(g.angle) * RING_RADIUS
    }
  }

  private updateWaves(dt: number): void {
    const rng = this.world.rng
    for (const w of this.waves) {
      w.hold -= dt
      this.placeRing(w.grenades)
      if (w.hold > 0) continue
      // Release: lob each grenade to where the enemy will be when its fuse runs out.
      for (const g of w.grenades) {
        g.fuse = rng.range(FUSE_MIN, FUSE_MAX)
        const e = predictPosition(this.enemy, g.fuse + SETTLE_TIME, this.world.size)
        const a = rng.range(0, Math.PI * 2)
        const spread = Math.sqrt(rng.next()) * THROW_SPREAD
        let dx = e.x + dm.cos(a) * spread - g.pos.x
        let dy = e.y + dm.sin(a) * spread - g.pos.y
        const d = dm.hypot(dx, dy)
        if (d > MAX_THROW) {
          dx *= MAX_THROW / d
          dy *= MAX_THROW / d
        }
        // With exponential floor drag, launching at distance·drag stops right on target.
        g.vel = { x: dx * FLOOR_DRAG, y: dy * FLOOR_DRAG }
        this.loose.push(g)
      }
      this.world.sound('throw', 0.4, 0.8)
    }
    this.waves = this.waves.filter((w) => w.hold > 0)
  }

  private updateLoose(dt: number): void {
    const s = this.world.size
    const k = dm.exp(-FLOOR_DRAG * dt)
    const kept: Grenade[] = []
    for (const g of this.loose) {
      g.vel.x *= k
      g.vel.y *= k
      g.pos.x = clamp(g.pos.x + g.vel.x * dt, 8, s - 8)
      g.pos.y = clamp(g.pos.y + g.vel.y * dt, 8, s - 8)
      g.fuse -= dt
      if (g.fuse <= 0) this.explode(g.pos)
      else kept.push(g)
    }
    this.loose = kept
  }

  private explode(pos: Vec): void {
    this.blasts.push({ pos: { x: pos.x, y: pos.y }, age: 0 })
    const fx = this.world.effects
    fx.burst(pos, { count: 16, color: ['#f4f4f5', '#d4d4d8', '#a1a1aa'], shape: 'smoke', speed: [40, 220], size: [7, 15], life: [0.5, 0.9], endScale: 2.2, drag: 3 })
    fx.burst(pos, { count: 8, color: ['#fde68a', '#fb923c'], shape: 'spark', speed: [150, 380], size: [2, 3.5], life: [0.15, 0.3] })
    this.world.addShake(2)
    this.world.sound('explosion', 0.55)
    const e = this.enemy
    if (!e.alive) return
    if (distSq(e.pos, pos) < BLAST_RADIUS * BLAST_RADIUS) {
      this.world.damage(e, GRENADE_DAMAGE, { kind: 'grenade', source: this.owner, at: e.pos })
    }
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const b of this.blasts) {
      const t = b.age / 0.5
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - t)})`
      ctx.lineWidth = 3 * (1 - t) + 0.5
      ctx.beginPath()
      ctx.arc(b.pos.x, b.pos.y, BLAST_RADIUS * (0.35 + 0.65 * t), 0, Math.PI * 2)
      ctx.stroke()
    }
    const t = this.world.time
    for (const w of this.waves) for (const g of w.grenades) drawGrenade(ctx, g.pos.x, g.pos.y, 1, false)
    for (const g of this.loose) {
      // Blink faster as the fuse runs out.
      const blink = g.fuse < 0.45 && dm.sin(t * 40) > 0
      drawGrenade(ctx, g.pos.x, g.pos.y, 1, blink)
    }
    ctx.restore()
  }
}

/** An upright pineapple grenade centred on (x, y). */
export function drawGrenade(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, lit: boolean): void {
  const h = GRENADE_HALF_HEIGHT * scale
  const w = h * 0.62
  ctx.save()
  ctx.translate(x, y + h * 0.15)
  ctx.fillStyle = lit ? '#ef4444' : '#6b7747'
  ctx.beginPath()
  ctx.ellipse(0, 0, w, h * 0.78, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(30,36,18,0.75)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const gx of [-w * 0.45, 0, w * 0.45]) {
    ctx.moveTo(gx, -h * 0.7)
    ctx.lineTo(gx, h * 0.7)
  }
  for (const gy of [-h * 0.35, 0, h * 0.35]) {
    ctx.moveTo(-w * 0.95, gy)
    ctx.lineTo(w * 0.95, gy)
  }
  ctx.stroke()
  // Cap and lever.
  ctx.fillStyle = '#3f3f46'
  ctx.fillRect(-w * 0.45, -h * 1.12, w * 0.9, h * 0.36)
  ctx.fillRect(w * 0.3, -h * 1.05, w * 0.35, h * 0.85)
  ctx.strokeStyle = '#a1a1aa'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(-w * 0.7, -h * 0.95, h * 0.18, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawGrenadePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 2 + 0.4
    drawGrenade(ctx, cx + dm.cos(a) * r * 1.65, cy + dm.sin(a) * r * 1.65, r / 34, i === 0)
  }
}

export const grenadeDef: CharacterDef = {
  id: 'grenade',
  nameEn: 'GRENADE',
  ruleValues: { waveInterval: WAVE_INTERVAL, grenadeDamage: GRENADE_DAMAGE, blastRadii: (BLAST_RADIUS / BALL_RADIUS).toFixed(1), maxWave: MAX_WAVE },
  palette: { ball: '#00993c', text: '#ffffff', accent: '#22a356' },
  mirrorPalette: { ball: '#065f46', text: '#d1fae5', accent: '#10b981' },
  create: (w, b) => new GrenadeAbility(w, b),
  drawPortrait: drawGrenadePortrait,
}
