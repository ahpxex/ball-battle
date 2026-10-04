import { useTranslation } from 'react-i18next'
import { useSession } from '../net/session'
import { navigate, type Route } from '../router'
import { Avatar } from './Avatar'
import { LanguageSwitcher } from './LanguageSwitcher'

const TABS: { page: Route['page']; label: 'nav.local' | 'nav.online'; to: Route }[] = [
  { page: 'local', label: 'nav.local', to: { page: 'local' } },
  { page: 'online', label: 'nav.online', to: { page: 'online' } },
]

/** Site navigation: local / online play, plus the account chip. */
export function TopBar({ current }: { current: Route['page'] }) {
  const { t } = useTranslation()
  const session = useSession()
  const me = session.status === 'ready' ? session.me : null
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 pt-3 sm:px-6">
      <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/70 p-0.5">
        {TABS.map((tab) => {
          const active = tab.page === current || (tab.page === 'online' && current === 'room')
          return (
            <a
              key={tab.page}
              href={tab.page === 'local' ? '/' : '/online'}
              onClick={(e) => {
                e.preventDefault()
                navigate(tab.to)
              }}
              aria-current={active ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 text-sm transition ${active ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'}`}
            >
              {t(tab.label)}
            </a>
          )
        })}
      </div>
      <div className="ml-auto">
        <LanguageSwitcher />
      </div>
      <a
        href="/me"
        onClick={(e) => {
          e.preventDefault()
          navigate({ page: 'me' })
        }}
        aria-current={current === 'me' ? 'page' : undefined}
        className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-sm transition ${
          current === 'me' ? 'border-zinc-500 bg-zinc-900 text-white' : 'border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-600'
        }`}
      >
        {me ? (
          <>
            <Avatar name={me.name} url={me.avatar} size={22} />
            <span className="max-w-[5rem] truncate sm:max-w-[9rem]">{me.name}</span>
            {!me.registered && <span className="shrink-0 rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">{t('nav.guest')}</span>}
          </>
        ) : (
          <span className="whitespace-nowrap px-1">{t('nav.login')}</span>
        )}
      </a>
    </nav>
  )
}
