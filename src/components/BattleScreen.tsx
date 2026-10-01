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
const MAX_STAGE = 860
const MIN_STAGE = 180
/** Gap between the arena and the HUD (px), matching the gap-3 / gap-5 classes below. */
const STACK_GAP = 12
const SIDE_GAP = 20
/** Side-by-side layout is only worth it if it makes the arena clearly bigger. */
const SIDE_GAIN = 1.15

type Layout = 'stack' | 'side'

/** HUD column width in the side-by-side layout: whatever the arena leaves, within these bounds. */
const SIDEBAR_MIN = 260
const SIDEBAR_MAX = 380

export function BattleScreen({ setup, muted, onToggleMute, onBack }: BattleScreenProps) {
  const [controller] = useState(() => new BattleController(setup, sfx))
  const hud = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  /** Height taken by the title and HUD when stacked, remembered while the side layout is shown. */
  const stackChrome = useRef(200)
  const [stage, setStage] = useState<{ size: number; layout: Layout; sidebar: number }>({ size: 0, layout: 'stack', sidebar: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    controller.attach(canvas)
    return () => controller.detach()
  }, [controller])

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = () => {
      const { width, height } = frame.getBoundingClientRect()
      const head = headRef.current?.offsetHeight ?? 0
      const hudBox = hudRef.current
      // The HUD sits under the arena only in the stacked layout; its height is what the arena must leave room for.
      if (hudBox && head > 0) stackChrome.current = head + hudBox.offsetHeight + STACK_GAP * 2
      const stack = Math.min(width, height - stackChrome.current)
      const side = Math.min(height, width - SIDEBAR_MIN - SIDE_GAP)
      const sidebar = Math.round(Math.min(SIDEBAR_MAX, width - Math.min(MAX_STAGE, side) - SIDE_GAP))
      const layout: Layout = side > stack * SIDE_GAIN ? 'side' : 'stack'
      const size = Math.floor(Math.min(MAX_STAGE, Math.max(MIN_STAGE, layout === 'side' ? side : stack)))
      setStage((prev) => (prev.size === size && prev.layout === layout && prev.sidebar === sidebar ? prev : { size, layout, sidebar }))
      controller.resize(size, window.devicePixelRatio || 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(frame)
    if (headRef.current) ro.observe(headRef.current)
    if (hudRef.current) ro.observe(hudRef.current)
    return () => ro.disconnect()
  }, [controller, stage.layout])

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
  const { size, layout, sidebar } = stage
  const sideLayout = layout === 'side'
  const hudWidth = sideLayout ? sidebar : Math.max(Math.round(size * ARENA_FRACTION), 300)

  const hudPanel = (
    <div ref={sideLayout ? undefined : hudRef} className="@container flex max-w-full flex-col gap-3" style={{ width: hudWidth }}>
      {sideLayout && <Title left={left} right={right} />}
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
  )

  return (
    <div className="h-dvh overflow-hidden p-3 sm:p-5">
      <div ref={frameRef} className="flex h-full w-full items-center justify-center">
        <div className={sideLayout ? 'flex max-w-full items-center gap-5' : 'flex max-w-full flex-col items-center gap-3'}>
          {!sideLayout && (
            <div ref={headRef}>
              <Title left={left} right={right} />
            </div>
          )}
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <canvas ref={canvasRef} className="block h-full w-full" style={{ width: size, height: size }} />
            <PhaseBanner hud={hud} />
            {hud.paused && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <span className="pixel-shadow font-pixel text-4xl font-bold text-white">PAUSED</span>
              </div>
            )}
          </div>
          {hudPanel}
        </div>
      </div>
      {hud.phase === 'finished' && (
        <ResultOverlay hud={hud} sides={controller.sides} onReplay={() => controller.restart()} onRematch={() => controller.rematch()} onBack={onBack} />
      )}
    </div>
  )
}

function Title({ left, right }: { left: MatchSide; right: MatchSide }) {
  return (
    <div className="text-center">
      <h1 className="pixel-shadow flex flex-wrap items-baseline justify-center gap-x-3 font-pixel text-xl font-bold sm:gap-x-4 sm:text-2xl lg:text-4xl">
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
  const btn =
    'whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:opacity-40'
  // Container queries: one row when the HUD is wide, two rows (status / playback) when it's narrow.
  return (
    <div className="flex w-full flex-col gap-2 @[540px]:flex-row @[540px]:flex-wrap @[540px]:items-center @[540px]:justify-between">
      <div className="flex w-full items-center gap-2 @[540px]:w-auto">
        <button type="button" className={btn} onClick={onBack} title="返回选角 (Esc)">
          ← 选角
        </button>
        <span className="font-pixel text-sm tabular-nums text-zinc-400">
          {mm}:{ss}
        </span>
        {hud.overtime && <span className="rounded bg-fuchsia-600/80 px-1.5 py-0.5 text-[10px] font-bold text-white">加时</span>}
        <button type="button" className={`${btn} ml-auto`} onClick={onToggleMute} title="静音 (M)" aria-pressed={muted}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-1.5 @[540px]:justify-end">
        <button type="button" className={btn} onClick={onPause} disabled={hud.phase === 'finished'} title="暂停 / 继续 (空格)">
          {hud.paused ? '▶' : '❚❚'}
          <span className="@max-[340px]:sr-only"> {hud.paused ? '继续' : '暂停'}</span>
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
              className={`whitespace-nowrap px-2 py-1.5 text-xs tabular-nums transition ${
                hud.speed === s ? 'bg-white text-black' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
        <button type="button" className={btn} onClick={onReplay} title="同种子重播 (R)">
          ↻<span className="@max-[340px]:sr-only"> 重播</span>
        </button>
        <button type="button" className={btn} onClick={onRematch} title="新种子再战 (N)">
          🎲<span className="@max-[340px]:sr-only"> 再战</span>
        </button>
      </div>

      <span className="w-full text-center font-mono text-[10px] text-zinc-600">种子 {hud.seed}</span>
    </div>
  )
}
