import { type Vec, angleDiff, angleOf, clamp, damp, fromAngle, len, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import type { World } from '../engine/World'
import type { BallContact, DamageOptions } from '../engine/types'
import { drawFangs } from '../render/draw'
import type { CharacterDef } from './types'

/** How long one latch lasts (s). */
export const LATCH_DURATION = 2.0
export const BITE_INTERVAL = 0.42
export const BITE_DAMAGE = 3
/** Cooldown after letting go before the vampire can latch again (s). */
const LATCH_COOLDOWN = 1.0
/** Fangs must face the prey within this angle for a contact to become a latch. */
const FANG_ARC = (100 * Math.PI) / 180
/** Knockback strong enough to tear the vampire off its prey. */
const DETACH_KNOCK = 150
/** Crawl speed around the prey while latched (rad/s). */
const CRAWL_SPEED = 0.9

/**
 * 吸血鬼 — latches onto the enemy with its fangs, rides along with it and
 * drains HP on every bite. Healing is uncapped, so a vampire can climb
 * above its starting HP.
 */
export class VampireAbility extends Ability {
  private facing: number
  private prey: Ball | null = null
  private latchTimer = 0
  private biteTimer = 0
  private cooldown = 0
  private latchAngle = 0
  private crawlDir: 1 | -1 = 1
  private biteFlash = 0

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.facing = angleOf(owner.vel)
  }

  get latched(): boolean {
    return this.prey !== null
  }

  override prePhysics(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.biteFlash = Math.max(0, this.biteFlash - dt)
    // Fangs turn with the vampire's own motion; being carried by someone else (drilled, hooked…) doesn't count.
    if (!this.prey && !this.owner.attachedTo) {
      this.facing = lerpAngle(this.facing, angleOf(this.owner.vel), damp(9, dt))
    }
  }

  override update(dt: number): void {
    const prey = this.prey
    if (!prey) return
    // Can't drink from a shielded target.
    if (!prey.alive || prey.invulnerable || !this.world.combatActive) {
      this.release()
      return
    }
    this.latchTimer -= dt
    this.latchAngle += CRAWL_SPEED * this.crawlDir * dt
    this.placeOnPrey(prey, dt)

    this.biteTimer -= dt
    if (this.biteTimer <= 0) {
      this.biteTimer += BITE_INTERVAL
      this.bite(prey)
    }
    if (this.prey && this.latchTimer <= 0) this.release()
  }

  override onBallContact(c: BallContact): void {
    if (this.prey || this.cooldown > 0 || this.owner.disarmed || !this.world.combatActive) return
    const target = c.other
    // Two vampires can't both hang onto each other.
    if (target.attachedTo === this.owner || target.invulnerable) return
    if (Math.abs(angleDiff(this.facing, angleOf(c.normal))) > FANG_ARC) return
    this.latch(target)
  }

  override onOwnerDamaged(_amount: number, opts: DamageOptions): void {
    if (!this.prey || !opts.knock) return
    if (len(opts.knock) < DETACH_KNOCK) return
    this.release()
    // The knock was ignored while pinned; apply it now that we're free.
    this.owner.vel.x += opts.knock.x
    this.owner.vel.y += opts.knock.y
  }

  override collidesWith(other: Ball): boolean {
    return other !== this.prey
  }

  private latch(target: Ball): void {
    const o = this.owner
    this.prey = target
    o.pinned = true
    o.attachedTo = target
    this.latchAngle = Math.atan2(o.pos.y - target.pos.y, o.pos.x - target.pos.x)
    this.latchTimer = LATCH_DURATION
    this.biteTimer = 0.1
    this.crawlDir = this.world.rng.sign()
    this.world.sound('bite', 0.6, 0.8)
  }

  private release(): void {
    const prey = this.prey
    const o = this.owner
    this.prey = null
    o.pinned = false
    o.attachedTo = null
    this.cooldown = LATCH_COOLDOWN
    const away = fromAngle(this.latchAngle)
    const carry: Vec = prey ? { x: prey.vel.x * 0.3, y: prey.vel.y * 0.3 } : { x: 0, y: 0 }
    o.vel = { x: carry.x + away.x * o.baseSpeed * 1.25, y: carry.y + away.y * o.baseSpeed * 1.25 }
    // Step clear of the prey so the next contact is a fresh one.
    o.pos.x += away.x * 5
    o.pos.y += away.y * 5
    this.facing = angleOf(o.vel)
  }

  private placeOnPrey(prey: Ball, dt: number): void {
    const o = this.owner
    const s = this.world.size
    const r = o.radius
    const reach = prey.radius + r - 4
    let x = prey.pos.x + Math.cos(this.latchAngle) * reach
    let y = prey.pos.y + Math.sin(this.latchAngle) * reach
    if (x < r || x > s - r || y < r || y > s - r) {
      // Crawl around towards the open side instead of clipping into a wall.
      const toCenter = Math.atan2(s / 2 - prey.pos.y, s / 2 - prey.pos.x)
      this.latchAngle = lerpAngle(this.latchAngle, toCenter, damp(12, dt))
      x = clamp(prey.pos.x + Math.cos(this.latchAngle) * reach, r, s - r)
      y = clamp(prey.pos.y + Math.sin(this.latchAngle) * reach, r, s - r)
    }
    o.pos.x = x
    o.pos.y = y
    o.vel.x = prey.vel.x
    o.vel.y = prey.vel.y
    this.facing = this.latchAngle + Math.PI
  }

  private bite(prey: Ball): void {
    const o = this.owner
    const at = {
      x: o.pos.x + Math.cos(this.facing) * o.radius,
      y: o.pos.y + Math.sin(this.facing) * o.radius,
    }
    const dealt = this.world.damage(prey, BITE_DAMAGE, { kind: 'bite', source: o, at })
    if (dealt > 0) {
      this.world.heal(o, dealt)
      this.world.sound('heal', 0.4)
      this.biteFlash = 0.15
    }
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const fangLen = this.prey ? 7 + this.biteFlash * 30 : 10
    drawFangs(ctx, o.pos.x, o.pos.y, o.radius, this.facing, fangLen)
    if (this.prey) {
      const pulse = 0.55 + 0.35 * Math.sin(this.world.time * 18)
      ctx.save()
      ctx.strokeStyle = `rgba(125,190,255,${pulse})`
      ctx.lineWidth = 3
      ctx.shadowColor = '#60a5fa'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, o.radius + 3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }
}

export function drawVampirePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  drawFangs(ctx, cx, cy, r, -0.4, r * 0.3)
}

export const vampireDef: CharacterDef = {
  id: 'vampire',
  name: '吸血鬼',
  nameEn: 'VAMPIRE',
  tagline: '咬住就不松口',
  rules: [
    `獠牙朝前撞到敌人时咬住对方，跟随移动 ${LATCH_DURATION} 秒`,
    `每 ${BITE_INTERVAL} 秒吸血一次：敌人 -${BITE_DAMAGE}，自己 +${BITE_DAMAGE}`,
    '回血没有上限，血量可以超过 100',
    '被强力击退会被甩开',
  ],
  palette: { ball: '#8e1b1b', text: '#ffffff', accent: '#c62828' },
  mirrorPalette: { ball: '#4a0d1f', text: '#fecdd3', accent: '#e11d48' },
  create: (w, b) => new VampireAbility(w, b),
  drawPortrait: drawVampirePortrait,
}
