import * as dm from '../core/dmath'
import { distanceToSegment } from '../core/geometry'
import { type Vec, clamp, cube, dist } from '../core/vec'
import { Ability } from '../engine/Ability'
import { predictPosition } from '../engine/predict'
import type { CharacterDef } from './types'

const BOARD_CELLS = 5
const FIRST_MODE_DELAY = 3.5
/** Pause between the end of one chess mode and the start of the next (s). */
export const MODE_COOLDOWN = 3.5
const GATHER_TIME = 0.7
/** Strikes begin this long after the mode starts. */
const STRIKE_START = 1.4
const BOARD_FADE = 0.5
const HOLD_TIME = 0.45
const DASH_SPEED = 1600
const KNIGHT_PAUSE = 0.1
export const CHESS_DAMAGE = 10
const KNOCK = 520

export type Piece = 'rook' | 'bishop' | 'knight'
const PIECES: readonly Piece[] = ['rook', 'bishop', 'knight']

interface Leg {
  to: Vec
  pauseAfter: number
}

type Phase = 'gather' | 'aim' | 'strike' | 'hold' | 'fade'

interface Mode {
  piece: Piece
  phase: Phase
  /** Time since the mode began. */
  t: number
  /** Time spent in the current phase. */
  phaseT: number
  gatherFrom: Vec
  legs: Leg[]
  legIndex: number
  legHit: boolean
  pause: number
}

/**
 * 象棋 — every few seconds a chessboard covers the arena. The ball glides
 * to the centre square, picks the piece whose moves best cover the enemy
 * and strikes along that
 * piece's moves (rook: straight lines, bishop: diagonals, knight: four L
 * hops), dashing out and back; every pass that connects deals damage. The
 * ball is shielded (blue halo) while it strikes.
 */
export class ChessAbility extends Ability {
  private cooldown = FIRST_MODE_DELAY
  private mode: Mode | null = null

  private get cell(): number {
    return this.world.size / BOARD_CELLS
  }

  private cellCenter(col: number, row: number): Vec {
    return { x: (col + 0.5) * this.cell, y: (row + 0.5) * this.cell }
  }

  override update(dt: number): void {
    if (this.mode) {
      this.updateMode(this.mode, dt)
      return
    }
    this.cooldown -= dt
    if (this.cooldown <= 0 && this.world.combatActive && !this.owner.disarmed) this.begin()
  }

  /**
   * Picks the piece whose strike path passes closest to where the enemy is
   * expected to be when the strikes begin (ties broken at random).
   */
  private choosePiece(): { piece: Piece; legs: Leg[] } {
    const target = predictPosition(this.enemy, STRIKE_START, this.world.size)
    const center = this.cellCenter(2, 2)
    const options = this.world.rng.next() < 0.5 ? PIECES : [...PIECES].reverse()
    let best: { piece: Piece; legs: Leg[]; score: number } | null = null
    for (const piece of options) {
      const legs = this.planLegs(piece)
      let score = Infinity
      let from = center
      for (const leg of legs) {
        score = Math.min(score, distanceToSegment(target, from, leg.to))
        from = leg.to
      }
      if (!best || score < best.score) best = { piece, legs, score }
    }
    return best!
  }

  private begin(): void {
    const { piece, legs } = this.choosePiece()
    this.mode = {
      piece,
      phase: 'gather',
      t: 0,
      phaseT: 0,
      gatherFrom: { x: this.owner.pos.x, y: this.owner.pos.y },
      legs,
      legIndex: 0,
      legHit: false,
      pause: 0,
    }
    this.owner.pinned = true
    this.owner.vel = { x: 0, y: 0 }
    this.world.sound('chess', 0.6, 0.8)
  }

