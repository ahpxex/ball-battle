import { useEffect, useState } from 'react'

/** Re-renders every `intervalMs` and returns `clock()` (defaults to Date.now). */
export function useNow(intervalMs: number, clock: () => number = Date.now): number {
  const [now, setNow] = useState(clock)
  useEffect(() => {
    const id = window.setInterval(() => setNow(clock()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, clock])
  return now
}
