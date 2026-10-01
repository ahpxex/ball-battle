import { type Vec, clamp, damp, fromAngle, lerpAngle } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BALL_RADIUS } from '../engine/constants'
import type { World } from '../engine/World'
import type { DamageOptions } from '../engine/types'
import type { CharacterDef } from './types'

const R = BALL_RADIUS
/** Time between tongue shots, counted from the moment the tongue is back in the mouth (s). */
export const TONGUE_COOLDOWN = 2.5
const FIRST_SHOT = 1.0
/** Tongue reach in ball radii (enemy centre must be within this to fire). */
export const TONGUE_RANGE_R = 8.5
const TONGUE_RANGE = R * TONGUE_RANGE_R
const EXTEND_TIME = 0.12
const RETRACT_TIME = 0.15
const TIP_RADIUS = R * 0.45
const TONGUE_WIDTH = R * 0.38
export const HIT_DAMAGE = 3
export const PULL_DAMAGE = 3
export const PULL_TICK = 0.26
const PULL_SPEED = 260
const MAX_PULL_TIME = 1.5
/** Swallowed once the prey's centre is this close to the frog's (× frog radius). */
const SWALLOW_DISTANCE = 0.6
export const SWALLOW_TIME = 0.6
const SWALLOW_OPACITY = 0.35
const GRAB_ROOT = 3
/** After spitting the prey out the pair ignores collisions until separated, at most this long (s). */
const SPIT_GHOST_MAX = 1.5

const PAD_RADIUS = R
/** Chord of the wedge cut out of a lily pad. */
const PAD_NOTCH = R * 0.8
const PAD_LIFE = 8
const PAD_FADE_IN = 0.8
const PAD_FADE_OUT = 1.0
const MAX_PADS = 4

const TONGUE_PINK = '#f880b0'
const TONGUE_DARK = '#b8336e'

type TongueState = 'idle' | 'extend' | 'retract' | 'pull' | 'swallow'

interface LilyPad {
  x: number
  y: number
  r: number
  /** Direction of the wedge cut. */
  angle: number
  age: number
}

/**
 * 青蛙 FROG — flicks a long sticky tongue at enemies in range. A hit drags
 * the prey back while chewing on it, swallows it whole for a moment and then
 * spits it out in a random direction. Lily pads drift on the floor purely
 * for decoration.
 */
export class FrogAbility extends Ability {
  private state: TongueState = 'idle'
  private stateTime = 0
  private cooldown = FIRST_SHOT
  /** Tongue direction and full length of the current shot. */
  private aim = 0
  /** Where the tongue was aimed when fired; the hit test happens there. */
  private aimPoint: Vec = { x: 0, y: 0 }
  private reach = 0
  private prey: Ball | null = null
  private tickTimer = 0
  /** Ball just spat out; collisions with it are skipped until the two separate. */
  private ghost: Ball | null = null
  private ghostTime = 0
  /** Smoothed facing used only for drawing the face. */
  private look: number
  private pads: LilyPad[] = []
  private padTimer = 0

  constructor(world: World, owner: Ball) {
    super(world, owner)
    const e = this.enemy
    this.look = Math.atan2(e.pos.y - owner.pos.y, e.pos.x - owner.pos.x)
    // Start with a few pads at staggered ages so the floor isn't empty.
    for (const age of [1.5, 4, 6.5]) this.spawnPad(age)
    this.padTimer = 1.2
  }

  override update(dt: number): void {
    this.updatePads(dt)
    this.updateGhost(dt)
    if (this.prey && !this.holdValid(this.prey)) this.release(false)

    switch (this.state) {
      case 'idle':
        if (this.world.combatActive) this.cooldown = Math.max(0, this.cooldown - dt)
        this.tryFire()
        break
      case 'extend':
        this.stateTime += dt
        if (this.stateTime >= EXTEND_TIME) this.resolveShot()
        break
      case 'retract':
        this.stateTime += dt
        if (this.stateTime >= RETRACT_TIME) this.setState('idle')
        break
      case 'pull':
        this.pull(dt)
        break
      case 'swallow':
        this.digest(dt)
        break
    }
    this.updateLook(dt)
  }

