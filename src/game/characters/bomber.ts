import * as dm from '../core/dmath'
import { type Vec, clamp, cube, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import { roundRectPath } from '../render/draw'
import type { CharacterDef } from './types'

/** Free time (not rooted / pinned / disarmed) before the first bomb. */
const FIRST_PLANT = 4.0
export const PLANT_COOLDOWN = 3.0
export const FUSE_TIME = 4.0
export const MAX_BOMBS = 2
export const MAX_DAMAGE = 30
export const MIN_DAMAGE = 6
/** Damage lost per ball radius of distance between bomb and enemy centre. */
export const DAMAGE_FALLOFF = 3.5
const DAMAGE_JITTER = 3
const KNOCK = 250
const SHAKE = 6
const POP_TIME = 0.5
const POP_START = 0.15
const BOMB_WIDTH = BALL_RADIUS * 2.1
/** The bomb's last second is flagged with a red pulse. */
const WARN_TIME = 1.0
const FLASH_TIME = 0.25
const RING_TIME = 0.5
const BLAST_SHOW = Math.max(FLASH_TIME, RING_TIME)

interface Bomb {
  pos: Vec
  age: number
}

interface Blast {
  pos: Vec
  age: number
}

/**
 * 爆破者 (Bomber) — while free to act, plants a time bomb at its own centre
 * every few seconds. Each bomb ticks for a few seconds and then blasts the
 * whole arena: the closer the enemy is, the harder it hits. The bomber is
 * immune to its own bombs.
 */
export class BomberAbility extends Ability {
  private timer = FIRST_PLANT
  private bombs: Bomb[] = []
  private blasts: Blast[] = []

  override update(dt: number): void {
    for (const b of this.blasts) b.age += dt
    this.blasts = this.blasts.filter((b) => b.age < BLAST_SHOW)
    this.updateBombs(dt)
    if (!this.world.combatActive) return
    const o = this.owner
    if (o.rooted || o.pinned || o.disarmed) return
    this.timer -= dt
    if (this.timer <= 0) {
      if (this.bombs.length < MAX_BOMBS) {
        this.plant()
        this.timer += PLANT_COOLDOWN
      } else {
        this.timer = 0
      }
    }
  }

  private plant(): void {
    this.bombs.push({ pos: { x: this.owner.pos.x, y: this.owner.pos.y }, age: 0 })
    this.world.sound('place', 0.6, 0.7)
  }

  private updateBombs(dt: number): void {
    const kept: Bomb[] = []
    for (const b of this.bombs) {
      const before = b.age
      b.age += dt
      if (b.age >= FUSE_TIME) {
        this.detonate(b.pos)
        continue
      }
      // A soft tick every second of the fuse.
      if (Math.floor(b.age) > Math.floor(before)) this.world.sound('clack', 0.12, 2.2)
      kept.push(b)
    }
    this.bombs = kept
  }

  private detonate(pos: Vec): void {
    const fx = this.world.effects
    this.blasts.push({ pos: { x: pos.x, y: pos.y }, age: 0 })
    fx.burst(pos, { count: 36, color: ['#ffffff', '#f3f4f6', '#d1d5db', '#9ca3af'], shape: 'smoke', speed: [40, 420], size: [10, 20], life: [1.0, 1.5], endScale: 2.2, drag: 2.6 })
    fx.burst(pos, { count: 14, color: ['#fffbe6', '#fde047', '#fb923c'], shape: 'spark', speed: [200, 520], size: [2, 4], life: [0.15, 0.35] })
    this.world.addShake(SHAKE)
    this.world.sound('explosion', 1, 0.85)

    const e = this.enemy
    if (!e.alive) return
    const rng = this.world.rng
    const dx = e.pos.x - pos.x
    const dy = e.pos.y - pos.y
    const d = dm.hypot(dx, dy)
    const base = clamp(MAX_DAMAGE - (DAMAGE_FALLOFF * d) / BALL_RADIUS, MIN_DAMAGE, MAX_DAMAGE)
    const dmg = Math.round(base + rng.range(-DAMAGE_JITTER, DAMAGE_JITTER))
    let nx: number
    let ny: number
    if (d > 1e-3) {
      nx = dx / d
      ny = dy / d
    } else {
      const a = rng.range(0, Math.PI * 2)
      nx = dm.cos(a)
      ny = dm.sin(a)
    }
    this.world.damage(e, dmg, { kind: 'bomb', source: this.owner, at: { x: e.pos.x, y: e.pos.y }, knock: { x: nx * KNOCK, y: ny * KNOCK } })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.bombs.length === 0) return
    ctx.save()
    ctx.globalAlpha = fade
    const time = this.world.time
    for (const b of this.bombs) {
      const u = clamp(b.age / POP_TIME, 0, 1)
      const s = POP_START + (1 - POP_START) * easeOutBack(u)
      // The hand jumps in quarter-second ticks, one full turn over the fuse.
      const ticks = Math.floor(b.age * 4)
      const hand = -Math.PI / 2 + (ticks / (FUSE_TIME * 4)) * Math.PI * 2
      const warn = FUSE_TIME - b.age < WARN_TIME && dm.sin(time * 30) > 0
      drawBomb(ctx, b.pos.x, b.pos.y, BOMB_WIDTH * s, hand, warn)
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.blasts.length === 0) return
    ctx.save()
    for (const b of this.blasts) {
      const f = b.age / FLASH_TIME
      if (f < 1) {
        const rad = BALL_RADIUS * 2.4 * (0.6 + 0.4 * f)
        const a = (1 - f) * fade
        const g = ctx.createRadialGradient(b.pos.x, b.pos.y, 0, b.pos.x, b.pos.y, rad)
        g.addColorStop(0, `rgba(255,255,255,${a})`)
        g.addColorStop(0.45, `rgba(255,240,160,${a * 0.85})`)
        g.addColorStop(1, 'rgba(255,220,120,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(b.pos.x, b.pos.y, rad, 0, Math.PI * 2)
        ctx.fill()
      }
      const t = b.age / RING_TIME
      if (t < 1) {
        ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - t) * fade})`
        ctx.lineWidth = 4 * (1 - t) + 1
        ctx.beginPath()
        ctx.arc(b.pos.x, b.pos.y, BALL_RADIUS * (0.6 + 4.2 * t), 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.restore()
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * cube(t - 1) + c1 * sq(t - 1)
}

/** One dynamite stick lying horizontally, its paper end facing `outward` (±1). */
function drawStick(ctx: CanvasRenderingContext2D, x0: number, y: number, len: number, h: number, outward: number): void {
  const x = outward < 0 ? x0 - len : x0
  roundRectPath(ctx, x, y - h / 2, len, h, h * 0.4)
  ctx.fillStyle = '#d02020'
  ctx.fill()
  ctx.strokeStyle = '#7f1010'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,140,140,0.6)'
  ctx.beginPath()
  ctx.moveTo(x + h * 0.4, y - h * 0.22)
  ctx.lineTo(x + len - h * 0.4, y - h * 0.22)
  ctx.stroke()
  // Paper cap on the outer end.
  ctx.fillStyle = '#e8c48a'
  const capX = outward < 0 ? x + h * 0.12 : x + len - h * 0.12
  ctx.beginPath()
  ctx.ellipse(capX, y, h * 0.16, h * 0.38, 0, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * A time bomb centred on (x, y), `w` wide: metal box with a clock dial,
 * two terminal posts joined by a wire, and dynamite strapped to each side.
 */
export function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hand: number, warn: boolean): void {
  const h = w * (1.4 / 2.1)
  const bw = w * 0.62
  const bh = h * 0.78
  const boxY = h * 0.08
  const top = boxY - bh / 2
  ctx.save()
  ctx.translate(x, y)

  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(0, h * 0.5, w * 0.48, h * 0.14, 0, 0, Math.PI * 2)
  ctx.fill()

  // Three sticks stacked on each side, tucked under the box.
  const len = w * 0.3
  const sh = h * 0.26
  for (const side of [-1, 1]) {
    const inner = side * (bw / 2 - w * 0.11)
    for (let i = -1; i <= 1; i++) drawStick(ctx, inner, boxY + i * sh * 1.02, len, sh, side)
  }

  // Terminal posts and the wire loop between them.
  const px = bw * 0.28
  const postH = h * 0.16
  const postW = w * 0.06
  ctx.strokeStyle = '#1f2937'
  ctx.lineWidth = Math.max(1.2, w * 0.03)
  ctx.beginPath()
  ctx.moveTo(-px, top - postH)
  ctx.bezierCurveTo(-px, top - postH - h * 0.32, px, top - postH - h * 0.32, px, top - postH)
  ctx.stroke()
  ctx.fillStyle = '#a1a1aa'
  ctx.strokeStyle = '#52525b'
  ctx.lineWidth = 1
  for (const sx of [-px, px]) {
    ctx.fillRect(sx - postW / 2, top - postH, postW, postH + 1)
    ctx.strokeRect(sx - postW / 2, top - postH, postW, postH + 1)
  }

  // Metal box.
  const g = ctx.createLinearGradient(0, top, 0, top + bh)
  g.addColorStop(0, '#b4b9c2')
  g.addColorStop(1, '#6b7280')
  roundRectPath(ctx, -bw / 2, top, bw, bh, bh * 0.2)
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = warn ? '#ef4444' : '#3f4650'
  ctx.lineWidth = warn ? 2.5 : 1.5
  ctx.stroke()
  ctx.fillStyle = '#4b5563'
  for (const [rx, ry] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    ctx.beginPath()
    ctx.arc(rx * (bw / 2 - bh * 0.14), boxY + ry * (bh / 2 - bh * 0.14), Math.max(0.8, bh * 0.045), 0, Math.PI * 2)
    ctx.fill()
  }

  // Clock dial with a ticking hand.
  const dr = bh * 0.34
  ctx.fillStyle = warn ? '#fecaca' : '#ffffff'
  ctx.strokeStyle = '#374151'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(0, boxY, dr, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2
    ctx.moveTo(dm.cos(a) * dr * 0.72, boxY + dm.sin(a) * dr * 0.72)
    ctx.lineTo(dm.cos(a) * dr * 0.92, boxY + dm.sin(a) * dr * 0.92)
  }
  ctx.stroke()
  ctx.strokeStyle = '#111827'
  ctx.lineWidth = Math.max(1.2, dr * 0.14)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, boxY)
  ctx.lineTo(dm.cos(hand) * dr * 0.78, boxY + dm.sin(hand) * dr * 0.78)
  ctx.stroke()
  ctx.fillStyle = '#d02020'
  ctx.beginPath()
  ctx.arc(0, boxY, Math.max(1, dr * 0.12), 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

export function drawBomberPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.85, cy - r * 0.45, r * 0.95, 0, Math.PI * 2)
  ctx.fill()
  drawBomb(ctx, cx + r * 1.1, cy + r * 0.75, r * 2.1, -Math.PI / 2 + 2.1, false)
}

export const bomberDef: CharacterDef = {
  id: 'bomber',
  nameEn: 'BOMBER',
  ruleValues: { plantCooldown: PLANT_COOLDOWN, fuseTime: FUSE_TIME, maxBombs: MAX_BOMBS, maxDamage: MAX_DAMAGE, minDamage: MIN_DAMAGE },
  palette: { ball: '#0c4424', text: '#ffffff', accent: '#1f7a45' },
  mirrorPalette: { ball: '#4d7c0f', text: '#ecfccb', accent: '#84cc16' },
  create: (w, b) => new BomberAbility(w, b),
  drawPortrait: drawBomberPortrait,
}
