import { closestPointOnSegment } from '../core/geometry'
import { type Vec, clamp, distSq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { Wall, WallBounce } from '../engine/types'
import type { CharacterDef } from './types'

// ───────────────────────────── V1: tracking beam ─────────────────────────────

/** Beam reaches enemies within this centre distance. */
export const V1_RANGE = BALL_RADIUS * 8.5
export const V1_DAMAGE = 1
export const V1_TICK = 0.2

/**
 * 激光 V1 — whenever the enemy is within range, a beam locks onto it and
 * burns steadily.
 */
export class LaserV1Ability extends Ability {
  private tick = V1_TICK
  private firing = false

  override update(dt: number): void {
    const e = this.enemy
    const o = this.owner
    this.firing = e.alive && this.world.combatActive && !o.disarmed && distSq(e.pos, o.pos) < V1_RANGE * V1_RANGE
    if (!this.firing) {
      this.tick = Math.min(this.tick, V1_TICK)
      return
    }
    this.tick -= dt
    if (this.tick > 0) return
    this.tick += V1_TICK
    const d = Math.hypot(e.pos.x - o.pos.x, e.pos.y - o.pos.y) || 1
    const at = { x: e.pos.x - ((e.pos.x - o.pos.x) / d) * e.radius, y: e.pos.y - ((e.pos.y - o.pos.y) / d) * e.radius }
    this.world.damage(e, V1_DAMAGE, { kind: 'laser', source: o, at })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    if (!this.firing || this.presence <= 0) return
    const o = this.owner
    const e = this.enemy
    const d = Math.hypot(e.pos.x - o.pos.x, e.pos.y - o.pos.y) || 1
    const ux = (e.pos.x - o.pos.x) / d
    const uy = (e.pos.y - o.pos.y) / d
    const a = { x: o.pos.x + ux * o.radius, y: o.pos.y + uy * o.radius }
    const b = { x: e.pos.x - ux * e.radius, y: e.pos.y - uy * e.radius }
    drawBeam(ctx, a, b, '#ff8925', '#ffd29a', 5 + Math.sin(this.world.time * 40) * 1)
  }
}

// ───────────────────────────── V2: path web ─────────────────────────────

export const V2_DAMAGE = 2
const V2_COOLDOWN = 1.0
export const V2_MAX_LINES = 8
const LINE_HALF_WIDTH = 4

interface PathLine {
  a: Vec
  b: Vec
  lastHit: number
  born: number
}

/**
 * 激光 V2 — its flight path between two wall bounces is frozen into a
 * permanent laser line. The web grows with every bounce; enemies crossing
 * a line get burned.
 */
export class LaserV2Ability extends Ability {
  private lines: PathLine[] = []
  private anchor: Vec | null = null

  override onWallBounce(e: WallBounce): void {
    const p = { x: e.point.x, y: e.point.y }
    if (this.anchor && !this.owner.disarmed) {
      this.lines.push({ a: this.anchor, b: p, lastHit: -Infinity, born: this.world.time })
      if (this.lines.length > V2_MAX_LINES) this.lines.shift()
      this.world.sound('laser', 0.3, 1.3)
    }
    this.anchor = p
  }

  override update(): void {
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    const now = this.world.time
    const reach = e.radius + LINE_HALF_WIDTH
    for (const l of this.lines) {
      if (now - l.lastHit < V2_COOLDOWN) continue
      const p = closestPointOnSegment(e.pos, l.a, l.b)
      if (distSq(p, e.pos) >= reach * reach) continue
      l.lastHit = now
      this.world.damage(e, V2_DAMAGE, { kind: 'laser', source: this.owner, at: p })
    }
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const now = this.world.time
    ctx.save()
    ctx.globalAlpha = fade
    for (const l of this.lines) {
      const flash = Math.max(0, 1 - (now - l.lastHit) / 0.25)
      const grow = clamp((now - l.born) / 0.15, 0, 1)
      drawBeam(ctx, l.a, l.b, '#913ff5', flash > 0 ? '#ffffff' : '#e5aef4', 3.2 + flash * 2, grow)
      for (const p of [l.a, l.b]) {
        ctx.strokeStyle = '#e5aef4'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    // The segment currently being traced, thin and unarmed.
    if (this.anchor) {
      ctx.globalAlpha = fade * 0.45
      ctx.strokeStyle = '#c4a1f5'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(this.anchor.x, this.anchor.y)
      ctx.lineTo(this.owner.pos.x, this.owner.pos.y)
      ctx.stroke()
    }
    ctx.restore()
  }
}

// ───────────────────────────── V3: wall turrets ─────────────────────────────

export const V3_DAMAGE = 1
export const V3_PERIOD = 0.75
const V3_FLASH = 0.12
const V3_TELEGRAPH = 0.25
export const V3_MAX_TURRETS = 24
const V3_BEAM_HALF_WIDTH = 5

interface Turret {
  wall: Wall
  /** Position along the wall (x for top/bottom, y for left/right). */
  at: number
  /** Seconds until the next shot. */
  timer: number
  /** Seconds remaining on the current flash. */
  flash: number
}

/**
 * 激光 V3 — every wall bounce bolts a turret to that wall. Each turret
 * fires a beam straight across the arena once a second.
 */
export class LaserV3Ability extends Ability {
  private turrets: Turret[] = []

  override onWallBounce(e: WallBounce): void {
    if (this.owner.disarmed) return
    const vertical = e.wall === 'top' || e.wall === 'bottom'
    this.turrets.push({ wall: e.wall, at: vertical ? e.point.x : e.point.y, timer: V3_PERIOD, flash: 0 })
    if (this.turrets.length > V3_MAX_TURRETS) this.turrets.shift()
    this.world.sound('place', 0.35, 1.5)
  }

  override update(dt: number): void {
    const active = this.world.combatActive
    for (const t of this.turrets) {
      t.flash = Math.max(0, t.flash - dt)
      if (!active) continue
      t.timer -= dt
      if (t.timer > 0) continue
      t.timer += V3_PERIOD
      t.flash = V3_FLASH
      this.fire(t)
    }
  }

  private fire(t: Turret): void {
    const e = this.enemy
    if (!e.alive) return
    const vertical = t.wall === 'top' || t.wall === 'bottom'
    const off = vertical ? Math.abs(e.pos.x - t.at) : Math.abs(e.pos.y - t.at)
    if (off >= e.radius + V3_BEAM_HALF_WIDTH) return
    const at = vertical ? { x: t.at, y: e.pos.y } : { x: e.pos.x, y: t.at }
    this.world.damage(e, V3_DAMAGE, { kind: 'laser', source: this.owner, at })
  }

  private beamEnds(t: Turret): [Vec, Vec] {
    const s = this.world.size
    const vertical = t.wall === 'top' || t.wall === 'bottom'
    return vertical ? [{ x: t.at, y: 0 }, { x: t.at, y: s }] : [{ x: 0, y: t.at }, { x: s, y: t.at }]
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const s = this.world.size
    ctx.save()
    ctx.globalAlpha = fade
    for (const t of this.turrets) {
      const [a, b] = this.beamEnds(t)
      if (t.flash > 0) {
        drawBeam(ctx, a, b, '#e11d48', '#ffe4e6', 4 * (t.flash / V3_FLASH) + 1.5)
      } else if (t.timer < V3_TELEGRAPH && this.world.combatActive) {
        ctx.strokeStyle = `rgba(190,18,60,${0.5 * (1 - t.timer / V3_TELEGRAPH)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      drawTurret(ctx, t.wall, t.at, s)
    }
    ctx.restore()
  }
}

function drawTurret(ctx: CanvasRenderingContext2D, wall: Wall, at: number, size: number): void {
  const pos = wall === 'top' ? { x: at, y: 0 } : wall === 'bottom' ? { x: at, y: size } : wall === 'left' ? { x: 0, y: at } : { x: size, y: at }
  const angle = wall === 'top' ? Math.PI / 2 : wall === 'bottom' ? -Math.PI / 2 : wall === 'left' ? 0 : Math.PI
  ctx.save()
  ctx.translate(pos.x, pos.y)
  ctx.rotate(angle)
  ctx.fillStyle = '#9f8a92'
  ctx.fillRect(0, -7, 6, 14)
  ctx.fillStyle = '#6b5a60'
  ctx.fillRect(6, -3, 7, 6)
  ctx.fillStyle = '#ef4444'
  ctx.beginPath()
  ctx.arc(3, 0, 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// ───────────────────────────── shared drawing ─────────────────────────────

/** A glowing beam from a to b; `grow` animates it extending from a. */
export function drawBeam(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, glow: string, core: string, width: number, grow = 1): void {
  const bx = a.x + (b.x - a.x) * grow
  const by = a.y + (b.y - a.y) * grow
  ctx.save()
  ctx.lineCap = 'round'
  ctx.shadowColor = glow
  ctx.shadowBlur = 10
  ctx.strokeStyle = glow
  ctx.globalAlpha *= 0.55
  ctx.lineWidth = width * 2
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(bx, by)
  ctx.stroke()
  ctx.globalAlpha /= 0.55
  ctx.shadowBlur = 0
  ctx.strokeStyle = core
  ctx.lineWidth = Math.max(1, width * 0.6)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(bx, by)
  ctx.stroke()
  ctx.restore()
}

function ball(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

export function drawLaserV1Portrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const target = { x: cx + r * 1.9, y: cy - r * 1.2 }
  drawBeam(ctx, { x: cx, y: cy + r * 0.5 }, target, '#ff8925', '#ffd29a', 4)
  ball(ctx, target.x, target.y, r * 0.45, '#3f3f46')
  ball(ctx, cx - r * 0.3, cy + r * 0.5, r * 0.9, color)
}

export function drawLaserV2Portrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const pts: Vec[] = [
    { x: cx - r * 2.4, y: cy - r * 0.6 },
    { x: cx - r * 0.2, y: cy - r * 2.4 },
    { x: cx + r * 2.4, y: cy - r * 0.2 },
    { x: cx + r * 0.3, y: cy + r * 2.4 },
    { x: cx - r * 2.4, y: cy + r * 1.2 },
  ]
  for (let i = 0; i < pts.length - 1; i++) drawBeam(ctx, pts[i], pts[i + 1], '#913ff5', '#e5aef4', 2.5)
  ball(ctx, cx, cy, r * 0.85, color)
}

export function drawLaserV3Portrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawBeam(ctx, { x: cx - r * 1.4, y: cy - r * 2.6 }, { x: cx - r * 1.4, y: cy + r * 2.6 }, '#e11d48', '#ffe4e6', 3)
  drawBeam(ctx, { x: cx - r * 2.6, y: cy + r * 1.3 }, { x: cx + r * 2.6, y: cy + r * 1.3 }, '#e11d48', '#ffe4e6', 3)
  ball(ctx, cx + r * 0.6, cy - r * 0.4, r * 0.9, color)
}

export const laserV1Def: CharacterDef = {
  id: 'laserV1',
  name: '激光 V1',
  nameEn: 'LASER V1',
  tagline: '靠近就烧',
  rules: [
    '敌人进入射程时自动锁定，持续发射光束',
    `光束每 ${V1_TICK} 秒 -${V1_DAMAGE}`,
    `射程约 ${(V1_RANGE / BALL_RADIUS).toFixed(0)} 个球半径，离开射程光束就断`,
    '没有冷却，也不会随时间变强',
  ],
  palette: { ball: '#ff8925', text: '#ffffff', accent: '#fa8228' },
  mirrorPalette: { ball: '#c2410c', text: '#ffedd5', accent: '#f97316' },
  create: (w, b) => new LaserV1Ability(w, b),
  drawPortrait: drawLaserV1Portrait,
}

export const laserV2Def: CharacterDef = {
  id: 'laserV2',
  name: '激光 V2',
  nameEn: 'LASER V2',
  tagline: '走过的路都会发光',
  rules: [
    '两次撞墙之间飞过的路线，会凝固成一条永久的激光线',
    `敌人碰到一条激光线 -${V2_DAMAGE}（同一条线 1 秒内只算一次）`,
    `激光线越积越多，最多 ${V2_MAX_LINES} 条，旧线会消失`,
    '自己的激光线伤不到自己',
  ],
  palette: { ball: '#913ff5', text: '#ffffff', accent: '#9d55f5' },
  mirrorPalette: { ball: '#4c1d95', text: '#ede9fe', accent: '#8b5cf6' },
  create: (w, b) => new LaserV2Ability(w, b),
  drawPortrait: drawLaserV2Portrait,
}

export const laserV3Def: CharacterDef = {
  id: 'laserV3',
  name: '激光 V3',
  nameEn: 'LASER V3',
  tagline: '墙上全是炮台',
  rules: [
    '每次撞墙在撞击点装一座激光炮台',
    `每座炮台每 ${V3_PERIOD} 秒朝对面墙射一道贯穿全场的光束`,
    `被光束扫到 -${V3_DAMAGE}，开火前有淡红色预警线`,
    `炮台会一直保留（最多 ${V3_MAX_TURRETS} 座）`,
  ],
  palette: { ball: '#62202a', text: '#ffffff', accent: '#b8394a' },
  mirrorPalette: { ball: '#881337', text: '#ffe4e6', accent: '#fb7185' },
  create: (w, b) => new LaserV3Ability(w, b),
  drawPortrait: drawLaserV3Portrait,
}
