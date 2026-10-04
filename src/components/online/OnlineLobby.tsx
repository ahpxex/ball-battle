import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, errorText } from '../../net/api'
import { type GameMode, isRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from '../../net/protocol'
import { navigate } from '../../router'
import { TopBar } from '../TopBar'
import { JoinGate } from './JoinGate'

const MODE_ORDER: GameMode[] = ['single', 'bo3']
const MODE_TAG: Record<GameMode, string> = { single: 'A', bo3: 'B' }

/** `/online`: create a room in either mode, or join one by code. */
export function OnlineLobby() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar current="online" />
      <header className="mt-6 px-4 text-center sm:mt-10">
        <h1 className="pixel-shadow font-pixel text-3xl font-bold tracking-wider text-white sm:text-5xl">{t('lobby.title')}</h1>
        <p className="mt-3 text-sm text-zinc-400">{t('lobby.intro')}</p>
      </header>
      <JoinGate>{(me) => <Lobby registered={me.registered} />}</JoinGate>
    </div>
  )
}

function Lobby({ registered }: { registered: boolean }) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState<GameMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const create = async (mode: GameMode) => {
    setCreating(mode)
    setError(null)
    try {
      const room = await api.createRoom(mode)
      navigate({ page: 'room', code: room.code })
    } catch (e) {
      setError(errorText(e))
      setCreating(null)
    }
  }

  const join = (e: FormEvent) => {
    e.preventDefault()
    const c = normalizeRoomCode(code)
    if (!isRoomCode(c)) {
      setError(t('lobby.badCode', { length: ROOM_CODE_LENGTH }))
      return
    }
    navigate({ page: 'room', code: c })
  }

  return (
    <main className="mx-auto mt-8 w-full max-w-3xl px-4 pb-12 sm:px-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {MODE_ORDER.map((mode) => (
          <section key={mode} className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white font-pixel text-lg font-bold text-black">{MODE_TAG[mode]}</span>
              <h2 className="text-xl font-semibold text-white">{t(`modes.${mode}.name`)}</h2>
            </div>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-400">{t(`modes.${mode}.desc`)}</p>
            <button
              type="button"
              disabled={creating !== null}
              onClick={() => void create(mode)}
              className="mt-5 rounded-lg bg-white px-4 py-2.5 font-semibold text-black transition hover:scale-[1.02] active:scale-95 disabled:opacity-50"
            >
              {creating === mode ? t('lobby.creating') : t('lobby.create')}
            </button>
          </section>
        ))}
      </div>

      <form onSubmit={join} className="mt-6 flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 sm:flex-row sm:items-center">
        <label htmlFor="room-code" className="shrink-0 text-sm text-zinc-300">
          {t('lobby.haveCode')}
        </label>
        <div className="flex min-w-0 flex-1 gap-2">
          <input
            id="room-code"
            value={code}
            onChange={(e) =>
              setCode(
                e.target.value
                  .toUpperCase()
                  .replace(/[^0-9A-Z]/g, '')
                  .slice(0, ROOM_CODE_LENGTH),
              )
            }
            placeholder={t('lobby.codePlaceholder')}
            autoCapitalize="characters"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-pixel tracking-[0.3em] text-white outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600 focus:border-zinc-400"
          />
          <button type="submit" className="shrink-0 rounded-lg border border-zinc-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800">
            {t('common.join')}
          </button>
        </div>
      </form>

      {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
      {!registered && <p className="mt-6 text-center text-xs text-zinc-500">{t('lobby.guestHint')}</p>}
    </main>
  )
}
