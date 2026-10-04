import * as dm from '../core/dmath'
import { distanceToSegment } from '../core/geometry'
import { type Vec, angleDiff, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import { roundRectPath } from '../render/draw'
import type { CharacterDef } from './types'

/** Gun turn rate towards the enemy (rad/s) — deliberately sluggish. */
export const TURN_SPEED = 3
/** The first shot is fired this long into the fight (s). */
export const FIRST_SHOT = 3.5
/** Interval before the second shot; each shot multiplies it by INTERVAL_DECAY. */
export const INTERVAL_START = 2.0
export const INTERVAL_DECAY = 0.96
/** The interval never drops below this (s). */
export const INTERVAL_MIN = 1.2
export const PELLETS = 5
export const PELLET_DAMAGE = 1
/** Each pellet deviates from the barrel by up to this much (rad). */
const SPREAD = (5 * Math.PI) / 180
const PELLET_SPEED = 1600
/** Collision reach added to the enemy's radius. */
const PELLET_HIT_SLACK = 3
const PELLET_DRAW_RADIUS = 2
/** Distance from the ball centre to the muzzle. */
const MUZZLE_DISTANCE = BALL_RADIUS * 3.3
/** Pellets start their travel at the ball rim (they fly through the barrel). */
const BREECH_DISTANCE = BALL_RADIUS
const FLASH_TIME = 0.1

interface Pellet {
  pos: Vec
  vel: Vec
}

/** Cooldown after `shots` shots have been fired: max(MIN, START · DECAY^shots). */
export function shotInterval(shots: number): number {
  return Math.max(INTERVAL_MIN, INTERVAL_START * dm.pow(INTERVAL_DECAY, shots))
}

/**
 * 霰弹枪 SHOTGUN V2 — a pump-action shotgun that slowly swivels towards the
 * enemy and fires a tight four-pellet spread whenever it is reloaded, aimed
 * or not. Every shot shortens the reload, so the barrage keeps accelerating.
 */
export class ShotgunAbility extends Ability {
  private angle: number
  private timer = FIRST_SHOT
  private shots = 0
  private pellets: Pellet[] = []
  /** Seconds since the last shot, for the muzzle flash. */
  private sinceShot = Infinity

  constructor(world: World, owner: Ball) {
    super(world, owner)
    const e = this.enemy
    this.angle = dm.atan2(e.pos.y - owner.pos.y, e.pos.x - owner.pos.x)
  }

  override update(dt: number): void {
    this.sinceShot += dt
    this.turn(dt)
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.fire()
        this.shots += 1
        this.timer += shotInterval(this.shots)
      }
    }
    this.updatePellets(dt)
  }

  private turn(dt: number): void {
    const e = this.enemy
    if (!e.alive) return
    const o = this.owner.pos
    const want = dm.atan2(e.pos.y - o.y, e.pos.x - o.x)
    const step = TURN_SPEED * dt
    this.angle += clamp(angleDiff(this.angle, want), -step, step)
  }

  private fire(): void {
    const o = this.owner.pos
    const e = this.enemy
    const rng = this.world.rng
    let hitAtMuzzle = false
    for (let i = 0; i < PELLETS; i++) {
      const a = this.angle + rng.range(-SPREAD, SPREAD)
      const dx = dm.cos(a)
      const dy = dm.sin(a)
      const breech = { x: o.x + dx * BREECH_DISTANCE, y: o.y + dy * BREECH_DISTANCE }
      const muzzle = { x: o.x + dx * MUZZLE_DISTANCE, y: o.y + dy * MUZZLE_DISTANCE }
      // An enemy pressed against the barrel is hit before the pellet leaves it.
      if (e.alive && distanceToSegment(e.pos, breech, muzzle) < e.radius + PELLET_HIT_SLACK) {
        this.world.damage(e, PELLET_DAMAGE, { kind: 'pellet', source: this.owner, at: muzzle })
        hitAtMuzzle = true
        continue
      }
      this.pellets.push({ pos: muzzle, vel: { x: dx * PELLET_SPEED, y: dy * PELLET_SPEED } })
    }
    this.sinceShot = 0
    this.world.sound('explosion', 0.35, 1.9)
    if (hitAtMuzzle) this.world.addShake(1.5)
    // Spent shell kicked out of the receiver, arcing away to the side.
    const side = this.angle - Math.PI / 2
    const receiver = { x: o.x + dm.cos(this.angle) * BALL_RADIUS * 1.4, y: o.y + dm.sin(this.angle) * BALL_RADIUS * 1.4 }
    this.world.effects.burst(receiver, { count: 1, color: '#c2410c', shape: 'shard', direction: side, spread: 0.35, speed: [140, 190], size: [3.5, 4.5], life: [0.3, 0.4], gravity: 700, drag: 1, endScale: 1 })
    const muzzle = { x: o.x + dm.cos(this.angle) * MUZZLE_DISTANCE, y: o.y + dm.sin(this.angle) * MUZZLE_DISTANCE }
    this.world.effects.burst(muzzle, { count: 5, color: ['#e5e7eb', '#a1a1aa'], shape: 'smoke', direction: this.angle, spread: 0.5, speed: [30, 110], size: [4, 8], life: [0.25, 0.5], endScale: 2.2 })
  }

  private updatePellets(dt: number): void {
    const s = this.world.size
    const e = this.enemy
    const kept: Pellet[] = []
    for (const p of this.pellets) {
      const from = { x: p.pos.x, y: p.pos.y }
      p.pos.x += p.vel.x * dt
      p.pos.y += p.vel.y * dt
      // Swept test: a pellet covers ~13 units per step.
      if (e.alive && distanceToSegment(e.pos, from, p.pos) < e.radius + PELLET_HIT_SLACK) {
        this.world.damage(e, PELLET_DAMAGE, { kind: 'pellet', source: this.owner, at: { x: p.pos.x, y: p.pos.y } })
        continue
      }
      if (p.pos.x < 0 || p.pos.x > s || p.pos.y < 0 || p.pos.y > s) continue
      kept.push(p)
    }
    this.pellets = kept
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner.pos
    drawShotgun(ctx, o.x, o.y, this.angle, this.owner.radius)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    ctx.fillStyle = '#ffffff'
    for (const p of this.pellets) {
      ctx.beginPath()
      ctx.arc(p.pos.x, p.pos.y, PELLET_DRAW_RADIUS, 0, Math.PI * 2)
      ctx.fill()
    }
    if (this.sinceShot < FLASH_TIME && this.owner.alive) {
      const o = this.owner.pos
      const u = 1 - this.sinceShot / FLASH_TIME
      drawMuzzleFlash(ctx, o.x + dm.cos(this.angle) * MUZZLE_DISTANCE, o.y + dm.sin(this.angle) * MUZZLE_DISTANCE, this.angle, BALL_RADIUS * 0.35 * (0.7 + 0.3 * u), u)
    }
    ctx.restore()
  }
}

