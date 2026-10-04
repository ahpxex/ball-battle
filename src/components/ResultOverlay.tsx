import { useTranslation } from 'react-i18next'
import type { HudSnapshot } from '../game/BattleController'
import type { TeamStats } from '../game/engine/types'
import type { MatchSide } from '../game/match'
import { useCharacterText } from '../i18n/characters'

interface ResultOverlayProps {
  hud: HudSnapshot
  sides: readonly [MatchSide, MatchSide]
  onReplay: () => void
  onRematch: () => void
  onBack: () => void
}

const ROWS: { label: 'result.damage' | 'result.healing' | 'result.hits' | 'result.biggestHit'; get: (s: TeamStats) => number }[] = [
  { label: 'result.damage', get: (s) => s.damageDealt },
  { label: 'result.healing', get: (s) => s.healing },
  { label: 'result.hits', get: (s) => s.hits },
  { label: 'result.biggestHit', get: (s) => s.biggestHit },
]

export function ResultOverlay({ hud, sides, onReplay, onRematch, onBack }: ResultOverlayProps) {
  const winner = hud.winner === null ? null : sides[hud.winner]
  const stats = hud.stats
  const secs = hud.fightTime.toFixed(1)
  const { t } = useTranslation()
  const text = useCharacterText()

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-[2px]">
      <div className="animate-pop-in my-auto w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950/95 p-5 shadow-2xl">
        <div className="text-center">
          {winner ? (
            <>
              <p className="text-xs tracking-widest text-zinc-500">WINNER</p>
              <h2 className="pixel-shadow mt-1 font-pixel text-3xl font-bold" style={{ color: winner.palette.accent }}>
                {winner.def.nameEn}
              </h2>
              <p className="mt-1 text-lg font-semibold text-white">{t('result.wins', { name: text.name(winner.def.id) })}</p>
            </>
          ) : (
            <h2 className="pixel-shadow font-pixel text-3xl font-bold text-zinc-200">DRAW</h2>
          )}
          <p className="mt-1 text-xs text-zinc-500">{t('result.duration', { secs })}</p>
        </div>

        {stats && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="py-1 text-left font-normal">&nbsp;</th>
                <th className="py-1 text-right font-semibold" style={{ color: sides[0].palette.accent }}>
                  {text.name(sides[0].def.id)}
                </th>
                <th className="py-1 text-right font-semibold" style={{ color: sides[1].palette.accent }}>
                  {text.name(sides[1].def.id)}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} className="border-t border-zinc-800/80">
                  <td className="py-1.5 text-zinc-400">{t(row.label)}</td>
                  <td className="py-1.5 text-right font-pixel tabular-nums text-zinc-200">{row.get(stats[0])}</td>
                  <td className="py-1.5 text-right font-pixel tabular-nums text-zinc-200">{row.get(stats[1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2">
          <button type="button" onClick={onRematch} className="rounded-lg bg-white px-2 py-2 text-sm font-semibold text-black transition hover:scale-[1.03]">
            {t('result.rematch')}
          </button>
          <button type="button" onClick={onReplay} className="rounded-lg border border-zinc-700 px-2 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
            {t('result.replay')}
          </button>
          <button type="button" onClick={onBack} className="rounded-lg border border-zinc-700 px-2 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
            {t('result.changeFighters')}
          </button>
        </div>
      </div>
    </div>
  )
}
