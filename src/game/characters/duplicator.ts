import * as dm from '../core/dmath'
import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import { PIXEL_FONT } from '../render/draw'
import { Swarm } from './minions'
import type { CharacterDef } from './types'

const FIRST_WAVE = 0.3
export const WAVE_INTERVAL = 8
export const CLONES_PER_WAVE = 4
/** Clone HP, which also ticks down by one per second. */
export const CLONE_HP = 5
const MARK_TIME = 0.4
const CLONE_RADIUS = BALL_RADIUS * 0.6
export const CLONE_DAMAGE = 2
const CLONE_COOLDOWN = 1.0

/**
 * 复制者 — has no weapon of its own. Every few seconds it summons a swarm of
 * small dagger-wielding copies all over the arena; they hunt the enemy,
 * stabbing on contact, and crumble after a few seconds.
 */
export class DuplicatorAbility extends Ability {
  private readonly swarm = new Swarm({
    speed: 330,
    turnRate: 4,
    contactDamage: CLONE_DAMAGE,
    contactCooldown: CLONE_COOLDOWN,
    kind: 'stab',
    spawnDelay: 0.15,
  })
  private timer = FIRST_WAVE
  private marks: Vec[] = []
  private markTimer = 0

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed && this.marks.length === 0) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += WAVE_INTERVAL
        this.markWave()
      }
    }
    if (this.marks.length > 0) {
      this.markTimer -= dt
      if (this.markTimer <= 0) this.releaseWave()
    }
    this.swarm.update(this.world, this.owner, this.enemy, dt)
  }

  private markWave(): void {
    const rng = this.world.rng
    const s = this.world.size
    this.marks = []
    for (let i = 0; i < CLONES_PER_WAVE; i++) {
      this.marks.push({ x: rng.range(CLONE_RADIUS, s - CLONE_RADIUS), y: rng.range(CLONE_RADIUS, s - CLONE_RADIUS) })
    }
    this.markTimer = MARK_TIME
    this.world.effects.burst(this.owner.pos, { count: 18, color: ['#6a4cff', '#9a7cff', '#c4b5fd'], speed: [60, 220], size: [2, 4.5], life: [0.3, 0.6] })
    this.world.sound('place', 0.5, 0.5)
  }

  private releaseWave(): void {
    const rng = this.world.rng
    for (const m of this.marks) this.swarm.spawn(m, CLONE_RADIUS, CLONE_HP, rng.range(0, Math.PI * 2))
    this.marks = []
    this.world.sound('throw', 0.5, 0.7)
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    if (this.marks.length === 0 || this.presence <= 0) return
    const u = 1 - this.markTimer / MARK_TIME
    ctx.save()
    ctx.strokeStyle = `rgba(30,30,40,${0.4 + 0.5 * u})`
    ctx.fillStyle = `rgba(120,120,130,${0.15 * u})`
    ctx.lineWidth = 1.5
    for (const m of this.marks) {
      ctx.beginPath()
      ctx.arc(m.x, m.y, CLONE_RADIUS * 0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const m of this.swarm.minions) {
      const pop = clamp(m.age / 0.15, 0.2, 1)
      const r = m.radius * pop
      const a = dm.atan2(m.vel.y, m.vel.x)
      drawDagger(ctx, m.pos.x, m.pos.y, a, r)
      ctx.fillStyle = this.owner.color
      ctx.beginPath()
      ctx.arc(m.pos.x, m.pos.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `700 ${Math.round(r * 1.1)}px ${PIXEL_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(Math.ceil(m.life)), m.pos.x, m.pos.y + 1)
    }
    ctx.restore()
  }
}

/** A short silver dagger sticking out of a minion in direction `a`. */
export function drawDagger(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, r: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(a)
  ctx.fillStyle = '#e5e7eb'
  ctx.strokeStyle = '#6b7280'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(r * 0.6, -r * 0.18)
  ctx.lineTo(r * 1.65, 0)
  ctx.lineTo(r * 0.6, r * 0.18)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#78350f'
  ctx.fillRect(r * 0.4, -r * 0.3, r * 0.2, r * 0.6)
  ctx.restore()
}

export function drawDuplicatorPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const spots: [number, number, number][] = [
    [-1.9, -1.5, 0.6],
    [1.8, -1.6, 2.4],
    [1.9, 1.4, 3.5],
    [-1.7, 1.7, -0.7],
    [0.2, -2.3, 1.6],
  ]
  for (const [dx, dy, a] of spots) {
    const x = cx + dx * r
    const y = cy + dy * r
    drawDagger(ctx, x, y, a, r * 0.42)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r * 0.42, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
}

export const duplicatorDef: CharacterDef = {
  id: 'duplicator',
  nameEn: 'DUPLICATOR',
  ruleValues: { waveInterval: WAVE_INTERVAL, clonesPerWave: CLONES_PER_WAVE, cloneDamage: CLONE_DAMAGE, cloneHp: CLONE_HP },
  palette: { ball: '#888888', text: '#ffffff', accent: '#a3a3a3' },
  mirrorPalette: { ball: '#57534e', text: '#f5f5f4', accent: '#a8a29e' },
  create: (w, b) => new DuplicatorAbility(w, b),
  drawPortrait: drawDuplicatorPortrait,
}
