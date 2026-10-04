import type { OrientedBox } from '../core/geometry'
import type { Vec } from '../core/vec'

/** Solid arena floor. Track rails rely on painting this color between them. */
export const ARENA_BG = '#050507'
export const PIXEL_FONT = '"Silkscreen", "Press Start 2P", ui-monospace, monospace'

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export function polylinePath(ctx: CanvasRenderingContext2D, pts: readonly Vec[]): void {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
}

// ───────────────────────────── Vampire ─────────────────────────────

/** Two white fangs on the ball rim, centred on `angle`. */
export function drawFangs(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, angle: number, length = 10): void {
  ctx.fillStyle = '#f8fafc'
  for (const offset of [-0.36, 0.36]) {
    const a = angle + offset
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const baseR = radius - 2
    const bx = cx + ca * baseR
    const by = cy + sa * baseR
    // Perpendicular half-width of the fang base.
    const px = -sa * 3.6
    const py = ca * 3.6
    ctx.beginPath()
    ctx.moveTo(bx + px, by + py)
    ctx.lineTo(bx - px, by - py)
    ctx.lineTo(cx + Math.cos(a) * (radius + length), cy + Math.sin(a) * (radius + length))
    ctx.closePath()
    ctx.fill()
  }
}

// ───────────────────────────── Conductor ─────────────────────────────

export function drawTrack(ctx: CanvasRenderingContext2D, pts: readonly Vec[], alpha = 1): void {
  if (pts.length < 2 || alpha <= 0) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'
  // Sleepers: a thick dashed stroke reads as perpendicular ties.
  polylinePath(ctx, pts)
  ctx.setLineDash([4, 7])
  ctx.strokeStyle = '#6b4423'
  ctx.lineWidth = 27
  ctx.stroke()
  ctx.setLineDash([])
  // Rails: a light stroke with the floor painted back in the middle.
  ctx.strokeStyle = '#e7e5e4'
  ctx.lineWidth = 16
  ctx.stroke()
  ctx.strokeStyle = ARENA_BG
  ctx.lineWidth = 11
  ctx.stroke()
  ctx.restore()
}

function withBox(ctx: CanvasRenderingContext2D, box: OrientedBox, draw: () => void): void {
  ctx.save()
  ctx.translate(box.center.x, box.center.y)
  ctx.rotate(box.angle)
  draw()
  ctx.restore()
}

export function drawWagon(ctx: CanvasRenderingContext2D, box: OrientedBox): void {
  const l = box.halfLength
  const w = box.halfWidth
  withBox(ctx, box, () => {
    ctx.fillStyle = '#2b1608'
    roundRectPath(ctx, -l, -w, l * 2, w * 2, 3)
    ctx.fill()
    ctx.fillStyle = '#7a3e19'
    roundRectPath(ctx, -l + 2, -w + 2, l * 2 - 4, w * 2 - 4, 2)
    ctx.fill()
    ctx.fillStyle = '#9a5428'
    ctx.fillRect(-l + 5, -w + 5, l * 2 - 10, w * 2 - 10)
    // Plank lines.
    ctx.strokeStyle = 'rgba(43,22,8,0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = -l + 10; x < l - 6; x += 7) {
      ctx.moveTo(x, -w + 5)
      ctx.lineTo(x, w - 5)
    }
    ctx.stroke()
    // Coupling stub at the back.
    ctx.fillStyle = '#a8a29e'
    ctx.fillRect(-l - 4, -1.5, 4, 3)
  })
}

