import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { PIXEL_FONT } from '../render/draw'
import type { CharacterDef } from './types'

const FIRST_REVEAL = 2.0
/** Time between two grid reveals (s). */
export const CYCLE_INTERVAL = 9.6
/** How long each grid stays on the arena (s). */
export const GRID_DURATION = 4.7
const FADE_IN = 0.5
const FADE_OUT = 0.4
/** Strike times after the reveal (s). */
const STRIKE_TIMES = [0.9, 2.0, 3.1] as const
export const STRIKES = STRIKE_TIMES.length
/** Cells per side; the arena is split into GRID × GRID cells. */
const GRID = 3
/** Most cells roll a small number… */
export const SMALL_MIN = 1
export const SMALL_MAX = 9
/** …but a few always hold a big one. */
export const BIG_CELLS = 2
export const BIG_MIN = 14
export const BIG_MAX = 26
const STRIKE_FLASH = 0.6
const NUMBER_SIZE = 40

interface Strike {
  col: number
  row: number
  age: number
}

/**
 * WDC — every few seconds lays a numbered 3×3 grid over the whole arena.
 * Three times during each grid it strikes the cell containing the midpoint
 * between itself and the enemy, dealing that cell's number to the enemy
 * wherever it is. Most numbers are small, but two cells always hide a big one.
 */
export class WdcAbility extends Ability {
  private timer = FIRST_REVEAL
  /** Time since the current grid was revealed, or -1 while no grid is up. */
  private gridAge = -1
  private values: number[] = []
  private strikesDone = 0
  private strikes: Strike[] = []

  override update(dt: number): void {
    for (const s of this.strikes) s.age += dt
    this.strikes = this.strikes.filter((s) => s.age < STRIKE_FLASH)
    if (this.gridAge >= 0) {
      this.gridAge += dt
      while (this.strikesDone < STRIKES && this.gridAge >= STRIKE_TIMES[this.strikesDone]) {
        this.strikesDone += 1
        this.strike()
      }
      if (this.gridAge >= GRID_DURATION) this.gridAge = -1
    }
    if (!this.world.combatActive || this.owner.disarmed) return
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer += CYCLE_INTERVAL
      this.reveal()
    }
  }

  private midpoint(): Vec {
    const a = this.owner.pos
    const b = this.enemy.pos
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  private reveal(): void {
    const rng = this.world.rng
    const vals: number[] = []
    for (let i = 0; i < GRID * GRID - BIG_CELLS; i++) vals.push(rng.int(SMALL_MIN, SMALL_MAX))
    for (let i = 0; i < BIG_CELLS; i++) vals.push(rng.int(BIG_MIN, BIG_MAX))
    // Fisher–Yates so the big numbers land in random cells.
    for (let i = vals.length - 1; i > 0; i--) {
      const j = rng.int(0, i)
      const t = vals[i]
      vals[i] = vals[j]
      vals[j] = t
    }
    this.values = vals
    this.gridAge = 0
    this.strikesDone = 0
    const m = this.midpoint()
    this.world.effects.burst(m, { count: 18, color: ['#2a60ff', '#60a5fa', '#ffffff'], speed: [60, 260], size: [1.5, 3.5], life: [0.3, 0.7] })
    this.world.effects.burst(m, { count: 8, color: '#ffffff', shape: 'spark', speed: [160, 380], size: [1.5, 3], life: [0.2, 0.4] })
    this.world.sound('chess', 0.6, 1.2)
  }

  private strike(): void {
    const cell = this.world.size / GRID
    const m = this.midpoint()
    const col = clamp(Math.floor(m.x / cell), 0, GRID - 1)
    const row = clamp(Math.floor(m.y / cell), 0, GRID - 1)
    this.strikes.push({ col, row, age: 0 })
    const dmg = this.values[row * GRID + col]
    const e = this.enemy
    if (!e.alive) return
    this.world.damage(e, dmg, { kind: 'wdc', source: this.owner, at: { x: e.pos.x, y: e.pos.y }, shake: Math.min(10, dmg / 3) })
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const size = this.world.size
    const cell = size / GRID
    ctx.save()
    // Struck cells: dark blue fill with a bright border, fading out.
    for (const s of this.strikes) {
      const u = 1 - s.age / STRIKE_FLASH
      ctx.globalAlpha = fade * u
      ctx.fillStyle = 'rgba(10,32,120,0.55)'
      ctx.fillRect(s.col * cell, s.row * cell, cell, cell)
      ctx.strokeStyle = '#7da2ff'
      ctx.lineWidth = 3
      ctx.shadowColor = '#2a60ff'
      ctx.shadowBlur = 12
      ctx.strokeRect(s.col * cell + 1.5, s.row * cell + 1.5, cell - 3, cell - 3)
      ctx.shadowBlur = 0
    }
    if (this.gridAge >= 0) {
      const t = this.gridAge
      const alpha = Math.min(clamp(t / FADE_IN, 0, 1), clamp((GRID_DURATION - t) / FADE_OUT, 0, 1))
      ctx.globalAlpha = fade * alpha
      drawGrid(ctx, 0, 0, size, this.values)
    }
    ctx.restore()
  }
}

