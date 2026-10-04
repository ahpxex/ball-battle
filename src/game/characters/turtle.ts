import * as dm from '../core/dmath'
import { angleDiff, clamp, damp, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS, BASE_SPEED } from '../engine/constants'
import type { BallContact, DamageOptions, WallBounce } from '../engine/types'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

const R = BALL_RADIUS

// ───────────────────────────── walking & biting ─────────────────────────────

/** Out of its shell the turtle plods along a little slower than other balls. */
const WALK_SPEED = BASE_SPEED * 0.9
export const BITE_DAMAGE = 5
/** Time between two bites (s). */
export const BITE_COOLDOWN = 0.9
/** The neck snaps out when the gap between both balls is at most this many ball radii. */
export const NECK_REACH_R = 1.5
const NECK_REACH = R * NECK_REACH_R
const BITE_EXTEND = 0.12
const BITE_RETRACT = 0.18
/** The bite connects if the enemy is still within reach and roughly ahead when the jaws close. */
const BITE_SLACK = R * 0.35
const BITE_CONE = 0.75
const BITE_KNOCK = 120
const HEAD_RADIUS = R * 0.34

// ───────────────────────────── shell ─────────────────────────────

/** Damage taken (outside the shell, off cooldown) that makes the turtle withdraw. */
export const SHELL_TRIGGER = 14
/** Time spent inside the shell (s). */
export const SHELL_TIME = 2.6
/** Wait after popping out before damage starts counting towards the next withdrawal (s). */
export const SHELL_COOLDOWN = 4.0
/** Shell speed as a multiple of the normal ball speed. */
export const SHELL_SPEED_X = 2
const SHELL_SPEED = BASE_SPEED * SHELL_SPEED_X
export const SHELL_DAMAGE = 9
/** Minimum gap between two shell hits on the enemy (s). */
export const SHELL_HIT_COOLDOWN = 0.5
const SHELL_KNOCK = 420
/** Cosmetic spin of the shell (rad/s). */
const SHELL_SPIN = 16
/** Cosmetic: limbs pull in / pop out over this long (s). */
const TUCK_TIME = 0.14
const AFTERIMAGE_SPAN = 0.14

const SKIN = '#a3cf6e'
const SKIN_DARK = '#3d6b25'
const SCUTE_LINE = 'rgba(22,66,32,0.75)'
const SCUTE_FILL = 'rgba(126,200,120,0.28)'

type Bite = 'idle' | 'extend' | 'retract'

/**
 * 乌龟 TURTLE — plods around and snaps its neck out to bite enemies that
 * come close. Once it has taken enough damage it withdraws into its shell:
 * invulnerable, the shell spins and shoots off towards the enemy at double
 * speed, ricocheting around the arena and slamming anything it hits, until
 * the turtle pops back out a few seconds later.
 */
export class TurtleAbility extends Ability {
  private shellLeft = 0
  private shellCooldown = 0
  /** Damage taken since the shell was last ready. */
  private hurt = 0
  private lastShellHit = -Infinity
  private bite: Bite = 'idle'
  private biteT = 0
  private biteCooldown = 0.6
  private biteAim = 0
  /** Whether the current bite connected (cosmetic: the jaws clamp shut). */
  private biteHit = false
  // Cosmetic state.
  private look: number
  private paddle = 0
  private spin = 0
  private tuck = 0
  private trail: { x: number; y: number; t: number }[] = []

  constructor(world: World, owner: Ball) {
    super(world, owner)
    owner.baseSpeed = WALK_SPEED
    this.look = dm.atan2(owner.vel.y, owner.vel.x)
  }

  private get inShell(): boolean {
    return this.shellLeft > 0
  }

  override prePhysics(_dt: number): void {
    if (!this.inShell) return
    // A hard shell ricochets at full speed instead of slowing down after impacts.
    const o = this.owner
    if (!o.movable || o.attachedTo) return
    const speed = dm.hypot(o.vel.x, o.vel.y)
    if (speed < 1) return
    const target = o.baseSpeed * o.speedFactor
    o.vel.x = (o.vel.x / speed) * target
    o.vel.y = (o.vel.y / speed) * target
  }

