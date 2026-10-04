import * as dm from '../core/dmath'
import { closestPointOnSegment } from '../core/geometry'
import { type Vec, clamp, distSq } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import { PIXEL_FONT, roundRectPath } from '../render/draw'
import type { CharacterDef } from './types'

const FIRST_BURST = 1.2
/** Time between bar bursts (s). */
export const BURST_INTERVAL = 4.0
/** The ball glows this long before every burst / floor (s). */
const TELEGRAPH_TIME = 0.5
export const BAR_COUNT = 5
const BAR_SPEED = 600
const BAR_LENGTH = BALL_RADIUS * 2.4
const BAR_THICKNESS = BALL_RADIUS * 0.35
/** Bar reach added to the enemy's radius. */
const BAR_REACH = BALL_RADIUS * 0.45
export const BAR_DAMAGE = 2
/** Damage-over-time applied by bars and floor cells. */
export const DOT_TICKS = 2
export const DOT_DAMAGE = 1
export const DOT_INTERVAL = 0.55

const FIRST_FLOOR = 4.0
/** Time between dance-floor events (s). */
export const FLOOR_INTERVAL = 10.5
export const FLOOR_GRID = 3
export const FLOOR_MIN = 1
export const FLOOR_MAX = 5
const FLOOR_FADE_IN = 0.25
const FLOOR_HOLD = 1.9
const FLOOR_FADE_OUT = 0.4
const FLOOR_LIFETIME = FLOOR_FADE_IN + FLOOR_HOLD + FLOOR_FADE_OUT
/** Cells start reacting this long after the fade-in begins (s). */
const FLOOR_ARM_DELAY = 0.2
/** Minimum gap between two triggers of the same cell (s). */
const CELL_COOLDOWN = 0.3
const CELL_FLASH = 0.3

/** Colour of each floor number, 1..7. */
const CELL_COLORS = ['#592583', '#0d2e86', '#006688', '#006423', '#857318', '#8f460f', '#921812'] as const
const RAINBOW = ['#ff3b3b', '#ff9a1f', '#ffe14a', '#3ee07a', '#22d3ee', '#3b82f6', '#a855f7'] as const
const HALO_COLOR = '200,240,255'
const MAX_NOTES = 40

interface Bar {
  /** Front end of the bar. */
  tip: Vec
  dir: Vec
  hit: boolean
  /** Phase offset into the rainbow cycle. */
  hue: number
}

interface Floor {
  age: number
  numbers: number[]
  /** Whether the enemy overlapped each cell on the previous step. */
  inside: boolean[]
  lastTrigger: number[]
  flashAt: number[]
}

/** Cosmetic music note thrown out by a burst. */
interface Note {
  pos: Vec
  vel: Vec
  life: number
  maxLife: number
  color: string
  tilt: number
  double: boolean
}

/**
 * 迪斯科 — Disco Ball: a spinning mirror ball. Every few seconds it flares up
 * and fires a ring of ten rainbow light bars that sting and leave a short
 * damage-over-time. Every 8.4 s the whole arena turns into a numbered 3×3
 * dance floor: each cell the enemy steps onto hits it for that cell's number.
 */
export class DiscoAbility extends Ability {
  private burstTimer = FIRST_BURST
  private floorTimer = FIRST_FLOOR
  private bars: Bar[] = []
  private floor: Floor | null = null
  private dotTicks = 0
  private dotTimer = 0
  private notes: Note[] = []

