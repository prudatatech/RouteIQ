import { useEffect, useId, useRef, useState } from 'react'
import { Layers } from 'lucide-react'
import clsx from 'clsx'
import { BASE_STYLES, BASE_STYLE_IDS, type BaseStyleId } from '@/config/mapConfig'

export interface LayerOverlay {
  id: string
  label: string
  checked: boolean
  /** Small explanation under the label. */
  hint?: string
}

/**
 * Map layers menu: one base map (streets, satellite, terrain, dark) and any number of overlays.
 * Draws itself bottom right, above the attribution. The page owns the state.
 */
export default function LayerSwitcher({ baseStyle, onBaseStyleChange, overlays, onOverlayChange, className }: {
  baseStyle: BaseStyleId
  onBaseStyleChange: (id: BaseStyleId) => void
  overlays: LayerOverlay[]
  onOverlayChange: (id: string, checked: boolean) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const name = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onPointer = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  return (
    <div ref={root} className={clsx('absolute bottom-8 right-2 z-10 flex flex-col items-end gap-2', className)}>
      {open && (
        <div id={panelId} role="group" aria-label="Map layers" className="w-56 rounded-control border border-border bg-surface p-3 text-sm shadow-raised">
          <fieldset>
            <legend className="text-xs font-medium uppercase text-muted">Base map</legend>
            <div className="mt-1.5 space-y-1">
              {BASE_STYLE_IDS.map((id) => (
                <label key={id} className="flex cursor-pointer items-center gap-2 text-text">
                  <input type="radio" name={name} checked={baseStyle === id} onChange={() => onBaseStyleChange(id)} className="h-4 w-4 accent-brand" />
                  {BASE_STYLES[id].label}
                </label>
              ))}
            </div>
          </fieldset>
          {overlays.length > 0 && (
            <fieldset className="mt-3 border-t border-border pt-3">
              <legend className="text-xs font-medium uppercase text-muted">Show on the map</legend>
              <div className="mt-1.5 space-y-1.5">
                {overlays.map((o) => (
                  <label key={o.id} className="flex cursor-pointer items-start gap-2 text-text">
                    <input type="checkbox" checked={o.checked} onChange={(e) => onOverlayChange(o.id, e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" />
                    <span>
                      {o.label}
                      {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-1.5 rounded-control border border-border bg-surface px-3 text-sm font-medium text-text shadow-raised hover:bg-surface-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Layers size={16} aria-hidden="true" />
        Layers
      </button>
    </div>
  )
}
