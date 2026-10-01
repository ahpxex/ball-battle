import type { HudSnapshot } from '../game/BattleController'
import type { TeamStats } from '../game/engine/types'
import type { MatchSide } from '../game/match'

interface ResultOverlayProps {
  hud: HudSnapshot
  sides: readonly [MatchSide, MatchSide]
  onReplay: () => void
  onRematch: () => void
  onBack: () => void
}

const ROWS: { label: string; get: (s: TeamStats) => number }[] = [
  { label: '总伤害', get: (s) => s.damageDealt },
  { label: '治疗', get: (s) => s.healing },
  { label: '命中次数', get: (s) => s.hits },
  { label: '最大一击', get: (s) => s.biggestHit },
]

export function ResultOverlay({ hud, sides, onReplay, onRematch, onBack }: ResultOverlayProps) {
  const winner = hud.winner === null ? null : sides[hud.winner]
  const stats = hud.stats
  const secs = hud.fightTime.toFixed(1)

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]">
      <div className="animate-pop-in w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950/95 p-5 shadow-2xl">
        <div className="text-center">
          {winner ? (
            <>
              <p className="text-xs tracking-widest text-zinc-500">WINNER</p>
              <h2 className="pixel-shadow mt-1 font-pixel text-3xl font-bold" style={{ color: winner.palette.accent }}>
                {winner.def.nameEn}
              </h2>
              <p className="mt-1 text-lg font-semibold text-white">{winner.def.name} 获胜！</p>
            </>
          ) : (
            <h2 className="pixel-shadow font-pixel text-3xl font-bold text-zinc-200">DRAW</h2>
          )}
          <p className="mt-1 text-xs text-zinc-500">用时 {secs} 秒</p>
        </div>

        {stats && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="py-1 text-left font-normal">&nbsp;</th>
                <th className="py-1 text-right font-semibold" style={{ color: sides[0].palette.accent }}>
                  {sides[0].def.name}
                </th>
                <th className="py-1 text-right font-semibold" style={{ color: sides[1].palette.accent }}>
                  {sides[1].def.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} className="border-t border-zinc-800/80">
                  <td className="py-1.5 text-zinc-400">{row.label}</td>
                  <td className="py-1.5 text-right font-pixel tabular-nums text-zinc-200">{row.get(stats[0])}</td>
                  <td className="py-1.5 text-right font-pixel tabular-nums text-zinc-200">{row.get(stats[1])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2">
          <button type="button" onClick={onRematch} className="rounded-lg bg-white px-2 py-2 text-sm font-semibold text-black transition hover:scale-[1.03]">
            再战
          </button>
          <button type="button" onClick={onReplay} className="rounded-lg border border-zinc-700 px-2 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
            重播
          </button>
          <button type="button" onClick={onBack} className="rounded-lg border border-zinc-700 px-2 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800">
            换角色
          </button>
        </div>
      </div>
    </div>
  )
}
