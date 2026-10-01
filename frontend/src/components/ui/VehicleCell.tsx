import clsx from 'clsx'

/**
 * The Vehicle column in every list: the plate first, the driver (or another detail) under it.
 * With no plate it says so in words, so a driver's name is never shown where a plate is expected.
 */
export function VehicleCell({ plate, detail, empty = 'Not assigned', className }: {
  plate?: string | null
  detail?: string | null
  /** What to say when there is no plate and no detail. */
  empty?: string
  className?: string
}) {
  if (!plate && !detail) return <span className={clsx('whitespace-nowrap text-muted', className)}>{empty}</span>
  return (
    <div className={clsx('min-w-0 whitespace-nowrap', className)}>
      {plate ? <div className="font-mono text-text">{plate}</div> : <div className="text-muted">No plate yet</div>}
      {detail && <div className="max-w-40 truncate text-xs text-muted">{detail}</div>}
    </div>
  )
}
