import { angleDiff, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import { drawChain, roundRectPath } from '../render/draw'
import type { CharacterDef } from './types'

/** Max rig turn rate (rad/s). */
const TURN_RATE = 12
/** The rig opens fire when the enemy centre is this close. */
const FIRE_RANGE = BALL_RADIUS * 10
/** Only fires while the rig points within this angle of the enemy. */
const FIRE_ALIGN = (20 * Math.PI) / 180
/** Flame cone, measured from the ball centre. */
const CONE_LENGTH = BALL_RADIUS * 8.5
const CONE_HALF_ANGLE = (12 * Math.PI) / 180
/** Inside this centre distance the flame hits at the fast rate. */
const CLOSE_RANGE = BALL_RADIUS * 6.5
export const FIRE_DAMAGE = 1
export const FLAME_CLOSE_TICK = 0.25
export const FLAME_FAR_TICK = 0.55
export const BURN_DAMAGE = 1
export const BURN_TICK = 0.5
/** Burn keeps ticking this long after the last flame hit (s). */
export const BURN_DURATION = 2.5

/** Rig layout in ball radii along the aim axis (+x ahead, y sideways). */
const TANK_CENTER = -1.7
const TANK_HALF_LEN = 1.3
const TANK_HALF_W = 0.45
const BLOCK_START = 0.72
const BLOCK_END = 1.3
const NOZZLE_OFFSET = 0.5
const NOZZLE_TIP = 2.6
const NOZZLE_HALF_W = 0.13

const FLAME_SPEED = 520
const FLAME_SPREAD = 0.2
/** Low drag so the fireballs carry roughly to the end of the cone. */
const FLAME_DRAG = 1.1
const FLAME_COLORS = ['#ffd54a', '#ffb02e', '#ff8a1a', '#ff6a00'] as const
const ROAR_INTERVAL = 0.4
const SMALL = 1e-6

/**
 * 纵火犯 (FLAMETHROWER) — carries a fuel tank and twin nozzles that always
 * swing towards the enemy. Within range it sprays a cone of fire: rapid hits
 * up close, slower ones at the tip. Anything that was hit keeps burning for
 * a while after it escapes the flame.
 */
export class FlamethrowerAbility extends Ability {
  private angle: number
  private firing = false
  /** 0..1 visual intensity of the flame glow. */
  private flameGlow = 0
  private fireCd = 0
  private burnCd = BURN_TICK
  /** World time of the last successful flame hit. */
  private lastHit = -Infinity
  private roarCd = 0

  constructor(world: World, owner: Ball) {
    super(world, owner)
    // Face the opponent from the start so the rig looks right during the countdown.
    const e = this.enemy
    this.angle = Math.atan2(e.pos.y - owner.pos.y, e.pos.x - owner.pos.x)
  }

  private get burning(): boolean {
    return this.world.time - this.lastHit <= BURN_DURATION + SMALL
  }

  override update(dt: number): void {
    const o = this.owner
    const e = this.enemy
    const now = this.world.time
    const dx = e.pos.x - o.pos.x
    const dy = e.pos.y - o.pos.y
    const d = Math.hypot(dx, dy)
    const toEnemy = Math.atan2(dy, dx)

    if (e.alive) {
      const step = TURN_RATE * dt
      this.angle += clamp(angleDiff(this.angle, toEnemy), -step, step)
    }

    const off = Math.abs(angleDiff(this.angle, toEnemy))
    this.firing = e.alive && this.world.combatActive && !o.disarmed && d <= FIRE_RANGE && off <= FIRE_ALIGN
    this.flameGlow = clamp(this.flameGlow + (this.firing ? 8 : -6) * dt, 0, 1)

    this.fireCd -= dt
    let beingHit = false
    if (this.firing) {
      this.emitFlame()
      this.roar(dt)
      const reach = CONE_LENGTH + e.radius
      const widen = d > SMALL ? Math.asin(Math.min(1, e.radius / d)) : Math.PI
      beingHit = d <= reach && off <= CONE_HALF_ANGLE + widen
    } else {
      this.roarCd = 0
    }

    if (beingHit && this.fireCd <= SMALL) {
      // Keep the sub-step remainder while the stream is continuous.
      const interval = d <= CLOSE_RANGE ? FLAME_CLOSE_TICK : FLAME_FAR_TICK
      this.fireCd = (this.fireCd > -dt ? this.fireCd : 0) + interval
      const at = d > SMALL ? { x: e.pos.x - (dx / d) * e.radius, y: e.pos.y - (dy / d) * e.radius } : e.pos
      if (this.world.damage(e, FIRE_DAMAGE, { kind: 'fire', source: o, at }) > 0) this.lastHit = now
    }

    // Afterburn: ticks only while the enemy is out of the flame.
    if (beingHit || !this.burning || !e.alive) {
      this.burnCd = BURN_TICK
    } else {
      this.burnCd -= dt
      if (this.burnCd <= SMALL) {
        this.burnCd += BURN_TICK
        this.world.damage(e, BURN_DAMAGE, { kind: 'burn', source: o, at: e.pos })
      }
    }
  }

  private emitFlame(): void {
    const o = this.owner
    const r = o.radius
    const c = Math.cos(this.angle)
    const s = Math.sin(this.angle)
    for (const side of [-1, 1]) {
      const lx = NOZZLE_TIP * r
      const ly = side * NOZZLE_OFFSET * r
      this.world.effects.burst(
        { x: o.pos.x + c * lx - s * ly, y: o.pos.y + s * lx + c * ly },
        {
          count: 1,
          color: FLAME_COLORS,
          speed: [FLAME_SPEED - 40, FLAME_SPEED + 40],
          size: [3, 6],
          life: [0.42, 0.55],
          direction: this.angle,
          spread: FLAME_SPREAD,
          drag: FLAME_DRAG,
          endScale: 1.8,
          front: true,
        },
      )
    }
  }

  private roar(dt: number): void {
    this.roarCd -= dt
    if (this.roarCd > 0) return
    this.roarCd += ROAR_INTERVAL
    this.world.sound('whoosh', 0.22, 0.55 + this.world.effects.random() * 0.15)
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawRigBack(ctx, o.pos.x, o.pos.y, this.angle, o.radius)
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawRigFront(ctx, o.pos.x, o.pos.y, this.angle, o.radius)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const o = this.owner
    const now = this.world.time
    ctx.save()
    if (this.flameGlow > 0 && o.alive) drawFlameGlow(ctx, o.pos.x, o.pos.y, this.angle, o.radius, this.flameGlow * fade, now)

    // Embers dancing on a burning enemy.
    const e = this.enemy
    if (e.alive && this.burning) {
      const left = 1 - (now - this.lastHit) / BURN_DURATION
      const tick = Math.floor(now * 14)
      const er = e.radius * e.drawScale
      for (let i = 0; i < 7; i++) {
        const h = hash(tick * 0.37 + i * 7.13)
        const h2 = hash(tick * 0.91 + i * 3.71)
        const a = h * Math.PI * 2
        const rr = er * (0.25 + 0.7 * h2)
        const rise = ((now * 1.6 + i * 0.29) % 1) * er * 0.35
        ctx.globalAlpha = fade * (0.55 + 0.45 * left) * (0.5 + 0.5 * h2)
        ctx.fillStyle = i % 3 === 0 ? '#ffd54a' : '#ff7b1a'
        ctx.beginPath()
        ctx.arc(e.pos.x + Math.cos(a) * rr, e.pos.y + Math.sin(a) * rr - rise, 1.3 + h * 1.4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }
}

function hash(x: number): number {
  const h = Math.sin(x * 12.9898) * 43758.5453
  return h - Math.floor(h)
}

/** Fuel tank and chains, drawn beneath the ball. */
function drawRigBack(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const tx = TANK_CENTER * r
  const hw = TANK_HALF_W * r
  const hl = TANK_HALF_LEN * r
  // Chains from the tank's front face to the ball rim.
  for (const side of [-1, 1]) {
    const from = { x: tx + hw * 0.9, y: side * hl * 0.5 }
    const rimA = Math.PI - side * 0.62
    drawChain(ctx, from, { x: Math.cos(rimA) * r * 0.92, y: Math.sin(rimA) * r * 0.92 }, 1.5)
  }
  // Tank body (long axis across the aim direction).
  ctx.fillStyle = '#e8431a'
  ctx.strokeStyle = '#741900'
  ctx.lineWidth = 2.2
  roundRectPath(ctx, tx - hw, -hl, hw * 2, hl * 2, hw * 0.95)
  ctx.fill()
  ctx.stroke()
  // Highlight stripe.
  ctx.fillStyle = 'rgba(255,170,120,0.45)'
  roundRectPath(ctx, tx + hw * 0.15, -hl + hw * 0.5, hw * 0.35, hl * 2 - hw, hw * 0.17)
  ctx.fill()
  // Steel straps.
  ctx.fillStyle = '#c3c8d2'
  ctx.strokeStyle = '#5b606b'
  ctx.lineWidth = 1
  for (const sy of [-0.55, 0.55]) {
    ctx.beginPath()
    ctx.rect(tx - hw - 1, sy * hl - r * 0.09, hw * 2 + 2, r * 0.18)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

/** Valve block and twin nozzles, drawn over the ball (the HP text stays on top). */
function drawRigFront(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const nw = NOZZLE_HALF_W * r
  // Nozzles.
  for (const side of [-1, 1]) {
    const y = side * NOZZLE_OFFSET * r
    const x0 = BLOCK_END * r - 2
    const x1 = NOZZLE_TIP * r
    ctx.fillStyle = '#b9bfca'
    ctx.strokeStyle = '#4b5059'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.rect(x0, y - nw, x1 - x0, nw * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.fillRect(x0, y - nw * 0.7, x1 - x0, nw * 0.45)
    // Yellow bands.
    ctx.fillStyle = '#f7c96d'
    for (const u of [0.35, 0.86]) {
      const bx = x0 + (x1 - x0) * u
      ctx.fillRect(bx - r * 0.06, y - nw - 1, r * 0.12, nw * 2 + 2)
    }
    // Muzzle ring.
    ctx.fillStyle = '#2b2e34'
    ctx.fillRect(x1 - r * 0.05, y - nw - 0.5, r * 0.08, nw * 2 + 1)
  }
  // Valve block.
  const bh = (NOZZLE_OFFSET + 0.3) * r
  ctx.fillStyle = '#a8adbb'
  ctx.strokeStyle = '#3f434c'
  ctx.lineWidth = 1.5
  roundRectPath(ctx, BLOCK_START * r, -bh, (BLOCK_END - BLOCK_START) * r, bh * 2, 3)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#7d8290'
  ctx.fillRect(BLOCK_START * r + 3, -bh * 0.2, (BLOCK_END - BLOCK_START) * r - 6, bh * 0.4)
  ctx.restore()
}

/** Soft red-orange glow where the two streams merge, plus muzzle flares. */
function drawFlameGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number, k: number, time: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.globalCompositeOperation = 'lighter'
  const flicker = 0.85 + 0.15 * Math.sin(time * 37)
  const blobs: [number, number, number][] = [
    [3.6, 0.9, 0.22],
    [5.0, 1.25, 0.2],
    [6.5, 1.5, 0.16],
    [7.8, 1.6, 0.1],
  ]
  for (const [x, rad, a] of blobs) {
    const gx = x * r
    const gr = rad * r * flicker
    const g = ctx.createRadialGradient(gx, 0, 0, gx, 0, gr)
    g.addColorStop(0, `rgba(255,120,30,${a * k})`)
    g.addColorStop(1, 'rgba(255,60,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(gx, 0, gr, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const side of [-1, 1]) {
    const x = NOZZLE_TIP * r + 3
    const y = side * NOZZLE_OFFSET * r
    const gr = r * 0.32 * flicker
    const g = ctx.createRadialGradient(x, y, 0, x, y, gr)
    g.addColorStop(0, `rgba(255,236,150,${0.9 * k})`)
    g.addColorStop(0.5, `rgba(255,150,40,${0.5 * k})`)
    g.addColorStop(1, 'rgba(255,80,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, gr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawFlamethrowerPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const s = r * 0.8
  const x = cx - r * 0.35
  const y = cy + r * 0.3
  const a = -0.45
  drawRigBack(ctx, x, y, a, s)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, s, 0, Math.PI * 2)
  ctx.fill()
  drawRigFront(ctx, x, y, a, s)
  // A short burst of fireballs leaving the nozzles.
  const c = Math.cos(a)
  const sn = Math.sin(a)
  const balls: [number, number, number, string][] = [
    [2.9, -0.45, 0.13, '#ffd54a'],
    [2.95, 0.45, 0.13, '#ffd54a'],
    [3.3, -0.3, 0.17, '#ffb02e'],
    [3.35, 0.3, 0.17, '#ffb02e'],
    [3.75, -0.05, 0.24, '#ff8a1a'],
    [3.7, 0.25, 0.2, '#ff6a00'],
  ]
  for (const [lx, ly, rad, col] of balls) {
    const px = x + (c * lx - sn * ly) * s
    const py = y + (sn * lx + c * ly) * s
    if (Math.abs(px - cx) > r * 2.5 - rad * s || Math.abs(py - cy) > r * 2.5 - rad * s) continue
    ctx.fillStyle = 'rgba(255,90,20,0.35)'
    ctx.beginPath()
    ctx.arc(px, py, rad * s * 1.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.arc(px, py, rad * s, 0, Math.PI * 2)
    ctx.fill()
  }
}

export const flamethrowerDef: CharacterDef = {
  id: 'flamethrower',
  name: '纵火犯',
  nameEn: 'FLAMETHROWER',
  tagline: '离得越近烧得越旺',
  rules: [
    '双管喷火器始终对准敌人，进入射程就持续喷火',
    `贴近时每 ${FLAME_CLOSE_TICK} 秒 -${FIRE_DAMAGE}，火焰末端每 ${FLAME_FAR_TICK} 秒 -${FIRE_DAMAGE}`,
    `被烧到会着火：离开火焰后每 ${BURN_TICK} 秒 -${BURN_DAMAGE}，最多烧 ${BURN_DURATION} 秒`,
    '不减速也不击退，被缴械时停火',
  ],
  palette: { ball: '#ff7b1a', text: '#ffffff', accent: '#f77d30' },
  mirrorPalette: { ball: '#b91c1c', text: '#fee2e2', accent: '#ef4444' },
  create: (w, b) => new FlamethrowerAbility(w, b),
  drawPortrait: drawFlamethrowerPortrait,
}
