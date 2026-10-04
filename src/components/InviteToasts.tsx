import { hub, useHub } from '../net/hub'
import { useTranslation } from 'react-i18next'
import { navigate } from '../router'
import { Avatar } from './Avatar'

/** Friend invites pushed through the hub, shown on any page. */
export function InviteToasts({ currentRoom }: { currentRoom: string | null }) {
  const { t } = useTranslation()
  const { invites } = useHub()
  const shown = invites.filter((i) => i.room !== currentRoom)
  if (shown.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {shown.map((inv) => (
        <div key={inv.id} className="animate-pop-in flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-950/95 p-3 shadow-2xl">
          <Avatar name={inv.from.name} url={inv.from.avatar} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{inv.from.name}</p>
            <p className="text-xs text-zinc-400">{t('invite.toast', { mode: t(`modes.${inv.mode}.name`) })}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              hub.dismiss(inv.id)
              navigate({ page: 'room', code: inv.room })
            }}
            className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-black"
          >
            {t('common.join')}
          </button>
          <button type="button" onClick={() => hub.dismiss(inv.id)} aria-label={t('common.ignore')} className="shrink-0 px-1 text-zinc-500 hover:text-zinc-300">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