  override update(dt: number): void {
    const o = this.owner
    const now = this.world.time
    if (this.inShell) {
      this.shellLeft -= dt
      if (this.shellLeft <= 0) this.popOut()
    } else {
      this.shellCooldown = Math.max(0, this.shellCooldown - dt)
      if (this.shellCooldown <= 0 && this.hurt >= SHELL_TRIGGER && this.world.combatActive) this.withdraw()
    }
    if (!this.inShell) this.updateBite(dt)

    // Cosmetic.
    this.tuck = clamp(this.tuck + (this.inShell ? dt : -dt) / TUCK_TIME, 0, 1)
    const speed = dm.hypot(o.vel.x, o.vel.y)
    if (this.inShell) {
      this.spin += SHELL_SPIN * dt
    } else {
      if (speed > 1) this.look = lerpAngle(this.look, dm.atan2(o.vel.y, o.vel.x), damp(6, dt))
      this.paddle += dt * (4 + speed * 0.012)
    }
    if (!this.world.headless) {
      if (this.inShell) this.trail.push({ x: o.pos.x, y: o.pos.y, t: now })
      while (this.trail.length > 0 && now - this.trail[0].t > AFTERIMAGE_SPAN) this.trail.shift()
    }
  }

  override onOwnerDamaged(amount: number, _opts: DamageOptions): void {
    const o = this.owner
    if (o.hp <= 0) {
      // Dying (overtime drain): drop out of the shell.
      if (this.inShell) {
        this.shellLeft = 0
        o.invulnerable = false
      }
      return
    }
    if (this.inShell || this.shellCooldown > 0) return
    this.hurt += amount
    // Withdraw at once, so the rest of a burst already bounces off the shell.
    if (this.hurt >= SHELL_TRIGGER) this.withdraw()
  }

  override onBallContact(c: BallContact): void {
    if (!this.inShell || c.other !== this.enemy) return
    const w = this.world
    if (!w.combatActive || this.owner.disarmed) return
    if (w.time - this.lastShellHit < SHELL_HIT_COOLDOWN) return
    const dealt = w.damage(c.other, SHELL_DAMAGE, {
      kind: 'turtleShell',
      source: this.owner,
      at: c.point,
      knock: { x: c.normal.x * SHELL_KNOCK, y: c.normal.y * SHELL_KNOCK },
      shake: 4,
    })
    // A blocked hit (invulnerable target) doesn't use up the cooldown.
    if (dealt > 0) this.lastShellHit = w.time
  }

  override onWallBounce(e: WallBounce): void {
    if (!this.inShell) return
    // The shell banks off the wall straight at the enemy, like a pinball.
    this.aimAtEnemy()
    this.world.effects.burst(e.point, {
      count: 8,
      color: ['#ffffff', '#d9f99d', '#86efac'],
      shape: 'spark',
      direction: dm.atan2(e.normal.y, e.normal.x),
      spread: 1.2,
      speed: [140, 340],
      size: [1.5, 3],
      life: [0.12, 0.26],
      drag: 5,
    })
    this.world.sound('clack', 0.35, 0.7)
  }

  // ───────────────────────────── shell ─────────────────────────────

  private withdraw(): void {
    const o = this.owner
    this.shellLeft = SHELL_TIME
    this.hurt = 0
    this.bite = 'idle'
    this.biteT = 0
    o.invulnerable = true
    o.baseSpeed = SHELL_SPEED
    // Kick off towards the enemy at full shell speed.
    this.aimAtEnemy()
    this.world.sound('clack', 0.8, 0.55)
    this.world.sound('whoosh', 0.5, 0.8)
    this.world.effects.burst(o.pos, {
      count: 14,
      color: ['#6fcf7a', '#3f8f4a', '#d9f99d', '#ffffff'],
      shape: 'shard',
      speed: [80, 240],
      size: [2, 4.5],
      life: [0.25, 0.5],
      jitter: o.radius * 0.5,
    })
  }

  /** Sends the shell at the enemy's current position at full shell speed. */
  private aimAtEnemy(): void {
    const o = this.owner
    const e = this.enemy
    if (!o.movable || o.attachedTo || !e.alive) return
    const dx = e.pos.x - o.pos.x
    const dy = e.pos.y - o.pos.y
    const d = dm.hypot(dx, dy)
    if (d < 1e-6) return
    const speed = o.baseSpeed * o.speedFactor
    o.vel.x = (dx / d) * speed
    o.vel.y = (dy / d) * speed
  }

