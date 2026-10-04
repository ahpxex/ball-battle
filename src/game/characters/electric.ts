import * as dm from '../core/dmath'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import type { BallContact } from '../engine/types'
import type { CharacterDef } from './types'

export const STUN_DURATION = 3.0
export const SHOCK_DAMAGE = 4
const SHOCK_INTERVAL = 0.5
export const SHOCK_TICKS = 5
/** Re-apply cooldown measured from the start of a stun (s). */
export const SHOCK_COOLDOWN = 3.5
const AURA_SPARKS = 9

interface Shock {
  target: Ball
  ticksLeft: number
  timer: number
  age: number
}

/**
 * 雷电 — body contact electrocutes the enemy: it freezes in place for a few
 * seconds and takes a burst of shock damage over time. Its weapon keeps
 * working while frozen.
 */
export class ElectricAbility extends Ability {
  private shock: Shock | null = null
  private cooldown = 0
  private auraSeed = 0

  override onBallContact(c: BallContact): void {
    if (this.shock || this.cooldown > 0 || this.owner.disarmed || !this.world.combatActive) return
    const target = c.other
    if (target.invulnerable) return
    target.applyRoot(STUN_DURATION)
    this.shock = { target, ticksLeft: SHOCK_TICKS, timer: SHOCK_INTERVAL, age: 0 }
    this.cooldown = SHOCK_COOLDOWN
    this.world.effects.burst(c.point, { count: 14, color: ['#fef08a', '#ffffff', '#facc15'], shape: 'spark', speed: [150, 420], size: [1.5, 3.5], life: [0.15, 0.35] })
    this.world.sound('zap', 0.9)
  }

  override update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.auraSeed += dt
    const sh = this.shock
    if (!sh) return
    sh.age += dt
    if (!sh.target.alive || !this.world.combatActive || sh.age >= STUN_DURATION) {
      this.shock = null
      return
    }
    sh.timer -= dt
    if (sh.timer > 0 || sh.ticksLeft <= 0) return
    sh.timer += SHOCK_INTERVAL
    sh.ticksLeft -= 1
    this.world.damage(sh.target, SHOCK_DAMAGE, { kind: 'shock', source: this.owner })
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    // Pulsing golden glow with crackling sparks.
    const pulse = 0.5 + 0.5 * dm.sin(this.auraSeed * 2.3) * dm.sin(this.auraSeed * 0.9 + 1)
    const r = o.radius * (1.4 + 0.5 * pulse)
    const g = ctx.createRadialGradient(o.pos.x, o.pos.y, o.radius * 0.8, o.pos.x, o.pos.y, r)
    g.addColorStop(0, 'rgba(250,204,21,0.28)')
    g.addColorStop(1, 'rgba(250,204,21,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(o.pos.x, o.pos.y, r, 0, Math.PI * 2)
    ctx.fill()
    drawSparks(ctx, o.pos.x, o.pos.y, o.radius * 1.05, r, Math.floor(AURA_SPARKS * (0.4 + 0.6 * pulse)), this.auraSeed)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const sh = this.shock
    if (!sh || this.presence <= 0) return
    const t = sh.target
    // The frozen victim glows pale and crackles at its rim.
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.fillStyle = '#fef3c7'
    ctx.beginPath()
    ctx.arc(t.pos.x, t.pos.y, t.radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    drawSparks(ctx, t.pos.x, t.pos.y, t.radius * 0.85, t.radius * 1.25, 7, this.auraSeed * 3)
  }
}

/** Short crooked yellow streaks scattered in a ring between r0 and r1. */
function drawSparks(ctx: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number, count: number, t: number): void {
  ctx.save()
  ctx.strokeStyle = '#fef9c3'
  ctx.lineWidth = 1.4
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random positions that change a few times per second.
    const k = Math.floor(t * 12) * 31 + i * 97
    const h = (n: number) => {
      const x = dm.sin(n * 12.9898 + k * 78.233) * 43758.5453
      return x - Math.floor(x)
    }
    const a = h(1) * Math.PI * 2
    const rr = r0 + (r1 - r0) * h(2)
    const len = 4 + h(3) * 7
    const x = cx + dm.cos(a) * rr
    const y = cy + dm.sin(a) * rr
    const dir = a + Math.PI / 2 + (h(4) - 0.5)
    ctx.moveTo(x, y)
    ctx.lineTo(x + dm.cos(dir) * len * 0.5 + (h(5) - 0.5) * 3, y + dm.sin(dir) * len * 0.5 + (h(6) - 0.5) * 3)
    ctx.lineTo(x + dm.cos(dir) * len, y + dm.sin(dir) * len)
  }
  ctx.stroke()
  ctx.restore()
}

export function drawElectricPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.9)
  g.addColorStop(0, 'rgba(250,204,21,0.35)')
  g.addColorStop(1, 'rgba(250,204,21,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2)
  ctx.fill()
  drawSparks(ctx, cx, cy, r * 1.05, r * 1.8, 12, 3.7)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

export const electricDef: CharacterDef = {
  id: 'electric',
  nameEn: 'ELECTRIC',
  ruleValues: { stunDuration: STUN_DURATION, shockDamage: SHOCK_DAMAGE, shockTicks: SHOCK_TICKS, shockCooldown: SHOCK_COOLDOWN },
  palette: { ball: '#f5d129', text: '#ffffff', accent: '#facc15' },
  mirrorPalette: { ball: '#a16207', text: '#fef9c3', accent: '#eab308' },
  create: (w, b) => new ElectricAbility(w, b),
  drawPortrait: drawElectricPortrait,
}
