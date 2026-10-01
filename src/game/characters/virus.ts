import { clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import type { BallContact } from '../engine/types'
import type { CharacterDef } from './types'

/** Damage ticks per infection. */
export const INFECTION_TICKS = 13
export const TICK_DAMAGE = 2
/** Seconds between infection ticks. */
export const TICK_INTERVAL = 0.35
/** Delay from contact to the first tick (s). */
export const FIRST_TICK = 0.25
/** After an infection runs out, the enemy can't be re-infected for this long (s). */
export const REINFECT_COOLDOWN = 1.0
const SPIKES = 12
/** Spike reach (dot centre) in ball radii. */
const SPIKE_REACH = 1.35
const SPIKE_SPIN = 0.35
/** Goo turns sickly olive/brown this long before the infection ends (s). */
const WANING_TIME = 0.7
const GOO_LEVEL = 0.33
const GOO_RISE = 0.25
const GOO_DRAIN = 0.3
const WANING_COLOR = '#7a6420'

interface Infection {
  target: Ball
  ticksLeft: number
  /** Seconds until the next tick. */
  timer: number
  age: number
}

/**
 * 病毒 — has no weapon at all. Merely touching the enemy infects it: the
 * infection deals a string of small ticks over a few seconds and can't be
 * stacked or refreshed. Once it runs its course, the enemy is briefly immune
 * before the virus can catch it again. Infection is passive, so it spreads
 * even while the virus is disarmed.
 */
export class VirusAbility extends Ability {
  private infection: Infection | null = null
  /** World time the last infection ended. */
  private endedAt = -Infinity

  override onBallContact(c: BallContact): void {
    const target = c.other
    if (target !== this.enemy || !this.world.combatActive || !target.alive || target.invulnerable) return
    if (this.infection || this.world.time - this.endedAt < REINFECT_COOLDOWN) return
    this.infection = { target, ticksLeft: INFECTION_TICKS, timer: FIRST_TICK, age: 0 }
    this.world.effects.burst(c.point, {
      count: 12,
      color: [this.owner.color, '#fef9c3', '#84cc16'],
      speed: [60, 200],
      size: [2, 4],
      life: [0.25, 0.5],
    })
    this.world.sound('poison', 0.6, 0.8)
  }

  override update(dt: number): void {
    const inf = this.infection
    if (!inf) return
    if (!inf.target.alive) {
      this.end()
      return
    }
    inf.age += dt
    inf.timer -= dt
    while (inf.timer <= 0 && inf.ticksLeft > 0) {
      inf.timer += TICK_INTERVAL
      inf.ticksLeft -= 1
      this.world.damage(inf.target, TICK_DAMAGE, { kind: 'virus', source: this.owner, at: inf.target.pos })
      if (!inf.target.alive) break
    }
    if (inf.ticksLeft <= 0 || !inf.target.alive) this.end()
  }

  private end(): void {
    this.infection = null
    this.endedAt = this.world.time
  }

  /** Seconds left until the infection's final tick. */
  private remaining(inf: Infection): number {
    return inf.timer + (inf.ticksLeft - 1) * TICK_INTERVAL
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawSpikes(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, this.world.time * SPIKE_SPIN, o.color)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const inf = this.infection
    const e = this.enemy
    if (!e.alive) return
    let level: number
    let waning: number
    if (inf) {
      level = GOO_LEVEL * clamp(inf.age / GOO_RISE, 0, 1)
      waning = clamp((WANING_TIME - this.remaining(inf)) / 0.25, 0, 1)
    } else {
      // Drains away right after the last tick.
      const k = (this.world.time - this.endedAt) / GOO_DRAIN
      if (k >= 1) return
      level = GOO_LEVEL * (1 - k)
      waning = 1
    }
    if (level <= 0) return
    ctx.save()
    ctx.globalAlpha = fade * e.opacity
    drawGoo(ctx, e.pos.x, e.pos.y, e.radius * e.drawScale, level, mixHex(this.owner.color, WANING_COLOR, waning), this.world.time)
    ctx.restore()
  }
}

/** Thin rotating stalks tipped with pale-yellow dots; the ball body covers their bases. */
function drawSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, color: string): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.2, r * 0.07)
  ctx.lineCap = 'round'
  const dotR = Math.max(1.5, r * 0.11)
  const reach = r * SPIKE_REACH
  for (let i = 0; i < SPIKES; i++) {
    const a = rot + (i / SPIKES) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    ctx.beginPath()
    ctx.moveTo(x + c * r * 0.7, y + s * r * 0.7)
    ctx.lineTo(x + c * (reach - dotR * 0.6), y + s * (reach - dotR * 0.6))
    ctx.stroke()
  }
  ctx.fillStyle = '#fef08a'
  for (let i = 0; i < SPIKES; i++) {
    const a = rot + (i / SPIKES) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(x + Math.cos(a) * reach, y + Math.sin(a) * reach, dotR, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Goo filling the lower `level` of a ball (fraction of its diameter), with drips. */
function drawGoo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, level: number, color: string, t: number): void {
  const top = y + r - level * r * 2
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.globalAlpha *= 0.9
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x - r, y + r)
  for (let dx = -r; dx <= r; dx += 3) {
    ctx.lineTo(x + dx, top + Math.sin(dx * 0.28 + t * 5) * 1.8)
  }
  ctx.lineTo(x + r, y + r)
  ctx.closePath()
  ctx.fill()
  // Bubbles rising through the goo.
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  for (let i = 0; i < 4; i++) {
    const u = (t * 0.8 + i * 0.27) % 1
    const bx = x + (-0.5 + i * 0.33) * r
    const by = y + r - u * level * r * 2
    ctx.beginPath()
    ctx.arc(bx, by, 1.2 + (1 - u) * 1.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // Drops hanging from the bottom and periodically falling off.
  ctx.save()
  ctx.fillStyle = color
  for (let i = 0; i < 3; i++) {
    const fx = -0.4 + i * 0.4
    const dx = x + fx * r
    const baseY = y + Math.sqrt(Math.max(0, r * r - (fx * r) ** 2)) - 2
    const cycle = (t * 0.9 + i * 0.37) % 1
    const len = 3 + 7 * Math.min(1, cycle / 0.7)
    ctx.beginPath()
    ctx.moveTo(dx - 2.5, baseY)
    ctx.quadraticCurveTo(dx, baseY + len * 1.4, dx + 2.5, baseY)
    ctx.fill()
    if (cycle > 0.7) {
      // The drop has broken off and falls away.
      const fall = (cycle - 0.7) / 0.3
      ctx.save()
      ctx.globalAlpha *= 1 - fall
      ctx.beginPath()
      ctx.arc(dx, baseY + len + fall * 16, 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
  ctx.restore()
}

/** Blends two #rrggbb colours. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a)
  const pb = parseHex(b)
  const ch = (i: number) => Math.round(pa[i] + (pb[i] - pa[i]) * t)
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`
}

function parseHex(c: string): [number, number, number] {
  const h = c.startsWith('#') ? c.slice(1) : c
  const full = h.length === 3 ? h.split('').map((d) => d + d).join('') : h.slice(0, 6)
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) return [51, 221, 34]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function drawVirusPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawSpikes(ctx, cx, cy, r, 0.13, color)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

const num = (v: number): number => +v.toFixed(2)

export const virusDef: CharacterDef = {
  id: 'virus',
  name: '病毒',
  nameEn: 'VIRUS',
  tagline: '碰一下就传染',
  rules: [
    '没有武器，只靠身体接触传染（被缴械也照样传染）',
    `碰到敌人就会感染它：每 ${TICK_INTERVAL} 秒 -${TICK_DAMAGE}，共 ${INFECTION_TICKS} 次（约 ${num(INFECTION_TICKS * TICK_INTERVAL)} 秒）`,
    '感染期间再碰到不会叠加，也不会刷新',
    `感染结束 ${REINFECT_COOLDOWN} 秒后才能再次传染`,
  ],
  palette: { ball: '#33dd22', text: '#ffffff', accent: '#3ddc2a' },
  mirrorPalette: { ball: '#d946ef', text: '#ffffff', accent: '#e879f9' },
  create: (w, b) => new VirusAbility(w, b),
  drawPortrait: drawVirusPortrait,
}