  override onOwnerDamaged(_amount: number, _opts: DamageOptions): void {
    // About to die: let go of the prey before the owner stops updating.
    if (this.owner.hp > 0) return
    if (this.prey) this.release(false)
    this.setState('idle')
    this.ghost = null
  }

  override collidesWith(other: Ball): boolean {
    return other !== this.ghost
  }

  // ───────────────────────────── tongue ─────────────────────────────

  private setState(s: TongueState): void {
    // The cooldown runs from the moment the tongue is back in the mouth, so a
    // spat-out enemy can't be chain-grabbed point blank.
    if (s === 'idle' && this.state !== 'idle') this.cooldown = TONGUE_COOLDOWN
    this.state = s
    this.stateTime = 0
  }

  private tryFire(): void {
    const o = this.owner
    const e = this.enemy
    if (this.cooldown > 0 || !this.world.combatActive || o.disarmed || !e.alive) return
    // Can't shoot while being held by someone else (e.g. another frog).
    if (o.pinned || o.attachedTo) return
    const dx = e.pos.x - o.pos.x
    const dy = e.pos.y - o.pos.y
    const d = Math.hypot(dx, dy)
    if (d > TONGUE_RANGE) return
    this.aim = Math.atan2(dy, dx)
    this.reach = Math.min(d, TONGUE_RANGE)
    this.aimPoint = { x: e.pos.x, y: e.pos.y }
    this.setState('extend')
    this.world.sound('whoosh', 0.5, 1.7)
  }

  /**
   * Hit test at the end of the extension, at the spot the tongue was aimed
   * at: a target that moved far enough away in the meantime is missed.
   */
  private resolveShot(): void {
    const e = this.enemy
    const tip = this.aimPoint
    const hit =
      e.alive && this.world.combatActive && Math.hypot(tip.x - e.pos.x, tip.y - e.pos.y) <= e.radius + TIP_RADIUS
    if (!hit) {
      this.setState('retract')
      return
    }
    const dealt = this.world.damage(e, HIT_DAMAGE, { kind: 'tongue', source: this.owner, at: tip, shake: 3 })
    this.world.sound('hook', 0.6, 1.3)
    this.world.effects.burst(tip, { count: 8, color: [TONGUE_PINK, '#ffffff'], speed: [60, 180], size: [1.5, 3.5], life: [0.2, 0.4] })
    // A blocked hit, a dead target or a ball held by its own ability can't be reeled in.
    if (dealt === 0 || !e.alive || e.pinned || e.attachedTo) {
      this.setState('retract')
      return
    }
    e.applyRoot(GRAB_ROOT)
    e.attachedTo = this.owner
    this.prey = e
    this.tickTimer = PULL_TICK
    this.setState('pull')
  }

  private holdValid(prey: Ball): boolean {
    return prey.alive && this.world.combatActive && prey.attachedTo === this.owner && !prey.pinned
  }

  /** Keeps the prey rooted for the whole grab even if something ended the root early. */
  private keepRooted(prey: Ball): void {
    if (!prey.rooted) prey.applyRoot(GRAB_ROOT)
    prey.vel.x = 0
    prey.vel.y = 0
  }

  private pull(dt: number): void {
    const e = this.prey!
    const o = this.owner
    this.stateTime += dt
    this.keepRooted(e)
    const dx = o.pos.x - e.pos.x
    const dy = o.pos.y - e.pos.y
    const d = Math.hypot(dx, dy)
    if (d > 1e-6) {
      const step = Math.min(d, PULL_SPEED * dt)
      const s = this.world.size
      e.pos.x = clamp(e.pos.x + (dx / d) * step, e.radius, s - e.radius)
      e.pos.y = clamp(e.pos.y + (dy / d) * step, e.radius, s - e.radius)
    }
    this.aim = Math.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)

