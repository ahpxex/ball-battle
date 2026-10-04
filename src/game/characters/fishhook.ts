import * as dm from '../core/dmath'
import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import type { CharacterDef } from './types'

/** Hit radius of the hook itself. */
const HOOK_RADIUS = 11
const HOOK_SCALE = 1.6
const HOOK_SPEED = 520
/** How fast a catch is reeled back along the line. */
const REEL_SPEED = 300

export const REEL_TICK = 0.13
export const REEL_DAMAGE = 1
/** Time spent moving between reeling a catch in and casting again. */
export const RECAST_DELAY = 5
/** Speed (× the enemy's base speed) the catch is flung away with once it reaches the angler. */
const FLING = 1.3
/** Root applied to the catch while reeled, refreshed every step (so it lapses on its own if the angler dies). */
const HOLD_ROOT = 0.2

const LINE_COLOR = 'rgba(226,232,240,0.75)'

type State = 'roaming' | 'casting' | 'reeling'

/**
 * 鱼钩 — plants itself (stops moving, but can still be pushed or grabbed) and casts a hook on a fishing line. The hook flies like
 * a bullet and bounces off the walls at their mirror angle; the line is
 * pinned at every bounce, so it leaves the hook's whole path on the field.
 * The hook keeps bouncing until it snags the enemy, which is then reeled back
 * along the entire line to the angler, 1 damage per tick, and flung away.
 */
export class FishhookAbility extends Ability {
  private state: State = 'roaming'
  /** Hook position while flying. */
  private pos: Vec = { x: 0, y: 0 }
  private vel: Vec = { x: 0, y: 0 }
  /** The line: angler first, then every wall bounce, in order (the hook or catch is the free end). */
  private path: Vec[] = []
  private prey: Ball | null = null
  private tickTimer = 0
  private recast = 0
  /** Heading and cruise speed the angler resumes when it starts moving again. */
  private heading = 0
  private cruiseSpeed = 0

  override update(dt: number): void {
    if (this.state === 'casting') this.fly(dt)
    else if (this.state === 'reeling') this.reel(dt)
    else this.roam(dt)
  }

  private roam(dt: number): void {
    this.recast = Math.max(0, this.recast - dt)
    const o = this.owner
    const e = this.enemy
    if (this.recast > 0 || !this.world.combatActive || !e.alive || o.disarmed) return
    // Can't plant itself while something else is holding or steering it.
    if (o.pinned || o.attachedTo || o.rooted) return
    this.cast()
  }

  private cast(): void {
    const o = this.owner
    const e = this.enemy
    this.heading = dm.atan2(o.vel.y, o.vel.x)
    // Plant by dropping the cruise speed to zero rather than pinning: a planted angler can still be
    // knocked about, hooked or dragged (pinned would make it immune to every grab).
    this.cruiseSpeed = o.baseSpeed
    o.baseSpeed = 0
    o.vel = { x: 0, y: 0 }
    // Lead the target a little so a direct hit is possible.
    const ax = e.pos.x + e.vel.x * 0.25 - o.pos.x
    const ay = e.pos.y + e.vel.y * 0.25 - o.pos.y
    const d = dm.hypot(ax, ay) || 1
    this.pos = { x: o.pos.x + (ax / d) * (o.radius + HOOK_RADIUS), y: o.pos.y + (ay / d) * (o.radius + HOOK_RADIUS) }
    this.vel = { x: (ax / d) * HOOK_SPEED, y: (ay / d) * HOOK_SPEED }
    this.path = [{ x: o.pos.x, y: o.pos.y }]
    this.state = 'casting'
    this.world.sound('whoosh', 0.6, 1.3)
  }

  private fly(dt: number): void {
    this.pos.x += this.vel.x * dt
    this.pos.y += this.vel.y * dt
    this.bounceWalls()
    this.tryCatch()
  }

  /** Mirror reflection off the walls; the line gets pinned at the contact point. */
  private bounceWalls(): void {
    const s = this.world.size
    const r = HOOK_RADIUS
    let bounced = false
    if (this.pos.x < r && this.vel.x < 0) {
      this.vel.x = -this.vel.x
      bounced = true
    } else if (this.pos.x > s - r && this.vel.x > 0) {
      this.vel.x = -this.vel.x
      bounced = true
    }
    if (this.pos.y < r && this.vel.y < 0) {
      this.vel.y = -this.vel.y
      bounced = true
    } else if (this.pos.y > s - r && this.vel.y > 0) {
      this.vel.y = -this.vel.y
      bounced = true
    }
    if (!bounced) return
    this.pos.x = clamp(this.pos.x, r, s - r)
    this.pos.y = clamp(this.pos.y, r, s - r)
    this.path.push({ x: this.pos.x, y: this.pos.y })
    this.world.effects.burst(this.pos, { count: 4, color: ['#e2e8f0', '#ffffff'], shape: 'spark', speed: [60, 180], size: [1.5, 2.5], life: [0.1, 0.25] })
    this.world.sound('clack', 0.25, 1.6)
  }

