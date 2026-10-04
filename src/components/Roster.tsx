import { CHARACTERS } from '../game/characters/registry'
import { useCharacterText } from '../i18n/characters'
import type { CharacterId } from '../game/engine/types'
import type { MatchSide } from '../game/match'
import { Portrait } from './Portrait'

/** Portrait, names, tagline and rule list of one character. */
export function CharacterDetails({ side, compact = false }: { side: MatchSide; compact?: boolean }) {
  const { def, palette } = side
  const text = useCharacterText()
  return (
    <>
      <div className={`flex ${compact ? 'gap-4' : 'gap-5'}`}>
        <Portrait def={def} color={palette.ball} size={compact ? 96 : 140} className="shrink-0 rounded-xl" />
        <div className="min-w-0">
          <h2
            className={`pixel-shadow break-words font-pixel font-bold leading-tight ${compact ? 'text-xl' : 'text-2xl sm:text-3xl'}`}
            style={{ color: palette.accent }}
          >
            {def.nameEn}
          </h2>
          <p className="mt-1 text-lg font-semibold text-white">{text.name(def.id)}</p>
          <p className="mt-1 text-sm text-zinc-400">“{text.tagline(def.id)}”</p>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5 text-sm leading-relaxed text-zinc-300">
        {text.rules(def).map((rule) => (
          <li key={rule} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: palette.accent }} />
            <span>{rule}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

interface RosterGridProps {
  selected: CharacterId | null
  onSelect: (id: CharacterId) => void
  label: string
  disabled?: boolean
  className?: string
}

/** Every character as a small portrait button. */
export function RosterGrid({ selected, onSelect, label, disabled = false, className = 'grid-cols-5 sm:grid-cols-8' }: RosterGridProps) {
  const text = useCharacterText()
  return (
    <div className={`grid gap-1 ${className}`} role="radiogroup" aria-label={label}>
      {CHARACTERS.map((c) => {
        const active = c.id === selected
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onSelect(c.id)}
            className={`group flex flex-col items-center gap-0.5 rounded-md border px-0.5 py-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? 'border-white/70 bg-white/10' : 'border-zinc-800 hover:border-zinc-600 hover:bg-white/5'
            }`}
            title={text.tagline(c.id)}
          >
            <Portrait def={c} color={c.palette.ball} size={40} className="rounded-md" />
            <span className={`w-full break-words text-center text-[11px] leading-tight ${active ? 'text-white' : 'text-zinc-400 group-hover:text-zinc-200'}`}>{text.name(c.id)}</span>
          </button>
        )
      })}
    </div>
  )
}
