/** Where a popover panel sits so it hangs under its button and never leaves the screen. */
export interface AnchorRect { left: number; right: number; bottom: number }

export interface PanelPosition { top: number; left: number; width: number }

const MARGIN = 8
const GAP = 8

/**
 * A fixed position for a panel under `anchor`. It lines up with the button's left edge (`align: 'start'`)
 * or its right edge (`'end'`), is as wide as asked for the screen allows, and is kept `MARGIN` px inside it.
 * Fixed placement means a scrolling or clipping parent (the sidebar) cannot cut the panel off.
 */
export function anchorPanel(anchor: AnchorRect, viewportWidth: number, width: number, align: 'start' | 'end'): PanelPosition {
  const w = Math.max(0, Math.min(width, viewportWidth - MARGIN * 2))
  const wanted = align === 'start' ? anchor.left : anchor.right - w
  const left = Math.max(MARGIN, Math.min(wanted, viewportWidth - w - MARGIN))
  return { top: anchor.bottom + GAP, left, width: w }
}
