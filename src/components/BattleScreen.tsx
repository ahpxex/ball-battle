import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BattleController, SPEEDS, type HudSnapshot, type Speed } from '../game/BattleController'
import { sfx } from '../game/audio/Sfx'
import type { MatchSetup, MatchSide } from '../game/match'
import { ResultOverlay } from './ResultOverlay'

interface BattleScreenProps {
  setup: MatchSetup
  muted: boolean
  onToggleMute: () => void
  onBack: () => void
}

/** Canvas holds the arena plus a 12-unit glow margin on each side of the 600-unit arena. */
const ARENA_FRACTION = 600 / 624

export function BattleScreen({ setup, muted, onToggleMute, onBack }: BattleScreenProps) {
  const [controller] = useState(() => new BattleController(setup, sfx))
  const hud = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    controller.attach(canvas)
    return () => controller.detach()
  }, [controller])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => {
      const rect = stage.getBoundingClientRect()
      const s = Math.max(200, Math.floor(Math.min(rect.width, rect.height)))
      setSize(s)
      controller.resize(s, window.devicePixelRatio || 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [controller])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        controller.togglePause()
      } else if (e.key === 'r' || e.key === 'R') controller.restart()
      else if (e.key === 'n' || e.key === 'N') controller.rematch()
      else if (e.key === 'm' || e.key === 'M') onToggleMute()
      else if (e.key === 'Escape') onBack()
      else if (['1', '2', '3', '4'].includes(e.key)) controller.setSpeed(SPEEDS[Number(e.key) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [controller, onBack, onToggleMute])

  const [left, right] = controller.sides
  const arenaWidth = Math.round(size * ARENA_FRACTION)

  return (
    <div className="flex h-dvh flex-col items-center px-3 py-3 sm:px-6 sm:py-5">
      <Title left={left} right={right} />

      <div ref={stageRef} className="relative flex min-h-0 w-full max-w-[860px] flex-1 items-center justify-center">
        <div className="relative" style={{ width: size, height: size }}>
          <canvas ref={canvasRef} className="block h-full w-full" style={{ width: size, height: size }} />
          <PhaseBanner hud={hud} />
          {hud.paused && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <span className="pixel-shadow font-pixel text-4xl font-bold text-white">PAUSED</span>
            </div>
          )}
          {hud.phase === 'finished' && (
            <ResultOverlay
              hud={hud}
              sides={controller.sides}
              onReplay={() => controller.restart()}
              onRematch={() => controller.rematch()}
              onBack={onBack}
            />
          )}
        </div>
      </div>

      <div className="mt-2 flex w-full flex-col items-center gap-3" style={{ maxWidth: Math.max(arenaWidth, 320) }}>
        <HpBars hud={hud} left={left} right={right} />
        <Controls
          hud={hud}
          muted={muted}
          onPause={() => controller.togglePause()}
          onSpeed={(s) => controller.setSpeed(s)}
          onReplay={() => controller.restart()}
          onRematch={() => controller.rematch()}
          onToggleMute={onToggleMute}
          onBack={onBack}
        />
      </div>
    </div>
  )
}

function Title({ left, right }: { left: MatchSide; right: MatchSide }) {
  return (
    <div className="mb-2 text-center">
      <h1 className="pixel-shadow flex flex-wrap items-baseline justify-center gap-x-4 font-pixel text-2xl font-bold sm:text-4xl">
        <span style={{ color: left.palette.accent }}>{left.def.nameEn}</span>
        <span className="text-white">VS</span>
        <span style={{ color: right.palette.accent }}>{right.def.nameEn}</span>
      </h1>
      <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
        {left.def.name} 对 {right.def.name}
      </p>
    </div>
  )
}

