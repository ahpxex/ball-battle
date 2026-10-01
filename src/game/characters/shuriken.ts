import { type Vec, len } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { CharacterDef } from './types'

export const STAR_DAMAGE = 5
const STAR_SPEED = 420
/** Collision reach added to the enemy's radius. */
const STAR_HIT_RADIUS = 12
const STAR_DRAW_RADIUS = 20
const FIRST_VOLLEY_DELAY = 0.8
/** Pause after the last star of a volley before the next volley (s). */
export const VOLLEY_COOLDOWN = 3.8
/** Gap between stars inside one volley (s). */
const VOLLEY_SPACING = 0.375
export const MAX_VOLLEY = 4
/** Safety bounds; stars normally live until they hit. */
const STAR_LIFETIME = 12
const MAX_STARS = 10

interface Star {
  pos: Vec
  vel: Vec
  age: number
  spin: number
}

/** Volley size grows over the fight: 1, 1, 2, 3, 4, 5, 5, … */
export function volleySize(index: number): number {
  return Math.min(MAX_VOLLEY, 1 + Math.floor(index * 0.8))
}

/**
 * 手里剑 — throws volleys of spinning stars along its own heading. Stars
 * ricochet off walls forever until they find the enemy. Volleys grow
 * larger as the fight goes on.
 */
export class ShurikenAbility extends Ability {
  private stars: Star[] = []
  private timer = FIRST_VOLLEY_DELAY
  private volleyIndex = 0
  /** Stars still to throw in the current volley. */
  private pending = 0

  override update(dt: number): void {
    this.updateThrowing(dt)
    this.updateStars(dt)
  }

  private updateThrowing(dt: number): void {
    if (!this.world.combatActive || this.owner.disarmed) return
    this.timer -= dt
    if (this.timer > 0) return
    if (this.pending === 0) {
      this.pending = volleySize(this.volleyIndex)
      this.volleyIndex += 1
    }
    this.throwStar()
    this.pending -= 1
    this.timer = this.pending > 0 ? VOLLEY_SPACING : VOLLEY_COOLDOWN
  }

  private throwStar(): void {
    const o = this.owner
    const sp = len(o.vel)
    // Thrown along the current heading.
    const dir = sp > 1 ? { x: o.vel.x / sp, y: o.vel.y / sp } : { x: 1, y: 0 }
    if (this.stars.length >= MAX_STARS) this.stars.shift()
    this.stars.push({
      pos: { x: o.pos.x, y: o.pos.y },
      vel: { x: dir.x * STAR_SPEED, y: dir.y * STAR_SPEED },
      age: 0,
      spin: this.world.rng.range(0, Math.PI * 2),
    })
    this.world.sound('throw', 0.5)
  }

  private updateStars(dt: number): void {
    const s = this.world.size
    const e = this.enemy
    const r = STAR_DRAW_RADIUS * 0.6
    const kept: Star[] = []
    for (const st of this.stars) {
      st.age += dt
      st.spin += dt * 7
      st.pos.x += st.vel.x * dt
      st.pos.y += st.vel.y * dt
      if (st.pos.x < r && st.vel.x < 0) st.vel.x = -st.vel.x
      else if (st.pos.x > s - r && st.vel.x > 0) st.vel.x = -st.vel.x
      if (st.pos.y < r && st.vel.y < 0) st.vel.y = -st.vel.y
      else if (st.pos.y > s - r && st.vel.y > 0) st.vel.y = -st.vel.y

      const reach = e.radius + STAR_HIT_RADIUS
      if (e.alive && this.world.combatActive && (st.pos.x - e.pos.x) ** 2 + (st.pos.y - e.pos.y) ** 2 < reach * reach) {
        this.world.damage(e, STAR_DAMAGE, { kind: 'shuriken', source: this.owner, at: st.pos })
        continue
      }
      if (st.age < STAR_LIFETIME) kept.push(st)
    }
    this.stars = kept
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const st of this.stars) {
      // Faint streak behind the star.
      const sp = len(st.vel) || 1
      ctx.strokeStyle = 'rgba(203,213,225,0.25)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(st.pos.x, st.pos.y)
      ctx.lineTo(st.pos.x - (st.vel.x / sp) * 26, st.pos.y - (st.vel.y / sp) * 26)
      ctx.stroke()
      drawShurikenStar(ctx, st.pos.x, st.pos.y, STAR_DRAW_RADIUS, st.spin)
    }
    ctx.restore()
  }
}

export function drawShurikenStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    const tip = { x: Math.cos(a) * r, y: Math.sin(a) * r }
    const next = { x: Math.cos(a + Math.PI / 2) * r, y: Math.sin(a + Math.PI / 2) * r }
    if (i === 0) ctx.moveTo(tip.x, tip.y)
    // Concave side curving in towards the centre.
    const mid = a + Math.PI / 4
    ctx.quadraticCurveTo(Math.cos(mid) * r * 0.12, Math.sin(mid) * r * 0.12, next.x, next.y)
  }
  ctx.closePath()
  const g = ctx.createLinearGradient(-r, -r, r, r)
  g.addColorStop(0, '#e2e8f0')
  g.addColorStop(0.5, '#a9b8d0')
  g.addColorStop(1, '#d0daf0')
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = '#64748b'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = '#f8fafc'
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#101830'
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawShurikenPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  drawShurikenStar(ctx, cx + r * 1.7, cy - r * 1.2, r * 0.6, 0.3)
  drawShurikenStar(ctx, cx - r * 1.6, cy + r * 1.4, r * 0.5, 1.1)
}

export const shurikenDef: CharacterDef = {
  id: 'shuriken',
  name: '手里剑',
  nameEn: 'SHURIKEN',
  tagline: '飞镖满天飞',
  rules: [
    '定时沿自己前进的方向连续掷出手里剑',
    `手里剑会在墙壁间无限反弹，命中敌人 -${STAR_DAMAGE} 后消失`,
    `每轮投掷越来越多，最多一次 ${MAX_VOLLEY} 枚`,
    `每轮之间间隔 ${VOLLEY_COOLDOWN} 秒`,
  ],
  palette: { ball: '#31a7f9', text: '#ffffff', accent: '#3ca0f0' },
  mirrorPalette: { ball: '#1d4ed8', text: '#dbeafe', accent: '#3b82f6' },
  create: (w, b) => new ShurikenAbility(w, b),
  drawPortrait: drawShurikenPortrait,
}
