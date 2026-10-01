import { type Vec, len } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { CharacterDef } from './types'

const FIRST_SPIT = 0.75
export const SPIT_INTERVAL = 0.9
const GLOB_FLIGHT = 0.15
export const PUDDLE_RADIUS = BALL_RADIUS * 0.47
/** Extra reach for touching a puddle (the source footage is generous). */
const TOUCH_SLACK = 5
export const MAX_PUDDLES = 12
const FRESH_TIME = 4
export const ACID_DAMAGE = 2
const ACID_TICK = 0.5
/** A puddle keeps burning this long after the last touch (s). */
const LINGER = 0.5
/** Standing in several puddles multiplies each tick, up to this many. */
export const MAX_STACK = 2

interface Glob {
  from: Vec
  to: Vec
  t: number
}

interface Puddle {
  pos: Vec
  born: number
  /** Polygon vertices relative to `pos`. */
  shape: Vec[]
  bubbles: Vec[]
}

/**
 * 强酸 — spits a glob of acid behind itself every 0.7 s. The puddles stay
 * for good. Touching acid sets the enemy burning for a while; standing in
 * several puddles at once makes each tick hurt more.
 */
export class AcidAbility extends Ability {
  private globs: Glob[] = []
  private puddles: Puddle[] = []
  private timer = FIRST_SPIT
  /** World time the enemy last touched any puddle. */
  private lastTouch = -Infinity
  private nextTick = 0

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += SPIT_INTERVAL
        this.spit()
      }
    }
    for (const g of this.globs) g.t += dt
    for (const g of this.globs) if (g.t >= GLOB_FLIGHT) this.land(g.to)
    this.globs = this.globs.filter((g) => g.t < GLOB_FLIGHT)
    this.burn()
  }

  private spit(): void {
    const o = this.owner
    const rng = this.world.rng
    const sp = len(o.vel) || 1
    // Tossed backwards with some scatter.
    const back = Math.atan2(-o.vel.y / sp, -o.vel.x / sp) + rng.range(-0.8, 0.8)
    const dist = BALL_RADIUS * rng.range(1.2, 2.4)
    const s = this.world.size
    const to = {
      x: Math.min(s - PUDDLE_RADIUS, Math.max(PUDDLE_RADIUS, o.pos.x + Math.cos(back) * dist)),
      y: Math.min(s - PUDDLE_RADIUS, Math.max(PUDDLE_RADIUS, o.pos.y + Math.sin(back) * dist)),
    }
    this.globs.push({ from: { x: o.pos.x, y: o.pos.y }, to, t: 0 })
  }

  private land(at: Vec): void {
    const rng = this.world.rng
    const sides = rng.int(5, 7)
    const shape: Vec[] = []
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + rng.range(-0.25, 0.25)
      const r = PUDDLE_RADIUS * rng.range(0.75, 1.15)
      shape.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
    }
    const bubbles: Vec[] = []
    for (let i = 0; i < 5; i++) {
      const a = rng.range(0, Math.PI * 2)
      const r = PUDDLE_RADIUS * 0.7 * Math.sqrt(rng.next())
      bubbles.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
    }
    if (this.puddles.length >= MAX_PUDDLES) this.puddles.shift()
    this.puddles.push({ pos: { x: at.x, y: at.y }, born: this.world.time, shape, bubbles })
    this.world.effects.burst(at, { count: 6, color: ['#d2e498', '#84cc16'], speed: [30, 110], size: [2, 3.5], life: [0.2, 0.4] })
  }

  private burn(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const now = this.world.time
    const reach = e.radius + PUDDLE_RADIUS + TOUCH_SLACK
    let touching = 0
    for (const p of this.puddles) {
      if ((e.pos.x - p.pos.x) ** 2 + (e.pos.y - p.pos.y) ** 2 < reach * reach) touching++
    }
    if (touching > 0) {
      // Fresh contact starts the burn immediately.
      if (now - this.lastTouch > LINGER) this.nextTick = now
      this.lastTouch = now
    }
    if (now - this.lastTouch > LINGER || now < this.nextTick) return
    this.nextTick = now + ACID_TICK
    const stack = Math.min(MAX_STACK, Math.max(1, touching))
    this.world.damage(e, ACID_DAMAGE * stack, { kind: 'acid', source: this.owner, at: e.pos })
  }

  /** Whether any puddle is currently burning the enemy. */
  private get burning(): boolean {
    return this.world.time - this.lastTouch <= LINGER
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const now = this.world.time
    ctx.save()
    ctx.globalAlpha = fade
    for (const p of this.puddles) {
      const age = now - p.born
      const grow = Math.min(1, age / 0.18)
      const fresh = age < FRESH_TIME
      drawPuddle(ctx, p, grow, fresh ? '#2a5a14' : '#1c441a')
      if (fresh) {
        ctx.fillStyle = '#a3e635'
        for (const [i, b] of p.bubbles.entries()) {
          const pulse = 0.5 + 0.5 * Math.sin(now * 6 + i * 1.9)
          ctx.beginPath()
          ctx.arc(p.pos.x + b.x * grow, p.pos.y + b.y * grow, 1.2 + pulse * 1.6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    if (this.presence <= 0) return
    ctx.save()
    // Globs in flight.
    ctx.fillStyle = '#d2e498'
    for (const g of this.globs) {
      const u = g.t / GLOB_FLIGHT
      ctx.beginPath()
      ctx.arc(g.from.x + (g.to.x - g.from.x) * u, g.from.y + (g.to.y - g.from.y) * u - Math.sin(u * Math.PI) * 10, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
    // Corrosion speckles on a burning enemy.
    const e = this.enemy
    if (e.alive && this.burning) {
      ctx.beginPath()
      ctx.arc(e.pos.x, e.pos.y, e.radius, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = 'rgba(20,83,45,0.75)'
      const t = Math.floor(this.world.time * 8)
      for (let i = 0; i < 9; i++) {
        const h = Math.sin((t + i * 7.3) * 12.9898) * 43758.5453
        const u = h - Math.floor(h)
        const a = u * Math.PI * 2
        const r = e.radius * (0.2 + 0.75 * ((i * 0.37) % 1))
        ctx.beginPath()
        ctx.arc(e.pos.x + Math.cos(a) * r, e.pos.y + Math.sin(a) * r, 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }
}

function drawPuddle(ctx: CanvasRenderingContext2D, p: { pos: Vec; shape: Vec[] }, scale: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  p.shape.forEach((v, i) => {
    const x = p.pos.x + v.x * scale
    const y = p.pos.y + v.y * scale
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.fill()
}

export function drawAcidPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const blobs: [number, number, string][] = [
    [-1.8, 1.2, '#1c441a'],
    [-0.9, 1.9, '#2a5a14'],
    [1.6, 1.5, '#1c441a'],
    [1.9, -1.3, '#2a5a14'],
  ]
  for (const [dx, dy, c] of blobs) {
    const shape = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2
      const rr = r * 0.5 * (0.8 + 0.3 * Math.sin(i * 2.7 + dx))
      return { x: Math.cos(a) * rr, y: Math.sin(a) * rr }
    })
    drawPuddle(ctx, { pos: { x: cx + dx * r, y: cy + dy * r }, shape }, 1, c)
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
}

export const acidDef: CharacterDef = {
  id: 'acid',
  name: '强酸',
  nameEn: 'ACID BALL',
  tagline: '走过的地方寸草不生',
  rules: [
    `每 ${SPIT_INTERVAL} 秒往身后吐一滩强酸`,
    `敌人碰到酸液就被腐蚀：每 0.5 秒 -${ACID_DAMAGE}，离开后还会再烧约 0.5 秒`,
    `同时踩着好几滩会成倍叠加（最多 ${MAX_STACK} 倍）`,
    `酸液一直留在场上（最多 ${MAX_PUDDLES} 滩），自己不受影响`,
  ],
  palette: { ball: '#0f542c', text: '#ffffff', accent: '#2f8a4f' },
  mirrorPalette: { ball: '#3f6212', text: '#ecfccb', accent: '#84cc16' },
  create: (w, b) => new AcidAbility(w, b),
  drawPortrait: drawAcidPortrait,
}
