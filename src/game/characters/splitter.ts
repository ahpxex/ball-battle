import * as dm from '../core/dmath'
import { type Vec, clamp, distSq, sq } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { BallContact, DamageOptions } from '../engine/types'
import type { World } from '../engine/World'
import { PIXEL_FONT } from '../render/draw'
import type { CharacterDef } from './types'

/** Damage dealt by any piece touching the enemy. */
export const SPLIT_DAMAGE = 5
/** Per-piece gap between two contact hits (s). */
export const HIT_COOLDOWN = 0.4
/** Pieces may re-merge once both are at least this old since their last split (s). */
export const MERGE_DELAY = 1.0
/** Cap on pieces besides the primary (the owner ball itself). */
export const MAX_EXTRA_PIECES = 6
/** Constant travel speed of the extra pieces (u/s). */
const PIECE_SPEED = 300
const PIECE_RADIUS = BALL_RADIUS
const SPIKES = 12
const SPIKE_REACH = 1.15
/** Fraction of the speed kept on each axis so pieces never bounce in a straight line. */
const MIN_AXIS_RATIO = 0.22
const POP_TIME = 0.14
const HIDDEN_LABEL = 'rgba(0,0,0,0)'
const SPIKE_EDGE = 'rgba(8,28,80,0.55)'
const BUBBLES = ['#bfdbfe', '#ffffff', '#93c5fd', '#e0f2fe'] as const

interface Piece {
  pos: Vec
  vel: Vec
  /** HP carried by this piece (integer ≥ 1). */
  share: number
  /** World time of this piece's last split (merge readiness). */
  born: number
  /** World time the piece came into existence (pop-in animation). */
  spawned: number
  hitCooldown: number
  /** Cosmetic spike rotation offset. */
  spin: number
}

/**
 * 裂变 SPLITTER — a spiky blue ball that splits on every hit. Each time a
 * piece touches the enemy it deals a small hit and divides in two, sharing
 * its HP; pieces that bump into each other a while after splitting fuse back
 * together. The owner ball is the "primary" piece and its HP is the total of
 * all pieces, so the side only falls once every piece is spent.
 */
export class SplitterAbility extends Ability {
  private extras: Piece[] = []
  private primaryBorn = 0
  private primaryCooldown = 0

  constructor(world: World, owner: Ball) {
    super(world, owner)
    // Each piece draws its own share; the engine's single total label would mislead.
    owner.textColor = HIDDEN_LABEL
  }

  /** HP carried by the owner ball itself: the total minus every extra piece. */
  private get primaryShare(): number {
    let sum = 0
    for (const p of this.extras) sum += p.share
    return this.owner.hp - sum
  }

  override update(dt: number): void {
    this.rebalance()
    this.primaryCooldown = Math.max(0, this.primaryCooldown - dt)
    this.moveExtras(dt)
    this.extraContacts()
    this.mergePieces()
  }

  override onBallContact(c: BallContact): void {
    if (c.other !== this.enemy || this.primaryCooldown > 0) return
    if (!this.world.combatActive || this.owner.disarmed) return
    this.primaryCooldown = HIT_COOLDOWN
    this.strike(null, c.normal, c.point)
  }

  override onOwnerDamaged(_amount: number, _opts: DamageOptions): void {
    if (this.owner.hp <= 0) {
      // Out of HP: every remaining piece shatters with the primary.
      for (const p of this.extras) this.pop(p.pos, 1.4)
      this.extras = []
      return
    }
    this.rebalance()
  }

  /**
   * Keeps every share ≥ 1 after the total drops: the primary's deficit is
   * taken from the largest extra, and pieces with nothing left to give are
   * absorbed (they burst).
   */
  private rebalance(): void {
    if (this.owner.hp <= 0) return
    let deficit = Math.ceil(1 - this.primaryShare)
    while (deficit > 0 && this.extras.length > 0) {
      let big = 0
      for (let i = 1; i < this.extras.length; i++) if (this.extras[i].share > this.extras[big].share) big = i
      const p = this.extras[big]
      if (p.share > 1) {
        const take = Math.min(deficit, p.share - 1)
        p.share -= take
        deficit -= take
      } else {
        this.extras.splice(big, 1)
        this.pop(p.pos, 1)
        deficit -= p.share
      }
    }
  }

