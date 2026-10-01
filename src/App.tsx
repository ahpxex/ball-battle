import { useCallback, useEffect, useState } from 'react'
import { BattleScreen } from './components/BattleScreen'
import { SelectScreen } from './components/SelectScreen'
import { sfx } from './game/audio/Sfx'
import { isCharacterId } from './game/characters/registry'
import type { MatchSetup } from './game/match'

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

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [match, setMatch] = useState<{ setup: MatchSetup; id: number } | null>(null)

  useEffect(() => {
    sfx.muted = prefs.muted
    savePrefs(prefs)
  }, [prefs])

  useEffect(() => {
    // The canvas uses the pixel font; make sure it's fetched before the first battle.
    void document.fonts?.load('700 20px Silkscreen')
  }, [])

  const start = (setup: MatchSetup) => {
    sfx.unlock()
    setPrefs((p) => ({ ...p, left: setup.left, right: setup.right }))
    setMatch((m) => ({ setup, id: (m?.id ?? 0) + 1 }))
  }

  const toggleMute = useCallback(() => {
    sfx.unlock()
    setPrefs((p) => ({ ...p, muted: !p.muted }))
  }, [])

  const back = useCallback(() => setMatch(null), [])

  if (!match) return <SelectScreen initial={prefs} onStart={start} />
  return <BattleScreen key={match.id} setup={match.setup} muted={prefs.muted} onToggleMute={toggleMute} onBack={back} />
}
