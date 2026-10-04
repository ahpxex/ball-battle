import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCharacter } from '../../game/characters/registry'
import type { CharacterId } from '../../game/engine/types'
import { resolveSides } from '../../game/match'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useNow } from '../../hooks/useNow'
import { useCharacterText } from '../../i18n/characters'
import type { RoomView, Seat } from '../../net/protocol'
import type { RoomClient } from '../../net/RoomClient'
import { Portrait } from '../Portrait'
import { CharacterDetails, RosterGrid } from '../Roster'
import { PlayerChip } from './PlayerChip'

interface PickScreenProps {
  client: RoomClient
  room: RoomView
  onLeave: () => void
}

/** Blind pick: each side chooses in secret; nothing is revealed until both lock in. */
export function PickScreen({ client, room, onLeave }: PickScreenProps) {
  const { t } = useTranslation()
  const text = useCharacterText()
  const you = room.you
  const mine = you === null ? null : room.picks[you]
  const [choice, setChoice] = useState<CharacterId | null>(mine?.char ?? null)
  const wide = useMediaQuery('(min-width: 1024px)')

  const select = (id: CharacterId) => {
    setChoice(id)
    client.send({ t: 'pick', char: id })
  }
  const lock = () => {
    if (choice) client.send({ t: 'lock', char: choice })
  }

  const picking = mine !== null && mine.required && !mine.locked
  const opponent = you === null ? null : ((1 - you) as Seat)
  const kept = opponent !== null && !room.picks[opponent].required ? room.picks[opponent].char : null

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6">
      <PickHeader client={client} room={room} />

      {you === null ? (
        <p className="mt-10 text-center text-zinc-400">{t('pick.spectating')}</p>
      ) : !mine!.required ? (
        <KeptNotice char={mine!.char!} />
      ) : (
        <div className={`mt-5 ${wide ? 'grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-6' : 'flex flex-col gap-4'}`}>
          <section className="rounded-2xl border border-zinc-800 bg-zinc-950/85 p-4 sm:p-5">
            {choice ? (
              <CharacterDetails side={resolveSides({ left: choice, right: choice })[0]} compact={!wide} />
            ) : (
              <p className={`text-center text-zinc-500 ${wide ? 'py-10' : 'py-3'}`}>{wide ? t('pick.pickFromSide') : t('pick.pickFromBelow')}</p>
            )}
            {kept && <OpponentKept char={kept} />}
          </section>
          <section className="rounded-2xl border border-zinc-800 bg-zinc-950/85 p-3 sm:p-4">
            <RosterGrid selected={choice} onSelect={select} label={t('pick.rosterLabel')} disabled={!picking} className="grid-cols-5 sm:grid-cols-8" />
          </section>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-900 bg-zinc-950/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <LeaveButton onLeave={onLeave} />
          {picking ? (
            <button
              type="button"
              disabled={!choice}
              onClick={lock}
              className="min-w-0 flex-1 rounded-lg bg-white px-4 py-3 font-pixel text-base font-bold tracking-widest text-black shadow-[0_0_30px_rgba(255,255,255,0.25)] transition hover:scale-[1.02] active:scale-95 disabled:opacity-40"
            >
              {choice ? t('pick.lock', { name: text.name(choice) }) : t('pick.pickFirst')}
            </button>
          ) : (
            <p className="flex-1 text-center text-sm text-zinc-400">{you === null ? t('pick.waitingBoth') : t('pick.waitingOpponent')}</p>
          )}
        </div>
      </div>
    </main>
  )
}

function PickHeader({ client, room }: { client: RoomClient; room: RoomView }) {
  const { t } = useTranslation()
  const text = useCharacterText()
  const now = useNow(250, client.serverNow)
  const left = room.deadline === null ? null : Math.max(0, Math.ceil((room.deadline - now) / 1000))
  const status = (seat: Seat) => {
    const p = room.picks[seat]
    if (!p.required) return t('pick.keeps', { name: text.name(p.char!) })
    return p.locked ? t('pick.locked') : t('pick.choosing')
  }
  return (
    <header>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-400">
            {t('pick.roundInfo', { mode: t(`modes.${room.mode}.name`), round: room.round })}
            {room.mode === 'bo3' && t('pick.score', { left: room.score[0], right: room.score[1] })}
          </p>
          <h1 className="pixel-shadow font-pixel text-2xl font-bold text-white sm:text-3xl">BLIND PICK</h1>
        </div>
        {left !== null && (
          <span
            className={`font-pixel text-3xl font-bold tabular-nums ${left <= 10 ? 'animate-pulse text-red-400' : 'text-white'}`}
            aria-label={t('pick.secondsLeft', { secs: left })}
          >
            {left}
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
        <PlayerChip player={room.players[0]} you={room.you === 0} status={status(0)} />
        <span className="pixel-shadow font-pixel text-lg font-bold text-white">VS</span>
        <PlayerChip player={room.players[1]} you={room.you === 1} status={status(1)} align="right" />
      </div>
    </header>
  )
}

/** BO3: the previous round's winner keeps their character while the loser re-picks. */
function KeptNotice({ char }: { char: CharacterId }) {
  const { t } = useTranslation()
  const text = useCharacterText()
  const def = getCharacter(char)
  return (
    <section className="mx-auto mt-8 max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/85 p-6 text-center">
      <Portrait def={def} color={def.palette.ball} size={120} className="mx-auto rounded-xl" />
      <p className="mt-4 text-lg font-semibold text-white">{t('pick.youKeep', { name: text.name(char) })}</p>
      <p className="mt-1 text-sm text-zinc-400">{t('pick.opponentCounters')}</p>
    </section>
  )
}

function OpponentKept({ char }: { char: CharacterId }) {
  const { t } = useTranslation()
  const text = useCharacterText()
  const def = getCharacter(char)
  return (
    <div className="mt-5 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
      <Portrait def={def} color={def.palette.ball} size={48} className="shrink-0 rounded-lg" />
      <p className="text-sm text-zinc-300">
        {t('pick.opponentKeepsBefore')} <span className="font-semibold text-white">{text.name(char)}</span>
        {t('pick.opponentKeepsAfter')}
      </p>
    </div>
  )
}

/** Leaving mid-series forfeits it, so the first click only arms the button. */
export function LeaveButton({ onLeave, forfeits = true }: { onLeave: () => void; forfeits?: boolean }) {
  const { t } = useTranslation()
  const [armed, setArmed] = useState(false)
  if (!forfeits) {
    return (
      <button type="button" onClick={onLeave} className="shrink-0 rounded-lg border border-zinc-700 px-3 py-3 text-sm text-zinc-300 hover:bg-zinc-800">
        {t('pick.leave')}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => (armed ? onLeave() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className={`shrink-0 rounded-lg border px-3 py-3 text-sm transition ${armed ? 'border-red-500 bg-red-500/15 text-red-300' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`}
    >
      {armed ? t('pick.confirmLeave') : t('pick.leave')}
    </button>
  )
}
