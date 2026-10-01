import { type Vec, angleDiff, clamp, damp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import { roundRectPath } from '../render/draw'
import type { CharacterDef } from './types'

const FIRST_BURST = 0.2
/** Length of one burst (s). */
export const BURST_TIME = 2.2
/** Reload pause between bursts (s). */
export const RELOAD_TIME = 4.3
/** Each gun fires this often during a burst (s). */
export const FIRE_INTERVAL = 0.13
export const BULLET_DAMAGE = 2
const BULLET_SPEED = 600
const SPREAD = (6 * Math.PI) / 180
/** Collision reach added to the enemy's radius. */
const BULLET_HIT_SLACK = 4
const BULLET_RADIUS = Math.max(3, BALL_RADIUS * 0.1)
/** Gun-pair turn smoothing rate (1/s). */
const AIM_RATE = 6
/** Gun centre lines sit this far to either side of the ball centre. */
const GUN_OFFSET = BALL_RADIUS * 1.5
/** Muzzles are this far ahead of the ball centre along the aim. */
const MUZZLE_AHEAD = BALL_RADIUS * 1.6
const MAGAZINES = 3
const MAG_RANGE = BALL_RADIUS * 2.5
/** Magazines vanish this long before the next burst (s). */
const MAG_VANISH = 0.3
const FLASH_TIME = 0.04

interface Bullet {
  pos: Vec
  vel: Vec
}

interface Magazine {
  pos: Vec
  angle: number
}

/**
 * 蒙犽（战甲） BLASTERS — a twin-gun battle suit. Both guns track the enemy
 * with a little lag and hose it with short bursts of small bullets, then go
 * quiet while the suit swaps magazines.
 */
export class BlastersAbility extends Ability {
  private aim: number
  private firing = false
  /** Time left in the current burst or reload. */
  private phaseTimer = FIRST_BURST
  private readonly gunTimers = [0, 0]
  /** Seconds since each gun last fired, for recoil and flashes. */
  private readonly sinceShot = [Infinity, Infinity]
  private bullets: Bullet[] = []
  private magazines: Magazine[] = []

  constructor(world: World, owner: Ball) {
    super(world, owner)
    const e = world.opponentOf(owner)
    this.aim = Math.atan2(e.pos.y - owner.pos.y, e.pos.x - owner.pos.x)
  }

  override update(dt: number): void {
    const o = this.owner
    const e = this.enemy
    if (e.alive) this.aim += angleDiff(this.aim, Math.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)) * damp(AIM_RATE, dt)
    this.sinceShot[0] += dt
    this.sinceShot[1] += dt
    if (this.world.combatActive && !o.disarmed) this.cycle(dt)
    this.updateBullets(dt)
  }

  /** Advances the burst / reload cycle; frozen while disarmed. */
  private cycle(dt: number): void {
    this.phaseTimer -= dt
    if (this.firing) {
      for (let i = 0; i < 2; i++) {
        this.gunTimers[i] -= dt
        while (this.gunTimers[i] <= 0) {
          this.gunTimers[i] += FIRE_INTERVAL
          this.shoot(i)
        }
      }
      if (this.phaseTimer <= 0) {
        this.firing = false
        this.phaseTimer += RELOAD_TIME
        this.dropMagazines()
      }
      return
    }
    if (this.phaseTimer <= MAG_VANISH) this.magazines = []
    if (this.phaseTimer <= 0) {
      this.firing = true
      this.phaseTimer += BURST_TIME
      // Alternate the two guns for an even rattle.
      this.gunTimers[0] = 0
      this.gunTimers[1] = FIRE_INTERVAL / 2
      this.world.sound('clack', 0.5, 0.7)
    }
  }

  private gunFrame(): { fx: number; fy: number; lx: number; ly: number } {
    const fx = Math.cos(this.aim)
    const fy = Math.sin(this.aim)
    return { fx, fy, lx: -fy, ly: fx }
  }

  private shoot(gun: number): void {
    const o = this.owner.pos
    const side = gun === 0 ? -1 : 1
    const { fx, fy, lx, ly } = this.gunFrame()
    const muzzle = {
      x: o.x + fx * MUZZLE_AHEAD + lx * GUN_OFFSET * side,
      y: o.y + fy * MUZZLE_AHEAD + ly * GUN_OFFSET * side,
    }
    const a = this.aim + this.world.rng.range(-SPREAD, SPREAD)
    this.bullets.push({ pos: muzzle, vel: { x: Math.cos(a) * BULLET_SPEED, y: Math.sin(a) * BULLET_SPEED } })
    this.sinceShot[gun] = 0
    this.world.effects.burst(muzzle, { count: 2, color: ['#fde68a', '#ffffff', '#fb923c'], shape: 'spark', direction: this.aim, spread: 0.5, speed: [100, 240], size: [1.2, 2.4], life: [0.06, 0.14] })
    if (gun === 0) this.world.sound('clack', 0.35, 1.6)
  }

  /** Spent magazines scattered around the suit while it reloads (purely visual). */
  private dropMagazines(): void {
    const fx = this.world.effects
    const o = this.owner.pos
    const s = this.world.size
    const m = BALL_RADIUS * 0.6
    this.magazines = []
    for (let i = 0; i < MAGAZINES; i++) {
      const a = (i / MAGAZINES) * Math.PI * 2 + fx.random() * 1.6
      const d = BALL_RADIUS * 1.35 + fx.random() * (MAG_RANGE - BALL_RADIUS * 1.35)
      this.magazines.push({
        pos: { x: clamp(o.x + Math.cos(a) * d, m, s - m), y: clamp(o.y + Math.sin(a) * d, m, s - m) },
        angle: fx.random() * Math.PI * 2,
      })
    }
    this.world.sound('place', 0.4, 0.7)
  }

  private updateBullets(dt: number): void {
    const s = this.world.size
    const e = this.enemy
    const reach = e.radius + BULLET_HIT_SLACK
    const kept: Bullet[] = []
    for (const b of this.bullets) {
      b.pos.x += b.vel.x * dt
      b.pos.y += b.vel.y * dt
      if (e.alive && this.world.combatActive && (b.pos.x - e.pos.x) ** 2 + (b.pos.y - e.pos.y) ** 2 < reach * reach) {
        this.world.damage(e, BULLET_DAMAGE, { kind: 'bullet', source: this.owner, at: b.pos })
        continue
      }
      if (b.pos.x < 0 || b.pos.x > s || b.pos.y < 0 || b.pos.y > s) continue
      kept.push(b)
    }
    this.bullets = kept
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.magazines.length === 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const m of this.magazines) drawMagazine(ctx, m.pos.x, m.pos.y, m.angle, BALL_RADIUS)
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawGunPair(ctx, o.pos.x, o.pos.y, this.aim, o.radius, this.kick(0), this.kick(1))
  }

  private kick(gun: number): number {
    const t = this.sinceShot[gun]
    return t < FIRE_INTERVAL ? 1 - t / FIRE_INTERVAL : 0
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const b of this.bullets) drawBullet(ctx, b.pos.x, b.pos.y, Math.atan2(b.vel.y, b.vel.x), BULLET_RADIUS)
    if (this.owner.alive) {
      const o = this.owner.pos
      const { fx, fy, lx, ly } = this.gunFrame()
      for (let i = 0; i < 2; i++) {
        if (this.sinceShot[i] >= FLASH_TIME) continue
        const side = i === 0 ? -1 : 1
        const x = o.x + fx * (MUZZLE_AHEAD + 4) + lx * GUN_OFFSET * side
        const y = o.y + fy * (MUZZLE_AHEAD + 4) + ly * GUN_OFFSET * side
        drawMuzzleFlash(ctx, x, y, this.aim, BALL_RADIUS * 0.45, 1 - this.sinceShot[i] / FLASH_TIME)
      }
    }
    ctx.restore()
  }
}

