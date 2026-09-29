import { type ChangeEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { Spinner } from './Spinner'
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles'

export interface FileButtonProps {
  /** Called with the chosen file. The picker is cleared afterwards so the same file can be chosen again. */
  onFile: (file: File) => void
  accept?: string
  disabled?: boolean
  /** Shows a spinner in place of the icon and blocks the picker. */
  loading?: boolean
  icon?: ReactNode
  /** `link` looks like a text link; `bare` adds no styling so the caller lays out the label. */
  variant?: ButtonVariant | 'link' | 'bare'
  size?: ButtonSize
  className?: string
  children: ReactNode
}

const focusRing = 'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand'

/**
 * A button that opens the file picker. The real file input stays in the tab order (it is only
 * visually hidden), so it works with the keyboard and screen readers: Tab to it, then Enter or
 * Space. The label shows the focus ring while the input has focus.
 */
export function FileButton({
  onFile, accept, disabled, loading, icon, variant = 'secondary', size = 'md', className, children,
}: FileButtonProps) {
  const blocked = !!disabled || !!loading
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onFile(file)
  }
  const look = variant === 'link'
    ? 'inline-flex items-center gap-1.5 rounded-control text-sm font-medium text-brand hover:underline'
    : variant === 'bare'
      ? ''
      : buttonClasses({ variant, size })

  return (
    <label className={clsx(look, focusRing, blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', className)}>
      {loading ? <Spinner size={14} tone="current" /> : icon}
      {children}
      <input type="file" className="sr-only" accept={accept} disabled={blocked} onChange={onChange} />
    </label>
  )
}
