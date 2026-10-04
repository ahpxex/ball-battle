import * as dm from '../core/dmath'
import { Rng } from '../core/rng'
import type { Vec } from '../core/vec'

export type ParticleShape = 'dot' | 'smoke' | 'spark' | 'shard' | 'ring'

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  /** Size multiplier reached at end of life (smoke grows, sparks shrink). */
  endScale: number
  color: string
  shape: ParticleShape
  drag: number
  gravity: number
  rotation: number
  spin: number
  /** Drawn above balls when true. */
  front: boolean
}

export interface FloatingText {
  text: string
  x: number
  y: number
  vy: number
  life: number
  maxLife: number
  color: string
  size: number
}

export interface BurstOptions {
  count: number
  color: string | readonly string[]
  speed: [number, number]
  size: [number, number]
  life: [number, number]
  shape?: ParticleShape
  /** Center direction in radians; omitted = all directions. */
  direction?: number
  spread?: number
  drag?: number
  gravity?: number
  endScale?: number
  front?: boolean
  /** Random positional jitter around the origin. */
  jitter?: number
}

const MAX_PARTICLES = 900
const MAX_TEXTS = 80

/**
 * Purely cosmetic particles and floating numbers. Uses its own RNG so that
 * toggling effects (e.g. in headless simulations) never changes outcomes.
 */
export class Effects {
  enabled = true
  readonly particles: Particle[] = []
  readonly texts: FloatingText[] = []
  private readonly rng: Rng

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5bd1e995)
  }

  burst(at: Vec, o: BurstOptions): void {
    if (!this.enabled) return
    const r = this.rng
    for (let i = 0; i < o.count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift()
      const dir =
        o.direction === undefined
          ? r.range(0, Math.PI * 2)
          : o.direction + r.range(-(o.spread ?? Math.PI), o.spread ?? Math.PI)
      const speed = r.range(o.speed[0], o.speed[1])
      const life = r.range(o.life[0], o.life[1])
      const color = typeof o.color === 'string' ? o.color : r.pick(o.color)
      const j = o.jitter ?? 0
      this.particles.push({
        x: at.x + r.range(-j, j),
        y: at.y + r.range(-j, j),
        vx: dm.cos(dir) * speed,
        vy: dm.sin(dir) * speed,
        life,
        maxLife: life,
        size: r.range(o.size[0], o.size[1]),
        endScale: o.endScale ?? 0.2,
        color,
        shape: o.shape ?? 'dot',
        drag: o.drag ?? 3,
        gravity: o.gravity ?? 0,
        rotation: r.range(0, Math.PI * 2),
        spin: r.range(-8, 8),
        front: o.front ?? true,
      })
    }
  }

  text(text: string, at: Vec, color: string, size = 26): void {
    if (!this.enabled) return
    if (this.texts.length >= MAX_TEXTS) this.texts.shift()
    // Nudge new numbers so rapid hits stack instead of overlapping exactly.
    let y = at.y
    for (const t of this.texts) {
      if (t.maxLife - t.life < 0.25 && Math.abs(t.x - at.x) < 50 && Math.abs(t.y - y) < size * 0.8) {
        y = t.y - size * 0.8
      }
    }
    const life = 0.95
    this.texts.push({
      text,
      x: at.x + this.rng.range(-14, 14),
      y,
      vy: -38,
      life,
      maxLife: life,
      color,
      size,
    })
  }

  random(): number {
    return this.rng.next()
  }

  update(dt: number): void {
    const ps = this.particles
    let w = 0
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      p.life -= dt
      if (p.life <= 0) continue
      const k = dm.exp(-p.drag * dt)
      p.vx *= k
      p.vy = p.vy * k + p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rotation += p.spin * dt
      ps[w++] = p
    }
    ps.length = w

    const ts = this.texts
    w = 0
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]
      t.life -= dt
      if (t.life <= 0) continue
      t.y += t.vy * dt
      t.vy *= dm.exp(-2.5 * dt)
      ts[w++] = t
    }
    ts.length = w
  }
}
