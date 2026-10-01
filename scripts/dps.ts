/**
 * Measures each character's sustained damage output over time windows,
 * averaged across all defenders. Both balls are kept alive so the numbers
 * reflect weapon output, not fight length.
 *
 *   bun run scripts/dps.ts [games=20] [attackerIds, comma separated]
 */
import { CHARACTERS } from '../src/game/characters/registry'
import { FIXED_DT } from '../src/game/engine/constants'
import { createWorld } from '../src/game/match'

const games = Number(process.argv[2] ?? 20)
const WINDOWS = [0, 15, 30, 45, 60]
const ids = CHARACTERS.map((c) => c.id)
const only = process.argv[3]?.split(',')
const attackers = only ? ids.filter((id) => only.includes(id)) : ids
console.log('damage/s (heal/s) per window: ' + WINDOWS.slice(0, -1).map((w, i) => `${w}-${WINDOWS[i + 1]}s`).join(' | '))
for (const a of attackers) {
  const dmg = new Array(WINDOWS.length - 1).fill(0)
  const heal = new Array(WINDOWS.length - 1).fill(0)
  let runs = 0
  for (const b of ids) {
    for (let g = 0; g < games; g++) {
      const w = createWorld({ left: a, right: b, seed: g * 31 + 7 }, { headless: true })
      runs++
      for (let i = 0; i < WINDOWS.length - 1; i++) {
        const d0 = w.stats[0].damageDealt
        const h0 = w.stats[0].healing
        // A single huge hit (e.g. a big Math Ball roll) can still end the fight early.
        while (w.fightTime < WINDOWS[i + 1] && !w.finished && w.phase !== 'ending') {
          w.step(FIXED_DT)
          w.balls[1].hp = Math.max(w.balls[1].hp, 50)
          w.balls[0].hp = Math.min(Math.max(w.balls[0].hp, 50), 100)
        }
        dmg[i] += w.stats[0].damageDealt - d0
        heal[i] += w.stats[0].healing - h0
      }
    }
  }
  const cells = dmg.map((d, i) => {
    const span = (WINDOWS[i + 1] - WINDOWS[i]) * runs
    const h = heal[i] / span
    return `${(d / span).toFixed(2)}${h > 0 ? ` (+${h.toFixed(2)})` : ''}`.padStart(14)
  })
  console.log(a.padEnd(12) + cells.join(' |'))
}
