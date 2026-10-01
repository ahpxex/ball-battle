import { useEffect, useRef } from 'react'
import type { CharacterDef } from '../game/characters/registry'
import { ARENA_BG } from '../game/render/draw'

interface PortraitProps {
  def: CharacterDef
  color: string
  size: number
  className?: string
}

/** Static canvas illustration of a character, drawn with the in-game art. */
export function Portrait({ def, color, size, className }: PortraitProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Portraits are authored in a 200×200 space.
    const k = (size * dpr) / 200
    ctx.setTransform(k, 0, 0, k, 0, 0)
    ctx.fillStyle = ARENA_BG
    ctx.fillRect(0, 0, 200, 200)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, 200, 200)
    ctx.clip()
    def.drawPortrait(ctx, 100, 100, 38, color)
    ctx.restore()
  }, [def, color, size])

  return <canvas ref={ref} style={{ width: size, height: size }} className={className} aria-label={def.name} role="img" />
}
