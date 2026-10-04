import * as dm from '../core/dmath'
import { angleDiff, clamp, fromAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS, BASE_SPEED } from '../engine/constants'
import type { BallContact, DamageOptions, WallBounce } from '../engine/types'
import type { World } from '../engine/World'
import { PIXEL_FONT } from '../render/draw'
// Circular import (the registry lists the thief): only read inside methods, never at module load.
import { CHARACTERS, getCharacter } from './registry'
import type { CharacterDef } from './types'

/** Contact hit dealt by the steal itself. */
export const STEAL_DAMAGE = 5
/** How long the thief keeps a stolen ability after its last steal (s). Robbing the same character again only extends it. */
export const LOOT_TIME = 5.5
/** How long a robbed enemy is disarmed (s). */
export const DISARM_TIME = 2
/** Time between two steals, counted from the previous one (s). */
export const STEAL_COOLDOWN = 4
/** While a steal is ready, the thief stalks the enemy, turning towards it this fast (°/s). */
export const STALK_TURN_DEG = 90
const STALK_TURN = (STALK_TURN_DEG * Math.PI) / 180
/** Retry delay after bumping into an invulnerable enemy (s). */
const BLOCKED_RETRY = 0.5
/** How long the stolen character's name floats above the thief (s). */
const NAME_SHOW = 1.1

const GOLD = '#facc15'
const MASK = '#0b0b14'

/** Abilities that are running another character's ability expose it, so a thief takes that instead. */
export interface BorrowedAbility {
  readonly borrowedCharacter: CharacterDef | null
}

function borrowedCharacterOf(a: Ability): CharacterDef | null {
  return 'borrowedCharacter' in a ? (a as unknown as BorrowedAbility).borrowedCharacter : null
}

/** Characters that wear other characters' abilities: stealing theirs would nest thieves inside thieves. */
function isShapeshifter(id: CharacterDef['id']): boolean {
  return id === 'thief' || id === 'mimic'
}

/**
 * 窃贼 — has no weapon of its own. Bumping into the enemy steals its
 * ability: the thief runs a fresh copy of it for a few seconds while the
 * victim is disarmed for the same time. From a thief it snatches the loot
 * it is carrying; from a mimic (or an empty-handed thief) it grabs a random
 * disguise.
 */