  private get cellSize(): number {
    return this.world.size / FLOOR_GRID
  }

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed) {
      this.burstTimer -= dt
      if (this.burstTimer <= 0) {
        this.burstTimer += BURST_INTERVAL
        this.burst()
      }
      this.floorTimer -= dt
      if (this.floorTimer <= 0) {
        this.floorTimer += FLOOR_INTERVAL
        this.startFloor()
        this.burst()
      }
    }
    this.updateBars(dt)
    this.updateFloor(dt)
    this.updateDot(dt)
    this.updateNotes(dt)
  }

  // ───────────────────────────── bars ─────────────────────────────

  private burst(): void {
    const o = this.owner
    const offset = this.world.rng.range(0, (Math.PI * 2) / BAR_COUNT)
    for (let k = 0; k < BAR_COUNT; k++) {
      const a = offset + (k * Math.PI * 2) / BAR_COUNT
      const dir = { x: dm.cos(a), y: dm.sin(a) }
      // Bars slide out from under the ball.
      this.bars.push({ tip: { x: o.pos.x + dir.x * o.radius, y: o.pos.y + dir.y * o.radius }, dir, hit: false, hue: k / BAR_COUNT })
    }
    this.world.sound('laser', 0.45, 1.4)
    this.confetti(o.pos)
  }

  private updateBars(dt: number): void {
    const s = this.world.size
    const e = this.enemy
    const live = e.alive && this.world.combatActive
    const reach = e.radius + BAR_REACH
    const kept: Bar[] = []
    for (const b of this.bars) {
      b.tip.x += b.dir.x * BAR_SPEED * dt
      b.tip.y += b.dir.y * BAR_SPEED * dt
      if (b.tip.x < 0 || b.tip.x > s || b.tip.y < 0 || b.tip.y > s) {
        const at = { x: clamp(b.tip.x, 0, s), y: clamp(b.tip.y, 0, s) }
        this.world.effects.burst(at, { count: 3, color: RAINBOW, shape: 'spark', speed: [40, 140], size: [1.5, 3], life: [0.12, 0.25] })
        continue
      }
      kept.push(b)
      if (b.hit || !live) continue
      const tail = { x: b.tip.x - b.dir.x * BAR_LENGTH, y: b.tip.y - b.dir.y * BAR_LENGTH }
      const p = closestPointOnSegment(e.pos, tail, b.tip)
      if (distSq(p, e.pos) >= reach * reach) continue
      b.hit = true
      const dealt = this.world.damage(e, BAR_DAMAGE, { kind: 'disco', source: this.owner, at: p })
      if (dealt > 0) this.applyDot()
    }
    this.bars = kept
  }

  // ───────────────────────────── damage over time ─────────────────────────────

  /** Starts (or refreshes) the disco DoT on the enemy; it never stacks. */
  private applyDot(): void {
    if (this.dotTicks <= 0) this.dotTimer = DOT_INTERVAL
    this.dotTicks = DOT_TICKS
  }

  private updateDot(dt: number): void {
    if (this.dotTicks <= 0) return
    const e = this.enemy
    if (!e.alive) {
      this.dotTicks = 0
      return
    }
    this.dotTimer -= dt
    if (this.dotTimer > 0) return
    this.dotTimer += DOT_INTERVAL
    this.dotTicks -= 1
    this.world.damage(e, DOT_DAMAGE, { kind: 'disco', source: this.owner, at: e.pos })
  }

  // ───────────────────────────── dance floor ─────────────────────────────

  private startFloor(): void {
    const n = FLOOR_GRID * FLOOR_GRID
    const rng = this.world.rng
    this.floor = {
      age: 0,
      numbers: Array.from({ length: n }, () => rng.int(FLOOR_MIN, FLOOR_MAX)),
      // A fresh floor counts as "not inside" everywhere, so the cells under the enemy trigger as soon as it arms.
      inside: Array.from({ length: n }, () => false),
      lastTrigger: Array.from({ length: n }, () => -Infinity),
      flashAt: Array.from({ length: n }, () => -Infinity),
    }
  }

  private updateFloor(dt: number): void {
    const f = this.floor
    if (!f) return
    f.age += dt
    if (f.age >= FLOOR_LIFETIME) {
      this.floor = null
      return
    }
    if (f.age < FLOOR_ARM_DELAY) return
    const e = this.enemy
    const now = this.world.time
    const c = this.cellSize
    for (let i = 0; i < f.numbers.length; i++) {
      const cx = (i % FLOOR_GRID) * c
      const cy = Math.floor(i / FLOOR_GRID) * c
      const over = e.alive && circleOverlapsRect(e.pos, e.radius, cx, cy, c, c)
      if (over && !f.inside[i] && now - f.lastTrigger[i] >= CELL_COOLDOWN && this.world.combatActive) {
        f.lastTrigger[i] = now
        f.flashAt[i] = now
        this.triggerCell(e, f.numbers[i], cx, cy, c)
      }
      f.inside[i] = over
    }
  }

  private triggerCell(e: Ball, value: number, x: number, y: number, size: number): void {
    // Credit the hit at the part of the enemy that lies inside the cell.
    const at = { x: clamp(e.pos.x, x, x + size), y: clamp(e.pos.y, y, y + size) }
    const dealt = this.world.damage(e, value, { kind: 'disco', source: this.owner, at, shake: value >= 5 ? 3 : 1 })
    if (dealt > 0) this.applyDot()
  }

  /** 0..1 visibility of the floor. */
  private floorAlpha(f: Floor): number {
    if (f.age < FLOOR_FADE_IN) return f.age / FLOOR_FADE_IN
    const out = f.age - FLOOR_FADE_IN - FLOOR_HOLD
    return out > 0 ? clamp(1 - out / FLOOR_FADE_OUT, 0, 1) : 1
  }

  // ───────────────────────────── cosmetics ─────────────────────────────

  private confetti(at: Vec): void {
    const fx = this.world.effects
    fx.burst(at, { count: 22, color: RAINBOW, shape: 'shard', speed: [90, 300], size: [2.5, 5], life: [0.5, 1.0], drag: 2.6, gravity: 120 })
    if (this.world.headless) return
    for (let i = 0; i < 4; i++) {
      if (this.notes.length >= MAX_NOTES) this.notes.shift()
      const a = fx.random() * Math.PI * 2
      const sp = 50 + fx.random() * 70
      const life = 0.8 + fx.random() * 0.5
      this.notes.push({
        pos: { x: at.x + dm.cos(a) * this.owner.radius * 0.8, y: at.y + dm.sin(a) * this.owner.radius * 0.8 },
        vel: { x: dm.cos(a) * sp, y: dm.sin(a) * sp - 40 },
        life,
        maxLife: life,
        color: RAINBOW[Math.floor(fx.random() * RAINBOW.length)],
        tilt: (fx.random() - 0.5) * 0.6,
        double: fx.random() < 0.5,
      })
    }
  }

  private updateNotes(dt: number): void {
    if (this.notes.length === 0) return
    for (const n of this.notes) {
      n.life -= dt
      n.pos.x += n.vel.x * dt
      n.pos.y += n.vel.y * dt
      n.vel.x *= dm.exp(-1.5 * dt)
      n.vel.y = n.vel.y * dm.exp(-1.5 * dt) - 30 * dt
    }
    this.notes = this.notes.filter((n) => n.life > 0)
  }

  /** 0..1 strength of the pre-burst / pre-floor glow. */
  private get telegraph(): number {
    if (!this.world.combatActive || this.owner.disarmed) return 0
    const t = Math.min(this.burstTimer, this.floorTimer)
    return t < TELEGRAPH_TIME ? 1 - t / TELEGRAPH_TIME : 0
  }

  // ───────────────────────────── rendering ─────────────────────────────

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const f = this.floor
    if (f) drawFloor(ctx, f, this.cellSize, this.world.time, this.floorAlpha(f) * fade)
    if (this.bars.length > 0) {
      ctx.save()
      ctx.globalAlpha = fade
      const t = this.world.time
      for (const b of this.bars) drawBar(ctx, b.tip, dm.atan2(b.dir.y, b.dir.x), BAR_LENGTH, BAR_THICKNESS, rainbowAt(b.hue + t * 1.6))
      ctx.restore()
    }
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const u = this.telegraph
    if (u <= 0) return
    const o = this.owner
    const pulse = 0.85 + 0.15 * dm.sin(this.world.time * 30)
    const outer = o.radius * (1.6 + 0.35 * u)
    const g = ctx.createRadialGradient(o.pos.x, o.pos.y, o.radius * 0.8, o.pos.x, o.pos.y, outer)
    g.addColorStop(0, `rgba(${HALO_COLOR},${0.7 * u * pulse})`)
    g.addColorStop(1, `rgba(${HALO_COLOR},0)`)
    ctx.save()
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, outer, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawMirrorBall(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, this.world.time)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    // Glitter swirling around a dazzled (DoT-ed) enemy.
    const e = this.enemy
    if (this.dotTicks > 0 && e.alive) {
      const t = this.world.time
      for (let i = 0; i < 4; i++) {
        const a = t * 3 + (i * Math.PI) / 2
        const rr = e.radius * (1.05 + 0.1 * dm.sin(t * 7 + i))
        ctx.globalAlpha = fade * (0.55 + 0.45 * dm.sin(t * 11 + i * 1.7))
        drawGlint(ctx, e.pos.x + dm.cos(a) * rr, e.pos.y + dm.sin(a) * rr, 4.5, rainbowAt(i / 4 + t))
      }
    }
    for (const n of this.notes) {
      ctx.globalAlpha = fade * clamp(n.life / (n.maxLife * 0.4), 0, 1)
      drawNote(ctx, n.pos.x, n.pos.y, 1, n.tilt, n.color, n.double)
    }
    ctx.restore()
  }
}

