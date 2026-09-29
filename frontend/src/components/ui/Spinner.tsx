import clsx from 'clsx'

/** Circular loading indicator. `current` follows the surrounding text colour. */
export function Spinner({ size = 20, tone = 'brand', label, className }: {
  size?: number
  tone?: 'brand' | 'current' | 'inverse'
  /** When set, announced to screen readers; otherwise the spinner is decorative. */
  label?: string
  className?: string
}) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={clsx(
        'inline-block shrink-0 animate-spin rounded-full border-2',
        tone === 'brand' && 'border-border border-t-brand',
        tone === 'current' && 'border-current border-r-transparent',
        tone === 'inverse' && 'border-white border-r-transparent',
        className,
      )}
      style={{ width: size, height: size }}
    />
  )
}

/** Centered spinner for a region or a whole page that is loading. */
export function LoadingState({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-3 py-16 text-sm text-muted', className)}>
      <Spinner size={28} label={label} />
      <span aria-hidden="true">{label}</span>
    </div>
  )
}