    this.tickTimer -= dt
    if (this.tickTimer <= 0) {
      this.tickTimer += PULL_TICK
      this.world.damage(e, PULL_DAMAGE, { kind: 'tongue', source: o, at: { x: e.pos.x, y: e.pos.y } })
      if (!e.alive) {
        this.release(false)
        return
      }
    }

    const left = Math.hypot(o.pos.x - e.pos.x, o.pos.y - e.pos.y)
    if (left <= o.radius * SWALLOW_DISTANCE || this.stateTime >= MAX_PULL_TIME) this.swallow(e)
  }

  private swallow(e: Ball): void {
    e.pos.x = this.owner.pos.x
    e.pos.y = this.owner.pos.y
    e.opacity = SWALLOW_OPACITY
    this.setState('swallow')
    this.world.sound('bite', 0.7, 0.7)
  }

  private digest(dt: number): void {
    const e = this.prey!
    this.stateTime += dt
    this.keepRooted(e)
    e.pos.x = this.owner.pos.x
    e.pos.y = this.owner.pos.y
    if (this.stateTime >= SWALLOW_TIME) this.release(true)
  }

  /**
   * Lets go of the prey and restores everything the grab changed. `spit`
   * fires it off in a random direction; otherwise it resumes its old heading.
   */
  private release(spit: boolean): void {
    const e = this.prey
    if (!e) return
    const o = this.owner
    const wasPulling = this.state === 'pull'
    this.prey = null
    e.opacity = 1
    if (e.attachedTo === o) e.attachedTo = null
    if (e.alive) {
      e.endRoot()
      if (spit) {
        const a = this.world.rng.range(0, Math.PI * 2)
        e.vel = fromAngle(a, e.baseSpeed)
        this.world.effects.burst(o.pos, { count: 10, color: ['#bef264', '#ffffff', TONGUE_PINK], speed: [80, 220], size: [2, 4], life: [0.25, 0.5], direction: a, spread: 0.6 })
        this.world.sound('whoosh', 0.6, 0.9)
      }
      this.ghost = e
      this.ghostTime = 0
    }
    if (wasPulling) {
      // Snap the tongue back from wherever the prey was.
      this.aim = Math.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)
      this.reach = Math.hypot(e.pos.x - o.pos.x, e.pos.y - o.pos.y)
      this.setState('retract')
    } else {
      this.setState('idle')
    }
  }

  private updateGhost(dt: number): void {
    const g = this.ghost
    if (!g) return
    this.ghostTime += dt
    const apart = Math.hypot(g.pos.x - this.owner.pos.x, g.pos.y - this.owner.pos.y) >= g.radius + this.owner.radius
    if (!g.alive || apart || this.ghostTime >= SPIT_GHOST_MAX) this.ghost = null
  }

  // ───────────────────────────── cosmetics ─────────────────────────────

  private updateLook(dt: number): void {
    const o = this.owner
    let target = this.look
    if (this.state === 'idle') {
      const e = this.enemy
      if (e.alive) target = Math.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)
    } else {
      target = this.aim
    }
    this.look = lerpAngle(this.look, target, damp(12, dt))
  }

  private spawnPad(age: number): void {
    const fx = this.world.effects
    const s = this.world.size
    const r = PAD_RADIUS * (0.85 + 0.3 * fx.random())
    this.pads.push({
      x: r + fx.random() * (s - 2 * r),
      y: r + fx.random() * (s - 2 * r),
      r,
      angle: fx.random() * Math.PI * 2,
      age,
    })
  }

  private updatePads(dt: number): void {
    for (const p of this.pads) p.age += dt
    this.pads = this.pads.filter((p) => p.age < PAD_LIFE)
    this.padTimer -= dt
    if (this.padTimer <= 0 && this.pads.length < MAX_PADS) {
      this.spawnPad(0)
      this.padTimer = 2 + this.world.effects.random()
    }
  }

  /** Current tongue segment from the frog's centre direction, or null when retracted. */
  private tongueEnds(): { from: Vec; to: Vec } | null {
    const o = this.owner
    let length: number
    let angle = this.aim
    switch (this.state) {
      case 'extend':
        length = this.reach * clamp(this.stateTime / EXTEND_TIME, 0, 1)
        break
      case 'retract':
        length = this.reach * (1 - clamp(this.stateTime / RETRACT_TIME, 0, 1))
        break
      case 'pull': {
        const e = this.prey!
        angle = Math.atan2(e.pos.y - o.pos.y, e.pos.x - o.pos.x)
        // Tip sticks to the prey's near rim so it doesn't hide the HP label.
        length = Math.hypot(e.pos.x - o.pos.x, e.pos.y - o.pos.y) - e.radius * 0.75
        break
      }
      default:
        return null
    }
    const mouth = o.radius * 0.8
    if (length <= mouth) return null
    return {
      from: { x: o.pos.x + Math.cos(angle) * mouth, y: o.pos.y + Math.sin(angle) * mouth },
      to: { x: o.pos.x + Math.cos(angle) * length, y: o.pos.y + Math.sin(angle) * length },
    }
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    for (const p of this.pads) {
      const a = Math.min(clamp(p.age / PAD_FADE_IN, 0, 1), clamp((PAD_LIFE - p.age) / PAD_FADE_OUT, 0, 1))
      if (a <= 0) continue
      ctx.save()
      ctx.globalAlpha = fade * a
      drawLilyPad(ctx, p.x, p.y, p.r, p.angle)
      ctx.restore()
    }
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    // A swallowed prey shows as a bulge in the belly (it may be drawn beneath the frog).
    if (this.state === 'swallow' && this.prey) {
      ctx.save()
      ctx.globalAlpha *= 0.45
      ctx.fillStyle = this.prey.color
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, o.radius * 0.72, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    drawFrogFace(ctx, o.pos.x, o.pos.y, o.radius, this.look, this.state === 'idle')
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    const ends = this.tongueEnds()
    if (!ends) return
    ctx.save()
    ctx.globalAlpha = fade
    // Stretched taut while reeling in, floppy while flying.
    const wiggle = this.state === 'pull' ? 0.5 : 1
    drawTongue(ctx, ends.from, ends.to, this.owner.radius, this.world.time, wiggle)
    ctx.restore()
  }
}