function circleOverlapsRect(c: Vec, r: number, x: number, y: number, w: number, h: number): boolean {
  const dx = c.x - clamp(c.x, x, x + w)
  const dy = c.y - clamp(c.y, y, y + h)
  return dx * dx + dy * dy < r * r
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const ch = (i: number) => Math.round(ca[i] + (cb[i] - ca[i]) * t)
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`
}

/** Smoothly cycles red → orange → yellow → green → cyan → blue → purple (phase in turns). */
function rainbowAt(phase: number): string {
  const n = RAINBOW.length
  const p = (((phase % 1) + 1) % 1) * n
  const i = Math.floor(p)
  return mix(RAINBOW[i], RAINBOW[(i + 1) % n], p - i)
}

/** A glowing rainbow light bar whose front end is at `tip`. */
export function drawBar(ctx: CanvasRenderingContext2D, tip: Vec, angle: number, length: number, thickness: number, color: string): void {
  const h = thickness / 2
  ctx.save()
  ctx.translate(tip.x, tip.y)
  ctx.rotate(angle)
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.fillStyle = color
  roundRectPath(ctx, -length, -h, length, thickness, h)
  ctx.fill()
  ctx.shadowBlur = 0
  // Bright core.
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  roundRectPath(ctx, -length + h * 0.5, -h * 0.45, length - h, h * 0.9, h * 0.45)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1.6
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(-length + h, 0)
  ctx.lineTo(-h, 0)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.shadowColor = '#ffffff'
  ctx.shadowBlur = 8
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(-h * 0.6, 0, h * 0.62, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawFloor(ctx: CanvasRenderingContext2D, f: Floor, cell: number, now: number, alpha: number): void {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(cell * 0.3)}px ${PIXEL_FONT}`
  for (let i = 0; i < f.numbers.length; i++) {
    const x = (i % FLOOR_GRID) * cell
    const y = Math.floor(i / FLOOR_GRID) * cell
    const base = CELL_COLORS[f.numbers[i] - 1]
    const light = mix(base, '#ffffff', 0.45)
    ctx.fillStyle = base
    ctx.fillRect(x, y, cell, cell)
    // Neon inner border.
    const inset = 6
    ctx.shadowColor = light
    ctx.shadowBlur = 12
    ctx.strokeStyle = light
    ctx.lineWidth = 2
    ctx.strokeRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2)
    ctx.shadowBlur = 0
    // Thin seam between cells.
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, cell, cell)

    const flash = 1 - (now - f.flashAt[i]) / CELL_FLASH
    if (flash > 0) {
      ctx.fillStyle = `rgba(235,250,255,${0.8 * flash})`
      ctx.fillRect(x, y, cell, cell)
    }

    const label = String(f.numbers[i])
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillText(label, x + cell / 2 + 4, y + cell / 2 + 5)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, x + cell / 2, y + cell / 2 + 1)
  }
  ctx.restore()
}

