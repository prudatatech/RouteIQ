import { useId, useState } from 'react'
import { HelpCircle } from 'lucide-react'

export default function WhyHsn() {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
      >
        <HelpCircle size={14} aria-hidden="true" /> Why is HSN needed?
      </button>
      {open && (
        <span id={id} role="tooltip" className="absolute left-0 top-full z-20 mt-1 w-64 rounded-control border border-border bg-surface p-2 text-xs text-text shadow-raised">
          Required for e-Way Bill and GST invoice generation
        </span>
      )}
    </span>
  )
}
