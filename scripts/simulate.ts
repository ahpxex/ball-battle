/**
 * Headless balance check: plays every matchup many times and reports win
 * rates, fight length and how often overtime was needed.
 *
 *   bun run scripts/simulate.ts [gamesPerSide=150]
 */
import { CHARACTERS } from '../src/game/characters/registry'
import { FIXED_DT, OVERTIME_START } from '../src/game/engine/constants'
import type { CharacterId } from '../src/game/engine/types'
import { createWorld } from '../src/game/match'

const games = Number(process.argv[2] ?? 150)
const MAX_SIM_TIME = 400

interface Result {
  winner: 0 | 1 | null
  duration: number
  overtime: boolean
}

function play(left: CharacterId, right: CharacterId, seed: number): Result {
  const w = createWorld({ left, right, seed }, { headless: true })
  while (!w.finished && w.time < MAX_SIM_TIME) w.step(FIXED_DT)
  return { winner: w.winner, duration: w.fightTime, overtime: w.fightTime > OVERTIME_START }
}

const ids = CHARACTERS.map((c) => c.id)
const overall = new Map<CharacterId, { wins: number; games: number }>(ids.map((id) => [id, { wins: 0, games: 0 }]))
const rows: string[] = []
const allDurations: number[] = []

for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i]
    const b = ids[j]
    let aWins = 0
    let draws = 0
    let overtimes = 0
    const durations: number[] = []
    for (let g = 0; g < games; g++) {
      // Play both sides so spawn position doesn't bias the result.
      for (const flip of [false, true]) {
        const seed = (g * 7919 + i * 131 + j * 17 + (flip ? 99991 : 0)) >>> 0
        const r = flip ? play(b, a, seed) : play(a, b, seed)
        const aTeam = flip ? 1 : 0
        if (r.winner === null) draws++
        else if (r.winner === aTeam) aWins++
        if (r.overtime) overtimes++
        durations.push(r.duration)
      }
    }
    const total = games * 2
    const sa = overall.get(a)!
    const sb = overall.get(b)!
    sa.wins += aWins
    sa.games += total
    sb.wins += total - aWins - draws
    sb.games += total
    allDurations.push(...durations)
    durations.sort((x, y) => x - y)
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length
    rows.push(
      `${a.padEnd(11)} vs ${b.padEnd(11)}  ${((aWins / total) * 100).toFixed(0).padStart(3)}% : ${(((total - aWins - draws) / total) * 100).toFixed(0).padStart(3)}%` +
        `  draws ${draws.toString().padStart(2)}  avg ${avg.toFixed(1).padStart(5)}s  median ${durations[durations.length >> 1].toFixed(1).padStart(5)}s  overtime ${((overtimes / total) * 100).toFixed(0).padStart(3)}%`,
    )
  }
}

console.log(rows.join('\n'))
console.log('\nOverall win rate:')
for (const [id, s] of overall) console.log(`  ${id.padEnd(11)} ${((s.wins / s.games) * 100).toFixed(1)}%`)
allDurations.sort((x, y) => x - y)
console.log(`\nFight length p10 ${allDurations[Math.floor(allDurations.length * 0.1)].toFixed(1)}s  median ${allDurations[allDurations.length >> 1].toFixed(1)}s  p90 ${allDurations[Math.floor(allDurations.length * 0.9)].toFixed(1)}s`)