/** Four-point specular star. */
function drawGlint(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x, y - size)
  ctx.quadraticCurveTo(x, y, x + size, y)
  ctx.quadraticCurveTo(x, y, x, y + size)
  ctx.quadraticCurveTo(x, y, x - size, y)
  ctx.quadraticCurveTo(x, y, x, y - size)
  ctx.fill()
}

/** Facets of a spinning mirror ball on top of the ball body, with twinkling glints. */
export function drawMirrorBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, time: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()

  // Sphere shading: light from the top-left.
  const shade = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, r * 0.1, cx, cy, r * 1.05)
  shade.addColorStop(0, 'rgba(255,255,255,0.22)')
  shade.addColorStop(0.6, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(0,20,40,0.35)')
  ctx.fillStyle = shade
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)

  ctx.strokeStyle = 'rgba(190,240,250,0.38)'
  ctx.lineWidth = 1
  ctx.beginPath()
  // Parallels.
  for (let k = -3; k <= 3; k++) {
    const phi = (k * Math.PI) / 8
    const y = cy + r * dm.sin(phi)
    const hw = r * dm.cos(phi)
    ctx.moveTo(cx - hw, y)
    ctx.lineTo(cx + hw, y)
  }
  ctx.stroke()
  // Meridians on the visible hemisphere, turning slowly.
  const meridians = 14
  const spin = time * 0.7
  ctx.beginPath()
  for (let k = 0; k < meridians; k++) {
    const lon = spin + (k * Math.PI * 2) / meridians
    if (dm.cos(lon) <= 0) continue
    const rx = r * Math.abs(dm.sin(lon))
    if (rx < 0.5) {
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx, cy + r)
      continue
    }
    const right = dm.sin(lon) > 0
    ctx.moveTo(cx, cy - r)
    ctx.ellipse(cx, cy, rx, r, 0, -Math.PI / 2, Math.PI / 2, !right)
  }
  ctx.stroke()

  // Specular glints that twinkle in turn.
  const spots: [number, number, number][] = [
    [-0.42, -0.48, 0],
    [0.3, -0.62, 1.7],
    [-0.62, 0.12, 3.1],
    [0.5, 0.28, 4.4],
    [-0.1, 0.6, 5.6],
  ]
  for (const [dx, dy, ph] of spots) {
    const tw = dm.sin(time * 4.2 + ph)
    if (tw <= 0.1) continue
    ctx.globalAlpha = tw
    drawGlint(ctx, cx + dx * r, cy + dy * r, r * 0.17 * (0.6 + 0.4 * tw), '#ffffff')
  }
  ctx.restore()

  ctx.save()
  ctx.strokeStyle = 'rgba(225,250,255,0.85)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, r - 0.75, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** A small music note (♪ or ♫) of the given colour. */
