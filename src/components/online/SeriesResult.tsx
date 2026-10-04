import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCharacter } from '../../game/characters/registry'
import { useCharacterText } from '../../i18n/characters'
import { api } from '../../net/api'
import type { RoomView, RoundRecord, Seat } from '../../net/protocol'
import type { RoomClient } from '../../net/RoomClient'
import { useSession } from '../../net/session'
import { Portrait } from '../Portrait'

/** End of a series: who won, how each round went, and a rematch. */
export function SeriesResult({ client, room, onLeave }: { client: RoomClient; room: RoomView; onLeave: () => void }) {
  const { t } = useTranslation()
  const you = room.you
  const winner = room.seriesWinner
  const opp = you === null ? null : ((1 - you) as Seat)
  const oppPlayer = opp === null ? null : room.players[opp]
  const opponentGone = opp !== null && (!oppPlayer || !oppPlayer.connected)

  let headline: string
  if (winner === null) headline = t('series.over')
  else if (you === null) headline = t('series.playerWins', { name: room.players[winner]?.name ?? '?' })
  else headline = winner === you ? t('series.victory') : t('series.defeat')

  let note: string | null = null
  if (room.forfeit !== null)
    note = room.forfeit === you ? t('series.youLeft') : t('series.opponentLeft', { name: room.players[room.forfeit]?.name ?? t('series.opponent') })

  return (
    <div className="animate-pop-in mx-auto w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950/95 p-6 shadow-2xl">
      <div className="text-center">
        <p className="text-xs tracking-widest text-zinc-500">{t(`modes.${room.mode}.name`)}</p>
        <h2 className={`pixel-shadow mt-1 text-3xl font-bold ${you !== null && winner === you ? 'text-amber-300' : 'text-white'}`}>{headline}</h2>
        {note && <p className="mt-1 text-sm text-zinc-400">{note}</p>}
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="truncate text-right text-sm text-zinc-300">{room.players[0]?.name ?? '—'}</span>
          <span className="pixel-shadow font-pixel text-4xl font-bold text-white">
            {room.score[0]} : {room.score[1]}
          </span>
          <span className="truncate text-left text-sm text-zinc-300">{room.players[1]?.name ?? '—'}</span>
        </div>
      </div>

      {room.rounds.length > 0 && (
        <ol className="mt-5 space-y-1.5">
          {room.rounds.map((r, i) => (
            <RoundRow key={i} index={i} round={r} room={room} />
          ))}
        </ol>
      )}

      {you !== null && oppPlayer && <AddFriend opponentId={oppPlayer.userId} opponentRegistered={oppPlayer.registered} />}

      <div className="mt-5 grid grid-cols-2 gap-2">
        {you !== null && (
          <button
            type="button"
            disabled={room.rematch[you] && !opponentGone}
            onClick={() => client.send({ t: 'rematch' })}
            className="rounded-lg bg-white px-3 py-2.5 text-sm font-semibold text-black transition hover:scale-[1.03] disabled:scale-100 disabled:opacity-60"
          >
            {opponentGone
              ? t('series.waitNewOpponent')
              : room.rematch[you]
                ? t('series.waitingOpponent')
                : opp !== null && room.rematch[opp]
                  ? t('series.acceptRematch')
                  : t('series.rematch')}
          </button>
        )}
        <button
          type="button"
          onClick={onLeave}
          className={`rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 ${you === null ? 'col-span-2' : ''}`}
        >
          {t('series.backToLobby')}
        </button>
      </div>
    </div>
  )
}

function RoundRow({ index, round, room }: { index: number; round: RoundRecord; room: RoomView }) {
  const { t } = useTranslation()
  const text = useCharacterText()
  const l = getCharacter(round.left)
  const r = getCharacter(round.right)
  const mirror = round.left === round.right
  const winnerName = round.winner === null ? t('series.roundDraw') : t('series.roundWinner', { name: room.players[round.winner]?.name ?? '?' })
  return (
    <li className="flex items-center gap-2 rounded-lg bg-zinc-900/70 px-2 py-1.5 text-xs">
      <span className="w-8 shrink-0 text-zinc-500">#{index + 1}</span>
      <Portrait def={l} color={l.palette.ball} size={24} className={`shrink-0 rounded ${round.winner === 1 ? 'opacity-40' : ''}`} />
      <span className="truncate text-zinc-300">{text.name(l.id)}</span>
      <span className="text-zinc-600">vs</span>
      <Portrait
        def={r}
        color={mirror ? r.mirrorPalette.ball : r.palette.ball}
        size={24}
        className={`shrink-0 rounded ${round.winner === 0 ? 'opacity-40' : ''}`}
      />
      <span className="truncate text-zinc-300">{text.name(r.id)}</span>
      <span className="ml-auto shrink-0 text-zinc-400">
        {winnerName} · {round.fightTime.toFixed(1)}s
      </span>
    </li>
  )
}

/** Both sides signed in: offer to become friends right from the result screen. */
function AddFriend({ opponentId, opponentRegistered }: { opponentId: string; opponentRegistered: boolean }) {
  const { t } = useTranslation()
  const s = useSession()
  const [state, setState] = useState<'idle' | 'busy' | 'pending' | 'accepted' | 'error'>('idle')
  const registered = s.status === 'ready' && s.me?.registered
  if (!registered || !opponentRegistered) return null
  const add = async () => {
    setState('busy')
    try {
      setState((await api.addFriend({ userId: opponentId })).status)
    } catch {
      setState('error')
    }
  }
  const label = {
    idle: t('series.addFriend'),
    busy: t('series.sending'),
    pending: t('series.requestSent'),
    accepted: t('series.alreadyFriends'),
    error: t('series.sendFailed'),
  }[state]
  return (
    <button
      type="button"
      onClick={() => void add()}
      disabled={state === 'busy' || state === 'pending' || state === 'accepted'}
      className="mt-4 w-full rounded-lg border border-dashed border-zinc-700 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 disabled:opacity-70"
    >
      {label}
    </button>
  )
}
