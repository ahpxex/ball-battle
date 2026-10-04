/**
 * Matchup audit: looks for interactions that are broken rather than merely
 * lopsided.
 *
 *  1. Borrowed abilities: every character's ability run by the thief (stolen)
 *     and by the mimic (imitated) should still work. Compares the damage it
 *     deals in their hands with what the character deals itself, against the
 *     same opponents. A ratio near 0 means the ability silently fails when
 *     someone else runs it.
 *  2. Stalemates: pairs (mirror matches included) that mostly end in overtime
 *     or draws, i.e. neither side can actually hurt the other.
 *  3. Extremes: pairs one side wins ≤5% of the time, to review by hand.
 *
 *   bun run audit [gamesPerPair=6]
 */
import { CHARACTERS, getCharacter } from '../src/game/characters/registry'
import { FIXED_DT, OVERTIME_START } from '../src/game/engine/constants'
import type { CharacterId } from '../src/game/engine/types'
import { createWorld } from '../src/game/match'
import type { World } from '../src/game/engine/World'

const games = Number(process.argv[2] ?? 6)
const ids = CHARACTERS.map((c) => c.id)

// ───────────────────────────── 1. borrowed abilities ─────────────────────────────

/** A spread of opponents with different movement and attack styles. */
const SPARRING: CharacterId[] = ['vampire', 'hammer', 'archer', 'toxicSpike', 'knight', 'cannon']
const WINDOW = 20
const BORROWERS = ['thief', 'mimic'] as const
/** The thief deals ×LOOT_DAMAGE_SCALE with stolen abilities by design; undo that for the comparison. */
const THIEF_SCALE = 0.6

type Mode = 'own' | (typeof BORROWERS)[number]

/** Damage the left ball deals in the first WINDOW seconds of the fight, with both balls kept alive. */
function damageOver(mode: Mode, char: CharacterId, foe: CharacterId, seed: number): number {
  const left = mode === 'own' ? char : mode
  const w: World = createWorld({ left, right: foe, seed }, { headless: true })
  const me = w.balls[0]
  let dealt = 0
  const damage = w.damage.bind(w)
  w.damage = (target, amount, opts) => {
    const d = damage(target, amount, opts)
    // The steal hit itself isn't the stolen ability's damage.
    if (opts.source === me && opts.kind !== 'steal') dealt += d
    return d
  }
  for (const b of w.balls) b.hp = 1e6
  const borrower = w.abilities[0] as unknown as Record<string, unknown> & { takeLoot?: (d: unknown, v: unknown) => void }
  let armed = false
  while (w.fightTime < WINDOW && !w.finished) {
    if (mode !== 'own' && w.phase === 'fight') {
      if (!armed) {
        armed = true
        if (mode === 'thief') borrower.takeLoot!(getCharacter(char), w.balls[1])
        else {
          // Make the mimic's next roll land on `char`, right away.
          borrower.next = getCharacter(char)
          borrower.phase = 'roll'
          borrower.timer = 0
        }
      }
      // Hold the borrowed ability for the whole window (and no new steals in between).
      if (mode === 'thief') {
        borrower.lootTimer = 1e6
        borrower.cooldown = 1e6
      } else if (borrower.phase === 'form') borrower.timer = 1e6
    }
    w.step(FIXED_DT)
  }
  return mode === 'thief' ? dealt / THIEF_SCALE : dealt
}

console.log(`1. Borrowed abilities (damage in ${WINDOW}s vs ${SPARRING.join(', ')}; ratio to the character itself)\n`)
const flagged: string[] = []
for (const id of ids) {
  if ((BORROWERS as readonly string[]).includes(id)) continue
  const total = (mode: Mode) => SPARRING.reduce((sum, foe, i) => sum + damageOver(mode, id, foe, 1000 + i * 37), 0)
  const own = total('own')
  const ratios = BORROWERS.map((b) => (own > 0 ? total(b) / own : 1))
  const bad = ratios.some((r) => r < 0.4)
  if (bad) flagged.push(id)
  console.log(`${bad ? '✗' : ' '} ${id.padEnd(12)} own ${(own / SPARRING.length).toFixed(0).padStart(4)}  ${BORROWERS.map((b, i) => `${b} ${(ratios[i] * 100).toFixed(0).padStart(4)}%`).join('  ')}`)
}

// ───────────────────────────── 2 + 3. all pairs ─────────────────────────────

interface PairStats {
  a: CharacterId
  b: CharacterId
  aWins: number
  draws: number
  overtime: number
  length: number
}

const pairs: PairStats[] = []
for (let i = 0; i < ids.length; i++) {
  for (let j = i; j < ids.length; j++) {
    const st: PairStats = { a: ids[i], b: ids[j], aWins: 0, draws: 0, overtime: 0, length: 0 }
    for (let g = 0; g < games * 2; g++) {
      const flip = g % 2 === 1
      const w = createWorld({ left: flip ? ids[j] : ids[i], right: flip ? ids[i] : ids[j], seed: g * 7919 + i * 131 + j * 17 }, { headless: true })
      while (!w.finished && w.time < 400) w.step(FIXED_DT)
      const aTeam = flip ? 1 : 0
      if (w.winner === null) st.draws++
      else if (w.winner === aTeam) st.aWins++
      if (w.fightTime > OVERTIME_START) st.overtime++
      st.length += w.fightTime
    }
    pairs.push(st)
  }
}

const n = games * 2
const pct = (x: number) => `${Math.round((x / n) * 100)}%`
const stalemates = pairs.filter((p) => p.overtime / n >= 0.5 || p.draws / n >= 0.15)
console.log(`\n2. Stalemates (≥50% overtime or ≥15% draws; ${n} games per pair)\n`)
for (const p of stalemates) console.log(`  ${p.a} vs ${p.b}: overtime ${pct(p.overtime)}, draws ${pct(p.draws)}, avg ${(p.length / n).toFixed(0)}s`)
if (stalemates.length === 0) console.log('  none')

const extremes = pairs.filter((p) => p.a !== p.b && (p.aWins / n <= 0.05 || (n - p.aWins - p.draws) / n <= 0.05))
console.log(`\n3. Extreme matchups (one side wins ≤5%): ${extremes.length} of ${pairs.length - ids.length} pairs\n`)
const byChar = new Map<CharacterId, string[]>()
for (const p of extremes) {
  const [loser, winner] = p.aWins / n <= 0.05 ? [p.a, p.b] : [p.b, p.a]
  byChar.set(loser, [...(byChar.get(loser) ?? []), winner])
}
for (const [loser, winners] of [...byChar].sort((x, y) => y[1].length - x[1].length)) console.log(`  ${loser.padEnd(12)} loses to ${winners.join(', ')}`)

console.log(flagged.length > 0 ? `\nBorrowed abilities that fail: ${flagged.join(', ')}` : '\nAll borrowed abilities work')
