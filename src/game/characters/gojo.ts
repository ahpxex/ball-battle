import * as dm from '../core/dmath'
import type { Vec } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import type { WallBounce } from '../engine/types'
import type { CharacterDef } from './types'

export type OrbKind = 'blue' | 'red' | 'purple'

interface OrbSpec {
  radius: number
  speed: number
  color: string
  glow: string
  /** Spawn weight. */
  weight: number
  /** Seconds before the orb fades away on its own. */
  lifetime: number
}

export const ORBS: Record<OrbKind, OrbSpec> = {
  blue: { radius: 15, speed: 290, color: '#2d9edb', glow: '#67e8f9', weight: 0.5, lifetime: 8 },
  red: { radius: 16, speed: 290, color: '#e14c48', glow: '#fca5a5', weight: 0.32, lifetime: 8 },
  purple: { radius: 22, speed: 170, color: '#a23bd3', glow: '#e879f9', weight: 0.18, lifetime: 7 },
}
export const RED_DAMAGE = 7
export const PURPLE_DAMAGE = 15
export const BLUE_TICK_DAMAGE = 1
const BLUE_TICK_INTERVAL = 0.4
/** Blue orbs latch a tether onto an enemy within this centre distance. */
const BLUE_RANGE = BALL_RADIUS * 5.2
const MAX_BLUE = 6
/** Minimum time between two orb spawns (s). */
const SPAWN_SPACING = 0.6

interface Orb {
  kind: OrbKind
  pos: Vec
  vel: Vec
  age: number
  tick: number
}

/**
 * 五条悟 — every wall bounce releases a cursed-technique orb that bounces
 * around the arena on its own. Blue ("苍") lingers and leeches the enemy
 * through a tether while close; red ("赫") explodes on contact; the rare
 * slow purple ("茈") hits hardest.
 */
export class GojoAbility extends Ability {
  private orbs: Orb[] = []
  private sinceSpawn = SPAWN_SPACING

  override onWallBounce(e: WallBounce): void {
    if (this.sinceSpawn < SPAWN_SPACING || this.owner.disarmed || !this.world.combatActive) return
    this.sinceSpawn = 0
    const rng = this.world.rng
    const roll = rng.next()
    const kind: OrbKind = roll < ORBS.blue.weight ? 'blue' : roll < ORBS.blue.weight + ORBS.red.weight ? 'red' : 'purple'
    if (kind === 'blue') {
      const blues = this.orbs.filter((o) => o.kind === 'blue')
      if (blues.length >= MAX_BLUE) this.orbs.splice(this.orbs.indexOf(blues[0]), 1)
    }
    // Launch away from the wall that was hit, within a random cone.
    const base = dm.atan2(e.normal.y, e.normal.x)
    const a = base + rng.range(-1.1, 1.1)
    const sp = ORBS[kind].speed
    this.orbs.push({
      kind,
      pos: { x: this.owner.pos.x, y: this.owner.pos.y },
      vel: { x: dm.cos(a) * sp, y: dm.sin(a) * sp },
      age: 0,
      tick: BLUE_TICK_INTERVAL,
    })
    this.world.effects.burst(this.owner.pos, { count: 10, color: [ORBS[kind].glow, '#ffffff'], speed: [40, 160], size: [2, 4], life: [0.25, 0.5] })
    this.world.sound('place', 0.45, kind === 'purple' ? 0.6 : kind === 'red' ? 0.9 : 1.3)
  }

