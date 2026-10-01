import type { Vec } from '../core/vec'
import type { Ball } from './Ball'

/**
 * Where a ball will be after `t` seconds if it keeps its current velocity,
 * reflecting off the arena walls.
 */
export function predictPosition(ball: Ball, t: number, size: number): Vec {
  const r = ball.radius
  const span = size - 2 * r
  const fold = (p: number, v: number): number => {
    // Unfold the bounce path onto a line, then fold it back into [r, size - r].
    const m = (((p - r + v * t) % (2 * span)) + 2 * span) % (2 * span)
    return r + (m <= span ? m : 2 * span - m)
  }
  return { x: fold(ball.pos.x, ball.vel.x), y: fold(ball.pos.y, ball.vel.y) }
}
