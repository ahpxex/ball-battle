import { type OrientedBox, Polyline, circleBoxContact } from '../core/geometry'
import { type Vec, copy, dist, normalize, sub } from '../core/vec'
import { Ability } from '../engine/Ability'
import type { WallBounce } from '../engine/types'
import { drawEngine, drawTrack, drawWagon } from '../render/draw'
import type { CharacterDef } from './types'

/** Wall bounces recorded into one track after the starting bounce. */
export const TRACK_BOUNCES = 3
/** Minimum spacing between recorded track points. */
const POINT_SPACING = 9
const TRAIN_DELAY = 0.25
const TRAIN_SPEED = 820
const ENGINE_LENGTH = 46
const WAGON_LENGTH = 34
const CAR_GAP = 6
const CAR_HALF_WIDTH = 12
export const BASE_WAGONS = 8
export const WAGONS_PER_RUN = 3
const MAX_WAGONS = 24
export const ENGINE_DAMAGE = 15
export const WAGON_DAMAGE = 10
/** Each car can hit the enemy at most once per run, and a run lands at most this many hits. */
export const MAX_HITS_PER_RUN = 3
/** Knockback away from the track, plus a smaller push along the direction of travel. */
const KNOCK_SIDE = 200
const KNOCK_FORWARD = 240
const FADE_DURATION = 0.5

interface Laying {
  points: Vec[]
  bounces: number
}

/** One completed track and the train travelling down it. */
interface Run {
  track: Polyline
  head: number
  wait: number
  wagons: number
  hitCars: Set<number>
  /** 1 while the train is on the track, then fades to 0. */
  alpha: number
}

interface Car {
  box: OrientedBox
  engine: boolean
}

/**
 * 列车长 — lays railway track along its own path, wall to wall. Once a
 * track is complete a train thunders down it while the conductor already
 * starts laying the next one. Every train has more wagons, but a single
 * train can only land a limited number of hits, so longer trains are
 * harder to dodge rather than deadlier.
 */
export class ConductorAbility extends Ability {
  private laying: Laying | null = null
  private runs: Run[] = []
  private runCount = 0

  override onWallBounce(e: WallBounce): void {
    const lay = this.laying
    if (!lay) {
      if (this.owner.disarmed) return
      this.laying = { points: [copy(e.point), copy(this.owner.pos)], bounces: 0 }
      this.world.sound('place', 0.5, 0.7)
      return
    }
    lay.points.push(copy(this.owner.pos))
    lay.bounces += 1
    if (lay.bounces < TRACK_BOUNCES) return
    lay.points.push(copy(e.point))
    this.runs.push({
      track: new Polyline(lay.points),
      head: 0,
      wait: TRAIN_DELAY,
      wagons: Math.min(MAX_WAGONS, BASE_WAGONS + WAGONS_PER_RUN * this.runCount),
      hitCars: new Set(),
      alpha: 1,
    })
    this.runCount += 1
    this.laying = null
    this.world.sound('trainHorn', 0.8)
  }

  override update(dt: number): void {
    const lay = this.laying
    if (lay) {
      const last = lay.points[lay.points.length - 1]
      if (dist(last, this.owner.pos) >= POINT_SPACING) lay.points.push(copy(this.owner.pos))
    }
    for (const run of this.runs) {
      if (run.wait > 0) {
        run.wait -= dt
        continue
      }
      if (run.head - this.trainLength(run.wagons) > run.track.length + 10) {
        run.alpha -= dt / FADE_DURATION
        continue
      }
      run.head += TRAIN_SPEED * dt
      this.checkTrainHits(run)
    }
    this.runs = this.runs.filter((r) => r.alpha > 0)
  }

  private trainLength(wagons: number): number {
    return ENGINE_LENGTH + wagons * (WAGON_LENGTH + CAR_GAP)
  }

