import { type Vec, clamp, dot, len } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import type { World } from '../engine/World'
import { drawChain, drawGrapplingHook } from '../render/draw'
import type { CharacterDef } from './types'

const HOOK_RADIUS = 18
/** Drawing scale of the hook sprite; its eye ring sits 15 units behind the centre at scale 1. */
const HOOK_SCALE = 1.45
/** Resting chain length, ball centre to hook centre. */
const ROPE_LENGTH = 95
/** Chain length paid out during a cast. */
const CAST_ROPE_LENGTH = 210
const HOOK_MASS = 0.5
/** Fraction of rope tension transferred back into the ball. */
const TUG = 0.25
const AIR_DRAG = 0.35
const WALL_RESTITUTION = 0.65

/** A cast is thrown when the enemy comes within this distance. */
const CAST_RANGE = 250
const CAST_SPEED = 950
export const CAST_COOLDOWN = 1.6
/** How long the line stays paid out before reeling in (s). */
const CAST_HOLD = 0.32
const REEL_SPEED = 420
/** Pull applied to an enemy caught by a cast. */
const YANK_SPEED = 260

/** Idle flail: periodic sideways whip of the hook. */
const SWING_INTERVAL = 1.2
const SWING_IMPULSE = 560

/** Impact speed (along the contact normal) that converts to 1 damage. */
const SPEED_PER_DAMAGE = 140
const MIN_IMPACT = 60
export const MAX_DAMAGE = 6
const HIT_COOLDOWN = 0.28
const TRAIL_LENGTH = 12

/**
 * 鱼钩 — drags a barbed hook on a chain. When the enemy comes close it casts
 * the hook out like a fishing line; a hooked enemy gets yanked back in.
 * Otherwise the hook swings like a flail. Damage scales with impact speed.
 */
export class HookAbility extends Ability {
  private pos: Vec
  private vel: Vec = { x: 0, y: 0 }
  private ropeLength = ROPE_LENGTH
  private casting = false
  private castAge = 0
  private castCooldown = 0.6
  private swingTimer = 0.8
  private hitCooldown = 0
  private trail: Vec[] = []

  constructor(world: World, owner: Ball) {
    super(world, owner)
    const sp = len(owner.vel) || 1
    // Start trailing behind the ball.
    this.pos = {
      x: owner.pos.x - (owner.vel.x / sp) * ROPE_LENGTH,
      y: owner.pos.y - (owner.vel.y / sp) * ROPE_LENGTH,
    }
  }

  override update(dt: number): void {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt)
    this.castCooldown = Math.max(0, this.castCooldown - dt)

    this.updateLine(dt)

    const k = Math.exp(-AIR_DRAG * dt)
    this.vel.x *= k
    this.vel.y *= k
    this.pos.x += this.vel.x * dt
    this.pos.y += this.vel.y * dt

    this.collideWalls()
    this.applyRope()
    this.hitEnemy()

