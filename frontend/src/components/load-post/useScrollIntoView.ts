/**
 * Scrolling helpers for the Post a Load form: smooth unless the person asked for less motion, and aware of the
 * sticky site header so a field is never hidden under it.
 */
import { useEffect, type RefObject } from 'react'

export const prefersReducedMotion = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch { return false }
}

export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth')

/** Height of the sticky header at the top of the page (0 when there is none). */
export function stickyHeaderHeight(): number {
  if (typeof document === 'undefined') return 0
  const header = document.querySelector('header.sticky')
  return header instanceof HTMLElement ? header.getBoundingClientRect().height : 0
}

/** Space the visible area leaves below `offset` px from its top, using the visual viewport (the phone keyboard shrinks it). */
export const visibleHeight = (): number => (typeof window === 'undefined' ? 800 : window.visualViewport?.height ?? window.innerHeight)

/** Scroll so `el` sits just under the sticky header. Does nothing when it is already comfortably there. */
export function scrollElementIntoView(el: HTMLElement, gap = 12): void {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return
  const top = el.getBoundingClientRect().top
  const wanted = stickyHeaderHeight() + gap
  if (top >= wanted - 4 && top <= wanted + 8) return
  window.scrollTo({ top: Math.max(0, top + (window.scrollY || 0) - wanted), behavior: scrollBehavior() })
}

export function scrollPageTop(): void {
  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo({ top: 0, behavior: scrollBehavior() })
}

/**
 * After a failed Next, move to the first invalid field inside `root` and focus it. `tick` changes once per failed
 * attempt; the errors are already rendered (and any collapsed part opened) by the time this runs.
 */
export function useScrollToFirstInvalid(root: RefObject<HTMLElement>, tick: number): void {
  useEffect(() => {
    if (!tick || !root.current) return
    const bad = root.current.querySelector<HTMLElement>('[aria-invalid="true"]')
    const target = bad ?? root.current.querySelector<HTMLElement>('[role="alert"]')
    if (!target) return
    scrollElementIntoView(target, 24)
    if (bad) bad.focus({ preventScroll: true })
  }, [tick, root])
}