  private tryCatch(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const reach = e.radius + HOOK_RADIUS
    const dx = e.pos.x - this.pos.x
    const dy = e.pos.y - this.pos.y
    if (dx * dx + dy * dy >= reach * reach) return
    // A shielded or already-held target can't be snagged: the hook glances off.
    const free = !e.pinned && !e.attachedTo
    const dealt = free ? this.world.damage(e, REEL_DAMAGE, { kind: 'fishhook', source: this.owner, at: { x: this.pos.x, y: this.pos.y } }) : 0
    if (dealt === 0 || !e.alive) {
      this.glance(e)
      return
    }
    e.applyRoot(HOLD_ROOT)
    e.vel = { x: 0, y: 0 }
    e.attachedTo = this.owner
    this.prey = e
    this.tickTimer = REEL_TICK
    this.state = 'reeling'
    this.world.sound('hook', 0.7, 1.2)
  }

  /** Reflects the hook off a ball it couldn't catch. */
  private glance(e: Ball): void {
    const dx = this.pos.x - e.pos.x
    const dy = this.pos.y - e.pos.y
    const d = dm.hypot(dx, dy) || 1
    const nx = dx / d
    const ny = dy / d
    const vn = this.vel.x * nx + this.vel.y * ny
    if (vn < 0) {
      this.vel.x -= 2 * vn * nx
      this.vel.y -= 2 * vn * ny
    }
    this.pos = { x: e.pos.x + nx * (e.radius + HOOK_RADIUS), y: e.pos.y + ny * (e.radius + HOOK_RADIUS) }
  }

  private holdValid(prey: Ball): boolean {
    return prey.alive && this.world.combatActive && prey.attachedTo === this.owner && !prey.pinned
  }

