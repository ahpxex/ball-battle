import { Ability } from '../engine/Ability'
import type { Ball } from '../engine/Ball'
import { BASE_SPEED } from '../engine/constants'
import type { BallContact, DamageOptions, WallBounce } from '../engine/types'
import type { World } from '../engine/World'
import { CHARACTERS } from './registry'
import type { CharacterDef } from './types'

const FIRST_ROLL = 0.7
/** Neutral pause between two forms (s). */
export const NEUTRAL_TIME = 0.5
/** Colour-cycling roll before a form locks in (s). */
const ROLL_TIME = 0.8
const ROLL_FLICKER = 0.15
/** How long each borrowed form lasts (s). */
export const FORM_TIME = 12.0
/**
 * Borrowed forms hit harder: every transformation restarts the form's
 * cooldowns and ramp-ups, which this compensates for.
 */
export const FORM_DAMAGE_BONUS = 1.5
const NEUTRAL_COLOR = '#2a1650'

type Phase = 'neutral' | 'roll' | 'form'

/**
 * 模仿者 — has no weapon of its own. It keeps rolling a random character
 * from the roster and becomes it for a few seconds, using that character's
 * full ability, then goes back to neutral and rolls again. HP carries over.
 */
export class MimicAbility extends Ability {
  private phase: Phase = 'neutral'
  private timer = FIRST_ROLL
  private form: Ability | null = null
  private formDef: CharacterDef | null = null
  private next: CharacterDef | null = null
  private readonly baseColor: string
  private readonly baseText: string

  constructor(world: World, owner: Ball) {
    super(world, owner)
    this.baseColor = owner.color
    this.baseText = owner.textColor
    owner.color = NEUTRAL_COLOR
  }

  /** Characters the mimic can turn into (everyone but itself). */
  private get pool(): readonly CharacterDef[] {
    return CHARACTERS.filter((c) => c.id !== 'mimic')
  }

  override prePhysics(dt: number): void {
    this.form?.prePhysics(dt)
  }

  override update(dt: number): void {
    const o = this.owner
    // A rooted or disarmed mimic can't start a transformation.
    const blocked = o.disarmed || o.rooted || !this.world.combatActive
    if (this.phase !== 'form' && !blocked) this.timer -= dt
    switch (this.phase) {
      case 'neutral':
        if (this.timer <= 0) {
          this.phase = 'roll'
          this.timer = ROLL_TIME
          this.next = this.world.rng.pick(this.pool)
          this.world.sound('roll', 0.3, 0.7)
        }
        break
      case 'roll':
        // Flicker through random roster colours while rolling.
        o.color = this.pool[Math.floor(this.world.time / ROLL_FLICKER) % this.pool.length].palette.ball
        if (this.timer <= 0) this.transform()
        break
      case 'form':
        this.timer -= dt
        this.form?.update(dt)
        if (this.timer <= 0) this.revert()
        break
    }
  }

  private transform(): void {
    const def = this.next ?? this.world.rng.pick(this.pool)
    const o = this.owner
    this.formDef = def
    this.form = def.create(this.world, o)
    this.phase = 'form'
    this.timer = FORM_TIME
    o.color = def.palette.ball
    o.textColor = def.palette.text
    this.world.effects.burst(o.pos, { count: 22, color: [def.palette.accent, '#ffffff'], speed: [80, 260], size: [2, 4.5], life: [0.3, 0.6] })
    this.world.sound('jackpot', 0.5, 0.8)
  }

  private revert(): void {
    this.clearFormState()
    this.form = null
    this.formDef = null
    this.phase = 'neutral'
    this.timer = NEUTRAL_TIME
    this.owner.color = NEUTRAL_COLOR
    this.owner.textColor = this.baseText
    this.world.effects.burst(this.owner.pos, { count: 16, color: ['#7c3aed', '#c4b5fd'], speed: [60, 200], size: [2, 4], life: [0.3, 0.5] })
  }

