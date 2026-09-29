import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { IconButton } from './Button'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Open dialogs, top-most last. Only the top one reacts to Esc and Tab. */
const dialogStack: HTMLElement[] = []

/**
 * Shared dialog behaviour: Esc closes, focus moves into the panel and stays there,
 * the page behind stops scrolling, and focus returns to the trigger on close.
 */
function useDialog(open: boolean, onClose: () => void, panel: RefObject<HTMLDivElement>, initialFocus?: RefObject<HTMLElement>) {
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

const modalSizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Buttons row, right-aligned. Put the primary action last. */
  footer?: ReactNode
  size?: keyof typeof modalSizes
  /** Set false for dialogs that must not be dismissed by clicking outside (unsaved work). */
  closeOnBackdrop?: boolean
  initialFocus?: RefObject<HTMLElement>
  className?: string
}

/** Centered dialog. On phones it becomes a sheet anchored to the bottom. */
export function Modal({
  open, onClose, title, description, children, footer, size = 'md', closeOnBackdrop = true, initialFocus, className,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useDialog(open, onClose, panel, initialFocus)
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-overlay animate-fade-in" aria-hidden="true" onClick={closeOnBackdrop ? onClose : undefined} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={clsx(
          'relative flex max-h-[92vh] w-full flex-col bg-surface shadow-dialog animate-scale-in focus:outline-none',
          'rounded-t-card sm:rounded-card',
          modalSizes[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-text">{title}</h2>
            {description && <p id={descId} className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <IconButton label="Close" icon={<X size={18} />} size="sm" onClick={onClose} className="-mr-2" />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

const drawerSizes = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-xl',
  xl: 'sm:max-w-3xl',
}

export interface DrawerProps extends Omit<ModalProps, 'size'> {
  size?: keyof typeof drawerSizes
}

/** Panel that slides in from the right, for record details and side tasks. */
export function Drawer({
  open, onClose, title, description, children, footer, size = 'lg', closeOnBackdrop = true, initialFocus, className,
}: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useDialog(open, onClose, panel, initialFocus)
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-overlay animate-fade-in" aria-hidden="true" onClick={closeOnBackdrop ? onClose : undefined} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={clsx(
          'relative flex h-full w-full flex-col bg-surface shadow-dialog animate-slide-in-right focus:outline-none',
          drawerSizes[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-text">{title}</h2>
            {description && <div id={descId} className="mt-1 text-sm text-muted">{description}</div>}
          </div>
          <IconButton label="Close" icon={<X size={18} />} size="sm" onClick={onClose} className="-mr-2" />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