  private planLegs(piece: Piece): Leg[] {
    const c = 2
    const center = this.cellCenter(c, c)
    const legs: Leg[] = []
    const outAndBack = (col: number, row: number) => {
      legs.push({ to: this.cellCenter(col, row), pauseAfter: 0 }, { to: center, pauseAfter: 0 })
    }
    if (piece === 'rook') {
      outAndBack(c, 0)
      outAndBack(c, 4)
      outAndBack(0, c)
      outAndBack(4, c)
    } else if (piece === 'bishop') {
      outAndBack(0, 0)
      outAndBack(4, 4)
      outAndBack(4, 0)
      outAndBack(0, 4)
    } else {
      // Four L-hops forming a pinwheel: one L rotated by 0°, 180°, 90°, 270°.
      const rng = this.world.rng
      const mirror = rng.sign()
      const start = rng.int(0, 3)
      for (const k of [0, 2, 1, 3]) {
        let dx = -1 * mirror
        let dy = -2
        for (let r = 0; r < (start + k) % 4; r++) [dx, dy] = [-dy, dx]
        // Long leg first, then the short one; retrace on the way back.
        const longFirst = Math.abs(dx) === 2 ? { col: c + dx, row: c } : { col: c, row: c + dy }
        const elbow = this.cellCenter(longFirst.col, longFirst.row)
        const dest = this.cellCenter(c + dx, c + dy)
        legs.push(
          { to: elbow, pauseAfter: KNIGHT_PAUSE },
          { to: dest, pauseAfter: KNIGHT_PAUSE },
          { to: elbow, pauseAfter: KNIGHT_PAUSE },
          { to: center, pauseAfter: KNIGHT_PAUSE },
        )
      }
    }
    return legs
  }

  private setPhase(m: Mode, phase: Phase): void {
    m.phase = phase
    m.phaseT = 0
  }

  private updateMode(m: Mode, dt: number): void {
    const o = this.owner
    m.t += dt
    m.phaseT += dt
    const center = this.cellCenter(2, 2)
    switch (m.phase) {
      case 'gather': {
        const u = clamp(m.phaseT / GATHER_TIME, 0, 1)
        const k = 1 - cube(1 - u)
        o.pos = { x: m.gatherFrom.x + (center.x - m.gatherFrom.x) * k, y: m.gatherFrom.y + (center.y - m.gatherFrom.y) * k }
        if (u >= 1) this.setPhase(m, 'aim')
        break
      }
      case 'aim':
        o.pos = { x: center.x, y: center.y }
        if (m.t >= STRIKE_START) {
          this.setPhase(m, 'strike')
          o.invulnerable = true
        }
        break
      case 'strike':
        this.updateStrike(m, dt)
        break
      case 'hold':
        o.vel = { x: 0, y: 0 }
        if (m.phaseT >= HOLD_TIME) this.setPhase(m, 'fade')
        break
      case 'fade':
        if (m.phaseT >= BOARD_FADE) this.end()
        break
    }
  }