function PhaseBanner({ hud }: { hud: HudSnapshot }) {
  if (hud.phase === 'countdown') {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="pixel-shadow animate-pop-in font-pixel text-3xl font-bold tracking-widest text-zinc-200">READY</span>
      </div>
    )
  }
  if (hud.phase === 'fight' && hud.fightTime < 0.9) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span key={hud.seed} className="pixel-shadow animate-fight font-pixel text-5xl font-bold text-white">
          FIGHT!
        </span>
      </div>
    )
  }
  if (hud.phase === 'ending') {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="pixel-shadow animate-pop-in font-pixel text-6xl font-bold text-red-500">K.O.</span>
      </div>
    )
  }
  return null
}

function HpBars({ hud, left, right }: { hud: HudSnapshot; left: MatchSide; right: MatchSide }) {
  return (
    <div className="grid w-full grid-cols-2 gap-3">
      <HpBar hp={hud.hp[0]} side={left} align="left" />
      <HpBar hp={hud.hp[1]} side={right} align="right" />
    </div>
  )
}

function HpBar({ hp, side, align }: { hp: number; side: MatchSide; align: 'left' | 'right' }) {
  const pct = Math.min(100, hp)
  const over = Math.max(0, hp - 100)
  return (
    <div className={`flex flex-col gap-1 ${align === 'right' ? 'items-end' : 'items-start'}`}>
      <div className={`flex w-full items-baseline gap-2 text-xs ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span className="font-semibold text-zinc-300">{side.def.name}</span>
        <span className="font-pixel text-sm font-bold" style={{ color: side.palette.accent }}>
          {hp}
        </span>
        {over > 0 && <span className="font-pixel text-xs text-emerald-400">+{over}</span>}
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-sm bg-zinc-800/80">
        <div
          className="absolute inset-y-0 transition-[width] duration-150 ease-out"
          style={{
            width: `${pct}%`,
            background: side.palette.accent,
            boxShadow: over > 0 ? `0 0 10px ${side.palette.accent}` : undefined,
            [align === 'right' ? 'right' : 'left']: 0,
          }}
        />
        {over > 0 && (
          <div
            className="absolute inset-y-0 bg-white/60"
            style={{ width: `${Math.min(100, over)}%`, [align === 'right' ? 'right' : 'left']: 0 }}
          />
        )}
      </div>
    </div>
  )
}

interface ControlsProps {
  hud: HudSnapshot
  muted: boolean
  onPause: () => void
  onSpeed: (s: Speed) => void
  onReplay: () => void
  onRematch: () => void
  onToggleMute: () => void
  onBack: () => void
}

function Controls({ hud, muted, onPause, onSpeed, onReplay, onRematch, onToggleMute, onBack }: ControlsProps) {
  const mm = String(Math.floor(hud.seconds / 60)).padStart(2, '0')
  const ss = String(hud.seconds % 60).padStart(2, '0')
  const btn = 'rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:opacity-40'
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={onBack} title="返回选角 (Esc)">
          ← 选角
        </button>
        <span className="font-pixel text-sm tabular-nums text-zinc-400">
          {mm}:{ss}
        </span>
        {hud.overtime && <span className="rounded bg-fuchsia-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">加时</span>}
      </div>

      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} onClick={onPause} disabled={hud.phase === 'finished'} title="暂停 / 继续 (空格)">
          {hud.paused ? '▶ 继续' : '❚❚ 暂停'}
        </button>
        <div className="flex overflow-hidden rounded-md border border-zinc-800" role="radiogroup" aria-label="速度">
          {SPEEDS.map((s, i) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={hud.speed === s}
              onClick={() => onSpeed(s)}
              title={`速度 ${s}x (${i + 1})`}
              className={`px-2.5 py-1.5 text-xs tabular-nums transition ${
                hud.speed === s ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
        <button type="button" className={btn} onClick={onReplay} title="同种子重播 (R)">
          ↻ 重播
        </button>
        <button type="button" className={btn} onClick={onRematch} title="新种子再战 (N)">
          🎲 再战
        </button>
        <button type="button" className={btn} onClick={onToggleMute} title="静音 (M)" aria-pressed={muted}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <span className="w-full text-center font-mono text-[10px] text-zinc-600">种子 {hud.seed}</span>
    </div>
  )
}
