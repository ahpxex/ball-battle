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
/** Clock-driven playback catching up after joining late: ~10 s of battle per frame at most. */
const MAX_CATCH_UP_STEPS_PER_FRAME = 1200
/** Further behind than this (in steps), sounds are skipped until playback has caught up. */
const SILENT_CATCH_UP_STEPS = 30

/**
 * Online playback: instead of free-running, the battle is pinned to a shared
 * clock so everyone in the room sees the same moment at the same time.
 */
export interface BattleSchedule {
  /** Server epoch ms at which the World starts stepping. */
  startAt: number
  /** Current server epoch ms (local clock corrected by the measured offset). */
  serverNow: () => number
}

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
  /** Fixed steps simulated so far (clock-driven playback compares this against the shared clock). */
  private steps = 0
  private readonly schedule: BattleSchedule | null
  private snapshot: HudSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(setup: MatchSetup, sfx: Sfx, schedule: BattleSchedule | null = null) {
    this.setup = setup
    this.sfx = sfx
    this.schedule = schedule
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

  /** Local playback can be paused, re-seeded and sped up; scheduled (online) playback cannot. */
  get scheduled(): boolean {
    return this.schedule !== null
  }

  /** Restart with the same seed (identical replay) or a new one. */
  restart(seed: number = this.setup.seed): void {
    if (this.schedule) return
    this.setup = { ...this.setup, seed }
    this.world = createWorld(this.setup)
    this.steps = 0
    this.accumulator = 0
    this.paused = false
    this.publish()
  }

  rematch(): void {
    this.restart(randomSeed())
  }

  togglePause(): void {
    if (this.world.finished || this.schedule) return
    this.paused = !this.paused
    this.publish()
  }

  setSpeed(speed: Speed): void {
    if (this.schedule) return
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

    let silent = false
    if (this.schedule) {
      silent = this.stepToClock(this.schedule)
    } else if (!this.paused) {
      this.accumulator += dt * this.speed
      let n = 0
      while (this.accumulator >= FIXED_DT && n < MAX_STEPS_PER_FRAME) {
        this.world.step(FIXED_DT)
        this.steps++
        this.accumulator -= FIXED_DT
        n++
      }
      if (n === MAX_STEPS_PER_FRAME) this.accumulator = 0
    }

    for (const e of this.world.drainEvents()) {
      if (e.type === 'sound' && !silent) this.sfx.play(e.sound, e.volume, e.pitch)
    }

    this.renderer?.render(this.world, this.theme)
    this.maybePublish()
  }

  /** Advances to the step the shared clock says everyone is on; returns true while still catching up. */
  private stepToClock(schedule: BattleSchedule): boolean {
    const target = Math.floor((schedule.serverNow() - schedule.startAt) / 1000 / FIXED_DT)
    const behind = target - this.steps
    let n = 0
    while (this.steps < target && !this.world.finished && n < MAX_CATCH_UP_STEPS_PER_FRAME) {
      this.world.step(FIXED_DT)
      this.steps++
      n++
    }
    return behind > SILENT_CATCH_UP_STEPS
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
