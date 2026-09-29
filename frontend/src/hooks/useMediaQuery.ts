import { useSyncExternalStore } from 'react'

const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

/** True while the CSS media query matches; updates when the window is resized. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      if (!canMatch()) return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => canMatch() && window.matchMedia(query).matches,
    () => false,
  )
}