export class ThiefAbility extends Ability implements BorrowedAbility {
  private loot: Ability | null = null
  private lootDef: CharacterDef | null = null
  private lootTimer = 0
  private cooldown = 0
  private readonly baseColor: string
  private readonly baseText: string
  /** World time of the last successful steal (visuals). */
  private stoleAt = -Infinity

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.baseColor = owner.color
    this.baseText = owner.textColor
  }

  get borrowedCharacter(): CharacterDef | null {
    return this.lootDef
  }

  /** Random disguises: anyone who isn't a shapeshifter. */
  private get pool(): readonly CharacterDef[] {
    return CHARACTERS.filter((c) => !isShapeshifter(c.id))
  }

  private get ready(): boolean {
    return this.cooldown <= 0 && !this.owner.disarmed
  }

  // ───────────────────────────── simulation ─────────────────────────────

  override prePhysics(dt: number): void {
    this.loot?.prePhysics(dt)
    this.stalk(dt)
  }

  /** Curves the thief's path towards its mark while a steal is ready. */
  private stalk(dt: number): void {
    const o = this.owner
    const e = this.enemy
    if (!this.ready || !this.world.combatActive || !e.alive || !o.movable || o.attachedTo) return
    const speed = dm.hypot(o.vel.x, o.vel.y)
    if (speed < 1e-3) return
    const heading = dm.atan2(o.vel.y, o.vel.x)
    const turn = clamp(angleDiff(heading, dm.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)), -STALK_TURN * dt, STALK_TURN * dt)
    o.vel = fromAngle(heading + turn, speed)
  }

  override update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt)
    if (!this.loot) return
    this.lootTimer -= dt
    this.loot.update(dt)
    if (this.lootTimer <= 0) this.dropLoot()
  }

  override onWallBounce(e: WallBounce): void {
    this.loot?.onWallBounce(e)
  }

  override onBallContact(c: BallContact): void {
    this.loot?.onBallContact(c)
    this.trySteal(c)
  }

  override onOwnerDamaged(amount: number, opts: DamageOptions): void {
    this.loot?.onOwnerDamaged(amount, opts)
  }

  override get outgoingDamageScale(): number {
    return this.loot ? this.loot.outgoingDamageScale : 1
  }

  override collidesWith(other: Ball): boolean {
    return this.loot ? this.loot.collidesWith(other) : true
  }

  private trySteal(c: BallContact): void {
    const o = this.owner
    const e = this.enemy
    if (c.other !== e || !e.alive || !this.world.combatActive || !this.ready) return
    if (e.invulnerable) {
      // Nothing to grab through a shield: sparks, and a short wait before trying again.
      this.cooldown = BLOCKED_RETRY
      this.world.effects.burst(c.point, { count: 8, color: ['#bfdbfe', '#ffffff', GOLD], shape: 'spark', speed: [80, 220], size: [1.5, 3], life: [0.15, 0.3] })
      this.world.sound('clack', 0.5, 1.6)
      return
    }
    const def = this.pickLoot(e)
    this.cooldown = STEAL_COOLDOWN
    // The victim is robbed first, so it can't answer this same bump with its own ability.
    e.applyDisarm(DISARM_TIME)
    // The engine scales every hit by outgoingDamageScale; the steal hit itself is never discounted.
    this.world.damage(e, STEAL_DAMAGE / this.outgoingDamageScale, { kind: 'steal', source: o, at: c.point, shake: 3 })
    this.takeLoot(def, e)
  }

  /** What the thief gets from `victim`. */
  private pickLoot(victim: Ball): CharacterDef {
    const ability = this.world.abilityOf(victim)
    let def = borrowedCharacterOf(ability)
    // A robbed thief loses what it was carrying.
    if (ability instanceof ThiefAbility && ability !== this && ability.loot) ability.dropLoot()
    if (!def && !isShapeshifter(victim.charId)) def = getCharacter(victim.charId)
    if (!def || isShapeshifter(def.id)) def = this.world.rng.pick(this.pool)
    return def
  }

  private takeLoot(def: CharacterDef, victim: Ball): void {
    const o = this.owner
    this.lootTimer = LOOT_TIME
    const fx = this.world.effects
    if (this.loot && this.lootDef?.id === def.id) {
      // Same ability again: keep using it (with everything it has set up), just for longer.
      fx.burst(victim.pos, {
        count: 8,
        color: [GOLD, '#fde68a'],
        shape: 'spark',
        speed: [160, 360],
        size: [1.5, 3.5],
        life: [0.2, 0.4],
        direction: dm.atan2(o.pos.y - victim.pos.y, o.pos.x - victim.pos.x),
        spread: 0.5,
      })
      this.world.sound('disarm', 0.45, 1.35)
      return
    }
    if (this.loot) this.dropLoot()
    this.lootDef = def
    this.loot = def.create(this.world, o)
    this.lootTimer = LOOT_TIME
    this.stoleAt = this.world.time
    // Gold flies from the victim into the thief's pocket.
    const dx = o.pos.x - victim.pos.x
    const dy = o.pos.y - victim.pos.y
    fx.burst(victim.pos, {
      count: 14,
      color: [GOLD, '#fde68a', '#ffffff'],
      shape: 'spark',
      speed: [180, 420],
      size: [2, 4],
      life: [0.25, 0.5],
      direction: dm.atan2(dy, dx),
      spread: 0.45,
      jitter: victim.radius * 0.4,
    })
    fx.burst(o.pos, { count: 18, color: [def.palette.accent, def.palette.ball, '#ffffff'], speed: [70, 230], size: [2, 4.5], life: [0.3, 0.6] })
    fx.burst(o.pos, { count: 1, color: def.palette.accent, shape: 'ring', speed: [0, 0], size: [o.radius, o.radius], life: [0.35, 0.35], endScale: 2 })
    this.world.sound('disarm', 0.6, 1.2)
    this.world.sound('jackpot', 0.4, 1.1)
  }

  /** Ends the current loot and undoes every lasting change it made to either ball. */
  private dropLoot(): void {
    const o = this.owner
    const e = this.enemy
    o.pinned = false
    o.invulnerable = false
    o.attachedTo = null
    o.baseSpeed = BASE_SPEED
    // Some abilities resize the ball (puffer, snowball): back to normal, still inside the arena.
    o.radius = BALL_RADIUS
    o.mass = 1
    const size = this.world.size
    o.pos.x = clamp(o.pos.x, o.radius, size - o.radius)
    o.pos.y = clamp(o.pos.y, o.radius, size - o.radius)
    o.color = this.baseColor
    o.textColor = this.baseText
    if (e.attachedTo === o) e.attachedTo = null
    e.opacity = 1
    e.drawScale = 1
    if (e.rooted) e.endRoot()
    const def = this.lootDef
    this.loot = null
    this.lootDef = null
    this.lootTimer = 0
    if (def)
      this.world.effects.burst(o.pos, {
        count: 12,
        color: [def.palette.accent, '#94a3b8'],
        shape: 'smoke',
        speed: [30, 120],
        size: [4, 8],
        life: [0.3, 0.6],
        endScale: 1.6,
      })
  }

  // ───────────────────────────── rendering ─────────────────────────────

  override renderBack(ctx: CanvasRenderingContext2D): void {
    this.loot?.renderBack(ctx)
  }

  override renderOverlay(ctx: CanvasRenderingContext2D): void {
    this.loot?.renderOverlay(ctx)
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    if (this.lootDef) {
      // Glow in the stolen character's colour.
      const g = ctx.createRadialGradient(o.pos.x, o.pos.y, o.radius * 0.8, o.pos.x, o.pos.y, o.radius * 1.55)
      g.addColorStop(0, this.lootDef.palette.accent)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.save()
      ctx.globalAlpha *= 0.45
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, o.radius * 1.55, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    this.loot?.renderUnderBall(ctx)
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    this.loot?.renderOverBall(ctx)
    const o = this.owner
    const e = this.enemy
    const look = dm.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)
    drawMask(ctx, o.pos.x, o.pos.y, o.radius, look, this.world.time, this.ready ? 1 : 0)
    ctx.save()
    if (this.lootDef) {
      // Stolen character's colours as a two-tone ring; the bright arc is the time left.
      const r = o.radius + 4.5
      ctx.lineWidth = 4
      ctx.strokeStyle = this.lootDef.palette.ball
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = this.lootDef.palette.accent
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, r, -Math.PI / 2, -Math.PI / 2 + clamp(this.lootTimer / LOOT_TIME, 0, 1) * Math.PI * 2)
      ctx.stroke()
    } else if (this.cooldown > 0) {
      // Recharging: a faint gold arc filling up.
      ctx.lineWidth = 2
      ctx.strokeStyle = GOLD
      ctx.globalAlpha = 0.35
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, o.radius + 3.5, -Math.PI / 2, -Math.PI / 2 + (1 - this.cooldown / STEAL_COOLDOWN) * Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    this.loot?.renderFront(ctx)
    const def = this.lootDef
    const age = this.world.time - this.stoleAt
    if (!def || age >= NAME_SHOW || this.presence <= 0) return
    // The stolen character's name pops up over the thief.
    const o = this.owner
    const k = age / NAME_SHOW
    ctx.save()
    ctx.globalAlpha = this.presence * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3)
    ctx.font = `700 15px ${PIXEL_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const y = o.pos.y - o.radius - 18 - k * 14
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'
    ctx.strokeText(def.nameEn, o.pos.x, y)
    ctx.fillStyle = def.palette.accent
    ctx.fillText(def.nameEn, o.pos.x, y)
    ctx.restore()
  }
}

/**
 * Bandit mask across the upper half of the ball, eyes looking towards
 * `look`; `glint` lights the eyes gold when a steal is ready.
 */
function drawMask(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, look: number, time: number, glint: number): void {
  const top = cy - r * 0.78
  const bottom = cy - r * 0.42
  ctx.save()
  // Knot tails fluttering behind the head (to the right of the band).
  const flap = dm.sin(time * 9) * r * 0.08
  ctx.fillStyle = MASK
  // A faint edge keeps the black tails readable against the dark arena.
  ctx.strokeStyle = 'rgba(148,163,184,0.5)'
  ctx.lineWidth = 1.2
  for (const [dy, len] of [
    [-0.08, 0.62],
    [0.1, 0.5],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(cx + r * 0.82, (top + bottom) / 2 - r * 0.06)
    ctx.quadraticCurveTo(cx + r * (0.82 + len * 0.6), (top + bottom) / 2 + r * dy + flap, cx + r * (0.82 + len), (top + bottom) / 2 + r * dy * 2.6 + flap * 1.6)
    ctx.lineTo(cx + r * (0.82 + len * 0.95), (top + bottom) / 2 + r * dy * 2.6 + flap * 1.6 + r * 0.12)
    ctx.quadraticCurveTo(cx + r * (0.82 + len * 0.5), (top + bottom) / 2 + r * dy + flap + r * 0.1, cx + r * 0.8, (top + bottom) / 2 + r * 0.08)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  // The band, clipped to the ball.
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.beginPath()
  ctx.moveTo(cx - r, top + r * 0.04)
  ctx.quadraticCurveTo(cx, top - r * 0.08, cx + r, top + r * 0.04)
  ctx.lineTo(cx + r, bottom)
  ctx.quadraticCurveTo(cx, bottom + r * 0.1, cx - r, bottom)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  // Eye holes with pupils following the enemy.
  const ex = r * 0.34
  const ey = (top + bottom) / 2 + r * 0.01
  const px = dm.cos(look) * r * 0.06
  const py = dm.sin(look) * r * 0.04
  ctx.save()
  for (const side of [-1, 1]) {
    const x = cx + side * ex
    ctx.fillStyle = '#f8fafc'
    ctx.beginPath()
    ctx.ellipse(x, ey, r * 0.15, r * 0.1, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = glint > 0 ? '#a16207' : '#111827'
    ctx.beginPath()
    ctx.arc(x + px, ey + py, r * 0.07, 0, Math.PI * 2)
    ctx.fill()
    if (glint > 0) {
      ctx.fillStyle = GOLD
      ctx.beginPath()
      ctx.arc(x + px - r * 0.02, ey + py - r * 0.025, r * 0.03, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

export function drawThiefPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // Loot sack with gold coins spilling out, slung behind the ball.
  const sx = cx + r * 1.05
  const sy = cy + r * 0.85
  ctx.fillStyle = '#92643a'
  ctx.beginPath()
  ctx.moveTo(sx - r * 0.2, sy - r * 0.55)
  ctx.quadraticCurveTo(sx - r * 0.95, sy - r * 0.1, sx - r * 0.6, sy + r * 0.55)
  ctx.quadraticCurveTo(sx, sy + r * 0.85, sx + r * 0.6, sy + r * 0.55)
  ctx.quadraticCurveTo(sx + r * 0.95, sy - r * 0.1, sx + r * 0.2, sy - r * 0.55)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#6b4423'
  ctx.fillRect(sx - r * 0.28, sy - r * 0.62, r * 0.56, r * 0.14)
  ctx.fillStyle = GOLD
  ctx.font = `700 ${Math.round(r * 0.6)}px ${PIXEL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('$', sx, sy + r * 0.15)
  for (const [dx, dy] of [
    [-1.55, 1.25],
    [-1.25, 1.5],
    [1.75, -0.35],
  ] as const) {
    ctx.fillStyle = GOLD
    ctx.beginPath()
    ctx.ellipse(cx + dx * r, cy + dy * r, r * 0.2, r * 0.13, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#a16207'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.2, cy - r * 0.1, r, 0, Math.PI * 2)
  ctx.fill()
  drawMask(ctx, cx - r * 0.2, cy - r * 0.1, r, Math.PI * 0.85, 0.3, 1)
}

export const thiefDef: CharacterDef = {
  id: 'thief',
  nameEn: 'THIEF',
  ruleValues: {
    stalkTurnDeg: STALK_TURN_DEG,
    stealDamage: STEAL_DAMAGE,
    disarmTime: DISARM_TIME,
    lootTime: LOOT_TIME,
    stealCooldown: STEAL_COOLDOWN,
  },
  palette: { ball: '#3b3b58', text: '#fde68a', accent: '#facc15' },
  mirrorPalette: { ball: '#1f1f2e', text: '#fef3c7', accent: '#eab308' },
  create: (w, b) => new ThiefAbility(w, b),
  drawPortrait: drawThiefPortrait,
}