/** A lily pad with a wedge cut out, the cut facing `angle`. */
export function drawLilyPad(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number): void {
  const half = Math.asin(clamp(PAD_NOTCH / 2 / r, 0, 1))
  ctx.save()
  ctx.fillStyle = 'rgba(91,170,34,0.55)'
  ctx.strokeStyle = 'rgba(123,226,44,0.75)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.arc(x, y, r, angle + half, angle - half + Math.PI * 2)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Veins radiating from the notch.
  ctx.strokeStyle = 'rgba(123,226,44,0.45)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i <= 4; i++) {
    const a = angle + half + ((Math.PI * 2 - 2 * half) * i) / 5
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8)
  }
  ctx.stroke()
  ctx.restore()
}

/** Bulging eyes on the back rim and, when idle, a tongue nub facing `look`. */
export function drawFrogFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, look: number, nub: boolean): void {
  ctx.save()
  if (nub) {
    ctx.fillStyle = TONGUE_PINK
    ctx.beginPath()
    ctx.arc(x + Math.cos(look) * r * 0.92, y + Math.sin(look) * r * 0.92, r * 0.25, 0, Math.PI * 2)
    ctx.fill()
  }
  const back = look + Math.PI
  const er = r * 0.45
  for (const off of [-0.7, 0.7]) {
    const a = back + off
    const ex = x + Math.cos(a) * r * 0.88
    const ey = y + Math.sin(a) * r * 0.88
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = 'rgba(30,60,10,0.6)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(ex, ey, er, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    // Pupils peer towards the prey.
    ctx.fillStyle = '#0b0b0b'
    ctx.beginPath()
    ctx.arc(ex + Math.cos(look) * er * 0.35, ey + Math.sin(look) * er * 0.35, er * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Pink wiggling tongue from `from` to `to`, with tick marks and a round sticky tip. */
export function drawTongue(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, r: number, time: number, wiggle = 1): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-3) return
  const ux = dx / length
  const uy = dy / length
  const nx = -uy
  const ny = ux
  const segs = Math.max(6, Math.ceil(length / 6))
  const amp = r * 0.16 * wiggle
  const pts: Vec[] = []
  for (let i = 0; i <= segs; i++) {
    const u = i / segs
    const s = u * length
    // Envelope pins both ends so the tongue stays rooted in the mouth and the tip.
    const off = amp * Math.sin(u * Math.PI) * Math.sin(s * 0.09 - time * 24)
    pts.push({ x: from.x + ux * s + nx * off, y: from.y + uy * s + ny * off })
  }
  const width = r * (TONGUE_WIDTH / R)
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const p of pts) ctx.lineTo(p.x, p.y)
  }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = TONGUE_DARK
  ctx.lineWidth = width + 2.5
  path()
  ctx.stroke()
  ctx.strokeStyle = TONGUE_PINK
  ctx.lineWidth = width
  path()
  ctx.stroke()
  // Tick marks across the tongue.
  ctx.strokeStyle = 'rgba(150,30,80,0.7)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  const spacing = r * 0.55
  for (let s = spacing; s < length - r * 0.4; s += spacing) {
    const i = Math.min(segs - 1, Math.floor((s / length) * segs))
    const a = pts[i]
    const b = pts[i + 1]
    const sl = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const px = -(b.y - a.y) / sl
    const py = (b.x - a.x) / sl
    const h = width * 0.32
    ctx.moveTo(a.x + px * h, a.y + py * h)
    ctx.lineTo(a.x - px * h, a.y - py * h)
  }
  ctx.stroke()
  // Sticky tip.
  const tr = r * (TIP_RADIUS / R)
  ctx.fillStyle = TONGUE_PINK
  ctx.strokeStyle = TONGUE_DARK
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(to.x, to.y, tr, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.arc(to.x - tr * 0.3, to.y - tr * 0.3, tr * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function drawFrogPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  drawLilyPad(ctx, cx - r * 0.9, cy + r * 1.2, r * 1.15, -0.6)
  const look = -0.45
  const mouth = { x: cx + Math.cos(look) * r * 0.8, y: cy + Math.sin(look) * r * 0.8 }
  const tip = { x: cx + Math.cos(look) * r * 2.15, y: cy + Math.sin(look) * r * 2.15 }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx - r * 0.25, cy + r * 0.15, r * 0.95, 0, Math.PI * 2)
  ctx.fill()
  drawTongue(ctx, mouth, tip, r, 0.4)
  drawFrogFace(ctx, cx - r * 0.25, cy + r * 0.15, r * 0.95, look, false)
}

export const frogDef: CharacterDef = {
  id: 'frog',
  name: '青蛙',
  nameEn: 'FROG',
  tagline: '舌头一卷，一口吞下',
  rules: [
    `敌人进入 ${TONGUE_RANGE_R} 个身位内时吐出舌头（冷却 ${TONGUE_COOLDOWN} 秒）`,
    `舌头命中 -${HIT_DAMAGE}，并把敌人往回拖，拖拽中每 ${PULL_TICK} 秒 -${PULL_DAMAGE}`,
    `拖到嘴边后整个吞下 ${SWALLOW_TIME} 秒，再朝随机方向吐出去`,
    '本体碰撞没有伤害',
  ],
  palette: { ball: '#7be22c', text: '#ffffff', accent: '#7de02d' },
  mirrorPalette: { ball: '#2f7d1a', text: '#ecfccb', accent: '#4ade80' },
  create: (w, b) => new FrogAbility(w, b),
  drawPortrait: drawFrogPortrait,
}
