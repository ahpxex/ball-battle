import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BattleScreen } from './components/BattleScreen'
import { InviteToasts } from './components/InviteToasts'
import { OnlineLobby } from './components/online/OnlineLobby'
import { RoomScreen } from './components/online/RoomScreen'
import { ProfileScreen } from './components/ProfileScreen'
import { SelectScreen } from './components/SelectScreen'
import { sfx } from './game/audio/Sfx'
import { isCharacterId } from './game/characters/registry'
import type { MatchSetup } from './game/match'
import { hub } from './net/hub'
import { useSession } from './net/session'
import { dropQueryParam, parseRoute, useLocation } from './router'

const STORAGE_KEY = 'ball-battle:prefs'

interface Prefs {
  left: MatchSetup['left']
  right: MatchSetup['right']
  muted: boolean
}

const DEFAULT_PREFS: Prefs = { left: 'vampire', right: 'conductor', muted: false }

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>>
    return {
      left: typeof p.left === 'string' && isCharacterId(p.left) ? p.left : DEFAULT_PREFS.left,
      right: typeof p.right === 'string' && isCharacterId(p.right) ? p.right : DEFAULT_PREFS.right,
      muted: typeof p.muted === 'boolean' ? p.muted : DEFAULT_PREFS.muted,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Storage may be unavailable (private mode); preferences are a convenience only.
  }
}

const AUTH_ERRORS = ['cancelled', 'state', 'provider', 'not_configured'] as const
type AuthErrorCode = (typeof AUTH_ERRORS)[number]
const isAuthErrorCode = (v: string | null): v is AuthErrorCode => (AUTH_ERRORS as readonly (string | null)[]).includes(v)

export default function App() {
  const { t } = useTranslation()
  const location = useLocation()
  const route = parseRoute(location.split('?')[0])
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const session = useSession()
  const registered = session.status === 'ready' && !!session.me?.registered
  const [authError] = useState(() => new URLSearchParams(window.location.search).get('auth_error'))

  useEffect(() => {
    sfx.muted = prefs.muted
    savePrefs(prefs)
  }, [prefs])

  useEffect(() => {
    // The canvas uses the pixel font; make sure it's fetched before the first battle.
    void document.fonts?.load('700 20px Silkscreen')
  }, [])

  // Signed-in players stay reachable for friend invites on every page.
  useEffect(() => hub.setActive(registered), [registered])

  useEffect(() => {
    if (authError) dropQueryParam('auth_error')
  }, [authError])

  const toggleMute = useCallback(() => {
    sfx.unlock()
    setPrefs((p) => ({ ...p, muted: !p.muted }))
  }, [])

  return (
    <>
      {route.page === 'local' && <LocalPlay prefs={prefs} setPrefs={setPrefs} onToggleMute={toggleMute} />}
      {route.page === 'online' && <OnlineLobby />}
      {route.page === 'room' && <RoomScreen key={route.code} code={route.code} muted={prefs.muted} onToggleMute={toggleMute} />}
      {route.page === 'me' && <ProfileScreen />}
      <InviteToasts currentRoom={route.page === 'room' ? route.code : null} />
      {authError && <AuthErrorToast message={t(isAuthErrorCode(authError) ? `authErrors.${authError}` : 'authErrors.unknown')} />}
    </>
  )
}

/** Local mode: pick both sides and watch, with replay / speed controls. */
function LocalPlay({ prefs, setPrefs, onToggleMute }: { prefs: Prefs; setPrefs: (f: (p: Prefs) => Prefs) => void; onToggleMute: () => void }) {
  const [match, setMatch] = useState<{ setup: MatchSetup; id: number } | null>(null)

  const start = (setup: MatchSetup) => {
    sfx.unlock()
    setPrefs((p) => ({ ...p, left: setup.left, right: setup.right }))
    setMatch((m) => ({ setup, id: (m?.id ?? 0) + 1 }))
  }

  const back = useCallback(() => setMatch(null), [])

  if (!match) return <SelectScreen initial={prefs} onStart={start} />
  return <BattleScreen key={match.id} setup={match.setup} muted={prefs.muted} onToggleMute={onToggleMute} onBack={back} />
}

function AuthErrorToast({ message }: { message: string }) {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    const id = window.setTimeout(() => setOpen(false), 5000)
    return () => clearTimeout(id)
  }, [])
  if (!open) return null
  return (
    <div role="alert" className="animate-pop-in fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-red-500/40 bg-zinc-950/95 px-4 py-2 text-sm text-red-300 shadow-xl">
      {message}
    </div>
  )
}