  /** Undo any lasting changes a borrowed ability may have made to either ball. */
  private clearFormState(): void {
    const o = this.owner
    const e = this.enemy
    o.pinned = false
    o.invulnerable = false
    o.attachedTo = null
    o.baseSpeed = BASE_SPEED
    if (e.attachedTo === o) e.attachedTo = null
    e.opacity = 1
    e.drawScale = 1
    if (e.rooted) e.endRoot()
  }

  override onWallBounce(e: WallBounce): void {
    this.form?.onWallBounce(e)
  }

  override onBallContact(c: BallContact): void {
    this.form?.onBallContact(c)
  }

  override onOwnerDamaged(amount: number, opts: DamageOptions): void {
    this.form?.onOwnerDamaged(amount, opts)
  }

  override get outgoingDamageScale(): number {
    return this.form ? FORM_DAMAGE_BONUS : 1
  }

  override collidesWith(other: Ball): boolean {
    return this.form ? this.form.collidesWith(other) : true
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    this.form?.renderBack(ctx)
  }

  override renderOverlay(ctx: CanvasRenderingContext2D): void {
    this.form?.renderOverlay(ctx)
  }

  override renderUnderBall(ctx: CanvasRenderingContext2D): void {
    const o = this.owner
    if (this.phase === 'neutral') {
      // A faint purple glow so the near-black ball stays visible.
      const g = ctx.createRadialGradient(o.pos.x, o.pos.y, o.radius * 0.8, o.pos.x, o.pos.y, o.radius * 1.5)
      g.addColorStop(0, 'rgba(139,92,246,0.35)')
      g.addColorStop(1, 'rgba(139,92,246,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, o.radius * 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
    this.form?.renderUnderBall(ctx)
  }

  override renderOverBall(ctx: CanvasRenderingContext2D): void {
    this.form?.renderOverBall(ctx)
    const o = this.owner
    // Remaining form time as a thin ring around the ball.
    if (this.phase === 'form' && this.formDef) {
      ctx.save()
      ctx.strokeStyle = this.formDef.palette.accent
      ctx.globalAlpha = 0.8
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(o.pos.x, o.pos.y, o.radius + 4, -Math.PI / 2, -Math.PI / 2 + (this.timer / FORM_TIME) * Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  override renderFront(ctx: CanvasRenderingContext2D): void {
    this.form?.renderFront(ctx)
  }

  /** Display name of the current form, for UI. */
  get formName(): string | null {
    return this.formDef?.name ?? null
  }

  /** The mimic's own colour, restored if a mirror palette was assigned. */
  get ownColor(): string {
    return this.baseColor
  }
}

export function drawMimicPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  // Ghostly copies in other characters' colours behind the mimic.
  const ghosts: [number, number, string][] = [
    [-1.5, -1.3, '#8e1b1b'],
    [1.6, -1.2, '#8b5cf6'],
    [1.4, 1.5, '#f5b326'],
    [-1.5, 1.4, '#7cc520'],
  ]
  for (const [dx, dy, c] of ghosts) {
    ctx.globalAlpha = 0.45
    ctx.fillStyle = c
    ctx.beginPath()
    ctx.arc(cx + dx * r, cy + dy * r, r * 0.55, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.4)
  g.addColorStop(0, 'rgba(139,92,246,0.45)')
  g.addColorStop(1, 'rgba(139,92,246,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

export const mimicDef: CharacterDef = {
  id: 'mimic',
  name: '模仿者',
  nameEn: 'MIMIC BALL',
  tagline: '你会的我都会',
  rules: [
    `自己没有武器：随机抽取一名其他角色，变身 ${FORM_TIME} 秒并使用它的全部能力`,
    `变身期间造成的伤害 ×${FORM_DAMAGE_BONUS}`,
    `变身结束后恢复原形 ${NEUTRAL_TIME} 秒，再抽下一个`,
    '被定身或缴械时无法变身；血量一直保留',
  ],
  palette: { ball: '#2a1650', text: '#ffffff', accent: '#8b5cf6' },
  mirrorPalette: { ball: '#3f1d38', text: '#fce7f3', accent: '#db2777' },
  create: (w, b) => new MimicAbility(w, b),
  drawPortrait: drawMimicPortrait,
}
