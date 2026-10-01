import { useState } from 'react'
import { CHARACTERS } from '../game/characters/registry'
import { randomSeed } from '../game/core/rng'
import type { CharacterId } from '../game/engine/types'
import { type MatchSetup, type MatchSide, resolveSides } from '../game/match'
import { Portrait } from './Portrait'

interface SelectScreenProps {
  initial: Pick<MatchSetup, 'left' | 'right'>
  onStart: (setup: MatchSetup) => void
}

export function SelectScreen({ initial, onStart }: SelectScreenProps) {
  const [left, setLeft] = useState<CharacterId>(initial.left)
  const [right, setRight] = useState<CharacterId>(initial.right)
  const [seedText, setSeedText] = useState('')
  const sides = resolveSides({ left, right })

  const randomize = () => {
    const pick = () => CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id
    const l = pick()
    let r = pick()
    while (r === l) r = pick()
    setLeft(l)
    setRight(r)
  }

  const start = () => {
    const parsed = Number.parseInt(seedText.trim(), 10)
    const seed = Number.isFinite(parsed) && parsed >= 0 ? parsed >>> 0 : randomSeed()
    onStart({ left, right, seed })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pt-8 sm:px-6">
      <header className="mb-8 text-center">
        <h1 className="pixel-shadow font-pixel text-4xl font-bold tracking-wider text-white sm:text-6xl">
          小球大战
        </h1>
        <p className="mt-2 font-pixel text-sm tracking-[0.4em] text-zinc-500 sm:text-base">BALL BATTLE</p>
        <p className="mt-4 text-sm text-zinc-400">选择左右两个小球，看它们在竞技场里自动对决</p>
      </header>

      <div className="grid flex-1 items-start gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <FighterPanel side={sides[0]} label="左方" selected={left} onSelect={setLeft} />
        <div className="flex items-center justify-center lg:h-full lg:pt-40">
          <span className="pixel-shadow font-pixel text-4xl font-bold text-white">VS</span>
        </div>
        <FighterPanel side={sides[1]} label="右方" selected={right} onSelect={setRight} />
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-zinc-900 bg-zinc-950/85 px-4 py-3 backdrop-blur sm:-mx-6">
        <button
          type="button"
          onClick={randomize}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
        >
          🎲 随机对阵
        </button>
        <button
          type="button"
          onClick={start}
          className="rounded-lg bg-white px-10 py-3 font-pixel text-lg font-bold tracking-widest text-black shadow-[0_0_30px_rgba(255,255,255,0.25)] transition hover:scale-105 active:scale-95"
        >
          开战 FIGHT!
        </button>
        <label className="flex items-center gap-2 text-xs text-zinc-500" title="相同的种子 + 相同的角色 = 完全相同的对局">
          随机种子
          <input
            value={seedText}
            onChange={(e) => setSeedText(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="留空则随机"
            inputMode="numeric"
            className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-zinc-300 outline-none focus:border-zinc-600"
          />
        </label>
      </div>
    </div>
  )
}

interface FighterPanelProps {
  side: MatchSide
  label: string
  selected: CharacterId
  onSelect: (id: CharacterId) => void
}

function FighterPanel({ side, label, selected, onSelect }: FighterPanelProps) {
  const { def, palette } = side
  return (
    <section
      className="rounded-2xl border bg-zinc-950/80 p-5 transition-colors"
      style={{ borderColor: `${palette.accent}66`, boxShadow: `0 0 40px ${palette.accent}1f` }}
    >
      <div className="mb-4 flex items-center justify-between text-xs text-zinc-500">
        <span>{label}</span>
        <span className="font-pixel tracking-widest">{label === '左方' ? 'P1' : 'P2'}</span>
      </div>

      <div className="flex gap-5">
        <Portrait def={def} color={palette.ball} size={140} className="shrink-0 rounded-xl" />
        <div className="min-w-0">
          <h2 className="pixel-shadow font-pixel text-2xl font-bold leading-tight sm:text-3xl" style={{ color: palette.accent }}>
            {def.nameEn}
          </h2>
          <p className="mt-1 text-lg font-semibold text-white">{def.name}</p>
          <p className="mt-1 text-sm text-zinc-400">「{def.tagline}」</p>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5 text-sm leading-relaxed text-zinc-300">
        {def.rules.map((rule) => (
          <li key={rule} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: palette.accent }} />
            <span>{rule}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 grid grid-cols-5 gap-1 sm:grid-cols-8" role="radiogroup" aria-label={`${label}角色`}>
        {CHARACTERS.map((c) => {
          const active = c.id === selected
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(c.id)}
              className={`group flex flex-col items-center gap-0.5 rounded-md border px-0.5 py-1 transition ${
                active ? 'border-white/70 bg-white/10' : 'border-zinc-800 hover:border-zinc-600 hover:bg-white/5'
              }`}
              title={c.tagline}
            >
              <Portrait def={c} color={c.palette.ball} size={40} className="rounded-md" />
              <span className={`whitespace-nowrap text-[11px] leading-tight ${active ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>{c.name}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
