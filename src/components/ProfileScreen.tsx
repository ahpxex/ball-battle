import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCharacter } from '../game/characters/registry'
import { api, errorText } from '../net/api'
import { AUTH_PROVIDERS, type FriendsResponse, type HistoryResponse, type Me, type SeriesEntry } from '../net/apiTypes'
import { useHub } from '../net/hub'
import { NAME_MAX_LENGTH, type UserSummary } from '../net/protocol'
import { session, useSession } from '../net/session'
import { navigate } from '../router'
import { Avatar } from './Avatar'
import { CenteredNote, LoginButtons } from './online/JoinGate'
import { Portrait } from './Portrait'
import { TopBar } from './TopBar'

/** `/me`: account, friends and match history. */
export function ProfileScreen() {
  const { t } = useTranslation()
  const s = useSession()
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar current="me" />
      {s.status === 'loading' && <CenteredNote>{t('common.loading')}</CenteredNote>}
      {s.status === 'error' && <CenteredNote>{s.message}</CenteredNote>}
      {s.status === 'ready' && !s.me && (
        <main className="mx-auto mt-10 w-full max-w-md px-4 text-center">
          <h1 className="text-2xl font-semibold text-white">{t('profile.loginTitle')}</h1>
          <p className="mt-2 text-sm text-zinc-400">{t('profile.loginIntro')}</p>
          <div className="mt-5 flex justify-center">
            {s.providers.length > 0 ? <LoginButtons providers={s.providers} /> : <p className="text-sm text-zinc-500">{t('profile.noProviders')}</p>}
          </div>
          <p className="mt-8 text-xs text-zinc-500">
            {t('profile.noLoginBefore')}
            <button type="button" onClick={() => navigate({ page: 'online' })} className="mx-1 text-zinc-300 underline underline-offset-4">
              {t('profile.noLoginLink')}
            </button>
            {t('profile.noLoginAfter')}
          </p>
        </main>
      )}
      {s.status === 'ready' && s.me && <Profile me={s.me} providers={s.providers} />}
    </div>
  )
}

function Profile({ me, providers }: { me: Me; providers: readonly (keyof typeof AUTH_PROVIDERS)[] }) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-16 pt-6 sm:px-6">
      <AccountCard me={me} providers={providers} />
      {me.registered ? <Friends me={me} /> : null}
      <History me={me} />
    </main>
  )
}

const card = 'rounded-2xl border border-zinc-800 bg-zinc-950/85 p-5'

function AccountCard({ me, providers }: { me: Me; providers: readonly (keyof typeof AUTH_PROVIDERS)[] }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(me.name)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await session.rename(name)
      setEditing(false)
      setError(null)
    } catch (err) {
      setError(errorText(err))
    }
  }

  const logout = async () => {
    await session.logout()
    navigate({ page: 'local' })
  }

  return (
    <section className={card}>
      <div className="flex items-center gap-4">
        <Avatar name={me.name} url={me.avatar} size={56} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={save} className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX_LENGTH * 2}
                autoFocus
                aria-label={t('profile.nickname')}
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-white outline-none focus:border-zinc-400"
              />
              <button type="submit" className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-black">
                {t('profile.save')}
              </button>
            </form>
          ) : (
            <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
              <span className="truncate">{me.name}</span>
              <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-xs font-normal text-zinc-500 hover:text-zinc-300">
                {t('profile.rename')}
              </button>
            </h1>
          )}
          {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
          <p className="mt-1 text-sm text-zinc-400">
            {me.registered
              ? t('profile.signedInWith', { providers: me.linked.map((p) => AUTH_PROVIDERS[p].name).join(t('profile.providerSeparator')) })
              : t('profile.guestNote')}
          </p>
        </div>
      </div>

      {!me.registered && providers.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm text-amber-100">{t('profile.upgradeHint')}</p>
          <div className="mt-3">
            <LoginButtons providers={providers} />
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {me.registered && <LoginButtons providers={providers} exclude={me.linked} action="link" />}
        <button
          type="button"
          onClick={() => void logout()}
          className="ml-auto rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          {me.registered ? t('profile.logout') : t('profile.clearGuest')}
        </button>
      </div>
    </section>
  )
}

