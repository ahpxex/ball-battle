import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CHARACTERS } from '../game/characters/registry'
import { randomSeed } from '../game/core/rng'
import type { CharacterId } from '../game/engine/types'
import { type MatchSetup, type MatchSide, resolveSides } from '../game/match'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useCharacterText } from '../i18n/characters'
import { Portrait } from './Portrait'
import { CharacterDetails, RosterGrid } from './Roster'
import { TopBar } from './TopBar'

interface SelectScreenProps {
  initial: Pick<MatchSetup, 'left' | 'right'>
  onStart: (setup: MatchSetup) => void
}

type SideIndex = 0 | 1

const SIDE_LABELS = ['select.sideLeft', 'select.sideRight'] as const
const SIDE_TAGS = ['P1', 'P2'] as const

export function SelectScreen({ initial, onStart }: SelectScreenProps) {
  const { t } = useTranslation()
  const [picks, setPicks] = useState<[CharacterId, CharacterId]>([initial.left, initial.right])
  const [seedText, setSeedText] = useState('')
  /** Side the shared roster edits in the single-column (narrow) layout. */
  const [editing, setEditing] = useState<SideIndex>(0)
  const wide = useMediaQuery('(min-width: 1024px)')
  const sides = resolveSides({ left: picks[0], right: picks[1] })

  const pick = (side: SideIndex, id: CharacterId) => setPicks((p) => (side === 0 ? [id, p[1]] : [p[0], id]))

  const randomize = () => {
    const any = () => CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id
    const l = any()
    let r = any()
    while (r === l) r = any()
    setPicks([l, r])
  }

  const start = () => {
    const parsed = Number.parseInt(seedText.trim(), 10)
    const seed = Number.isFinite(parsed) && parsed >= 0 ? parsed >>> 0 : randomSeed()
    onStart({ left: picks[0], right: picks[1], seed })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-6">
      <div className="-mx-4 sm:-mx-6">
        <TopBar current="local" />
      </div>
      <header className="mb-5 mt-5 text-center sm:mb-8 sm:mt-6">
        <h1 className="pixel-shadow font-pixel text-4xl font-bold tracking-wider text-white sm:text-6xl">{t('app.title')}</h1>
        <p className="mt-2 font-pixel text-sm tracking-[0.4em] text-zinc-500 sm:text-base">{t('app.subtitle')}</p>
        <p className="mt-3 text-sm text-zinc-400 sm:mt-4">{t('select.intro')}</p>
      </header>

      {wide ? (
        <div className="grid flex-1 grid-cols-[1fr_auto_1fr] items-start gap-6">
          <FighterPanel side={sides[0]} index={0} selected={picks[0]} onSelect={(id) => pick(0, id)} />
          <div className="flex h-full items-start justify-center pt-40">
            <span className="pixel-shadow font-pixel text-4xl font-bold text-white">VS</span>
          </div>
          <FighterPanel side={sides[1]} index={1} selected={picks[1]} onSelect={(id) => pick(1, id)} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          <MatchupTabs sides={sides} editing={editing} onEdit={setEditing} />
          <FighterPanel side={sides[editing]} index={editing} selected={picks[editing]} onSelect={(id) => pick(editing, id)} compact />
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-zinc-900 bg-zinc-950/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-xl items-center justify-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={randomize}
            className="shrink-0 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 sm:px-5"
          >
            🎲 {t('select.random')}<span className="hidden sm:inline">{t('select.randomSuffix')}</span>
          </button>
          <button
            type="button"
            onClick={start}
            className="min-w-0 flex-1 whitespace-nowrap rounded-lg bg-white px-4 py-3 font-pixel text-base font-bold tracking-widest text-black shadow-[0_0_30px_rgba(255,255,255,0.25)] transition hover:scale-105 active:scale-95 sm:flex-none sm:px-10 sm:text-lg"
          >
            {t('select.fight')}
          </button>
          <label className="flex shrink-0 items-center gap-2 text-xs text-zinc-500" title={t('select.seedHint')}>
            <span className="hidden sm:inline">{t('select.seedLabel')}</span>
            <input
              value={seedText}
              onChange={(e) => setSeedText(e.target.value.replace(/[^\d]/g, ''))}
              placeholder={t('select.seedPlaceholder')}
              aria-label={t('select.seedAria')}
              inputMode="numeric"
              className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-2 font-mono text-zinc-300 outline-none focus:border-zinc-600 sm:w-32 sm:py-1"
            />
          </label>
        </div>
      </div>
    </div>
  )
}

/** Narrow layouts: both picks side by side; tapping one chooses which side the roster below edits. */
function MatchupTabs({ sides, editing, onEdit }: { sides: readonly [MatchSide, MatchSide]; editing: SideIndex; onEdit: (side: SideIndex) => void }) {
  const { t } = useTranslation()
  const text = useCharacterText()
  const tab = (index: SideIndex) => {
    const { def, palette } = sides[index]
    const active = editing === index
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onEdit(index)}
        className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border p-2 text-left transition ${
          index === 1 ? 'flex-row-reverse text-right' : ''
        } ${active ? 'bg-zinc-900' : 'bg-zinc-950/60 opacity-70 hover:opacity-100'}`}
        style={{ borderColor: active ? palette.accent : '#27272a', boxShadow: active ? `0 0 24px ${palette.accent}33` : undefined }}
      >
        <Portrait def={def} color={palette.ball} size={52} className="shrink-0 rounded-lg" />
        <span className="min-w-0">
          <span className="block font-pixel text-[10px] tracking-widest text-zinc-500">
            {SIDE_TAGS[index]} · {t(SIDE_LABELS[index])}
          </span>
          <span className="block truncate font-semibold text-white">{text.name(def.id)}</span>
          <span className="block truncate text-[11px] text-zinc-500">{active ? t('select.editing') : t('select.tapToChange')}</span>
        </span>
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2" role="tablist" aria-label={t('select.chooseSide')}>
      {tab(0)}
      <span className="pixel-shadow shrink-0 font-pixel text-xl font-bold text-white">VS</span>
      {tab(1)}
    </div>
  )
}

interface FighterPanelProps {
  side: MatchSide
  index: SideIndex
  selected: CharacterId
  onSelect: (id: CharacterId) => void
  /** Smaller portrait and no side header, for the single-column layout. */
  compact?: boolean
}

function FighterPanel({ side, index, selected, onSelect, compact = false }: FighterPanelProps) {
  const { palette } = side
  const { t } = useTranslation()
  const label = t(SIDE_LABELS[index])
  return (
    <section
      className={`rounded-2xl border bg-zinc-950/80 transition-colors ${compact ? 'p-4' : 'p-5'}`}
      style={{ borderColor: `${palette.accent}66`, boxShadow: `0 0 40px ${palette.accent}1f` }}
    >
      {!compact && (
        <div className="mb-4 flex items-center justify-between text-xs text-zinc-500">
          <span>{label}</span>
          <span className="font-pixel tracking-widest">{SIDE_TAGS[index]}</span>
        </div>
      )}
      <CharacterDetails side={side} compact={compact} />
      <RosterGrid selected={selected} onSelect={onSelect} label={t('select.sideRoster', { side: label })} className="mt-5 grid-cols-5 sm:grid-cols-8" />
    </section>
  )
}
