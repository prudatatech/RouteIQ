import type { ReactNode } from 'react'
import clsx from 'clsx'

/** A bordered radio choice with a title and a line under it. */
export default function Radio({ name, checked, onChange, children, className, value }: {
  name: string
  checked: boolean
  onChange: () => void
  children: ReactNode
  className?: string
  value?: string
}) {
  return (
    <label className={clsx(
      'flex cursor-pointer items-start gap-3 rounded-control border p-3 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand',
      checked ? 'border-brand bg-brand-soft' : 'border-border-strong bg-surface hover:bg-surface-subtle', className,
    )}>
      <input type="radio" name={name} checked={checked} onChange={onChange} value={value} className="mt-0.5 h-4 w-4 accent-brand" />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  )
}