export function drawEngine(ctx: CanvasRenderingContext2D, box: OrientedBox, time: number): void {
  const l = box.halfLength
  const w = box.halfWidth
  withBox(ctx, box, () => {
    ctx.fillStyle = '#0a0a0a'
    roundRectPath(ctx, -l, -w, l * 2, w * 2, 5)
    ctx.fill()
    ctx.strokeStyle = '#3f3f46'
    ctx.lineWidth = 1.5
    ctx.stroke()
    // Red cab at the back and red nose cone.
    ctx.fillStyle = '#dc2626'
    roundRectPath(ctx, -l, -w, 10, w * 2, 3)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(l - 7, -w + 1)
    ctx.quadraticCurveTo(l + 5, 0, l - 7, w - 1)
    ctx.closePath()
    ctx.fill()
    // Gold boiler bands.
    ctx.fillStyle = '#ca8a04'
    ctx.fillRect(-l + 13, -w + 2, 2.5, w * 2 - 4)
    ctx.fillRect(l - 12, -w + 2, 2.5, w * 2 - 4)
    // Rivet lights, gently blinking.
    const blink = 0.65 + 0.35 * Math.sin(time * 14)
    ctx.fillStyle = `rgba(250,204,21,${blink})`
    for (const x of [-l + 20, -l + 27, -l + 34]) {
      ctx.beginPath()
      ctx.arc(x, 0, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
    // Funnel.
    ctx.fillStyle = '#27272a'
    ctx.beginPath()
    ctx.arc(l - 18, 0, 4.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ca8a04'
    ctx.lineWidth = 1.2
    ctx.stroke()
  })
}

// ───────────────────────────── Toxic spike ─────────────────────────────

export function drawSpikeShape(ctx: CanvasRenderingContext2D, tip: Vec, left: Vec, right: Vec, alpha = 1): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.moveTo(left.x, left.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(right.x, right.y)
  ctx.closePath()
  ctx.fillStyle = '#3f7a1c'
  ctx.fill()
  // Lit half for a faceted look.
  const midX = (left.x + right.x) / 2
  const midY = (left.y + right.y) / 2
  ctx.beginPath()
  ctx.moveTo(left.x, left.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(midX, midY)
  ctx.closePath()
  ctx.fillStyle = '#6cc33a'
  ctx.fill()
  ctx.strokeStyle = '#1f3d0e'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(left.x, left.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.lineTo(right.x, right.y)
  ctx.stroke()
  ctx.restore()
}

// ───────────────────────────── Anchor ─────────────────────────────

/** A two-pronged barbed anchor pointing along +angle, ring at the back. */
export function drawAnchor(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale = 1): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'

  // Eye ring.
  ctx.strokeStyle = '#a1a1aa'
  ctx.lineWidth = 2.6
  ctx.beginPath()
  ctx.arc(-15, 0, 4, 0, Math.PI * 2)
  ctx.stroke()

  const metal = ctx.createLinearGradient(0, -16, 0, 16)
  metal.addColorStop(0, '#f4f4f5')
  metal.addColorStop(0.5, '#a1a1aa')
  metal.addColorStop(1, '#e4e4e7')
  ctx.fillStyle = metal
  ctx.strokeStyle = '#3f3f46'
  ctx.lineWidth = 1.2

  // Shank.
  roundRectPath(ctx, -11, -2.6, 20, 5.2, 2)
  ctx.fill()
  ctx.stroke()

  // Two curved barbed prongs.
  for (const s of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(6, -2 * s)
    ctx.quadraticCurveTo(13, -11 * s, 2, -17 * s)
    ctx.lineTo(-4, -18 * s)
    ctx.lineTo(1, -13 * s)
    ctx.quadraticCurveTo(6, -8 * s, 2, -2.5 * s)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  // Centre spike.
  ctx.beginPath()
  ctx.moveTo(6, -3.4)
  ctx.lineTo(21, 0)
  ctx.lineTo(6, 3.4)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** A chain of small links between two points. */
export function drawChain(ctx: CanvasRenderingContext2D, from: Vec, to: Vec, slack = 0): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 2) return
  const angle = Math.atan2(dy, dx)
  const step = 7
  const n = Math.max(1, Math.floor(length / step))
  ctx.save()
  ctx.strokeStyle = '#d4d4d8'
  ctx.lineWidth = 1.6
  for (let i = 0; i <= n; i++) {
    const t = i / n
    // A slight sag perpendicular to the chain when it is not taut.
    const sag = Math.sin(t * Math.PI) * slack
    const x = from.x + dx * t - Math.sin(angle) * sag
    const y = from.y + dy * t + Math.cos(angle) * sag
    ctx.beginPath()
    if (i % 2 === 0) ctx.ellipse(x, y, 3.6, 1.9, angle, 0, Math.PI * 2)
    else ctx.ellipse(x, y, 3.2, 1.2, angle + Math.PI / 2, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}