/** Both guns, parallel to `angle`, centred ±1.5r to the sides of (cx, cy). */
export function drawGunPair(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number, kickL = 0, kickR = 0): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  for (const side of [-1, 1]) {
    const kick = side < 0 ? kickL : kickR
    ctx.save()
    ctx.translate(-kick * r * 0.15, side * r * (GUN_OFFSET / BALL_RADIUS))
    drawGun(ctx, r, side)
    ctx.restore()
  }
  ctx.restore()
}

/**
 * One blaster in local space: +x along the aim, gun centre line at y = 0,
 * `out` (±1) is the side facing away from the ball. Spans x ∈ [-1.5r, 1.6r].
 */
function drawGun(ctx: CanvasRenderingContext2D, r: number, out: number): void {
  const lw = Math.max(1, r * 0.04)
  ctx.lineJoin = 'round'
  // Rear fin.
  ctx.fillStyle = '#e81a0f'
  ctx.strokeStyle = '#6b0d07'
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.moveTo(-r * 1.5, -r * 0.14)
  ctx.lineTo(-r * 1.22, -r * 0.34)
  ctx.lineTo(-r * 1.22, r * 0.34)
  ctx.lineTo(-r * 1.5, r * 0.14)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Grip, sticking out on the outer side.
  ctx.fillStyle = '#6e6d78'
  ctx.strokeStyle = '#3b3a42'
  const gy0 = out > 0 ? r * 0.4 : -r * 0.95
  roundRectPath(ctx, -r * 1.05, gy0, r * 0.32, r * 0.55, r * 0.08)
  ctx.fill()
  ctx.stroke()
  // Barrel cylinder.
  const half = r * 0.5
  const cyl = ctx.createLinearGradient(0, -half, 0, half)
  cyl.addColorStop(0, '#a0140b')
  cyl.addColorStop(0.22, '#ff746f')
  cyl.addColorStop(0.45, '#e81a0f')
  cyl.addColorStop(1, '#a0140b')
  ctx.fillStyle = cyl
  ctx.strokeStyle = '#5c0b05'
  roundRectPath(ctx, -r * 1.15, -half, r * 2.5, half * 2, r * 0.12)
  ctx.fill()
  ctx.stroke()
  // Receiver box over the barrel's rear.
  ctx.fillStyle = '#9e2729'
  ctx.strokeStyle = '#4a1012'
  roundRectPath(ctx, -r * 1.27, -r * 0.6, r * 0.95, r * 1.2, r * 0.12)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#5b5a63'
  ctx.fillRect(-r * 1.1, -r * 0.2, r * 0.6, r * 0.4)
  ctx.fillStyle = 'rgba(255,116,111,0.45)'
  ctx.fillRect(-r * 1.2, -r * 0.52, r * 0.8, r * 0.1)
  // Ribbed muzzle ring.
  const mh = r * 0.55
  const ring = ctx.createLinearGradient(0, -mh, 0, mh)
  ring.addColorStop(0, '#2c2a2d')
  ring.addColorStop(0.3, '#7a777c')
  ring.addColorStop(1, '#2c2a2d')
  ctx.fillStyle = ring
  ctx.strokeStyle = '#1c1b1d'
  roundRectPath(ctx, r * 1.32, -mh, r * 0.28, mh * 2, r * 0.06)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = 'rgba(28,27,29,0.8)'
  ctx.beginPath()
  for (const x of [1.4, 1.48]) {
    ctx.moveTo(r * x, -mh)
    ctx.lineTo(r * x, mh)
  }
  ctx.stroke()
  ctx.fillStyle = '#49464a'
  ctx.fillRect(r * 1.53, -mh * 0.85, r * 0.04, mh * 1.7)
}

