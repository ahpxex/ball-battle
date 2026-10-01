import { type Vec, angleDiff, clamp } from '../core/vec'
import { Ability } from '../engine/Ability'
import { BALL_RADIUS } from '../engine/constants'
import { PIXEL_FONT } from '../render/draw'
import type { CharacterDef } from './types'

const FIRST_SUMMON = 0.7
/** Summon interval at the start of the fight (s). */
export const SUMMON_INTERVAL_START = 1.1
/** The interval shrinks by this much per second of fight time. */
export const SUMMON_INTERVAL_DECAY = 0.025
export const SUMMON_INTERVAL_MIN = 0.5
export const MAX_SKELETONS = 8
/** Skeleton lifetime in seconds (also shown as its number). */
export const SKELETON_LIFE = 4.5
const SKELETON_RADIUS = BALL_RADIUS * 0.6
const SKELETON_SPEED = 180
const SPAWN_MIN_DIST = BALL_RADIUS * 1.5
const SPAWN_MAX_DIST = BALL_RADIUS * 3
const SPAWN_POP = 0.15
/** Fade-to-dark duration once a skeleton's life runs out. */
const DEATH_FADE = 0.4
const FIRST_ARROW = 0.4
export const ARROW_INTERVAL = 1.0
const ARROW_SPEED = 480
const ARROW_LIFE = 2
export const ARROW_DAMAGE = 1
/** Extra reach added to the enemy radius for an arrow tip to count as a hit. */
const ARROW_HIT_SLACK = 3
const ARROW_LENGTH = BALL_RADIUS * 1.1
/** How fast a skeleton's bow swings towards the enemy (rad/s), purely visual. */
const BOW_TURN_RATE = 10

const BONE = '#b9b9c0'
const BONE_DARK = '#1c1a22'
const BONE_TEXT = '#3a3a42'
const BOW = '#7a4a2e'

interface Skeleton {
  pos: Vec
  vel: Vec
  /** Remaining life; once ≤ 0 the skeleton fades out for DEATH_FADE seconds. */
  life: number
  age: number
  /** Seconds until the next arrow. */
  reload: number
  /** Current bow direction (radians). */
  aim: number
}

interface Arrow {
  /** Tip position. */
  pos: Vec
  vel: Vec
  age: number
}

/** Summon interval after `fightTime` seconds of fighting. */
export function summonInterval(fightTime: number): number {
  return Math.max(SUMMON_INTERVAL_MIN, SUMMON_INTERVAL_START - SUMMON_INTERVAL_DECAY * fightTime)
}

/**
 * 死灵巫师 (Necromancer) — has no attack of its own. It keeps raising
 * skeleton archers around itself, faster and faster as the fight drags on.
 * Each skeleton drifts in a straight line bouncing off walls, shoots arrows
 * at the enemy's current position, and crumbles after a few seconds.
 */
export class NecromancerAbility extends Ability {
  private skeletons: Skeleton[] = []
  private arrows: Arrow[] = []
  private timer = FIRST_SUMMON

  override update(dt: number): void {
    if (this.world.combatActive && !this.owner.disarmed) {
      this.timer -= dt
      if (this.timer <= 0) {
        this.timer += summonInterval(this.world.fightTime)
        this.summon()
      }
    }
    this.updateSkeletons(dt)
    this.updateArrows(dt)
  }

  private summon(): void {
    const alive = this.skeletons.filter((k) => k.life > 0).length
    if (alive >= MAX_SKELETONS) return
    const rng = this.world.rng
    const s = this.world.size
    const o = this.owner.pos
    const a = rng.range(0, Math.PI * 2)
    const d = rng.range(SPAWN_MIN_DIST, SPAWN_MAX_DIST)
    const pos = {
      x: clamp(o.x + Math.cos(a) * d, SKELETON_RADIUS, s - SKELETON_RADIUS),
      y: clamp(o.y + Math.sin(a) * d, SKELETON_RADIUS, s - SKELETON_RADIUS),
    }
    const heading = rng.range(0, Math.PI * 2)
    const e = this.enemy.pos
    this.skeletons.push({
      pos,
      vel: { x: Math.cos(heading) * SKELETON_SPEED, y: Math.sin(heading) * SKELETON_SPEED },
      life: SKELETON_LIFE,
      age: 0,
      reload: FIRST_ARROW,
      aim: Math.atan2(e.y - pos.y, e.x - pos.x),
    })
    this.world.effects.burst(pos, {
      count: 12,
      color: ['#2a2533', '#3b3346', '#4c3d66', '#5b4a80'],
      shape: 'smoke',
      speed: [20, 90],
      size: [BALL_RADIUS * 0.25, BALL_RADIUS * 0.5],
      life: [0.3, 0.6],
      endScale: 2,
      drag: 2.5,
      jitter: BALL_RADIUS * 0.4,
    })
    this.world.sound('whoosh', 0.35, 0.6)
  }