  /** Pulls the catch back along the line, bounce point by bounce point, to the angler. */
  private reel(dt: number): void {
    const e = this.prey!
    if (!this.holdValid(e)) {
      this.finish(false)
      return
    }
    e.applyRoot(HOLD_ROOT)
    e.vel = { x: 0, y: 0 }

    const o = this.owner
    const s = this.world.size
    let step = REEL_SPEED * dt
    while (step > 0 && this.path.length > 0) {
      // The last pinned point is the next waypoint (as close to it as the catch's body fits); the angler is the final one.
      const pin = this.path[this.path.length - 1]
      const target = this.path.length > 1 ? { x: clamp(pin.x, e.radius, s - e.radius), y: clamp(pin.y, e.radius, s - e.radius) } : o.pos
      const dx = target.x - e.pos.x
      const dy = target.y - e.pos.y
      const d = dm.hypot(dx, dy)
      if (this.path.length === 1) {
        // Final leg: stop against the angler's body.
        const move = Math.min(step, Math.max(0, d - (o.radius + e.radius)))
        e.pos.x += (dx / (d || 1)) * move
        e.pos.y += (dy / (d || 1)) * move
        break
      }
      if (d <= step) {
        e.pos.x = target.x
        e.pos.y = target.y
        step -= d
        this.path.pop()
      } else {
        e.pos.x += (dx / d) * step
        e.pos.y += (dy / d) * step
        step = 0
      }
    }
    this.tickTimer -= dt
    if (this.tickTimer <= 0) {
      this.tickTimer += REEL_TICK
      this.world.damage(e, REEL_DAMAGE, { kind: 'fishhook', source: o, at: this.hookPoint() })
      if (!e.alive) {
        this.finish(false)
        return
      }
    }
    if (this.path.length === 1 && dm.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y) <= o.radius + e.radius + 1) this.finish(true)
  }

  /** Ends the cast: lets go of any catch (`fling` throws it away from the angler) and starts moving again. */
  private finish(fling: boolean): void {
    const o = this.owner
    const e = this.prey
    this.prey = null
    this.path = []
    this.state = 'roaming'
    this.recast = RECAST_DELAY
    if (o.baseSpeed === 0) o.baseSpeed = this.cruiseSpeed
    // Set off again on the old heading, unless something else is holding the angler right now.
    if (o.alive && o.movable && !o.attachedTo) o.vel = { x: dm.cos(this.heading) * o.baseSpeed, y: dm.sin(this.heading) * o.baseSpeed }
    if (!e) return
    if (e.attachedTo === o) e.attachedTo = null
    if (!e.alive) return
    e.endRoot()
    if (fling) {
      const dx = e.pos.x - o.pos.x
      const dy = e.pos.y - o.pos.y
      const d = dm.hypot(dx, dy) || 1
      e.vel = { x: (dx / d) * e.baseSpeed * FLING, y: (dy / d) * e.baseSpeed * FLING }
      this.world.effects.burst(this.hookPoint(e), {
        count: 8,
        color: ['#e2e8f0', '#ffffff'],
        shape: 'spark',
        speed: [80, 220],
        size: [1.5, 3],
        life: [0.15, 0.35],
        direction: dm.atan2(dy, dx),
        spread: 0.7,
      })
      this.world.sound('whoosh', 0.5, 0.9)
    }
  }

  /** The free end of the line: the flying hook, or the catch being reeled. */
  private get lineEnd(): Vec {
    return this.prey ? this.prey.pos : this.pos
  }

  /** Direction the hook points: along its flight, or back along the line while reeling. */
  private get hookAngle(): number {
    if (this.state === 'casting') return dm.atan2(this.vel.y, this.vel.x)
    if (this.state === 'reeling' && this.prey) {
      const next = this.path.length > 1 ? this.path[this.path.length - 1] : this.owner.pos
      return dm.atan2(next.y - this.prey.pos.y, next.x - this.prey.pos.x)
    }
    return dm.atan2(this.owner.vel.y, this.owner.vel.x)
  }

  /** Where the hook sits: flying free, embedded in the catch, or hanging off the angler. */
  private hookPoint(prey: Ball | null = this.prey): Vec {
    const a = this.hookAngle
    if (prey) return { x: prey.pos.x + dm.cos(a) * prey.radius * 0.75, y: prey.pos.y + dm.sin(a) * prey.radius * 0.75 }
    if (this.state === 'casting') return this.pos
    const o = this.owner
    return { x: o.pos.x + dm.cos(a) * (o.radius + 4), y: o.pos.y + dm.sin(a) * (o.radius + 4) }
  }

  /** The fishing line runs beneath every ball: angler → each pinned bounce point → hook. */
  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.state === 'roaming' || this.path.length === 0) return
    const o = this.owner
    const end = this.lineEnd
    ctx.save()
    ctx.globalAlpha = fade
    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = 1.4
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(o.pos.x, o.pos.y)
    for (let i = 1; i < this.path.length; i++) ctx.lineTo(this.path[i].x, this.path[i].y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
    // Pins where the line catches on the wall.
    ctx.fillStyle = '#e2e8f0'
    for (let i = 1; i < this.path.length; i++) {
      ctx.beginPath()
      ctx.arc(this.path[i].x, this.path[i].y, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const p = this.hookPoint()
    ctx.save()
    ctx.globalAlpha = fade
    drawFishhook(ctx, p.x, p.y, this.hookAngle, this.state === 'roaming' ? HOOK_SCALE * 0.8 : HOOK_SCALE)
    ctx.restore()
  }
}

/** A J-shaped barbed fishhook: eye at the back, bend and point leading along +angle. */
export function drawFishhook(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale = 1): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.scale(scale, scale)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const steel = ctx.createLinearGradient(-14, -6, 12, 10)
  steel.addColorStop(0, '#f4f4f5')
  steel.addColorStop(0.5, '#a1a1aa')
  steel.addColorStop(1, '#e4e4e7')

  const path = () => {
    ctx.beginPath()
    // Shank, then the bend curling back, then the point.
    ctx.moveTo(-11, -3)
    ctx.lineTo(5, -3)
    ctx.arc(5, 2.5, 5.5, -Math.PI / 2, Math.PI / 2)
    ctx.lineTo(-1, 8)
  }
  ctx.strokeStyle = '#3f3f46'
  ctx.lineWidth = 4
  path()
  ctx.stroke()
  ctx.strokeStyle = steel
  ctx.lineWidth = 2.4
  path()
  ctx.stroke()

  // Barb.
  ctx.fillStyle = '#d4d4d8'
  ctx.strokeStyle = '#3f3f46'
  ctx.lineWidth = 0.9
  ctx.beginPath()
  ctx.moveTo(-3.5, 8)
  ctx.lineTo(1.5, 4.6)
  ctx.lineTo(0.6, 8.6)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Eye.
  ctx.strokeStyle = '#a1a1aa'
  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.arc(-13.5, -3, 2.6, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawFishhookPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const k = r / 34
  // Line from the ball to a pin on the "wall", bouncing back down to the hook.
  const pin = { x: cx + r * 1.7, y: cy - r * 2.1 }
  const hook = { x: cx + r * 2.25, y: cy + r * 0.9 }
  const angle = dm.atan2(hook.y - pin.y, hook.x - pin.x)
  ctx.strokeStyle = LINE_COLOR
  ctx.lineWidth = 1.6 * k
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(pin.x, pin.y)
  ctx.lineTo(hook.x - dm.cos(angle) * 14 * HOOK_SCALE * k, hook.y - dm.sin(angle) * 14 * HOOK_SCALE * k)
  ctx.stroke()
  ctx.fillStyle = '#e2e8f0'
  ctx.beginPath()
  ctx.arc(pin.x, pin.y, 3 * k, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  drawFishhook(ctx, hook.x, hook.y, angle, HOOK_SCALE * k)
}

export const fishhookDef: CharacterDef = {
  id: 'fishhook',
  nameEn: 'FISHHOOK',
  ruleValues: { reelTick: REEL_TICK, reelDamage: REEL_DAMAGE, recastDelay: RECAST_DELAY },
  palette: { ball: '#11a89a', text: '#ffffff', accent: '#2dd4bf' },
  mirrorPalette: { ball: '#115e59', text: '#ccfbf1', accent: '#5eead4' },
  create: (w, b) => new FishhookAbility(w, b),
  drawPortrait: drawFishhookPortrait,
}
