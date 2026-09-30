import { useId, useRef, type FormEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { IconButton } from './Button'
import { useDialog } from './useDialog'

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
  /** Makes the body and footer one form, so Enter in a field submits it. Put a `type="submit"`
   * Button in the footer; Cancel stays a normal button. The form skips browser validation:
   * check the values in the handler and show errors on the fields. */
  onSubmit?: () => void
}

/** Centered dialog. On phones it becomes a sheet anchored to the bottom. */
export function Modal({
  open, onClose, title, description, children, footer, size = 'md', closeOnBackdrop = true, initialFocus, className, onSubmit,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useDialog(open, onClose, panel, initialFocus)
  if (!open) return null

  const submitForm = (e: FormEvent) => {
    e.preventDefault()
    onSubmit?.()
  }
  const body = <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
  const footerRow = footer && (
    <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
      {footer}
    </div>
  )

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
          'relative flex max-h-[92dvh] w-full flex-col bg-surface shadow-dialog animate-scale-in focus:outline-none',
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
        {onSubmit ? (
          <form noValidate onSubmit={submitForm} className="flex min-h-0 flex-1 flex-col">
            {body}
            {footerRow}
          </form>
        ) : (
          <>
            {body}
            {footerRow}
          </>
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
  full: 'max-w-full',
}

export interface DrawerProps extends Omit<ModalProps, 'size' | 'onSubmit'> {
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