/** Pump-action shotgun lying along `angle`, stock inside the ball, muzzle at 3.3 r. */
export function drawShotgun(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number): void {
  const k = r / BALL_RADIUS
  const muzzle = MUZZLE_DISTANCE * k
  const edge = 'rgba(214,214,206,0.75)'
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 1.2 * k
  ctx.strokeStyle = edge
  // Stock: slightly taller, tapering into the grip.
  ctx.fillStyle = '#262624'
  ctx.beginPath()
  ctx.moveTo(r * 0.35, -r * 0.17)
  ctx.lineTo(r * 1.05, -r * 0.13)
  ctx.lineTo(r * 1.05, r * 0.13)
  ctx.lineTo(r * 0.35, r * 0.19)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Receiver.
  ctx.fillStyle = '#202020'
  roundRectPath(ctx, r * 1.05, -r * 0.15, r * 0.7, r * 0.3, 2 * k)
  ctx.fill()
  ctx.stroke()
  // Magazine tube under the barrel.
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(r * 1.75, 0, r * 1.2, r * 0.12)
  ctx.strokeRect(r * 1.75, 0, r * 1.2, r * 0.12)
  // Barrel.
  ctx.fillStyle = '#202020'
  ctx.fillRect(r * 1.75, -r * 0.12, muzzle - r * 1.75, r * 0.12)
  ctx.strokeRect(r * 1.75, -r * 0.12, muzzle - r * 1.75, r * 0.12)
  // Ribbed pump fore-end.
  ctx.fillStyle = '#2c2c2a'
  roundRectPath(ctx, r * 2.0, -r * 0.02, r * 0.62, r * 0.17, 2 * k)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = 'rgba(214,214,206,0.35)'
  ctx.beginPath()
  for (let x = r * 2.1; x < r * 2.58; x += r * 0.1) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, r * 0.13)
  }
  ctx.stroke()
  // Highlight along the top of the barrel and the bead sight.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  ctx.moveTo(r * 1.1, -r * 0.13)
  ctx.lineTo(muzzle - 1, -r * 0.11)
  ctx.stroke()
  ctx.fillStyle = '#e5e5e5'
  ctx.fillRect(muzzle - r * 0.1, -r * 0.17, r * 0.06, r * 0.05)
  ctx.restore()
}

