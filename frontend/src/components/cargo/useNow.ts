import { useEffect, useState } from 'react'

/** The current time, refreshed every `intervalMs`, so countdowns and ages keep ticking. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