  private updateSkeletons(dt: number): void {
    const s = this.world.size
    const r = SKELETON_RADIUS
    const e = this.enemy
    const kept: Skeleton[] = []
    for (const k of this.skeletons) {
      k.age += dt
      k.life -= dt
      if (k.life <= -DEATH_FADE) continue
      kept.push(k)

      k.pos.x += k.vel.x * dt
      k.pos.y += k.vel.y * dt
      if (k.pos.x < r) {
        k.pos.x = r
        k.vel.x = Math.abs(k.vel.x)
      } else if (k.pos.x > s - r) {
        k.pos.x = s - r
        k.vel.x = -Math.abs(k.vel.x)
      }
      if (k.pos.y < r) {
        k.pos.y = r
        k.vel.y = Math.abs(k.vel.y)
      } else if (k.pos.y > s - r) {
        k.pos.y = s - r
        k.vel.y = -Math.abs(k.vel.y)
      }

      const want = Math.atan2(e.pos.y - k.pos.y, e.pos.x - k.pos.x)
      const diff = angleDiff(k.aim, want)
      k.aim += clamp(diff, -BOW_TURN_RATE * dt, BOW_TURN_RATE * dt)

      if (k.life <= 0) continue
      k.reload -= dt
      if (k.reload <= 0 && e.alive && this.world.combatActive) {
        k.reload += ARROW_INTERVAL
        this.fire(k, want)
      }
    }
    this.skeletons = kept
  }

  private fire(k: Skeleton, angle: number): void {
    const cx = Math.cos(angle)
    const cy = Math.sin(angle)
    k.aim = angle
    // Released from the bow string, tip just past the skeleton's rim.
    const start = SKELETON_RADIUS * 0.5 + ARROW_LENGTH
    this.arrows.push({
      pos: { x: k.pos.x + cx * start, y: k.pos.y + cy * start },
      vel: { x: cx * ARROW_SPEED, y: cy * ARROW_SPEED },
      age: 0,
    })
    this.world.sound('throw', 0.2, 1.7)
  }

  private updateArrows(dt: number): void {
    const s = this.world.size
    const e = this.enemy
    const reach = e.radius + ARROW_HIT_SLACK
    const kept: Arrow[] = []
    for (const a of this.arrows) {
      a.age += dt
      a.pos.x += a.vel.x * dt
      a.pos.y += a.vel.y * dt
      if (a.age >= ARROW_LIFE || a.pos.x < 0 || a.pos.x > s || a.pos.y < 0 || a.pos.y > s) continue
      if (e.alive && this.world.combatActive && (a.pos.x - e.pos.x) ** 2 + (a.pos.y - e.pos.y) ** 2 < reach * reach) {
        this.world.damage(e, ARROW_DAMAGE, { kind: 'arrow', source: this.owner, at: { x: a.pos.x, y: a.pos.y } })
        continue
      }
      kept.push(a)
    }
    this.arrows = kept
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    const fade = this.presence
    if (fade <= 0) return
    const r = o.radius * o.drawScale
    const a = -Math.PI / 4
    ctx.save()
    ctx.globalAlpha = fade * o.opacity
    drawSkull(ctx, o.pos.x + Math.cos(a) * r * 0.82, o.pos.y + Math.sin(a) * r * 0.82, r * 0.7, 0.25)
    ctx.restore()
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    ctx.save()
    ctx.globalAlpha = fade
    for (const a of this.arrows) {
      drawArrow(ctx, a.pos.x, a.pos.y, Math.atan2(a.vel.y, a.vel.x), ARROW_LENGTH)
    }
    for (const k of this.skeletons) {
      const pop = clamp(k.age / SPAWN_POP, 0.2, 1)
      const dark = k.life > 0 ? 0 : clamp(-k.life / DEATH_FADE, 0, 1)
      ctx.globalAlpha = fade * (1 - dark * 0.85)
      drawSkeletonArcher(ctx, k.pos.x, k.pos.y, SKELETON_RADIUS * pop, k.aim, Math.max(0, Math.ceil(k.life)), dark)
    }
    ctx.restore()
  }
}

/** Linear blend of two `#rrggbb` colours. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => {
    const ca = (pa >> shift) & 255
    const cb = (pb >> shift) & 255
    return Math.round(ca + (cb - ca) * t)
  }
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

/**
 * A skeleton archer: bone-grey disc with its remaining life, holding a bow
 * on the side facing `aim`. `dark` (0..1) blends it towards black as it dies.
 */