  private cars(run: Run): Car[] {
    const { track, head, wagons } = run
    const cars: Car[] = []
    const place = (centerD: number, length: number, engine: boolean) => {
      const half = length / 2
      const front = track.sample(centerD + half).pos
      const back = track.sample(centerD - half).pos
      cars.push({
        engine,
        box: {
          center: { x: (front.x + back.x) / 2, y: (front.y + back.y) / 2 },
          angle: Math.atan2(front.y - back.y, front.x - back.x),
          halfLength: half,
          halfWidth: CAR_HALF_WIDTH,
        },
      })
    }
    place(head - ENGINE_LENGTH / 2, ENGINE_LENGTH, true)
    let d = head - ENGINE_LENGTH - CAR_GAP
    for (let i = 0; i < wagons; i++) {
      place(d - WAGON_LENGTH / 2, WAGON_LENGTH, false)
      d -= WAGON_LENGTH + CAR_GAP
    }
    return cars
  }

  private checkTrainHits(run: Run): void {
    const enemy = this.enemy
    if (!enemy.alive || run.hitCars.size >= MAX_HITS_PER_RUN) return
    const cars = this.cars(run)
    for (let i = 0; i < cars.length; i++) {
      if (run.hitCars.has(i)) continue
      const car = cars[i]
      const contact = circleBoxContact(enemy.pos, enemy.radius, car.box)
      if (!contact) continue
      let away = normalize(sub(enemy.pos, contact))
      if (away.x === 0 && away.y === 0) away = { x: -Math.sin(car.box.angle), y: Math.cos(car.box.angle) }
      const fwd = { x: Math.cos(car.box.angle), y: Math.sin(car.box.angle) }
      this.world.damage(enemy, car.engine ? ENGINE_DAMAGE : WAGON_DAMAGE, {
        kind: 'train',
        source: this.owner,
        at: contact,
        knock: { x: away.x * KNOCK_SIDE + fwd.x * KNOCK_FORWARD, y: away.y * KNOCK_SIDE + fwd.y * KNOCK_FORWARD },
        shake: car.engine ? 6 : 3,
      })
      run.hitCars.add(i)
      break
    }
  }

  override renderBack(ctx: CanvasRenderingContext2D): void {
    const fade = this.presence
    if (fade <= 0) return
    for (const run of this.runs) drawTrack(ctx, run.track.points, run.alpha * fade)
    if (this.laying) drawTrack(ctx, [...this.laying.points, this.owner.pos], fade)
    // Trains ride on top of every track, including the one being laid.
    ctx.save()
    ctx.globalAlpha = fade
    for (const run of this.runs) {
      if (run.wait > 0 || run.alpha < 1) continue
      const cars = this.cars(run)
      // Draw back to front so the engine sits on top.
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i]
        if (c.engine) drawEngine(ctx, c.box, this.world.time)
        else drawWagon(ctx, c.box)
      }
    }
    ctx.restore()
  }
}

export function drawConductorPortrait(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  const pts = [
    { x: cx - r * 2.2, y: cy + r * 1.3 },
    { x: cx - r * 0.2, y: cy - r * 0.6 },
    { x: cx + r * 2.2, y: cy + r * 1.1 },
  ]
  drawTrack(ctx, pts, 0.9)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

export const conductorDef: CharacterDef = {
  id: 'conductor',
  name: '列车长',
  nameEn: 'CONDUCTOR',
  tagline: '铁轨铺到哪，火车开到哪',
  rules: [
    '从撞墙点开始，沿自己的轨迹铺设铁轨',
    `再撞墙 ${TRACK_BOUNCES} 次后铁轨完工，火车驶来，同时开始铺下一条`,
    `车头 -${ENGINE_DAMAGE}，车厢 -${WAGON_DAMAGE}，每班车最多命中 ${MAX_HITS_PER_RUN} 次`,
    `首班车 ${BASE_WAGONS} 节车厢，之后每班多 ${WAGONS_PER_RUN} 节，越来越难躲`,
  ],
  palette: { ball: '#8b5cf6', text: '#ffffff', accent: '#8b5cf6' },
  mirrorPalette: { ball: '#4338ca', text: '#e0e7ff', accent: '#6366f1' },
  create: (w, b) => new ConductorAbility(w, b),
  drawPortrait: drawConductorPortrait,
}
