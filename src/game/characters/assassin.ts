import { closestPointOnSegment } from '../core/geometry'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS, BASE_SPEED } from '../engine/constants'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

/** Base spin rate of the sword (degrees per second, clockwise on screen). */
export const SPIN_DEG_PER_SEC = 700
const SPIN_SPEED = (SPIN_DEG_PER_SEC * Math.PI) / 180
/** Growth multiplier per second of fight time, applied to spin and movement speed. */
export const GROWTH_RATE = 0.029
export const MAX_GROWTH = 2.5
export const SWORD_DAMAGE = 5
/** Minimum gap between two hits on the same target (s). */
export const SWORD_COOLDOWN = 0.25

/** Radial layout of the sword, as multiples of the ball radius. */
const GRIP_START = 0.9
const GUARD_AT = 1.4
const TIP_AT = 3.6
/** The hit segment starts at the rim, so the hidden part of the grip never cuts. */
const HIT_START = 1.0
const HIT_SLACK = BALL_RADIUS * 0.2
/** Trailing crescent: arc length (rad) and mean radius (× R). */
const TRAIL_ARC = (120 * Math.PI) / 180
const TRAIL_RADIUS = 3.0

/**
 * 刺客 ASSASSIN — a sword pointing straight out of the ball spins clockwise
 * nonstop, slicing anything it sweeps through. Both the spin and the ball's
 * own movement speed keep accelerating as the fight drags on. Disarming or
 * rooting the assassin stops the blade.
 */
export class AssassinAbility extends Ability {
  private angle: number
  private cooldown = 0
  /** Current growth multiplier (1 → MAX_GROWTH). */
  private growth = 1

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.angle = world.rng.range(0, Math.PI * 2)
  }

  private get spinning(): boolean {
    return this.world.combatActive && !this.owner.disarmed && !this.owner.rooted
  }

  override prePhysics(): void {
    if (!this.world.combatActive) return
    this.growth = Math.min(MAX_GROWTH, 1 + GROWTH_RATE * this.world.fightTime)
    this.owner.baseSpeed = BASE_SPEED * this.growth
  }

  override update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (!this.spinning) return
    this.angle = (this.angle + SPIN_SPEED * this.growth * dt) % (Math.PI * 2)
    if (this.cooldown > 0) return
    const e = this.enemy
    if (!e.alive) return
    const o = this.owner.pos
    const R = this.owner.radius
    const dx = Math.cos(this.angle)
    const dy = Math.sin(this.angle)
    const a = { x: o.x + dx * HIT_START * R, y: o.y + dy * HIT_START * R }
    const b = { x: o.x + dx * TIP_AT * R, y: o.y + dy * TIP_AT * R }
    const at = closestPointOnSegment(e.pos, a, b)
    const reach = e.radius + HIT_SLACK
    if ((at.x - e.pos.x) ** 2 + (at.y - e.pos.y) ** 2 > reach * reach) return
    this.cooldown = SWORD_COOLDOWN
    this.world.damage(e, SWORD_DAMAGE, { kind: 'sword', source: this.owner, at })
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    ctx.save()
    if (this.spinning) drawSwordTrail(ctx, o.pos.x, o.pos.y, this.angle, o.radius, Math.min(1, 0.55 + 0.3 * (this.growth - 1)))
    drawSword(ctx, o.pos.x, o.pos.y, this.angle, o.radius)
    ctx.restore()
  }
}

