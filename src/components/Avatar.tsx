interface AvatarProps {
  name: string
  url: string | null
  size?: number
  className?: string
}

/** Profile picture, or the first character of the name on a tinted tile. */
export function Avatar({ name, url, size = 28, className = '' }: AvatarProps) {
  const style = { width: size, height: size }
  if (url) return <img src={url} alt="" style={style} className={`shrink-0 rounded-full bg-zinc-800 object-cover ${className}`} referrerPolicy="no-referrer" />
  const initial = [...name][0] ?? '?'
  // Stable hue per name so the same player always gets the same color.
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return (
    <span
      aria-hidden
      style={{ ...style, background: `hsl(${h} 45% 28%)`, fontSize: size * 0.48 }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
    >
      {initial}
    </span>
  )
}
