import { type FormEvent, type ReactNode, useState } from 'react'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { errorText, loginUrl } from '../../net/api'
import { AUTH_PROVIDERS, type AuthProvider, type Me } from '../../net/apiTypes'
import { NAME_MAX_LENGTH } from '../../net/protocol'
import { session, useSession } from '../../net/session'

const randomGuestName = (): string => i18next.t('join.defaultName', { n: Math.floor(1000 + Math.random() * 9000) })

const PROVIDER_ICON: Record<AuthProvider, ReactNode> = {
  github: (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  ),
  google: (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  ),
}

/** "Sign in with …" buttons for the configured providers; returns to the current page. */
export function LoginButtons({
  providers,
  exclude = [],
  action = 'login',
}: {
  providers: readonly AuthProvider[]
  exclude?: readonly AuthProvider[]
  /** Sign in, or link another provider to the signed-in account. */
  action?: 'login' | 'link'
}) {
  const { t } = useTranslation()
  const shown = providers.filter((p) => !exclude.includes(p))
  if (shown.length === 0) return null
  const here = window.location.pathname + window.location.search
  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((p) => (
        <a
          key={p}
          href={loginUrl(p, here)}
          className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
        >
          {PROVIDER_ICON[p]}
          {t(action === 'login' ? 'join.loginWith' : 'join.linkWith', { provider: AUTH_PROVIDERS[p].name })}
        </a>
      ))}
    </div>
  )
}

interface JoinGateProps {
  /** Rendered once the visitor has a guest or registered identity. */
  children: (me: Me) => ReactNode
  /** Context shown above the form, e.g. who invited you. */
  intro?: ReactNode
  /** Page chrome (top bar) shown while there is no identity yet. */
  header?: ReactNode
}

/** Online play needs an identity: pick a nickname to play as a guest, or sign in. */
export function JoinGate({ children, intro, header }: JoinGateProps) {
  const { t } = useTranslation()
  const s = useSession()
  const [name, setName] = useState(randomGuestName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (s.status === 'loading')
    return (
      <>
        {header}
        <CenteredNote>{t('join.connecting')}</CenteredNote>
      </>
    )
  if (s.status === 'error')
    return (
      <>
        {header}
        <CenteredNote>
          <p className="text-red-400">{s.message}</p>
          <button
            type="button"
            onClick={() => void session.refresh()}
            className="mt-3 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            {t('common.retry')}
          </button>
        </CenteredNote>
      </>
    )
  if (s.me) return <>{children(s.me)}</>

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await session.playAsGuest(name)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {header}
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <div className="animate-pop-in rounded-2xl border border-zinc-800 bg-zinc-950/90 p-6 shadow-2xl">
          {intro}
          <form onSubmit={submit}>
            <label className="block text-sm text-zinc-400" htmlFor="guest-name">
              {t('join.nicknamePrompt')}
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="guest-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX_LENGTH * 2}
                autoComplete="nickname"
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white outline-none focus:border-zinc-400"
              />
              <button
                type="submit"
                disabled={busy}
                className="shrink-0 rounded-lg bg-white px-4 py-2 font-semibold text-black transition hover:scale-[1.03] disabled:opacity-50"
              >
                {busy ? t('join.entering') : t('join.enter')}
              </button>
            </div>
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          </form>
          {s.providers.length > 0 && (
            <div className="mt-6 border-t border-zinc-800 pt-5">
              <p className="mb-3 text-sm text-zinc-400">{t('join.orLogin')}</p>
              <LoginButtons providers={s.providers} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export function CenteredNote({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[50dvh] flex-col items-center justify-center px-4 text-center text-zinc-400">{children}</div>
}
