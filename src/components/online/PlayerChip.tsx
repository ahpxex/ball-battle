import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlayerView } from '../../net/protocol'
import { Avatar } from '../Avatar'

interface PlayerChipProps {
  player: PlayerView | null
  you: boolean
  align?: 'left' | 'right'
  /** Status line under the name (defaults to connection state). */
  status?: ReactNode
  accent?: string
}

/** A seat in the room: who sits there and what they're doing. */
export function PlayerChip({ player, you, align = 'left', status, accent }: PlayerChipProps) {
  const { t } = useTranslation()
  const right = align === 'right'
  if (!player) {
    return (
      <div
        className={`flex min-w-0 items-center gap-2 rounded-xl border border-dashed border-zinc-700 p-2.5 text-sm text-zinc-500 ${right ? 'flex-row-reverse text-right' : 'text-left'}`}
      >
        <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-zinc-800" />
        <span>{t('waiting.seatEmpty')}</span>
      </div>
    )
  }
  return (
    <div
      className={`flex min-w-0 items-center gap-2 rounded-xl border bg-zinc-900/60 p-2.5 ${right ? 'flex-row-reverse text-right' : 'text-left'}`}
      style={{ borderColor: accent ? `${accent}88` : '#3f3f46' }}
    >
      <span className="relative shrink-0">
        <Avatar name={player.name} url={player.avatar} size={36} />
        <span
          className={`absolute -bottom-0.5 h-3 w-3 rounded-full border-2 border-zinc-950 ${right ? '-left-0.5' : '-right-0.5'} ${player.connected ? 'bg-emerald-400' : 'bg-zinc-600'}`}
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white">
          {player.name}
          {you && <span className="ml-1 text-xs font-normal text-zinc-400">{t('common.you')}</span>}
        </span>
        <span className="block truncate text-xs text-zinc-500">{status ?? (player.connected ? t('common.online') : t('common.disconnected'))}</span>
      </span>
    </div>
  )
}
