import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'

/** "Site details (optional)": folded away until opened, and open from the start when any value in it is set. */
export default function SiteDetails({ id, hasValue, children }: { id: string; hasValue: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (hasValue && !open) setOpen(true)
  return (
    <div>
      <button
        type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={id}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
      >
        <ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} aria-hidden="true" /> Site details (optional)
      </button>
      {open && <div id={id} className="mt-3 space-y-3">{children}</div>}
    </div>
  )
}
