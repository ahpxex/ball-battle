import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../net/api'
import type { FriendEntry, Me } from '../../net/apiTypes'
import { useHub } from '../../net/hub'
import type { RoomView } from '../../net/protocol'
import { useSession } from '../../net/session'
import { navigate } from '../../router'
import { Avatar } from '../Avatar'
import { LoginButtons } from './JoinGate'
import { PlayerChip } from './PlayerChip'

/** Room created, waiting for a second player: share the link or invite a friend. */
export function WaitingRoom({ room, me, onLeave }: { room: RoomView; me: Me; onLeave: () => void }) {
  const { t } = useTranslation()
  const modeName = t(`modes.${room.mode}.name`)
  const link = `${window.location.origin}/r/${room.code}`
  const [copied, setCopied] = useState(false)
  const canShare = typeof navigator.share === 'function'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt(t('waiting.copyPrompt'), link)
    }
  }

  const share = () => {
    void navigator.share({ title: t('waiting.shareTitle'), text: t('waiting.shareText', { mode: modeName, code: room.code }), url: link }).catch(() => {})
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-12 pt-6 sm:pt-10">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/85 p-5 text-center sm:p-7">
        <p className="text-sm text-zinc-400">{t('waiting.status', { mode: modeName })}</p>
        <p className="pixel-shadow mt-2 font-pixel text-4xl font-bold tracking-[0.25em] text-white sm:text-5xl">{room.code}</p>
        <p className="mt-2 text-xs text-zinc-500">{t(`modes.${room.mode}.desc`)}</p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t('waiting.inviteLink')}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-300 outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex-1 rounded-lg bg-white px-4 py-2 font-semibold text-black transition hover:scale-[1.03] sm:flex-none"
            >
              {copied ? t('waiting.linkCopied') : t('waiting.copyLink')}
            </button>
            {canShare && (
              <button
                type="button"
                onClick={share}
                className="flex-1 rounded-lg border border-zinc-600 px-4 py-2 text-sm text-white hover:bg-zinc-800 sm:flex-none"
              >
                {t('waiting.share')}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <PlayerChip player={room.players[0]} you={room.you === 0} />
          <span className="pixel-shadow font-pixel text-xl font-bold text-white">VS</span>
          <PlayerChip player={room.players[1]} you={room.you === 1} align="right" />
        </div>
        {room.you === null && <p className="mt-4 text-sm text-zinc-500">{t('waiting.spectating')}</p>}
      </section>

      {room.you !== null && <FriendInvites room={room} me={me} />}

      <div className="mt-6 text-center">
        <button type="button" onClick={onLeave} className="text-sm text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">
          {t('waiting.leaveRoom')}
        </button>
      </div>
    </main>
  )
}

function FriendInvites({ room, me }: { room: RoomView; me: Me }) {
  const { t } = useTranslation()
  const { friendsVersion } = useHub()
  const sess = useSession()
  const [friends, setFriends] = useState<FriendEntry[] | null>(null)
  const [sent, setSent] = useState<Record<string, 'sent' | 'offline' | 'error'>>({})

  useEffect(() => {
    if (!me.registered) return
    let alive = true
    const load = () =>
      api.friends().then(
        (r) => alive && setFriends(r.friends),
        () => alive && setFriends([]),
      )
    void load()
    // Presence changes aren't pushed; refresh while the room waits.
    const id = window.setInterval(load, 15_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [me.registered, friendsVersion])

  if (!me.registered) {
    const providers = sess.status === 'ready' ? sess.providers : []
    if (providers.length === 0) return null
    return (
      <section className="mt-5 rounded-2xl border border-dashed border-zinc-800 p-5 text-sm text-zinc-400">
        <p>{t('waiting.loginForInvites')}</p>
        <div className="mt-3">
          <LoginButtons providers={providers} />
        </div>
      </section>
    )
  }

  const invite = async (f: FriendEntry) => {
    try {
      const r = await api.invite(f.id, room.code)
      setSent((s) => ({ ...s, [f.id]: r.delivered ? 'sent' : 'offline' }))
    } catch {
      setSent((s) => ({ ...s, [f.id]: 'error' }))
    }
  }

  return (
    <section className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950/85 p-5">
      <h3 className="text-sm font-semibold text-zinc-200">{t('waiting.inviteFriends')}</h3>
      {friends === null ? (
        <p className="mt-3 text-sm text-zinc-500">{t('common.loading')}</p>
      ) : friends.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          {t('waiting.noFriendsBefore')}
          <button type="button" onClick={() => navigate({ page: 'me' })} className="mx-1 text-zinc-300 underline underline-offset-4">
            {t('waiting.noFriendsLink')}
          </button>
          {t('waiting.noFriendsAfter')}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-900">
          {friends.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2">
              <span className="relative">
                <Avatar name={f.name} url={f.avatar} size={32} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-950 ${f.online ? 'bg-emerald-400' : 'bg-zinc-600'}`}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-100">{f.name}</span>
                <span className="block text-xs text-zinc-500">{f.online ? t('common.online') : t('common.offline')}</span>
              </span>
              {sent[f.id] === 'sent' ? (
                <span className="text-xs text-emerald-400">{t('waiting.invited')}</span>
              ) : sent[f.id] === 'offline' ? (
                <span className="text-xs text-zinc-500">{t('waiting.friendOffline')}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void invite(f)}
                  className="rounded-lg border border-zinc-600 px-3 py-1 text-sm text-white transition hover:bg-zinc-800"
                >
                  {sent[f.id] === 'error' ? t('common.retry') : t('waiting.invite')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