  private updateStrike(m: Mode, dt: number): void {
    const o = this.owner
    if (m.pause > 0) {
      m.pause -= dt
      o.vel = { x: 0, y: 0 }
      return
    }
    const leg = m.legs[m.legIndex]
    const dx = leg.to.x - o.pos.x
    const dy = leg.to.y - o.pos.y
    const d = dm.hypot(dx, dy)
    const step = DASH_SPEED * dt
    const dir = d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 }
    if (d <= step) {
      o.pos = { x: leg.to.x, y: leg.to.y }
    } else {
      o.pos = { x: o.pos.x + dir.x * step, y: o.pos.y + dir.y * step }
    }
    o.vel = { x: dir.x * DASH_SPEED, y: dir.y * DASH_SPEED }
    this.checkHit(m, dir)
    if (d <= step) {
      m.legIndex += 1
      m.legHit = false
      m.pause = leg.pauseAfter
      if (m.legIndex >= m.legs.length) {
        o.vel = { x: 0, y: 0 }
        this.setPhase(m, 'hold')
      }
      if (m.legIndex % 2 === 0 || m.piece === 'knight') this.world.sound('chess', 0.35, 1.3)
    }
  }

  private checkHit(m: Mode, dir: Vec): void {
    if (m.legHit) return
    const e = this.enemy
    if (!e.alive || !this.world.combatActive) return
    if (dist(e.pos, this.owner.pos) > e.radius + this.owner.radius + 2) return
    m.legHit = true
    const at = { x: (e.pos.x + this.owner.pos.x) / 2, y: (e.pos.y + this.owner.pos.y) / 2 }
    this.world.damage(e, CHESS_DAMAGE, { kind: 'chess', source: this.owner, at, knock: { x: dir.x * KNOCK, y: dir.y * KNOCK }, shake: 3 })
  }

  private end(): void {
    const o = this.owner
    this.mode = null
    this.cooldown = MODE_COOLDOWN
    o.pinned = false
    o.invulnerable = false
    // Ease back into motion along a random diagonal.
    const a = this.world.rng.int(0, 3) * (Math.PI / 2) + Math.PI / 4 + this.world.rng.range(-0.3, 0.3)
    o.vel = { x: dm.cos(a) * o.baseSpeed * 0.3, y: dm.sin(a) * o.baseSpeed * 0.3 }
  }

  /** 0..1 visibility of the board and mode visuals. */
  private boardAlpha(m: Mode): number {
    if (m.phase === 'fade') return clamp(1 - m.phaseT / BOARD_FADE, 0, 1)
    return clamp(m.t / BOARD_FADE, 0, 1)
  }

  override renderOverlay(ctx: CanvasRenderingContext2D): void {
    const m = this.mode
    if (!m || this.presence <= 0) return
    const a = this.boardAlpha(m) * this.presence
    const cell = this.cell
    ctx.save()
    ctx.globalAlpha = a * 0.92
    ctx.fillStyle = '#afabb0'
    for (let row = 0; row < BOARD_CELLS; row++) {
      for (let col = 0; col < BOARD_CELLS; col++) {
        if ((row + col) % 2 === 0) ctx.fillRect(col * cell, row * cell, cell, cell)
      }
    }
    // Telegraph: the remaining strike path in red.
    const lineAlpha = m.phase === 'gather' ? 0 : m.phase === 'aim' ? clamp((m.t - 0.9) / 0.5, 0, 1) : 1
    if (lineAlpha > 0 && m.legIndex < m.legs.length) {
      ctx.globalAlpha = a * lineAlpha * 0.85
      ctx.strokeStyle = '#d03030'
      ctx.lineWidth = 2.5
      ctx.lineJoin = 'round'
      ctx.beginPath()
      const start = m.phase === 'strike' ? this.owner.pos : this.cellCenter(2, 2)
      ctx.moveTo(start.x, start.y)
      for (let i = m.legIndex; i < m.legs.length; i++) {
        ctx.lineTo(m.legs[i].to.x, m.legs[i].to.y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const m = this.mode
    if (!m) return
    const o = this.owner
    if (!o.invulnerable) return
    const a = m.phase === 'fade' ? this.boardAlpha(m) : 1
    ctx.save()
    ctx.globalAlpha = a
    ctx.strokeStyle = 'rgba(191,219,254,0.9)'
    ctx.lineWidth = 2.5
    ctx.shadowColor = '#93c5fd'
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, o.radius + 3, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const m = this.mode
    if (!m) return
    const o = this.owner
    const a = clamp((m.t - 0.5) / 0.3, 0, 1) * (m.phase === 'fade' ? this.boardAlpha(m) : 1) * this.presence
    if (a <= 0) return
    ctx.save()
    ctx.globalAlpha = a
    drawChessPiece(ctx, m.piece, o.pos.x, o.pos.y - o.radius - 2, o.radius * 2.1)
    ctx.restore()
  }
}

/** A flat gold piece standing with its base at (x, baseY), `h` tall. */
export function drawChessPiece(ctx: CanvasRenderingContext2D, piece: Piece, x: number, baseY: number, h: number): void {
  const w = h * 0.62
  ctx.save()
  ctx.translate(x, baseY)
  ctx.fillStyle = piece === 'knight' ? '#f8b040' : piece === 'rook' ? '#e8b068' : '#ddb070'
  ctx.strokeStyle = '#7c4a12'
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.beginPath()
  // Shared base.
  ctx.moveTo(-w / 2, 0)
  ctx.lineTo(w / 2, 0)
  ctx.lineTo(w * 0.42, -h * 0.12)
  if (piece === 'rook') {
    ctx.lineTo(w * 0.3, -h * 0.2)
    ctx.lineTo(w * 0.3, -h * 0.72)
    ctx.lineTo(w * 0.42, -h * 0.78)
    ctx.lineTo(w * 0.42, -h)
    ctx.lineTo(w * 0.22, -h)
    ctx.lineTo(w * 0.22, -h * 0.9)
    ctx.lineTo(w * 0.07, -h * 0.9)
    ctx.lineTo(w * 0.07, -h)
    ctx.lineTo(-w * 0.07, -h)
    ctx.lineTo(-w * 0.07, -h * 0.9)
    ctx.lineTo(-w * 0.22, -h * 0.9)
    ctx.lineTo(-w * 0.22, -h)
    ctx.lineTo(-w * 0.42, -h)
    ctx.lineTo(-w * 0.42, -h * 0.78)
    ctx.lineTo(-w * 0.3, -h * 0.72)
    ctx.lineTo(-w * 0.3, -h * 0.2)
  } else if (piece === 'bishop') {
    ctx.lineTo(w * 0.2, -h * 0.22)
    ctx.quadraticCurveTo(w * 0.42, -h * 0.55, w * 0.12, -h * 0.82)
    ctx.quadraticCurveTo(0, -h * 0.9, -w * 0.12, -h * 0.82)
    ctx.quadraticCurveTo(-w * 0.42, -h * 0.55, -w * 0.2, -h * 0.22)
  } else {
    ctx.lineTo(w * 0.3, -h * 0.2)
    ctx.quadraticCurveTo(w * 0.4, -h * 0.65, w * 0.05, -h * 0.95)
    ctx.lineTo(-w * 0.12, -h * 0.88)
    ctx.lineTo(-w * 0.45, -h * 0.6)
    ctx.lineTo(-w * 0.38, -h * 0.5)
    ctx.lineTo(-w * 0.1, -h * 0.58)
    ctx.lineTo(-w * 0.32, -h * 0.2)
  }
  ctx.lineTo(-w * 0.42, -h * 0.12)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  if (piece === 'bishop') {
    ctx.beginPath()
    ctx.arc(0, -h * 0.94, h * 0.06, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(w * 0.1, -h * 0.66)
    ctx.lineTo(-w * 0.04, -h * 0.5)
    ctx.stroke()
  }
  if (piece === 'knight') {
    ctx.fillStyle = '#7c4a12'
    ctx.beginPath()
    ctx.arc(-w * 0.08, -h * 0.74, h * 0.03, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawChessPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const cell = r * 1.25
  ctx.fillStyle = '#afabb0'
  for (let row = -2; row <= 2; row++) {
    for (let col = -2; col <= 2; col++) {
      if ((row + col) % 2 === 0) ctx.fillRect(cx + (col - 0.5) * cell, cy + (row - 0.5) * cell + r * 0.4, cell, cell)
    }
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy + r * 0.4, r * 0.8, 0, Math.PI * 2)
  ctx.fill()
  drawChessPiece(ctx, 'knight', cx, cy + r * 0.4 - r * 0.8, r * 1.5)
}

export const chessDef: CharacterDef = {
  id: 'chess',
  nameEn: 'CHESS',
  ruleValues: { chessDamage: CHESS_DAMAGE, modeCooldown: MODE_COOLDOWN },
  palette: { ball: '#c69b5c', text: '#ffffff', accent: '#c9a36e' },
  mirrorPalette: { ball: '#7c2d12', text: '#ffedd5', accent: '#ea580c' },
  create: (w, b) => new ChessAbility(w, b),
  drawPortrait: drawChessPortrait,
}