    this.trail.push({ x: this.pos.x, y: this.pos.y })
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift()
  }

  /** Decides between casting, reeling in and idle swinging. */
  private updateLine(dt: number): void {
    if (this.casting) {
      this.castAge += dt
      if (this.castAge > CAST_HOLD) this.reel(dt)
      return
    }
    if (this.ropeLength > ROPE_LENGTH) {
      this.reel(dt)
      return
    }
    if (!this.world.combatActive || this.owner.disarmed) return
    const o = this.owner
    const e = this.enemy
    if (this.castCooldown <= 0 && e.alive && Math.hypot(e.pos.x - o.pos.x, e.pos.y - o.pos.y) < CAST_RANGE) {
      this.cast(e)
      return
    }
    this.swingTimer -= dt
    if (this.swingTimer <= 0) this.swing(e)
  }

  private cast(target: Ball): void {
    const o = this.owner
    // Lead the target slightly.
    const aimX = target.pos.x + target.vel.x * 0.15 - o.pos.x
    const aimY = target.pos.y + target.vel.y * 0.15 - o.pos.y
    const d = Math.hypot(aimX, aimY) || 1
    // Launch from the near side of the ball so the line pays out cleanly.
    this.pos.x = o.pos.x + (aimX / d) * (o.radius + HOOK_RADIUS)
    this.pos.y = o.pos.y + (aimY / d) * (o.radius + HOOK_RADIUS)
    this.vel.x = (aimX / d) * CAST_SPEED + o.vel.x * 0.5
    this.vel.y = (aimY / d) * CAST_SPEED + o.vel.y * 0.5
    this.ropeLength = CAST_ROPE_LENGTH
    this.casting = true
    this.castAge = 0
    this.castCooldown = CAST_COOLDOWN
    this.trail = []
    this.world.sound('whoosh', 0.7, 1.15)
  }

  private reel(dt: number): void {
    this.casting = false
    this.ropeLength = Math.max(ROPE_LENGTH, this.ropeLength - REEL_SPEED * dt)
  }

  private swing(enemy: Ball): void {
    this.swingTimer = SWING_INTERVAL + this.world.rng.range(-0.25, 0.25)
    const o = this.owner
    const dx = this.pos.x - o.pos.x
    const dy = this.pos.y - o.pos.y
    const d = Math.hypot(dx, dy) || 1
    // Tangent of the rope circle, oriented to sweep towards the enemy.
    let tx = -dy / d
    let ty = dx / d
    if ((enemy.pos.x - o.pos.x) * tx + (enemy.pos.y - o.pos.y) * ty < 0) {
      tx = -tx
      ty = -ty
    }
    this.vel.x += tx * SWING_IMPULSE
    this.vel.y += ty * SWING_IMPULSE
    this.world.sound('whoosh', 0.35)
  }

  private collideWalls(): void {
    const s = this.world.size
    const r = HOOK_RADIUS
    let impact = 0
    if (this.pos.x < r && this.vel.x < 0) {
      impact = -this.vel.x
      this.vel.x = -this.vel.x * WALL_RESTITUTION
    } else if (this.pos.x > s - r && this.vel.x > 0) {
      impact = this.vel.x
      this.vel.x = -this.vel.x * WALL_RESTITUTION
    }
    if (this.pos.y < r && this.vel.y < 0) {
      impact = Math.max(impact, -this.vel.y)
      this.vel.y = -this.vel.y * WALL_RESTITUTION
    } else if (this.pos.y > s - r && this.vel.y > 0) {
      impact = Math.max(impact, this.vel.y)
      this.vel.y = -this.vel.y * WALL_RESTITUTION
    }
    this.pos.x = clamp(this.pos.x, r, s - r)
    this.pos.y = clamp(this.pos.y, r, s - r)
    if (impact > 250) {
      this.world.effects.burst(this.pos, { count: 5, color: ['#fde68a', '#ffffff'], shape: 'spark', speed: [100, 260], size: [1.5, 3], life: [0.15, 0.3] })
      this.world.sound('clack', clamp(impact / 1200, 0.15, 0.5), 1.4)
    }
  }

  private applyRope(): void {
    const o = this.owner
    const dx = this.pos.x - o.pos.x
    const dy = this.pos.y - o.pos.y
    const d = Math.hypot(dx, dy) || 1e-6
    const nx = dx / d
    const ny = dy / d
    const minD = o.radius + HOOK_RADIUS
    if (d > this.ropeLength) {
      this.pos.x = o.pos.x + nx * this.ropeLength
      this.pos.y = o.pos.y + ny * this.ropeLength
      // Inelastic rope: remove the outward relative speed, tug the ball.
      const vr = (this.vel.x - o.vel.x) * nx + (this.vel.y - o.vel.y) * ny
      if (vr > 0) {
        this.vel.x -= nx * vr
        this.vel.y -= ny * vr
        if (o.movable) {
          o.vel.x += nx * vr * HOOK_MASS * TUG
          o.vel.y += ny * vr * HOOK_MASS * TUG
        }
      }
    } else if (d < minD) {
      // The hook rides around the ball rather than through it.
      this.pos.x = o.pos.x + nx * minD
      this.pos.y = o.pos.y + ny * minD
      const vr = (this.vel.x - o.vel.x) * nx + (this.vel.y - o.vel.y) * ny
      if (vr < 0) {
        this.vel.x -= nx * vr
        this.vel.y -= ny * vr
      }
    }
  }

  private hitEnemy(): void {
    const e = this.enemy
    if (!e.alive) return
    const dx = e.pos.x - this.pos.x
    const dy = e.pos.y - this.pos.y
    const minD = e.radius + HOOK_RADIUS
    const d2 = dx * dx + dy * dy
    if (d2 >= minD * minD) return
    const d = Math.sqrt(d2) || 1e-6
    const n = { x: dx / d, y: dy / d }
    // Separate the hook from the enemy.
    this.pos.x = e.pos.x - n.x * minD
    this.pos.y = e.pos.y - n.y * minD
    const rel = { x: this.vel.x - e.vel.x, y: this.vel.y - e.vel.y }
    const impact = dot(rel, n)
    if (impact <= 0) return
    // Bounce the hook back off the target.
    this.vel.x -= n.x * impact * 1.5
    this.vel.y -= n.y * impact * 1.5
    if (impact < MIN_IMPACT || this.hitCooldown > 0) return
    this.hitCooldown = HIT_COOLDOWN

    const o = this.owner
    let knock: Vec
    if (this.casting) {
      // Hooked: reel the catch towards the ball.
      const tx = o.pos.x - e.pos.x
      const ty = o.pos.y - e.pos.y
      const td = Math.hypot(tx, ty) || 1
      knock = { x: (tx / td) * YANK_SPEED, y: (ty / td) * YANK_SPEED }
      this.casting = false
    } else {
      const k = Math.min(520, impact * 0.6)
      knock = { x: n.x * k, y: n.y * k }
    }
    const dmg = clamp(Math.round(impact / SPEED_PER_DAMAGE), 1, MAX_DAMAGE)
    this.world.damage(e, dmg, {
      kind: 'hook',
      source: o,
      at: { x: this.pos.x + n.x * HOOK_RADIUS, y: this.pos.y + n.y * HOOK_RADIUS },
      knock,
      shake: dmg >= 4 ? 5 : 2,
    })
  }

  private get hookAngle(): number {
    return Math.atan2(this.pos.y - this.owner.pos.y, this.pos.x - this.owner.pos.x)
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const o = this.owner
    const angle = this.hookAngle
    const speed = len(this.vel)
    ctx.save()
    ctx.globalAlpha = fade
    // Motion trail when whipping or casting.
    if (speed > 280 && this.trail.length > 2) {
      ctx.setLineDash([5, 6])
      ctx.strokeStyle = `rgba(255,255,255,${clamp((speed - 280) / 500, 0, 0.7)})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(this.trail[0].x, this.trail[0].y)
      for (const p of this.trail) ctx.lineTo(p.x, p.y)
      ctx.stroke()
      ctx.setLineDash([])
    }
    const ring = { x: this.pos.x - Math.cos(angle) * 15 * HOOK_SCALE, y: this.pos.y - Math.sin(angle) * 15 * HOOK_SCALE }
    const start = { x: o.pos.x + Math.cos(angle) * o.radius, y: o.pos.y + Math.sin(angle) * o.radius }
    const ropeLen = Math.hypot(this.pos.x - o.pos.x, this.pos.y - o.pos.y)
    drawChain(ctx, start, ring, clamp((this.ropeLength - ropeLen) * 0.3, 0, 18))
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    drawGrapplingHook(ctx, this.pos.x, this.pos.y, this.hookAngle, HOOK_SCALE)
    ctx.restore()
  }
}

export function drawHookPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const angle = -0.5
  const hx = cx + Math.cos(angle) * r * 2.1
  const hy = cy + Math.sin(angle) * r * 2.1
  drawChain(
    ctx,
    { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r },
    { x: hx - Math.cos(angle) * 15 * (r / 34), y: hy - Math.sin(angle) * 15 * (r / 34) },
  )
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  drawGrapplingHook(ctx, hx, hy, angle, r / 34)
}

export const hookDef: CharacterDef = {
  id: 'hook',
  name: '鱼钩',
  nameEn: 'HOOK',
  tagline: '链子一甩，钩到就疼',
  rules: [
    '用铁链拖着一枚倒刺钩，平时像流星锤一样甩动',
    `敌人靠近时抛出鱼钩（冷却 ${CAST_COOLDOWN} 秒），钩中后把敌人往回拽`,
    `伤害取决于撞击速度：1 ~ ${MAX_DAMAGE} 点`,
    '钩子会在墙壁上反弹',
  ],
  palette: { ball: '#f5b326', text: '#ffffff', accent: '#f5b326' },
  mirrorPalette: { ball: '#b45309', text: '#fef3c7', accent: '#d97706' },
  create: (w, b) => new HookAbility(w, b),
  drawPortrait: drawHookPortrait,
}
