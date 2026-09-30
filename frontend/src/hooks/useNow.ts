import { useEffect, useState } from 'react'

/** The current time in ms, refreshed every `ms`, so countdowns and open/closed states follow the clock. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
