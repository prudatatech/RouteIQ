import { useEffect, useState } from 'react'

/** "1 h 20 min left", "12 min left", or "Time is up". Pure so it can be tested. */
export function countdownText(deadline: string | null | undefined, now: number = Date.now()): string | null {
  if (!deadline) return null
  const ms = Date.parse(deadline) - now
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return 'Time is up'
  const mins = Math.ceil(ms / 60_000)
  if (mins < 60) return `${mins} min left`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h left` : `${h} h${m ? ` ${m} min` : ''} left`
}

/** Re-renders every 30 seconds so a countdown stays current. */
export function useCountdown(deadline: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return undefined
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [deadline])
  return countdownText(deadline, now)
}
