import { FIXED_DT } from './engine/constants'
import type { Team } from './engine/types'
import { type MatchSetup, createWorld } from './match'

/** Simulated seconds after which a match is cut off (overtime guarantees a KO long before this). */
const MAX_SIM_TIME = 400

export interface MatchResult {
  winner: Team | null
  /** Seconds spent in the fight phase. */
  fightTime: number
  /** Fixed steps from World creation until the 'finished' phase (countdown and KO animation included). */
  steps: number
  hp: [number, number]
}

/**
 * Plays a match to the end without rendering. The online server uses this as
 * the referee, and since the simulation is bit-identical across JS engines,
 * every client watching the same setup arrives at exactly this result.
 */
export function playMatch(setup: MatchSetup): MatchResult {
  const w = createWorld(setup, { headless: true })
  let steps = 0
  while (!w.finished && w.time < MAX_SIM_TIME) {
    w.step(FIXED_DT)
    steps++
  }
  return { winner: w.winner, fightTime: w.fightTime, steps, hp: [w.balls[0].hp, w.balls[1].hp] }
}

/** Seconds of simulated time a match lasts (what the clock-driven online loop plays back). */
export const matchDuration = (r: MatchResult): number => r.steps * FIXED_DT