function Friends({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { friendsVersion } = useHub()
  const [data, setData] = useState<FriendsResponse | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    api.friends().then(setData, (e: unknown) => setMessage({ ok: false, text: errorText(e) }))
  }, [])
  useEffect(() => {
    load()
    // Presence isn't pushed; refresh while the page is open.
    const id = window.setInterval(load, 20_000)
    return () => clearInterval(id)
  }, [load, friendsVersion])

  const act = async (run: () => Promise<unknown>, ok?: string) => {
    try {
      await run()
      if (ok) setMessage({ ok: true, text: ok })
      load()
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) })
    }
  }

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    void act(async () => {
      const r = await api.addFriend({ code })
      setCode('')
      setMessage({ ok: true, text: r.status === 'accepted' ? t('series.alreadyFriends') : t('series.requestSent') })
    })
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(me.friendCode ?? '')
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked; the code is visible to copy by hand.
    }
  }

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-white">{t('profile.friends')}</h2>
        <span className="ml-auto text-sm text-zinc-400">{t('profile.friendCode')}</span>
        <button
          type="button"
          onClick={() => void copyCode()}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 font-pixel tracking-[0.2em] text-white hover:border-zinc-500"
          title={t('profile.copyHint')}
        >
          {copied ? t('common.copied') : me.friendCode}
        </button>
      </div>

      <form onSubmit={add} className="mt-4 flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
          placeholder={t('profile.friendCodePlaceholder')}
          aria-label={t('profile.friendCodeLabel')}
          autoCapitalize="characters"
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-pixel tracking-[0.2em] text-white outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600 focus:border-zinc-400"
        />
        <button type="submit" className="shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black">
          {t('profile.add')}
        </button>
      </form>
      {message && <p className={`mt-2 text-sm ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>}

      {data === null ? (
        <p className="mt-4 text-sm text-zinc-500">{t('common.loading')}</p>
      ) : (
        <>
          {data.incoming.length > 0 && (
            <FriendList title={t('profile.requests')}>
              {data.incoming.map((u) => (
                <UserRow key={u.id} user={u}>
                  <button
                    type="button"
                    onClick={() => void act(() => api.acceptFriend(u.id), t('profile.added', { name: u.name }))}
                    className="rounded-lg bg-white px-3 py-1 text-sm font-semibold text-black"
                  >
                    {t('profile.accept')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void act(() => api.removeFriend(u.id))}
                    className="rounded-lg border border-zinc-700 px-3 py-1 text-sm text-zinc-300"
                  >
                    {t('common.ignore')}
                  </button>
                </UserRow>
              ))}
            </FriendList>
          )}
          <FriendList title={t('profile.friendList', { count: data.friends.length })}>
            {data.friends.length === 0 && <li className="py-2 text-sm text-zinc-500">{t('profile.noFriends')}</li>}
            {data.friends.map((f) => (
              <UserRow key={f.id} user={f} online={f.online}>
                <RemoveButton onConfirm={() => void act(() => api.removeFriend(f.id))} />
              </UserRow>
            ))}
          </FriendList>
          {data.outgoing.length > 0 && (
            <FriendList title={t('profile.awaiting')}>
              {data.outgoing.map((u) => (
                <UserRow key={u.id} user={u}>
                  <button type="button" onClick={() => void act(() => api.removeFriend(u.id))} className="text-sm text-zinc-500 hover:text-zinc-300">
                    {t('profile.withdraw')}
                  </button>
                </UserRow>
              ))}
            </FriendList>
          )}
        </>
      )}
    </section>
  )
}

function FriendList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold tracking-wider text-zinc-500">{title}</h3>
      <ul className="mt-1 divide-y divide-zinc-900">{children}</ul>
    </div>
  )
}

function UserRow({ user, online, children }: { user: UserSummary; online?: boolean; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="relative">
        <Avatar name={user.name} url={user.avatar} size={32} />
        {online !== undefined && (
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-950 ${online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-100">{user.name}</span>
        {online !== undefined && <span className="block text-xs text-zinc-500">{online ? t('common.online') : t('common.offline')}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">{children}</span>
    </li>
  )
}

function RemoveButton({ onConfirm }: { onConfirm: () => void }) {
  const { t } = useTranslation()
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className={`text-sm ${armed ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}
    >
      {armed ? t('profile.confirmRemove') : t('profile.remove')}
    </button>
  )
}

function History({ me }: { me: Me }) {
  const { t } = useTranslation()
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.history().then(setData, (e: unknown) => setError(errorText(e)))
  }, [me.id])

  const total = data ? data.wins + data.losses : 0
  return (
    <section className={card}>
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold text-white">{t('profile.history')}</h2>
        {data && total > 0 && (
          <span className="text-sm text-zinc-400">
            {t('profile.record', { wins: data.wins, losses: data.losses, rate: Math.round((data.wins / total) * 100) })}
          </span>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {data === null && !error && <p className="mt-3 text-sm text-zinc-500">{t('common.loading')}</p>}
      {data && data.series.length === 0 && <p className="mt-3 text-sm text-zinc-500">{t('profile.noHistory')}</p>}
      {data && data.series.length > 0 && (
        <ul className="mt-3 space-y-2">
          {data.series.map((s) => (
            <SeriesRow key={s.id} entry={s} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SeriesRow({ entry }: { entry: SeriesEntry }) {
  const { t, i18n } = useTranslation()
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [i18n.language],
  )
  const won = entry.winner === entry.you
  const mine = entry.score[entry.you]
  const theirs = entry.score[entry.you === 0 ? 1 : 0]
  return (
    <li className="rounded-xl border border-zinc-900 bg-zinc-900/50 p-3">
      <div className="flex items-center gap-3">
        <span className={`w-9 shrink-0 rounded-md py-0.5 text-center text-sm font-bold ${won ? 'bg-amber-400 text-black' : 'bg-zinc-700 text-zinc-200'}`}>
          {won ? t('profile.win') : t('profile.loss')}
        </span>
        <Avatar name={entry.opponent.name} url={entry.opponent.avatar} size={26} />
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{t('profile.versus', { name: entry.opponent.name })}</span>
        <span className="shrink-0 font-pixel text-sm text-white">
          {mine}:{theirs}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <span>{t(`modes.${entry.mode}.name`)}</span>
        <span>{dateFmt.format(entry.endedAt)}</span>
        {entry.forfeit !== null && <span>{entry.forfeit === entry.you ? t('profile.youLeftEarly') : t('profile.opponentLeftEarly')}</span>}
        <span className="flex flex-wrap gap-1">
          {entry.rounds.map((r, i) => {
            const myChar = getCharacter(entry.you === 0 ? r.left : r.right)
            return <Portrait key={i} def={myChar} color={myChar.palette.ball} size={20} className={`rounded ${r.winner === entry.you ? '' : 'opacity-40'}`} />
          })}
        </span>
      </div>
    </li>
  )
}