export function drawSkeletonArcher(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  aim: number,
  life: number,
  dark = 0,
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = mixHex(BONE, BONE_DARK, dark)
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = mixHex(BONE_TEXT, '#000000', dark)
  ctx.font = `700 ${Math.round(r * 1.1)}px ${PIXEL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(life), 0, 1)

  // Bow: an arc ≈1.6 ball radii tall bulging towards the target, plus string.
  ctx.rotate(aim)
  const k = r / SKELETON_RADIUS
  const half = BALL_RADIUS * 0.8 * k
  const theta = 1.0
  const rb = half / Math.sin(theta)
  const stringX = r * 0.7
  const cx = stringX - rb * Math.cos(theta)
  ctx.strokeStyle = mixHex('#d8d8dc', '#000000', dark)
  ctx.lineWidth = Math.max(0.6, 1 * k)
  ctx.beginPath()
  ctx.moveTo(stringX, -half)
  ctx.lineTo(stringX, half)
  ctx.stroke()
  ctx.strokeStyle = mixHex(BOW, BONE_DARK, dark)
  ctx.lineWidth = 3.2 * k
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(cx, 0, rb, -theta, theta)
  ctx.stroke()
  ctx.restore()
}

/** A thin white arrow whose tip is at (x, y), pointing along `angle`. */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  const head = length * 0.22
  ctx.strokeStyle = '#f4f4f5'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-length, 0)
  ctx.lineTo(-head * 0.6, 0)
  ctx.stroke()
  // Fletching.
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-length, 0)
  ctx.lineTo(-length - head * 0.5, -head * 0.45)
  ctx.moveTo(-length, 0)
  ctx.lineTo(-length - head * 0.5, head * 0.45)
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-head, -head * 0.45)
  ctx.lineTo(-head, head * 0.45)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** A small white skull with dark sunglasses, `w` wide, centred at (x, y). */
export function drawSkull(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, tilt: number): void {
  const u = w / 2
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  ctx.fillStyle = '#f4f4f5'
  ctx.strokeStyle = '#2a2236'
  ctx.lineWidth = Math.max(1, w * 0.05)
  // Cranium + jaw as one outline.
  ctx.beginPath()
  ctx.arc(0, -u * 0.15, u, Math.PI * 0.82, Math.PI * 0.18)
  ctx.lineTo(u * 0.55, u * 0.75)
  ctx.lineTo(-u * 0.55, u * 0.75)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Teeth.
  ctx.beginPath()
  for (const tx of [-0.2, 0.2]) {
    ctx.moveTo(u * tx, u * 0.48)
    ctx.lineTo(u * tx, u * 0.75)
  }
  ctx.stroke()
  // Nose.
  ctx.fillStyle = '#2a2236'
  ctx.beginPath()
  ctx.moveTo(0, u * 0.12)
  ctx.lineTo(-u * 0.1, u * 0.32)
  ctx.lineTo(u * 0.1, u * 0.32)
  ctx.closePath()
  ctx.fill()
  // Sunglasses: bridge bar plus two lenses.
  ctx.fillStyle = '#111018'
  ctx.fillRect(-u * 0.85, -u * 0.32, u * 1.7, u * 0.12)
  for (const sx of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(sx * u * 0.08, -u * 0.3)
    ctx.lineTo(sx * u * 0.8, -u * 0.3)
    ctx.quadraticCurveTo(sx * u * 0.75, u * 0.08, sx * u * 0.42, u * 0.06)
    ctx.quadraticCurveTo(sx * u * 0.1, u * 0.04, sx * u * 0.08, -u * 0.3)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(-u * 0.62, -u * 0.22, u * 0.18, u * 0.06)
  ctx.fillRect(u * 0.3, -u * 0.22, u * 0.18, u * 0.06)
  ctx.restore()
}

export function drawNecromancerPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const s = r / BALL_RADIUS
  const target = { x: cx + r * 2.4, y: cy - r * 1.9 }
  const archers: [number, number, number][] = [
    [-1.75, -1.3, 3],
    [1.8, 1.35, 2],
    [-1.55, 1.6, 1],
  ]
  // One arrow in flight from the top-left archer.
  const [ax, ay] = archers[0]
  const aim0 = Math.atan2(target.y - (cy + ay * r), target.x - (cx + ax * r))
  drawArrow(ctx, cx + ax * r + Math.cos(aim0) * r * 2.1, cy + ay * r + Math.sin(aim0) * r * 2.1, aim0, ARROW_LENGTH * s)
  for (const [dx, dy, life] of archers) {
    const x = cx + dx * r
    const y = cy + dy * r
    drawSkeletonArcher(ctx, x, y, SKELETON_RADIUS * s, Math.atan2(target.y - y, target.x - x), life)
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2)
  ctx.fill()
  const a = -Math.PI / 4
  drawSkull(ctx, cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75, r * 0.65, 0.25)
}

export const necromancerDef: CharacterDef = {
  id: 'necromancer',
  name: '死灵巫师',
  nameEn: 'NECROMANCER',
  tagline: '骷髅大军',
  rules: [
    `本体没有攻击，每 ${SUMMON_INTERVAL_START} 秒在身边召唤一个骷髅弓箭手（最多 ${MAX_SKELETONS} 个）`,
    `召唤间隔随战斗时间越来越短，最快 ${SUMMON_INTERVAL_MIN} 秒一个`,
    `骷髅只存在 ${SKELETON_LIFE} 秒，一边乱飘一边每 ${ARROW_INTERVAL} 秒朝敌人射一箭`,
    `每支箭命中 -${ARROW_DAMAGE}`,
  ],
  palette: { ball: '#3a2070', text: '#ffffff', accent: '#7a55c9' },
  mirrorPalette: { ball: '#1f2a5c', text: '#e0e7ff', accent: '#6d82e0' },
  create: (w, b) => new NecromancerAbility(w, b),
  drawPortrait: drawNecromancerPortrait,
}
