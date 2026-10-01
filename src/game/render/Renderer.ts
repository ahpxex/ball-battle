import type { Ball } from '../engine/Ball'
import type { Particle } from '../engine/effects'
import type { World } from '../engine/World'
import { ARENA_BG, PIXEL_FONT } from './draw'

/** Margin around the arena (world units) so the border glow isn't clipped. */
const PAD = 12

export interface ArenaTheme {
  /** Border gradient, left fighter → right fighter. */
  accents: readonly [string, string]
}

/**
 * Draws a World onto a square canvas. Stateless apart from canvas sizing,
 * so it can render any world (e.g. after a restart) without reset.
 */
export class Renderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private scale = 1
  private cssSize = 0

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    this.canvas = canvas
    this.ctx = ctx
  }

  /** Resize the backing store for a square canvas of `cssSize` CSS pixels. */
  resize(cssSize: number, dpr: number): void {
    if (cssSize === this.cssSize && this.canvas.width === Math.round(cssSize * dpr)) return
    this.cssSize = cssSize
    this.canvas.width = Math.round(cssSize * dpr)
    this.canvas.height = Math.round(cssSize * dpr)
  }

  render(world: World, theme: ArenaTheme): void {
    const ctx = this.ctx
    const size = world.size
    const px = this.canvas.width
    this.scale = px / (size + PAD * 2)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, px, px)

    const shake = world.shake
    const sx = shake > 0.05 ? (Math.random() * 2 - 1) * shake : 0
    const sy = shake > 0.05 ? (Math.random() * 2 - 1) * shake : 0
    ctx.setTransform(this.scale, 0, 0, this.scale, (PAD + sx) * this.scale, (PAD + sy) * this.scale)

    ctx.fillStyle = ARENA_BG
    ctx.fillRect(0, 0, size, size)

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, size, size)
    ctx.clip()

    this.drawParticles(world.effects.particles, false)
    for (const a of world.abilities) a.renderBack(ctx)
    for (const a of world.abilities) a.renderOverlay(ctx)

    // Draw a latched (pinned) ball last so it sits on top of its prey.
    const balls = [...world.balls].sort((a, b) => Number(a.pinned) - Number(b.pinned))
    for (const b of balls) this.drawBall(world, b)

    for (const a of world.abilities) a.renderFront(ctx)
    this.drawParticles(world.effects.particles, true)
    this.drawTexts(world)
    ctx.restore()

    this.drawBorder(world, theme)
  }

  private drawBall(world: World, b: Ball): void {
    const ctx = this.ctx
    const ability = world.abilityOf(b)
    let alpha = b.opacity
    let scale = b.drawScale
    if (!b.alive) {
      const t = (world.time - b.deathTime) / 0.35
      if (t >= 1) return
      alpha = (1 - t) * b.opacity
      scale = (1 + t * 0.4) * b.drawScale
    }
    const r = b.radius * scale

    ctx.save()
    ctx.globalAlpha = alpha
    if (b.alive) ability.renderUnderBall(ctx)

    ctx.fillStyle = b.color
    ctx.beginPath()
    ctx.arc(b.pos.x, b.pos.y, r, 0, Math.PI * 2)
    ctx.fill()

    if (b.poison.length > 0) this.drawPoison(world, b)

    if (b.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, b.flash / 0.12) * 0.75})`
      ctx.beginPath()
      ctx.arc(b.pos.x, b.pos.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    if (b.alive) ability.renderOverBall(ctx)
    if (b.alive && b.disarmed) this.drawDisarmed(world, b)

    const hp = Math.max(0, Math.ceil(b.hp))
    ctx.font = `700 ${hp >= 100 ? 21 : 23}px ${PIXEL_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = b.textColor
    ctx.fillText(String(hp), b.pos.x, b.pos.y + 1)
    ctx.restore()
  }

  /** Toxic sludge filling the bottom of a poisoned ball, with drips. */
  private drawPoison(world: World, b: Ball): void {
    const ctx = this.ctx
    const r = b.radius
    const level = Math.min(0.62, 0.22 + 0.08 * b.poison.length)
    const top = b.pos.y + r - level * r * 2
    const t = world.time
    ctx.save()
    ctx.beginPath()
    ctx.arc(b.pos.x, b.pos.y, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = '#5fbf1f'
    ctx.beginPath()
    ctx.moveTo(b.pos.x - r, b.pos.y + r)
    for (let x = -r; x <= r; x += 4) {
      ctx.lineTo(b.pos.x + x, top + Math.sin(x * 0.25 + t * 6) * 2.2)
    }
    ctx.lineTo(b.pos.x + r, b.pos.y + r)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // Drips hanging under the ball.
    ctx.fillStyle = '#5fbf1f'
    for (let i = 0; i < 4; i++) {
      const fx = -0.55 + i * 0.36
      const x = b.pos.x + fx * r
      const baseY = b.pos.y + Math.sqrt(Math.max(0, r * r - (fx * r) ** 2)) - 2
      const len = 5 + 5 * (0.5 + 0.5 * Math.sin(t * 3 + i * 1.7))
      ctx.beginPath()
      ctx.moveTo(x - 2.4, baseY)
      ctx.lineTo(x + 2.4, baseY)
      ctx.lineTo(x + 1.6, baseY + len)
      ctx.arc(x, baseY + len, 1.8, 0, Math.PI)
      ctx.closePath()
      ctx.fill()
    }
  }

  /** Crossed-out sword floating above a disarmed ball. */
  private drawDisarmed(world: World, b: Ball): void {
    const ctx = this.ctx
    const x = b.pos.x + b.radius * 0.75
    const y = b.pos.y - b.radius - 10 + Math.sin(world.time * 5) * 1.5
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-Math.PI / 4)
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(-1.6, -9, 3.2, 12)
    ctx.beginPath()
    ctx.moveTo(-1.6, -9)
    ctx.lineTo(0, -12)
    ctx.lineTo(1.6, -9)
    ctx.fill()
    ctx.fillRect(-4.5, 3, 9, 2)
    ctx.fillRect(-1.2, 5, 2.4, 4)
    ctx.restore()
    ctx.save()
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x - 6, y - 6)
    ctx.lineTo(x + 6, y + 6)
    ctx.moveTo(x + 6, y - 6)
    ctx.lineTo(x - 6, y + 6)
    ctx.stroke()
    ctx.restore()
  }

  private drawParticles(particles: readonly Particle[], front: boolean): void {
    const ctx = this.ctx
    for (const p of particles) {
      if (p.front !== front) continue
      const f = p.life / p.maxLife
      const s = p.size * (p.endScale + (1 - p.endScale) * f)
      switch (p.shape) {
        case 'dot':
          ctx.globalAlpha = Math.min(1, f * 1.6)
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2)
          ctx.fill()
          break
        case 'smoke':
          ctx.globalAlpha = f * 0.45
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, s, 0, Math.PI * 2)
          ctx.fill()
          break
        case 'spark': {
          ctx.globalAlpha = Math.min(1, f * 2)
          ctx.strokeStyle = p.color
          ctx.lineWidth = Math.max(1, s * 0.6)
          const sp = Math.hypot(p.vx, p.vy) || 1
          const l = Math.min(14, s * 2 + sp * 0.02)
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - (p.vx / sp) * l, p.y - (p.vy / sp) * l)
          ctx.stroke()
          break
        }
        case 'shard':
          ctx.globalAlpha = Math.min(1, f * 2)
          ctx.fillStyle = p.color
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rotation)
          ctx.fillRect(-s, -s * 0.5, s * 2, s)
          ctx.restore()
          break
        case 'ring':
          ctx.globalAlpha = f * 0.8
          ctx.strokeStyle = p.color
          ctx.lineWidth = 3 * f + 0.5
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * (p.endScale - (p.endScale - 1) * f), 0, Math.PI * 2)
          ctx.stroke()
          break
      }
    }
    ctx.globalAlpha = 1
  }

  private drawTexts(world: World): void {
    const ctx = this.ctx
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const t of world.effects.texts) {
      const age = t.maxLife - t.life
      const pop = age < 0.1 ? 1.35 - age * 3.5 : 1
      const alpha = Math.min(1, (t.life / t.maxLife) * 2.2)
      ctx.globalAlpha = alpha
      ctx.font = `700 ${Math.round(t.size * pop)}px ${PIXEL_FONT}`
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.lineWidth = 4
      ctx.strokeText(t.text, t.x, t.y)
      ctx.fillStyle = t.color
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.globalAlpha = 1
  }

  private drawBorder(world: World, theme: ArenaTheme): void {
    const ctx = this.ctx
    const s = world.size
    const g = ctx.createLinearGradient(0, 0, s, 0)
    g.addColorStop(0, theme.accents[0])
    g.addColorStop(1, theme.accents[1])
    ctx.save()
    ctx.strokeStyle = g
    ctx.lineWidth = 3
    ctx.shadowColor = world.overtime ? '#c026d3' : 'rgba(255,255,255,0.25)'
    ctx.shadowBlur = world.overtime ? 18 + Math.sin(world.time * 8) * 8 : 12
    ctx.globalAlpha = 0.85
    ctx.strokeRect(-1.5, -1.5, s + 3, s + 3)
    ctx.restore()
  }
}
