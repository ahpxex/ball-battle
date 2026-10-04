/**
 * Quick balance probe: each listed character plays every other character
 * and reports its overall win rate and median fight length.
 *
 *   bun run scripts/vsall.ts <ids, comma separated> [gamesPerSide=10]
 */
import { CHARACTERS } from '../src/game/characters/registry'
import { FIXED_DT } from '../src/game/engine/constants'
import type { CharacterId } from '../src/game/engine/types'
import { createWorld } from '../src/game/match'

const ids = CHARACTERS.map((c) => c.id)
const probe = (process.argv[2] ?? '').split(',').filter((id): id is CharacterId => ids.includes(id as CharacterId))
const games = Number(process.argv[3] ?? 10)
const errors = new Map<string, string>()

for (const a of probe) {
  let wins = 0
  let total = 0
  const durations: number[] = []
  const worst: [CharacterId, number][] = []
  for (const b of ids) {
    if (b === a) continue
    let pairWins = 0
    let played = 0
    for (let g = 0; g < games * 2; g++) {
      const left = g % 2 === 0
      try {
        const w = createWorld({ left: left ? a : b, right: left ? b : a, seed: g * 7919 + 13 }, { headless: true })
        while (!w.finished && w.time < 400) w.step(FIXED_DT)
        const mine = left ? 0 : 1
        pairWins += w.winner === mine ? 1 : w.winner === null ? 0.5 : 0
        played++
        durations.push(w.fightTime)
      } catch (e) {
        // A character that throws (e.g. one being worked on) is reported, not fatal for the whole probe.
        errors.set(`${a} vs ${b}`, String(e))
      }
    }
    if (played === 0) continue
    wins += pairWins
    total += played
    worst.push([b, pairWins / played])
  }
  durations.sort((x, y) => x - y)
  worst.sort((x, y) => x[1] - y[1])
  const fmt = (l: [CharacterId, number][]) => l.map(([id, r]) => `${id} ${Math.round(r * 100)}`).join(', ')
  console.log(`${a.padEnd(12)} ${((wins / total) * 100).toFixed(1).padStart(5)}%  median ${durations[durations.length >> 1].toFixed(1)}s  | worst: ${fmt(worst.slice(0, 4))} | best: ${fmt(worst.slice(-3))}`)
}

for (const [pair, err] of errors) console.error(`✗ ${pair}: ${err}`)
