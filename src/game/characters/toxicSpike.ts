import * as dm from '../core/dmath'
import { distanceToTriangle } from '../core/geometry'
import { type Vec, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { WallBounce } from '../engine/types'
import { drawSpikeShape } from '../render/draw'
import type { CharacterDef } from './types'

const SPIKE_HEIGHT = 38
const SPIKE_HALF_WIDTH = 11
export const MAX_SPIKES = 22
const GROW_TIME = 0.18
export const SPIKE_DAMAGE = 3
/** Per-spike re-hit cooldown (s). */
const SPIKE_COOLDOWN = 0.6
export const POISON_TICKS = 3
export const MAX_POISON_STACKS = 6
const SPIKE_KNOCK = 240
/** Spikes evicted by the cap fade out over this long. */
const EVICT_FADE = 0.3

interface Spike {
  base: Vec
  normal: Vec
  /** Unit direction from base to tip (normal with a small tilt). */
  dir: Vec
  born: number
  lastHit: number
  /** World time the spike started fading out, or -1. */
  evicted: number
}

/**
 * 毒刺 — every wall bounce plants a poisoned spike where it hit. Enemies
 * touching a spike take damage and gain a stack of poison that keeps
 * ticking. Spikes stay for the rest of the fight, so the arena slowly
 * becomes a minefield.
 */
export class ToxicSpikeAbility extends Ability {
  private spikes: Spike[] = []

  override onWallBounce(e: WallBounce): void {
    if (this.owner.disarmed) return
    const tilt = this.world.rng.range(-0.28, 0.28)
    const c = dm.cos(tilt)
    const s = dm.sin(tilt)
    const n = e.normal
    this.spikes.push({
      base: { x: e.point.x, y: e.point.y },
      normal: { x: n.x, y: n.y },
      dir: { x: n.x * c - n.y * s, y: n.x * s + n.y * c },
      born: this.world.time,
      lastHit: -Infinity,
      evicted: -1,
    })
    const alive = this.spikes.filter((sp) => sp.evicted < 0)
    if (alive.length > MAX_SPIKES) alive[0].evicted = this.world.time

    this.world.effects.burst(
      { x: e.point.x + n.x * 10, y: e.point.y + n.y * 10 },
      { count: 8, color: ['#86efac', '#4ade80', '#a3e635'], shape: 'smoke', speed: [20, 90], size: [5, 10], life: [0.4, 0.8], endScale: 2, direction: dm.atan2(n.y, n.x), spread: 1.2 },
    )
    this.world.sound('place', 0.45, 1.2)
  }

  private geometry(sp: Spike): { tip: Vec; left: Vec; right: Vec } {
    const t = this.world.time
    const grow = clamp((t - sp.born) / GROW_TIME, 0, 1)
    const shrink = sp.evicted >= 0 ? clamp(1 - (t - sp.evicted) / EVICT_FADE, 0, 1) : 1
    const h = SPIKE_HEIGHT * grow * shrink
    const w = SPIKE_HALF_WIDTH * (0.4 + 0.6 * grow) * shrink
    // Tangent along the wall.
    const tx = -sp.normal.y
    const ty = sp.normal.x
    return {
      tip: { x: sp.base.x + sp.dir.x * h, y: sp.base.y + sp.dir.y * h },
      left: { x: sp.base.x + tx * w, y: sp.base.y + ty * w },
      right: { x: sp.base.x - tx * w, y: sp.base.y - ty * w },
    }
  }

  override update(): void {
    const now = this.world.time
    this.spikes = this.spikes.filter((sp) => sp.evicted < 0 || now - sp.evicted < EVICT_FADE)
    const enemy = this.enemy
    if (!enemy.alive) return
    for (const sp of this.spikes) {
      if (sp.evicted >= 0 || now - sp.born < GROW_TIME * 0.6) continue
      if (now - sp.lastHit < SPIKE_COOLDOWN) continue
      const g = this.geometry(sp)
      if (distanceToTriangle(enemy.pos, g.tip, g.left, g.right) >= enemy.radius) continue
      sp.lastHit = now
      const dealt = this.world.damage(enemy, SPIKE_DAMAGE, {
        kind: 'spike',
        source: this.owner,
        at: g.tip,
        knock: { x: sp.normal.x * SPIKE_KNOCK, y: sp.normal.y * SPIKE_KNOCK },
        shake: 2,
      })
      if (dealt > 0) enemy.applyPoison(POISON_TICKS, this.owner, MAX_POISON_STACKS)
    }
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const now = this.world.time
    for (const sp of this.spikes) {
      const g = this.geometry(sp)
      drawSpikeShape(ctx, g.tip, g.left, g.right, fade)
      // Brief glow after a successful prick.
      const glow = 1 - (now - sp.lastHit) / 0.35
      if (glow > 0) {
        ctx.save()
        ctx.globalAlpha = glow * fade
        ctx.fillStyle = '#d9f99d'
        ctx.beginPath()
        ctx.arc(g.tip.x, g.tip.y, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
  }
}

export function drawToxicSpikePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const floor = cy + r * 1.75
  for (const [dx, h] of [[-1.7, 0.8], [-0.95, 1.05], [1.0, 0.95], [1.65, 0.75]] as const) {
    const x = cx + dx * r
    drawSpikeShape(ctx, { x, y: floor - h * r }, { x: x - r * 0.28, y: floor }, { x: x + r * 0.28, y: floor })
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy - r * 0.15, r, 0, Math.PI * 2)
  ctx.fill()
}

export const toxicSpikeDef: CharacterDef = {
  id: 'toxicSpike',
  nameEn: 'TOXIC SPIKE',
  ruleValues: { spikeDamage: SPIKE_DAMAGE, poisonTicks: POISON_TICKS, maxPoisonStacks: MAX_POISON_STACKS, maxSpikes: MAX_SPIKES },
  palette: { ball: '#7cc520', text: '#ffffff', accent: '#84cc16' },
  mirrorPalette: { ball: '#166534', text: '#dcfce7', accent: '#22c55e' },
  create: (w, b) => new ToxicSpikeAbility(w, b),
  drawPortrait: drawToxicSpikePortrait,
}