  private moveExtras(dt: number): void {
    const s = this.world.size
    const r = PIECE_RADIUS
    for (const p of this.extras) {
      p.hitCooldown = Math.max(0, p.hitCooldown - dt)
      steerOffAxis(p.vel, dt)
      p.pos.x += p.vel.x * dt
      p.pos.y += p.vel.y * dt
      if (p.pos.x < r) {
        p.pos.x = r
        p.vel.x = Math.abs(p.vel.x)
      } else if (p.pos.x > s - r) {
        p.pos.x = s - r
        p.vel.x = -Math.abs(p.vel.x)
      }
      if (p.pos.y < r) {
        p.pos.y = r
        p.vel.y = Math.abs(p.vel.y)
      } else if (p.pos.y > s - r) {
        p.pos.y = s - r
        p.vel.y = -Math.abs(p.vel.y)
      }
    }
  }

  /** Extra pieces pass through the enemy but still hit (and split) on overlap. */
  private extraContacts(): void {
    const e = this.enemy
    if (!this.world.combatActive || this.owner.disarmed || !e.alive) return
    const reach = PIECE_RADIUS + e.radius
    // Only the pieces that existed before this pass are tested: splitting appends new ones, and
    // damage dealt back to us mid-pass (e.g. a mirror's reflection) can absorb pieces via rebalance().
    for (const p of this.extras.slice()) {
      if (p.hitCooldown > 0 || !this.extras.includes(p)) continue
      const dx = e.pos.x - p.pos.x
      const dy = e.pos.y - p.pos.y
      const d2 = dx * dx + dy * dy
      if (d2 >= reach * reach) continue
      const d = Math.sqrt(d2) || 1e-6
      const n = { x: dx / d, y: dy / d }
      p.hitCooldown = HIT_COOLDOWN
      this.strike(p, n, { x: p.pos.x + n.x * PIECE_RADIUS, y: p.pos.y + n.y * PIECE_RADIUS })
      if (!this.owner.alive) return
    }
  }

  /**
   * A piece (`null` = the primary) touched the enemy along normal `n`: hit,
   * then split it in two, both halves flying away from the enemy in opposite
   * sideways directions.
   */
  private strike(piece: Piece | null, n: Vec, at: Vec): void {
    const o = this.owner
    this.world.damage(this.enemy, SPLIT_DAMAGE, { kind: 'split', source: o, at })
    // Damage dealt back during the hit may have absorbed this piece already.
    if (!o.alive || (piece && !this.extras.includes(piece))) return
    const share = piece ? piece.share : this.primaryShare
    if (share < 2 || this.extras.length >= MAX_EXTRA_PIECES) return

    const now = this.world.time
    const tx = -n.y
    const ty = n.x
    const k = Math.SQRT1_2
    const dirA = { x: (-n.x + tx) * k, y: (-n.y + ty) * k }
    const dirB = { x: (-n.x - tx) * k, y: (-n.y - ty) * k }
    const vel = piece ? piece.vel : o.vel
    // The original keeps the side closest to where it was already heading.
    const keepA = vel.x * tx + vel.y * ty >= 0
    const keep = keepA ? dirA : dirB
    const other = keepA ? dirB : dirA
    const from = piece ? piece.pos : o.pos

    if (piece) {
      piece.share -= Math.floor(share / 2)
      piece.vel = { x: keep.x * PIECE_SPEED, y: keep.y * PIECE_SPEED }
      piece.born = now
    } else {
      if (o.movable) {
        const sp = dm.hypot(o.vel.x, o.vel.y) || o.baseSpeed
        o.vel = { x: keep.x * sp, y: keep.y * sp }
      }
      this.primaryBorn = now
    }

    const s = this.world.size
    const r = PIECE_RADIUS
    this.extras.push({
      pos: { x: clamp(from.x + other.x * 4, r, s - r), y: clamp(from.y + other.y * 4, r, s - r) },
      vel: { x: other.x * PIECE_SPEED, y: other.y * PIECE_SPEED },
      share: Math.floor(share / 2),
      born: now,
      spawned: now,
      hitCooldown: HIT_COOLDOWN,
      spin: this.world.effects.random() * Math.PI * 2,
    })
    this.pop(from, 1)
    this.world.sound('place', 0.4, 1.5)
  }