  override update(dt: number): void {
    this.sinceSpawn += dt
    const s = this.world.size
    const e = this.enemy
    const kept: Orb[] = []
    for (const o of this.orbs) {
      const spec = ORBS[o.kind]
      o.age += dt
      o.pos.x += o.vel.x * dt
      o.pos.y += o.vel.y * dt
      const r = spec.radius
      if (o.pos.x < r && o.vel.x < 0) o.vel.x = -o.vel.x
      else if (o.pos.x > s - r && o.vel.x > 0) o.vel.x = -o.vel.x
      if (o.pos.y < r && o.vel.y < 0) o.vel.y = -o.vel.y
      else if (o.pos.y > s - r && o.vel.y > 0) o.vel.y = -o.vel.y

      if (e.alive && this.world.combatActive) {
        const d = dm.hypot(e.pos.x - o.pos.x, e.pos.y - o.pos.y)
        if (o.kind === 'blue') {
          if (d < BLUE_RANGE) {
            o.tick -= dt
            if (o.tick <= 0) {
              o.tick += BLUE_TICK_INTERVAL
              this.world.damage(e, BLUE_TICK_DAMAGE, { kind: 'cursed', source: this.owner, at: e.pos })
            }
          } else {
            o.tick = Math.min(o.tick, BLUE_TICK_INTERVAL)
          }
        } else if (d < e.radius + r) {
          const dmg = o.kind === 'red' ? RED_DAMAGE : PURPLE_DAMAGE
          const n = { x: (e.pos.x - o.pos.x) / (d || 1), y: (e.pos.y - o.pos.y) / (d || 1) }
          this.world.effects.burst(o.pos, { count: o.kind === 'purple' ? 26 : 16, color: [spec.color, spec.glow, '#ffffff'], speed: [80, 360], size: [2, 5], life: [0.3, 0.7] })
          this.world.damage(e, dmg, { kind: 'cursed', source: this.owner, at: o.pos, knock: { x: n.x * 160, y: n.y * 160 }, shake: o.kind === 'purple' ? 6 : 3 })
          continue
        }
      }
      if (o.age < spec.lifetime) kept.push(o)
    }
    this.orbs = kept
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const e = this.enemy
    if (!e.alive) return
    // Twin wavy tethers from each nearby blue orb to the enemy.
    ctx.save()
    ctx.strokeStyle = 'rgba(186,230,253,0.75)'
    ctx.lineWidth = 1.3
    const t = this.world.time
    for (const o of this.orbs) {
      if (o.kind !== 'blue') continue
      const dx = e.pos.x - o.pos.x
      const dy = e.pos.y - o.pos.y
      const d = dm.hypot(dx, dy)
      if (d >= BLUE_RANGE) continue
      ctx.globalAlpha = fade * (1 - d / BLUE_RANGE) * 0.9 + 0.1
      const nx = -dy / (d || 1)
      const ny = dx / (d || 1)
      for (const phase of [0, Math.PI]) {
        ctx.beginPath()
        for (let i = 0; i <= 12; i++) {
          const u = i / 12
          const wob = dm.sin(u * Math.PI * 3 + t * 14 + phase) * 4 * dm.sin(u * Math.PI)
          const x = o.pos.x + dx * u + nx * wob
          const y = o.pos.y + dy * u + ny * wob
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    for (const o of this.orbs) {
      const spec = ORBS[o.kind]
      const life = Math.min(1, (spec.lifetime - o.age) / 0.4, o.age / 0.15)
      ctx.save()
      ctx.globalAlpha = fade * Math.max(0, life)
      drawOrb(ctx, o.pos.x, o.pos.y, spec.radius, spec.color, spec.glow)
      ctx.restore()
    }
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawGojoFace(ctx, o.pos.x, o.pos.y, o.radius)
  }
}

export function drawOrb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, glow: string): void {
  ctx.save()
  ctx.shadowColor = glow
  ctx.shadowBlur = r * 0.9
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.25, glow)
  g.addColorStop(1, color)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Spiky white hair on top and a dark blindfold across the middle. */
export function drawGojoFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = '#1e1b4b'
  ctx.fillRect(x - r, y - r * 0.24, r * 2, r * 0.48)
  ctx.restore()
  ctx.save()
  ctx.fillStyle = '#f1f0ff'
  ctx.beginPath()
  const spikes = 7
  ctx.moveTo(x - r * 0.95, y - r * 0.3)
  for (let i = 0; i <= spikes; i++) {
    const a = Math.PI + (i / spikes) * Math.PI
    const tipR = r * (1.32 + (i % 2) * 0.12)
    const valleyA = a + Math.PI / spikes / 2
    ctx.lineTo(x + dm.cos(a) * tipR, y + dm.sin(a) * tipR - r * 0.05)
    if (i < spikes) ctx.lineTo(x + dm.cos(valleyA) * r * 0.92, y + dm.sin(valleyA) * r * 0.92)
  }
  ctx.lineTo(x + r * 0.95, y - r * 0.3)
  ctx.quadraticCurveTo(x, y - r * 0.55, x - r * 0.95, y - r * 0.3)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export function drawGojoPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawOrb(ctx, cx - r * 1.7, cy - r * 1.3, r * 0.42, ORBS.blue.color, ORBS.blue.glow)
  drawOrb(ctx, cx + r * 1.7, cy - r * 1.1, r * 0.45, ORBS.red.color, ORBS.red.glow)
  drawOrb(ctx, cx + r * 1.2, cy + r * 1.6, r * 0.6, ORBS.purple.color, ORBS.purple.glow)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy + r * 0.2, r, 0, Math.PI * 2)
  ctx.fill()
  drawGojoFace(ctx, cx, cy + r * 0.2, r)
}

export const gojoDef: CharacterDef = {
  id: 'gojo',
  nameEn: 'GOJO',
  ruleValues: { blueTickDamage: BLUE_TICK_DAMAGE, redDamage: RED_DAMAGE, purpleDamage: PURPLE_DAMAGE },
  palette: { ball: '#fed989', text: '#ffffff', accent: '#fed989' },
  mirrorPalette: { ball: '#d6b4f5', text: '#ffffff', accent: '#c084fc' },
  create: (w, b) => new GojoAbility(w, b),
  drawPortrait: drawGojoPortrait,
}