/** Glowing GRID × GRID lines covering a `size` square at (x, y), with a number in each cell. */
function drawGrid(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, values: readonly number[], fontSize = NUMBER_SIZE, lineWidth = 2): void {
  const cell = size / GRID
  ctx.save()
  ctx.strokeStyle = '#2a60ff'
  ctx.lineWidth = lineWidth
  ctx.shadowColor = '#2a60ff'
  ctx.shadowBlur = 10
  ctx.beginPath()
  for (let i = 0; i <= GRID; i++) {
    const p = clamp(i * cell, lineWidth / 2, size - lineWidth / 2)
    ctx.moveTo(x + p, y)
    ctx.lineTo(x + p, y + size)
    ctx.moveTo(x, y + p)
    ctx.lineTo(x + size, y + p)
  }
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.globalAlpha *= 0.82
  ctx.fillStyle = '#6088d0'
  ctx.font = `700 ${fontSize}px ${PIXEL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const v = values[row * GRID + col]
      if (v === undefined) continue
      ctx.fillText(String(v), x + (col + 0.5) * cell, y + (row + 0.5) * cell + fontSize * 0.04)
    }
  }
  ctx.restore()
}

export function drawWdcPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const size = r * 4.4
  const x0 = cx - size / 2
  const y0 = cy - size / 2
  const cell = size / GRID
  // Highlight the cell under the ball, as if a strike just landed there.
  ctx.fillStyle = 'rgba(10,32,120,0.55)'
  ctx.fillRect(x0 + cell * 2, y0 + cell * 2, cell, cell)
  drawGrid(ctx, x0, y0, size, [7, 3, 12, 38, 1, 9, 5, 14, 27], r * 0.5, 1.5)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x0 + cell * 2.5, y0 + cell * 2.5, r * 0.62, 0, Math.PI * 2)
  ctx.fill()
}

export const wdcDef: CharacterDef = {
  id: 'wdc',
  nameEn: 'WDC',
  ruleValues: { cycleInterval: CYCLE_INTERVAL, gridDuration: GRID_DURATION, smallMin: SMALL_MIN, smallMax: SMALL_MAX, bigCells: BIG_CELLS, bigMin: BIG_MIN, bigMax: BIG_MAX, strikes: STRIKES },
  palette: { ball: '#0048f8', text: '#ffffff', accent: '#3b6bff' },
  mirrorPalette: { ball: '#1e3a8a', text: '#dbeafe', accent: '#60a5fa' },
  create: (w, b) => new WdcAbility(w, b),
  drawPortrait: drawWdcPortrait,
}
