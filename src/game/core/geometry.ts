import { type Vec, clamp, dist, sub, dot, cross } from './vec'

export function closestPointOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const l2 = abx * abx + aby * aby
  if (l2 < 1e-9) return { x: a.x, y: a.y }
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1)
  return { x: a.x + abx * t, y: a.y + aby * t }
}

export function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  return dist(p, closestPointOnSegment(p, a, b))
}

export interface OrientedBox {
  center: Vec
  angle: number
  halfLength: number
  halfWidth: number
}

/**
 * Circle vs oriented rectangle. Returns the closest point on the box to the
 * circle center when overlapping, otherwise null.
 */
export function circleBoxContact(center: Vec, radius: number, box: OrientedBox): Vec | null {
  const c = Math.cos(box.angle)
  const s = Math.sin(box.angle)
  const dx = center.x - box.center.x
  const dy = center.y - box.center.y
  // Into box-local space.
  const lx = dx * c + dy * s
  const ly = -dx * s + dy * c
  const cx = clamp(lx, -box.halfLength, box.halfLength)
  const cy = clamp(ly, -box.halfWidth, box.halfWidth)
  const ddx = lx - cx
  const ddy = ly - cy
  if (ddx * ddx + ddy * ddy > radius * radius) return null
  return { x: box.center.x + cx * c - cy * s, y: box.center.y + cx * s + cy * c }
}

export function pointInTriangle(p: Vec, a: Vec, b: Vec, c: Vec): boolean {
  const d1 = cross(sub(b, a), sub(p, a))
  const d2 = cross(sub(c, b), sub(p, b))
  const d3 = cross(sub(a, c), sub(p, c))
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/** Distance from a point to a filled triangle (0 when inside). */
export function distanceToTriangle(p: Vec, a: Vec, b: Vec, c: Vec): number {
  if (pointInTriangle(p, a, b, c)) return 0
  return Math.min(distanceToSegment(p, a, b), distanceToSegment(p, b, c), distanceToSegment(p, c, a))
}

export interface PolylineSample {
  pos: Vec
  /** Direction of travel at the sample, radians. */
  angle: number
}

/**
 * An immutable polyline parametrised by arc length. Sampling outside
 * [0, length] extrapolates along the end tangents so moving objects can enter
 * and leave smoothly.
 */
export class Polyline {
  readonly points: readonly Vec[]
  readonly cumulative: readonly number[]
  readonly length: number

  constructor(points: readonly Vec[]) {
    if (points.length < 2) throw new Error('Polyline needs at least two points')
    this.points = points
    const cum: number[] = [0]
    for (let i = 1; i < points.length; i++) {
      cum.push(cum[i - 1] + dist(points[i - 1], points[i]))
    }
    this.cumulative = cum
    this.length = cum[cum.length - 1]
  }

  private segmentIndex(d: number): number {
    // Binary search for the segment containing arc length d.
    let lo = 0
    let hi = this.cumulative.length - 2
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.cumulative[mid] <= d) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  sample(d: number): PolylineSample {
    const pts = this.points
    if (d <= 0) {
      const a = pts[0]
      const angle = this.segmentAngle(0)
      return { pos: { x: a.x + Math.cos(angle) * d, y: a.y + Math.sin(angle) * d }, angle }
    }
    if (d >= this.length) {
      const last = pts.length - 1
      const b = pts[last]
      const angle = this.segmentAngle(last - 1)
      const over = d - this.length
      return { pos: { x: b.x + Math.cos(angle) * over, y: b.y + Math.sin(angle) * over }, angle }
    }
    const i = this.segmentIndex(d)
    const a = pts[i]
    const b = pts[i + 1]
    const segLen = this.cumulative[i + 1] - this.cumulative[i]
    const t = segLen > 1e-9 ? (d - this.cumulative[i]) / segLen : 0
    return {
      pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    }
  }

  private segmentAngle(i: number): number {
    // Skip degenerate segments so end tangents are meaningful.
    const pts = this.points
    let j = i
    while (j < pts.length - 1 && dist(pts[j], pts[j + 1]) < 1e-6) j++
    if (j >= pts.length - 1) j = i
    const a = pts[j]
    const b = pts[Math.min(j + 1, pts.length - 1)]
    return Math.atan2(b.y - a.y, b.x - a.x)
  }
}

/** Reflects velocity v about a unit normal n. */
export function reflect(v: Vec, n: Vec): Vec {
  const d = 2 * dot(v, n)
  return { x: v.x - d * n.x, y: v.y - d * n.y }
}