function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tilt: number, color: string, double: boolean): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  ctx.scale(s, s)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 1.8
  const heads = double ? [-4, 4] : [0]
  for (const hx of heads) {
    ctx.beginPath()
    ctx.ellipse(hx - 2.2, 6, 3.4, 2.5, -0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(hx + 0.9, 6)
    ctx.lineTo(hx + 0.9, -7)
    ctx.stroke()
  }
  ctx.lineWidth = 2.4
  ctx.beginPath()
  if (double) {
    ctx.moveTo(-3.1, -7)
    ctx.lineTo(4.9, -8.5)
  } else {
    ctx.moveTo(0.9, -7)
    ctx.quadraticCurveTo(5.5, -4, 4.5, 1)
  }
  ctx.stroke()
  ctx.restore()
}

export function drawDiscoPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const angles = [-2.6, -1.75, -0.55, 0.35, 1.3, 2.25]
  for (const [i, a] of angles.entries()) {
    const d = r * (1.55 + 0.35 * (i % 2))
    drawBar(ctx, { x: cx + dm.cos(a) * (d + r * 0.6), y: cy + dm.sin(a) * (d + r * 0.6) }, a, r * 1.15, r * 0.3, RAINBOW[i % RAINBOW.length])
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  drawMirrorBall(ctx, cx, cy, r * 0.9, 0.35)
  drawNote(ctx, cx + r * 1.35, cy - r * 1.55, r / 24, 0.2, '#ffe14a', false)
  drawNote(ctx, cx - r * 1.5, cy + r * 1.45, r / 26, -0.25, '#22d3ee', true)
}

export const discoDef: CharacterDef = {
  id: 'disco',
  nameEn: 'DISCO BALL',
  ruleValues: { burstInterval: BURST_INTERVAL, barCount: BAR_COUNT, barDamage: BAR_DAMAGE, dotInterval: DOT_INTERVAL, dotDamage: DOT_DAMAGE, dotTicks: DOT_TICKS, floorInterval: FLOOR_INTERVAL, floorGrid: FLOOR_GRID, floorMin: FLOOR_MIN, floorMax: FLOOR_MAX },
  palette: { ball: '#2a8fb0', text: '#ffffff', accent: '#90e0e8' },
  mirrorPalette: { ball: '#6d4bb0', text: '#f3e8ff', accent: '#c4b5fd' },
  create: (w, b) => new DiscoAbility(w, b),
  drawPortrait: drawDiscoPortrait,
}