  /** Pieces that touch after both have cooled down fuse into the older one. */
  private mergePieces(): void {
    const now = this.world.time
    const ready = (born: number) => now - born >= MERGE_DELAY
    const o = this.owner
    const touch = (a: Vec, ra: number, b: Vec) => distSq(a, b) < sq(ra + PIECE_RADIUS)

    if (ready(this.primaryBorn)) {
      for (let i = this.extras.length - 1; i >= 0; i--) {
        const p = this.extras[i]
        if (!ready(p.born) || !touch(o.pos, o.radius, p.pos)) continue
        // The primary's share is derived, so dropping the extra hands its HP over.
        this.extras.splice(i, 1)
        this.merged(o.pos, p.pos)
      }
    }

    let fused = true
    while (fused) {
      fused = false
      for (let i = 0; i < this.extras.length && !fused; i++) {
        const a = this.extras[i]
        if (!ready(a.born)) continue
        for (let j = i + 1; j < this.extras.length; j++) {
          const b = this.extras[j]
          if (!ready(b.born) || !touch(a.pos, PIECE_RADIUS, b.pos)) continue
          const [keep, gone, idx] = b.born < a.born ? [b, a, i] : [a, b, j]
          keep.share += gone.share
          this.extras.splice(idx, 1)
          this.merged(keep.pos, gone.pos)
          fused = true
          break
        }
      }
    }
  }

  private merged(into: Vec, from: Vec): void {
    this.pop({ x: (into.x + from.x) / 2, y: (into.y + from.y) / 2 }, 0.8)
    this.world.sound('clack', 0.35, 1.4)
  }

  /** Light-blue bubble burst used for splits, merges and shattering pieces. */
  private pop(at: Vec, strength: number): void {
    const fx = this.world.effects
    fx.burst(at, { count: Math.round(10 * strength), color: BUBBLES, speed: [50, 200 * strength], size: [2, 5], life: [0.3, 0.6], drag: 3.5 })
    fx.burst(at, { count: Math.round(4 * strength), color: ['#ffffff', '#bfdbfe'], shape: 'ring', speed: [30, 110], size: [3, 6], life: [0.3, 0.55], endScale: 1.8, jitter: PIECE_RADIUS * 0.4 })
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawSpikes(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, o.color, this.world.time * 0.5)
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawShare(ctx, o.pos.x, o.pos.y, Math.max(0, Math.ceil(this.primaryShare)), 1)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0 || this.extras.length === 0) return
    const now = this.world.time
    const color = this.owner.color
    ctx.save()
    ctx.globalAlpha = fade
    for (const p of this.extras) {
      const pop = clamp((now - p.spawned) / POP_TIME, 0, 1)
      const k = 0.55 + 0.45 * pop
      const r = PIECE_RADIUS * k
      drawSpikes(ctx, p.pos.x, p.pos.y, r, color, now * 0.5 + p.spin)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2)
      ctx.fill()
      drawShare(ctx, p.pos.x, p.pos.y, p.share, k)
    }
    ctx.restore()
  }
}

