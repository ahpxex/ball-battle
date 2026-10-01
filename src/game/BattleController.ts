import { randomSeed } from './core/rng'
import type { Sfx } from './audio/Sfx'
import { FIXED_DT } from './engine/constants'
import type { Phase, Team, TeamStats } from './engine/types'
import type { World } from './engine/World'
import { type MatchSetup, type MatchSide, createWorld, resolveSides } from './match'
import { type ArenaTheme, Renderer } from './render/Renderer'

export const SPEEDS = [0.5, 1, 2, 4] as const
export type Speed = (typeof SPEEDS)[number]

/** Upper bound on simulation steps per animation frame (avoids spiral of death). */
const MAX_STEPS_PER_FRAME = 60

export interface HudSnapshot {
  seed: number
  hp: readonly [number, number]
  phase: Phase
  winner: Team | null
  /** Whole seconds of fight time. */
  seconds: number
  overtime: boolean
  paused: boolean
  speed: Speed
  stats: readonly [TeamStats, TeamStats] | null
  fightTime: number
}

/**
 * Owns a running battle: the World, the fixed-step loop, the renderer and
 * sound dispatch. React subscribes to compact HUD snapshots through
 * `subscribe` / `getSnapshot` (useSyncExternalStore-compatible).
 */
export class BattleController {
  readonly sides: readonly [MatchSide, MatchSide]
  private setup: MatchSetup
  private world: World
  private renderer: Renderer | null = null
  private readonly theme: ArenaTheme
  private readonly sfx: Sfx
  private raf = 0
  private lastFrame = 0
  private accumulator = 0
  private speed: Speed = 1
  private paused = false
  private snapshot: HudSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(setup: MatchSetup, sfx: Sfx) {
    this.setup = setup
    this.sfx = sfx
    this.sides = resolveSides(setup)
    this.theme = { accents: [this.sides[0].palette.accent, this.sides[1].palette.accent] }
    this.world = createWorld(setup)
    this.snapshot = this.buildSnapshot()
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  attach(canvas: HTMLCanvasElement): void {
    this.renderer = new Renderer(canvas)
    this.lastFrame = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  detach(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.renderer = null
  }

  resize(cssSize: number, dpr: number): void {
    this.renderer?.resize(cssSize, dpr)
  }

  // ───────────────────────────── controls ─────────────────────────────

  get currentSeed(): number {
    return this.setup.seed
  }

  /** Restart with the same seed (identical replay) or a new one. */
  restart(seed: number = this.setup.seed): void {
    this.setup = { ...this.setup, seed }
    this.world = createWorld(this.setup)
    this.accumulator = 0
    this.paused = false
    this.publish()
  }

  rematch(): void {
    this.restart(randomSeed())
  }

  togglePause(): void {
    if (this.world.finished) return
    this.paused = !this.paused
    this.publish()
  }

  setSpeed(speed: Speed): void {
    this.speed = speed
    this.publish()
  }

  // ───────────────────────────── store ─────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): HudSnapshot => this.snapshot

  // ───────────────────────────── loop ─────────────────────────────

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now

    if (!this.paused) {
      this.accumulator += dt * this.speed
      let steps = 0
      while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        this.world.step(FIXED_DT)
        this.accumulator -= FIXED_DT
        steps++
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0
    }

    for (const e of this.world.drainEvents()) {
      if (e.type === 'sound') this.sfx.play(e.sound, e.volume, e.pitch)
    }

    this.renderer?.render(this.world, this.theme)
    this.maybePublish()
  }

  private buildSnapshot(): HudSnapshot {
    const w = this.world
    return {
      seed: this.setup.seed,
      hp: [Math.max(0, Math.ceil(w.balls[0].hp)), Math.max(0, Math.ceil(w.balls[1].hp))],
      phase: w.phase,
      winner: w.winner,
      seconds: Math.floor(w.fightTime),
      overtime: w.overtime,
      paused: this.paused,
      speed: this.speed,
      stats: w.finished ? [{ ...w.stats[0] }, { ...w.stats[1] }] : null,
      fightTime: w.fightTime,
    }
  }

  /** Publishes only when something the HUD shows actually changed. */
  private maybePublish(): void {
    const s = this.snapshot
    const w = this.world
    const hp0 = Math.max(0, Math.ceil(w.balls[0].hp))
    const hp1 = Math.max(0, Math.ceil(w.balls[1].hp))
    if (
      s.hp[0] !== hp0 ||
      s.hp[1] !== hp1 ||
      s.phase !== w.phase ||
      s.seconds !== Math.floor(w.fightTime) ||
      s.overtime !== w.overtime ||
      s.seed !== this.setup.seed
    ) {
      this.publish()
    }
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot()
    for (const l of this.listeners) l()
  }
}
