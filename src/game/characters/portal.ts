import * as dm from '../core/dmath'
import { type Vec, angleDiff, clamp, fromAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import { predictPosition } from '../engine/predict'
import type { DamageOptions, Wall, WallBounce } from '../engine/types'
import type { World } from '../engine/World'
import type { CharacterDef } from './types'

const R = BALL_RADIUS
const FIRST_OPEN = 1.2
/** Time from one portal pair opening to the next (s); it shrinks with every pair. */
export const PORTAL_INTERVAL = 4.5
export const MIN_INTERVAL = 2.5
const INTERVAL_SHRINK = 0.96
/** How long a pair stays open at most; a new pair always replaces the old one (s). */
export const PORTAL_LIFE = 3.4
/** Grow-in time; a portal only works once fully open (s). */
const OPEN_TIME = 0.3
const CLOSE_TIME = 0.25
/** Half the length of a portal along its wall; a ball centred within it goes through. */
const PORTAL_HALF = R * 1.55
/** How far the oval bulges into the arena (visual only). */
const PORTAL_DEPTH = R * 0.65
/** Keeps portals off the corners so the exit always has room. */
const CORNER_MARGIN = R * 0.4
/** Random shift of the entry / exit portal along its wall. */
const ENTRY_JITTER = R * 0.25
const EXIT_JITTER = R * 0.6
/** A pair the owner went through closes this soon after (s). */
const USED_LINGER = 0.35
/** The blue portal re-plants itself on the owner's new course at most this often (s). */
const MOVE_COOLDOWN = 0.5
/** A ball that just came out of a portal can't enter one again for this long (s). */
export const TELEPORT_COOLDOWN = 0.8
/** Portal dash: duration (s), speed, homing rate (rad/s). */
export const DASH_TIME = 0.55
const DASH_SPEED = 820
const DASH_TURN = 6
export const DASH_DAMAGE = 12
/** Sideways shove when the dash punches through the enemy. */
const DASH_KNOCK = 220
/** After landing the hit the dash keeps going straight at least this long, so the owner clears the enemy (s). */
const PASS_TIME = 0.18
/** The owner phases through the enemy while dashing and until the two separate, at most this long after (s). */
const PHASE_MAX = 0.6
/** Speed (× base) the owner keeps when a dash ends. */
const DASH_END_SPEED = 1.25
const STREAK_POINTS = 14
const WARP_SHOW = 0.3

const BLUE = '#38bdf8'
const BLUE_DEEP = '#0369a1'
const ORANGE = '#ff8a00'
const ORANGE_DEEP = '#c2410c'

type PortalColor = 'blue' | 'orange'

interface Portal {
  wall: Wall
  /** Coordinate of the portal centre along its wall. */
  c: number
  color: PortalColor
  /** Seconds since this portal opened; it works once fully open. */
  age: number
}

interface PortalPair {
  /** Blue entry, kept on the owner's path. */
  a: Portal
  /** Orange exit, next to the enemy. */
  b: Portal
  age: number
}

interface ClosingPortal {
  portal: Portal
  /** Seconds since it started closing. */
  t: number
}

interface Warp {
  /** Where the ball vanished (on the entry wall) and reappeared. */
  from: Vec
  to: Vec
  fromAngle: number
  toAngle: number
  radius: number
  color: string
  inColor: PortalColor
  outColor: PortalColor
  age: number
}

const NORMALS: Record<Wall, Vec> = {
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  top: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
}

/** Unit vector along the wall: the inward normal turned by +90°. */
const tangentOf = (wall: Wall): Vec => {
  const n = NORMALS[wall]
  return { x: -n.y, y: n.x }
}

const rim = (c: PortalColor): string => (c === 'blue' ? BLUE : ORANGE)
const deep = (c: PortalColor): string => (c === 'blue' ? BLUE_DEEP : ORANGE_DEEP)
const glowRgb = (c: PortalColor): string => (c === 'blue' ? '56,189,248' : '255,138,0')

/**
 * 传送门 PORTAL — opens a linked pair of portals on the walls: the blue one
 * right where the owner is about to bounce, the orange one on the wall
 * closest to the enemy. Any ball that runs into a portal (the enemy too)
 * comes out of the other one with its speed kept. When the owner comes
 * through, it is flung out in a short homing dash that rams the enemy.
 */
export class PortalAbility extends Ability {
  private pair: PortalPair | null = null
  /** Portals fading out after expiring, being replaced or moved. */
  private closing: ClosingPortal[] = []
  /** Time until the blue portal may move again (s). */
  private moveCooldown = 0
  private openTimer = FIRST_OPEN
  private interval = PORTAL_INTERVAL
  /** Per-team cooldown before a ball may enter a portal again. */
  private teleportCooldown: [number, number] = [0, 0]
  private dashing = false
  private dashLeft = 0
  /** Whether this dash already landed its hit (it then flies straight on through). */
  private dashHit = false
  /** Seconds the owner keeps phasing through the enemy after a dash, or 0. */
  private phaseLeft = 0
  private dashDir: Vec = { x: 1, y: 0 }
  private dashColor: PortalColor = 'orange'
  /** Recent owner positions while dashing, for the streak. */
  private streak: Vec[] = []
  private warps: Warp[] = []

  constructor(world: World, owner: Ball) {
    super(world, owner)
  }

  override prePhysics(dt: number): void {
    this.teleportCooldown[0] = Math.max(0, this.teleportCooldown[0] - dt)
    this.teleportCooldown[1] = Math.max(0, this.teleportCooldown[1] - dt)
    if (this.dashing) this.steerDash(dt)

    const pair = this.pair
    if (!pair || pair.a.age < OPEN_TIME || pair.b.age < OPEN_TIME) return
    for (const b of this.world.balls) {
      if (!b.alive || this.teleportCooldown[b.team] > 0 || this.isHeld(b)) continue
      if (this.touching(b, pair.a, dt)) this.teleport(b, pair.a, pair.b)
      else if (this.touching(b, pair.b, dt)) this.teleport(b, pair.b, pair.a)
    }
  }

  override update(dt: number): void {
    this.updatePortals(dt)
    if (this.dashing) this.checkDashHit()
    this.updatePhase(dt)
    this.updateStreak()
    for (const w of this.warps) w.age += dt
    this.warps = this.warps.filter((w) => w.age < WARP_SHOW)
  }

  override onWallBounce(_e: WallBounce): void {
    this.endDash()
  }

  override onOwnerDamaged(_amount: number, _opts: DamageOptions): void {
    if (this.owner.hp <= 0) this.endDash()
  }

  /** A charged owner phases through the enemy instead of bumping into it. */
  override collidesWith(other: Ball): boolean {
    return !(other === this.enemy && (this.dashing || this.phaseLeft > 0))
  }

  // ───────────────────────────── portals ─────────────────────────────

  /** Held balls (pinned, attached, rooted, or carrying someone) never get teleported. */
  private isHeld(b: Ball): boolean {
    const other = this.world.opponentOf(b)
    return b.pinned || b.attachedTo !== null || b.rooted || other.attachedTo === b
  }

  private updatePortals(dt: number): void {
    for (const c of this.closing) c.t += dt
    this.closing = this.closing.filter((c) => c.t < CLOSE_TIME)
    this.moveCooldown = Math.max(0, this.moveCooldown - dt)
    const pair = this.pair
    if (pair) {
      pair.age += dt
      pair.a.age += dt
      pair.b.age += dt
      if (pair.age >= PORTAL_LIFE) this.closePair()
      else this.followOwner(pair)
    }
    if (!this.world.combatActive) return
    this.openTimer = Math.max(0, this.openTimer - dt)
    // Opening a pair is an attack: wait out a disarm.
    if (this.openTimer > 0 || this.owner.disarmed || !this.enemy.alive) return
    this.openPair()
    this.openTimer = this.interval
    this.interval = Math.max(MIN_INTERVAL, this.interval * INTERVAL_SHRINK)
  }

  private closePair(): void {
    if (!this.pair) return
    this.closing.push({ portal: this.pair.a, t: 0 }, { portal: this.pair.b, t: 0 })
    this.pair = null
  }

  /**
   * Blue goes where the owner will hit a wall once the portal is open, orange
   * on the wall closest to where the enemy will be when the owner comes out.
   */
  private openPair(): void {
    this.closePair()
    const o = this.owner
    const rng = this.world.rng
    const hit = this.nextWallHit(o, OPEN_TIME + 0.05)
    const entry: Portal = { wall: hit.wall, c: this.clampAlong(hit.c + rng.range(-ENTRY_JITTER, ENTRY_JITTER)), color: 'blue', age: 0 }

    const s = this.world.size
    const e = this.enemy
    const at = e.movable ? predictPosition(e, Math.min(hit.t, 2) + 0.15, s) : { x: e.pos.x, y: e.pos.y }
    const walls: [Wall, number, number][] = [
      ['left', at.x, at.y],
      ['right', s - at.x, at.y],
      ['top', at.y, at.x],
      ['bottom', s - at.y, at.x],
    ]
    walls.sort((p, q) => p[1] - q[1])
    let exit: Portal | null = null
    for (const [wall, , along] of walls) {
      const c = this.clampAlong(along + rng.range(-EXIT_JITTER, EXIT_JITTER))
      if (wall === entry.wall && Math.abs(c - entry.c) < PORTAL_HALF * 2 + R) continue
      exit = { wall, c, color: 'orange', age: 0 }
      break
    }
    // The four walls can't all clash with one portal; this is just for the type checker.
    if (!exit) exit = { wall: entry.wall === 'left' ? 'right' : 'left', c: s / 2, color: 'orange', age: 0 }

    this.pair = { a: entry, b: exit, age: 0 }
    this.moveCooldown = MOVE_COOLDOWN
    this.openBurst(entry)
    this.openBurst(exit)
    this.world.sound('zap', 0.35, 0.7)
  }

  private openBurst(p: Portal): void {
    const n = NORMALS[p.wall]
    this.world.effects.burst(this.centerOf(p), {
      count: 14,
      color: [rim(p.color), '#ffffff', deep(p.color)],
      shape: 'spark',
      speed: [80, 260],
      size: [1.5, 3.5],
      life: [0.25, 0.5],
      direction: dm.atan2(n.y, n.x),
      spread: 1.2,
      front: false,
    })
  }

  /**
   * Until the owner has used it, the blue portal hops to wherever the owner
   * is now heading if a bounce or a hold sent it off course.
   */
  private followOwner(pair: PortalPair): void {
    const o = this.owner
    if (this.moveCooldown > 0 || pair.a.age < OPEN_TIME || o.disarmed || this.isHeld(o) || this.teleportCooldown[o.team] > 0) return
    const hit = this.nextWallHit(o, OPEN_TIME + 0.05)
    if (hit.t > PORTAL_LIFE - pair.age) return
    const a = pair.a
    if (hit.wall === a.wall && Math.abs(hit.c - a.c) <= PORTAL_HALF * 0.8) return
    const c = this.clampAlong(hit.c)
    const b = pair.b
    if (hit.wall === b.wall && Math.abs(c - b.c) < PORTAL_HALF * 2 + R) return
    this.closing.push({ portal: a, t: 0 })
    pair.a = { wall: hit.wall, c, color: 'blue', age: 0 }
    this.moveCooldown = MOVE_COOLDOWN
    this.openBurst(pair.a)
    this.world.sound('zap', 0.25, 0.9)
  }

  private clampAlong(c: number): number {
    const lo = PORTAL_HALF + CORNER_MARGIN
    return clamp(c, lo, this.world.size - lo)
  }

  /**
   * First wall the ball reaches at least `minTime` seconds from now, following
   * its current velocity and reflecting off walls on the way.
   */
  private nextWallHit(b: Ball, minTime: number): { wall: Wall; c: number; t: number } {
    const s = this.world.size
    const r = b.radius
    let px = b.pos.x
    let py = b.pos.y
    let vx = b.vel.x
    let vy = b.vel.y
    if (vx * vx + vy * vy < 1) {
      // Standing still: the closest wall.
      const near: [Wall, number, number][] = [
        ['left', px, py],
        ['right', s - px, py],
        ['top', py, px],
        ['bottom', s - py, px],
      ]
      near.sort((p, q) => p[1] - q[1])
      return { wall: near[0][0], c: near[0][2], t: 0 }
    }
    let t = 0
    let wall: Wall = 'left'
    for (let i = 0; i < 4; i++) {
      const tx = vx > 0 ? (s - r - px) / vx : vx < 0 ? (px - r) / -vx : Infinity
      const ty = vy > 0 ? (s - r - py) / vy : vy < 0 ? (py - r) / -vy : Infinity
      const step = Math.max(0, Math.min(tx, ty))
      px = clamp(px + vx * step, r, s - r)
      py = clamp(py + vy * step, r, s - r)
      t += step
      if (tx <= ty) {
        wall = vx > 0 ? 'right' : 'left'
        vx = -vx
      } else {
        wall = vy > 0 ? 'bottom' : 'top'
        vy = -vy
      }
      if (t >= minTime) break
    }
    return { wall, c: wall === 'left' || wall === 'right' ? py : px, t }
  }

  private centerOf(p: Portal): Vec {
    const s = this.world.size
    switch (p.wall) {
      case 'left':
        return { x: 0, y: p.c }
      case 'right':
        return { x: s, y: p.c }
      case 'top':
        return { x: p.c, y: 0 }
      case 'bottom':
        return { x: p.c, y: s }
    }
  }

  /** Whether `b` reaches portal `p`'s wall this step, heading into it, within the opening. */
  private touching(b: Ball, p: Portal, dt: number): boolean {
    const n = NORMALS[p.wall]
    const vn = b.vel.x * n.x + b.vel.y * n.y
    if (vn >= 0) return false
    const c = this.centerOf(p)
    const dx = b.pos.x - c.x
    const dy = b.pos.y - c.y
    const gap = dx * n.x + dy * n.y - b.radius
    if (gap > -vn * dt + 0.5) return false
    const t = tangentOf(p.wall)
    return Math.abs(dx * t.x + dy * t.y) <= PORTAL_HALF
  }

  /**
   * Moves `b` from portal `p` to portal `q`. The mapping is a rigid rotation
   * taking "into p" to "out of q", so speed and the angle of approach carry over.
   */
  private teleport(b: Ball, p: Portal, q: Portal): void {
    const s = this.world.size
    const r = b.radius
    const np = NORMALS[p.wall]
    const tp = tangentOf(p.wall)
    const nq = NORMALS[q.wall]
    const tq = tangentOf(q.wall)
    const cp = this.centerOf(p)
    const cq = this.centerOf(q)
    const vn = b.vel.x * np.x + b.vel.y * np.y
    const vt = b.vel.x * tp.x + b.vel.y * tp.y
    const off = clamp((b.pos.x - cp.x) * tp.x + (b.pos.y - cp.y) * tp.y, -PORTAL_HALF, PORTAL_HALF)
    const from = { x: cp.x + tp.x * off, y: cp.y + tp.y * off }

    b.pos.x = clamp(cq.x - tq.x * off + nq.x * (r + 0.5), r, s - r)
    b.pos.y = clamp(cq.y - tq.y * off + nq.y * (r + 0.5), r, s - r)
    b.vel.x = -vn * nq.x - vt * tq.x
    b.vel.y = -vn * nq.y - vt * tq.y
    this.teleportCooldown[b.team] = TELEPORT_COOLDOWN

    const to = { x: cq.x - tq.x * off, y: cq.y - tq.y * off }
    this.warps.push({
      from,
      to,
      fromAngle: dm.atan2(np.y, np.x),
      toAngle: dm.atan2(nq.y, nq.x),
      radius: r,
      color: b.color,
      inColor: p.color,
      outColor: q.color,
      age: 0,
    })
    const fx = this.world.effects
    fx.burst(from, {
      count: 10,
      color: [rim(p.color), b.color, '#ffffff'],
      shape: 'spark',
      speed: [60, 220],
      size: [1.5, 3.5],
      life: [0.2, 0.4],
      direction: dm.atan2(np.y, np.x),
      spread: 1.1,
      jitter: R * 0.4,
    })
    fx.burst(b.pos, {
      count: 14,
      color: [rim(q.color), b.color, '#ffffff'],
      shape: 'spark',
      speed: [100, 300],
      size: [1.5, 3.5],
      life: [0.2, 0.45],
      direction: dm.atan2(nq.y, nq.x),
      spread: 0.9,
      jitter: R * 0.3,
    })
    this.world.sound('whoosh', 0.55, 1.6)

    if (b === this.owner) {
      this.startDash(q)
      // One trip per pair: it collapses behind the owner.
      if (this.pair) this.pair.age = Math.max(this.pair.age, PORTAL_LIFE - USED_LINGER)
    }
  }

  // ───────────────────────────── dash ─────────────────────────────

  private startDash(exit: Portal): void {
    const o = this.owner
    const e = this.enemy
    if (!this.world.combatActive || o.disarmed || !e.alive) return
    this.dashing = true
    this.dashHit = false
    // Phased: the dashing owner can't be hurt.
    o.invulnerable = true
    this.dashLeft = DASH_TIME
    this.dashColor = exit.color
    const aim = predictPosition(e, 0.12, this.world.size)
    this.dashDir = fromAngle(dm.atan2(aim.y - o.pos.y, aim.x - o.pos.x))
    o.vel = { x: this.dashDir.x * DASH_SPEED, y: this.dashDir.y * DASH_SPEED }
    this.streak = [{ x: o.pos.x, y: o.pos.y }]
    this.world.sound('zap', 0.45, 1.5)
  }

  /** Homes in on the enemy at full dash speed (straight on after the hit); called before physics. */
  private steerDash(dt: number): void {
    const o = this.owner
    const e = this.enemy
    if (!this.world.combatActive || this.isHeld(o) || o.disarmed || !e.alive) {
      this.endDash()
      return
    }
    if (!this.dashHit) {
      const cur = dm.atan2(this.dashDir.y, this.dashDir.x)
      const want = dm.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)
      const turn = DASH_TURN * dt
      this.dashDir = fromAngle(cur + clamp(angleDiff(cur, want), -turn, turn))
    }
    o.vel = { x: this.dashDir.x * DASH_SPEED, y: this.dashDir.y * DASH_SPEED }
    this.dashLeft -= dt
    if (this.dashLeft <= 0) this.endDash()
  }

  /**
   * Overlapping the enemy while dashing lands the hit: the owner punches
   * straight through and shoves the enemy aside.
   */
  private checkDashHit(): void {
    const o = this.owner
    const e = this.enemy
    if (this.dashHit || !e.alive || !this.world.combatActive) return
    const dx = e.pos.x - o.pos.x
    const dy = e.pos.y - o.pos.y
    const reach = o.radius + e.radius
    if (dx * dx + dy * dy > reach * reach) return
    this.dashHit = true
    this.dashLeft = Math.max(this.dashLeft, PASS_TIME)
    const d = this.dashDir
    // Shove towards whichever side of the dash line the enemy is on.
    const side = dx * -d.y + dy * d.x >= 0 ? 1 : -1
    const at = { x: (o.pos.x + e.pos.x) / 2, y: (o.pos.y + e.pos.y) / 2 }
    this.world.damage(e, DASH_DAMAGE, {
      kind: 'portal',
      source: o,
      at,
      knock: { x: -d.y * side * DASH_KNOCK, y: d.x * side * DASH_KNOCK },
      shake: 5,
    })
    const fx = this.world.effects
    fx.burst(at, { count: 1, color: rim(this.dashColor), shape: 'ring', speed: [0, 0], size: [R * 0.6, R * 0.6], life: [0.3, 0.3], endScale: 2.6 })
    fx.burst(at, {
      count: 12,
      color: [rim(this.dashColor), '#ffffff'],
      shape: 'spark',
      speed: [120, 340],
      size: [1.5, 3.5],
      life: [0.2, 0.4],
      direction: dm.atan2(d.y, d.x),
      spread: 0.7,
    })
    this.world.sound('heavyHit', 0.6, 1.3)
  }

  private endDash(): void {
    if (!this.dashing) return
    this.dashing = false
    this.dashLeft = 0
    this.owner.invulnerable = false
    // Keep phasing until the owner is clear of the enemy.
    this.phaseLeft = PHASE_MAX
    const o = this.owner
    if (!o.movable) return
    const sp = dm.hypot(o.vel.x, o.vel.y)
    const keep = o.baseSpeed * DASH_END_SPEED
    if (sp > keep) {
      o.vel.x = (o.vel.x / sp) * keep
      o.vel.y = (o.vel.y / sp) * keep
    }
  }

  private updatePhase(dt: number): void {
    if (this.phaseLeft <= 0 || this.dashing) return
    const o = this.owner
    const e = this.enemy
    this.phaseLeft = Math.max(0, this.phaseLeft - dt)
    const apart = dm.hypot(e.pos.x - o.pos.x, e.pos.y - o.pos.y) >= o.radius + e.radius
    if (apart || !e.alive) this.phaseLeft = 0
  }

  private updateStreak(): void {
    const o = this.owner
    if (this.dashing) {
      this.streak.push({ x: o.pos.x, y: o.pos.y })
      if (this.streak.length > STREAK_POINTS) this.streak.shift()
    } else if (this.streak.length > 0) {
      // Shrinks from the tail once the dash is over.
      this.streak.shift()
      if (this.streak.length > 0) this.streak.shift()
    }
  }

  // ───────────────────────────── rendering ─────────────────────────────

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const t = this.world.time
    ctx.save()
    ctx.globalAlpha = fade
    for (const c of this.closing) this.drawOne(ctx, c.portal, 1 - clamp(c.t / CLOSE_TIME, 0, 1), t)
    if (this.pair) {
      for (const p of [this.pair.a, this.pair.b]) {
        const u = clamp(p.age / OPEN_TIME, 0, 1)
        // Ease-out-back so the opening "pops".
        const k = 1 + 2.2 * (u - 1) * (u - 1) * (u - 1) + 1.2 * (u - 1) * (u - 1)
        this.drawOne(ctx, p, clamp(k, 0, 1.15), t)
      }
    }
    ctx.restore()
  }

  private drawOne(ctx: CanvasRenderingContext2D, p: Portal, k: number, time: number): void {
    if (k <= 0) return
    const c = this.centerOf(p)
    const n = NORMALS[p.wall]
    drawPortal(ctx, c.x, c.y, dm.atan2(n.y, n.x), PORTAL_HALF * k, PORTAL_DEPTH * Math.min(1, k), p.color, time)
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const pts = this.streak
    if (pts.length < 2) return
    const o = this.owner
    ctx.save()
    ctx.lineCap = 'round'
    const n = pts.length
    for (let i = 1; i < n; i++) {
      const u = i / (n - 1)
      ctx.strokeStyle = `rgba(${glowRgb(this.dashColor)},${0.12 + 0.5 * u})`
      ctx.lineWidth = o.radius * (0.4 + 1.4 * u)
      ctx.beginPath()
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
      ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = o.radius * 0.35
    ctx.beginPath()
    ctx.moveTo(pts[Math.max(0, n - 6)].x, pts[Math.max(0, n - 6)].y)
    for (let i = Math.max(0, n - 6) + 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
    if (this.dashing) {
      // Glow hugging the ball while it is charged.
      const g = ctx.createRadialGradient(o.pos.x, o.pos.y, o.radius * 0.8, o.pos.x, o.pos.y, o.radius * 1.6)
      g.addColorStop(0, `rgba(${glowRgb(this.dashColor)},0.6)`)
      g.addColorStop(1, `rgba(${glowRgb(this.dashColor)},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, o.radius * 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    drawPortalRing(ctx, o.pos.x, o.pos.y, o.radius * o.drawScale, this.world.time * 1.6)
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    if (this.warps.length === 0) return
    ctx.save()
    for (const w of this.warps) {
      const u = w.age / WARP_SHOW
      // The ball squashes into the entry wall…
      const inK = 1 - clamp(u / 0.6, 0, 1)
      if (inK > 0) {
        ctx.save()
        ctx.translate(w.from.x, w.from.y)
        ctx.rotate(w.fromAngle)
        ctx.globalAlpha *= 0.6 * inK
        ctx.fillStyle = w.color
        ctx.beginPath()
        ctx.ellipse(w.radius * 0.5 * inK, 0, w.radius * 0.5 * inK, w.radius * inK, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
      // …and a ring of light bursts out of the exit.
      ctx.save()
      ctx.translate(w.to.x, w.to.y)
      ctx.rotate(w.toAngle)
      ctx.strokeStyle = rim(w.outColor)
      ctx.globalAlpha *= 0.9 * (1 - u)
      ctx.lineWidth = 3 * (1 - u) + 1
      ctx.beginPath()
      ctx.ellipse(0, 0, PORTAL_DEPTH * (1 + 1.6 * u), PORTAL_HALF * (0.7 + 0.6 * u), 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    ctx.restore()
  }
}

/**
 * A portal oval centred on (x, y) with its inward normal along `angle`:
 * `half` along the wall, `depth` across. Half of it hides behind the wall.
 */
export function drawPortal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  half: number,
  depth: number,
  color: PortalColor,
  time: number,
): void {
  if (half < 0.5) return
  const rgb = glowRgb(color)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  // Soft light spilling into the arena.
  ctx.save()
  ctx.scale((depth * 2.6) / half, 1)
  const glow = ctx.createRadialGradient(0, 0, half * 0.3, 0, 0, half * 1.15)
  glow.addColorStop(0, `rgba(${rgb},0.35)`)
  glow.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(0, 0, half * 1.15, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // Dark swirling mouth.
  ctx.fillStyle = '#060b18'
  ctx.beginPath()
  ctx.ellipse(0, 0, depth, half, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(0, 0, depth, half, 0, 0, Math.PI * 2)
  ctx.clip()
  ctx.scale(depth / half, 1)
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const rr = half * (0.3 + 0.22 * i)
    const a0 = time * (3.2 - i * 0.7) * (color === 'blue' ? 1 : -1) + i * 2.1
    ctx.strokeStyle = `rgba(${rgb},${0.75 - i * 0.18})`
    ctx.lineWidth = (2.6 - i * 0.5) * (half / Math.max(depth, 1))
    ctx.beginPath()
    ctx.arc(0, 0, rr, a0, a0 + 2.2)
    ctx.stroke()
  }
  ctx.restore()
  // Bright rim with an outer halo.
  ctx.strokeStyle = `rgba(${rgb},0.35)`
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.ellipse(0, 0, depth, half, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = rim(color)
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 1.3
  ctx.stroke()
  ctx.restore()
}

/** Thin blue / orange ring spinning just inside the ball's rim. */
export function drawPortalRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number): void {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(2, r * 0.11)
  const rr = r * 0.84
  ctx.strokeStyle = BLUE
  ctx.beginPath()
  ctx.arc(x, y, rr, spin, spin + Math.PI * 0.8)
  ctx.stroke()
  ctx.strokeStyle = '#ffe2bf'
  ctx.beginPath()
  ctx.arc(x, y, rr, spin + Math.PI, spin + Math.PI * 1.8)
  ctx.stroke()
  ctx.restore()
}

export function drawPortalPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const half = r * 1.35
  const depth = r * 0.5
  // Blue portal on the left swallowing a streak, orange on the right spitting the ball out.
  drawPortal(ctx, cx - r * 1.95, cy + r * 0.2, 0, half, depth, 'blue', 0.6)
  drawPortal(ctx, cx + r * 2.05, cy - r * 0.35, Math.PI, half, depth, 'orange', 0.2)
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < 3; i++) {
    const y = cy - r * 0.35 + (i - 1) * r * 0.42
    ctx.strokeStyle = `rgba(255,138,0,${0.75 - i * 0.15})`
    ctx.lineWidth = r * 0.16
    ctx.beginPath()
    ctx.moveTo(cx + r * 1.75, y)
    ctx.lineTo(cx + r * 1.05, y)
    ctx.stroke()
  }
  ctx.restore()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx + r * 0.05, cy - r * 0.35, r * 0.85, 0, Math.PI * 2)
  ctx.fill()
  drawPortalRing(ctx, cx + r * 0.05, cy - r * 0.35, r * 0.85, 0.5)
}

export const portalDef: CharacterDef = {
  id: 'portal',
  nameEn: 'PORTAL',
  ruleValues: { portalInterval: PORTAL_INTERVAL, minInterval: MIN_INTERVAL, portalLife: PORTAL_LIFE, dashTime: DASH_TIME, dashDamage: DASH_DAMAGE },
  palette: { ball: '#ff8a00', text: '#ffffff', accent: '#38bdf8' },
  mirrorPalette: { ball: '#0369a1', text: '#e0f2fe', accent: '#fb923c' },
  create: (w, b) => new PortalAbility(w, b),
  drawPortrait: drawPortalPortrait,
}