/** White puff with an orange-yellow core, pointing along `angle`. */
function drawMuzzleFlash(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, radius: number, u: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.globalAlpha *= 0.6 + 0.4 * u
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(radius * 0.8, 0, radius, 0, Math.PI * 2)
  ctx.fill()
  // Short spikes of flame ahead of the puff.
  ctx.beginPath()
  for (const a of [-0.55, 0, 0.55]) {
    ctx.moveTo(radius * 0.8 + dm.cos(a + Math.PI / 2) * radius * 0.4, dm.sin(a + Math.PI / 2) * radius * 0.4)
    ctx.lineTo(radius * 0.8 + dm.cos(a) * radius * 2, dm.sin(a) * radius * 2)
    ctx.lineTo(radius * 0.8 + dm.cos(a - Math.PI / 2) * radius * 0.4, dm.sin(a - Math.PI / 2) * radius * 0.4)
  }
  ctx.fill()
  ctx.fillStyle = '#fb923c'
  ctx.beginPath()
  ctx.arc(radius * 0.7, 0, radius * 0.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fde047'
  ctx.beginPath()
  ctx.arc(radius * 0.7, 0, radius * 0.32, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawShotgunPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const bx = cx - r * 1.1
  const by = cy + r * 0.9
  const a = -0.62
  const s = r * 0.72
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bx, by, s, 0, Math.PI * 2)
  ctx.fill()
  drawShotgun(ctx, bx, by, a, s)
  const mx = bx + dm.cos(a) * MUZZLE_DISTANCE * (s / BALL_RADIUS)
  const my = by + dm.sin(a) * MUZZLE_DISTANCE * (s / BALL_RADIUS)
  drawMuzzleFlash(ctx, mx, my, a, s * 0.35, 1)
  ctx.fillStyle = '#ffffff'
  for (const [d, off] of [[1.0, -0.06], [1.3, 0.03], [1.55, -0.02], [1.2, 0.08]] as const) {
    ctx.beginPath()
    ctx.arc(mx + dm.cos(a + off) * s * d, my + dm.sin(a + off) * s * d, 2, 0, Math.PI * 2)
    ctx.fill()
  }
}

export const shotgunDef: CharacterDef = {
  id: 'shotgun',
  nameEn: 'SHOTGUN V2',
  ruleValues: { turnDegrees: Math.round((TURN_SPEED * 180) / Math.PI), firstShot: FIRST_SHOT, pellets: PELLETS, pelletDamage: PELLET_DAMAGE, intervalStart: INTERVAL_START, intervalShrinkPercent: Math.round((1 - INTERVAL_DECAY) * 100), intervalMin: INTERVAL_MIN },
  palette: { ball: '#606058', text: '#ffffff', accent: '#8a8a7a' },
  mirrorPalette: { ball: '#3f3f46', text: '#f4f4f5', accent: '#a1a1aa' },
  create: (w, b) => new ShotgunAbility(w, b),
  drawPortrait: drawShotgunPortrait,
}