/** Thin dark crescent trailing the tip, thickest right behind the blade. */
function drawSwordTrail(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number, strength: number): void {
  const steps = 18
  const outer = r * (TRAIL_RADIUS + 0.35)
  const maxThick = r * 0.6
  ctx.save()
  ctx.fillStyle = `rgba(55,58,66,${0.38 * strength})`
  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const a = angle - TRAIL_ARC + (i / steps) * TRAIL_ARC
    const px = cx + Math.cos(a) * outer
    const py = cy + Math.sin(a) * outer
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  for (let i = steps; i >= 0; i--) {
    const u = i / steps
    const a = angle - TRAIL_ARC + u * TRAIL_ARC
    // Crescent profile: zero at the tail, widest just behind the blade.
    const inner = outer - maxThick * Math.sin(u * Math.PI * 0.5) ** 2
    ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Sword pointing radially outward at `angle` from a ball of radius `r` centred at (cx, cy). */
export function drawSword(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, r: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const guard = GUARD_AT * r
  const tip = TIP_AT * r
  // Grip with wrap lines and a pommel.
  const gripHalf = r * 0.12
  ctx.fillStyle = '#6b3e1f'
  ctx.fillRect(GRIP_START * r, -gripHalf, guard - GRIP_START * r, gripHalf * 2)
  ctx.strokeStyle = '#3f2210'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = GRIP_START * r + 3; x < guard - 1; x += r * 0.12) {
    ctx.moveTo(x, -gripHalf)
    ctx.lineTo(x + r * 0.06, gripHalf)
  }
  ctx.stroke()
  // Blade: two-tone steel blue tapering to the point.
  const baseHalf = r * 0.225
  const bladeStart = guard + r * 0.06
  const steel = ctx.createLinearGradient(0, -baseHalf, 0, baseHalf)
  steel.addColorStop(0, '#6fb7f0')
  steel.addColorStop(1, '#2f7fd0')
  ctx.fillStyle = steel
  ctx.beginPath()
  ctx.moveTo(bladeStart, -baseHalf)
  ctx.lineTo(tip - r * 0.55, -baseHalf * 0.7)
  ctx.lineTo(tip, 0)
  ctx.lineTo(tip - r * 0.55, baseHalf * 0.7)
  ctx.lineTo(bladeStart, baseHalf)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#1d4f8c'
  ctx.lineWidth = 1.2
  ctx.stroke()
  // Pale cyan highlight along the upper edge of the fuller.
  ctx.strokeStyle = '#d9f6ff'
  ctx.lineWidth = Math.max(1, r * 0.06)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(bladeStart + r * 0.12, -baseHalf * 0.35)
  ctx.lineTo(tip - r * 0.45, -baseHalf * 0.15)
  ctx.stroke()
  // Gold crossguard.
  const guardHalfW = r * 0.45
  const guardDepth = r * 0.16
  ctx.fillStyle = '#e5a93a'
  ctx.beginPath()
  ctx.moveTo(guard - guardDepth / 2, -guardHalfW)
  ctx.lineTo(guard + guardDepth / 2, -guardHalfW * 0.9)
  ctx.lineTo(guard + guardDepth / 2, guardHalfW * 0.9)
  ctx.lineTo(guard - guardDepth / 2, guardHalfW)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#9a6a16'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

export function drawAssassinPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // Small enough that the blade and the trailing crescent stay within ±2.5r.
  const br = r * 0.66
  const x = cx - r * 0.3
  const y = cy + r * 0.55
  const angle = -Math.PI / 4
  ctx.save()
  drawSwordTrail(ctx, x, y, angle, br, 1)
  drawSword(ctx, x, y, angle, br)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export const assassinDef: CharacterDef = {
  id: 'assassin',
  name: '刺客',
  nameEn: 'ASSASSIN',
  tagline: '越转越快的剑',
  rules: [
    '一把长剑从中心向外伸出，顺时针不停旋转',
    `剑刃扫中敌人 -${SWORD_DAMAGE}，同一目标每 ${SWORD_COOLDOWN} 秒最多一次`,
    `转速（初始 ${SPIN_DEG_PER_SEC}°/秒）和移动速度随时间不断增长，最高 ${MAX_GROWTH} 倍`,
    '被缴械或定身时长剑停转，无法伤人',
  ],
  palette: { ball: '#ec362c', text: '#ffffff', accent: '#e03833' },
  mirrorPalette: { ball: '#7f1d1d', text: '#fee2e2', accent: '#f87171' },
  create: (w, b) => new AssassinAbility(w, b),
  drawPortrait: drawAssassinPortrait,
}
