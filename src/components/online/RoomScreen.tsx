import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../net/api'
import type { Me } from '../../net/apiTypes'
import { type BattleInfo, isRoomCode, type RoomSummary } from '../../net/protocol'
import { RoomClient } from '../../net/RoomClient'
import { navigate } from '../../router'
import { TopBar } from '../TopBar'
import { CenteredNote, JoinGate } from './JoinGate'
import { OnlineBattle } from './OnlineBattle'
import { PickScreen } from './PickScreen'
import { SeriesResult } from './SeriesResult'
import { WaitingRoom } from './WaitingRoom'

interface RoomScreenProps {
  code: string
  muted: boolean
  onToggleMute: () => void
}

/** `/r/:code`: everything that happens inside one online room. */
export function RoomScreen({ code, muted, onToggleMute }: RoomScreenProps) {
  const { t } = useTranslation()
  if (!isRoomCode(code)) return <RoomGone message={t('room.invalidCode')} />
  return (
    <JoinGate intro={<RoomIntro code={code} />} header={<TopBar current="room" />}>
      {(me) => <RoomSession code={code} me={me} muted={muted} onToggleMute={onToggleMute} />}
    </JoinGate>
  )
}

/** Shown on the nickname form when arriving through an invite link. */
function RoomIntro({ code }: { code: string }) {
  const { t } = useTranslation()
  const [room, setRoom] = useState<RoomSummary | null | 'missing'>(null)
  useEffect(() => {
    api.room(code).then(setRoom, () => setRoom('missing'))
  }, [code])
  if (room === 'missing') return <p className="mb-5 text-sm text-red-400">{t('room.gone', { code })}</p>
  const host = room?.players.find(Boolean)
  return (
    <div className="mb-5">
      <p className="font-pixel text-xs tracking-[0.3em] text-zinc-500">ROOM {code}</p>
      <h2 className="mt-1 text-lg font-semibold text-white">
        {!room
          ? t('room.joinRoom')
          : host
            ? t('room.invitedBy', { host, mode: t(`modes.${room.mode}.name`) })
            : t('room.joinRoomMode', { mode: t(`modes.${room.mode}.name`) })}
      </h2>
    </div>
  )
}

function RoomSession({ code, me, muted, onToggleMute }: { code: string; me: Me } & Omit<RoomScreenProps, 'code'>) {
  const { t } = useTranslation()
  const [client] = useState(() => new RoomClient(code))
  useEffect(() => {
    client.start()
    return () => client.stop()
  }, [client])
  const st = useSyncExternalStore(client.subscribe, client.getSnapshot)
  const room = st.room

  // Keep showing the battle being watched until the room moves on to new picks,
  // even if the server announces the result a moment before local playback ends.
  const [watching, setWatching] = useState<BattleInfo | null>(null)
  const battle = room?.battle ?? null
  if (battle && battle.seed !== watching?.seed) setWatching(battle)
  if (watching && (room?.phase === 'picking' || room?.phase === 'waiting')) setWatching(null)

  const leave = () => {
    client.send({ t: 'leave' })
    navigate({ page: 'online' })
  }

  if (st.fatal) return <RoomGone message={st.fatal} />
  if (!room) {
    return (
      <div className="min-h-dvh">
        <TopBar current="room" />
        <CenteredNote>{st.status === 'reconnecting' ? t('room.cantReach') : t('room.entering')}</CenteredNote>
      </div>
    )
  }

  const banner = st.status !== 'open' && (
    <div className="fixed inset-x-0 top-0 z-40 bg-amber-500/90 py-1 text-center text-xs font-semibold text-black">{t('room.reconnecting')}</div>
  )

  if (watching && (room.phase === 'battle' || room.phase === 'roundOver' || room.phase === 'seriesOver')) {
    return (
      <>
        {banner}
        <OnlineBattle
          key={watching.seed}
          client={client}
          room={room}
          battle={watching}
          emotes={st.emotes}
          muted={muted}
          onToggleMute={onToggleMute}
          onLeave={leave}
        />
      </>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {banner}
      <TopBar current="room" />
      {room.phase === 'waiting' && <WaitingRoom room={room} me={me} onLeave={leave} />}
      {room.phase === 'picking' && <PickScreen key={room.round} client={client} room={room} onLeave={leave} />}
      {(room.phase === 'roundOver' || room.phase === 'battle') && <CenteredNote>{t('room.inProgress')}</CenteredNote>}
      {room.phase === 'seriesOver' && (
        <div className="px-4 py-8">
          <SeriesResult client={client} room={room} onLeave={leave} />
        </div>
      )}
    </div>
  )
}

function RoomGone({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="min-h-dvh">
      <TopBar current="room" />
      <CenteredNote>
        <p className="text-lg text-zinc-200">{message}</p>
        <button type="button" onClick={() => navigate({ page: 'online' })} className="mt-4 rounded-lg bg-white px-5 py-2 font-semibold text-black">
          {t('room.backToLobby')}
        </button>
      </CenteredNote>
    </div>
  )
}