/** A red magazine (≈0.8r × 1r) with a grey base plate. */
export function drawMagazine(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, r: number): void {
  const w = r * 0.8
  const h = r
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  roundRectPath(ctx, -w / 2 + 2, -h / 2 + 3, w, h, r * 0.08)
  ctx.fill()
  ctx.fillStyle = '#d4231a'
  ctx.strokeStyle = '#5c0b05'
  ctx.lineWidth = Math.max(1, r * 0.04)
  roundRectPath(ctx, -w / 2, -h / 2, w, h, r * 0.08)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#6e6d78'
  ctx.fillRect(-w / 2, h / 2 - h * 0.22, w, h * 0.22)
  ctx.fillStyle = 'rgba(255,116,111,0.6)'
  ctx.fillRect(-w / 2 + w * 0.14, -h / 2 + h * 0.1, w * 0.14, h * 0.55)
  // Top round peeking out.
  ctx.fillStyle = '#fbbf24'
  ctx.fillRect(-w * 0.15, -h / 2 - h * 0.08, w * 0.3, h * 0.1)
  ctx.restore()
}

/** Tiny red teardrop pointing along `angle`, with a short trail. */
export function drawBullet(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, r: number): void {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  ctx.save()
  ctx.strokeStyle = 'rgba(248,113,113,0.4)'
  ctx.lineWidth = r * 0.9
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - c * r * 2, y - s * r * 2)
  ctx.lineTo(x - c * r * 5, y - s * r * 5)
  ctx.stroke()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = '#ef2b1f'
  ctx.beginPath()
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(-r * 2.4, 0)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#fecaca'
  ctx.beginPath()
  ctx.arc(r * 0.2, -r * 0.2, r * 0.38, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawMuzzleFlash(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, alpha: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.globalAlpha *= alpha
  ctx.fillStyle = '#fde047'
  ctx.beginPath()
  ctx.moveTo(-size * 0.2, -size * 0.45)
  ctx.lineTo(size * 1.2, 0)
  ctx.lineTo(-size * 0.2, size * 0.45)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(0, 0, size * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawBlastersPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const br = r * 0.82
  const bx = cx - r * 0.35
  const by = cy + r * 0.4
  const a = -0.62
  drawMagazine(ctx, cx - r * 1.6, cy + r * 1.75, 0.5, r)
  drawMagazine(ctx, cx + r * 1.2, cy + r * 1.8, -0.3, r)
  const c = Math.cos(a)
  const s = Math.sin(a)
  for (const [ahead, lat] of [
    [2.3, -1.5],
    [2.75, 1.5],
    [2.95, -1.3],
  ] as const) {
    drawBullet(ctx, bx + (c * ahead - s * lat) * br, by + (s * ahead + c * lat) * br, a, Math.max(3, r * 0.1))
  }
  drawGunPair(ctx, bx, by, a, br)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fill()
}

export const blastersDef: CharacterDef = {
  id: 'blasters',
  name: '蒙犽',
  nameEn: 'BLASTERS',
  tagline: '双枪齐射，火力压制',
  rules: [
    '两侧各挂一把枪，枪口带一点延迟跟着敌人转',
    `每轮连射 ${BURST_TIME} 秒，每把枪每 ${FIRE_INTERVAL} 秒打一发`,
    `每颗子弹命中 -${BULLET_DAMAGE}，撞墙即消失`,
    `打完一轮要换弹 ${RELOAD_TIME} 秒，期间不能开火`,
  ],
  palette: { ball: '#e8352c', text: '#ffffff', accent: '#f0524a' },
  mirrorPalette: { ball: '#c2410c', text: '#ffedd5', accent: '#fb923c' },
  create: (w, b) => new BlastersAbility(w, b),
  drawPortrait: drawBlastersPortrait,
}
