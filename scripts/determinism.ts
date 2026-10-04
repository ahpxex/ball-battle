/**
 * Cross-engine determinism check. Online play relies on every JS engine
 * simulating a battle bit-for-bit identically (players' browsers and the
 * Worker referee), so this plays every matchup once and compares a hash of
 * the final states under JavaScriptCore (bun) and V8 (node). It also checks
 * that headless simulation (the referee) matches simulation with effects on
 * (what players watch).
 *
 *   bun run check:determinism
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHARACTERS } from '../src/game/characters/registry'
import { FIXED_DT } from '../src/game/engine/constants'
import { createWorld } from '../src/game/match'

const MAX_SIM_TIME = 400

/** FNV-1a over the exact bit patterns of every number fed in. */
class Hasher {
  private h = 0x811c9dc5
  private readonly f = new Float64Array(1)
  private readonly u = new Uint32Array(this.f.buffer)

  num(x: number): void {
    this.f[0] = x
    this.word(this.u[0])
    this.word(this.u[1])
  }

  private word(w: number): void {
    for (let i = 0; i < 4; i++) {
      this.h ^= (w >>> (i * 8)) & 0xff
      this.h = Math.imul(this.h, 0x01000193) >>> 0
    }
  }

  get hex(): string {
    return this.h.toString(16).padStart(8, '0')
  }
}

function run(headless: boolean): string {
  const ids = CHARACTERS.map((c) => c.id)
  const hash = new Hasher()
  let k = 0
  for (let i = 0; i < ids.length; i++) {
    for (let j = i; j < ids.length; j++, k++) {
      const w = createWorld({ left: ids[i], right: ids[j], seed: (Math.imul(k, 0x9e3779b1) + 12345) >>> 0 }, { headless })
      let steps = 0
      while (!w.finished && w.time < MAX_SIM_TIME) {
        w.step(FIXED_DT)
        steps++
      }
      hash.num(w.winner ?? -1)
      hash.num(steps)
      hash.num(w.fightTime)
      for (const b of w.balls) {
        hash.num(b.hp)
        hash.num(b.pos.x)
        hash.num(b.pos.y)
        hash.num(b.vel.x)
        hash.num(b.vel.y)
      }
    }
  }
  return `${k} matches · headless ${headless} · ${hash.hex}`
}

if (process.argv.includes('--worker')) {
  console.log(run(!process.argv.includes('--effects')))
} else {
  const here = dirname(fileURLToPath(import.meta.url))
  const outDir = join(here, '../node_modules/.tmp')
  const bundle = join(outDir, 'determinism.js')
  mkdirSync(outDir, { recursive: true })
  const build = spawnSync('bun', ['build', fileURLToPath(import.meta.url), '--target=node', `--outfile=${bundle}`], { stdio: 'inherit' })
  if (build.status !== 0) process.exit(1)

  const runUnder = (cmd: string, args: string[]): string => {
    const r = spawnSync(cmd, [bundle, '--worker', ...args], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr}`)
    return r.stdout.trim()
  }
  const results = {
    'bun (JavaScriptCore)': runUnder('bun', []),
    'node (V8)': runUnder('node', []),
    'bun, effects on': runUnder('bun', ['--effects']),
  }
  for (const [name, out] of Object.entries(results)) console.log(`${name.padEnd(22)} ${out}`)
  const hashes = new Set(Object.values(results).map((r) => r.split(' · ').pop()))
  if (hashes.size !== 1) {
    console.error('\n✗ Simulation differs between runs: online battles would desync.')
    process.exit(1)
  }
  console.log('\n✓ Identical everywhere')
}
