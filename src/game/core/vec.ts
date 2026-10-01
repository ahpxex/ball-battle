export interface Vec {
  x: number
  y: number
}

export const vec = (x = 0, y = 0): Vec => ({ x, y })
export const copy = (v: Vec): Vec => ({ x: v.x, y: v.y })
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (v: Vec, s: number): Vec => ({ x: v.x * s, y: v.y * s })
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x
export const len = (v: Vec): number => Math.hypot(v.x, v.y)
export const lenSq = (v: Vec): number => v.x * v.x + v.y * v.y
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y)
export const distSq = (a: Vec, b: Vec): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2
export const perp = (v: Vec): Vec => ({ x: -v.y, y: v.x })
export const fromAngle = (angle: number, length = 1): Vec => ({
  x: Math.cos(angle) * length,
  y: Math.sin(angle) * length,
})
export const angleOf = (v: Vec): number => Math.atan2(v.y, v.x)
export const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

export function normalize(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y)
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 }
}

/** In-place helpers for hot paths. */
export function addInPlace(target: Vec, v: Vec, s = 1): void {
  target.x += v.x * s
  target.y += v.y * s
}

export function setVec(target: Vec, x: number, y: number): void {
  target.x = x
  target.y = y
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDiff(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

export function lerpAngle(from: number, to: number, t: number): number {
  return from + angleDiff(from, to) * t
}

/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt)
