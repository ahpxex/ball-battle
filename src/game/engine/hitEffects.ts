import { clamp } from '../core/vec'
import type { Ball } from './Ball'
import type { DamageKind, DamageOptions } from './types'
import type { World } from './World'

interface HitContext {
  world: World
  target: Ball
  dmg: number
  at: { x: number; y: number }
}

type HitEffect = (h: HitContext) => void

const BLOOD = ['#dc2626', '#b91c1c', '#f87171'] as const
const SMOKE = ['#d4d4d8', '#a1a1aa', '#71717a'] as const
/** Lowest y a damage number may spawn at and still float up inside the arena. */
const TEXT_MIN_Y = 52

/** Particles and sound for each kind of damage. Purely cosmetic. */
const HIT_EFFECTS: Record<DamageKind, HitEffect> = {
  bite: ({ world, at }) => {
    world.effects.burst(at, { count: 14, color: BLOOD, speed: [60, 240], size: [2.5, 6], life: [0.4, 0.9], gravity: 140 })
    world.sound('bite', 0.8)
  },
  train: ({ world, at, dmg }) => {
    world.effects.burst(at, { count: 10, color: SMOKE, shape: 'smoke', speed: [40, 180], size: [6, 13], life: [0.5, 1.1], endScale: 2.4, drag: 2.2 })
    world.effects.burst(at, { count: 8, color: ['#7c3f1d', '#a16207', '#e5e7eb'], shape: 'shard', speed: [150, 420], size: [3, 6], life: [0.4, 0.8] })
    world.sound('trainHit', clamp(dmg / 8, 0.5, 1))
  },
  spike: ({ world, at }) => {
    world.effects.burst(at, { count: 12, color: ['#84cc16', '#4d7c0f', '#bef264'], speed: [60, 220], size: [3, 7], life: [0.4, 0.9] })
    world.effects.burst(at, { count: 6, color: ['#dc2626', '#f87171'], speed: [80, 200], size: [2, 4], life: [0.3, 0.6] })
    world.sound('spike', 0.9)
  },
  poison: ({ world, target }) => {
    world.effects.burst(
      { x: target.pos.x, y: target.pos.y + target.radius * 0.6 },
      { count: 3, color: ['#65a30d', '#84cc16'], speed: [10, 50], size: [2.5, 5], life: [0.5, 0.9], gravity: 260, direction: Math.PI / 2, spread: 0.6 },
    )
    world.sound('poison', 0.35)
  },
  thread: ({ world, at }) => {
    world.effects.burst(at, { count: 5, color: ['#ffffff', '#e5e7eb'], shape: 'spark', speed: [80, 220], size: [2, 4], life: [0.2, 0.45] })
    world.sound('thread', 0.5)
  },
  rebirth: ({ world, at, dmg }) => {
    world.effects.burst(at, { count: 12, color: ['#ff5a1f', '#ffb02e', '#fde68a'], speed: [80, 260], size: [2, 5], life: [0.3, 0.6], gravity: -60 })
    world.sound('explosion', clamp(0.3 + dmg / 20, 0.3, 0.9), 1.2)
  },
  turtleShell: ({ world, at }) => {
    world.effects.burst(at, { count: 8, color: ['#6fcf7a', '#3f8f4a', '#ffffff'], shape: 'shard', speed: [100, 300], size: [2, 5], life: [0.2, 0.5] })
    world.sound('clack', 0.8, 0.8)
  },
  reflect: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: ['#e2e8f0', '#ffffff', '#94a3b8'], shape: 'shard', speed: [100, 320], size: [2, 4.5], life: [0.2, 0.45] })
    world.sound('zap', 0.5, 1.6)
  },
  steal: ({ world, at }) => {
    world.effects.burst(at, { count: 8, color: ['#facc15', '#fde68a', '#ffffff'], shape: 'spark', speed: [80, 240], size: [1.5, 3.5], life: [0.2, 0.4] })
    world.sound('hit', 0.5, 1.3)
  },
  puffer: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: BLOOD, speed: [60, 220], size: [2, 5], life: [0.3, 0.6], gravity: 120 })
    world.sound('spike', 0.7, 1.2)
  },
  snowRoll: ({ world, at, dmg }) => {
    world.effects.burst(at, { count: 12, color: ['#ffffff', '#e0f2fe', '#bae6fd'], speed: [60, 240], size: [2, 5], life: [0.3, 0.7], gravity: 160 })
    world.sound('hit', clamp(0.4 + dmg / 12, 0.4, 1), 0.8)
  },
  gravityFall: ({ world, at, dmg }) => {
    world.effects.burst(at, { count: 10, color: ['#818cf8', '#c7d2fe', '#ffffff'], speed: [60, 220], size: [2, 4], life: [0.3, 0.6] })
    world.sound('heavyHit', clamp(0.3 + dmg / 12, 0.3, 0.9), 0.8)
  },
  portal: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: ['#38bdf8', '#ff8a00', '#ffffff'], shape: 'spark', speed: [80, 260], size: [1.5, 3.5], life: [0.2, 0.45] })
    world.sound('zap', 0.5, 1.2)
  },
  slam: ({ world, at, dmg }) => {
    world.effects.burst(at, { count: 12, color: SMOKE, shape: 'smoke', speed: [40, 180], size: [6, 12], life: [0.4, 0.9], endScale: 2 })
    world.sound('heavyHit', clamp(0.4 + dmg / 15, 0.4, 1), 0.7)
  },
  knife: ({ world, at }) => {
    world.effects.burst(at, { count: 6, color: BLOOD, speed: [60, 200], size: [2, 4], life: [0.25, 0.5], gravity: 100 })
    world.effects.burst(at, { count: 3, color: ['#e5e7eb', '#ffffff'], shape: 'spark', speed: [100, 240], size: [1.5, 3], life: [0.12, 0.25] })
    world.sound('shuriken', 0.6, 1.2)
  },
  echo: ({ world, at }) => {
    world.effects.burst(at, { count: 8, color: ['#fda4af', '#fb7185', '#ffffff'], speed: [60, 200], size: [2, 4], life: [0.25, 0.5] })
    world.sound('hit', 0.45, 1.4)
  },
  voodoo: ({ world, at }) => {
    world.effects.burst(at, { count: 6, color: ['#7c3aed', '#a855f7', '#1f1f2e'], shape: 'smoke', speed: [20, 90], size: [5, 9], life: [0.4, 0.8], endScale: 1.8 })
    world.effects.burst(at, { count: 5, color: BLOOD, speed: [40, 150], size: [2, 4], life: [0.25, 0.5], gravity: 100 })
    world.sound('poison', 0.5, 0.7)
  },
  fishhook: ({ world, at }) => {
    world.effects.burst(at, { count: 5, color: BLOOD, speed: [40, 150], size: [1.5, 3.5], life: [0.25, 0.5], gravity: 120 })
    world.effects.burst(at, { count: 2, color: ['#e2e8f0', '#ffffff'], shape: 'spark', speed: [60, 160], size: [1.5, 2.5], life: [0.1, 0.25] })
    world.sound('hit', 0.35, 1.5)
  },
  anchor: ({ world, at, dmg }) => {
    world.effects.burst(at, { count: 9, color: ['#fde68a', '#ffffff', '#fbbf24'], shape: 'spark', speed: [160, 420], size: [2, 4], life: [0.2, 0.5] })
    world.effects.burst(at, { count: 6, color: ['#9ca3af', '#6b7280'], shape: 'smoke', speed: [30, 120], size: [6, 11], life: [0.4, 0.9], endScale: 2 })
    world.effects.burst(at, { count: 8, color: BLOOD, speed: [60, 220], size: [2, 5], life: [0.3, 0.7], gravity: 120 })
    world.sound(dmg >= 4 ? 'heavyHit' : 'hook', clamp(0.4 + dmg / 8, 0.4, 1))
  },
  shuriken: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: BLOOD, speed: [60, 220], size: [2.5, 5.5], life: [0.3, 0.6], gravity: 100 })
    world.effects.burst(at, { count: 5, color: ['#e2e8f0', '#ffffff'], shape: 'spark', speed: [120, 300], size: [1.5, 3], life: [0.15, 0.3] })
    world.sound('shuriken', 0.8)
  },
  grenade: ({ world, at }) => {
    world.effects.burst(at, { count: 6, color: BLOOD, speed: [60, 200], size: [2, 5], life: [0.3, 0.6], gravity: 100 })
  },
  hammer: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: SMOKE, shape: 'smoke', speed: [40, 160], size: [7, 14], life: [0.5, 1.0], endScale: 2.2, drag: 2.4 })
    world.effects.burst(at, { count: 12, color: ['#ffffff', '#e5e7eb'], shape: 'shard', speed: [160, 420], size: [2, 4], life: [0.3, 0.7] })
    world.sound('hammer', 1)
  },
  drill: ({ world, at }) => {
    world.effects.burst(at, { count: 9, color: ['#ffffff', '#d4d4d8', '#9ca3af'], shape: 'spark', speed: [120, 340], size: [1.5, 3.5], life: [0.2, 0.5] })
    world.effects.burst(at, { count: 4, color: BLOOD, speed: [40, 160], size: [2, 4], life: [0.3, 0.5], gravity: 100 })
    world.sound('drill', 0.6)
  },
  spiderBite: ({ world, at }) => {
    world.effects.burst(at, { count: 6, color: BLOOD, speed: [40, 180], size: [2, 5], life: [0.3, 0.7], gravity: 140 })
    world.sound('bite', 0.4, 1.3)
  },
  chess: ({ world, at }) => {
    world.effects.burst(at, { count: 8, color: ['#e7d3b0', '#f5f5f4', '#c69b5c'], shape: 'smoke', speed: [40, 160], size: [5, 10], life: [0.4, 0.8], endScale: 2 })
    world.sound('chess', 0.9)
  },
  math: ({ world, at, dmg }) => {
    const big = dmg >= 50
    world.effects.burst(at, { count: big ? 30 : 8, color: big ? ['#ff3b3b', '#fb923c', '#facc15', '#ffffff'] : ['#e9d5ff', '#ffffff'], shape: 'spark', speed: [120, big ? 520 : 280], size: [2, big ? 5 : 3], life: [0.2, big ? 0.7 : 0.4] })
    if (big) world.effects.burst(at, { count: 1, color: '#ffffff', shape: 'ring', speed: [0, 0], size: [20, 20], life: [0.45, 0.45], endScale: 5 })
    world.sound(big ? 'heavyHit' : 'hit', big ? 1 : 0.6)
  },
  shock: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 6, color: ['#fef08a', '#ffffff'], shape: 'spark', speed: [100, 260], size: [1.5, 3], life: [0.12, 0.25], jitter: target.radius * 0.6 })
    world.sound('zap', 0.45, 1.3)
  },
  cursed: ({ world, at, dmg }) => {
    if (dmg <= 1) {
      world.effects.burst(at, { count: 3, color: ['#67e8f9', '#e0f2fe'], speed: [30, 90], size: [1.5, 3], life: [0.2, 0.4] })
      world.sound('thread', 0.3, 0.8)
      return
    }
    world.sound(dmg >= 10 ? 'heavyHit' : 'hit', dmg >= 10 ? 0.9 : 0.6)
  },
  trap: ({ world, at }) => {
    world.effects.burst(at, { count: 4, color: ['#c084fc', '#f5f3ff', '#dc2626'], shape: 'spark', speed: [60, 180], size: [1.5, 3], life: [0.15, 0.3] })
    world.sound('spike', 0.35, 1.4)
  },
  laser: ({ world, at, dmg }) => {
    world.effects.burst(at, { count: dmg >= 2 ? 6 : 3, color: ['#fda4af', '#ffffff', '#fb923c'], shape: 'spark', speed: [60, 200], size: [1.5, 3], life: [0.12, 0.3] })
    world.sound('laser', 0.35)
  },
  gravity: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 8, color: ['#a5b4fc', '#312e81', '#ffffff'], speed: [20, 120], size: [2, 4], life: [0.3, 0.6], jitter: target.radius * 0.8 })
    world.sound('hit', 0.55, 0.7)
  },
  orb: ({ world, at }) => {
    world.effects.burst(at, { count: 6, color: ['#ff8cc6', '#ffd1e8', '#ffffff'], speed: [60, 200], size: [1.5, 3.5], life: [0.2, 0.4] })
    world.sound('hit', 0.45, 1.4)
  },
  wind: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 6, color: ['#e4e4e7', '#a1a1aa'], shape: 'spark', speed: [80, 200], size: [1.5, 3], life: [0.15, 0.35], jitter: target.radius * 0.5 })
    world.sound('hit', 0.4, 1.1)
  },
  acid: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 4, color: ['#84cc16', '#d2e498', '#14532d'], speed: [20, 90], size: [2, 4], life: [0.3, 0.6], jitter: target.radius * 0.6, gravity: 120 })
    world.sound('poison', 0.4, 0.8)
  },
  lightning: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 10, color: ['#e0f2fe', '#ffffff', '#38bdf8'], shape: 'spark', speed: [120, 320], size: [1.5, 3.5], life: [0.15, 0.35] })
    world.sound('zap', 0.6, 0.8)
  },
  stab: ({ world, at }) => {
    world.effects.burst(at, { count: 5, color: ['#dc2626', '#f87171', '#e5e7eb'], speed: [60, 200], size: [1.5, 3.5], life: [0.2, 0.45], gravity: 100 })
    world.sound('hit', 0.35, 1.5)
  },
  tongue: ({ world, at }) => {
    world.effects.burst(at, { count: 6, color: ['#f880b0', '#dc2626', '#fda4af'], speed: [60, 180], size: [2, 4], life: [0.2, 0.4] })
    world.sound('bite', 0.4, 1.4)
  },
  magnet: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: ['#f84438', '#1068f8', '#ffffff'], shape: 'spark', speed: [120, 320], size: [1.5, 3.5], life: [0.2, 0.4] })
    world.sound('hit', 0.6, 0.9)
  },
  arrow: ({ world, at }) => {
    world.effects.burst(at, { count: 4, color: ['#dc2626', '#f87171', '#e5e7eb'], speed: [50, 150], size: [1.5, 3], life: [0.15, 0.35] })
    world.sound('hit', 0.3, 1.6)
  },
  boomerang: ({ world, at }) => {
    world.effects.burst(at, { count: 12, color: ['#ffa726', '#dc2626', '#ffffff'], speed: [80, 260], size: [2, 4.5], life: [0.25, 0.5] })
    world.sound('hook', 0.8)
  },
  fire: ({ world, at }) => {
    world.effects.burst(at, { count: 3, color: ['#ffb02e', '#ff6a00', '#fde68a'], speed: [30, 110], size: [2, 4], life: [0.2, 0.4], gravity: -60 })
  },
  burn: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 3, color: ['#ff6a00', '#fbbf24'], speed: [20, 80], size: [1.5, 3], life: [0.3, 0.5], gravity: -80, jitter: target.radius * 0.6 })
  },
  sand: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 4, color: ['#d9c21e', '#f0d030', '#a39a1a'], speed: [20, 90], size: [1.5, 3], life: [0.3, 0.5], jitter: target.radius * 0.6 })
    world.sound('poison', 0.3, 0.6)
  },
  sword: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: ['#dc2626', '#f87171', '#e0f2fe'], speed: [80, 260], size: [2, 4.5], life: [0.25, 0.5], gravity: 100 })
    world.sound('hit', 0.7, 1.2)
  },
  frost: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 5, color: ['#e6f7ff', '#9fdcf5', '#5bb5e0'], shape: 'shard', speed: [40, 140], size: [1.5, 3.5], life: [0.3, 0.6], jitter: target.radius * 0.5 })
    world.sound('clack', 0.35, 1.8)
  },
  spear: ({ world, at, dmg }) => {
    world.effects.burst(at, { count: 8, color: ['#d4d4d8', '#a1a1aa'], shape: 'smoke', speed: [30, 120], size: [5, 10], life: [0.3, 0.7], endScale: 2 })
    world.sound(dmg >= 10 ? 'heavyHit' : 'hit', 0.8)
  },
  trident: ({ world, at }) => {
    world.effects.burst(at, { count: 20, color: ['#dc2626', '#f87171', '#ef4444'], speed: [100, 320], size: [2, 5], life: [0.3, 0.6], gravity: 80 })
    world.sound('heavyHit', 0.9)
  },
  disco: ({ world, at }) => {
    world.effects.burst(at, { count: 8, color: ['#f472b6', '#facc15', '#4ade80', '#60a5fa', '#c084fc'], shape: 'spark', speed: [80, 240], size: [1.5, 3.5], life: [0.2, 0.45] })
    world.sound('laser', 0.4, 0.8)
  },
  lava: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 5, color: ['#ff4a10', '#ff9a1f', '#fde047'], speed: [30, 120], size: [2, 4], life: [0.2, 0.5], gravity: -40, jitter: target.radius * 0.6 })
    world.sound('poison', 0.35, 0.7)
  },
  cable: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 6, color: ['#fef08a', '#ffffff'], shape: 'spark', speed: [80, 220], size: [1.5, 3], life: [0.12, 0.25], jitter: target.radius * 0.6 })
    world.sound('zap', 0.35, 1.2)
  },
  shell: ({ world, at }) => {
    world.effects.burst(at, { count: 14, color: ['#fde68a', '#ffffff', '#fb923c'], shape: 'spark', speed: [120, 340], size: [1.5, 3.5], life: [0.2, 0.4] })
    world.sound('heavyHit', 0.8)
  },
  ghost: ({ world, at }) => {
    world.effects.burst(at, { count: 14, color: ['#93c5fd', '#e0f2fe', '#ffffff'], shape: 'smoke', speed: [30, 140], size: [6, 12], life: [0.5, 0.9], endScale: 2 })
    world.sound('explosion', 0.5, 1.3)
  },
  cut: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 4, color: ['#ef4444', '#fecaca'], shape: 'spark', speed: [60, 180], size: [1.5, 3], life: [0.15, 0.3], jitter: target.radius * 0.6 })
    world.sound('thread', 0.35, 0.7)
  },
  bullet: ({ world, at }) => {
    world.effects.burst(at, { count: 3, color: ['#dc2626', '#fca5a5'], speed: [50, 150], size: [1.5, 3], life: [0.12, 0.3] })
    world.sound('hit', 0.25, 1.8)
  },
  glass: ({ world, at }) => {
    world.effects.burst(at, { count: 4, color: ['#e2e8f0', '#dc2626', '#94a3b8'], shape: 'shard', speed: [40, 140], size: [1.5, 3], life: [0.2, 0.4] })
    world.sound('clack', 0.3, 2.2)
  },
  saw: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: ['#dc2626', '#f87171', '#e5e7eb'], speed: [80, 260], size: [1.5, 4], life: [0.2, 0.45], gravity: 100 })
    world.sound('hit', 0.6, 1.3)
  },
  potion: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 3, color: ['#a855f7', '#e9d5ff'], speed: [20, 80], size: [1.5, 3], life: [0.3, 0.5], jitter: target.radius * 0.6 })
    world.sound('poison', 0.3, 1.1)
  },
  snowball: ({ world, at }) => {
    world.effects.burst(at, { count: 7, color: ['#ffffff', '#e0f2fe'], speed: [40, 150], size: [1.5, 3], life: [0.2, 0.4] })
    world.sound('clack', 0.3, 1.6)
  },
  virus: ({ world, target }) => {
    world.effects.burst({ x: target.pos.x, y: target.pos.y + target.radius * 0.6 }, { count: 3, color: ['#33dd22', '#84cc16'], speed: [10, 50], size: [2, 4], life: [0.4, 0.8], gravity: 240 })
    world.sound('poison', 0.3)
  },
  sting: ({ world, at }) => {
    world.effects.burst(at, { count: 3, color: ['#facc15', '#dc2626'], speed: [40, 120], size: [1.2, 2.5], life: [0.15, 0.3] })
    world.sound('hit', 0.25, 1.9)
  },
  ram: ({ world, at }) => {
    world.effects.burst(at, { count: 14, color: ['#e5e7eb', '#a1a1aa', '#ffffff'], shape: 'smoke', speed: [40, 180], size: [6, 13], life: [0.4, 0.8], endScale: 2.2 })
    world.sound('heavyHit', 1)
  },
  split: ({ world, at }) => {
    world.effects.burst(at, { count: 8, color: ['#93c5fd', '#ffffff', '#1e6eef'], speed: [60, 200], size: [2, 4], life: [0.3, 0.6] })
    world.sound('hit', 0.6, 1.1)
  },
  ice: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 5, color: ['#ffffff', '#bae6fd', '#38bdf8'], speed: [30, 120], size: [1, 2.5], life: [0.25, 0.5], jitter: target.radius * 0.6 })
    world.sound('clack', 0.25, 1.9)
  },
  snake: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: ['#ffffff', '#e5e7eb'], shape: 'smoke', speed: [30, 120], size: [4, 8], life: [0.3, 0.6], endScale: 1.8 })
    world.sound('bite', 0.5, 0.9)
  },
  apple: ({ world, at }) => {
    world.effects.burst(at, { count: 10, color: ['#e0261d', '#4ade80', '#fde047'], speed: [60, 200], size: [2, 4], life: [0.25, 0.5] })
    world.sound('hit', 0.55, 1.2)
  },
  meteor: ({ world, at }) => {
    world.effects.burst(at, { count: 24, color: ['#ffffff', '#fde047', '#fb923c'], speed: [80, 300], size: [2, 5], life: [0.3, 0.7] })
    world.sound('explosion', 0.6, 1.1)
  },
  bomb: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 10, color: ['#e5e7eb', '#9ca3af'], shape: 'smoke', speed: [40, 160], size: [6, 12], life: [0.4, 0.9], endScale: 2 })
    world.sound('heavyHit', 0.9)
  },
  ironSpike: ({ world, at }) => {
    world.effects.burst(at, { count: 6, color: ['#d4d4d8', '#dc2626', '#a1a1aa'], shape: 'spark', speed: [60, 200], size: [1.5, 3], life: [0.15, 0.35] })
    world.sound('spike', 0.6, 0.8)
  },
  sonic: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 4, color: ['#c8d0ff', '#ffffff'], shape: 'spark', speed: [60, 160], size: [1.2, 2.5], life: [0.12, 0.25], jitter: target.radius * 0.6 })
    world.sound('laser', 0.25, 0.6)
  },
  pellet: ({ world, at }) => {
    world.effects.burst(at, { count: 6, color: ['#ffffff', '#e5e7eb', '#dc2626'], speed: [40, 160], size: [2, 4], life: [0.2, 0.4] })
    world.sound('hit', 0.35, 1.4)
  },
  wdc: ({ world, target, dmg }) => {
    world.effects.burst(target.pos, { count: 12, color: ['#2a60ff', '#93c5fd', '#ffffff'], speed: [60, 220], size: [2, 4], life: [0.3, 0.6], jitter: target.radius * 0.5 })
    world.sound(dmg >= 15 ? 'heavyHit' : 'hit', 0.8, 0.9)
  },
  thorn: ({ world, at }) => {
    world.effects.burst(at, { count: 7, color: ['#dc2626', '#f87171', '#4ade80'], speed: [50, 170], size: [1.5, 3.5], life: [0.2, 0.4], gravity: 80 })
    world.sound('spike', 0.5, 1.3)
  },
  punch: ({ world, at, dmg }) => {
    world.effects.burst(at, { count: dmg >= 5 ? 30 : 6, color: ['#ffffff', '#fecaca', '#dc2626'], speed: [80, dmg >= 5 ? 360 : 200], size: [1.5, 4], life: [0.2, 0.5] })
    world.sound(dmg >= 5 ? 'heavyHit' : 'hit', dmg >= 5 ? 1 : 0.45, 1.2)
  },
  overtime: ({ world, target }) => {
    world.effects.burst(target.pos, { count: 4, color: ['#a855f7', '#e879f9'], speed: [30, 90], size: [2, 4], life: [0.3, 0.6] })
  },
}

export function spawnHitEffects(world: World, target: Ball, dmg: number, opts: DamageOptions): void {
  const fx = world.effects
  // Numbers float upwards; against the top wall they'd leave the arena, so show them below the ball instead.
  const above = target.pos.y - target.radius - 12
  const textPos = { x: target.pos.x + 22, y: above >= TEXT_MIN_Y ? above : target.pos.y + target.radius + 28 }
  const red = opts.kind === 'poison' ? '#c03a3a' : '#ef4444'
  const size = opts.kind === 'poison' ? 22 : dmg >= 100 ? 48 : dmg >= 50 ? 40 : dmg >= 8 ? 32 : 26
  fx.text(`-${dmg}`, textPos, red, size)
  HIT_EFFECTS[opts.kind]({ world, target, dmg, at: opts.at ?? target.pos })
}
