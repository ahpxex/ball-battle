import * as dm from '../core/dmath'
import { type Vec, clamp } from '../core/vec'
import type { Ball } from '../engine/Ball'
import type { DamageKind } from '../engine/types'
import type { World } from '../engine/World'

/**
 * A small summoned unit that chases the enemy ball and hurts it on touch.
 * Minions are owned and simulated by an ability; they are not targetable by
 * other abilities.
 */
export interface Minion {
  pos: Vec
  vel: Vec
  radius: number
  /** Remaining life in seconds (also shown as the minion's HP). */
  life: number
  maxLife: number
  /** Per-minion contact cooldown. */
  cooldown: number
  age: number
}

export interface SwarmConfig {
  speed: number
  /** Max steering rate (rad/s). */
  turnRate: number
  contactDamage: number
  contactCooldown: number
  kind: DamageKind
  /** Seconds before a new minion can act (spawn pop-in). */
  spawnDelay: number
  /** Push applied to the enemy on each hit. */
  knock?: number
}

/** Shared chase-and-stab behaviour for summoned minions. */
export class Swarm {
  readonly minions: Minion[] = []
  private readonly config: SwarmConfig

  constructor(config: SwarmConfig) {
    this.config = config
  }

  spawn(pos: Vec, radius: number, life: number, heading: number): void {
    const s = this.config.speed
    this.minions.push({
      pos: { x: pos.x, y: pos.y },
      vel: { x: dm.cos(heading) * s, y: dm.sin(heading) * s },
      radius,
      life,
      maxLife: life,
      cooldown: this.config.spawnDelay,
      age: 0,
    })
  }

  update(world: World, owner: Ball, target: Ball, dt: number): void {
    const c = this.config
    const size = world.size
    const kept: Minion[] = []
    for (const m of this.minions) {
      m.age += dt
      m.life -= dt
      m.cooldown = Math.max(0, m.cooldown - dt)
      if (m.life <= 0) continue
      kept.push(m)
      if (m.age < c.spawnDelay) continue
      if (target.alive) {
        const want = dm.atan2(target.pos.y - m.pos.y, target.pos.x - m.pos.x)
        const cur = dm.atan2(m.vel.y, m.vel.x)
        let diff = want - cur
        while (diff > Math.PI) diff -= Math.PI * 2
        while (diff < -Math.PI) diff += Math.PI * 2
        const a = cur + clamp(diff, -c.turnRate * dt, c.turnRate * dt)
        m.vel = { x: dm.cos(a) * c.speed, y: dm.sin(a) * c.speed }
      }
      m.pos.x = clamp(m.pos.x + m.vel.x * dt, m.radius, size - m.radius)
      m.pos.y = clamp(m.pos.y + m.vel.y * dt, m.radius, size - m.radius)
      if (!target.alive || !world.combatActive || m.cooldown > 0) continue
      const reach = target.radius + m.radius
      const dx = target.pos.x - m.pos.x
      const dy = target.pos.y - m.pos.y
      if (dx * dx + dy * dy >= reach * reach) continue
      m.cooldown = c.contactCooldown
      const d = dm.hypot(dx, dy) || 1
      const k = c.knock ?? 0
      world.damage(target, c.contactDamage, {
        kind: c.kind,
        source: owner,
        at: { x: m.pos.x + (dx / d) * m.radius, y: m.pos.y + (dy / d) * m.radius },
        knock: k > 0 ? { x: (dx / d) * k, y: (dy / d) * k } : undefined,
      })
      // Bounce off the target so the swarm doesn't stack on one spot.
      m.vel = { x: (-dx / d) * c.speed, y: (-dy / d) * c.speed }
    }
    this.minions.length = 0
    this.minions.push(...kept)
  }
}