  private popOut(): void {
    const o = this.owner
    this.shellLeft = 0
    this.shellCooldown = SHELL_COOLDOWN
    this.hurt = 0
    o.invulnerable = false
    o.baseSpeed = WALK_SPEED
    this.biteCooldown = Math.min(this.biteCooldown, 0.3)
    this.world.sound('place', 0.5, 1.4)
    this.world.effects.burst(o.pos, { count: 10, color: [SKIN, '#ffffff'], speed: [60, 180], size: [1.5, 3.5], life: [0.2, 0.4], jitter: o.radius * 0.6 })
  }

  // ───────────────────────────── bite ─────────────────────────────

  private updateBite(dt: number): void {
    const o = this.owner
    const e = this.enemy
    const toEnemy = dm.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)
    switch (this.bite) {
      case 'idle': {
        if (this.world.combatActive) this.biteCooldown = Math.max(0, this.biteCooldown - dt)
        if (this.biteCooldown > 0 || o.disarmed || !e.alive || !this.world.combatActive) return
        const gap = dm.hypot(e.pos.x - o.pos.x, e.pos.y - o.pos.y) - o.radius - e.radius
        if (gap > NECK_REACH) return
        this.bite = 'extend'
        this.biteT = 0
        this.biteAim = toEnemy
        this.biteHit = false
        this.world.sound('whoosh', 0.3, 1.8)
        return
      }
      case 'extend': {
        this.biteT += dt
        // The neck follows the target a little while it lunges.
        this.biteAim = lerpAngle(this.biteAim, toEnemy, damp(10, dt))
        if (this.biteT >= BITE_EXTEND) this.closeJaws()
        return
      }
      case 'retract':
        this.biteT += dt
        if (this.biteT >= BITE_RETRACT) {
          this.bite = 'idle'
          this.biteT = 0
        }
        return
    }
  }

  private closeJaws(): void {
    const o = this.owner
    const e = this.enemy
    this.bite = 'retract'
    this.biteT = 0
    this.biteCooldown = BITE_COOLDOWN
    if (!e.alive || !this.world.combatActive) return
    const dx = e.pos.x - o.pos.x
    const dy = e.pos.y - o.pos.y
    const d = dm.hypot(dx, dy)
    const gap = d - o.radius - e.radius
    if (gap > NECK_REACH + BITE_SLACK) return
    if (Math.abs(angleDiff(this.biteAim, dm.atan2(dy, dx))) > BITE_CONE) return
    const nx = d > 1e-6 ? dx / d : 1
    const ny = d > 1e-6 ? dy / d : 0
    const at = { x: e.pos.x - nx * e.radius, y: e.pos.y - ny * e.radius }
    const dealt = this.world.damage(e, BITE_DAMAGE, { kind: 'turtleShell', source: o, at, knock: { x: nx * BITE_KNOCK, y: ny * BITE_KNOCK }, shake: 2 })
    if (dealt > 0) {
      this.biteHit = true
      this.world.sound('bite', 0.6, 1.2)
      this.world.effects.burst(at, { count: 8, color: ['#dc2626', '#f87171', '#ffffff'], speed: [60, 200], size: [1.5, 3.5], life: [0.2, 0.45], gravity: 120 })
    }
  }

  /** 0..1: how far the neck is stretched out. */
  private get neckOut(): number {
    if (this.bite === 'extend') return clamp(this.biteT / BITE_EXTEND, 0, 1)
    if (this.bite === 'retract') return 1 - clamp(this.biteT / BITE_RETRACT, 0, 1)
    return 0
  }

  // ───────────────────────────── rendering ─────────────────────────────

  override renderBack(ctx: CanvasRenderingContext2D): void {
    // Afterimages of the speeding shell.
    const fade = this.presence
    if (fade <= 0 || this.trail.length < 2) return
    const now = this.world.time
    const o = this.owner
    ctx.save()
    for (let i = 0; i < this.trail.length; i += 3) {
      const p = this.trail[i]
      const k = 1 - (now - p.t) / AFTERIMAGE_SPAN
      ctx.globalAlpha = fade * 0.28 * k
      ctx.fillStyle = o.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, o.radius * (0.75 + 0.25 * k), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const out = 1 - this.tuck
    if (out <= 0) return
    const r = o.radius * o.drawScale
    const neck = this.neckOut
    const headAngle = neck > 0 ? this.biteAim : this.look
    const jaw = this.bite === 'extend' ? 0.55 * neck : this.bite === 'retract' ? (this.biteHit ? 0 : 0.35 * neck) : 0.08
    drawTurtleLimbs(ctx, o.pos.x, o.pos.y, r, this.look, this.paddle, out)
    drawTurtleHead(ctx, o.pos.x, o.pos.y, r, headAngle, out, neck * NECK_REACH * o.drawScale, jaw)
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const r = o.radius * o.drawScale
    const rot = this.inShell || this.tuck > 0 ? this.look + this.spin : this.look
    drawShellPattern(ctx, o.pos.x, o.pos.y, r, rot, this.tuck)
    if (this.inShell) {
      // Spin blur arcs and a glint marking invulnerability.
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      for (let i = 0; i < 3; i++) {
        const a = this.spin * 1.3 + (i * Math.PI * 2) / 3
        ctx.beginPath()
        ctx.arc(o.pos.x, o.pos.y, r * 0.8, a, a + 0.9)
        ctx.stroke()
      }
      const pulse = 0.6 + 0.4 * dm.sin(this.world.time * 10)
      ctx.strokeStyle = `rgba(191,219,254,${0.55 + 0.35 * pulse})`
      ctx.lineWidth = 2.5
      ctx.shadowColor = '#93c5fd'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, r + 3, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }
}

// ───────────────────────────── drawing helpers ─────────────────────────────

/**
 * Four paddling flippers and a stubby tail around a ball heading along
 * `look`; `out` (0..1) scales them as they pull into the shell.
 */
function drawTurtleLimbs(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, look: number, paddle: number, out: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(look)
  ctx.fillStyle = SKIN
  ctx.strokeStyle = SKIN_DARK
  ctx.lineWidth = 1.5
  // Front flippers are long, back ones short; diagonal pairs stroke together.
  const limbs: [number, number, number, number][] = [
    [0.85, 1, 0.62, 0],
    [-0.85, -1, 0.62, Math.PI],
    [2.35, 1, 0.42, Math.PI],
    [-2.35, -1, 0.42, 0],
  ]
  for (const [base, side, len, phase] of limbs) {
    const swing = 0.32 * dm.sin(paddle * 2 + phase) * side
    const a = base + swing
    const l = r * len * out
    const px = dm.cos(a) * r * 0.82
    const py = dm.sin(a) * r * 0.82
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(a - side * 0.35)
    ctx.beginPath()
    ctx.ellipse(l * 0.55, 0, l * 0.75 + 1, r * 0.2 * out + 1, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
  // Tail.
  const tl = r * 0.36 * out
  ctx.beginPath()
  ctx.moveTo(-r * 0.85, -r * 0.13)
  ctx.quadraticCurveTo(-r * 0.9 - tl, dm.sin(paddle * 2) * r * 0.08, -r * 0.85 - tl * 1.15, 0)
  ctx.quadraticCurveTo(-r * 0.9 - tl, r * 0.05, -r * 0.85, r * 0.13)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** Neck and head poking out along `angle`, stretched by `reach`; `jaw` (0..1) opens the mouth. */
function drawTurtleHead(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, angle: number, out: number, reach: number, jaw: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const hr = HEAD_RADIUS * (r / R) * (0.4 + 0.6 * out)
  const hx = (r * 0.82 + hr * 0.9) * (0.3 + 0.7 * out) + reach
  ctx.fillStyle = SKIN
  ctx.strokeStyle = SKIN_DARK
  ctx.lineWidth = 1.5
  // Neck.
  const nw = hr * 0.62
  ctx.beginPath()
  ctx.moveTo(r * 0.6, -nw)
  ctx.lineTo(hx, -nw * 0.9)
  ctx.lineTo(hx, nw * 0.9)
  ctx.lineTo(r * 0.6, nw)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Head: upper and lower jaw opening around the mouth line.
  const open = jaw * 0.9
  ctx.beginPath()
  if (open > 0.05) {
    ctx.ellipse(hx, 0, hr * 1.12, hr * 0.92, 0, open * 0.5, Math.PI * 2 - open * 0.5)
    ctx.lineTo(hx, 0)
    ctx.closePath()
  } else {
    ctx.ellipse(hx, 0, hr * 1.12, hr * 0.92, 0, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.stroke()
  if (open > 0.05) {
    ctx.fillStyle = '#7f1d1d'
    ctx.beginPath()
    ctx.moveTo(hx, 0)
    ctx.arc(hx, 0, hr * 0.85, -open * 0.5, open * 0.5)
    ctx.closePath()
    ctx.fill()
  } else {
    ctx.strokeStyle = SKIN_DARK
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(hx + hr * 0.15, hr * 0.12)
    ctx.lineTo(hx + hr * 1.05, hr * 0.05)
    ctx.stroke()
  }
  // Eyes.
  ctx.fillStyle = '#111827'
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(hx + hr * 0.4, s * hr * 0.45, Math.max(1.2, hr * 0.17), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#ffffff'
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.arc(hx + hr * 0.45, s * hr * 0.45 - hr * 0.06, Math.max(0.5, hr * 0.06), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Scutes on the shell: a central hexagon, spokes to a ring of marginal
 * plates and a darker rim. `tuck` (0..1) darkens the rim as the turtle hides.
 */
function drawShellPattern(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot: number, tuck: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(rot)
  const hex = r * 0.42
  const inner = r * 0.8
  // Central and surrounding plates.
  ctx.fillStyle = SCUTE_FILL
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const x = dm.cos(a) * hex
    const y = dm.sin(a) * hex
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = SCUTE_LINE
  ctx.lineWidth = Math.max(1.2, r * 0.06)
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    ctx.moveTo(dm.cos(a) * hex, dm.sin(a) * hex)
    ctx.lineTo(dm.cos(a) * inner, dm.sin(a) * inner)
  }
  ctx.stroke()
  // Marginal ring.
  ctx.beginPath()
  ctx.arc(0, 0, inner, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = Math.max(1, r * 0.045)
  ctx.beginPath()
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2
    ctx.moveTo(dm.cos(a) * inner, dm.sin(a) * inner)
    ctx.lineTo(dm.cos(a) * r, dm.sin(a) * r)
  }
  ctx.stroke()
  // Rim, heavier while withdrawn.
  ctx.strokeStyle = `rgba(30,70,30,${0.55 + 0.35 * tuck})`
  ctx.lineWidth = 2 + 1.5 * tuck
  ctx.beginPath()
  ctx.arc(0, 0, r - 1, 0, Math.PI * 2)
  ctx.stroke()
  // Gloss.
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = Math.max(1, r * 0.07)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.62, Math.PI * 1.1 - rot, Math.PI * 1.45 - rot)
  ctx.stroke()
  ctx.restore()
}

export function drawTurtlePortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const br = r * 0.95
  const x = cx - r * 0.25
  const y = cy + r * 0.2
  const look = -0.6
  drawTurtleLimbs(ctx, x, y, br, look, 0.5, 1)
  drawTurtleHead(ctx, x, y, br, look, 1, br * 0.25, 0.4)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, br, 0, Math.PI * 2)
  ctx.fill()
  drawShellPattern(ctx, x, y, br, look, 0)
}

export const turtleDef: CharacterDef = {
  id: 'turtle',
  nameEn: 'TURTLE',
  ruleValues: {
    biteDamage: BITE_DAMAGE,
    biteCooldown: BITE_COOLDOWN,
    shellTrigger: SHELL_TRIGGER,
    shellTime: SHELL_TIME,
    shellSpeed: SHELL_SPEED_X,
    shellDamage: SHELL_DAMAGE,
    shellHitCooldown: SHELL_HIT_COOLDOWN,
    shellCooldown: SHELL_COOLDOWN,
  },
  palette: { ball: '#3f8f4a', text: '#ffffff', accent: '#6fcf7a' },
  mirrorPalette: { ball: '#14532d', text: '#dcfce7', accent: '#86efac' },
  create: (w, b) => new TurtleAbility(w, b),
  drawPortrait: drawTurtlePortrait,
}