/** Nudges a constant-speed velocity away from near axis-aligned headings. */
function steerOffAxis(v: Vec, dt: number): void {
  const min = PIECE_SPEED * MIN_AXIS_RATIO
  const k = 1 - dm.exp(-3 * dt)
  if (Math.abs(v.x) < min) v.x += Math.sign(v.x || 1) * (min - Math.abs(v.x)) * k
  if (Math.abs(v.y) < min) v.y += Math.sign(v.y || 1) * (min - Math.abs(v.y)) * k
  const sp = dm.hypot(v.x, v.y) || 1
  v.x = (v.x / sp) * PIECE_SPEED
  v.y = (v.y / sp) * PIECE_SPEED
}

/** A ring of thin triangular spikes reaching SPIKE_REACH × r (body drawn separately). */
export function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, rot: number): void {
  const half = (Math.PI / SPIKES) * 0.38
  const tip = r * SPIKE_REACH
  const base = r * 0.9
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = SPIKE_EDGE
  ctx.lineWidth = 1
  ctx.lineJoin = 'miter'
  ctx.beginPath()
  for (let i = 0; i < SPIKES; i++) {
    const a = rot + (i / SPIKES) * Math.PI * 2
    ctx.moveTo(x + dm.cos(a - half) * base, y + dm.sin(a - half) * base)
    ctx.lineTo(x + dm.cos(a) * tip, y + dm.sin(a) * tip)
    ctx.lineTo(x + dm.cos(a + half) * base, y + dm.sin(a + half) * base)
    ctx.closePath()
  }
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** A piece's HP share: white pixel digits with a dark outline. */
function drawShare(ctx: CanvasRenderingContext2D, x: number, y: number, value: number, scale: number): void {
  const size = Math.round((value >= 100 ? 21 : 23) * scale)
  ctx.save()
  ctx.font = `700 ${size}px ${PIXEL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(8,20,48,0.85)'
  ctx.lineWidth = 3.5
  ctx.strokeText(String(value), x, y + 1)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(String(value), x, y + 1)
  ctx.restore()
}

export function drawSplitterPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const pr = r * 0.8
  const pieces: [number, number, number][] = [
    [-0.75, 0.55, 0.2],
    [1.25, -0.95, 1.1],
    [1.15, 1.35, 2.3],
  ]
  // Motion streaks fanning out from the split point.
  ctx.save()
  ctx.strokeStyle = 'rgba(147,197,253,0.55)'
  ctx.lineWidth = 2
  ctx.setLineDash([4, 5])
  ctx.lineCap = 'round'
  for (const [dx, dy] of pieces.slice(1)) {
    ctx.beginPath()
    ctx.moveTo(cx + r * 0.2, cy + r * 0.2)
    ctx.lineTo(cx + dx * r * 0.75, cy + dy * r * 0.75)
    ctx.stroke()
  }
  ctx.setLineDash([])
  // Bubbles at the split point.
  ctx.fillStyle = 'rgba(191,219,254,0.85)'
  for (const [bx, by, br] of [[0.3, 0.1, 0.09], [0.45, 0.45, 0.06], [0.1, -0.25, 0.05], [0.6, -0.05, 0.05]] as const) {
    ctx.beginPath()
    ctx.arc(cx + bx * r, cy + by * r, br * r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  for (const [dx, dy, rot] of pieces) {
    const x = cx + dx * r
    const y = cy + dy * r
    drawSpikes(ctx, x, y, pr, color, rot)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, pr, 0, Math.PI * 2)
    ctx.fill()
  }
}

export const splitterDef: CharacterDef = {
  id: 'splitter',
  nameEn: 'SPLITTER',
  ruleValues: { splitDamage: SPLIT_DAMAGE, maxPieces: MAX_EXTRA_PIECES + 1, mergeDelay: MERGE_DELAY.toFixed(1) },
  palette: { ball: '#1e6eef', text: '#ffffff', accent: '#2b66d0' },
  mirrorPalette: { ball: '#1e3a8a', text: '#dbeafe', accent: '#60a5fa' },
  create: (w, b) => new SplitterAbility(w, b),
  drawPortrait: drawSplitterPortrait,
}
