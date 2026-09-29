import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Open dialogs, top-most last. Only the top one reacts to Esc and Tab. */
const dialogStack: HTMLElement[] = []

/**
 * Shared dialog behaviour: Esc closes, focus moves into the panel and stays there,
 * the page behind stops scrolling, and focus returns to the trigger on close.
 */
export function useDialog(open: boolean, onClose: () => void, panel: RefObject<HTMLDivElement>, initialFocus?: RefObject<HTMLElement>) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const node = panel.current
    if (!node) return
    dialogStack.push(node)
    document.body.style.overflow = 'hidden'

    const first = initialFocus?.current ?? node?.querySelector<HTMLElement>('[data-autofocus]') ?? node
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== node) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
      if (items.length === 0) { e.preventDefault(); node.focus(); return }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === firstItem || document.activeElement === node)) {
        e.preventDefault(); lastItem.focus()
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault(); firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      dialogStack.splice(dialogStack.indexOf(node), 1)
      if (dialogStack.length === 0) document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [open, panel, initialFocus])
}

