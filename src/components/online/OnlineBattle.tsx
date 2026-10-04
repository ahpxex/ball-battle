import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { sfx } from '../../game/audio/Sfx'
import { BattleController } from '../../game/BattleController'
import type { MatchSide } from '../../game/match'
import { useNow } from '../../hooks/useNow'
import { useCharacterText } from '../../i18n/characters'
import { type BattleInfo, EMOTES, type PlayerView, type RoomView, type Seat } from '../../net/protocol'
import type { EmoteEvent, RoomClient } from '../../net/RoomClient'
import { BattleStage, HpBars, Title } from '../BattleScreen'
import { Portrait } from '../Portrait'
import { LeaveButton } from './PickScreen'
import { SeriesResult } from './SeriesResult'

interface OnlineBattleProps {
  client: RoomClient
  room: RoomView
  battle: BattleInfo
  emotes: readonly EmoteEvent[]
  muted: boolean
  onToggleMute: () => void
  onLeave: () => void
}

/** Plays the room's battle in lockstep with the server clock, then shows the round / series result. */
export function OnlineBattle({ client, room, battle, emotes, muted, onToggleMute, onLeave }: OnlineBattleProps) {
  const { t } = useTranslation()
  const [controller] = useState(
    () => new BattleController({ left: battle.left, right: battle.right, seed: battle.seed }, sfx, { startAt: battle.startAt, serverNow: client.serverNow }),
  )
  const hud = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const now = useNow(100, client.serverNow)
  const [left, right] = controller.sides

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') onToggleMute()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggleMute])

  const playedOut = hud.phase === 'finished'

  // The referee's result must match what this browser simulated; a mismatch means the simulation isn't deterministic here.
  const official = room.rounds.find((r) => r.seed === battle.seed && r.left === battle.left && r.right === battle.right)
  useEffect(() => {
    if (playedOut && official && (official.winner !== hud.winner || official.fightTime !== hud.fightTime)) {
      console.error('Battle desync: local result differs from the referee', { local: { winner: hud.winner, fightTime: hud.fightTime }, official })
    }
  }, [playedOut, official, hud.winner, hud.fightTime])
  const seriesRunning = room.phase !== 'seriesOver'
  const names = [room.players[0]?.name ?? '?', room.players[1]?.name ?? '?'] as const

  let overlay = null
  if (now < battle.startAt) overlay = <Reveal sides={controller.sides} players={room.players} secondsLeft={Math.ceil((battle.startAt - now) / 1000)} />
  else if (room.phase === 'seriesOver' && (playedOut || room.forfeit !== null))
    overlay = (
      <ResultLayer>
        <SeriesResult client={client} room={room} onLeave={onLeave} />
      </ResultLayer>
    )
  else if (room.phase === 'roundOver' && playedOut)
    overlay = (
      <ResultLayer>
        <RoundResult client={client} room={room} />
      </ResultLayer>
    )

  return (
    <BattleStage
      controller={controller}
      title={<Title left={left} right={right} />}
      arenaOverlay={<FloatingEmotes emotes={emotes} />}
      overlay={overlay}
      panel={
        <>
          <HpBars hud={hud} left={left} right={right} labels={names} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400">
              {t('online.roundInfo', { mode: t(`modes.${room.mode}.short`), round: room.round })}
              {room.mode === 'bo3' && t('online.score', { left: room.score[0], right: room.score[1] })}
            </span>
            {hud.overtime && <span className="rounded bg-fuchsia-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">{t('battle.overtime')}</span>}
            <button
              type="button"
              onClick={onToggleMute}
              title={t('battle.mute')}
              aria-pressed={muted}
              className="ml-auto rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-600"
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
          {room.you !== null && (
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('online.emotes')}>
              {EMOTES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => client.send({ t: 'emote', e })}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-lg leading-none transition hover:scale-110 hover:border-zinc-600 active:scale-95"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          <div className="flex">
            {room.you !== null ? <LeaveButton onLeave={onLeave} forfeits={seriesRunning} /> : <LeaveButton onLeave={onLeave} forfeits={false} />}
          </div>
        </>
      }
    />
  )
}

function ResultLayer({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-[2px]">{children}</div>
}

/** Both blind picks flip open together before the battle clock starts. */
function Reveal({ sides, players, secondsLeft }: { sides: readonly [MatchSide, MatchSide]; players: RoomView['players']; secondsLeft: number }) {
  const { t } = useTranslation()
  const text = useCharacterText()
  const card = (side: MatchSide, player: PlayerView | null, seat: Seat) => (
    <div className={`flex flex-col items-center ${seat === 0 ? 'animate-reveal-left' : 'animate-reveal-right'}`}>
      <Portrait def={side.def} color={side.palette.ball} size={132} className="rounded-2xl shadow-2xl" />
      <p className="pixel-shadow mt-3 font-pixel text-xl font-bold sm:text-2xl" style={{ color: side.palette.accent }}>
        {side.def.nameEn}
      </p>
      <p className="text-base font-semibold text-white">{text.name(side.def.id)}</p>
      <p className="mt-1 max-w-[9rem] truncate text-xs text-zinc-400">{player?.name}</p>
    </div>
  )
  return (
    <div className="fixed inset-0 z-20 flex flex-col items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-4 sm:gap-10">
        {card(sides[0], players[0], 0)}
        <span className="pixel-shadow animate-pop-in font-pixel text-4xl font-bold text-white sm:text-6xl">VS</span>
        {card(sides[1], players[1], 1)}
      </div>
      <p className="mt-8 font-pixel text-sm tracking-widest text-zinc-400">{t('online.fightIn', { secs: Math.max(1, secondsLeft) })}</p>
    </div>
  )
}

function RoundResult({ client, room }: { client: RoomClient; room: RoomView }) {
  const { t } = useTranslation()
  const now = useNow(250, client.serverNow)
  const last = room.rounds[room.rounds.length - 1]
  if (!last) return null
  const w = last.winner
  const winnerName = w === null ? '' : (room.players[w]?.name ?? '?')
  const loserName = w === null ? '' : (room.players[(1 - w) as Seat]?.name ?? '?')
  const secs = room.deadline === null ? 0 : Math.max(0, Math.ceil((room.deadline - now) / 1000))
  return (
    <div className="animate-pop-in w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-950/95 p-6 text-center shadow-2xl">
      <p className="text-xs tracking-widest text-zinc-500">ROUND {room.rounds.length}</p>
      <h2 className="mt-2 text-xl font-semibold text-white">{w === null ? t('online.draw') : t('online.roundWinner', { name: winnerName })}</h2>
      <p className="pixel-shadow mt-3 font-pixel text-5xl font-bold text-white">
        {room.score[0]} : {room.score[1]}
      </p>
      <p className="mt-4 text-sm text-zinc-400">
        {w === null ? t('online.drawNext') : room.mode === 'bo3' ? t('online.loserSwitches', { name: loserName }) : t('online.repick')} ·{' '}
        {t('online.nextRoundIn', { secs })}
      </p>
    </div>
  )
}

function FloatingEmotes({ emotes }: { emotes: readonly EmoteEvent[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-live="polite">
      {emotes.map((ev) => (
        <span
          key={ev.id}
          className="animate-emote absolute bottom-6 text-4xl"
          // Spread repeated emotes a little so a burst doesn't stack into one glyph.
          style={{ [ev.seat === 0 ? 'left' : 'right']: `${8 + ((ev.id * 37) % 22)}%` }}
        >
          {ev.emote}
        </span>
      ))}
    </div>
  )
}
